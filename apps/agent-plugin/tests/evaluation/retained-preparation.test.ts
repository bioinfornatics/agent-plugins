import { readStoredPlan } from "../../src/adapters/outbound/storage/registry-schema.ts";
import { gradeAttempt } from "../../src/application/use-cases/grade-attempt.ts";
import { SqliteJudgmentStore } from "../../src/adapters/outbound/storage/sqlite-judgment-store.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { FilesystemEvaluationSource } from "../../src/adapters/outbound/filesystem/filesystem-evaluation-source.ts";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("retained declarations reject unknown fields and unbound tokens before execution", async () => {
  const root = await mkdtemp(join(tmpdir(), "retained-import-"));
  try {
    await mkdir(join(root, "evals")); await writeFile(join(root, "SKILL.md"), "neutral");
    for (const item of [
      { preparation: { kind: "retained-evaluation", version: 1, campaign: "completed", script: "evil" }, prompt: "Consult" },
      { prompt: "Consult {{fixture.registry_path}}" },
      { preparation: { kind: "retained-evaluation", version: 1, campaign: "completed" }, prompt: "{{fixture.unknown}}" },
    ]) {
      await writeFile(join(root, "evals/evals.json"), JSON.stringify({ evals: [{ id: 1, ...item }] }));
      await assert.rejects(new FilesystemEvaluationSource().load({ kind: "skill", root }));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { prepareEvaluation } from "../../src/application/use-cases/prepare-evaluation.ts";
import { executeEvaluation } from "../../src/application/use-cases/execute-evaluation.ts";
import { SqliteEvaluationStore } from "../../src/adapters/outbound/storage/sqlite-evaluation-store.ts";
import { SqliteEvaluationHistory } from "../../src/adapters/outbound/storage/sqlite-evaluation-history.ts";
import { SqliteVerifiedAttemptReader } from "../../src/adapters/outbound/storage/sqlite-verified-attempt.ts";
import { FilesystemRetainedFixtureIO } from "../../src/adapters/outbound/filesystem/retained-fixture-io.ts";
import { main } from "../../src/main.ts";
import type { TrialRequest } from "../../src/domain/execution.ts";
import { bindFixturePrompt, validatePreparation } from "../../src/domain/retained-preparation.ts";

function fixtureIO() {
  return new FilesystemRetainedFixtureIO(new FilesystemEvaluationSource(), locations => new SqliteEvaluationStore(join(locations.candidate, "campaigns"), join(locations.candidate, "registry/evaluations.sqlite")), randomUUID);
}

async function retainedSetup(campaign: "completed" | "interrupted", prefix = "retained-execute-") {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const source = join(root, "skill"); await mkdir(join(source, "evals"), { recursive: true });
  await writeFile(join(source, "SKILL.md"), "neutral");
  const declaration = { kind: "retained-evaluation", version: 1, campaign };
  await writeFile(join(source, "evals/evals.json"), JSON.stringify({ evals: [{ id: 1, preparation: declaration, prompt: 'Consult {{fixture.registry_path}} campaign {{fixture.campaign_id}}. JSON {"unchanged":true}', expectations: ["Consulted"] }] }));
  const plan = await prepareEvaluation({ skills: [source], plugins: [], agents: ["goose"], repetitions: 1, maxTurns: 5, timeout: 0, parallelism: 1 }, new FilesystemEvaluationSource());
  return { root, plan, registry: join(root, "global/evaluations.sqlite"), output: join(root, "persistent-campaigns") };
}
function receipt(request: TrialRequest) {
  return { status: "completed" as const, collection: "complete" as const, exitCode: 0, sessionName: request.id,
    host: { id: "goose", version: "synthetic-consultation" }, startedAt: "start", finishedAt: "end", limitations: [],
    artifacts: [{ path: "answer.txt", content: Buffer.from(request.runtime?.task ?? "unprepared") }] };
}

test("pure binding uses explicit fixture syntax only and rejects invalid closed declarations", () => {
  const declaration = { kind: "retained-evaluation" as const, version: 1 as const, campaign: "completed" as const };
  assert.equal(bindFixturePrompt('JSON {"x":1} {{fixture.registry_path}}', declaration, { registry_path: "/private/db" }), 'JSON {"x":1} /private/db');
  for (const value of [null, {}, { ...declaration, version: 2 }, { ...declaration, campaign: "other" }, { ...declaration, campaign: ["completed"] }, { ...declaration, env: {} }]) assert.throws(() => validatePreparation(value, "task"));
  assert.throws(() => bindFixturePrompt("{{fixture.campaign_id}}", declaration, {}));
  assert.throws(() => validatePreparation({ ...declaration, campaign: "interrupted" }, "{{fixture.without_attempt_id}}"));
  assert.throws(() => validatePreparation(declaration, "{{fixture.registry_path}"));
});

test("automatic retained pair consultations use durable private equivalent data and authenticated actual tasks", async () => {
  const { root, plan, registry, output } = await retainedSetup("completed");
  try {
    const original = JSON.stringify(plan); const requests: TrialRequest[] = []; const normalized: unknown[] = [];
    const host = { preflight: async () => {}, run: async (request: TrialRequest) => {
      requests.push(structuredClone(request)); const proof = request.runtime;
      assert.ok(proof); assert.ok(proof.locations.candidate.startsWith(output)); assert.ok(!proof.locations.evaluator.startsWith(`${proof.locations.candidate}/`));
      assert.equal(request.scenario.prompt, plan.profile.scenarios[0]?.prompt);
      const retainedRegistry = proof.bindings.registry_path; const id = proof.bindings.campaign_id;
      assert.ok(retainedRegistry); assert.ok(id);
      const detail = await new SqliteEvaluationHistory(retainedRegistry).inspect(id);
      normalized.push({ status: detail.status, total: detail.total, finalized: detail.finalized, attempts: detail.attempts.map(a => ({ condition: a.condition, status: a.status, collection: a.collection })).sort((a,b) => a.condition.localeCompare(b.condition)) });
      assert.equal(detail.attempts.length, 2);
      for (const attempt of detail.attempts) await new SqliteVerifiedAttemptReader(retainedRegistry).readAttempt({ campaignId: id, attemptId: attempt.id });
      const before = await readFile(retainedRegistry);
      for (const args of [["history", "--registry", retainedRegistry, "--json"], ["inspect", id, "--registry", retainedRegistry]]) {
        let out = "", err = "";
        assert.equal(await main(args, { writeOut: s => { out += s; }, writeErr: s => { err += s; } }), 0, err);
        assert.ok(out.includes(id)); assert.equal(err, "");
      }
      assert.deepEqual(await readFile(retainedRegistry), before);
      return receipt(request);
    } };
    const result = await executeEvaluation(plan, new Map([["goose", host]]), new SqliteEvaluationStore(output, registry), randomUUID, undefined, fixtureIO());
    assert.equal(JSON.stringify(plan), original); assert.equal(result.completed, 2);
    assert.deepEqual(normalized[0], normalized[1]); assert.notEqual(requests[0]?.runtime?.bindings.campaign_id, requests[1]?.runtime?.bindings.campaign_id);
    const global = await new SqliteEvaluationHistory(registry).list();
    assert.equal(global.length, 1); // Seeds never enter the operator registry.
    for (const request of requests) {
      const verified = await new SqliteVerifiedAttemptReader(registry).readAttempt({ campaignId: result.id, attemptId: request.id });
      assert.equal(verified.request.task, request.runtime?.task);
      assert.equal(Buffer.from(verified.artifacts[0]?.content ?? []).toString(), verified.request.task);
    }
    const selected = requests[0]; assert.ok(selected);
    let judgedTask = "";
    const grade = await gradeAttempt({ campaignId: result.id, attemptId: selected.id }, {
      reader: new SqliteVerifiedAttemptReader(registry), store: new SqliteJudgmentStore(registry), newId: randomUUID,
      judge: { judge: async task => {
        judgedTask = task.task;
        return { outcome: { status: "completed", judgments: [{ id: "criterion-1", verdict: "inconclusive", text: "Consulted", evidence: [], rationale: "Synthetic consultation has no effectiveness verdict" }] },
          provenance: { host: { id: "goose" }, model: { source: "configuration-default", effective: "unknown" }, limits: { maxTurns: 50, timeout: 0, preflightTimeout: 1, exportTimeout: 1, outputBytes: 1024 } } };
      } },
    });
    assert.equal(judgedTask, selected.runtime?.task); assert.equal(grade.result.outcome.status, "completed");
    const resumed = new SqliteEvaluationStore(output, registry);
    try { assert.deepEqual((await resumed.resume(result.id, false)).pending, []); } finally { await resumed.close(); }
    const request = requests[0]; assert.ok(request?.runtime);
    // Tasks may change candidate-owned state; the evaluator seed remains the pre-host oracle.
    await writeFile(request.runtime.bindings.registry_path ?? "", "candidate changed its data");
    assert.equal((await new SqliteVerifiedAttemptReader(registry).readAttempt({ campaignId: result.id, attemptId: request.id })).request.task, request.runtime.task);
    const proofFile = join(request.runtime.locations.evaluator, "preparation.json");
    const proofBytes = await readFile(proofFile);
    await writeFile(proofFile, proofBytes.toString().replace('"synthetic-public-seams-no-model"', '"forged"'));
    await assert.rejects(new SqliteVerifiedAttemptReader(registry).readAttempt({ campaignId: result.id, attemptId: request.id }), /provenance/);
    await assert.rejects(new SqliteEvaluationStore(output, registry).resume(result.id, true), /provenance/);
    await writeFile(proofFile, proofBytes);
    const checkpoint = join(result.output, "artifacts", request.id, "checkpoint.json");
    const checkpointBytes = await readFile(checkpoint); const downgraded = JSON.parse(checkpointBytes.toString()); downgraded.schemaVersion = 1;
    await writeFile(checkpoint, JSON.stringify(downgraded));
    await assert.rejects(new SqliteVerifiedAttemptReader(registry).readAttempt({ campaignId: result.id, attemptId: request.id }), /identity/);
    await writeFile(checkpoint, checkpointBytes);
    const seed = request.runtime.manifest[0]; assert.ok(seed);
    const seedPath = join(request.runtime.locations.evaluator, "seed", seed.path);
    await writeFile(seedPath, "corrupt seed");
    await assert.rejects(new SqliteVerifiedAttemptReader(registry).readAttempt({ campaignId: result.id, attemptId: request.id }), /integrity/);
    await assert.rejects(new SqliteEvaluationStore(output, registry).resume(result.id, true), /integrity/);
    await rm(proofFile);
    await assert.rejects(new SqliteVerifiedAttemptReader(registry).readAttempt({ campaignId: result.id, attemptId: request.id }), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("interrupted trusted fixture retains one finalized attempt and pending partner without models", async () => {
  const { root, plan, registry, output } = await retainedSetup("interrupted");
  try {
    const host = { preflight: async () => {}, run: async (request: TrialRequest) => {
      const proof = request.runtime; assert.ok(proof?.bindings.registry_path); assert.ok(proof.bindings.campaign_id);
      const detail = await new SqliteEvaluationHistory(proof.bindings.registry_path).inspect(proof.bindings.campaign_id);
      assert.equal(detail.status, "interrupted"); assert.equal(detail.finalized, 1); assert.equal(detail.total, 2); assert.equal(detail.attempts.length, 1);
      return receipt(request);
    } };
    assert.equal((await executeEvaluation(plan, new Map([["goose", host]]), new SqliteEvaluationStore(output, registry), randomUUID, undefined, fixtureIO())).completed, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("seed setup and preparation storage failures preserve partial evidence and admit no candidate", async () => {
  for (const storageFailure of [false, true]) {
    const { root, plan, registry, output } = await retainedSetup("completed");
    try {
      let runs = 0; const store = new SqliteEvaluationStore(output, registry);
      const io = fixtureIO();
      if (storageFailure) store.savePreparation = async () => { throw new Error("preparation storage failed"); };
      else io.createSource = async locations => { await writeFile(join(locations.evaluator, "partial"), "preserved"); throw new Error("setup failed"); };
      await assert.rejects(executeEvaluation(plan, new Map([["goose", { preflight: async () => {}, run: async request => { runs++; return receipt(request); } }]]), store, randomUUID, undefined, io), /failed/);
      assert.equal(runs, 0);
      const history = await new SqliteEvaluationHistory(registry).list(); assert.equal(history.length, 1);
      const campaign = history[0]; assert.ok(campaign);
      const detail = await new SqliteEvaluationHistory(registry).inspect(campaign.id); assert.equal(detail.status, "interrupted"); assert.equal(detail.attempts.length, 1);
      assert.equal((await readdir(join(detail.output, "trial-data"))).length, 1);
      // Consent cannot downgrade a started declared preparation that lacks authenticated proof.
      await assert.rejects(new SqliteEvaluationStore(output, registry).resume(campaign.id, true), /Missing preparation provenance/);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

import { GooseHost } from "../../src/adapters/outbound/hosts/goose/goose-host.ts";

test("Goose transport verifies the bound export task and temp cleanup preserves retained data and operator sentinel", async () => {
  const { root, plan, registry, output } = await retainedSetup("completed", "retained spaced ");
  try {
    const original = join(root, "operator"); await mkdir(original);
    const config = 'GOOSE_MODEL: configured-default\nextensions:\n  developer:\n    type: builtin\n    enabled: true\n';
    await writeFile(join(original, "config.yaml"), config);
    await writeFile(join(original, "evaluations.sqlite"), "operator-registry-sentinel");
    const temp = join(root, "temporary-hosts"); await mkdir(temp);
    const executable = join(root, "fake-goose.mjs");
    await writeFile(executable, `#!${process.execPath}
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2), base = process.env.GOOSE_PATH_ROOT;
const dir = base ? join(base, 'config') : process.env.ORIGINAL_CONFIG;
if (args[0] === 'info') console.log('Version: 1.57.0\\nConfig dir: '+dir+'\\nConfig yaml: '+join(dir,'config.yaml')+'\\nSessions DB (sqlite): '+join(base || dir,'data/sessions/sessions.db')+'\\nLogs dir: '+join(base || dir,'state/logs'));
else if (args.includes('--help')) console.log('--instructions --name --max-turns --quiet --output-format --model stream-json --format json');
else if (args[0] === 'run') {
  if (args.includes('--model')) throw Error('default model overridden');
  const task = readFileSync(0, 'utf8');
  if (task.includes('{{fixture.') || !task.includes(process.cwd()+'/registry/evaluations.sqlite')) throw Error('task not bound to persistent workspace');
  if (!existsSync('registry/evaluations.sqlite') || existsSync('neutral-source') || existsSync('seed')) throw Error('seed missing or oracle exposed');
  writeFileSync(join(base, 'task'), task); writeFileSync('candidate-answer.txt', task); console.log(JSON.stringify({type:'message',text:'consulted'}));
} else if (args[0] === 'session') console.log(JSON.stringify({ messages: [{role:'user',content:readFileSync(join(base,'task'),'utf8')},{role:'assistant',content:'consulted'}] }));
`, { mode: 0o700 });
    const host = new GooseHost({ executable, tempRoot: temp, env: { PATH: process.env.PATH, HOME: original, ORIGINAL_CONFIG: original } });
    const result = await executeEvaluation(plan, new Map([["goose", host]]), new SqliteEvaluationStore(output, registry), randomUUID, undefined, fixtureIO());
    assert.equal(result.completed, 2); assert.equal(result.failed, 0);
    assert.deepEqual(await readdir(temp), []);
    await rm(temp, { recursive: true });
    assert.equal(await readFile(join(original, "config.yaml"), "utf8"), config);
    assert.equal(await readFile(join(original, "evaluations.sqlite"), "utf8"), "operator-registry-sentinel");
    const detail = await new SqliteEvaluationHistory(registry).inspect(result.id);
    for (const attempt of detail.attempts) {
      const view = await new SqliteVerifiedAttemptReader(registry).readAttempt({ campaignId: result.id, attemptId: attempt.id });
      assert.ok(view.request.task.includes(join(result.output, "trial-data", attempt.id, "candidate")));
      const conversation = view.artifacts.find(a => a.path === "goose/conversation.json"); assert.ok(conversation);
      assert.ok(Buffer.from(conversation.content).toString().includes(view.request.task.replaceAll('"', '\\"')));
      assert.ok(await readFile(join(result.output, "trial-data", attempt.id, "candidate/registry/evaluations.sqlite")));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("dry-run freezes declaration into revision without seed writes; CLI parameter errors allocate nothing", async () => {
  const { root, plan, registry } = await retainedSetup("completed");
  try {
    const source = plan.profile.components[0]?.root; assert.ok(source);
    let out = "", err = "";
    assert.equal(await main(["evaluation", "--skills", source, "--registry", registry, "--dry-run"], { writeOut: s => { out += s; }, writeErr: s => { err += s; } }), 0, err);
    assert.deepEqual(JSON.parse(out).profile.scenarios[0].preparation, { kind: "retained-evaluation", version: 1, campaign: "completed" });
    assert.deepEqual(await readdir(root), ["skill"]);
    await writeFile(join(source, "evals/evals.json"), JSON.stringify({ evals: [{ id: 1, preparation: { kind: "retained-evaluation", version: 1, campaign: "interrupted" }, prompt: plan.profile.scenarios[0]?.prompt, expectations: ["Consulted"] }] }));
    const changed = await prepareEvaluation({ skills: [source], plugins: [], ...plan.options }, new FilesystemEvaluationSource());
    assert.notEqual(changed.profile.revision, plan.profile.revision);
    const malformed = structuredClone(plan);
    const frozen = malformed.profile.scenarios[0]; assert.ok(frozen?.preparation);
    Object.assign(frozen.preparation, { script: "forbidden" });
    assert.throws(() => readStoredPlan(JSON.stringify(malformed)), /preparation declaration/);
    out = ""; err = "";
    assert.notEqual(await main(["evaluation", "--skills", source, "--registry", registry, "--repetitions", "0"], { writeOut: s => { out += s; }, writeErr: s => { err += s; } }), 0);
    assert.equal(out, ""); assert.ok(err.includes("repetitions")); assert.deepEqual(await readdir(root), ["skill"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

import { Database } from "../../src/adapters/outbound/storage/sqlite-database.ts";
import { verifyCheckpoint } from "../../src/adapters/outbound/storage/campaign-checkpoint.ts";
import { spawnSync } from "node:child_process";

test("published prepared checkpoint repairs an index failure but rejects altered digest without overwriting DB", async () => {
  const { root, plan, registry, output } = await retainedSetup("completed");
  try {
    // SQLite trigger fails the real post-rename index transaction, not publication itself.
    const store = new SqliteEvaluationStore(output, registry);
    let selected: TrialRequest | undefined;
    await assert.rejects(executeEvaluation(plan, new Map([["goose", { preflight: async () => {}, run: async request => {
      selected = structuredClone(request);
      const db = new Database(registry, { create: false, readwrite: true });
      try { db.exec("CREATE TRIGGER fail_index BEFORE INSERT ON artifacts BEGIN SELECT RAISE(ABORT, 'index fault'); END;"); } finally { db.close(); }
      return receipt(request);
    } }]]), store, randomUUID, undefined, fixtureIO()), /index fault/);
    assert.ok(selected?.runtime);
    const db = new Database(registry, { create: false, readwrite: true });
    let campaignId: string; let indexedReceipt: string;
    try {
      db.exec("DROP TRIGGER fail_index;");
      const row = db.query<{ campaign_id: string; receipt_json: string }, [string]>("SELECT campaign_id,receipt_json FROM trials WHERE id=?").get(selected.id);
      assert.ok(row); campaignId = row.campaign_id; indexedReceipt = row.receipt_json;
    } finally { db.close(); }
    const checkpointPath = join(output, campaignId, "artifacts", selected.id, "checkpoint.json");
    const intact = await readFile(checkpointPath);
    const expected = JSON.parse(intact.toString());
    await assert.rejects(verifyCheckpoint(join(output, campaignId, "artifacts", selected.id), expected, expected.receipt), /legacy fallback/);
    for (const mutation of ["changed", "removed", "downgraded"] as const) {
      const checkpoint = JSON.parse(intact.toString());
      if (mutation === "removed") delete checkpoint.receipt.preparationDigest;
      else if (mutation === "changed") checkpoint.receipt.preparationDigest = "0".repeat(64);
      else checkpoint.schemaVersion = 1;
      await writeFile(checkpointPath, JSON.stringify(checkpoint));
      await assert.rejects(new SqliteEvaluationStore(output, registry).resume(campaignId, true), /preparation|identity/i);
      const check = new Database(registry, { readonly: true, create: false });
      try {
        assert.equal(check.query<{receipt_json: string}, [string]>("SELECT receipt_json FROM trials WHERE id=?").get(selected.id)?.receipt_json, indexedReceipt);
        assert.equal(check.query<{n: number}, []>("SELECT count(*) AS n FROM artifacts").get()?.n, 0);
      } finally { check.close(); }
    }
    await writeFile(checkpointPath, intact);
    const repaired = new SqliteEvaluationStore(output, registry);
    try { const restored = await repaired.resume(campaignId, false); assert.equal(restored.completed, 1); assert.equal(restored.pending.length, 1); } finally { await repaired.close(); }
    assert.equal((await new SqliteVerifiedAttemptReader(registry).readAttempt({ campaignId, attemptId: selected.id })).request.task, selected.runtime.task);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("binding rejects control/template injection and quotes spaced paths without recursive replacement", () => {
  const declaration = { kind: "retained-evaluation" as const, version: 1 as const, campaign: "completed" as const };
  for (const unsafe of ["/a\nb", "/a\rb", "/a\tb", "/a\u0000b", "/a\u007fb", "/a{{fixture.campaign_id}}", "/a}}b"]) {
    assert.throws(() => bindFixturePrompt("{{fixture.registry_path}}", declaration, { registry_path: unsafe }), /Unsafe/);
  }
  const path = "/private/a b/it's;$(printf injected).sqlite";
  const bound = bindFixturePrompt("{{fixture.registry_path}}", declaration, { registry_path: path });
  assert.equal(bindFixturePrompt("--registry {{fixture.registry_path}}", declaration, { registry_path: "/private/a b/it's.sqlite" }), "--registry '/private/a b/it'\\''s.sqlite'");
  const parsed = spawnSync("/bin/sh", ["-c", `printf '%s' ${bound}`], { encoding: "utf8" });
  assert.equal(parsed.status, 0); assert.equal(parsed.stdout, path); assert.equal(parsed.stderr, "");
});

test("unsafe destination is rejected before campaign writes and host preflight", async () => {
  const { root, plan, registry, output } = await retainedSetup("completed");
  try {
    for (const suffix of ["\nunsafe", "{{fixture.campaign_id}}", "}}unsafe"]) {
      let calls = 0;
      await assert.rejects(async () => executeEvaluation(plan, new Map([["goose", { preflight: async () => { calls++; }, run: async request => { calls++; return receipt(request); } }]]), new SqliteEvaluationStore(output + suffix, registry), randomUUID, undefined, fixtureIO()), /Unsafe/);
      assert.equal(calls, 0); assert.deepEqual(await readdir(root), ["skill"]);
      assert.throws(() => new SqliteEvaluationStore(output, registry + suffix), /Unsafe/);
      assert.throws(() => new SqliteVerifiedAttemptReader(registry + suffix), /Unsafe/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("parallel preparation fault stops further admission and drains active preparation before close", async () => {
  const { root, plan, registry, output } = await retainedSetup("completed");
  try {
    const source = plan.profile.components[0]?.root; assert.ok(source);
    const parallelPlan = await prepareEvaluation({ skills: [source], plugins: [], ...plan.options, repetitions: 2, parallelism: 2 }, new FilesystemEvaluationSource());
    const io = fixtureIO(), createSource = io.createSource.bind(io);
    let entered = 0, drained = false, closed = false, runs = 0;
    let release: () => void = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    io.createSource = async locations => {
      entered++;
      if (entered === 2) { setImmediate(release); throw new Error("parallel setup fault"); }
      await held;
      await writeFile(join(locations.evaluator, "drained-partial"), "preserved");
      const source = await createSource(locations); drained = true; return source;
    };
    const store = new SqliteEvaluationStore(output, registry), close = store.close.bind(store);
    store.close = async () => { assert.equal(drained, true); closed = true; await close(); };
    await assert.rejects(executeEvaluation(parallelPlan, new Map([["goose", { preflight: async () => {}, run: async request => { runs++; return receipt(request); } }]]), store, randomUUID, undefined, io), /parallel setup fault/);
    assert.equal(closed, true); assert.equal(entered, 2); assert.equal(runs, 0);
    const campaign = (await new SqliteEvaluationHistory(registry).list())[0]; assert.ok(campaign);
    const detail = await new SqliteEvaluationHistory(registry).inspect(campaign.id);
    assert.equal(detail.status, "interrupted"); assert.equal(detail.attempts.length, 2); assert.equal(detail.total, 4);
    await assert.rejects(new SqliteEvaluationStore(output, registry).resume(campaign.id, true), /Missing preparation provenance/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
