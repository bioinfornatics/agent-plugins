import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { verifyCheckpoint, type CampaignCheckpoint } from "../../src/adapters/outbound/storage/campaign-checkpoint.ts";

test("checkpoint opt-in retention returns precisely hashed bytes, detached from later replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "verified-checkpoint-"));
  try {
    const bytes = Buffer.from("original evidence");
    const expected = { schemaVersion: 1, campaignId: "campaign", attemptId: "attempt", trialId: "trial", request: { agent: "fake", options: { agents: ["fake"] } }, receipt: {
      status: "completed", collection: "complete", exitCode: 0, sessionName: "session", startedAt: "start", finishedAt: "end", host: { id: "fake", version: "1" }, limitations: [],
    } } as unknown as CampaignCheckpoint;
    await writeFile(join(root, "checkpoint.json"), JSON.stringify(expected));
    await writeFile(join(root, "manifest.json"), JSON.stringify([{ path: "answer.txt", sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length }]));
    await writeFile(join(root, "answer.txt"), bytes);
    const metadataOnly = await verifyCheckpoint(root, expected);
    assert.equal("artifacts" in metadataOnly, false, "recovery consumers must not retain aggregate bytes");
    const proof = await verifyCheckpoint(root, expected, undefined, { retainBytes: true });
    await writeFile(join(root, "answer.txt"), "replacement");
    assert.deepEqual(proof.artifacts?.[0]?.content, bytes);
    await assert.rejects(verifyCheckpoint(root, expected), /integrity mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

import { randomUUID } from "node:crypto";
import { mkdir, readFile, symlink } from "node:fs/promises";
import { FilesystemEvaluationSource } from "../../src/adapters/outbound/filesystem/filesystem-evaluation-source.ts";
import { prepareEvaluation } from "../../src/application/use-cases/prepare-evaluation.ts";
import { executeEvaluation } from "../../src/application/use-cases/execute-evaluation.ts";
import { SqliteEvaluationStore } from "../../src/adapters/outbound/storage/sqlite-evaluation-store.ts";
import { SqliteEvaluationHistory } from "../../src/adapters/outbound/storage/sqlite-evaluation-history.ts";
import { SqliteVerifiedAttemptReader } from "../../src/adapters/outbound/storage/sqlite-verified-attempt.ts";
import { SqliteJudgmentStore } from "../../src/adapters/outbound/storage/sqlite-judgment-store.ts";
import { Database } from "../../src/adapters/outbound/storage/sqlite-database.ts";
import { gradeAttempt } from "../../src/application/use-cases/grade-attempt.ts";
import type { CandidateHost } from "../../src/application/ports/candidate-host.ts";
import type { Judge, JudgeRequest, JudgeResult } from "../../src/application/ports/judge.ts";

async function campaign(content = Buffer.from("result"), scenario = { id: 1, prompt: "task", expectations: ["first", "second"], expected_output: "answer" } as object, expandCriteria = false) {
  const root = await mkdtemp(join(tmpdir(), "grading-campaign-"));
  const skill = join(root, "skill");
  await mkdir(join(skill, "evals"), { recursive: true });
  await writeFile(join(skill, "SKILL.md"), "capability");
  await writeFile(join(skill, "evals", "evals.json"), JSON.stringify({ evals: [scenario] }));
  const plan = await prepareEvaluation({ skills: [skill], plugins: [], agents: ["goose"], repetitions: 1, maxTurns: 5, timeout: 0, parallelism: 1 }, new FilesystemEvaluationSource());
  // Exercise the downstream storage ceiling independently of the 4 MiB source-file
  // ingestion ceiling, using a frozen synthetic plan and the real store/reader.
  if (expandCriteria) {
    for (const entry of [...plan.profile.scenarios, ...plan.profile.components.flatMap(component => component.scenarios)]) entry.expectations = ["x".repeat(8 * 1024 * 1024)];
  }
  let candidateRuns = 0;
  const host: CandidateHost = { preflight: async () => {}, run: async request => {
    candidateRuns++;
    return { status: "completed", exitCode: 0, sessionName: request.id, collection: "complete", startedAt: "start", finishedAt: "end", host: { id: "goose", version: "fake" }, artifacts: [{ path: "logs/answer.txt", content }], limitations: [] };
  } };
  const registry = join(root, "registry", "evaluations.sqlite");
  const result = await executeEvaluation(plan, new Map([["goose", host]]), new SqliteEvaluationStore(join(root, "proofs"), registry), randomUUID, undefined, new FilesystemRetainedFixtureIO(new FilesystemEvaluationSource(), locations => new SqliteEvaluationStore(join(locations.candidate, "campaigns"), join(locations.candidate, "registry/evaluations.sqlite")), randomUUID));
  const db = new Database(registry, { readonly: true });
  const attempt = db.query<{ id: string }, [string]>("SELECT id FROM trials WHERE campaign_id=? ORDER BY trial_id LIMIT 1").get(result.id);
  db.close();
  if (!attempt) throw new Error("Missing fixture attempt");
  const selection = { campaignId: result.id, attemptId: attempt.id };
  return { root, registry, selection, output: result.output, evidenceRoot: join(result.output, "artifacts", attempt.id), candidateRuns: () => candidateRuns,
    reader: new SqliteVerifiedAttemptReader(registry), store: new SqliteJudgmentStore(registry), cleanup: () => rm(root, { recursive: true, force: true }) };
}
function judged(request: JudgeRequest): JudgeResult {
  const artifact = request.artifacts.find(entry => entry.kind === "text");
  return { outcome: { status: "completed", judgments: request.criteria.map(criterion => ({ ...criterion, verdict: artifact ? "pass" : "inconclusive", rationale: "inspected",
    evidence: artifact?.kind === "text" ? [{ path: artifact.path, sha256: artifact.sha256, quote: artifact.text }] : [] })) }, provenance: {
      host: { id: "goose", version: "fake" }, model: { ...(request.options?.model === undefined ? {} : { requested: request.options.model }), source: request.options?.model === undefined ? "configuration-default" : "override", effective: "unknown" },
      limits: { maxTurns: 50, timeout: 0, preflightTimeout: 10, exportTimeout: 10, outputBytes: 1024 },
    } };
}
const judge: Judge = { judge: async request => judged(request) };
function mutate(registry: string, operation: (db: Database) => void) {
  const db = new Database(registry, { readwrite: true, create: false });
  try { operation(db); } finally { db.close(); }
}

test("explicit verified attempt grades twice atomically without candidate execution; history stays readonly score null", async () => {
  const f = await campaign();
  try {
    const before = await readFile(f.registry);
    const view = await f.reader.readAttempt(f.selection);
    assert.equal(view.request.task, "task");
    assert.equal(view.request.artifacts[0]?.kind, "text");
    assert.deepEqual(Buffer.from(view.artifacts[0]?.content ?? []), Buffer.from("result"));
    assert.deepEqual(await readFile(f.registry), before);
    const first = await gradeAttempt(f.selection, { ...f, judge, newId: randomUUID });
    const second = await gradeAttempt(f.selection, { ...f, judge, newId: randomUUID }, { model: "override" });
    assert.notEqual(first.id, second.id);
    assert.equal(f.candidateRuns(), 2);
    const db = new Database(f.registry, { readonly: true });
    const runs = db.query<{ id: string; outcome_json: string; request_json: string; request_digest: string; provenance_json: string }, []>("SELECT * FROM grading_runs ORDER BY created_at").all();
    assert.equal(runs.length, 2);
    assert.deepEqual(JSON.parse(runs[0]?.outcome_json ?? "null"), first.result.outcome);
    for (const run of runs) assert.equal(createHash("sha256").update(run.request_json).digest("hex"), run.request_digest);
    assert.equal(JSON.parse(runs[0]?.provenance_json ?? "null").model.source, "configuration-default");
    assert.equal(JSON.parse(runs[1]?.provenance_json ?? "null").model.requested, "override");
    assert.deepEqual(db.query("SELECT count(*) AS n FROM judgments").get(), { n: 4 });
    assert.deepEqual(db.query("PRAGMA user_version").get(), { user_version: 2 });
    assert.deepEqual(db.query("SELECT count(*) AS n FROM campaign_owners").get(), { n: 0 });
    db.close();
    const gradedBytes = await readFile(f.registry);
    const history = new SqliteEvaluationHistory(f.registry);
    assert.equal((await history.list())[0]?.score, null);
    assert.equal((await history.inspect(f.selection.campaignId)).score, null);
    assert.deepEqual(await readFile(f.registry), gradedBytes);
    await assert.rejects(f.store.appendJudgment(first.id, view, first.result), /UNIQUE/);
    for (const table of ["grading_runs", "judgments", "grading_extension"]) for (const operation of ["UPDATE", "DELETE"]) {
      assert.throws(() => mutate(f.registry, db => db.exec(operation === "UPDATE" ? `UPDATE ${table} SET ${table === "grading_runs" ? "status=status" : table === "judgments" ? "verdict=verdict" : "version=version"}` : `DELETE FROM ${table}`)), /append-only/);
    }
  } finally { await f.cleanup(); }
});

test("representative evidence, registry, retained profile and checkpoint corruptions reject before Judge with no writes", async () => {
  const f = await campaign();
  try {
    let calls = 0;
    const dependencies = { ...f, judge: { judge: async (request: JudgeRequest) => { calls++; return judged(request); } }, newId: randomUUID };
    const proofPath = join(f.evidenceRoot, "logs", "answer.txt");
    const checkpointPath = join(f.evidenceRoot, "checkpoint.json");
    const checkpoint = await readFile(checkpointPath);
    await writeFile(proofPath, "corrupt");
    await assert.rejects(gradeAttempt(f.selection, dependencies), /integrity mismatch/);
    await writeFile(proofPath, "result");
    const changed = JSON.parse(checkpoint.toString()); changed.trialId = "wrong";
    await writeFile(checkpointPath, JSON.stringify(changed));
    await assert.rejects(gradeAttempt(f.selection, dependencies), /identity mismatch/);
    await writeFile(checkpointPath, checkpoint);
    mutate(f.registry, db => db.query("UPDATE artifacts SET bytes=999 WHERE campaign_id=? AND trial_id=?").run(f.selection.campaignId, f.selection.attemptId));
    await assert.rejects(gradeAttempt(f.selection, dependencies), /manifest differs/);
    mutate(f.registry, db => db.query("UPDATE artifacts SET bytes=6 WHERE campaign_id=? AND trial_id=?").run(f.selection.campaignId, f.selection.attemptId));
    mutate(f.registry, db => db.query("UPDATE artifacts SET path='../escape' WHERE campaign_id=? AND trial_id=?").run(f.selection.campaignId, f.selection.attemptId));
    await assert.rejects(gradeAttempt(f.selection, dependencies), /Unsafe artifact/);
    mutate(f.registry, db => db.query("UPDATE artifacts SET path='logs/answer.txt' WHERE campaign_id=? AND trial_id=?").run(f.selection.campaignId, f.selection.attemptId));
    mutate(f.registry, db => db.query("UPDATE trials SET receipt_json='{}' WHERE campaign_id=? AND id=?").run(f.selection.campaignId, f.selection.attemptId));
    await assert.rejects(gradeAttempt(f.selection, dependencies), /receipt differs/);
    mutate(f.registry, db => db.query("UPDATE trials SET receipt_json=? WHERE campaign_id=? AND id=?").run(JSON.stringify(JSON.parse(checkpoint.toString()).receipt), f.selection.campaignId, f.selection.attemptId));
    let retained = "";
    mutate(f.registry, db => {
      retained = db.query<{ snapshot_json: string }, []>("SELECT snapshot_json FROM profile_revisions").get()?.snapshot_json ?? "";
      const profile = JSON.parse(retained); profile.scenarios[0].prompt = "changed";
      db.query("UPDATE profile_revisions SET snapshot_json=?").run(JSON.stringify(profile));
    });
    await assert.rejects(gradeAttempt(f.selection, dependencies), /profile content/);
    mutate(f.registry, db => db.query("UPDATE profile_revisions SET snapshot_json=?").run(retained));
    mutate(f.registry, db => db.query("UPDATE trials SET pair_id='wrong' WHERE campaign_id=? AND id=?").run(f.selection.campaignId, f.selection.attemptId));
    await assert.rejects(gradeAttempt(f.selection, dependencies), /attempt identity/);
    assert.equal(calls, 0);
    const db = new Database(f.registry, { readonly: true });
    assert.equal(db.query("SELECT name FROM sqlite_master WHERE name='grading_runs'").get(), null); db.close();
  } finally { await f.cleanup(); }
});

test("Judge receives detached single-read data even if archived file is replaced; forged/mutated snapshots refused", async () => {
  const f = await campaign();
  try {
    const view = await f.reader.readAttempt(f.selection);
    await assert.rejects(f.store.appendJudgment(randomUUID(), structuredClone(view), judged(view.request)), /Unverified/);
    view.request.task = "forged";
    await assert.rejects(f.store.appendJudgment(randomUUID(), view, judged(view.request)), /modified/);
    const result = await gradeAttempt(f.selection, { ...f, newId: randomUUID, judge: { judge: async request => {
      await writeFile(join(f.evidenceRoot, "logs", "answer.txt"), "replacement");
      assert.equal(request.artifacts[0]?.kind === "text" && request.artifacts[0].text, "result");
      return judged(request);
    } } });
    assert.equal(result.result.outcome.status, "completed");
    await assert.rejects(f.reader.readAttempt(f.selection), /integrity mismatch/);
  } finally { await f.cleanup(); }
});

test("frozen metadata race after Judge rejects append; nontext and technical failures never fabricate decisive grades", async () => {
  const f = await campaign(Buffer.from([0xff, 0, 3]));
  try {
    const view = await f.reader.readAttempt(f.selection);
    assert.equal(view.request.artifacts[0]?.kind, "nontext");
    const inconclusive = await gradeAttempt(f.selection, { ...f, judge, newId: randomUUID });
    assert.equal(inconclusive.result.outcome.status === "completed" && inconclusive.result.outcome.judgments[0]?.verdict, "inconclusive");
    const failure = await gradeAttempt(f.selection, { ...f, newId: randomUUID, judge: { judge: async () => { throw new Error("secret diagnostic"); } } });
    assert.deepEqual(failure.result, { outcome: { status: "technical-error", message: "Judge rejected or returned invalid judgment" }, provenance: null });
    const technical = await gradeAttempt(f.selection, { ...f, newId: randomUUID, judge: { judge: async request => ({ ...judged(request), outcome: { status: "technical-error", message: "export unavailable" } }) } });
    assert.equal(technical.result.provenance?.model.source, "configuration-default");
    await assert.rejects(gradeAttempt(f.selection, { ...f, newId: randomUUID, judge: { judge: async request => {
      mutate(f.registry, db => db.query("UPDATE trials SET collection='partial' WHERE campaign_id=? AND id=?").run(f.selection.campaignId, f.selection.attemptId));
      return judged(request);
    } } }), /metadata changed/);
    const db = new Database(f.registry, { readonly: true });
    assert.deepEqual(db.query("SELECT count(*) AS n FROM grading_runs").get(), { n: 3 });
    assert.deepEqual(db.query("SELECT count(*) AS n FROM judgments").get(), { n: 2 }); db.close();
  } finally { await f.cleanup(); }
});

test("partial or altered extension is rejected unchanged; injected constraint failure rolls back run and all criteria", async () => {
  const f = await campaign();
  try {
    const view = await f.reader.readAttempt(f.selection);
    mutate(f.registry, db => db.exec("CREATE TABLE grading_extension(version INTEGER PRIMARY KEY CHECK(version=1)); INSERT INTO grading_extension VALUES(1)"));
    const before = await readFile(f.registry);
    await assert.rejects(f.store.appendJudgment(randomUUID(), view, judged(view.request)), /Malformed grading/);
    assert.deepEqual(await readFile(f.registry), before);
    mutate(f.registry, db => db.exec("DROP TABLE grading_extension"));
    const first = await gradeAttempt(f.selection, { ...f, judge, newId: randomUUID });
    mutate(f.registry, db => db.exec("DROP TRIGGER judgments_no_update; CREATE TRIGGER judgments_no_update BEFORE UPDATE ON judgments BEGIN SELECT 1; END"));
    const altered = await readFile(f.registry);
    await assert.rejects(f.store.appendJudgment(randomUUID(), view, judged(view.request)), /Malformed grading/);
    assert.deepEqual(await readFile(f.registry), altered);
    mutate(f.registry, db => db.exec("DROP TRIGGER judgments_no_update; CREATE TRIGGER judgments_no_update BEFORE UPDATE ON judgments BEGIN SELECT RAISE(ABORT,'Grading is append-only'); END"));
    // Force a second-row failure without altering the schema under validation: a
    // real SQLite trigger is injected at the query seam after extension validation.
    const originalQuery = Database.prototype.query;
    let inserts = 0;
    Database.prototype.query = function(this: Database, sql: string) {
      const query = originalQuery.call(this, sql);
      if (sql === "INSERT INTO judgments VALUES(?,?,?,?,?,?)") {
        return { ...query, run: (...params: Parameters<typeof query.run>) => {
          inserts++;
          if (inserts === 2) return query.run(params[0] ?? null, "criterion-1", ...params.slice(2));
          return query.run(...params);
        } } as ReturnType<typeof originalQuery>;
      }
      return query;
    } as typeof Database.prototype.query;
    try { await assert.rejects(f.store.appendJudgment(randomUUID(), view, judged(view.request)), /UNIQUE/); }
    finally { Database.prototype.query = originalQuery; }
    const db = new Database(f.registry, { readonly: true });
    assert.deepEqual(db.query("SELECT id FROM grading_runs").all(), [{ id: first.id }]);
    assert.deepEqual(db.query("SELECT count(*) AS n FROM judgments").get(), { n: 2 }); db.close();
  } finally { await f.cleanup(); }
});

test("unsafe archive parent and nonfinalized explicit attempt are rejected; reads never create missing registries", async () => {
  const f = await campaign();
  try {
    const link = join(f.root, "linked"); await symlink(f.output, link);
    mutate(f.registry, db => db.query("UPDATE experiments SET output=? WHERE id=?").run(link, f.selection.campaignId));
    await assert.rejects(f.reader.readAttempt(f.selection), /Unsafe/);
    mutate(f.registry, db => {
      db.query("UPDATE experiments SET output=? WHERE id=?").run(f.output, f.selection.campaignId);
      db.query("UPDATE planned_trials SET status='running' WHERE campaign_id=? AND attempt_id=?").run(f.selection.campaignId, f.selection.attemptId);
    });
    await assert.rejects(f.reader.readAttempt(f.selection), /finalized/);
    await assert.rejects(new SqliteVerifiedAttemptReader(join(f.root, "absent", "registry.sqlite")).readAttempt(f.selection), /ENOENT/);
  } finally { await f.cleanup(); }
});

test("store refuses mismatched citations, unsafe options/provenance and invalid UTF8 never becomes text", async () => {
  const f = await campaign(Buffer.from([0xc3, 0x28]));
  try {
    const view = await f.reader.readAttempt(f.selection);
    assert.equal(view.request.artifacts[0]?.kind, "nontext");
    const forged = judged(view.request);
    if (forged.outcome.status !== "completed" || !forged.outcome.judgments[0]) throw new Error("Missing test verdict");
    forged.outcome.judgments[0].verdict = "pass";
    forged.outcome.judgments[0].evidence = [{ path: "logs/answer.txt", sha256: "f".repeat(64), quote: "fake" }];
    await assert.rejects(f.store.appendJudgment(randomUUID(), view, forged), /does not match/);
    await assert.rejects(f.store.appendJudgment(randomUUID(), view, judged(view.request), { timeout: -1 }), /Unsafe/);
    const missingLimits = judged(view.request); missingLimits.provenance.limits = {} as JudgeResult["provenance"]["limits"];
    await assert.rejects(f.store.appendJudgment(randomUUID(), view, missingLimits), /provenance/);
    const db = new Database(f.registry, { readonly: true });
    assert.equal(db.query("SELECT name FROM sqlite_master WHERE name='grading_runs'").get(), null); db.close();
  } finally { await f.cleanup(); }
});

test("writer rejects malformed or noncanonical provenance before DB effects and valid optional fields roundtrip", async () => {
  const f = await campaign();
  try {
    const view = await f.reader.readAttempt(f.selection);
    const invalid: { label: string; change: (p: JudgeResult["provenance"]) => void }[] = [
      { label: "session length", change: p => { p.sessionName = "x".repeat(1025); } },
      { label: "session type", change: p => { Object.assign(p, { sessionName: 1 }); } },
      { label: "digest format", change: p => { p.instructionsSha256 = "A".repeat(64); } },
      { label: "digest type", change: p => { Object.assign(p, { instructionsSha256: 1 }); } },
      { label: "version type", change: p => { Object.assign(p.host, { version: 1 }); } },
      { label: "host id", change: p => { Object.assign(p.host, { id: "codex" }); } },
      { label: "root field", change: p => { Object.assign(p, { extra: true }); } },
      { label: "host field", change: p => { Object.assign(p.host, { extra: true }); } },
      { label: "model field", change: p => { Object.assign(p.model, { extra: true }); } },
      { label: "limits field", change: p => { Object.assign(p.limits, { extra: true }); } },
      { label: "model mismatch", change: p => { p.model.requested = "other"; } },
      { label: "limit mismatch", change: p => { p.limits.maxTurns = 1; } },
    ];
    const ungraded = await readFile(f.registry);
    for (const entry of invalid) {
      const result = judged(view.request); entry.change(result.provenance);
      await assert.rejects(f.store.appendJudgment(randomUUID(), view, result), /provenance/, entry.label);
      assert.deepEqual(await readFile(f.registry), ungraded, entry.label);
    }
    const valid = judged(view.request);
    valid.provenance.sessionName = "x".repeat(1024);
    valid.provenance.instructionsSha256 = "a".repeat(64);
    valid.provenance.model = { source: "override", requested: "custom model", effective: "unknown" };
    valid.provenance.limits.maxTurns = 7; valid.provenance.limits.timeout = 3;
    const stored = await f.store.appendJudgment(randomUUID(), view, valid, { model: "custom model", maxTurns: 7, timeout: 3 });
    const graded = await readFile(f.registry);
    assert.deepEqual((await new SqliteJudgmentHistory(f.registry).list(f.selection)).map(r => r.provenance), [stored.result.provenance]);
    assert.deepEqual(stored.result.provenance, valid.provenance);
    assert.deepEqual(await readFile(f.registry), graded);
    const unknown = judged(view.request); Object.assign(unknown.provenance, { extra: true });
    await assert.rejects(f.store.appendJudgment(randomUUID(), view, unknown), /provenance/);
    assert.deepEqual(await readFile(f.registry), graded, "reject without altering existing grades");
  } finally { await f.cleanup(); }
});

test("live candidate ownership does not block or mutate readonly verification; selectors detach before awaits", async () => {
  const f = await campaign();
  try {
    mutate(f.registry, db => db.query("INSERT INTO campaign_owners VALUES(?,?,?,?)").run(f.selection.campaignId, process.pid, "owner-token", "other-host"));
    const before = await readFile(f.registry);
    const selection = { ...f.selection };
    const pending = f.reader.readAttempt(selection);
    selection.attemptId = "redirected";
    const view = await pending;
    assert.equal(view.attemptId, f.selection.attemptId);
    assert.deepEqual(await readFile(f.registry), before);
    const pendingAppend = f.store.appendJudgment(randomUUID(), view, judged(view.request));
    view.campaignId = "redirected";
    const graded = await pendingAppend;
    const db = new Database(f.registry, { readonly: true });
    assert.deepEqual(db.query("SELECT campaign_id FROM grading_runs WHERE id=?").get(graded.id), { campaign_id: f.selection.campaignId });
    assert.deepEqual(db.query("SELECT token FROM campaign_owners").get(), { token: "owner-token" }); db.close();
  } finally { await f.cleanup(); }
});

test("full extension with altered columns and unsupported version fails exact validation without modification", async () => {
  const f = await campaign();
  try {
    const view = await f.reader.readAttempt(f.selection);
    await gradeAttempt(f.selection, { ...f, judge, newId: randomUUID });
    mutate(f.registry, db => db.exec("ALTER TABLE judgments ADD COLUMN unexpected TEXT"));
    const before = await readFile(f.registry);
    await assert.rejects(f.store.appendJudgment(randomUUID(), view, judged(view.request)), /Malformed grading/);
    await assert.rejects(f.reader.readAttempt(f.selection), /Malformed grading/);
    assert.deepEqual(await readFile(f.registry), before);
    mutate(f.registry, db => db.exec("ALTER TABLE judgments DROP COLUMN unexpected"));
    mutate(f.registry, db => db.exec("DROP TABLE grading_extension; CREATE TABLE grading_extension(version INTEGER PRIMARY KEY CHECK(version=2)); INSERT INTO grading_extension VALUES(2); CREATE TRIGGER grading_extension_no_update BEFORE UPDATE ON grading_extension BEGIN SELECT RAISE(ABORT,'Grading is append-only'); END; CREATE TRIGGER grading_extension_no_delete BEFORE DELETE ON grading_extension BEGIN SELECT RAISE(ABORT,'Grading is append-only'); END"));
    const versioned = await readFile(f.registry);
    await assert.rejects(f.store.appendJudgment(randomUUID(), view, judged(view.request)), /Malformed grading/);
    assert.deepEqual(await readFile(f.registry), versioned);
  } finally { await f.cleanup(); }
});

test("extension FK target is validated, not only column and trigger names", async () => {
  const f = await campaign();
  try {
    const view = await f.reader.readAttempt(f.selection);
    await gradeAttempt(f.selection, { ...f, judge, newId: randomUUID });
    mutate(f.registry, db => {
      const definition = db.query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE name='judgments'").get()?.sql;
      if (!definition) throw new Error("Missing schema fixture");
      db.exec("DROP TABLE judgments");
      db.exec(definition.replace("REFERENCES grading_runs(id)", "REFERENCES profiles(id)"));
      db.exec("CREATE TRIGGER judgments_no_update BEFORE UPDATE ON judgments BEGIN SELECT RAISE(ABORT,'Grading is append-only'); END; CREATE TRIGGER judgments_no_delete BEFORE DELETE ON judgments BEGIN SELECT RAISE(ABORT,'Grading is append-only'); END");
    });
    const before = await readFile(f.registry);
    await assert.rejects(f.store.appendJudgment(randomUUID(), view, judged(view.request)), /Malformed grading/);
    assert.deepEqual(await readFile(f.registry), before);
  } finally { await f.cleanup(); }
});

import { SqliteJudgmentHistory } from "../../src/adapters/outbound/storage/sqlite-judgment-history.ts";
import { createGradingCommandHandler, createJudgmentsCommandHandler, type GradingInput } from "../../src/adapters/inbound/cli/handle-grading-command.ts";
import { EvaluationError } from "../../src/domain/evaluation.ts";
import { main } from "../../src/main.ts";
import { GooseJudge } from "../../src/adapters/outbound/judge/goose-judge.ts";
import { access } from "node:fs/promises";

function cliOutput() {
  let stdout = "", stderr = "";
  return { writeOut: (text: string) => { stdout += text; }, writeErr: (text: string) => { stderr += text; }, stdout: () => stdout, stderr: () => stderr, clear: () => { stdout = ""; stderr = ""; } };
}
function gradingInput(f: Awaited<ReturnType<typeof campaign>>): GradingInput {
  return { ...f.selection, registry: f.registry, json: true, agent: "goose", maxTurns: 50, timeout: 0 };
}
test("CLI handlers append fresh grades with lazy Judge, exact override/defaults and allowlisted readonly history", async () => {
  // BOM is part of hashed retained UTF-8 bytes, not presentation decoration.
  const f = await campaign(Buffer.from("\uFEFFresult"));
  try {
    const output = cliOutput(); let factories = 0, calls = 0;
    const requests: JudgeRequest[] = [];
    const handler = createGradingCommandHandler(output, { createReader: () => f.reader, createStore: () => f.store, newId: randomUUID, createJudge: () => {
      factories++;
      return { judge: async request => { calls++; requests.push(structuredClone(request)); return judged(request); } };
    } });
    const beforeCandidates = f.candidateRuns();
    await handler(gradingInput(f)); const first = JSON.parse(output.stdout()); output.clear();
    await handler({ ...gradingInput(f), model: "exact-model" }); const second = JSON.parse(output.stdout()); output.clear();
    assert.notEqual(first.id, second.id); assert.equal(factories, 2); assert.equal(calls, 2);
    assert.equal(f.candidateRuns(), beforeCandidates, "grading must not run candidates");
    assert.deepEqual(requests.map(r => r.options), [{ maxTurns: 50, timeout: 0 }, { model: "exact-model", maxTurns: 50, timeout: 0 }]);
    const bytes = await readFile(f.registry);
    await rm(f.output, { recursive: true, force: true });
    const history = new SqliteJudgmentHistory(f.registry);
    const records = await history.list(f.selection);
    assert.equal(records.length, 2);
    assert.deepEqual(new Set(records.map(r => r.id)), new Set([first.id, second.id]));
    assert.deepEqual(records[0]?.verification, { storedBindings: "validated", archives: "not-reverified" });
    assert.deepEqual(Object.keys(records[0] ?? {}).sort(), ["id", "campaignId", "attemptId", "trialId", "createdAt", "manifestDigest", "evidenceDigest", "requestDigest", "status", "outcome", "provenance", "verification"].sort());
    assert.equal(JSON.stringify(records).includes('"artifacts"'), false);
    const read = createJudgmentsCommandHandler(output, () => history);
    await read({ ...f.selection, json: false }); assert.match(output.stdout(), /pass 2; fail 0; inconclusive 0/); output.clear();
    await read({ ...f.selection, json: true }); assert.deepEqual(JSON.parse(output.stdout()), records);
    assert.deepEqual(await readFile(f.registry), bytes, "consultation must be byte-for-byte readonly");
    output.clear();
    assert.equal(await main(["judgments", f.selection.campaignId, "--attempt", f.selection.attemptId, "--registry", f.registry, "--json"], output), 0);
    assert.deepEqual(JSON.parse(output.stdout()), records);
    assert.equal(output.stderr(), "");
    assert.equal((await new SqliteEvaluationHistory(f.registry).list())[0]?.score, null);
  } finally { await f.cleanup(); }
});

test("invalid command selectors/agent/model/limits reject before factories; corrupt proofs before lazy Judge", async () => {
  const f = await campaign();
  try {
    const output = cliOutput(); let readerFactories = 0, storeFactories = 0, judgeFactories = 0;
    const handler = createGradingCommandHandler(output, { createReader: () => { readerFactories++; return f.reader; }, createStore: () => { storeFactories++; return f.store; }, createJudge: () => { judgeFactories++; return judge; }, newId: randomUUID });
    for (const invalid of [{ campaignId: "secret selector" }, { attemptId: "../bad" }, { agent: "claude" }, { agent: "codex" }, { model: " " }, { maxTurns: 0 }, { maxTurns: 1.5 }, { timeout: -1 }, { timeout: 2147484 }, { maxTurns: Number.MAX_SAFE_INTEGER + 1 }]) {
      await assert.rejects(handler({ ...gradingInput(f), ...invalid }), EvaluationError);
    }
    assert.equal(readerFactories + storeFactories + judgeFactories, 0);
    await writeFile(join(f.evidenceRoot, "logs", "answer.txt"), "SECRET corrupted");
    const before = await readFile(f.registry);
    await assert.rejects(handler(gradingInput(f)), error => error instanceof EvaluationError && !error.message.includes("SECRET"));
    assert.equal(judgeFactories, 0); assert.deepEqual(await readFile(f.registry), before);
    output.clear();
    const status = await main(["grading", f.selection.campaignId, "--attempt", f.selection.attemptId, "--registry", f.registry, "--agent", "codex"], output);
    assert.equal(status, 1); assert.match(output.stderr(), /only goose/); assert.equal(output.stdout(), "");
  } finally { await f.cleanup(); }
});

test("technical command failure is persisted and JSON printed before nonzero error; inconclusive is not failure or a binary score", async () => {
  const f = await campaign(Buffer.from([0xff]));
  try {
    const output = cliOutput();
    const handler = createGradingCommandHandler(output, { createReader: () => f.reader, createStore: () => f.store, createJudge: () => ({ judge: async () => { throw new Error("private SQL credential"); } }), newId: randomUUID });
    await assert.rejects(handler(gradingInput(f)), /technical failure recorded/);
    const technical = JSON.parse(output.stdout());
    assert.equal(technical.outcome.status, "technical-error"); assert.equal(output.stdout().includes("credential"), false); output.clear();
    const inconclusive = createGradingCommandHandler(output, { createReader: () => f.reader, createStore: () => f.store, createJudge: () => judge, newId: randomUUID });
    await inconclusive({ ...gradingInput(f), json: false });
    assert.match(output.stdout(), /pass 0; fail 0; inconclusive 2/); assert.doesNotMatch(output.stdout(), /score|rate/);
    const records = await new SqliteJudgmentHistory(f.registry).list(f.selection);
    assert.equal(records.length, 2); assert.equal(records.filter(r => r.status === "technical-error").length, 1);
    output.clear();
    const originalJudge = GooseJudge.prototype.judge;
    GooseJudge.prototype.judge = async () => { throw new Error("PRIVATE transport diagnostic"); };
    try {
      assert.equal(await main(["grading", f.selection.campaignId, "--attempt", f.selection.attemptId, "--registry", f.registry, "--json"], output), 1);
      assert.equal(JSON.parse(output.stdout()).outcome.status, "technical-error");
      assert.match(output.stderr(), /Judge technical failure recorded/);
      assert.doesNotMatch(output.stdout() + output.stderr(), /PRIVATE/);
    } finally { GooseJudge.prototype.judge = originalJudge; }
    const db = new Database(f.registry, { readonly: true });
    assert.deepEqual(db.query("SELECT count(*) AS n FROM judgments WHERE grading_id=?").get(technical.id), { n: 0 }); db.close();
  } finally { await f.cleanup(); }
});

test("absent registry/extension consultation creates nothing and main reports grading absence without raw diagnostics", async () => {
  const f = await campaign();
  try {
    const absent = join(f.root, "absent", "registry.sqlite"), output = cliOutput();
    assert.deepEqual(await new SqliteJudgmentHistory(absent).list(f.selection), []);
    await assert.rejects(access(join(f.root, "absent")), /ENOENT/);
    const bytes = await readFile(f.registry);
    assert.deepEqual(await new SqliteJudgmentHistory(f.registry).list(f.selection), []);
    assert.deepEqual(await readFile(f.registry), bytes);
    assert.equal(await main(["judgments", f.selection.campaignId, "--registry", absent, "--json"], output), 0);
    assert.equal(output.stdout(), "[]\n"); output.clear();
    assert.equal(await main(["grading", f.selection.campaignId, "--attempt", f.selection.attemptId, "--registry", absent, "--json"], output), 1);
    assert.equal(output.stdout(), ""); assert.match(output.stderr(), /Unable to grade verified attempt/); assert.doesNotMatch(output.stderr(), /ENOENT|SQL|registry.sqlite/);
    await assert.rejects(access(join(f.root, "absent")), /ENOENT/);
    const legacy = join(f.root, "legacy.sqlite"), db = new Database(legacy, { create: true });
    db.exec("PRAGMA user_version=1"); db.close();
    const legacyBytes = await readFile(legacy);
    await assert.rejects(new SqliteJudgmentHistory(legacy).list(f.selection), EvaluationError);
    assert.deepEqual(await readFile(legacy), legacyBytes, "consultation never migrates schema v1");
  } finally { await f.cleanup(); }
});

test("readonly grading corruption table fails closed without repairing rows or canonicalizing forged text", async () => {
  const cases: { label: string; corrupt: (db: Database, id: string) => void }[] = [
    { label: "stored criterion text", corrupt: (db,id) => {
      const row = db.query<{ outcome_json: string }, [string]>("SELECT outcome_json FROM grading_runs WHERE id=?").get(id);
      const outcome = JSON.parse(row?.outcome_json ?? "null"); outcome.judgments[0].text = "forged frozen text";
      db.query("UPDATE grading_runs SET outcome_json=? WHERE id=?").run(JSON.stringify(outcome), id);
    } },
    { label: "request digest", corrupt: (db,id) => db.query("UPDATE grading_runs SET request_digest=? WHERE id=?").run("f".repeat(64), id) },
    { label: "manifest digest", corrupt: (db,id) => db.query("UPDATE grading_runs SET manifest_digest=? WHERE id=?").run("f".repeat(64), id) },
    { label: "evidence digest shape", corrupt: (db,id) => db.query("UPDATE grading_runs SET evidence_digest='invalid' WHERE id=?").run(id) },
    { label: "criterion row mismatch", corrupt: (db,id) => db.query("UPDATE judgments SET rationale='other' WHERE grading_id=?").run(id) },
    { label: "missing criterion row", corrupt: (db,id) => db.query("DELETE FROM judgments WHERE grading_id=? AND criterion_id='criterion-1'").run(id) },
    { label: "bad JSON", corrupt: (db,id) => db.query("UPDATE grading_runs SET provenance_json='{' WHERE id=?").run(id) },
    { label: "provenance override", corrupt: (db,id) => db.query("UPDATE grading_runs SET provenance_json=json_set(provenance_json,'$.model.source','override','$.model.requested','forged') WHERE id=?").run(id) },
    { label: "provenance limit mismatch", corrupt: (db,id) => db.query("UPDATE grading_runs SET provenance_json=json_set(provenance_json,'$.limits.maxTurns',1) WHERE id=?").run(id) },
    { label: "technical state with surplus criterion rows", corrupt: (db,id) => db.query("UPDATE grading_runs SET status='technical-error',outcome_json=? WHERE id=?").run(JSON.stringify({ status: "technical-error", message: "failure" }), id) },
    { label: "unsupported provenance host", corrupt: (db,id) => db.query("UPDATE grading_runs SET provenance_json=json_set(provenance_json,'$.host.id','codex') WHERE id=?").run(id) },
    { label: "candidate link", corrupt: (db,id) => db.query("UPDATE grading_runs SET attempt_id=? WHERE id=?").run(randomUUID(), id) },
    { label: "request frozen task despite recomputed digest", corrupt: (db,id) => {
      const row = db.query<{ request_json: string }, [string]>("SELECT request_json FROM grading_runs WHERE id=?").get(id);
      const request = JSON.parse(row?.request_json ?? "null"); request.task = "forged task";
      const text = JSON.stringify(request); db.query("UPDATE grading_runs SET request_json=?,request_digest=? WHERE id=?").run(text, createHash("sha256").update(text).digest("hex"), id);
    } },
    { label: "wrong trial relationship", corrupt: (db,id) => db.query("UPDATE grading_runs SET trial_id='wrong' WHERE id=?").run(id) },
    { label: "criteria frozen plan mismatch", corrupt: (db,id) => db.query("UPDATE grading_runs SET criteria_json='[]' WHERE id=?").run(id) },
    { label: "retained text hash despite recomputed request digest", corrupt: (db,id) => {
      const row = db.query<{ request_json: string }, [string]>("SELECT request_json FROM grading_runs WHERE id=?").get(id);
      const request = JSON.parse(row?.request_json ?? "null"); request.artifacts[0].text = "forged text";
      const text = JSON.stringify(request); db.query("UPDATE grading_runs SET request_json=?,request_digest=? WHERE id=?").run(text, createHash("sha256").update(text).digest("hex"), id);
    } },
  ];
  const f = await campaign();
  try {
    const grading = await gradeAttempt(f.selection, { ...f, judge, newId: randomUUID });
    const pristine = await readFile(f.registry);
    for (const entry of cases) {
      await writeFile(f.registry, pristine);
      mutate(f.registry, db => {
        // Deliberately inject hostile persisted relationships; ordinary writes enforce FK.
        db.exec("PRAGMA foreign_keys=OFF; DROP TRIGGER grading_runs_no_update; DROP TRIGGER judgments_no_update; DROP TRIGGER judgments_no_delete;");
        entry.corrupt(db, grading.id);
        db.exec("CREATE TRIGGER grading_runs_no_update BEFORE UPDATE ON grading_runs BEGIN SELECT RAISE(ABORT,'Grading is append-only'); END; CREATE TRIGGER judgments_no_update BEFORE UPDATE ON judgments BEGIN SELECT RAISE(ABORT,'Grading is append-only'); END; CREATE TRIGGER judgments_no_delete BEFORE DELETE ON judgments BEGIN SELECT RAISE(ABORT,'Grading is append-only'); END;");
      });
      const corrupted = await readFile(f.registry);
      await assert.rejects(new SqliteJudgmentHistory(f.registry).list(f.selection), EvaluationError, entry.label);
      assert.deepEqual(await readFile(f.registry), corrupted, entry.label);
    }
    await writeFile(f.registry, pristine);
    mutate(f.registry, db => db.exec("DROP TRIGGER grading_runs_no_update; CREATE TRIGGER grading_runs_no_update BEFORE UPDATE ON grading_runs BEGIN SELECT 1; END"));
    await assert.rejects(new SqliteJudgmentHistory(f.registry).list(f.selection), EvaluationError, "altered extension must not be repaired");
  } finally { await f.cleanup(); }
});


test("9 MiB legacy-sized judgment survives append and readonly history without rewriting records", async () => {
  const f = await campaign();
  try {
    const largeJudge: Judge = { judge: async request => {
      const result = judged(request);
      if (result.outcome.status === "completed" && result.outcome.judgments[0]) result.outcome.judgments[0].rationale = "x".repeat(9 * 1024 * 1024);
      return result;
    } };
    const stored = await gradeAttempt(f.selection, { ...f, judge: largeJudge, newId: randomUUID });
    const before = await readFile(f.registry);
    const records = await new SqliteJudgmentHistory(f.registry).list(f.selection);
    assert.deepEqual(records.map(r => r.outcome), [stored.result.outcome]);
    assert.deepEqual(await readFile(f.registry), before);
  } finally { await f.cleanup(); }
});

test("encoded outcome ceiling is inclusive and oversized appends leave existing and fresh registries byte-identical", async () => {
  const f = await campaign();
  try {
    const view = await f.reader.readAttempt(f.selection);
    const result = judged(view.request);
    assert.equal(result.outcome.status, "completed");
    if (result.outcome.status !== "completed" || !result.outcome.judgments[0]) throw new Error("Missing fixture judgment");
    const first = result.outcome.judgments[0];
    first.rationale = 'é"\n'.repeat(100);
    const ceiling = 16 * 1024 * 1024;
    const padding = ceiling - Buffer.byteLength(JSON.stringify(result.outcome));
    first.rationale += "x".repeat(padding);
    assert.equal(Buffer.byteLength(JSON.stringify(result.outcome)), ceiling);
    first.rationale += "x";
    const ungraded = await readFile(f.registry);
    await assert.rejects(f.store.appendJudgment(randomUUID(), view, result), /outcome exceeds JSON byte bound/);
    assert.deepEqual(await readFile(f.registry), ungraded, "reject before grading extension creation");
    first.rationale = first.rationale.slice(0, -1);
    const stored = await f.store.appendJudgment(randomUUID(), view, result);
    const before = await readFile(f.registry);
    assert.deepEqual((await new SqliteJudgmentHistory(f.registry).list(f.selection)).map(r => r.outcome), [stored.result.outcome]);
    assert.deepEqual(await readFile(f.registry), before);
    first.rationale += "é";
    await assert.rejects(f.store.appendJudgment(randomUUID(), view, result), /outcome exceeds JSON byte bound/);
    assert.deepEqual(await readFile(f.registry), before, "reject without altering old grades");
    const oversizedProvenance = judged(view.request);
    oversizedProvenance.provenance.host.version = '"'.repeat(8 * 1024 * 1024);
    await assert.rejects(f.store.appendJudgment(randomUUID(), view, oversizedProvenance), /provenance exceeds JSON byte bound/);
    assert.deepEqual(await readFile(f.registry), before);
  } finally { await f.cleanup(); }
});

test("actual fake-Goose transport stores and reads a 9 MiB rationale within its 16 MiB export ceiling", async () => {
  const f = await campaign();
  try {
    const original = join(f.root, "original"); await mkdir(original);
    await writeFile(join(original, "config.yaml"), "GOOSE_MODEL: fake\n");
    const executable = join(f.root, "fake-judge.mjs");
    await writeFile(executable, `#!${process.execPath}
import {readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
const args=process.argv.slice(2),base=process.env.XDG_CONFIG_HOME ? process.env.HOME : process.env.ORIGINAL;
if(process.env.GOOSE_PATH_ROOT !== undefined)throw Error('non-native path override');
const config=process.env.XDG_CONFIG_HOME?join(process.env.XDG_CONFIG_HOME,'goose','config.yaml'):join(process.env.ORIGINAL,'config.yaml');
if(args[0]==='info')console.log('Version: fake-1\\nConfig yaml: '+config+'\\nSessions DB: '+join(process.env.XDG_DATA_HOME||base,'goose','sessions','sessions.db')+'\\nLogs dir: '+join(process.env.XDG_STATE_HOME||base,'goose','logs'));
else if(args.includes('--help'))console.log('--instructions --name --max-turns --quiet --output-format --model --no-profile --with-extension stream-json --format json');
else if(args[0]==='run'){if(readFileSync(0).length)throw Error('stdin must be empty');writeFileSync(join(base,'prompt'),readFileSync(args[args.indexOf('--instructions')+1]));writeFileSync(join(base,'instructions'),args[args.indexOf('--instructions')+1]);writeFileSync(join(base,'name'),args[args.indexOf('--name')+1]);}
else if(args[0]==='session'){
if(readFileSync(join(base,'name'),'utf8')!==args[args.indexOf('--name')+1])throw Error('name mismatch');
const prompt=readFileSync(join(base,'prompt'),'utf8'),packet=JSON.parse(prompt.split('JUDGMENT PACKET:\\n')[1]),evidence=join(readFileSync(join(base,'instructions'),'utf8'),'..','evidence'),a=JSON.parse(readFileSync(join(evidence,'manifest.json'),'utf8')).artifacts[0];
const outcome={status:'completed',judgments:packet.assertions.map((c,i)=>({...c,verdict:'pass',rationale:i===0?'x'.repeat(9*1024*1024):'observed',evidence:[{path:a.path,sha256:a.sha256,quote:readFileSync(join(evidence,a.path),'utf8')}]}))};
console.log(JSON.stringify({messages:[{role:'user',content:prompt},{role:'assistant',content:JSON.stringify(outcome)}]}));
}`, { mode: 0o700 });
    const fakeJudge = new GooseJudge({ instructionWriter: new FilesystemJudgeInstructionWriter(), executable, tempRoot: f.root, env: { ORIGINAL: original } });
    const stored = await gradeAttempt(f.selection, { ...f, judge: fakeJudge, newId: randomUUID });
    assert.equal(stored.result.outcome.status, "completed", JSON.stringify(stored.result));
    const bytes = await readFile(f.registry);
    assert.deepEqual((await new SqliteJudgmentHistory(f.registry).list(f.selection)).map(r => r.outcome), [stored.result.outcome]);
    assert.deepEqual(await readFile(f.registry), bytes);
  } finally { await f.cleanup(); }
});

import { FilesystemJudgeInstructionWriter } from "../../src/adapters/outbound/storage/judge-instruction-files.ts";
import { legacyJudgmentPacket } from "../../src/adapters/outbound/judge/legacy-judgment-packet.ts";
import { judgmentPacket } from "../../src/adapters/outbound/judge/judgment-packet.ts";

test("grade ID precedes judging; persistent instructions bind campaign/attempt and history remains readable without archives", async () => {
  const f = await campaign();
  try {
    const id = randomUUID();
    let retainedPath = "";
    const stored = await gradeAttempt(f.selection, { ...f, newId: () => id, judge: { judge: async request => {
      assert.deepEqual(request.instructionLocation, { path: join(f.output, "judging", id, "instructions.txt"), gradeId: id, ...f.selection });
      const artifact = await new FilesystemJudgeInstructionWriter().write(request.instructionLocation, legacyJudgmentPacket(request).instructions);
      retainedPath = artifact.path;
      assert.ok(!legacyJudgmentPacket(request).instructions.includes(id));
      return { ...judged(request), provenance: { ...judged(request).provenance, instructionArtifact: artifact, instructionsSha256: artifact.sha256 } };
    } } });
    assert.equal(stored.id, id);
    assert.equal(stored.result.provenance?.instructionArtifact?.path, retainedPath);
    const historical = await gradeAttempt(f.selection, { ...f, judge, newId: randomUUID });
    await rm(join(f.output, "judging"), { recursive: true });
    await rm(f.evidenceRoot, { recursive: true });
    const records = await new SqliteJudgmentHistory(f.registry).list(f.selection);
    assert.equal(records.length, 2);
    assert.equal(records.find(record => record.id === id)?.provenance?.instructionArtifact?.path, retainedPath);
    assert.equal(records.find(record => record.id === historical.id)?.provenance?.instructionArtifact, undefined);
    assert.equal(f.candidateRuns(), 2);
    mutate(f.registry, db => {
      const provenance = structuredClone(stored.result.provenance);
      assert.ok(provenance?.instructionArtifact);
      provenance.instructionArtifact.path = "/arbitrary/script.sh";
      db.exec("DROP TRIGGER grading_runs_no_update");
      db.query("UPDATE grading_runs SET provenance_json=? WHERE id=?").run(JSON.stringify(provenance), id);
      db.exec("CREATE TRIGGER grading_runs_no_update BEFORE UPDATE ON grading_runs BEGIN SELECT RAISE(ABORT,'Grading is append-only'); END");
    });
    await assert.rejects(new SqliteJudgmentHistory(f.registry).list(f.selection), /Unable to read/);
  } finally { await f.cleanup(); }
});

test("append rejects mismatched grade/campaign/attempt/hash and changed instruction bytes without a grading extension", async () => {
  const f = await campaign();
  try {
    const attempt = await f.reader.readAttempt(f.selection), id = randomUUID();
    const location = await f.store.prepareInstructions(id, attempt);
    const artifact = await new FilesystemJudgeInstructionWriter().write(location, legacyJudgmentPacket(attempt.request).instructions);
    const response = judged(attempt.request);
    const result = { ...response, provenance: { ...response.provenance, instructionArtifact: artifact, instructionsSha256: artifact.sha256 } };
    for (const patch of [{ gradeId: randomUUID() }, { campaignId: randomUUID() }, { attemptId: randomUUID() }, { path: "/arbitrary/script" }, { sha256: "b".repeat(64) }]) {
      await assert.rejects(f.store.appendJudgment(id, attempt, { ...result, provenance: { ...result.provenance, instructionArtifact: { ...artifact, ...patch } } }), /binding|provenance/);
    }
    const changed = { ...artifact, sha256: "b".repeat(64) };
    await assert.rejects(f.store.appendJudgment(id, attempt, { ...result, provenance: { ...result.provenance, instructionArtifact: changed, instructionsSha256: changed.sha256 } }), /packet mismatch/);
    await writeFile(artifact.path, "changed bytes");
    await assert.rejects(f.store.appendJudgment(id, attempt, result), /integrity mismatch/);
    const db = new Database(f.registry, { readonly: true });
    try { assert.equal(db.query("SELECT name FROM sqlite_master WHERE name='grading_runs'").get(), null); }
    finally { db.close(); }
  } finally { await f.cleanup(); }
});

test("storage preparation fault persists technical failure without constructing judge", async () => {
  const f = await campaign();
  try {
    let constructed = false;
    const id = randomUUID();
    const result = await gradeAttempt(f.selection, { reader: f.reader, newId: () => id,
      createJudge: () => { constructed = true; return judge; },
      store: { prepareInstructions: async () => { throw new Error("private diagnostic"); }, appendJudgment: f.store.appendJudgment.bind(f.store) } });
    assert.equal(constructed, false);
    assert.equal(result.id, id);
    assert.equal(result.result.outcome.status, "technical-error");
    assert.equal(result.result.provenance, null);
  } finally { await f.cleanup(); }
});

import { FilesystemRetainedFixtureIO } from "../../src/adapters/outbound/filesystem/retained-fixture-io.ts";

test("prepared task history authenticates persisted proof after all archives disappear and rejects recomputed task/binding tampering", async () => {
  const f = await campaign(Buffer.from("result"), { id: 1, prompt: "Inspect {{fixture.registry_path}} campaign {{fixture.campaign_id}}", expectations: ["first"], preparation: { kind: "retained-evaluation", version: 1, campaign: "completed" } });
  try {
    const stored = await gradeAttempt(f.selection, { ...f, newId: randomUUID, judge: { judge: async request => {
      assert.ok(request.instructionLocation);
      assert.ok(!request.task.includes("{{fixture."));
      const artifact = await new FilesystemJudgeInstructionWriter().write(request.instructionLocation, legacyJudgmentPacket(request).instructions);
      const result = judged(request);
      return { ...result, provenance: { ...result.provenance, instructionArtifact: artifact, instructionsSha256: artifact.sha256 } };
    } } });
    await rm(f.output, { recursive: true });
    const history = new SqliteJudgmentHistory(f.registry);
    assert.equal((await history.list(f.selection))[0]?.id, stored.id);
    const db = new Database(f.registry, { readonly: true });
    const original = db.query<{ request_json: string }, [string]>("SELECT request_json FROM grading_runs WHERE id=?").get(stored.id)?.request_json;
    db.close(); assert.ok(original);
    for (const change of ["task", "binding", "identity", "receipt"] as const) {
      const request = JSON.parse(original);
      if (change === "task") request.task = "arbitrary expanded task";
      else if (change === "binding") request.preparation.bindings.campaign_id = randomUUID();
      else if (change === "identity") request.preparation.locations.candidate = "/arbitrary/candidate";
      else {
        request.preparation.bindings.campaign_id = randomUUID();
        request.preparation.task = request.task = `Inspect ${request.preparation.bindings.registry_path} campaign ${request.preparation.bindings.campaign_id}`;
      }
      const encoded = JSON.stringify(request);
      mutate(f.registry, connection => {
        connection.exec("DROP TRIGGER IF EXISTS grading_runs_no_update");
        connection.query("UPDATE grading_runs SET request_json=?,request_digest=? WHERE id=?").run(encoded, createHash("sha256").update(encoded).digest("hex"), stored.id);
        if (change === "receipt") {
          const receipt = connection.query<{ receipt_json: string }, [string]>("SELECT receipt_json FROM trials WHERE id=?").get(f.selection.attemptId);
          assert.ok(receipt);
          connection.query("UPDATE trials SET receipt_json=? WHERE id=?").run(JSON.stringify({ ...JSON.parse(receipt.receipt_json), preparationDigest: createHash("sha256").update(JSON.stringify(request.preparation)).digest("hex") }), f.selection.attemptId);
        }
      });
      await assert.rejects(history.list(f.selection), /Unable to read/);
    }
  } finally { await f.cleanup(); }
});

test("immutable criteria overflow below packet limit refuses before instruction writes or judge construction", async () => {
  const f = await campaign(Buffer.from("result"), { id: 1, prompt: "task", expectations: ["seed"] }, true);
  try {
    const attempt = await f.reader.readAttempt(f.selection);
    assert.throws(() => judgmentPacket(attempt.request), /packet size limit/);
    const before = await readFile(f.registry);
    let constructed = false;
    await assert.rejects(gradeAttempt(f.selection, { ...f, newId: randomUUID, createJudge: () => {
      constructed = true;
      return { judge: async request => {
        assert.ok(request.instructionLocation);
        await new FilesystemJudgeInstructionWriter().write(request.instructionLocation, legacyJudgmentPacket(request).instructions);
        return judged(request);
      } };
    } }), /criteria exceeds JSON byte bound/);
    assert.equal(constructed, false);
    await assert.rejects(readFile(join(f.output, "judging")), { code: "ENOENT" });
    assert.deepEqual(await readFile(f.registry), before);
  } finally { await f.cleanup(); }
});

// Real source capture + registry reader: these bytes are scenario inputs, not candidate artifacts.
async function frozenInputCampaign(archivePath = "logs/answer.txt") {
  const root = await mkdtemp(join(tmpdir(), "frozen-input-grade-"));
  const skill = join(root, "skill"), workspace = join(root, "candidate");
  await mkdir(join(skill, "evals"), { recursive: true });
  await mkdir(workspace);
  await writeFile(join(skill, "SKILL.md"), "capability");
  await writeFile(join(skill, "evals", "input.txt"), "original input\n");
  await writeFile(join(skill, "evals", "evals.json"), JSON.stringify({ evals: [{ id: 1, prompt: "inspect input", expectations: ["input is original"], files: ["evals/input.txt"] }] }));
  const plan = await prepareEvaluation({ skills: [skill], plugins: [], agents: ["goose"], repetitions: 1, maxTurns: 5, timeout: 0, parallelism: 1 }, new FilesystemEvaluationSource());
  const host: CandidateHost = { preflight: async () => {}, run: async request => {
    await mkdir(join(workspace, "evals"), { recursive: true });
    await writeFile(join(workspace, "evals", "input.txt"), Buffer.from(request.scenario.fixturesFiles?.[0]?.content ?? "", "base64"));
    await writeFile(join(workspace, "evals", "input.txt"), "candidate replacement");
    return { status: "completed", exitCode: 0, sessionName: request.id, collection: "complete", startedAt: "start", finishedAt: "end", host: { id: "goose", version: "fake" }, artifacts: [{ path: "logs/z.txt", content: Buffer.from("second output") }, { path: archivePath, content: Buffer.from("candidate output") }], limitations: [] };
  } };
  const registry = join(root, "registry", "evaluations.sqlite");
  const result = await executeEvaluation(plan, new Map([["goose", host]]), new SqliteEvaluationStore(join(root, "proofs"), registry), randomUUID);
  const db = new Database(registry, { readonly: true });
  const attempt = db.query<{ id: string }, [string]>("SELECT id FROM trials WHERE campaign_id=? LIMIT 1").get(result.id);
  db.close(); assert.ok(attempt);
  await writeFile(join(skill, "evals", "input.txt"), "source replacement");
  return { root, registry, output: result.output, selection: { campaignId: result.id, attemptId: attempt.id }, reader: new SqliteVerifiedAttemptReader(registry), store: new SqliteJudgmentStore(registry), cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("frozen inputs survive source/candidate mutation and input-only citations roundtrip without archives", async () => {
  const f = await frozenInputCampaign();
  try {
    const view = await f.reader.readAttempt(f.selection);
    const input = view.request.artifacts.find(a => a.path === "inputs/evals/input.txt");
    assert.deepEqual(input, { path: "inputs/evals/input.txt", sha256: createHash("sha256").update("original input\n").digest("hex"), kind: "text", text: "original input\n" });
    assert.equal(view.request.evidenceVersion, 2);
    assert.deepEqual(view.artifacts.map(a => a.path), ["logs/z.txt", "logs/answer.txt"], "raw retained archive stays in checkpoint order");
    assert.deepEqual(view.request.artifacts.map(a => a.path), ["logs/answer.txt", "logs/z.txt", "inputs/evals/input.txt"]);
    const stored = await gradeAttempt(f.selection, { ...f, newId: randomUUID, judge: { judge: async request => judged({ ...request, artifacts: request.artifacts.filter(a => a.path.startsWith("inputs/")) }) } });
    assert.equal(stored.result.outcome.status, "completed");
    if (stored.result.outcome.status === "completed") assert.equal(stored.result.outcome.judgments[0]?.evidence[0]?.path, "inputs/evals/input.txt");
    const db = new Database(f.registry, { readonly: true });
    assert.deepEqual(db.query<{ path: string }, [string]>("SELECT path FROM artifacts WHERE trial_id=? ORDER BY path").all(f.selection.attemptId), [{ path: "logs/answer.txt" }, { path: "logs/z.txt" }]);
    db.close();
    await rm(f.output, { recursive: true });
    const before = await readFile(f.registry);
    assert.deepEqual((await new SqliteJudgmentHistory(f.registry).list(f.selection))[0]?.outcome, stored.result.outcome);
    assert.deepEqual(await readFile(f.registry), before);
  } finally { await f.cleanup(); }
});

test("v2 history rejects projected-input tampering even with a recomputed request digest", async () => {
  const f = await frozenInputCampaign();
  try {
    const stored = await gradeAttempt(f.selection, { ...f, judge, newId: randomUUID });
    const db = new Database(f.registry, { readonly: true });
    const original = db.query<{ request_json: string }, [string]>("SELECT request_json FROM grading_runs WHERE id=?").get(stored.id)?.request_json;
    db.close(); assert.ok(original);
    for (const change of ["content", "hash", "kind", "omission", "extra", "duplicate", "order", "archive-order", "version"] as const) {
      const request = JSON.parse(original);
      const input = request.artifacts.find((a: { path: string }) => a.path.startsWith("inputs/"));
      assert.ok(input, "reader must supply frozen input before testing history tampering");
      if (change === "content") { input.text = "changed"; input.sha256 = createHash("sha256").update(input.text).digest("hex"); }
      else if (change === "hash") input.sha256 = "0".repeat(64);
      else if (change === "kind") { input.kind = "nontext"; delete input.text; }
      else if (change === "omission") request.artifacts.pop();
      else if (change === "extra") request.artifacts.push({ ...input, path: "inputs/extra.txt" });
      else if (change === "duplicate") request.artifacts.push(input);
      else if (change === "order") request.artifacts.reverse();
      else if (change === "archive-order") [request.artifacts[0], request.artifacts[1]] = [request.artifacts[1], request.artifacts[0]];
      else request.evidenceVersion = 3;
      const encoded = JSON.stringify(request);
      mutate(f.registry, connection => { connection.exec("DROP TRIGGER IF EXISTS grading_runs_no_update"); connection.query("UPDATE grading_runs SET request_json=?,request_digest=? WHERE id=?").run(encoded, createHash("sha256").update(encoded).digest("hex"), stored.id); connection.exec("CREATE TRIGGER grading_runs_no_update BEFORE UPDATE ON grading_runs BEGIN SELECT RAISE(ABORT,'Grading is append-only'); END"); });
      await assert.rejects(new SqliteJudgmentHistory(f.registry).list(f.selection), /Unable to read/);
    }
  } finally { await f.cleanup(); }
});

test("unversioned history retains exact archive-only legacy request and packet rendering with frozen inputs present", async () => {
  const f = await frozenInputCampaign();
  try {
    const stored = await gradeAttempt(f.selection, { ...f, judge, newId: randomUUID });
    mutate(f.registry, db => {
      const run = db.query<{ request_json: string }, [string]>("SELECT request_json FROM grading_runs WHERE id=?").get(stored.id); assert.ok(run);
      const request = JSON.parse(run.request_json); delete request.evidenceVersion;
      request.artifacts = request.artifacts.filter((a: { path: string }) => !a.path.startsWith("inputs/"));
      const encoded = JSON.stringify(request);
      // Golden archive-only packet digest: adding evidenceVersion must not rerender old rows.
      assert.equal(createHash("sha256").update(legacyJudgmentPacket(request).instructions).digest("hex"), "4a6caaa2a67851bb9e4557d70c803b2d86b22ef29cf0a14edb09b5f6be60ea0d");
      db.exec("DROP TRIGGER IF EXISTS grading_runs_no_update");
      db.query("UPDATE grading_runs SET request_json=?,request_digest=? WHERE id=?").run(encoded, createHash("sha256").update(encoded).digest("hex"), stored.id);
      db.exec("CREATE TRIGGER grading_runs_no_update BEFORE UPDATE ON grading_runs BEGIN SELECT RAISE(ABORT,'Grading is append-only'); END");
    });
    await rm(f.output, { recursive: true });
    assert.deepEqual((await new SqliteJudgmentHistory(f.registry).list(f.selection))[0]?.outcome, stored.result.outcome);
  } finally { await f.cleanup(); }
});


test("real reader refuses archived inputs namespace after archive verification", async () => {
  const f = await frozenInputCampaign("inputs/evals/input.txt");
  try {
    await assert.rejects(f.reader.readAttempt(f.selection), /namespace collision/);
    const before = await readFile(f.registry);
    let calls = 0;
    await assert.rejects(gradeAttempt(f.selection, { ...f, newId: randomUUID, judge: { judge: async request => { calls++; return judged(request); } } }), /namespace collision/);
    assert.equal(calls, 0);
    assert.deepEqual(await readFile(f.registry), before);
  } finally { await f.cleanup(); }
});
