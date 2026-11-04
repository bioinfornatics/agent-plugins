import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../src/main.ts";
import { FilesystemEvaluationSource } from "../../src/adapters/outbound/filesystem/filesystem-evaluation-source.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function workspace() { const root = await mkdtemp(join(tmpdir(), "agent-plugin-test-")); roots.push(root); return root; }
const scenario = { id: 1, prompt: "Write output.json", expectations: ["Contains a result"] };
async function skill(root: string, evals: unknown = { evals: [scenario] }, suite = true) {
  await mkdir(join(root, "evals"), { recursive: true });
  await writeFile(join(root, "SKILL.md"), "---\nname: sample\ndescription: test\n---\n");
  if (suite) await writeFile(join(root, "evals", "evals.json"), JSON.stringify(evals));
  return root;
}
async function cli(args: string[]) {
  let out = "", err = "";
  const code = await main(["evaluation", ...args], { writeOut: (s) => { out += s; }, writeErr: (s) => { err += s; } });
  return { code, out, err };
}

test("combined repeated selectors produce one canonical profile with full treatment for every scenario", async () => {
  const root = await workspace();
  const first = await skill(join(root, "first"));
  const second = await skill(join(root, "second"));
  const plugin = join(root, "plugin");
  await mkdir(plugin);
  await writeFile(join(plugin, "plugin.json"), JSON.stringify({ name: "sample" }));
  await skill(join(plugin, "skills", "a"));
  await skill(join(plugin, "skills", "b"));
  await skill(join(plugin, "skills", "no-suite"), undefined, false);
  await mkdir(join(plugin, "evals"));
  await writeFile(join(plugin, "evals", "evals.json"), "invalid ignored root suite");
  const result = await cli(["--skills", first, second, "--skills", first, "--plugin", plugin, "--plugin", plugin,
    "--agent", "codex", "--agent", "claude", "--agent", "codex", "--model", "my-model", "--repetitions", "2", "--max-turns", "12", "--dry-run"]);
  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.err, "");
  const plan = JSON.parse(result.out);
  assert.strictEqual(plan.status, "prepared");
  assert.deepStrictEqual(plan.profile.components.map((t: { root: string }) => t.root), [plugin, first, second]);
  assert.deepStrictEqual(plan.profile.scenarios.map((s: { skill: string }) => s.skill), [join(plugin,"skills","a"),join(plugin,"skills","b"),first,second]);
  assert.deepStrictEqual(plan.options, { agents: ["codex", "claude"], model: "my-model", repetitions: 2, maxTurns: 12, timeout: 0, parallelism: 3 });
  assert.strictEqual(plan.candidateRuns, 32);
  assert.strictEqual(plan.trials[0].condition, "with");
  assert.deepStrictEqual(plan.trials[1], {...plan.trials[0],id:"trial-2",condition:"without"});
  assert.strictEqual(plan.trials.every((t: object) => !("target" in t)), true);
  assert.strictEqual(new Set(plan.trials.map((t: { pairId: string }) => t.pairId)).size, 16);

});

test("default plan records requested limits; unsupported host cannot fake execution success", async () => {
  const root = await skill(await workspace());
  const prepared = await cli(["--skills", root, "--dry-run"]);
  assert.strictEqual(prepared.code, 0);
  assert.strictEqual(prepared.err, "");
  const plan = JSON.parse(prepared.out);
  assert.deepStrictEqual(plan.options, { agents: ["goose"], repetitions: 3, maxTurns: 50, timeout: 0, parallelism: 3 });
  assert.strictEqual(plan.candidateRuns, 6);
  const result = await cli(["--skills", root, "--agent", "codex"]);
  assert.strictEqual(result.code, 1);
  assert.strictEqual(result.out, "");
  assert.ok((result.err).includes("Campaign execution, recovery or storage failed"));
});

test("aliases preserve criteria and fixtures resolve relative to suite, not cwd", async () => {
  const root = await workspace();
  const target = await skill(join(root, "sample"), { evals: [{ id: 7, prompt: "  exact task  ", assertions: [" exact criterion "], fixtures: "fixtures" }] });
  await mkdir(join(target, "evals", "fixtures"));
  const loaded = await new FilesystemEvaluationSource().load({ kind: "skill", root: target });
  assert.deepStrictEqual(loaded.scenarios, [{ id: "sample/7", sourceId: 7, skill: target, suite: join(target, "evals", "evals.json"), prompt: "  exact task  ", expectations: [" exact criterion "], fixtures: join(target, "evals", "fixtures"), fixturesFiles: [] }]);
});

const invalidSuites: [string, unknown, string][] = [
  ["empty", { evals: [] }, "nonempty array"],
  ["duplicate", { evals: [scenario, scenario] }, "unique safe integer"],
  ["prompt", { evals: [{ ...scenario, prompt: " " }] }, "prompt must be nonempty"],
  ["criteria", { evals: [{ id: 1, prompt: "task", expectations: [" "] }] }, "expectations must contain"],
  ["alias", { evals: [{ ...scenario, assertions: ["different"] }] }, "conflicting expectations/assertions"],
  ["unknown", { evals: [{ ...scenario, surprise: true }] }, "unsupported fields: surprise"],
  ["fixtures", { evals: [{ ...scenario, fixtures: "absent" }] }, "ENOENT"],
];
for (const [name, suite, error] of invalidSuites) test(`invalid suite ${name} produces a local diagnostic and no plan`, async () => {
  const root = await skill(await workspace(), suite);
  const result = await cli(["--skills", root, "--dry-run"]);
  assert.strictEqual(result.code, 1);
  assert.strictEqual(result.out, "");
  assert.ok((result.err).includes(error));
  assert.ok((result.err).includes(root));
});

test("present malformed plugin child is not silently skipped", async () => {
  const root = await workspace();
  await writeFile(join(root, "plugin.json"), '{"name":"test"}');
  await skill(join(root, "skills", "good"));
  const bad = await skill(join(root, "skills", "bad"));
  await writeFile(join(bad, "evals", "evals.json"), "{");
  const result = await cli(["--plugin", root, "--dry-run"]);
  assert.strictEqual(result.code, 1);
  assert.strictEqual(result.out, "");
  assert.ok((result.err).includes("error:"));
});

test("plugin without child suites and directly selected Skill without suite fail explicitly", async () => {
  const root = await workspace();
  await writeFile(join(root, "plugin.json"), '{"name":"test"}');
  const target = await skill(join(root, "skills", "empty"), undefined, false);
  const plugin = await cli(["--plugin", root, "--dry-run"]);
  assert.strictEqual(plugin.code, 1);
  assert.strictEqual(plugin.out, "");
  assert.ok((plugin.err).includes("no evaluation suites found"));
  const direct = await cli(["--skills", target, "--dry-run"]);
  assert.strictEqual(direct.code, 1);
  assert.ok((direct.err).includes("evals.json"));
});

for (const args of [
  ["--max-turns", "0"], ["--repetitions", "0"], ["--parallelism", "0"],
  ["--timeout", "-1"], ["--max-turns", "1.5"], ["--repetitions", "Infinity"],
  ["--max-turns", "9007199254740992"], ["--model", " "], ["--agent", "unknown"], ["--budget", "10"],
] as const) test(`invalid option ${args.join(" ")} fails before target I/O`, async () => {
  const result = await cli(["--skills", "/absent-not-read", ...args, "--dry-run"]);
  assert.strictEqual(result.code, 1);
  assert.strictEqual(result.out, "");
  assert.ok((result.err).includes(args[0]));
  assert.ok(!(result.err).includes("ENOENT"));
});

test("CLI output failure reports nonzero without advertising a ready plan",async()=>{
 const target=await skill(await workspace());let diagnostic="";
 const code=await main(["evaluation","--skills",target,"--dry-run"],{writeOut:()=>{throw Error("writer unavailable");},writeErr:s=>{diagnostic+=s;}});
 assert.strictEqual(code, 1);assert.strictEqual(diagnostic, "error: Unexpected CLI failure\n");
});
