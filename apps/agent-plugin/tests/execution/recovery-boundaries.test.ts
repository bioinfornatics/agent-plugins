import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemEvaluationSource } from "../../src/adapters/outbound/filesystem/filesystem-evaluation-source.ts";
import { SqliteEvaluationStore } from "../../src/adapters/outbound/storage/sqlite-evaluation-store.ts";
import type { EvaluationPlan } from "../../src/application/ports/evaluation-store.ts";
import { prepareEvaluation } from "../../src/application/use-cases/prepare-evaluation.ts";
import type { TrialRequest, TrialResult } from "../../src/domain/execution.ts";

// Exact schema retained from c219701, not reconstructed from the migration implementation.
const V1_SCHEMA = `
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
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "recovery-boundaries-"));
  roots.push(root);
  const target = join(root, "skill");
  await mkdir(join(target, "evals"), { recursive: true, mode: 0o700 });
  await writeFile(join(target, "SKILL.md"), "captured capability");
  await writeFile(join(target, "evals", "evals.json"), JSON.stringify({ evals: [{ id: 1, prompt: "task", expectations: ["criterion"] }] }));
  const plan = await prepareEvaluation({ skills: [target], plugins: [], agents: ["goose"], repetitions: 1, maxTurns: 5, timeout: 0, parallelism: 2 }, new FilesystemEvaluationSource());
  const registry = join(root, "registry", "evaluation.sqlite");
  return { root, target, plan, registry, store: () => new SqliteEvaluationStore(join(root, "proofs"), registry) };
}
function request(plan: EvaluationPlan): TrialRequest {
  const trial = plan.trials[0], scenario = plan.profile.scenarios[0];
  if (!trial || !scenario) throw new Error("Missing fixture trial");
  return { id: randomUUID(), trialId: trial.id, pairId: trial.pairId, agent: trial.agent, condition: trial.condition, profile: plan.profile, scenario, options: plan.options };
}
async function legacyFixture() {
  const fixture = await setup();
  const id = randomUUID(), output = join(fixture.root, "proofs", id);
  await mkdir(output, { recursive: true, mode: 0o700 });
  await mkdir(join(fixture.root, "registry"), { mode: 0o700 });
  const legacyPlan = { ...fixture.plan, schemaVersion: 2, trials: fixture.plan.trials.map(({ id: _id, ...trial }) => trial) };
  const db = new Database(fixture.registry);
  try {
    db.exec(V1_SCHEMA);
    db.exec("PRAGMA user_version=1; PRAGMA foreign_keys=ON;");
    const profile = fixture.plan.profile;
    db.query("INSERT INTO profiles VALUES(?,?,?,?)").run(profile.id, profile.name, "start", "start");
    db.query("INSERT INTO profile_revisions VALUES(?,?,?,?)").run(profile.id, profile.revision, JSON.stringify(profile), "start");
    db.query("INSERT INTO experiments VALUES(?,?,?,?,?,?,?,?,?)").run(id, profile.id, profile.revision, "start", output, JSON.stringify(legacyPlan), "paired-sequential-v1", "interrupted", "end");
    for (const [index, trial] of fixture.plan.trials.entries()) {
      db.query("INSERT INTO trials VALUES(?,?,?,?,?,?,?,?,?)").run(id, `${id}-${index + 1}`, trial.pairId, trial.condition, trial.scenario, profile.id, index === 0 ? "completed" : "running", index === 0 ? "complete" : "unavailable", null);
    }
    const receipt: Omit<TrialResult, "artifacts"> = { status: "completed", collection: "complete", exitCode: 0, sessionName: `${id}-1`, host: { id: "goose", version: "fixture" }, startedAt: "start", finishedAt: "end", limitations: [] };
    const bytes = Buffer.from("verified legacy evidence");
    const artifact = { path: "output.txt", sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
    const proof = join(output, "artifacts", `${id}-1`);
    await mkdir(proof, { recursive: true, mode: 0o700 });
    await writeFile(join(proof, artifact.path), bytes, { mode: 0o600 });
    await writeFile(join(proof, "manifest.json"), JSON.stringify([artifact]), { mode: 0o600 });
    db.query("UPDATE trials SET receipt_json=? WHERE id=?").run(JSON.stringify(receipt), `${id}-1`);
    db.query("INSERT INTO artifacts VALUES(?,?,?,?,?)").run(id, `${id}-1`, artifact.path, artifact.sha256, artifact.bytes);
  } finally { db.close(); }
  await chmod(fixture.registry, 0o600);
  return { ...fixture, id, output };
}
function inspect<T>(registry: string, operation: (db: Database) => T): T {
  const db = new Database(registry, { readonly: true });
  try { return operation(db); } finally { db.close(); }
}
function mutate(registry: string, operation: (db: Database) => void) {
  const db = new Database(registry);
  try { operation(db); } finally { db.close(); }
}

// Migration persists independently of retry consent; old attempt IDs remain evidence selectors.
test("v1 finalized/running attempts migrate durably and verified evidence maps to logical trials", async () => {
  const f = await legacyFixture();
  expect((await stat(f.registry)).mode & 0o777).toBe(0o600);
  expect((await stat(join(f.root, "registry"))).mode & 0o777).toBe(0o700);
  await rm(f.target, { recursive: true });
  await expect(f.store().resume(f.id, false)).rejects.toThrow("--retry-uncertain");
  inspect(f.registry, db => {
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 2 });
    expect(db.query("SELECT trial_id,status,attempt_id FROM planned_trials ORDER BY sequence").all()).toEqual([
      { trial_id: "trial-1", status: "finalized", attempt_id: `${f.id}-1` },
      { trial_id: "trial-2", status: "uncertain", attempt_id: `${f.id}-2` },
    ]);
    const row = db.query<{ plan_json: string }, []>("SELECT plan_json FROM experiments").get();
    expect(JSON.parse(row?.plan_json ?? "null")).toEqual(f.plan);
    expect(db.query("SELECT t.id,t.trial_id,a.path FROM trials t JOIN artifacts a ON a.campaign_id=t.campaign_id AND a.trial_id=t.id").all()).toEqual([{ id: `${f.id}-1`, trial_id: "trial-1", path: "output.txt" }]);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  const recovered = f.store();
  try {
    const resumed = await recovered.resume(f.id, true);
    expect(resumed.completed).toBe(1);
    expect(resumed.failed).toBe(0);
    expect(resumed.pending).toEqual(["trial-2"]);
  } finally { await recovered.close(); }
  expect(inspect(f.registry, db => db.query("SELECT id,status FROM trials ORDER BY id").all())).toEqual([
    { id: `${f.id}-1`, status: "completed" }, { id: `${f.id}-2`, status: "interrupted" },
  ]);
  // The legacy exception omits checkpoint.json, but must still hash the actual artifact bytes.
  expect(await readdir(join(f.output, "artifacts", `${f.id}-1`))).toEqual(["manifest.json", "output.txt"]);
  await writeFile(join(f.output, "artifacts", `${f.id}-1`, "output.txt"), "corrupt");
  await expect(f.store().resume(f.id, true)).rejects.toThrow("integrity mismatch");
});

for (const fault of ["malformed", "unmapped"] as const) {
  test(`v1 ${fault} migration rolls back tables, plan and schema version`, async () => {
    const f = await legacyFixture();
    mutate(f.registry, db => {
      if (fault === "malformed") db.query("UPDATE experiments SET plan_json=?").run("{broken");
      else db.query("UPDATE trials SET id=? WHERE id=?").run(`${f.id}-99`, `${f.id}-2`);
    });
    const before = await readFile(f.registry);
    const beforeRows = inspect(f.registry, db => db.query("SELECT * FROM trials ORDER BY id").all());
    const beforePlan = inspect(f.registry, db => db.query("SELECT plan_json FROM experiments").get());
    await expect(f.store().resume(f.id, true)).rejects.toThrow(fault === "unmapped" ? "Unmapped legacy attempt" : undefined);
    expect(await readFile(f.registry)).toEqual(before);
    inspect(f.registry, db => {
      expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 1 });
      expect(db.query("SELECT * FROM trials ORDER BY id").all()).toEqual(beforeRows);
      expect(db.query("SELECT plan_json FROM experiments").get()).toEqual(beforePlan);
      expect(db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()).toEqual(["artifacts", "experiments", "profile_revisions", "profiles", "trials"].map(name => ({ name })));
    });
  });
}

for (const owner of [{ pid: process.pid, hostname: "foreign-host.invalid" }, { pid: 0, hostname: hostname() }, { pid: -1, hostname: hostname() }, { pid: 1.5, hostname: hostname() }]) {
  test(`ownership refuses host=${owner.hostname} pid=${owner.pid} without changing its row`, async () => {
    const f = await setup(), first = f.store(), campaign = await first.begin(f.plan);
    await first.close();
    const token = randomUUID();
    mutate(f.registry, db => { db.query("INSERT INTO campaign_owners VALUES(?,?,?,?)").run(campaign.id, owner.pid, token, owner.hostname); });
    const before = inspect(f.registry, db => db.query("SELECT * FROM experiments").get());
    await expect(f.store().resume(campaign.id, true)).rejects.toThrow("another or unknown host");
    inspect(f.registry, db => {
      expect(db.query("SELECT pid,hostname,token FROM campaign_owners").get()).toEqual({ ...owner, token });
      expect(db.query("SELECT * FROM experiments").get()).toEqual(before);
      expect(db.query("SELECT status FROM planned_trials").all()).toEqual([{ status: "pending" }, { status: "pending" }]);
    });
  });
}

test("stale token prevents trial admission and close cannot update campaign or delete replacement owner", async () => {
  const f = await setup(), first = f.store(), campaign = await first.begin(f.plan);
  const replacement = randomUUID();
  mutate(f.registry, db => { db.query("UPDATE campaign_owners SET token=?").run(replacement); });
  const before = inspect(f.registry, db => db.query("SELECT * FROM experiments").get());
  await expect(first.start(request(f.plan))).rejects.toThrow("ownership lost");
  await expect(first.close()).rejects.toThrow("ownership lost");
  inspect(f.registry, db => {
    expect(db.query("SELECT token FROM campaign_owners").get()).toEqual({ token: replacement });
    expect(db.query("SELECT * FROM experiments").get()).toEqual(before);
    expect(db.query("SELECT * FROM trials").all()).toEqual([]);
    expect(db.query("SELECT status,attempt_id FROM planned_trials").all()).toEqual([{ status: "pending", attempt_id: null }, { status: "pending", attempt_id: null }]);
  });
  expect(await readdir(campaign.output)).toEqual([]);
});

test("EPERM liveness probe fails closed without signalling a live process", async () => {
  const f = await setup(), first = f.store(), campaign = await first.begin(f.plan);
  await first.close();
  const token = randomUUID();
  mutate(f.registry, db => { db.query("INSERT INTO campaign_owners VALUES(?,?,?,?)").run(campaign.id, process.pid, token, hostname()); });
  const originalKill = process.kill;
  const probes: unknown[][] = [];
  // No real syscall: even signal zero is intercepted; restore before another test can run.
  process.kill = ((pid: number, signal?: string | number) => {
    probes.push([pid, signal]);
    throw Object.assign(new Error("Permission denied probe"), { code: "EPERM" });
  }) as typeof process.kill;
  try { await expect(f.store().resume(campaign.id, true)).rejects.toMatchObject({ code: "EPERM" }); }
  finally { process.kill = originalKill; }
  expect(probes).toEqual([[process.pid, 0]]);
  inspect(f.registry, db => {
    expect(db.query("SELECT token FROM campaign_owners").get()).toEqual({ token });
    expect(db.query("SELECT status FROM experiments").get()).toEqual({ status: "interrupted" });
    expect(db.query("SELECT * FROM trials").all()).toEqual([]);
  });
});

test("stale token prevents evidence publication and finalization of an already running attempt", async () => {
  const f = await setup(), first = f.store(), campaign = await first.begin(f.plan);
  const trial = request(f.plan);
  await first.start(trial);
  const replacement = randomUUID();
  mutate(f.registry, db => { db.query("UPDATE campaign_owners SET token=?").run(replacement); });
  const before = inspect(f.registry, db => db.query("SELECT * FROM trials").all());
  const result: TrialResult = { status: "completed", collection: "complete", exitCode: 0, sessionName: trial.id, host: { id: "goose", version: "fixture" }, startedAt: "start", finishedAt: "end", limitations: [], artifacts: [{ path: "output.txt", content: Buffer.from("must not publish") }] };
  await expect(first.finish(trial, result)).rejects.toThrow("ownership lost");
  await expect(first.close()).rejects.toThrow("ownership lost");
  inspect(f.registry, db => {
    expect(db.query("SELECT * FROM trials").all()).toEqual(before);
    expect(db.query("SELECT * FROM artifacts").all()).toEqual([]);
    expect(db.query("SELECT token FROM campaign_owners").get()).toEqual({ token: replacement });
    expect(db.query("SELECT status FROM experiments").get()).toEqual({ status: "running" });
  });
  expect(await readdir(campaign.output)).toEqual([]);
});
