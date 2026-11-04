import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { captureDeclaredInputs } from "../../src/adapters/outbound/filesystem/declared-input-snapshot.ts";
import { FilesystemEvaluationSource } from "../../src/adapters/outbound/filesystem/filesystem-evaluation-source.ts";
import { prepareEvaluation } from "../../src/application/use-cases/prepare-evaluation.ts";
import { executeEvaluation } from "../../src/application/use-cases/execute-evaluation.ts";
import { readStoredPlan } from "../../src/adapters/outbound/storage/registry-schema.ts";
import { Database } from "../../src/adapters/outbound/storage/sqlite-database.ts";
import { SqliteEvaluationStore } from "../../src/adapters/outbound/storage/sqlite-evaluation-store.ts";
import { createEvaluationCommandHandler } from "../../src/adapters/inbound/cli/handle-evaluation-command.ts";
import type { CandidateHost } from "../../src/application/ports/candidate-host.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const options = { agents: ["goose"], repetitions: 1, maxTurns: 5, timeout: 0, parallelism: 2 };
const source = new FilesystemEvaluationSource();
async function setup(item: object) {
  const root = await mkdtemp(join(tmpdir(), "import-suite-")); roots.push(root);
  const skill = join(root, "skill"); await mkdir(join(skill, "evals", "files"), { recursive: true });
  await writeFile(join(skill, "SKILL.md"), "private capability");
  const suite = join(skill, "evals", "evals.json");
  await writeFile(suite, JSON.stringify({ skill_name: "plugin:skill", evals: [{ id: 1, prompt: " exact task ", ...item }] }));
  const input = { ...options, skills: [skill], plugins: [] };
  return { root, skill, suite, input, prepare: () => prepareEvaluation(input, source) };
}

test("standard input files under excluded evals are frozen root-relative, separately from judge data", async () => {
  const fixture = await setup({ expected_output: "judge-only description", files: ["evals/files/data.txt"] });
  await writeFile(join(fixture.skill, "evals/files/data.txt"), "original bytes");
  const before = await readFile(fixture.suite, "utf8");
  const plan = await fixture.prepare();
  const scenario = plan.profile.scenarios[0]; assert.ok(scenario);
  assert.strictEqual(scenario.prompt, " exact task ");
  assert.deepStrictEqual(scenario.expectations, []);
  assert.strictEqual(scenario.expectedOutput, "judge-only description");
  assert.deepStrictEqual(scenario.grading, { notable: false });
  assert.deepStrictEqual(scenario.inputs, [{ source: "evals/files/data.txt", workspace: "evals/files/data.txt" }]);
  assert.deepStrictEqual(scenario.fixturesFiles, [{ path: "evals/files/data.txt", content: Buffer.from("original bytes").toString("base64"), executable: false }]);
  assert.strictEqual(plan.profile.components[0]?.files.some(file => file.path.startsWith("evals/")), false);
  assert.strictEqual(await readFile(fixture.suite, "utf8"), before);
});

test("declared hostile inputs and ambiguous sources reject before preparation", async () => {
  const fixture = await setup({ files: [] });
  await mkdir(join(fixture.root, "outside")); await writeFile(join(fixture.root, "outside/data"), "sentinel-secret");
  await symlink(join(fixture.root, "outside"), join(fixture.skill, "evals/files/link"));
  await symlink(join(fixture.root, "outside/data"), join(fixture.skill, "evals/files/leaf"));
  await mkdir(join(fixture.skill, "evals/files/directory"));
  for (const path of ["../outside/data", "/etc/passwd", "C:/secret", "evals\\files\\data", "evals/files/link/data", "evals/files/leaf", "evals/files/missing", ".agents/config.yaml", "secrets.yaml", "SKILL.md", "nested/SKILL.md", "evals/files/.env.local"]) {
    await writeFile(fixture.suite, JSON.stringify({ evals: [{ id: 1, prompt: "task", files: [path] }] }));
    await assert.rejects(fixture.prepare(), { name: "Error" }, path);
  }
  await writeFile(fixture.suite, JSON.stringify({ evals: [{ id: 1, prompt: "task", files: [], fixtures: "files" }] }));
  await assert.rejects(fixture.prepare(), /conflicting files\/fixtures/);
});

test("enriched metadata is canonical data with precise diagnostics and zero execution effects", async () => {
  const fixture = await setup({ name: "case", subject: "test", language: "en", target: { b: 2, a: 1 }, coverage_tags: ["import"], preconditions: [], budget: { max_turns: 4 }, capabilities: {}, navigation_expectations: [], execution_assertions: [] });
  const plan = await fixture.prepare();
  const scenario = plan.profile.scenarios[0]; assert.ok(scenario);
  assert.deepStrictEqual(Object.keys(scenario.extensions ?? {}), ["budget", "capabilities", "coverage_tags", "execution_assertions", "language", "name", "navigation_expectations", "preconditions", "subject", "target"]);
  assert.deepStrictEqual(scenario.diagnostics?.map(d => d.field), ["budget", "capabilities", "execution_assertions", "navigation_expectations", "preconditions"]);
  let out = "", effects = 0;
  const handler = createEvaluationCommandHandler({ writeOut: s => { out += s; }, writeErr: () => {} }, { source, newAttemptId: randomUUID, createHosts: () => { effects++; throw Error("host created"); }, createStore: () => { effects++; throw Error("store created"); } });
  await handler(fixture.input, true); assert.ok(out.includes("unsupported-scenario-constraint"));
  await assert.rejects(handler(fixture.input, false), /Unsupported scenario constraint/); assert.strictEqual(effects, 0);
  // Diagnostics are presentation, never the authority to admit a constrained plan.
  delete scenario.diagnostics;
  await assert.rejects(executeEvaluation(plan, new Map(), new SqliteEvaluationStore(join(fixture.root, "proofs"), join(fixture.root, "registry.sqlite")), randomUUID), /Unsupported scenario constraint/);
  await assert.rejects(readFile(join(fixture.root, "registry.sqlite")), { code: "ENOENT" });
});

test("description, metadata and frozen input changes affect revision only; object key ordering does not", async () => {
  const fixture = await setup({ expected_output: "first", target: { b: 2, a: 1 }, files: ["evals/files/data"] });
  await writeFile(join(fixture.skill, "evals/files/data"), "one");
  const first = await fixture.prepare();
  await writeFile(fixture.suite, JSON.stringify({ evals: [{ prompt: " exact task ", id: 1, files: ["evals/files/data"], target: { a: 1, b: 2 }, expected_output: "first" }], skill_name: "plugin:skill" }));
  const reordered = await fixture.prepare(); assert.strictEqual(reordered.profile.revision, first.profile.revision);
  for (const item of [{ expected_output: "second", target: { a: 1, b: 2 } }, { expected_output: "first", target: { a: 2, b: 2 } }]) {
    await writeFile(fixture.suite, JSON.stringify({ evals: [{ id: 1, prompt: " exact task ", files: ["evals/files/data"], ...item }] }));
    const changed = await fixture.prepare(); assert.strictEqual(changed.profile.id, first.profile.id); assert.notStrictEqual(changed.profile.revision, first.profile.revision);
  }
  await writeFile(fixture.suite, JSON.stringify({ evals: [{ id: 1, prompt: " exact task ", files: ["evals/files/data"], expected_output: "first", target: { a: 1, b: 2 } }] }));
  await writeFile(join(fixture.skill, "evals/files/data"), "two");
  assert.notStrictEqual((await fixture.prepare()).profile.revision, first.profile.revision);
});

test("schema3 optional import fields survive frozen resume; malformed optional payloads reject", async () => {
  const fixture = await setup({ expected_output: "description", files: ["evals/files/data"], target: { b: 2, a: 1 } });
  await writeFile(join(fixture.skill, "evals/files/data"), "frozen");
  const plan = await fixture.prepare(); const registry = join(fixture.root, "registry.sqlite");
  const store = () => new SqliteEvaluationStore(join(fixture.root, "proofs"), registry);
  const first = store(); const campaign = await first.begin(plan); await first.close();
  // Same semantic metadata ordering must not cause an immutable revision conflict.
  const reordered = structuredClone(plan);
  for (const scenario of [...reordered.profile.scenarios, ...reordered.profile.components.flatMap(c => c.scenarios)]) if (scenario.extensions) scenario.extensions.target = { a: 1, b: 2 };
  const second = store(); await second.begin(reordered); await second.close();
  await rm(fixture.skill, { recursive: true });
  const requests: string[] = [];
  const host: CandidateHost = { preflight: async () => {}, run: async r => { assert.strictEqual(r.scenario.expectedOutput, "description"); assert.strictEqual(Buffer.from(r.scenario.fixturesFiles?.[0]?.content ?? "", "base64").toString(), "frozen"); requests.push(r.scenario.prompt); return { host: { id: "goose", version: "fake" }, status: "completed", collection: "complete", exitCode: 0, sessionName: r.id, startedAt: "start", finishedAt: "end", artifacts: [], limitations: [] }; } };
  await executeEvaluation(undefined, new Map([["goose", host]]), store(), randomUUID, { id: campaign.id, retryUncertain: false });
  assert.deepStrictEqual(requests, [" exact task ", " exact task "]);
  for (const [field, value] of [["expectedOutput", 1], ["extensions", { unknown: true }], ["grading", { notable: "yes" }], ["inputs", [{ source: "../secret", workspace: "data" }]], ["diagnostics", [{ code: "bogus", field: "budget", message: "x" }]]] as const) {
    const corrupt = structuredClone(plan); Object.assign(corrupt.profile.scenarios[0] ?? {}, { [field]: value });
    assert.throws(() => readStoredPlan(JSON.stringify(corrupt)), /Invalid stored scenario/);
  }
});


test("declared directories retain nested paths and metadata-only scenarios remain executable; oversized inputs reject", async () => {
  const fixture = await setup({ files: ["evals/files"], expectations: [] });
  await mkdir(join(fixture.skill, "evals/files/nested"));
  await writeFile(join(fixture.skill, "evals/files/nested/data"), "directory bytes");
  const plan = await fixture.prepare();
  assert.deepStrictEqual(plan.profile.scenarios[0]?.inputs, [{ source: "evals/files", workspace: "evals/files" }]);
  assert.strictEqual(plan.profile.scenarios[0]?.fixturesFiles?.[0]?.path, "evals/files/nested/data");
  assert.deepStrictEqual(plan.profile.scenarios[0]?.grading, { notable: false });
  await assert.rejects(captureDeclaredInputs(fixture.skill, ["evals/files/nested/data"], { bytes: 64 * 1024 * 1024, entries: 0 }), /snapshot total exceeds 64 MiB/);
  await assert.rejects(captureDeclaredInputs(fixture.skill, ["evals/files"], { bytes: 0, entries: 20_000 }), /snapshot traversal exceeds 20000 entries/);
  await writeFile(join(fixture.skill, "evals/files/nested/data"), Buffer.alloc(4 * 1024 * 1024 + 1));
  await assert.rejects(fixture.prepare(), /snapshot file exceeds 4 MiB/);
});

test("legacy scenario payload and fingerprint stay unchanged and standard field types fail explicitly", async () => {
  const fixture = await setup({ expectations: ["criterion"] });
  const loaded = await source.load({ kind: "skill", root: fixture.skill });
  assert.deepStrictEqual(loaded.scenarios, [{ id: "skill/1", sourceId: 1, skill: fixture.skill, suite: fixture.suite, prompt: " exact task ", expectations: ["criterion"] }]);
  // Independent pre-import fingerprint payload: optional fields must not perturb old revision hashes.
  const oldPayload = { kind: "skill", installationName: "skill", files: [{ path: "SKILL.md", content: Buffer.from("private capability").toString("base64"), executable: false }], scenarios: [{ id: "skill/1", sourceId: 1, prompt: " exact task ", expectations: ["criterion"] }] };
  assert.strictEqual(loaded.fingerprint, createHash("sha256").update(JSON.stringify(oldPayload)).digest("hex"));
  const historical = await fixture.prepare();
  assert.deepStrictEqual(readStoredPlan(JSON.stringify(historical)), historical);
  for (const document of [
    { skill_name: 123, evals: [{ id: 1, prompt: "task" }] },
    { skill_name: " ", evals: [{ id: 1, prompt: "task" }] },
    { evals: [{ id: 1, prompt: "task", expected_output: [] }] },
    { evals: [{ id: 1, prompt: "task", expectations: null }] },
    { evals: [{ id: 1, prompt: "task", files: "input.txt" }] },
    { evals: [{ id: 1, prompt: "task", unknown_field: true }] },
  ]) {
    await writeFile(fixture.suite, JSON.stringify(document));
    await assert.rejects(fixture.prepare());
  }
});


test("frozen constrained resumes reject removed diagnostics as a content mismatch, including retry", async () => {
  const fixture = await setup({ budget: { max_turns: 4 }, expectations: ["criterion"] });
  const plan = await fixture.prepare(); const registry = join(fixture.root, "registry.sqlite");
  // Direct storage is used to represent an imported/preexisting frozen plan, not CLI admission.
  const store = () => new SqliteEvaluationStore(join(fixture.root, "proofs"), registry);
  const first = store(); const campaign = await first.begin(plan); await first.close();
  for (const scenario of [...plan.profile.scenarios, ...plan.profile.components.flatMap(component => component.scenarios)]) delete scenario.diagnostics;
  const db = new Database(registry);
  db.query("UPDATE experiments SET plan_json=? WHERE id=?").run(JSON.stringify(plan), campaign.id); db.close();
  await rm(fixture.skill, { recursive: true });
  let effects = 0;
  const host: CandidateHost = { preflight: async () => { effects++; }, run: async () => { effects++; throw Error("candidate admitted"); } };
  await assert.rejects(executeEvaluation(undefined, new Map([["goose", host]]), store(), randomUUID, { id: campaign.id, retryUncertain: true }), /Stored campaign profile content mismatch/);
  assert.strictEqual(effects, 0);
  // Retry consent also must not bypass malformed optional frozen data.
  Object.assign(plan.profile.scenarios[0] ?? {}, { inputs: [{ source: "../secret", workspace: "input" }] });
  const corrupt = new Database(registry); corrupt.query("UPDATE experiments SET plan_json=? WHERE id=?").run(JSON.stringify(plan), campaign.id); corrupt.close();
  await assert.rejects(executeEvaluation(undefined, new Map([["goose", host]]), store(), randomUUID, { id: campaign.id, retryUncertain: true }), /Invalid stored scenario/);
  assert.strictEqual(effects, 0);
});

// J-IMP6-01: shape-valid edits must not replace frozen treatment/judge/input data,
// even for completed campaigns or when retry consent is supplied.
for (const mutation of ["input bytes", "deleted input", "expected output", "removed constraints", "aggregate disagreement"] as const) {
  test(`public resume refuses shape-valid frozen ${mutation} edits before any host effects`, async () => {
    const fixture = await setup({ expected_output: "retained description", files: ["evals/files/data"], ...(mutation === "removed constraints" ? { budget: { max_turns: 4 } } : {}) });
    await writeFile(join(fixture.skill, "evals/files/data"), "retained bytes");
    const original = await fixture.prepare(); const registry = join(fixture.root, "registry.sqlite");
    const store = () => new SqliteEvaluationStore(join(fixture.root, "proofs"), registry);
    let effects = 0;
    const host: CandidateHost = { preflight: async () => { effects++; }, run: async r => { effects++; return { host: { id: "goose", version: "fake" }, status: "completed", collection: "complete", exitCode: 0, sessionName: r.id, startedAt: "start", finishedAt: "end", artifacts: [], limitations: [] }; } };
    const campaigns: string[] = [];
    for (const completed of [false, true]) {
      const first = store(); const campaign = await first.begin(original);
      if (completed) {
        // Direct storage completion represents a retained campaign, not execution
        // admission of unsupported constraints. Recovery still must verify its inputs.
        for (const trial of original.trials) {
          const scenario = original.profile.scenarios[0]; assert.ok(scenario);
          const request = { id: randomUUID(), trialId: trial.id, pairId: trial.pairId, condition: trial.condition, agent: trial.agent, profile: original.profile, scenario, options: original.options };
          await first.start(request);
          await first.finish(request, { host: { id: "goose", version: "fake" }, status: "completed", collection: "complete", exitCode: 0, sessionName: request.id, startedAt: "start", finishedAt: "end", artifacts: [], limitations: [] });
        }
        await first.complete();
      }
      await first.close();
      const db = new Database(registry);
      const edited = structuredClone(original);
      const scenarios = mutation === "aggregate disagreement" ? edited.profile.scenarios : [...edited.profile.scenarios, ...edited.profile.components.flatMap(c => c.scenarios)];
      for (const scenario of scenarios) {
        if (mutation === "input bytes") { const file = scenario.fixturesFiles?.[0]; assert.ok(file); file.content = Buffer.from("replacement bytes").toString("base64"); }
        if (mutation === "deleted input") scenario.fixturesFiles = [];
        if (mutation === "expected output" || mutation === "aggregate disagreement") scenario.expectedOutput = "replacement description";
        if (mutation === "removed constraints") { delete scenario.extensions; delete scenario.diagnostics; }
      }
      assert.strictEqual(edited.profile.id, original.profile.id); assert.strictEqual(edited.profile.revision, original.profile.revision);
      db.query("UPDATE experiments SET plan_json=? WHERE id=?").run(JSON.stringify(edited), campaign.id); db.close();
      campaigns.push(campaign.id);
    }
    await rm(fixture.skill, { recursive: true });
    for (const id of campaigns) for (const retryUncertain of [false, true]) {
      effects = 0;
      await assert.rejects(executeEvaluation(undefined, new Map([["goose", host]]), store(), randomUUID, { id, retryUncertain }), /Stored campaign profile content mismatch|Stored aggregate scenario content mismatch/);
      assert.strictEqual(effects, 0);
    }
  });
}

test("stored aggregate content is checked against component provenance, not intentionally distinct IDs", async () => {
  const fixture = await setup({ expected_output: "original" });
  const plan = await fixture.prepare();
  assert.notStrictEqual(plan.profile.scenarios[0]?.id, plan.profile.components[0]?.scenarios[0]?.id);
  assert.deepStrictEqual(readStoredPlan(JSON.stringify(plan)), plan);
  const scenario = plan.profile.scenarios[0]; assert.ok(scenario); scenario.expectedOutput = "aggregate-only replacement";
  assert.throws(() => readStoredPlan(JSON.stringify(plan)), /Stored aggregate scenario content mismatch/);
});


test("legacy schema3 revision snapshots accept labels and moved external fixture locations without source reads", async () => {
  const fixture = await setup({ fixtures: "files", expectations: ["criterion"] });
  await writeFile(join(fixture.skill, "evals/files/data"), "historical frozen bytes");
  const plan = await fixture.prepare(); const registry = join(fixture.root, "registry.sqlite");
  const store = () => new SqliteEvaluationStore(join(fixture.root, "proofs"), registry);
  const first = store(); const campaign = await first.begin(plan); await first.close();
  // Historical revisions retained the full profile, including the label and
  // external fixture location. Neither is evaluated content; bytes remain frozen.
  const db = new Database(registry);
  db.query("UPDATE profile_revisions SET snapshot_json=? WHERE profile_id=? AND revision=?").run(JSON.stringify(plan.profile), plan.profile.id, plan.profile.revision);
  const moved = structuredClone(plan); moved.profile.name = "renamed label";
  for (const scenario of [...moved.profile.scenarios, ...moved.profile.components.flatMap(c => c.scenarios)]) scenario.fixtures = join(fixture.root, "missing-external-location");
  db.query("UPDATE experiments SET plan_json=? WHERE id=?").run(JSON.stringify(moved), campaign.id); db.close();
  await rm(fixture.skill, { recursive: true });
  for (const retryUncertain of [false, true]) {
    const resumed = store(); const restored = await resumed.resume(campaign.id, retryUncertain);
    assert.deepStrictEqual(restored.plan, moved);
    assert.strictEqual(Buffer.from(restored.plan.profile.scenarios[0]?.fixturesFiles?.[0]?.content ?? "", "base64").toString(), "historical frozen bytes");
    await resumed.close();
  }
});
