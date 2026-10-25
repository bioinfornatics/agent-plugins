#!/usr/bin/env node
/**
 * Deterministic import and verification of host-delegated grading judgments
 * (ADR 0001, skills/skill-creator/references/adr/0001-host-delegated-semantic-grading.md,
 * ap-8di.4).
 *
 * `import-grading` consumes untrusted subagent judgment envelopes written by
 * a delegating host under `grading-judgments/`, validates their schema and
 * provenance, re-derives every hash rather than trusting a claimed one,
 * verifies the evidence quote is exactly contained in the stdout or decoded lossless UTF-8 artifact content
 * without being a self-referential
 * grading claim, rejects duplicate/replayed/budget-exceeding invocations,
 * and writes canonical grader evidence atomically into the originating run
 * directory (`grader-evidence/`). No imported judgment can self-author an
 * authoritative hash: `assertion_sha256`/`variant_sha256`/`output_sha256`
 * are always the values recomputed from the current evidence in
 * `deterministic-evidence.json`, never values copied from the judgment.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { deterministicCheck, normalizeAssertions, assertionHash, canonical as gradingCanonical, sha256 as gradingSha256 } from "./evaluator_grading.js";
import { readTrustedJson, readTrustedSnapshot } from "./trusted_snapshot.js";
import {
  validateGradingRequest, validateGradingJudgment, bindJudgmentToRequest,
  type GradingRequest, type GradingJudgment,
} from "./delegated_grading_contracts.js";
import { loadGradingManifest, REQUEST_DIR_NAME, JUDGMENT_DIR_NAME } from "./prepare_grading.js";
import { validateTaskEvidence, loadBoundTaskContext } from "./task_evidence.js";
import { validatedExecutionArtifactDigest } from "./evaluation_artifact_cache.js";
import { artifactHash, validateExecutionEvidence, deriveDelegatedEvidence, validateRetainedDelegatedEvidence } from "./evaluation_provenance.js";

export const DELEGATED_GRADING_AUTHORITY = "delegated-evaluator" as const;

export const DEFAULT_GRADER_BUDGET = 200;

export interface ImportedEvidence {
  invocation_id: string;
  run_directory: string;
  grader_id: string;
  verdict: "pass" | "fail" | "inconclusive";
  valid_evidence: boolean;
  reason?: string;
}

export interface ImportGradingResult {
  schema_version: "1.0";
  workspace: string;
  imported: ImportedEvidence[];
  rejected: Array<{ invocation_id: string; reason: string }>;
  already_imported: string[];
  budget: { used: number; limit: number };
  ready_to_resume: boolean;
  errors: Array<{ invocation_id: string; message: string }>;
}

function loadJson(root: string, path: string, label: string): any | null {
  if (!existsSync(path)) return null;
  try {
    return readTrustedJson(root, path, label);
  } catch {
    return null;
  }
}

function loadText(root: string, path: string, label: string, maxBytes: number): string | null {
  if (!existsSync(path)) return null;
  try {
    return readTrustedSnapshot(root, path, label, { maxBytes, allowEmpty: true }).bytes.toString("utf8");
  } catch {
    return null;
  }
}

function atomic(path: string, value: unknown): void {
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(temp, path);
}

/**
 * Imports and verifies every judgment file currently present under
 * `grading-judgments/`, writing canonical, re-derived grader evidence into
 * each judgment's originating run directory's `grader-evidence/`.
 *
 * Rejects (without writing evidence, and without throwing — every rejection
 * is reported in `rejected`/`errors`):
 * - malformed JSON or a judgment failing `validateGradingJudgment`'s closed
 *   schema (unknown fields, non-finite usage, invalid verdict enum, a
 *   `judgment_sha256` that does not match its own canonical contents);
 * - a judgment with no matching request file, or a request file failing
 *   `validateGradingRequest` (forged/stale `request_sha256`);
 * - a judgment whose `invocation_id`/`request_sha256`/bindings do not
 *   exactly match its claimed request (`bindJudgmentToRequest`), which
 *   covers wrong request IDs and stale/forged bindings;
 * - a judgment whose bindings no longer match the run directory's current
 *   `deterministic-evidence.json` (the run was re-executed after the
 *   request was prepared);
 * - a duplicate grader identity or a replayed invocation_id within the same
 *   assertion's already-imported evidence set (model/provider ambiguity is
 *   rejected the same way: two judgments claiming the same invocation_id
 *   but different grader identity are both rejected rather than one
 *   silently overwriting the other);
 * - an uncontained, self-referential, or non-substantive evidence quote;
 * - any import once the configured grader-call budget is exhausted.
 *
 * Re-import is idempotent: a judgment whose canonical evidence file already
 * exists with byte-identical content is reported in `already_imported` and
 * is validated against its original request/judgment and stored hashes, but
 * is not charged against the budget or rewritten. Unavailable slots may be
 * replaced by a new validated judgment without re-executing the task.
 */
function executionReady(workspace:string):boolean {const verified=validateExecutionEvidence(workspace);return verified.status==="complete"&&verified.bindings.length>0;}

export function importGrading(workspaceArg: string, options: { budgetLimit?: number } = {}): ImportGradingResult {
  const workspace = resolve(workspaceArg);
  const requestDir = join(workspace, REQUEST_DIR_NAME);
  const judgmentDir = join(workspace, JUDGMENT_DIR_NAME);
  const budgetLimit = options.budgetLimit ?? DEFAULT_GRADER_BUDGET;
  const imported: ImportedEvidence[] = [];
  const rejected: ImportGradingResult["rejected"] = [];
  const alreadyImported: string[] = [];
  const errors: ImportGradingResult["errors"] = [];
  let budgetUsed = 0;

  if (!existsSync(judgmentDir)) {
    return { schema_version: "1.0", workspace, imported, rejected, already_imported: alreadyImported, budget: { used: 0, limit: budgetLimit }, ready_to_resume: executionReady(workspace), errors };
  }

  const manifest = loadGradingManifest(workspace);
  // Track which grader identities and invocation IDs have already claimed a
  // slot for a given (run_directory, assertion_id, assertion_version) so a
  // duplicate/replayed/ambiguous claim on the same assertion is rejected
  // deterministically regardless of file iteration order.
  const claimedByAssertion = new Map<string, Set<string>>(); // key: run|assertion|version -> set of grader_id
  const consumedInvocationIds = new Set<string>();

  // Validate retained authority before any import can rewrite its directory hash.
  const invalidRuns = new Set<string>();
  for (const relativeRunDir of new Set(Object.values(manifest).map(entry => entry.run_directory))) {
    const runDir = resolve(workspace, relativeRunDir), dir = join(runDir, "grader-evidence");
    try {
      const prior = loadJson(runDir, join(runDir, "grading.json"), "grading.json");
      const execution = loadJson(runDir, join(runDir, "execution-evidence.json"), "execution-evidence.json");
      if ((prior?.authority === DELEGATED_GRADING_AUTHORITY || execution?.grading_binding?.authority === DELEGATED_GRADING_AUTHORITY) &&
          (execution?.artifact_sha256?.["grader-evidence"] !== artifactHash(dir) || execution?.artifact_sha256?.["grading.json"] !== artifactHash(join(runDir, "grading.json"))))
        throw new Error("Retained grading/evidence content hash mismatch");
      for (const name of existsSync(dir) ? readdirSync(dir).filter(n => n.endsWith(".json")) : []) {
        const item = loadJson(dir, join(dir, name), name);
        if (!item || item.source !== "host-delegated" || name !== item.invocation_id + ".json") throw new Error("Unexpected retained delegated evidence");
        const original = validateRetainedDelegatedEvidence(workspace, item);
        const output = loadText(runDir, join(runDir, "outputs", "result.txt"), "outputs/result.txt", 256 * 1024);
        const deterministic = loadJson(runDir, join(runDir, "deterministic-evidence.json"), "deterministic-evidence.json");
        const evalDir = dirname(dirname(runDir));
        const metadata = loadJson(evalDir, join(evalDir, "eval_metadata.json"), "eval_metadata.json");
        const assertion = normalizeAssertions(metadata?.assertions ?? []).find(a => assertionHash(a) === item.assertion_sha256);
        if (output === null || original.request.candidate.output !== output || gradingSha256(output) !== item.output_sha256 || deterministic?.variant_sha256 !== item.variant_sha256 || !assertion || original.request.assertion.id !== assertion.id || original.request.assertion.version !== assertion.version || original.request.assertion.criterion !== assertion.criterion)
          throw new Error("Retained request no longer matches authoritative execution/assertion");
        const identity = loadJson(runDir, join(runDir, "run-identity.json"), "run-identity.json");
        if (identity && !validatedExecutionArtifactDigest(runDir, identity.sha256, identity)) throw new Error("Retained execution content hash mismatch");
        const request = validateGradingRequest(loadJson(requestDir, join(requestDir, name), name));
        if (gradingCanonical(request) !== gradingCanonical(original.request)) throw new Error("Retained original request changed");
        if (original.evidence.availability === "available") {
          const judgment = validateGradingJudgment(loadJson(judgmentDir, join(judgmentDir, name), name));
          if (gradingCanonical(judgment) !== gradingCanonical(original.judgment)) throw new Error("Retained original judgment changed");
        }
      }
    } catch (error) {
      invalidRuns.add(relativeRunDir);
      errors.push({ invocation_id: "*", message: relativeRunDir + ": " + (error as Error).message });
    }
  }

  const fileNames = readdirSync(judgmentDir).filter((name) => name.endsWith(".json")).sort();
  for (const fileName of fileNames) {
    const invocationId = fileName.replace(/\.json$/, "");
    const judgmentPath = join(judgmentDir, fileName);
    const requestPath = join(requestDir, fileName);
    try {
      const manifestEntry = manifest[invocationId];
      if (!manifestEntry) { rejected.push({ invocation_id: invocationId, reason: "No prepare-grading manifest entry for this invocation_id" }); continue; }
      const runDir = resolve(workspace, manifestEntry.run_directory);
      const evidenceDir = join(runDir, "grader-evidence");
      const evidencePath = join(evidenceDir, invocationId + ".json");

      if (invalidRuns.has(manifestEntry.run_directory)) { rejected.push({ invocation_id: invocationId, reason: "Retained grading integrity validation failed; preserve original artifacts" }); continue; }
      if (existsSync(evidencePath)) {
        const retained = loadJson(evidenceDir, evidencePath, invocationId);
        const original = validateRetainedDelegatedEvidence(workspace, retained);
        if (original.evidence.availability === "available") {
          // Even on reuse, validate the external original envelopes as well.
          const current = deriveDelegatedEvidence(loadJson(requestDir, requestPath, fileName), loadJson(judgmentDir, judgmentPath, fileName), loadBoundTaskContext(runDir,original.request.candidate.output));
          if (gradingCanonical(current.request) !== gradingCanonical(original.request) || gradingCanonical(current.judgment) !== gradingCanonical(original.judgment)) throw new Error("Retained original request/judgment changed");
          alreadyImported.push(invocationId); continue;
        }
      }

      if (budgetUsed >= budgetLimit) { rejected.push({ invocation_id: invocationId, reason: "Semantic grader budget exhausted" }); continue; }

      let judgmentRaw: unknown;
      try {
        judgmentRaw = loadJson(judgmentDir, judgmentPath, fileName);
      } catch (error) { rejected.push({ invocation_id: invocationId, reason: `Judgment file is unreadable or escapes containment: ${(error as Error).message}` }); continue; }
      if (!judgmentRaw) { rejected.push({ invocation_id: invocationId, reason: "Judgment file is missing or not valid JSON" }); continue; }

      let judgment: GradingJudgment;
      try {
        judgment = validateGradingJudgment(judgmentRaw);
      } catch (error) { rejected.push({ invocation_id: invocationId, reason: `Judgment schema is invalid: ${(error as Error).message}` }); continue; }

      let requestRaw: unknown;
      try {
        requestRaw = existsSync(requestPath) ? loadJson(requestDir, requestPath, fileName) : null;
      } catch (error) { rejected.push({ invocation_id: invocationId, reason: `Request file is unreadable or escapes containment: ${(error as Error).message}` }); continue; }
      if (!requestRaw) { rejected.push({ invocation_id: invocationId, reason: "No matching request file for this invocation_id" }); continue; }

      let request: GradingRequest;
      try {
        request = validateGradingRequest(requestRaw);
      } catch (error) { rejected.push({ invocation_id: invocationId, reason: `Request schema is invalid: ${(error as Error).message}` }); continue; }

      try {
        bindJudgmentToRequest(request, judgment);
      } catch (error) { rejected.push({ invocation_id: invocationId, reason: (error as Error).message }); continue; }

      // Re-derive authoritative bindings from current evidence rather than
      // trusting the request/judgment's copy: a judgment can never
      // self-author its own binding to a different or re-executed run.
      const deterministicPath = join(runDir, "deterministic-evidence.json");
      const deterministic = loadJson(runDir, deterministicPath, "deterministic-evidence.json");
      const outputText = loadText(runDir, join(runDir, "outputs", "result.txt"), "outputs/result.txt", 256 * 1024);
      if (!deterministic || outputText === null) { rejected.push({ invocation_id: invocationId, reason: "Originating run no longer has deterministic evidence or candidate output" }); continue; }
      const currentVariantSha256 = String(deterministic.variant_sha256 ?? "");
      const currentOutputSha256 = String(deterministic.output_sha256 ?? "");
      const identityPath=join(runDir,"run-identity.json"),identity=existsSync(identityPath)?loadJson(runDir,identityPath,"run-identity.json"):null;
      if((identity&&!validatedExecutionArtifactDigest(runDir,identity.sha256,identity))||gradingSha256(outputText)!==currentOutputSha256){rejected.push({invocation_id:invocationId,reason:"stale or tampered candidate execution/output bindings"});continue;}
      if (judgment.bindings.variant_sha256 !== currentVariantSha256 || judgment.bindings.output_sha256 !== currentOutputSha256) {
        rejected.push({ invocation_id: invocationId, reason: "Request/judgment bindings are stale: the run has been re-executed since prepare-grading" });
        continue;
      }

      // The judgment's grader identity must exactly match the identity
      // prepare-grading assigned to this invocation_id's slot (from the
      // scenario's immutable grading_plan). A judgment claiming a
      // different id, model, or provider than the one this slot was
      // prepared for is rejected outright: it cannot silently substitute
      // one planned grader's evidence for another's, and it cannot forge
      // a model identity the plan never declared.
      if (judgment.grader.id !== manifestEntry.grader_id || judgment.grader.model !== manifestEntry.grader_model || judgment.grader.provider !== manifestEntry.grader_provider) {
        rejected.push({ invocation_id: invocationId, reason: `Judgment grader identity does not match the planned grader (${manifestEntry.grader_id}/${manifestEntry.grader_model}) for this invocation` });
        continue;
      }

      const assertionKey = `${manifestEntry.run_directory}|${manifestEntry.assertion_id}|${manifestEntry.assertion_version}`;
      const claimed = claimedByAssertion.get(assertionKey) ?? new Set<string>();
      if (claimed.has(judgment.grader.id)) { rejected.push({ invocation_id: invocationId, reason: `Grader ${judgment.grader.id} already has an imported judgment for this assertion` }); continue; }
      if (consumedInvocationIds.has(invocationId)) { rejected.push({ invocation_id: invocationId, reason: "invocation_id has already been imported (replay)" }); continue; }

      const derived = deriveDelegatedEvidence(request, judgment, loadBoundTaskContext(runDir,outputText));
      const validEvidence = derived.evidence.valid_evidence;
      const canonicalEvidence = { ...derived.evidence, source_request: request, source_judgment: judgment };
      const evalDir = dirname(dirname(runDir));
      const metadata = loadJson(evalDir, join(evalDir, "eval_metadata.json"), "eval_metadata.json");
      const assertion = normalizeAssertions(metadata?.assertions ?? []).find(a => a.id === manifestEntry.assertion_id && a.version === manifestEntry.assertion_version);
      if (!assertion || request.assertion.criterion !== assertion.criterion || request.candidate.output !== outputText || request.assertion.id !== manifestEntry.assertion_id || request.assertion.version !== manifestEntry.assertion_version ||
          request.bindings.assertion_sha256 !== assertionHash(assertion))
        throw new Error("Original request differs from authoritative assertion plan");

      atomic(evidencePath, canonicalEvidence);
      claimed.add(judgment.grader.id);
      claimedByAssertion.set(assertionKey, claimed);
      consumedInvocationIds.add(invocationId);
      budgetUsed++;
      imported.push({ invocation_id: invocationId, run_directory: manifestEntry.run_directory, grader_id: judgment.grader.id, verdict: canonicalEvidence.verdict as ImportedEvidence["verdict"], valid_evidence: validEvidence, ...(validEvidence ? {} : { reason: canonicalEvidence.rationale }) });
    } catch (error) {
      errors.push({ invocation_id: invocationId, message: (error as Error).message });
    }
  }

  // Finalize any run whose grader-evidence/ now contains exactly one valid
  // judgment per planned grader for every semantic assertion: regenerate a
  // canonical grading.json/deterministic-evidence.json and complete
  // execution-evidence.json's grading_binding, so a subsequent
  // validateExecutionEvidence pass (and full-eval --resume) sees the same
  // shape it already trusts for evaluator-owned grading, just authored by
  // delegated-evaluator rather than a subprocess grader.
  const touchedRunDirs = new Set<string>(imported.map(i => i.run_directory).filter(dir => !invalidRuns.has(dir)));
  for (const relativeRunDir of touchedRunDirs) {
    try {
      finalizeDelegatedRun(workspace, relativeRunDir);
    } catch (error) {
      errors.push({ invocation_id: "*", message: `finalizing ${relativeRunDir}: ${(error as Error).message}` });
    }
  }

  const readyToResume = (imported.length + alreadyImported.length > 0 || executionReady(workspace)) && rejected.length === 0 && errors.length === 0 && !imported.some(i => {
    const item = loadJson(workspace, join(workspace, i.run_directory, "grader-evidence", i.invocation_id + ".json"), i.invocation_id);
    return item?.availability === "unavailable";
  }) && !alreadyImported.some(id => {
    const item = loadJson(workspace, join(workspace, manifest[id].run_directory, "grader-evidence", id + ".json"), id);
    return validateRetainedDelegatedEvidence(workspace, item).evidence.availability === "unavailable";
  });
  return { schema_version: "1.0", workspace, imported, rejected, already_imported: alreadyImported, budget: { used: budgetUsed, limit: budgetLimit }, ready_to_resume: readyToResume, errors };
}

/**
 * If every semantic assertion for this run now has exactly one valid
 * judgment from each of its scenario's planned graders, regenerates
 * grading.json/deterministic-evidence.json (preserving already-resolved
 * deterministic expectations) and completes execution-evidence.json's
 * grading_binding, mirroring the shape evaluator-owned grading already
 * produces so validateExecutionEvidence's delegated-grading branch can
 * verify it uniformly. Otherwise leaves every artifact untouched — a run
 * with any still-pending or invalid judgment is not finalized.
 */
function finalizeDelegatedRun(workspace: string, relativeRunDir: string): void {
  const runDir = resolve(workspace, relativeRunDir);
  const evalDir = dirname(dirname(runDir));
  const metadata = loadJson(evalDir, join(evalDir, "eval_metadata.json"), "eval_metadata.json");
  if (!metadata || metadata.evidence_mode?.planned !== "delegated-grading") return;
  const assertions = normalizeAssertions(Array.isArray(metadata.assertions) ? metadata.assertions : []);
  const semantic = assertions.filter((a) => a.classification === "semantic");
  if (!semantic.length) return;
  const plan = metadata.grading_plan;
  const planned: Array<{ id: string; model: string; provider: string }> = Array.isArray(plan?.graders) ? plan.graders : [];
  if (!planned.length) return;

  const deterministicPath = join(runDir, "deterministic-evidence.json");
  const deterministic = loadJson(runDir, deterministicPath, "deterministic-evidence.json");
  const outputText = loadText(runDir, join(runDir, "outputs", "result.txt"), "outputs/result.txt", 256 * 1024);
  if (!deterministic || outputText === null) return;
  const variantSha256 = String(deterministic.variant_sha256 ?? ""), outputSha256 = String(deterministic.output_sha256 ?? "");
  const evidenceDir = join(runDir, "grader-evidence");
  const evidenceFiles = existsSync(evidenceDir) ? readdirSync(evidenceDir).filter((n) => n.endsWith(".json")) : [];
  const evidenceByAssertion = new Map<string, any[]>();
  for (const name of evidenceFiles) {
    let item: any;
    try { item = loadJson(evidenceDir, join(evidenceDir, name), name); } catch { continue; }
    if (!item || item.variant_sha256 !== variantSha256 || item.output_sha256 !== outputSha256) throw new Error("Retained evidence has stale output bindings");
    const original = validateRetainedDelegatedEvidence(workspace, item);
    const assertion = assertions.find(a => assertionHash(a) === item.assertion_sha256);
    if (!assertion || original.request.assertion.id !== assertion.id || original.request.assertion.version !== assertion.version || original.request.assertion.criterion !== assertion.criterion || original.request.candidate.output !== outputText) throw new Error("Retained evidence differs from authoritative request/output");
    item = { ...item, availability: original.evidence.availability };
    const list = evidenceByAssertion.get(item.assertion_sha256) ?? [];
    list.push(item);
    evidenceByAssertion.set(item.assertion_sha256, list);
  }

  const semanticExpectations: any[] = [];
  for (const assertion of semantic) {
    const ah = assertionHash(assertion);
    const items = evidenceByAssertion.get(ah) ?? [];
    const plannedIds = new Set(planned.map((g) => g.id));
    const byGrader = new Map<string, any>();
    if (items.length > planned.length || new Set(items.map(j => j.grader_id)).size !== items.length || items.some(j => !plannedIds.has(j.grader_id))) throw new Error("Retained evidence contains duplicate or unplanned grader slots");
    for (const item of items) if (plannedIds.has(item.grader_id) && !byGrader.has(item.grader_id)) byGrader.set(item.grader_id, item);
    if (byGrader.size !== planned.length) return; // still awaiting one or more planned graders for this assertion
    const judgments = planned.map((g) => byGrader.get(g.id));
    if (judgments.some((j, i) => j.model !== planned[i].model || j.provider !== (planned[i].provider ?? "unspecified"))) throw new Error("Retained grader identity differs from immutable plan");
    const valid = judgments.filter((j) => j.valid_evidence === true);
    const decisions = new Set(valid.filter((j) => j.verdict !== "inconclusive").map((j) => j.verdict));
    const unanimous = judgments.length >= 1 && valid.length === judgments.length && !valid.some((j) => j.verdict === "inconclusive") && decisions.size === 1;
    const verdict = unanimous ? valid[0].verdict : "inconclusive";
    semanticExpectations.push({
      id: assertion.id, version: assertion.version, classification: "semantic", ...(assertion.critical===undefined?{}:{critical:assertion.critical}), text: assertion.criterion, criterion: assertion.criterion,
      assertion_sha256: ah, variant_sha256: variantSha256, output_sha256: outputSha256,
      verdict, availability: judgments.some(j => j.availability === "unavailable") ? "unavailable" : "available", human_review: !unanimous, passed: verdict === "pass",
      agreement: { grader_count: judgments.length, valid_evidence_count: valid.length, disagreement: !unanimous, verdicts: Object.fromEntries((["pass", "fail", "inconclusive"] as const).map((v) => [v, judgments.filter((j) => j.verdict === v).length])) },
      // Keep the historical pending marker for full-eval's delegated retry
      // seam. Complete invalid evidence remains preserved in grader-evidence.
      evidence: judgments.map((j) => j.evidence_quote), judgments: judgments.some(j => j.availability === "unavailable") ? [] : judgments.map((j) => ({ grader_id: j.grader_id, model: j.model, invocation_id: j.invocation_id, verdict: j.verdict, evidence_quote: j.evidence_quote, rationale: j.rationale, valid_evidence: j.valid_evidence, usage: j.usage, availability: j.availability })),
      ...(judgments.some(j => j.availability === "unavailable") ? { reason: "At least one explicit independent grader and an adapter are required" } : {}),
    });
  }

  const contextPath=join(runDir,"outputs","task-evidence.json"),context=existsSync(contextPath)?validateTaskEvidence(loadJson(runDir,contextPath,"task-evidence.json")):undefined;
  const deterministicExpectations=assertions.filter(a=>a.classification==="deterministic").map(a=>{const checked=deterministicCheck(a,outputText,context);return {id:a.id,version:a.version,classification:a.classification,...(a.critical===undefined?{}:{critical:a.critical}),text:a.criterion,criterion:a.criterion,assertion_sha256:assertionHash(a),variant_sha256:variantSha256,output_sha256:outputSha256,verdict:checked.verdict,passed:checked.verdict==="pass",evidence:checked.evidence};});
  const expectations = [...deterministicExpectations, ...semanticExpectations];
  const passed = expectations.filter((e) => e.verdict === "pass").length, failed = expectations.filter((e) => e.verdict === "fail").length, inconclusive = expectations.length - passed - failed;
  const assertionSetHash = gradingSha256(gradingCanonical(assertions));
  const unavailable = semanticExpectations.filter(e => e.availability === "unavailable").length;
  const grading = {
    schema_version: 2, authority: DELEGATED_GRADING_AUTHORITY, assertion_set_sha256: assertionSetHash, variant_sha256: variantSha256, output_sha256: outputSha256,
    expectations, summary: { passed, failed, inconclusive, unavailable, total: expectations.length, pass_rate: unavailable ? null : expectations.length ? passed / expectations.length : 0, human_review: inconclusive > 0 },
    grading_budget: { used: evidenceFiles.length, limit: evidenceFiles.length },
  };
  atomic(join(runDir, "grading.json"), grading);

  const executionEvidencePath = join(runDir, "execution-evidence.json");
  const executionEvidence = loadJson(runDir, executionEvidencePath, "execution-evidence.json");
  if (executionEvidence) {
    executionEvidence.grading_binding = { authority: DELEGATED_GRADING_AUTHORITY, assertion_set_sha256: assertionSetHash, variant_sha256: variantSha256, output_sha256: outputSha256, grader_identities: planned };
    executionEvidence.artifact_sha256 = { ...executionEvidence.artifact_sha256, "grading.json": artifactHash(join(runDir, "grading.json")), "grader-evidence": artifactHash(evidenceDir) };
    atomic(executionEvidencePath, executionEvidence);
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const workspace = argv[0];
  if (!workspace) { console.error("usage: import-grading <workspace> [--budget <n>]"); return 2; }
  const budgetIndex = argv.indexOf("--budget");
  const budgetLimit = budgetIndex >= 0 ? Number(argv[budgetIndex + 1]) : undefined;
  try {
    console.log(JSON.stringify(importGrading(workspace, { budgetLimit }), null, 2));
    return 0;
  } catch (error) {
    console.log(JSON.stringify({ schema_version: "1.0", command: "import-grading", status: "failure", reason: (error as Error).message }, null, 2));
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().then((code) => process.exit(code));
}
