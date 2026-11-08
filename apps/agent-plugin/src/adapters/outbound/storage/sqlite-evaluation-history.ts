import type { CampaignOverviewHistory, CampaignOverviewSnapshot } from "../../../application/ports/campaign-overview-history.ts";
import { inspectExistingRegistry, validatePrincipalRegistry, projectScenarioSource } from "./sqlite-verified-attempt.ts";
import { validateGradingJsonBytes } from "./grading-serialization.ts";
import { Database } from "./sqlite-database.ts";
import { lstat } from "node:fs/promises";
import { join, resolve, parse, sep } from "node:path";
import type { CampaignInspection, CampaignSummary, EvaluationHistory } from "../../../application/ports/evaluation-history.ts";
import { EvaluationError } from "../../../domain/evaluation.ts";
import { safeArtifactPath } from "./registry-files.ts";
import { canonicalProfileRevision, readStoredPlan } from "./registry-schema.ts";

interface CampaignRow { id: string; profile_id: string; revision: string; created_at: string; output: string; status: string; plan_json: string }
function missing(error: unknown) { return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT"; }
async function inspectPath(path: string): Promise<boolean> {
  const absolute = resolve(path); let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new EvaluationError("History paths must not contain symbolic links"); }
    catch (error) { if (missing(error)) return false; throw error; }
  }
  return true;
}

/** New readonly connection per operation; never calls the write-side schema initializer.
 * v2 is required explicitly: unsupported databases are rejected, not upgraded during inspection.
 */
export class SqliteEvaluationHistory implements EvaluationHistory, CampaignOverviewHistory {
  private readonly registry: string;

  constructor(registry: string) {
    this.registry = registry;
  }
  private async open(): Promise<Database | undefined> {
    if (!await inspectPath(this.registry)) return undefined;
    const info = await lstat(this.registry);
    if (!info.isFile() || info.nlink !== 1) throw new EvaluationError("History registry must be a regular unlinked file");
    const db = new Database(this.registry, { readonly: true, create: false });
    try {
      db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000;");
      if (db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version !== 2) throw new EvaluationError("History requires registry schema v2; consultation does not migrate it");
      return db;
    } catch (error) { db.close(); throw error; }
  }
  private summary(db: Database, row: CampaignRow): CampaignSummary {
    const plan = readStoredPlan(row.plan_json);
    const counts = db.query<{ total: number; finalized: number; uncertain: number }, [string]>("SELECT count(*) AS total,coalesce(sum(status='finalized'),0) AS finalized,coalesce(sum(status='uncertain'),0) AS uncertain FROM planned_trials WHERE campaign_id=?").get(row.id);
    return { id: row.id, profileId: row.profile_id, profileName: plan.profile.name, revision: row.revision,
      createdAt: row.created_at, status: row.status, output: row.output, score: null,
      total: counts?.total ?? 0, finalized: counts?.finalized ?? 0, uncertain: counts?.uncertain ?? 0 };
  }
  async overview(campaignId: string): Promise<CampaignOverviewSnapshot> {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(campaignId)) throw new EvaluationError("Campaign selector must be a UUID");
    // Existing-only registry checks include sidecars; overview never enables WAL or repairs.
    await inspectExistingRegistry(this.registry, false);
    const db = await this.open();
    if (!db) throw new EvaluationError("Unknown campaign");
    try {
      db.exec("BEGIN;");
      validatePrincipalRegistry(db);
      const row = db.query<CampaignRow, [string]>("SELECT * FROM experiments WHERE id=?").get(campaignId);
      if (!row) throw new Error("Unknown campaign");
      validateGradingJsonBytes(row.plan_json, "plan");
      const plan = readStoredPlan(row.plan_json);
      const retained = db.query<{ snapshot_json: string }, [string, string]>("SELECT snapshot_json FROM profile_revisions WHERE profile_id=? AND revision=?").get(row.profile_id, row.revision);
      if (!retained) throw new Error("Missing frozen profile");
      validateGradingJsonBytes(retained.snapshot_json, "snapshot");
      if (plan.profile.id !== row.profile_id || plan.profile.revision !== row.revision || canonicalProfileRevision(JSON.parse(retained.snapshot_json)) !== canonicalProfileRevision(plan.profile)) throw new Error("Frozen profile mismatch");
      const logical = db.query<{ trial_id: string; sequence: number; status: string; attempt_id: string | null }, [string]>("SELECT * FROM planned_trials WHERE campaign_id=? ORDER BY sequence").all(campaignId);
      if (logical.length !== plan.trials.length || logical.some((t, index) => t.sequence !== index || t.trial_id !== plan.trials[index]?.id)) throw new Error("Frozen logical mapping mismatch");
      const trials = logical.map(t => {
        const trial = plan.trials[t.sequence], scenario = plan.profile.scenarios.find(s => s.id === trial?.scenario);
        if (!trial || !scenario || !Number.isSafeInteger(trial.repetition) || trial.repetition < 1 || trial.repetition > plan.options.repetitions || !["pending", "running", "finalized", "uncertain"].includes(t.status)) throw new Error("Invalid frozen trial");
        const attempt = t.attempt_id === null ? null : db.query<{ trial_id: string; pair_id: string; scenario: string; target: string; condition: string; status: string }, [string, string]>("SELECT * FROM trials WHERE campaign_id=? AND id=?").get(campaignId, t.attempt_id);
        if ((t.status === "pending") !== (t.attempt_id === null) || (t.attempt_id !== null && (!attempt || attempt.trial_id !== trial.id || attempt.pair_id !== trial.pairId || attempt.scenario !== trial.scenario || attempt.target !== plan.profile.id || attempt.condition !== trial.condition || !["running", "completed", "nonzero", "timeout", "interrupted", "unavailable"].includes(attempt.status)))) throw new Error("Invalid logical attempt binding");
        // Recovery can leave an uncertain row with its unreconciled running attempt.
        // Imported historical finalized unavailable attempts remain metadata, never scores.
        if ((t.status === "running" && attempt?.status !== "running") || (t.status === "uncertain" && !["running", "interrupted"].includes(attempt?.status ?? "")) || (t.status === "finalized" && !["completed", "nonzero", "timeout", "unavailable"].includes(attempt?.status ?? ""))) throw new Error("Invalid logical status binding");
        const source = projectScenarioSource({ id: t.attempt_id ?? "pending", trialId: trial.id, pairId: trial.pairId, agent: trial.agent, condition: trial.condition, profile: plan.profile, scenario, options: plan.options });
        if ([source.skillName, ...(source.pluginName === undefined ? [] : [source.pluginName])].some(name => !name.trim() || name !== name.trim() || /[/\\:]/.test(name) || [...name].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))) throw new Error("Invalid frozen source name");
        return { trialId: trial.id, sequence: t.sequence, scenarioId: scenario.id, source, agent: trial.agent, repetition: trial.repetition, pairId: trial.pairId, condition: trial.condition, status: t.status, attemptId: t.attempt_id, attemptStatus: attempt?.status ?? null };
      });
      db.exec("COMMIT;");
      return { campaignId, profile: { id: plan.profile.id, name: plan.profile.name, revision: plan.profile.revision }, options: plan.options, trials };
    } catch { throw new EvaluationError("Unable to read campaign overview; invalid frozen plan or logical bindings"); }
    finally { db.close(); }
  }
  async list(profileId?: string): Promise<CampaignSummary[]> {
    const db = await this.open(); if (!db) return [];
    try {
      const rows = profileId === undefined
        ? db.query<CampaignRow, []>("SELECT * FROM experiments ORDER BY created_at DESC,id").all()
        : db.query<CampaignRow, [string]>("SELECT * FROM experiments WHERE profile_id=? ORDER BY created_at DESC,id").all(profileId);
      return rows.map(row => this.summary(db, row));
    } finally { db.close(); }
  }
  async inspect(campaignId: string): Promise<CampaignInspection> {
    const db = await this.open();
    if (!db) throw new EvaluationError(`Unknown campaign: ${campaignId}`);
    try {
      const row = db.query<CampaignRow, [string]>("SELECT * FROM experiments WHERE id=?").get(campaignId);
      if (!row) throw new EvaluationError(`Unknown campaign: ${campaignId}`);
      const summary = this.summary(db, row), plan = readStoredPlan(row.plan_json);
      const trials = db.query<{ trial_id: string; sequence: number; status: string; attempt_id: string | null }, [string]>("SELECT * FROM planned_trials WHERE campaign_id=? ORDER BY sequence").all(campaignId)
        .map(trial => ({ id: trial.trial_id, sequence: trial.sequence, status: trial.status, attemptId: trial.attempt_id }));
      const attempts = [];
      for (const attempt of db.query<{ id: string; trial_id: string; condition: string; scenario: string; status: string; collection: string; receipt_json: string | null }, [string]>("SELECT * FROM trials WHERE campaign_id=? ORDER BY trial_id,id").all(campaignId)) {
        safeArtifactPath(attempt.id);
        const evidence = [];
        for (const artifact of db.query<{ path: string; sha256: string; bytes: number }, [string, string]>("SELECT path,sha256,bytes FROM artifacts WHERE campaign_id=? AND trial_id=? ORDER BY path").all(campaignId, attempt.id)) {
          safeArtifactPath(artifact.path);
          const path = join(row.output, "artifacts", attempt.id, artifact.path);
          const exists = await inspectPath(path);
          const available = exists && (await lstat(path)).isFile();
          evidence.push({ ...artifact, path, available });
        }
        attempts.push({ id: attempt.id, trialId: attempt.trial_id, condition: attempt.condition, scenario: attempt.scenario,
          status: attempt.status, collection: attempt.collection, receipt: attempt.receipt_json ? JSON.parse(attempt.receipt_json) : null, evidence });
      }
      return { ...summary, options: plan.options, trials, attempts };
    } finally { db.close(); }
  }
}
