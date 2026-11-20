import assert from "node:assert/strict";
import { lstat, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import type { TrialRequest } from "../../src/domain/execution.ts";
import { runActivationTrials } from "../../src/application/use-cases/run-activation-trials.ts";
import { readStoredPlan } from "../../src/adapters/outbound/storage/registry-schema.ts";
import { activationFixture, fakeHost, QUERIES } from "../helpers/activation-fixture.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

test("blind with-only runs are classified from verified conversations: load -> triggered, no load -> not-triggered, timeout -> technical", async () => {
  const fixture = await activationFixture(roots);
  const requests: TrialRequest[] = [];
  const run = await runActivationTrials(fixture.plan, fixture.dependencies(fakeHost(requests)));
  assert.equal(requests.length, 3);
  // Expectations stay in the frozen plan only; the host never receives them.
  for (const request of requests) {
    assert.equal(request.condition, "with");
    assert.doesNotMatch(JSON.stringify(request), /should_?[tT]rigger/);
  }
  const byId = Object.fromEntries(run.result.cases.map(item => [item.id, item]));
  assert.deepEqual(byId.yes?.runs.map(r => [r.outcome, r.class]), [["triggered", "triggered"]]);
  assert.deepEqual(byId.no?.runs.map(r => [r.outcome, r.class]), [["not-triggered", "not-triggered"]]);
  // The timed-out conversation is still observed, but its outcome is technical, never a false negative.
  assert.equal(byId.slow?.runs[0]?.outcome, "technical");
  assert.deepEqual([byId.yes?.pass, byId.no?.pass, byId.slow?.pass, byId.slow?.unresolved, byId.slow?.triggerRate], [true, true, false, true, null]);
  assert.deepEqual(run.result.summary, { tp: 1, fp: 0, tn: 1, fn: 0, unresolved: 1, precision: 1, recall: 1 });
  assert.deepEqual(run.result.header.host, { id: "goose", version: "1.57.0-fake" });
  assert.equal(run.campaign.failed, 1);
  // Derived result file: private, beside the campaign evidence, without query text.
  assert.equal(run.location, join(run.campaign.output, "activation-result.json"));
  assert.equal((await lstat(run.location)).mode & 0o777, 0o600);
  const written = await readFile(run.location, "utf8");
  assert.deepEqual(JSON.parse(written), run.result);
  for (const item of QUERIES.cases) assert.ok(!written.includes(item.query));
});

test("an interrupted campaign yields no result; resume executes only remaining trials and publishes it", async () => {
  const fixture = await activationFixture(roots, { cases: QUERIES.cases.slice(0, 2) }, 2);
  const first: TrialRequest[] = [];
  // A host rejection leaves an uncertain attempt: the campaign is interrupted, exactly as for evaluation.
  await assert.rejects(runActivationTrials(fixture.plan, fixture.dependencies(fakeHost(first, request => request.trialId === "trial-2"))), /not all finalized/);
  assert.equal(first.length, 4);
  const { SqliteEvaluationHistory } = await import("../../src/adapters/outbound/storage/sqlite-evaluation-history.ts");
  const [campaign] = await new SqliteEvaluationHistory(fixture.registry).list();
  assert.ok(campaign);
  await assert.rejects(runActivationTrials(undefined, fixture.dependencies(fakeHost([])), { id: campaign.id, retryUncertain: false }), /--retry-uncertain/);
  const second: TrialRequest[] = [];
  const resumed = await runActivationTrials(undefined, fixture.dependencies(fakeHost(second)), { id: campaign.id, retryUncertain: true });
  assert.deepEqual(second.map(request => request.trialId), ["trial-2"]);
  const yes = resumed.result.cases.find(item => item.id === "yes");
  assert.deepEqual([yes?.runs.length, yes?.triggerRate, yes?.unresolved], [2, 1, false]);
  assert.deepEqual(resumed.result.summary, { tp: 1, fp: 0, tn: 1, fn: 0, unresolved: 0, precision: 1, recall: 1 });
  assert.deepEqual(JSON.parse(await readFile(resumed.location, "utf8")), resumed.result);
  // A second resume recomputes the same derived result and replaces the file without new host calls.
  const again = await runActivationTrials(undefined, fixture.dependencies(fakeHost(second)), { id: campaign.id, retryUncertain: false });
  assert.equal(second.length, 1);
  assert.deepEqual(again.result, resumed.result);
});

test("schema-5 plans round-trip through storage validation and refuse a without trial", async () => {
  const fixture = await activationFixture(roots);
  assert.equal(fixture.plan.schemaVersion, 5);
  assert.deepEqual(readStoredPlan(JSON.stringify(fixture.plan)), fixture.plan);
  const without = structuredClone(fixture.plan);
  if (without.trials[0]) without.trials[0].condition = "without";
  assert.throws(() => readStoredPlan(JSON.stringify(without)), /Invalid stored activation plan/);
  const unmoded = { ...structuredClone(fixture.plan), mode: undefined };
  assert.throws(() => readStoredPlan(JSON.stringify(unmoded)), /mode/);
  const relabelled = structuredClone(fixture.plan);
  if (relabelled.cases?.[0]) relabelled.cases[0].id = "other";
  assert.throws(() => readStoredPlan(JSON.stringify(relabelled)), /Invalid stored activation plan/);
});

test("evaluation --resume of an activation campaign is refused with a mode diagnostic", async () => {
  const fixture = await activationFixture(roots);
  const run = await runActivationTrials(fixture.plan, fixture.dependencies(fakeHost([])));
  const { executeEvaluation } = await import("../../src/application/use-cases/execute-evaluation.ts");
  const deps = fixture.dependencies(fakeHost([]));
  await assert.rejects(executeEvaluation(undefined, deps.hosts, deps.store, deps.newAttemptId, { id: run.campaign.id, retryUncertain: false }), /resume it with agent-plugin activation --resume/);
});

test("Plugin profiles need no suites; multi-Skill cases name their target and the revision binds the queries bytes", async () => {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { prepareActivationTrials } = await import("../../src/application/use-cases/run-activation-trials.ts");
  const { FilesystemEvaluationSource } = await import("../../src/adapters/outbound/filesystem/filesystem-evaluation-source.ts");
  const { FilesystemActivationCaseSource } = await import("../../src/adapters/outbound/filesystem/activation-case-source.ts");
  const fixture = await activationFixture(roots);
  const plugin = join(fixture.root, "plugin");
  for (const child of ["one", "two"]) {
    await mkdir(join(plugin, "skills", child), { recursive: true });
    await writeFile(join(plugin, "skills", child, "SKILL.md"), `---\nname: ${child}\ndescription: ${child}\n---\nbody\n`);
  }
  await writeFile(join(plugin, "plugin.json"), JSON.stringify({ name: "kit" }));
  const prepare = async (cases: unknown) => {
    await writeFile(fixture.queriesFile, JSON.stringify(cases));
    return prepareActivationTrials({ ...fixture.input, skills: [], plugins: [plugin] }, new FilesystemEvaluationSource(), new FilesystemActivationCaseSource());
  };
  await assert.rejects(prepare([{ query: "a", should_trigger: true }]), /skill is required/);
  const first = await prepare({ cases: [{ id: "a", query: "a", should_trigger: true, skill: "two" }] });
  assert.equal(first.profile.scenarios[0]?.skill, join(plugin, "skills", "two"));
  const second = await prepare({ cases: [{ id: "a", query: "b", should_trigger: true, skill: "two" }] });
  assert.equal(first.profile.id, second.profile.id);
  assert.notEqual(first.profile.revision, second.profile.revision);
});
