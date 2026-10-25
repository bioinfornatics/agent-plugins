#!/usr/bin/env node
/**
 * Batched delegation helpers for host-delegated grading (ADR 0001,
 * skills/skill-creator/references/adr/0001-host-delegated-semantic-grading.md,
 * ap-8di.5 efficiency follow-up).
 *
 * `prepare-grading` writes one blinded GradingRequest per (run, assertion,
 * grader) slot. When a scenario has many assertions, the same candidate
 * output is repeated across many requests for the same grader — dogfooding
 * on plugin-script-packaging (ap-8di.11) produced 112 individual requests
 * for 12 runs, requiring 112 separate delegate calls if handled one request
 * at a time. Grouping every pending request that shares the same
 * (run_directory, grader_id) into a single batch lets one subagent judge
 * every assertion for that run/grader in one delegated call, cutting the
 * number of delegate calls roughly to (runs * distinct graders) instead of
 * (runs * assertions * graders) — 24 calls instead of 112 in that run.
 *
 * This module only changes how requests are grouped for delegation and how
 * results are fanned back out to individual judgment files; it does not
 * change the request/judgment contracts, the blinding guarantees, or any
 * verification logic in delegated_grading_contracts.ts/import_grading.ts.
 * Every produced judgment is validated by the exact same
 * buildGradingJudgment/import-grading path a single-request judgment would
 * go through — batching is purely a host-side convenience, not a new trust
 * boundary.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { readTrustedJson } from "./trusted_snapshot.js";
import { buildGradingJudgment, validateGradingRequest, type GradingRequest } from "./delegated_grading_contracts.js";
import { loadGradingManifest, REQUEST_DIR_NAME, JUDGMENT_DIR_NAME } from "./prepare_grading.js";

const BATCH_DIR_NAME = "grading-batches";

export interface BatchRequestSummary {
  invocation_id: string;
  assertion_id: string;
  assertion_version: number;
  criterion: string;
}

export interface GradingBatch {
  schema_version: "1.0";
  batch_id: string;
  run_directory: string;
  grader_id: string;
  grader_model: string;
  grader_provider: string;
  prompt: string;
  candidate_alias: string;
  candidate_output: string;
  instructions: string;
  requests: BatchRequestSummary[];
}

export interface GroupBatchesResult {
  schema_version: "1.0";
  workspace: string;
  batch_directory: string;
  batches_written: number;
  requests_batched: number;
  batches: Array<{ batch_id: string; run_directory: string; grader_id: string; request_count: number }>;
  errors: Array<{ invocation_id: string; message: string }>;
}

export interface BatchResultEntry {
  invocation_id: string;
  verdict: "pass" | "fail" | "inconclusive";
  evidence_quote: string;
  rationale: string;
  usage?: Record<string, number> | null;
}

export interface ApplyBatchResult {
  schema_version: "1.0";
  workspace: string;
  batch_id: string;
  judgments_written: number;
  errors: Array<{ invocation_id: string; message: string }>;
}

function atomic(path: string, value: unknown): void {
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(temp, path);
}

function loadJson(root: string, path: string, label: string): any | null {
  if (!existsSync(path)) return null;
  try {
    return readTrustedJson(root, path, label);
  } catch {
    return null;
  }
}

/**
 * Groups every pending grading-requests/*.json entry (one with no matching
 * grading-judgments/*.json yet) by (run_directory, grader_id) and writes one
 * GradingBatch file per group into <workspace>/grading-batches/. The batch
 * carries the candidate output exactly once, plus one BatchRequestSummary
 * (invocation_id, assertion id/version, criterion) per request in that
 * group — no request field is invented; every value is copied verbatim
 * from its already-validated GradingRequest.
 *
 * Never invokes a model, spawns Goose, or reads provider credentials: pure
 * filesystem grouping, safe to run repeatedly (re-running overwrites a
 * batch file with the then-current pending set, but never touches
 * grading-requests/ or grading-judgments/ themselves).
 */
export function groupPendingBatches(workspaceArg: string): GroupBatchesResult {
  const workspace = resolve(workspaceArg);
  const requestDir = join(workspace, REQUEST_DIR_NAME);
  const judgmentDir = join(workspace, JUDGMENT_DIR_NAME);
  const batchDir = join(workspace, BATCH_DIR_NAME);
  const errors: GroupBatchesResult["errors"] = [];
  const batches: GroupBatchesResult["batches"] = [];
  let requestsBatched = 0;

  if (!existsSync(requestDir)) {
    return { schema_version: "1.0", workspace, batch_directory: batchDir, batches_written: 0, requests_batched: 0, batches, errors };
  }

  const manifest = loadGradingManifest(workspace);
  const fileNames = readdirSync(requestDir).filter((name) => name.endsWith(".json") && name !== "manifest.json").sort();
  const groups = new Map<string, { runDirectory: string; graderId: string; requests: GradingRequest[] }>();

  for (const fileName of fileNames) {
    const invocationId = fileName.replace(/\.json$/, "");
    const judgmentPath = join(judgmentDir, fileName);
    if (existsSync(judgmentPath)) continue; // already judged, nothing to batch
    const manifestEntry = manifest[invocationId];
    if (!manifestEntry) { errors.push({ invocation_id: invocationId, message: "No prepare-grading manifest entry for this invocation_id" }); continue; }
    let requestRaw: unknown;
    try {
      requestRaw = loadJson(requestDir, join(requestDir, fileName), fileName);
    } catch (error) { errors.push({ invocation_id: invocationId, message: `Request file is unreadable or escapes containment: ${(error as Error).message}` }); continue; }
    if (!requestRaw) { errors.push({ invocation_id: invocationId, message: "Request file is missing or not valid JSON" }); continue; }
    let request: GradingRequest;
    try {
      request = validateGradingRequest(requestRaw);
    } catch (error) { errors.push({ invocation_id: invocationId, message: `Request schema is invalid: ${(error as Error).message}` }); continue; }

    const key = manifestEntry.run_directory + "|" + manifestEntry.grader_id;
    const group = groups.get(key) ?? { runDirectory: manifestEntry.run_directory, graderId: manifestEntry.grader_id, requests: [] };
    group.requests.push(request);
    groups.set(key, group);
    requestsBatched++;
  }

  for (const [key, group] of groups) {
    const first = group.requests[0];
    const batchId = "batch-" + key.replace(/[\\/|]/g, "-");
    const batch: GradingBatch = {
      schema_version: "1.0",
      batch_id: batchId,
      run_directory: group.runDirectory,
      grader_id: group.graderId,
      grader_model: first.grader.model,
      grader_provider: first.grader.provider,
      prompt: first.prompt,
      candidate_alias: first.candidate.alias,
      candidate_output: first.candidate.output,
      instructions: first.instructions,
      requests: group.requests.map((r) => ({ invocation_id: r.invocation_id, assertion_id: r.assertion.id, assertion_version: r.assertion.version, criterion: r.assertion.criterion })),
    };
    atomic(join(batchDir, batchId + ".json"), batch);
    batches.push({ batch_id: batchId, run_directory: group.runDirectory, grader_id: group.graderId, request_count: group.requests.length });
  }

  return { schema_version: "1.0", workspace, batch_directory: batchDir, batches_written: batches.length, requests_batched: requestsBatched, batches, errors };
}

/**
 * Consumes a batch result file (an array of BatchResultEntry, one per
 * request in the named batch, matched by invocation_id) and writes one
 * individual judgment file per entry into <workspace>/grading-judgments/,
 * built via the same buildGradingJudgment used for a single-request
 * judgment. Every judgment is later re-validated end to end by
 * import-grading exactly as if it had been produced one request at a time
 * — batching never bypasses that verification.
 *
 * An entry whose invocation_id does not appear in the named batch is
 * rejected (reported in errors) rather than silently accepted; a missing
 * entry for a request in the batch simply leaves that invocation_id
 * unjudged (still pending), matching import-grading's own "leave pending,
 * never fabricate" behavior for a failed/missing delegate response.
 */
export function applyBatchResults(workspaceArg: string, batchId: string, results: unknown): ApplyBatchResult {
  const workspace = resolve(workspaceArg);
  const batchDir = join(workspace, BATCH_DIR_NAME);
  const judgmentDir = join(workspace, JUDGMENT_DIR_NAME);
  const errors: ApplyBatchResult["errors"] = [];
  let written = 0;

  const batchPath = join(batchDir, batchId + ".json");
  const batch = loadJson(batchDir, batchPath, batchId + ".json") as GradingBatch | null;
  if (!batch) { errors.push({ invocation_id: "*", message: `Batch ${batchId} is missing or unreadable` }); return { schema_version: "1.0", workspace, batch_id: batchId, judgments_written: 0, errors }; }

  const requestDir = join(workspace, REQUEST_DIR_NAME);
  const requestsById = new Map(batch.requests.map((r) => [r.invocation_id, r]));

  if (!Array.isArray(results)) { errors.push({ invocation_id: "*", message: "Batch results must be a JSON array" }); return { schema_version: "1.0", workspace, batch_id: batchId, judgments_written: 0, errors }; }

  for (const raw of results) {
    const entry = raw as Partial<BatchResultEntry>;
    const invocationId = String(entry?.invocation_id ?? "");
    if (!requestsById.has(invocationId)) { errors.push({ invocation_id: invocationId || "(missing)", message: `invocation_id is not part of batch ${batchId}` }); continue; }
    if (!entry || !["pass", "fail", "inconclusive"].includes(String(entry.verdict))) { errors.push({ invocation_id: invocationId, message: "verdict must be pass, fail, or inconclusive" }); continue; }
    const requestPath = join(requestDir, invocationId + ".json");
    const request = loadJson(requestDir, requestPath, invocationId + ".json") as GradingRequest | null;
    if (!request) { errors.push({ invocation_id: invocationId, message: "Originating request file is missing or unreadable" }); continue; }
    try {
      const judgment = buildGradingJudgment({
        invocationId,
        requestSha256: request.request_sha256,
        bindings: request.bindings,
        grader: { id: batch.grader_id, model: batch.grader_model, provider: batch.grader_provider },
        verdict: entry.verdict as "pass" | "fail" | "inconclusive",
        evidenceQuote: String(entry.evidence_quote ?? ""),
        rationale: String(entry.rationale ?? ""),
        usage: entry.usage ?? null,
      });
      atomic(join(judgmentDir, invocationId + ".json"), judgment);
      written++;
    } catch (error) {
      errors.push({ invocation_id: invocationId, message: (error as Error).message });
    }
  }

  return { schema_version: "1.0", workspace, batch_id: batchId, judgments_written: written, errors };
}

export { BATCH_DIR_NAME };

/** CLI entry for `skill-creator group-grading-batches <workspace>`. */
export async function mainGroup(argv: string[] = process.argv.slice(2)): Promise<number> {
  const workspace = argv[0];
  if (!workspace) { console.error("usage: group-grading-batches <workspace>"); return 2; }
  try {
    console.log(JSON.stringify(groupPendingBatches(workspace), null, 2));
    return 0;
  } catch (error) {
    console.log(JSON.stringify({ schema_version: "1.0", command: "group-grading-batches", status: "failure", reason: (error as Error).message }, null, 2));
    return 1;
  }
}

/** CLI entry for `skill-creator apply-grading-batch <workspace> <batch-id> <results.json>`. */
export async function mainApply(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [workspace, batchId, resultsPath] = argv;
  if (!workspace || !batchId || !resultsPath) { console.error("usage: apply-grading-batch <workspace> <batch-id> <results.json>"); return 2; }
  try {
    // resultsPath is an explicit CLI argument authored by the delegating
    // host (like --eval-set elsewhere), not workspace content subject to
    // the same trust boundary as grading-requests/grading-judgments; read
    // it directly rather than through the workspace-contained trusted
    // reader.
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(resolve(resultsPath), "utf8"));
    } catch (error) {
      throw new Error(`Results file ${resultsPath} is missing or not valid JSON: ${(error as Error).message}`);
    }
    console.log(JSON.stringify(applyBatchResults(workspace, batchId, raw), null, 2));
    return 0;
  } catch (error) {
    console.log(JSON.stringify({ schema_version: "1.0", command: "apply-grading-batch", status: "failure", reason: (error as Error).message }, null, 2));
    return 1;
  }
}
