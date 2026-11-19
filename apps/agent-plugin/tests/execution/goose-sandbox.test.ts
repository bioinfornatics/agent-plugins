import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bubblewrapArguments } from "../../src/adapters/outbound/hosts/goose/goose-sandbox.ts";
import { GooseHost } from "../../src/adapters/outbound/hosts/goose/goose-host.ts";
import { executeEvaluation } from "../../src/application/use-cases/execute-evaluation.ts";
import { prepareEvaluation } from "../../src/application/use-cases/prepare-evaluation.ts";
import { FilesystemEvaluationSource } from "../../src/adapters/outbound/filesystem/filesystem-evaluation-source.ts";
import { SqliteEvaluationStore } from "../../src/adapters/outbound/storage/sqlite-evaluation-store.ts";
import { readStoredPlan } from "../../src/adapters/outbound/storage/registry-schema.ts";
import type { CandidateHost } from "../../src/application/ports/candidate-host.ts";

// ap-15xv. Wrong results: binds hidden by a later /tmp tmpfs, /home exposed, a home-installed
// executable missing, or an outside workspace not bound.
test("bubblewrap arguments hide host trees and bind only the private root, workspace and executable", () => {
  const args = bubblewrapArguments({ executable: "/home/u/.local/bin/goose", root: "/tmp/agent-plugin-goose-x", workspace: "/data/candidate", system: [{ path: "/lib", symlink: "usr/lib" }, { path: "/lib64" }] }, ["run", "--name", "n"]);
  const at = (...items: string[]) => args.findIndex((_, i) => items.every((item, j) => args[i + j] === item));
  assert.ok(at("--tmpfs", "/tmp") < at("--bind", "/tmp/agent-plugin-goose-x", "/tmp/agent-plugin-goose-x"));
  assert.ok(at("--ro-bind", "/home/u/.local/bin/goose", "/home/u/.local/bin/goose") > at("--tmpfs", "/tmp"));
  assert.ok(at("--bind", "/data/candidate", "/data/candidate") > 0);
  assert.ok(at("--symlink", "usr/lib", "/lib") >= 0 && at("--ro-bind-try", "/lib64", "/lib64") >= 0);
  assert.deepStrictEqual(args.slice(args.indexOf("--")), ["--", "/home/u/.local/bin/goose", "run", "--name", "n"]);
  assert.ok(!args.includes("/home") && !args.includes("/dev/shm") && !args.includes("/var"));
  const inside = bubblewrapArguments({ executable: "/usr/bin/goose", root: "/tmp/r", workspace: "/tmp/r/workspace", system: [] }, []);
  assert.strictEqual(inside.filter(item => item === "--bind").length, 1, "a workspace inside the root is not bound twice");
  assert.ok(!inside.includes("/usr/bin/goose") || inside.indexOf("/usr/bin/goose") > inside.indexOf("--"), "/usr executables are already visible");
});

test("a requested sandbox is refused for hosts that do not support it, before any trial", async () => {
  const root = await mkdtemp(join(tmpdir(), "sandbox-refusal-"));
  try {
    const skill = join(root, "skill"); await mkdir(join(skill, "evals"), { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: skill\ndescription: d\n---\n");
    await writeFile(join(skill, "evals", "evals.json"), JSON.stringify({ evals: [{ id: 1, prompt: "task", expectations: ["c"] }] }));
    const plan = await prepareEvaluation({ skills: [skill], plugins: [], agents: ["goose"], repetitions: 1, maxTurns: 1, timeout: 0, parallelism: 1, sandbox: "bubblewrap" }, new FilesystemEvaluationSource());
    assert.strictEqual(plan.options.sandbox, "bubblewrap");
    // Schema 4 makes pre-sandbox runtimes (which accept only <=3) refuse an unsandboxed resume.
    assert.strictEqual(plan.schemaVersion, 4);
    assert.strictEqual(readStoredPlan(JSON.stringify(plan)).schemaVersion, 4);
    assert.throws(() => readStoredPlan(JSON.stringify({ ...plan, schemaVersion: 3 })), /sandbox/);
    const { sandbox: _sandbox, ...plain } = plan.options;
    assert.throws(() => readStoredPlan(JSON.stringify({ ...plan, options: plain })), /sandbox/);
    assert.strictEqual(readStoredPlan(JSON.stringify({ ...plan, schemaVersion: 3, options: plain })).schemaVersion, 3);
    let runs = 0;
    const host: CandidateHost = { preflight: async () => {}, run: async () => { runs++; throw Error("ran"); } };
    await assert.rejects(executeEvaluation(plan, new Map([["goose", host]]), new SqliteEvaluationStore(join(root, "out"), join(root, "registry.sqlite")), randomUUID), /does not support --sandbox bubblewrap/);
    assert.strictEqual(runs, 0);
    await assert.rejects(prepareEvaluation({ skills: [skill], plugins: [], agents: ["goose"], repetitions: 1, maxTurns: 1, timeout: 0, parallelism: 1, sandbox: "docker" as "bubblewrap" }, new FilesystemEvaluationSource()), /--sandbox must be one of: bubblewrap/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

const usable = process.platform === "linux" && spawnSync("bwrap", ["--ro-bind", "/", "/", "--unshare-all", "true"]).status === 0;
test("sandboxed candidate run cannot see host files outside its private root (real bubblewrap)", { skip: !usable && "bwrap unavailable or user namespaces disallowed" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "sandbox-run-"));
  const outside = await mkdtemp(join(tmpdir(), "sandbox-outside-"));
  let shmPath = "";
  try {
    await writeFile(join(outside, "SKILL.md"), "real checkout");
    // Contamination path observed in b92185d5: a checkout under /dev/shm.
    const shm = existsSync("/dev/shm") ? join("/dev/shm", `agent-plugin-sandbox-${randomUUID()}`) : join(outside, "shm-missing");
    await writeFile(shm, "shared"); shmPath = shm;
    const skill = join(root, "skill"); await mkdir(join(skill, "evals"), { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: skill\ndescription: d\n---\n");
    await writeFile(join(skill, "evals", "evals.json"), JSON.stringify({ evals: [{ id: 1, prompt: "Candidate task", expectations: ["c"] }] }));
    const config = join(root, "original"); await mkdir(config);
    await writeFile(join(config, "config.yaml"), "GOOSE_PROVIDER: openai\nGOOSE_MODEL: fake\n");
    const executable = join(root, "fake-goose");
    await writeFile(executable, `#!${process.execPath}
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2), base = process.env.XDG_CONFIG_HOME ? process.env.HOME : undefined;
const configDir = base ? join(process.env.XDG_CONFIG_HOME, 'goose') : ${JSON.stringify(config)};
if (args[0] === '--version') console.log('1.57.0');
else if (args[0] === 'info') console.log('Version: 1.57.0\\nConfig dir: ' + configDir + '\\nConfig yaml: ' + join(configDir, 'config.yaml') + '\\nSessions DB (sqlite): ' + join(process.env.XDG_DATA_HOME || configDir, 'goose', 'sessions', 'sessions.db') + '\\nLogs dir: ' + join(process.env.XDG_STATE_HOME || configDir, 'goose', 'logs'));
else if (args.includes('--help')) console.log('--instructions --name --max-turns --quiet --output-format --model stream-json --format json');
else if (args[0] === 'run') {
  readFileSync(0, 'utf8');
  writeFileSync(join(base, 'run-name'), args[args.indexOf('--name') + 1]);
  writeFileSync('result.json', JSON.stringify({ outside: existsSync(${JSON.stringify(join(outside, "SKILL.md"))}), home: existsSync(${JSON.stringify(process.env.HOME ?? "/home")}), shm: existsSync(${JSON.stringify(shm)}), ownHome: existsSync(process.env.HOME) }));
} else if (args[0] === 'session') console.log(JSON.stringify({ messages: [{ role: 'user', content: 'Candidate task' }, { role: 'assistant', content: 'done' }] }));
`, { mode: 0o700 });
    const plan = await prepareEvaluation({ skills: [skill], plugins: [], agents: ["goose"], repetitions: 1, maxTurns: 1, timeout: 0, parallelism: 1, sandbox: "bubblewrap" }, new FilesystemEvaluationSource());
    const host = new GooseHost({ executable, tempRoot: root, env: { PATH: process.env.PATH, OPENAI_API_KEY: "sentinel" } });
    const campaign = await executeEvaluation(plan, new Map([["goose", host]]), new SqliteEvaluationStore(join(root, "output"), join(root, "registry", "evaluations.sqlite")), randomUUID);
    assert.strictEqual(campaign.completed, 2, JSON.stringify(campaign));
    const { readdir } = await import("node:fs/promises");
    for (const trial of await readdir(join(campaign.output, "artifacts"))) {
      const result = JSON.parse(await readFile(join(campaign.output, "artifacts", trial, "workspace/result.json"), "utf8"));
      assert.deepStrictEqual(result, { outside: false, home: false, shm: false, ownHome: true });
    }
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); await rm(shmPath, { force: true }); }
});
