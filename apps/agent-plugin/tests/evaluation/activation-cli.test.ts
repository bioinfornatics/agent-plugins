import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { afterEach, test } from "node:test";
import { createCli } from "../../src/adapters/inbound/cli/create-cli.ts";
import { createActivationCommandHandler } from "../../src/adapters/inbound/cli/handle-activation-command.ts";
import { createGradingCommandHandler } from "../../src/adapters/inbound/cli/handle-grading-command.ts";
import { createExportCommandHandler } from "../../src/adapters/inbound/cli/handle-export-command.ts";
import { FilesystemEvaluationSource } from "../../src/adapters/outbound/filesystem/filesystem-evaluation-source.ts";
import { FilesystemActivationCaseSource } from "../../src/adapters/outbound/filesystem/activation-case-source.ts";
import { SqliteEvaluationHistory } from "../../src/adapters/outbound/storage/sqlite-evaluation-history.ts";
import { SqliteVerifiedAttemptReader } from "../../src/adapters/outbound/storage/sqlite-verified-attempt.ts";
import { SqliteJudgmentStore } from "../../src/adapters/outbound/storage/sqlite-judgment-store.ts";
import { SqliteJudgmentHistory } from "../../src/adapters/outbound/storage/sqlite-judgment-history.ts";
import { GooseActivationObserver } from "../../src/adapters/outbound/hosts/goose/goose-activation.ts";
import { runActivationTrials } from "../../src/application/use-cases/run-activation-trials.ts";
import { main } from "../../src/main.ts";
import { activationFixture, fakeHost, QUERIES } from "../helpers/activation-fixture.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const quiet = { writeOut: () => {}, writeErr: () => {} };

async function parse(args: string[]) {
  let received: unknown, err = "";
  const cli = createCli({ writeOut: () => {}, writeErr: text => { err += text; } }, async () => {}, undefined, undefined, undefined, undefined, undefined,
    async (input, mode) => { received = { input, mode }; });
  try { await cli.parseAsync(["activation", ...args], { from: "user" }); } catch { /* exitOverride */ }
  return { received, err };
}

test("activation is a separate command with approved defaults (max turns 10, timeout 300, bubblewrap)", async () => {
  let out = "";
  assert.equal(await main(["activation", "--help"], { writeOut: text => { out += text; }, writeErr: () => {} }), 0);
  for (const option of ["--queries", "--skills", "--plugin", "--sandbox", "--resume", "--retry-uncertain", "--json", "--dry-run"]) assert.ok(out.includes(option), option);
  const { received } = await parse(["--skills", "s", "--queries", "q.json"]);
  assert.deepEqual(received, { input: { skills: ["s"], plugins: [], queries: "q.json", agents: ["goose"], model: undefined, repetitions: 3, maxTurns: 10, timeout: 300,
    parallelism: 3, sandbox: "bubblewrap", output: undefined, registry: undefined }, mode: { dryRun: false, json: false } });
  const none = await parse(["--plugin", "p", "--queries", "q.json", "--sandbox", "none", "--json"]);
  assert.deepEqual([Object.hasOwn((none.received as { input: object }).input, "sandbox"), (none.received as { mode: { json: boolean } }).mode.json], [false, true]);
  const resumed = await parse(["--resume", "c", "--retry-uncertain", "--registry", "r.sqlite", "--json", "-q"]);
  assert.deepEqual((resumed.received as { mode: object }).mode, { dryRun: false, json: true, resume: { id: "c", retryUncertain: true } });
});

test("activation refuses option conflicts before the handler", async () => {
  for (const [args, message] of [
    [["--skills", "s"], /--queries is required unless --resume/],
    [["--queries", "q.json"], /Select --skills or --plugin/],
    [["--skills", "s", "--queries", "q", "--retry-uncertain"], /--retry-uncertain requires --resume/],
    [["--skills", "s", "--queries", "q", "--sandbox", "firejail"], /--sandbox must be none or bubblewrap/],
    [["--resume", "c", "--queries", "q"], /--resume uses its stored plan/],
    [["--resume", "c", "--skills", "s"], /--resume uses its stored plan/],
    [["--resume", "c", "--model", "m"], /--resume uses its stored plan/],
    [["--resume", "c", "--max-turns", "10"], /--resume uses its stored plan/],
    [["--resume", "c", "--sandbox", "bubblewrap"], /--resume uses its stored plan/],
    [["--resume", "c", "--dry-run"], /--resume uses its stored plan/],
    [["--resume", "c", "--output", "o"], /--resume uses its stored plan/],
  ] as const) {
    const { received, err } = await parse([...args]);
    assert.equal(received, undefined, args.join(" "));
    assert.match(err, message, args.join(" "));
  }
});

test("dry-run validates sources and prints a plan without query text, hosts, storage or registry", async () => {
  const fixture = await activationFixture(roots);
  let out = "";
  const never = () => { throw new Error("constructed during dry-run"); };
  const handler = createActivationCommandHandler({ writeOut: text => { out += text; }, writeErr: () => {} }, {
    source: new FilesystemEvaluationSource(), caseSource: new FilesystemActivationCaseSource(), newAttemptId: never,
    createHosts: never, createStore: never, createHistory: never, createReader: never, observer: new GooseActivationObserver(),
    writer: { write: async () => never() } });
  await handler({ ...fixture.input, repetitions: 3 }, { dryRun: true, json: false });
  const plan = JSON.parse(out);
  assert.deepEqual([plan.schemaVersion, plan.mode, plan.candidateRuns, plan.options.sandbox, plan.options.maxTurns], [5, "activation", 9, "bubblewrap", 10]);
  assert.deepEqual(plan.cases, QUERIES.cases.map(item => ({ id: item.id, shouldTrigger: item.should_trigger, skill: "alpha" })));
  assert.ok(plan.trials.every((trial: { condition: string }) => trial.condition === "with"));
  for (const item of QUERIES.cases) assert.ok(!out.includes(item.query));
  await assert.rejects(handler({ ...fixture.input, agents: ["claude"] }, { dryRun: true, json: false }), /only --agent goose/);
});

test("grading and export refuse an activation campaign with an explicit diagnostic and no Judge", async () => {
  const fixture = await activationFixture(roots);
  const run = await runActivationTrials(fixture.plan, fixture.dependencies(fakeHost([])));
  const attemptId = run.result.cases[0]?.runs[0]?.attemptId;
  assert.ok(attemptId);
  let judges = 0;
  const grading = createGradingCommandHandler(quiet, { createReader: () => new SqliteVerifiedAttemptReader(fixture.registry), createStore: () => new SqliteJudgmentStore(fixture.registry),
    createJudge: () => { judges++; throw new Error("judge constructed"); }, newId: randomUUID });
  await assert.rejects(grading({ campaignId: run.campaign.id, attemptId, json: false, agent: "goose", maxTurns: 20, timeout: 600 }), /Activation campaigns have no grading criteria; grading is refused/);
  assert.equal(judges, 0);
  const exporter = createExportCommandHandler(quiet, { createOverviewHistory: () => new SqliteEvaluationHistory(fixture.registry), createHistory: () => new SqliteJudgmentHistory(fixture.registry),
    createReader: () => new SqliteVerifiedAttemptReader(fixture.registry), createWriter: () => ({}) as never, now: () => new Date().toISOString() });
  await assert.rejects(exporter({ campaignId: run.campaign.id, gradingIds: [randomUUID()], benchmark: false }), /Activation campaigns have no grading criteria; export is refused/);
});
