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
    const expected = { schemaVersion: 1, campaignId: "campaign", attemptId: "attempt", trialId: "trial", request: {}, receipt: {
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

async function campaign(content = Buffer.from("result")) {
  const root = await mkdtemp(join(tmpdir(), "grading-campaign-"));
  const skill = join(root, "skill");
  await mkdir(join(skill, "evals"), { recursive: true });
  await writeFile(join(skill, "SKILL.md"), "capability");
  await writeFile(join(skill, "evals", "evals.json"), JSON.stringify({ evals: [{ id: 1, prompt: "task", expectations: ["first", "second"], expected_output: "answer" }] }));
  const plan = await prepareEvaluation({ skills: [skill], plugins: [], agents: ["goose"], repetitions: 1, maxTurns: 5, timeout: 0, parallelism: 1 }, new FilesystemEvaluationSource());
  let candidateRuns = 0;
  const host: CandidateHost = { preflight: async () => {}, run: async request => {
    candidateRuns++;
    return { status: "completed", exitCode: 0, sessionName: request.id, collection: "complete", startedAt: "start", finishedAt: "end", host: { id: "goose", version: "fake" }, artifacts: [{ path: "logs/answer.txt", content }], limitations: [] };
  } };
  const registry = join(root, "registry", "evaluations.sqlite");
  const result = await executeEvaluation(plan, new Map([["goose", host]]), new SqliteEvaluationStore(join(root, "proofs"), registry), randomUUID);
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
