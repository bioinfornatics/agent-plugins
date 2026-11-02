import { afterEach, expect, test } from "bun:test";
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

test("combined repeated selectors produce independent canonical targets and paired plugin trials", async () => {
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
  expect(result.code).toBe(0);
  expect(result.err).toBe("");
  const plan = JSON.parse(result.out);
  expect(plan.status).toBe("prepared");
  expect(plan.targets.map((t: { root: string }) => t.root)).toEqual([first, second, plugin]);
  expect(plan.targets[2].scenarios.map((s: { id: string }) => s.id)).toEqual(["a/1", "b/1"]);
  expect(plan.options).toEqual({ agents: ["codex", "claude"], model: "my-model", repetitions: 2, maxTurns: 12, timeout: 0, parallelism: 3 });
  expect(plan.candidateRuns).toBe(32);
  expect(plan.trials.slice(0, 2)).toEqual([
    { target: 0, scenario: "first/1", agent: "codex", repetition: 1, pairId: '[0,"first/1","codex",1]', condition: "with" },
    { target: 0, scenario: "first/1", agent: "codex", repetition: 1, pairId: '[0,"first/1","codex",1]', condition: "without" },
  ]);
  expect(new Set(plan.trials.map((t: { pairId: string }) => t.pairId)).size).toBe(16);
  expect(plan.trials.filter((t: { target: number }) => t.target === 2).length).toBe(16);
});

test("default plan records requested limits; normal invocation cannot fake execution success", async () => {
  const root = await skill(await workspace());
  const prepared = await cli(["--skills", root, "--dry-run"]);
  expect(prepared.code).toBe(0);
  expect(prepared.err).toBe("");
  const plan = JSON.parse(prepared.out);
  expect(plan.options).toEqual({ agents: ["goose"], repetitions: 3, maxTurns: 50, timeout: 0, parallelism: 3 });
  expect(plan.candidateRuns).toBe(6);
  const result = await cli(["--skills", root]);
  expect(result.code).toBe(1);
  expect(result.out).toBe("");
  expect(result.err).toContain("Evaluation execution is unavailable; use --dry-run");
});

test("aliases preserve criteria and fixtures resolve relative to suite, not cwd", async () => {
  const root = await workspace();
  const target = await skill(join(root, "sample"), { evals: [{ id: 7, prompt: "  exact task  ", assertions: [" exact criterion "], fixtures: "fixtures" }] });
  await mkdir(join(target, "evals", "fixtures"));
  const loaded = await new FilesystemEvaluationSource().load({ kind: "skill", root: target });
  expect(loaded.scenarios).toEqual([{ id: "sample/7", sourceId: 7, skill: target, suite: join(target, "evals", "evals.json"), prompt: "  exact task  ", expectations: [" exact criterion "], fixtures: join(target, "evals", "fixtures") }]);
});

const invalidSuites: [string, unknown, string][] = [
  ["empty", { evals: [] }, "nonempty array"],
  ["duplicate", { evals: [scenario, scenario] }, "unique safe integer"],
  ["prompt", { evals: [{ ...scenario, prompt: " " }] }, "prompt must be nonempty"],
  ["criteria", { evals: [{ id: 1, prompt: "task" }] }, "expectations must contain"],
  ["alias", { evals: [{ ...scenario, assertions: ["different"] }] }, "conflicting expectations/assertions"],
  ["enriched", { evals: [{ ...scenario, budget: { max_turns: 5 } }] }, "unsupported fields: budget"],
  ["fixtures", { evals: [{ ...scenario, fixtures: "absent" }] }, "ENOENT"],
];
for (const [name, suite, error] of invalidSuites) test(`invalid suite ${name} produces a local diagnostic and no plan`, async () => {
  const root = await skill(await workspace(), suite);
  const result = await cli(["--skills", root, "--dry-run"]);
  expect(result.code).toBe(1);
  expect(result.out).toBe("");
  expect(result.err).toContain(error);
  expect(result.err).toContain(root);
});

test("present malformed plugin child is not silently skipped", async () => {
  const root = await workspace();
  await writeFile(join(root, "plugin.json"), '{"name":"test"}');
  await skill(join(root, "skills", "good"));
  const bad = await skill(join(root, "skills", "bad"));
  await writeFile(join(bad, "evals", "evals.json"), "{");
  const result = await cli(["--plugin", root, "--dry-run"]);
  expect(result.code).toBe(1);
  expect(result.out).toBe("");
  expect(result.err).toContain("error:");
});

test("plugin without child suites and directly selected Skill without suite fail explicitly", async () => {
  const root = await workspace();
  await writeFile(join(root, "plugin.json"), '{"name":"test"}');
  const target = await skill(join(root, "skills", "empty"), undefined, false);
  const plugin = await cli(["--plugin", root, "--dry-run"]);
  expect(plugin.code).toBe(1);
  expect(plugin.out).toBe("");
  expect(plugin.err).toContain("no evaluation suites found");
  const direct = await cli(["--skills", target, "--dry-run"]);
  expect(direct.code).toBe(1);
  expect(direct.err).toContain("evals.json");
});

for (const args of [
  ["--max-turns", "0"], ["--repetitions", "0"], ["--parallelism", "0"],
  ["--timeout", "-1"], ["--max-turns", "1.5"], ["--repetitions", "Infinity"],
  ["--max-turns", "9007199254740992"], ["--model", " "], ["--agent", "unknown"], ["--budget", "10"],
] as const) test(`invalid option ${args.join(" ")} fails before target I/O`, async () => {
  const result = await cli(["--skills", "/absent-not-read", ...args, "--dry-run"]);
  expect(result.code).toBe(1);
  expect(result.out).toBe("");
  expect(result.err).toContain(args[0]);
  expect(result.err).not.toContain("ENOENT");
});
