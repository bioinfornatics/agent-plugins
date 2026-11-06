import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { JudgeRequest } from "../../../application/ports/judge.ts";
import type { JudgmentHistory, JudgmentRecord } from "../../../application/ports/judgment-history.ts";
import { EvaluationError } from "../../../domain/evaluation.ts";
import { validateJudgment } from "../../../domain/judgment.ts";
import { validateGradingProvenance } from "./grading-provenance.ts";
import { parseGradingJson } from "./grading-serialization.ts";
import { Database } from "./sqlite-database.ts";
import { validateGradingExtension } from "./grading-schema.ts";
import { canonicalProfileRevision, readStoredPlan } from "./registry-schema.ts";
import { safeArtifactPath } from "./registry-files.ts";
import { inspectExistingRegistry, validatePrincipalRegistry } from "./sqlite-verified-attempt.ts";
import type { ArtifactManifest } from "./campaign-checkpoint.ts";

interface Run {
  id: string; campaign_id: string; attempt_id: string; trial_id: string; created_at: string;
  manifest_digest: string; evidence_digest: string; request_digest: string; criteria_json: string;
  request_json: string; manifest_json: string; provenance_json: string; outcome_json: string; status: string;
}
interface JudgmentRow { grading_id: string; criterion_id: string; criterion_text: string; verdict: string; rationale: string; evidence_json: string }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const digest = /^[a-f0-9]{64}$/;
function requireValid(condition: unknown): asserts condition { if (!condition) throw new Error("Invalid stored grading binding"); }
function exact(actual: unknown, expected: unknown): void { requireValid(isDeepStrictEqual(actual, expected)); }
function readRecord(db: Database, run: Run, rows: JudgmentRow[]): JudgmentRecord {
  requireValid(uuid.test(run.id) && uuid.test(run.campaign_id) && uuid.test(run.attempt_id) && typeof run.trial_id === "string");
  requireValid(typeof run.created_at === "string" && Number.isFinite(Date.parse(run.created_at)) && new Date(run.created_at).toISOString() === run.created_at);
  requireValid([run.manifest_digest, run.evidence_digest, run.request_digest].every(d => typeof d === "string" && digest.test(d)));
  const campaign = db.query<{ profile_id: string; revision: string; plan_json: string }, [string]>("SELECT profile_id,revision,plan_json FROM experiments WHERE id=?").get(run.campaign_id);
  requireValid(campaign);
  parseGradingJson(campaign.plan_json, "plan");
  const plan = readStoredPlan(campaign.plan_json);
  requireValid(plan.profile.id === campaign.profile_id && plan.profile.revision === campaign.revision);
  const retained = db.query<{ snapshot_json: string }, [string, string]>("SELECT snapshot_json FROM profile_revisions WHERE profile_id=? AND revision=?").get(campaign.profile_id, campaign.revision);
  requireValid(retained);
  exact(canonicalProfileRevision(parseGradingJson(retained.snapshot_json, "snapshot") as typeof plan.profile), canonicalProfileRevision(plan.profile));
  const candidate = db.query<{ trial_id: string; pair_id: string; scenario: string; target: string; condition: string; status: string }, [string, string]>("SELECT trial_id,pair_id,scenario,target,condition,status FROM trials WHERE campaign_id=? AND id=?").get(run.campaign_id, run.attempt_id);
  const trial = plan.trials.find(t => t.id === run.trial_id), scenario = plan.profile.scenarios.find(s => s.id === trial?.scenario);
  requireValid(candidate && trial && scenario && candidate.trial_id === run.trial_id && candidate.pair_id === trial.pairId && candidate.scenario === trial.scenario && candidate.target === plan.profile.id && candidate.condition === trial.condition && ["completed", "nonzero", "timeout"].includes(candidate.status));
  const request = parseGradingJson(run.request_json, "request") as JudgeRequest;
  requireValid(request && typeof request === "object" && Array.isArray(request.artifacts));
  requireValid(createHash("sha256").update(run.request_json).digest("hex") === run.request_digest);
  const criteria = scenario.expectations.map((text, index) => ({ id: `criterion-${index + 1}`, text }));
  exact(parseGradingJson(run.criteria_json, "criteria"), criteria); exact(request.criteria, criteria);
  const options = request.options;
  if (options !== undefined) {
    requireValid(options && typeof options === "object" && Object.keys(options).every(key => ["model", "maxTurns", "timeout"].includes(key)));
    requireValid(options.model === undefined || (typeof options.model === "string" && !!options.model.trim()));
    requireValid(options.maxTurns === undefined || (Number.isSafeInteger(options.maxTurns) && options.maxTurns >= 1));
    requireValid(options.timeout === undefined || (Number.isSafeInteger(options.timeout) && options.timeout >= 0 && options.timeout <= 2147483));
  }
  exact(request, { task: scenario.prompt, ...(scenario.expectedOutput === undefined ? {} : { expectedOutput: scenario.expectedOutput }), criteria, artifacts: request.artifacts, ...(options === undefined ? {} : { options }) });
  const manifest = parseGradingJson(run.manifest_json, "manifest") as ArtifactManifest[];
  requireValid(Array.isArray(manifest) && manifest.length <= 10000 && manifest.length === request.artifacts.length);
  requireValid(createHash("sha256").update(run.manifest_json).digest("hex") === run.manifest_digest);
  const indexed = db.query<ArtifactManifest, [string, string]>("SELECT path,sha256,bytes FROM artifacts WHERE campaign_id=? AND trial_id=? ORDER BY path").all(run.campaign_id, run.attempt_id);
  exact(manifest, indexed);
  let total = 0;
  const paths = new Set<string>();
  for (const item of manifest) {
    safeArtifactPath(item.path);
    requireValid(!paths.has(item.path) && digest.test(item.sha256) && Number.isSafeInteger(item.bytes) && item.bytes >= 0 && item.bytes <= 64 * 1024 * 1024);
    paths.add(item.path); total += item.bytes;
    const artifact = request.artifacts.find(a => a.path === item.path);
    requireValid(artifact && artifact.sha256 === item.sha256);
    if (artifact.kind === "text") {
      requireValid(typeof artifact.text === "string");
      // The verified reader uses fatal UTF-8 with ignoreBOM:true: BOM remains in
      // retained text. UTF-8 roundtrip must preserve exact original bytes, not strip it.
      const bytes = Buffer.from(artifact.text, "utf8");
      requireValid(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) === artifact.text && bytes.length === item.bytes && createHash("sha256").update(bytes).digest("hex") === item.sha256);
      exact(artifact, { path: item.path, sha256: item.sha256, kind: "text", text: artifact.text });
    } else { requireValid(artifact.kind === "nontext"); exact(artifact, { path: item.path, sha256: item.sha256, kind: "nontext" }); }
  }
  requireValid(total <= 256 * 1024 * 1024);
  const stored = parseGradingJson(run.outcome_json, "outcome"), outcome = validateJudgment(criteria, request.artifacts, stored);
  // Validation canonicalizes Judge text/order; persisted data must ALREADY be canonical.
  exact(stored, outcome); requireValid(run.status === outcome.status);
  const p = validateGradingProvenance(parseGradingJson(run.provenance_json, "provenance"), options, outcome.status === "technical-error");
  const expectedRows = outcome.status === "technical-error" ? [] : outcome.judgments.map(j => ({ grading_id: run.id, criterion_id: j.id, criterion_text: j.text, verdict: j.verdict, rationale: j.rationale, evidence: j.evidence }));
  exact(rows.map(r => ({ grading_id: r.grading_id, criterion_id: r.criterion_id, criterion_text: r.criterion_text, verdict: r.verdict, rationale: r.rationale, evidence: parseGradingJson(r.evidence_json, "evidence") })).sort((a,b) => a.criterion_id.localeCompare(b.criterion_id)), expectedRows.sort((a,b) => a.criterion_id.localeCompare(b.criterion_id)));
  return { id: run.id, campaignId: run.campaign_id, attemptId: run.attempt_id, trialId: run.trial_id, createdAt: run.created_at,
    manifestDigest: run.manifest_digest, evidenceDigest: run.evidence_digest, requestDigest: run.request_digest, status: outcome.status, outcome, provenance: p,
    verification: { storedBindings: "validated", archives: "not-reverified" } };
}
/** Coherent readonly snapshot of runs and criterion rows. No archive access, initialization,
 * migration or Judge construction; historical grades remain readable after archive removal. */
export class SqliteJudgmentHistory implements JudgmentHistory {
  private readonly registry: string;
  constructor(registry: string) { this.registry = resolve(registry); }
  async list(selection: { campaignId: string; attemptId?: string }): Promise<JudgmentRecord[]> {
    if (!uuid.test(selection.campaignId) || (selection.attemptId !== undefined && !uuid.test(selection.attemptId))) throw new EvaluationError("Campaign and attempt selectors must be UUIDs");
    selection = { ...selection };
    try { await inspectExistingRegistry(this.registry, false); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
      throw new EvaluationError("Unable to read stored judgments");
    }
    let db: Database | undefined;
    try {
      db = new Database(this.registry, { readonly: true, create: false });
      db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN;");
      validatePrincipalRegistry(db); validateGradingExtension(db, false);
      if (!db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='grading_runs'").get()) { db.exec("COMMIT"); return []; }
      const runs = selection.attemptId === undefined
        ? db.query<Run, [string]>("SELECT * FROM grading_runs WHERE campaign_id=? ORDER BY created_at,id").all(selection.campaignId)
        : db.query<Run, [string,string]>("SELECT * FROM grading_runs WHERE campaign_id=? AND attempt_id=? ORDER BY created_at,id").all(selection.campaignId, selection.attemptId);
      requireValid(runs.length <= 10000);
      const connection = db;
      const records = runs.map(run => readRecord(connection, run, connection.query<JudgmentRow, [string]>("SELECT * FROM judgments WHERE grading_id=? ORDER BY criterion_id").all(run.id)));
      db.exec("COMMIT;"); return records;
    } catch { throw new EvaluationError("Unable to read stored judgments; invalid registry or grading bindings"); }
    finally { db?.close(); }
  }
}
