import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import type { CandidateHost } from "../../src/application/ports/candidate-host.ts";
import type { TrialRequest } from "../../src/domain/execution.ts";
import { validateCandidateToolModes } from "../../src/domain/candidate-tooling.ts";
import { prepareEvaluation } from "../../src/application/use-cases/prepare-evaluation.ts";
import { executeEvaluation } from "../../src/application/use-cases/execute-evaluation.ts";
import { runActivationTrials } from "../../src/application/use-cases/run-activation-trials.ts";
import { FilesystemEvaluationSource } from "../../src/adapters/outbound/filesystem/filesystem-evaluation-source.ts";
import { SqliteEvaluationStore } from "../../src/adapters/outbound/storage/sqlite-evaluation-store.ts";
import { Database } from "../../src/adapters/outbound/storage/sqlite-database.ts";
import { readStoredPlan } from "../../src/adapters/outbound/storage/registry-schema.ts";
import { GooseHost } from "../../src/adapters/outbound/hosts/goose/goose-host.ts";
import { activationFixture, fakeHost } from "../helpers/activation-fixture.ts";

// ap-49tf: Goose code mode changes how a Skill can be loaded, so campaigns freeze it.
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const host: CandidateHost = { preflight: async () => {}, run: async request => ({ status: "completed", collection: "complete", exitCode: 0, sessionName: request.id,
  startedAt: "start", finishedAt: "end", host: { id: request.agent, version: "fixture" }, artifacts: [], limitations: [] }) };
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "candidate-tooling-")); roots.push(root);
  const target = join(root, "skill"); await mkdir(join(target, "evals"), { recursive: true });
  await writeFile(join(target, "SKILL.md"), "capability");
  await writeFile(join(target, "evals/evals.json"), JSON.stringify({ evals: [{ id: 1, prompt: "task", expectations: ["criterion"] }] }));
  const plan = await prepareEvaluation({ skills: [target], plugins: [], agents: ["goose"], repetitions: 1, maxTurns: 5, timeout: 0, parallelism: 1 }, new FilesystemEvaluationSource());
  return { root, plan, registry: join(root, "registry/evaluations.sqlite") };
}

// Detects a lenient map that would freeze an unknown agent, value or extra field.
test("candidate tool modes accept only exact enabled/disabled entries for selected agents", () => {
  validateCandidateToolModes({ agents: ["goose"] });
  validateCandidateToolModes({ agents: ["goose"], candidateToolModes: { goose: { codeMode: "enabled" } } });
  for (const modes of [null, {}, [], { claude: { codeMode: "enabled" } }, { goose: { codeMode: "on" } }, { goose: { codeMode: "enabled", extra: 1 } }, { goose: {} }])
    assert.throws(() => validateCandidateToolModes({ agents: ["goose"], candidateToolModes: modes }), /candidate tool mode/i);
});

// Detects reading the current setting per trial or on resume instead of the frozen plan.
test("new campaigns freeze the host code mode once; resume and pending trials keep it", async () => {
  const { root, plan, registry } = await setup();
  let resolves = 0;
  const seen: string[] = [];
  const resolving: CandidateHost = { ...host, resolveToolMode: async () => { resolves++; return { codeMode: "enabled" }; },
    run: async request => { seen.push(request.options.candidateToolModes?.goose?.codeMode ?? "missing"); return host.run(request); } };
  const first = await executeEvaluation(plan, new Map([["goose", resolving]]), new SqliteEvaluationStore(join(root, "proofs"), registry, "hive"), randomUUID);
  assert.equal(resolves, 1);
  assert.equal(plan.options.candidateToolModes, undefined);
  assert.deepEqual(seen, ["enabled", "enabled"]);
  const db = new Database(registry, { readonly: true });
  const row = db.query<{ plan_json: string }, [string]>("SELECT plan_json FROM experiments WHERE id=?").get(first.id);
  db.close(); assert.ok(row);
  const stored = readStoredPlan(row.plan_json);
  assert.deepEqual(stored.options.candidateToolModes, { goose: { codeMode: "enabled" } });
  const pendingStore = new SqliteEvaluationStore(join(root, "pending"), registry); const pending = await pendingStore.begin(stored); await pendingStore.close();
  const frozen: CandidateHost = { ...resolving, resolveToolMode: async () => { throw new Error("must not resolve on resume"); } };
  await executeEvaluation(undefined, new Map([["goose", frozen]]), new SqliteEvaluationStore("/unused", registry), randomUUID, { id: pending.id, retryUncertain: false });
  assert.deepEqual(seen, ["enabled", "enabled", "enabled", "enabled"]);
  // A tampered stored value is refused before any trial launches.
  assert.throws(() => readStoredPlan(row.plan_json.replace('"codeMode":"enabled"', '"codeMode":"maybe"')), /candidate tool mode/i);
});

// Detects reading the operator file instead of the filtered private copy, or ignoring drift.
test("Goose reads code mode from the private configuration and refuses a drifted trial before launch", async () => {
  const root = await mkdtemp(join(tmpdir(), "goose-code-mode-")); roots.push(root);
  const original = join(root, "original"); await mkdir(original);
  const config = join(original, "config.yaml");
  const executable = join(root, "fake-goose");
  await writeFile(executable, `#!${process.execPath}\nimport { join } from 'node:path';
const args=process.argv.slice(2), dir=process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME,'goose') : process.env.ORIGINAL_CONFIG;
if(args[0]==='info') console.log('Version: 1.57.0\\nConfig dir: '+dir+'\\nConfig yaml: '+join(dir,'config.yaml')+'\\nSessions DB (sqlite): '+join(process.env.XDG_DATA_HOME||dir,'goose','sessions.db')+'\\nLogs dir: '+join(process.env.XDG_STATE_HOME||dir,'goose','logs'));
else if(args.includes('--help')) console.log('--instructions --name --max-turns --quiet --output-format --model stream-json --format json');
else if(args[0]==='run') throw Error('candidate must not launch');
`, { mode: 0o700 });
  const goose = new GooseHost({ executable, tempRoot: root, env: { PATH: process.env.PATH, ORIGINAL_CONFIG: original } });
  const cases: [string, "enabled" | "disabled"][] = [
    ["GOOSE_PROVIDER: p\n", "disabled"],
    ["extensions:\n  code_execution:\n    type: platform\n    name: code_execution\n    enabled: false\n", "disabled"],
    ["extensions:\n  code_execution:\n    type: platform\n    name: code_execution\n    enabled: true\n", "enabled"],
    // A builtin entry with the same name is not the platform extension.
    ["extensions:\n  code_execution:\n    type: builtin\n    name: code_execution\n    enabled: true\n", "disabled"],
  ];
  for (const [yaml, expected] of cases) {
    await writeFile(config, yaml);
    assert.deepEqual(await goose.resolveToolMode(), { codeMode: expected }, yaml);
  }
  await writeFile(config, cases[2]?.[0] ?? "");
  const { plan } = await setup();
  const scenario = plan.profile.scenarios[0]; const trial = plan.trials[0]; assert.ok(scenario); assert.ok(trial);
  const request: TrialRequest = { id: randomUUID(), trialId: trial.id, pairId: trial.pairId, agent: "goose", condition: "without", profile: plan.profile, scenario,
    options: { ...plan.options, candidateToolModes: { goose: { codeMode: "disabled" } } } };
  await assert.rejects(goose.run(request), { message: "Goose code mode differs from the frozen campaign setting." });
});

// Detects an activation result that hides the setting or presents unknown as disabled.
test("activation results carry the frozen code mode and qualify enabled or unknown settings", async () => {
  const fixture = await activationFixture(roots);
  const enabled = await runActivationTrials(fixture.plan, fixture.dependencies({ ...fakeHost([]), resolveToolMode: async () => ({ codeMode: "enabled" }) }));
  assert.deepEqual(enabled.result.header.candidateTooling, { goose: { codeMode: "enabled" } });
  assert.ok(enabled.result.limitations.some(line => line.startsWith("Host code mode was enabled")));
  const disabled = await runActivationTrials(fixture.plan, fixture.dependencies({ ...fakeHost([]), resolveToolMode: async () => ({ codeMode: "disabled" }) }));
  assert.deepEqual(disabled.result.header.candidateTooling, { goose: { codeMode: "disabled" } });
  assert.ok(!disabled.result.limitations.some(line => line.startsWith("Host code mode")));
  const unknown = await runActivationTrials(fixture.plan, fixture.dependencies(fakeHost([])));
  assert.equal(unknown.result.header.candidateTooling, null);
  assert.ok(unknown.result.limitations.some(line => line.startsWith("Host code mode was not recorded")));
});
