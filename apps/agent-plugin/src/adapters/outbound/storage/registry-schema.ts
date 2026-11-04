import { canonicalData, type JsonData, validateScenarioImport } from "../../../domain/scenario-import.ts";
import type { EvaluationProfile, Scenario } from "../../../domain/evaluation.ts";
import type { Database } from "./sqlite-database.ts";
import type { EvaluationPlan } from "../../../application/ports/evaluation-store.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profile_revisions(profile_id TEXT NOT NULL REFERENCES profiles(id), revision TEXT NOT NULL,
 snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(profile_id,revision));
CREATE TABLE IF NOT EXISTS experiments(id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, revision TEXT NOT NULL,
 created_at TEXT NOT NULL, output TEXT NOT NULL, plan_json TEXT NOT NULL, method TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('running','completed','interrupted')), finished_at TEXT,
 FOREIGN KEY(profile_id,revision) REFERENCES profile_revisions(profile_id,revision));
CREATE INDEX IF NOT EXISTS experiments_profile_revision ON experiments(profile_id,revision);
CREATE TABLE IF NOT EXISTS planned_trials(campaign_id TEXT NOT NULL REFERENCES experiments(id), trial_id TEXT NOT NULL,
 sequence INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','running','finalized','uncertain')), attempt_id TEXT,
 PRIMARY KEY(campaign_id,trial_id), UNIQUE(campaign_id,sequence));
CREATE TABLE IF NOT EXISTS trials(campaign_id TEXT NOT NULL REFERENCES experiments(id), id TEXT NOT NULL,
 pair_id TEXT NOT NULL, condition TEXT NOT NULL CHECK(condition IN ('with','without')), scenario TEXT NOT NULL,
 target TEXT NOT NULL, status TEXT NOT NULL, collection TEXT NOT NULL, receipt_json TEXT, trial_id TEXT NOT NULL,
 PRIMARY KEY(campaign_id,id), FOREIGN KEY(campaign_id,trial_id) REFERENCES planned_trials(campaign_id,trial_id));
CREATE INDEX IF NOT EXISTS trials_campaign_pair ON trials(campaign_id,pair_id);
CREATE TABLE IF NOT EXISTS artifacts(campaign_id TEXT NOT NULL, trial_id TEXT NOT NULL, path TEXT NOT NULL,
 sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, PRIMARY KEY(campaign_id,trial_id,path),
 FOREIGN KEY(campaign_id,trial_id) REFERENCES trials(campaign_id,id));
CREATE TABLE IF NOT EXISTS campaign_owners(campaign_id TEXT PRIMARY KEY REFERENCES experiments(id), pid INTEGER NOT NULL,
 token TEXT NOT NULL, hostname TEXT NOT NULL);`;

/** Labels and external fixture locations are not revision content. Captured bytes are.
 * Reuse this normalization for insertion and recovery, including historical snapshots
 * that retained labels/locations. This is an internal consistency reference, not
 * cryptographic protection against rewriting both DB payloads together.
 */
export function canonicalProfileRevision(profile: EvaluationProfile): string {
  const { name: _name, ...snapshot } = profile;
  return JSON.stringify(canonicalData({ ...snapshot,
    components: snapshot.components.map(component => ({ ...component, scenarios: component.scenarios.map(canonicalScenario) })),
    scenarios: snapshot.scenarios.map(canonicalScenario),
  } as unknown as JsonData));
}
function canonicalScenario({ fixtures: _fixtures, ...scenario }: Scenario) { return scenario; }

/** Composition changes IDs but preserves content at suite/sourceId provenance.
 * Follow the same first-occurrence union as preparation, without rediscovering sources.
 */
function validateAggregateScenarios(profile: EvaluationProfile): void {
  const originals = new Map<string, Scenario>();
  const provenance = (scenario: Scenario) => JSON.stringify([scenario.suite, scenario.sourceId]);
  for (const component of profile.components) for (const scenario of component.scenarios) {
    const key = provenance(scenario);
    if (!originals.has(key)) originals.set(key, scenario);
  }
  if (originals.size !== profile.scenarios.length) throw new Error("Stored aggregate scenario content mismatch");
  for (const scenario of profile.scenarios) {
    const key = provenance(scenario), original = originals.get(key);
    const content = ({ id: _id, fixtures: _fixtures, ...value }: Scenario) => JSON.stringify(canonicalData(value as unknown as JsonData));
    if (!original || content(scenario) !== content(original)) throw new Error("Stored aggregate scenario content mismatch");
    originals.delete(key);
  }
}

/** Stored snapshots are the only recovery input; never reconstruct from operator source paths. */
export function readStoredPlan(json: string, legacy = false): EvaluationPlan {
  const value = JSON.parse(json);
  if (!value || typeof value !== "object" || ![2, 3].includes(value.schemaVersion) || (!legacy && value.schemaVersion !== 3) ||
    value.status !== "prepared" || !value.profile || typeof value.profile.id !== "string" || typeof value.profile.revision !== "string" ||
    !Array.isArray(value.profile.components) || !Array.isArray(value.profile.scenarios) || !value.options ||
    !Array.isArray(value.options.agents) || !Array.isArray(value.trials) || value.trials.length !== value.candidateRuns) {
    throw new Error("Invalid stored campaign plan");
  }
  for (const [key, minimum] of [["repetitions", 1], ["maxTurns", 1], ["timeout", 0], ["parallelism", 1]] as const) {
    if (!Number.isSafeInteger(value.options[key]) || value.options[key] < minimum) throw new Error("Invalid stored campaign options");
  }
  if (typeof value.profile.name !== "string" || !value.profile.id || !value.profile.revision || !value.options.agents.length ||
    value.options.agents.some((agent: unknown) => typeof agent !== "string") ||
    (value.options.model !== undefined && typeof value.options.model !== "string")) throw new Error("Invalid stored campaign identity/options");
  for (const scenario of value.profile.scenarios) validateScenarioImport(scenario);
  for (const component of value.profile.components) {
    if (!component || !Array.isArray(component.scenarios)) throw new Error("Invalid stored scenario component");
    for (const scenario of component.scenarios) validateScenarioImport(scenario);
  }
  validateAggregateScenarios(value.profile);
  const seen = new Set<string>();
  value.trials.forEach((trial: Record<string, unknown>, index: number) => {
    if (!trial || typeof trial !== "object") throw new Error("Invalid stored logical trial");
    if (legacy && value.schemaVersion === 2) trial.id = `trial-${index + 1}`;
    if (!trial || trial.id !== `trial-${index + 1}` || seen.has(trial.id as string) || typeof trial.pairId !== "string" ||
      !["with", "without"].includes(trial.condition as string) || !value.options.agents.includes(trial.agent) ||
      !value.profile.scenarios.some((scenario: { id: string }) => scenario.id === trial.scenario)) throw new Error("Invalid stored logical trial");
    seen.add(trial.id as string);
  });
  value.schemaVersion = 3;
  return value as EvaluationPlan;
}

/** Rebuild v1 attempt tables to remove pair uniqueness. Migration and all mappings commit together. */
export function initializeRegistry(db: Database): void {
  db.exec("PRAGMA foreign_keys=OFF;");
  try {
    db.transaction(() => {
      const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version;
      const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      if (![0, 1, 2].includes(version ?? -1)) throw new Error("Incompatible evaluation registry schema version");
      if (version === 0 && tables.length) throw new Error("Legacy/unversioned registry requires explicit migration");
      if (version === 1) {
        const required = { profiles: ["id", "name", "created_at", "updated_at"], profile_revisions: ["profile_id", "revision", "snapshot_json", "created_at"],
          experiments: ["id", "profile_id", "revision", "created_at", "output", "plan_json", "method", "status", "finished_at"],
          trials: ["campaign_id", "id", "pair_id", "condition", "scenario", "target", "status", "collection", "receipt_json"], artifacts: ["campaign_id", "trial_id", "path", "sha256", "bytes"] };
        if (tables.length !== 5) throw new Error("Incompatible evaluation registry tables");
        for (const [table, columns] of Object.entries(required)) {
          const actual = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().map((column) => column.name);
          if (JSON.stringify(actual) !== JSON.stringify(columns)) throw new Error("Incompatible evaluation registry columns");
        }
        db.exec("ALTER TABLE trials RENAME TO legacy_trials; ALTER TABLE artifacts RENAME TO legacy_artifacts; DROP INDEX trials_campaign_pair;");
        db.exec(SCHEMA);
        for (const campaign of db.query<{ id: string; plan_json: string }, []>("SELECT id,plan_json FROM experiments").all()) {
          const plan = readStoredPlan(campaign.plan_json, true);
          for (const [index, trial] of plan.trials.entries()) {
            const old = db.query<{ id: string; status: string; pair_id: string; condition: string; scenario: string; target: string }, [string, string]>("SELECT * FROM legacy_trials WHERE campaign_id=? AND id=?").get(campaign.id, `${campaign.id}-${index + 1}`);
            if (old && (old.pair_id !== trial.pairId || old.condition !== trial.condition || old.scenario !== trial.scenario || old.target !== plan.profile.id)) throw new Error("Legacy trial identity mismatch");
            db.query("INSERT INTO planned_trials VALUES(?,?,?,?,?)").run(campaign.id, trial.id, index, old ? old.status === "running" ? "running" : "finalized" : "pending", old?.id ?? null);
            if (old) db.query("INSERT INTO trials SELECT campaign_id,id,pair_id,condition,scenario,target,status,collection,receipt_json,? FROM legacy_trials WHERE campaign_id=? AND id=?").run(trial.id, campaign.id, old.id);
          }
          db.query("UPDATE experiments SET plan_json=? WHERE id=?").run(JSON.stringify(plan), campaign.id);
        }
        const oldCount = db.query<{n: number}, []>("SELECT count(*) AS n FROM legacy_trials").get()?.n;
        const mappedCount = db.query<{n: number}, []>("SELECT count(*) AS n FROM trials").get()?.n;
        if (oldCount !== mappedCount) throw new Error("Unmapped legacy attempt");
        db.exec("INSERT INTO artifacts SELECT * FROM legacy_artifacts; DROP TABLE legacy_artifacts; DROP TABLE legacy_trials;");
      } else db.exec(SCHEMA);
      if (db.query("PRAGMA foreign_key_check").all().length) throw new Error("Invalid registry relationships");
      db.exec("PRAGMA user_version=2;");
    }).immediate();
  } finally { db.exec("PRAGMA foreign_keys=ON;"); }
}
