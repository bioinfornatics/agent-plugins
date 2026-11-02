import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { EvaluationPlan, EvaluationStore } from "../../../application/ports/evaluation-store.ts";
import type { TrialRequest, TrialResult } from "../../../domain/execution.ts";
import { prepareRegistryFile, registryDirectory, safeArtifactPath } from "./registry-files.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profile_revisions(profile_id TEXT NOT NULL REFERENCES profiles(id), revision TEXT NOT NULL,
  snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(profile_id,revision));
CREATE TABLE IF NOT EXISTS experiments(id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, revision TEXT NOT NULL,
  created_at TEXT NOT NULL, output TEXT NOT NULL, plan_json TEXT NOT NULL, method TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','completed','interrupted')), finished_at TEXT,
  FOREIGN KEY(profile_id,revision) REFERENCES profile_revisions(profile_id,revision));
CREATE INDEX IF NOT EXISTS experiments_profile_revision ON experiments(profile_id,revision);
CREATE TABLE IF NOT EXISTS trials(campaign_id TEXT NOT NULL REFERENCES experiments(id), id TEXT NOT NULL,
  pair_id TEXT NOT NULL, condition TEXT NOT NULL CHECK(condition IN ('with','without')), scenario TEXT NOT NULL,
  target TEXT NOT NULL, status TEXT NOT NULL, collection TEXT NOT NULL, receipt_json TEXT,
  PRIMARY KEY(campaign_id,id), UNIQUE(campaign_id,pair_id,condition));
CREATE INDEX IF NOT EXISTS trials_campaign_pair ON trials(campaign_id,pair_id);
CREATE TABLE IF NOT EXISTS artifacts(campaign_id TEXT NOT NULL, trial_id TEXT NOT NULL, path TEXT NOT NULL,
  sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, PRIMARY KEY(campaign_id,trial_id,path),
  FOREIGN KEY(campaign_id,trial_id) REFERENCES trials(campaign_id,id));`;

/** SQLite indexes host-redacted evidence. Filesystem publication and DB commits are not atomic;
 * pending/unindexed trees remain explicit evidence orphans on failure, with no recovery claim.
 */
export class SqliteEvaluationStore implements EvaluationStore {
  private db?: Database;
  private output?: string;
  private campaignId?: string;
  private plan?: EvaluationPlan;
  private stopped = false;
  private completed = false;
  constructor(private readonly destination: string, private readonly registryPath: string) {}

  async begin(plan: EvaluationPlan) {
    if (this.db || this.campaignId || this.stopped) throw new Error("Store already initialized or closed");
    const id = randomUUID();
    const output = join(resolve(this.destination), id);
    try {
      const registry = await prepareRegistryFile(this.registryPath);
      await registryDirectory(resolve(this.destination), false);
      await mkdir(output, { mode: 0o700 });
      await registryDirectory(output, true);
      const db = new Database(registry, { create: false, readwrite: true });
      this.db = db;
      // A proposed default, not a measured concurrency SLA. DELETE avoids persistent WAL/SHM files.
      db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
      const journal = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode;
      if (journal !== "delete") throw new Error("Registry requires DELETE journal mode");
      db.exec("PRAGMA journal_mode=DELETE;");
      this.initializeRegistry(db);
      db.transaction(() => this.insertCampaign(db, id, output, plan)).immediate();
      this.campaignId = id; this.output = output; this.plan = plan;
      return { id, output, registry };
    } catch (error) {
      this.stopped = true;
      try { this.db?.close(); } finally { this.db = undefined; }
      throw error;
    }
  }

  private initializeRegistry(db: Database): void {
    db.transaction(() => {
      const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version;
      const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      if (version !== 0 && version !== 1) throw new Error("Incompatible evaluation registry schema version");
      if (version === 0 && tables.length) throw new Error("Legacy/unversioned registry requires explicit migration");
      if (version === 1) {
        const required = { profiles: ["id", "name", "created_at", "updated_at"], profile_revisions: ["profile_id", "revision", "snapshot_json", "created_at"],
          experiments: ["id", "profile_id", "revision", "created_at", "output", "plan_json", "method", "status", "finished_at"],
          trials: ["campaign_id", "id", "pair_id", "condition", "scenario", "target", "status", "collection", "receipt_json"], artifacts: ["campaign_id", "trial_id", "path", "sha256", "bytes"] };
        if (tables.length !== Object.keys(required).length) throw new Error("Incompatible evaluation registry tables");
        for (const [table, columns] of Object.entries(required)) {
          const actual = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().map((column) => column.name);
          if (JSON.stringify(actual) !== JSON.stringify(columns)) throw new Error("Incompatible evaluation registry columns");
        }
      }
      db.exec(SCHEMA);
      db.exec("PRAGMA user_version=1;");
    }).immediate();
  }

  private insertCampaign(db: Database, id: string, output: string, plan: EvaluationPlan): void {
    const now = new Date().toISOString();
    const profile = plan.profile;
    // Labels can change without rewriting the evaluated revision; captured bytes remain in JSON/base64.
    const { name: _name, ...snapshot } = profile;
    // External fixture locations are campaign provenance, not content revision identity.
    // Keep them in plan_json, but compare revision payloads using the captured fixture bytes.
    const canonicalScenario = ({ fixtures: _fixtures, ...scenario }: EvaluationPlan["profile"]["scenarios"][number]) => scenario;
    const snapshotJson = JSON.stringify({ ...snapshot,
      components: snapshot.components.map((component) => ({ ...component, scenarios: component.scenarios.map(canonicalScenario) })),
      scenarios: snapshot.scenarios.map(canonicalScenario),
    });
    const previous = db.query<{ snapshot_json: string }, [string, string]>("SELECT snapshot_json FROM profile_revisions WHERE profile_id=? AND revision=?").get(profile.id, profile.revision);
    if (previous && previous.snapshot_json !== snapshotJson) throw new Error("Immutable profile revision content conflict");
    db.query("INSERT INTO profiles VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at").run(profile.id, profile.name, now, now);
    db.query("INSERT INTO profile_revisions VALUES(?,?,?,?) ON CONFLICT(profile_id,revision) DO NOTHING").run(profile.id, profile.revision, snapshotJson, now);
    db.query("INSERT INTO experiments VALUES(?,?,?,?,?,?,?,?,?)").run(id, profile.id, profile.revision, now, output, JSON.stringify(plan), "paired-sequential-v1", "running", null);
  }

  async start(request: TrialRequest) {
    try {
      const db = this.admittingDatabase();
      this.validateRequest(request);
      db.query("INSERT INTO trials VALUES(?,?,?,?,?,?,?,?,?)").run(this.campaign(), request.id, request.pairId, request.condition,
        request.scenario.id, request.profile.id, "running", "unavailable", null);
    } catch (error) { this.stopped = true; throw error; }
  }

  async finish(request: TrialRequest, result: TrialResult) {
    try {
      const db = this.runningTrial(request);
      const root = this.output;
      if (!root) throw new Error("Store not initialized");
      const pending = join(root, `${request.id}.pending`);
      const final = join(root, "artifacts", request.id);
      await mkdir(pending, { mode: 0o700 });
      await registryDirectory(pending, true);
      const manifest: { path: string; sha256: string; bytes: number }[] = [];
      for (const artifact of result.artifacts) {
        safeArtifactPath(artifact.path);
        const path = join(pending, artifact.path);
        await registryDirectory(dirname(path), true);
        await writeFile(path, artifact.content, { flag: "wx", mode: 0o600 });
        manifest.push({ path: artifact.path, sha256: createHash("sha256").update(artifact.content).digest("hex"), bytes: artifact.content.length });
      }
      await writeFile(join(pending, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: "wx" });
      await registryDirectory(dirname(final), true);
      await rename(pending, final);
      const { artifacts: _artifacts, ...receipt } = result;
      db.transaction(() => {
        for (const artifact of manifest) db.query("INSERT INTO artifacts VALUES(?,?,?,?,?)").run(this.campaign(), request.id, artifact.path, artifact.sha256, artifact.bytes);
        db.query("UPDATE trials SET status=?,collection=?,receipt_json=? WHERE campaign_id=? AND id=? AND status='running'")
          .run(result.status, result.collection, JSON.stringify(receipt), this.campaign(), request.id);
      }).immediate();
    } catch (error) { this.stopped = true; throw error; }
  }

  async fail(request: TrialRequest) {
    try {
      this.runningTrial(request).query("UPDATE trials SET status='unavailable',collection='unavailable',receipt_json=? WHERE campaign_id=? AND id=? AND status='running'")
        .run(JSON.stringify({ error: "Host preparation or launch failed; raw diagnostic withheld to avoid exposing credentials" }), this.campaign(), request.id);
    } catch (error) { this.stopped = true; throw error; }
  }

  /** Only the executor's normal return authorizes completion; failed host trials are allowed.
   * close() alone cannot distinguish no trials admitted due to a storage failure from success.
   */
  async complete(): Promise<void> {
    try {
      const db = this.admittingDatabase();
      db.transaction(() => {
        const counts = db.query<{ total: number; running: number }, [string]>("SELECT count(*) AS total,coalesce(sum(status='running'),0) AS running FROM trials WHERE campaign_id=?").get(this.campaign());
        if (!counts || counts.running || counts.total !== this.plan?.candidateRuns) throw new Error("Campaign trials are not all finalized");
        db.query("UPDATE experiments SET status='completed',finished_at=? WHERE id=? AND status='running'").run(new Date().toISOString(), this.campaign());
      }).immediate();
      this.completed = true;
    } catch (error) { this.stopped = true; throw error; }
  }

  async close() {
    const db = this.db;
    try {
      if (db && this.campaignId && !this.completed) db.query("UPDATE experiments SET status='interrupted',finished_at=? WHERE id=? AND status='running'")
        .run(new Date().toISOString(), this.campaign());
    } finally {
      try { db?.close(); } finally { this.db = undefined; this.stopped = true; }
    }
  }

  private campaign(): string {
    if (!this.campaignId) throw new Error("Store not initialized");
    return this.campaignId;
  }
  private admittingDatabase(): Database {
    if (!this.db || !this.campaignId) throw new Error("Store not initialized");
    if (this.stopped || this.completed) throw new Error("Campaign no longer admits writes");
    return this.db;
  }
  private validateRequest(request: TrialRequest): void {
    if (!/^[a-zA-Z0-9_-]+$/.test(request.id)) throw new Error("Unsafe trial id");
    if (request.profile.id !== this.plan?.profile.id || request.profile.revision !== this.plan.profile.revision ||
      !this.plan.trials.some((trial) => trial.pairId === request.pairId && trial.condition === request.condition && trial.scenario === request.scenario.id && trial.agent === request.agent)) {
      throw new Error("Trial does not belong to this campaign plan");
    }
  }
  private runningTrial(request: TrialRequest): Database {
    const db = this.admittingDatabase();
    this.validateRequest(request);
    const trial = db.query<{ status: string; pair_id: string; condition: string }, [string, string]>("SELECT status,pair_id,condition FROM trials WHERE campaign_id=? AND id=?").get(this.campaign(), request.id);
    if (trial?.status !== "running" || trial.pair_id !== request.pairId || trial.condition !== request.condition) throw new Error("Expected an owned running trial");
    return db;
  }
}
