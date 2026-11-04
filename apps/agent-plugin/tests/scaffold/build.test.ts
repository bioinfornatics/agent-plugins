import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { startNodeProcess } from "../helpers/subprocess.ts";

const app = fileURLToPath(new URL("../../", import.meta.url));

async function files(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) result.push(...(await files(join(root, entry.name))).map((path) => join(entry.name, path)));
    else result.push(entry.name);
  }
  return result.sort();
}

async function run(cwd: string, ...args: string[]) {
  // No developer/global loader, package search path or real host executable.
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: cwd, XDG_CONFIG_HOME: cwd, PATH: "", NODE_PATH: "", NODE_OPTIONS: "" };
  delete env.NODE_TEST_CONTEXT;
  const result = await startNodeProcess(args, { cwd, env }).completed;
  assert.strictEqual(result.signal, null, result.stderr);
  return result;
}

async function buildFixture(root: string) {
  const fixture = join(root, "build-app");
  await mkdir(fixture);
  for (const path of ["src", "scripts/build.mjs", "tsconfig.json", "tsconfig.build.json", "package.json"]) {
    await cp(join(app, path), join(fixture, path), { recursive: true });
  }
  // Compiler access is build-only. Runtime tests copy real production packages,
  // never this link, and cannot resolve back into the application.
  await symlink(join(app, "node_modules"), join(fixture, "node_modules"), "dir");
  return fixture;
}

test("emitted JavaScript runs help and exact dry-run outside the app with only contained production dependencies", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-plugin-build-"));
  try {
    const fixture = await buildFixture(root);
    const built = await run(fixture, "scripts/build.mjs");
    assert.strictEqual(built.exitCode, 0, built.stderr + built.stdout);
    const output = join(fixture, "dist");
    const emitted = await files(output);
    const source = (await files(join(fixture, "src"))).filter((path) => path.endsWith(".ts"));
    assert.deepStrictEqual(emitted, [...source.map((path) => path.replace(/\.ts$/, ".js")), "package.json"].sort());
    for (const path of emitted.filter((path) => path.endsWith(".js"))) {
      assert.doesNotMatch(await readFile(join(output, path), "utf8"), /(?:from\s*|import\s*\()\s*["'][^"']+\.ts["']/);
    }
    assert.match(await readFile(join(output, "index.js"), "utf8"), /from "\.\/main\.js"/);
    assert.match(await readFile(join(output, "index.js"), "utf8"), /import\.meta\.main/);
    const runtime = join(root, "copied-runtime");
    await cp(output, runtime, { recursive: true });
    const manifest = JSON.parse(await readFile(join(app, "package.json"), "utf8"));
    assert.deepStrictEqual(Object.keys(manifest.dependencies).sort(), ["@commander-js/extra-typings", "commander", "yaml"]);
    for (const dependency of Object.keys(manifest.dependencies)) {
      await cp(join(app, "node_modules", dependency), join(runtime, "node_modules", dependency), { recursive: true, dereference: true });
    }
    // Remove fixture sources before launching, so an accidental source fallback fails.
    await rm(fixture, { recursive: true, force: true });
    const help = await run(runtime, "index.js", "--help");
    assert.strictEqual(help.exitCode, 0, help.stderr);
    assert.match(help.stdout, /Usage: agent-plugin/);
    assert.strictEqual(help.stderr, "");
    const imported = await run(runtime, "--input-type=module", "--eval", "await import('./index.js')", "--", "--unknown");
    assert.deepStrictEqual(imported, { exitCode: 0, signal: null, stdout: "", stderr: "" });
    const skill = join(root, "inputs with spaces", "sample");
    await mkdir(join(skill, "evals"), { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: sample\ndescription: test\n---\n");
    await writeFile(join(skill, "evals/evals.json"), JSON.stringify({ evals: [{ id: 1, prompt: "Exact prompt", expectations: ["Exact criterion"] }] }));
    const prepared = await run(runtime, "index.js", "evaluation", "--skills", skill, "--dry-run");
    assert.strictEqual(prepared.exitCode, 0, prepared.stderr);
    assert.strictEqual(prepared.stderr, "");
    const plan = JSON.parse(prepared.stdout);
    assert.strictEqual(plan.status, "prepared");
    assert.strictEqual(plan.candidateRuns, 6);
    assert.strictEqual(plan.profile.scenarios[0].prompt, "Exact prompt");
    assert.deepStrictEqual(plan.profile.scenarios[0].expectations, ["Exact criterion"]);
    await rm(join(runtime, "node_modules/commander"), { recursive: true });
    const missing = await run(runtime, "index.js", "--help");
    assert.notStrictEqual(missing.exitCode, 0);
    assert.strictEqual(missing.stdout, "");
    assert.match(missing.stderr, /ERR_MODULE_NOT_FOUND/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("compiler failure preserves prior dist byte-for-byte and successful rebuild retires stale files", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-plugin-build-failure-"));
  try {
    const fixture = await buildFixture(root);
    await mkdir(join(fixture, "dist"));
    await writeFile(join(fixture, "dist/prior.js"), "previous working output\n");
    await writeFile(join(fixture, "src/build-error.ts"), 'const broken: number = "not a number";\n');
    const failed = await run(fixture, "scripts/build.mjs");
    assert.notStrictEqual(failed.exitCode, 0);
    assert.match(failed.stdout + failed.stderr, /TS2322/);
    assert.deepStrictEqual(await files(join(fixture, "dist")), ["prior.js"]);
    assert.strictEqual(await readFile(join(fixture, "dist/prior.js"), "utf8"), "previous working output\n");
    assert.strictEqual((await readdir(fixture)).some((path) => path.startsWith(".build-")), false);
    await rm(join(fixture, "src/build-error.ts"));
    const rebuilt = await run(fixture, "scripts/build.mjs");
    assert.strictEqual(rebuilt.exitCode, 0, rebuilt.stdout + rebuilt.stderr);
    assert.strictEqual((await files(join(fixture, "dist"))).includes("prior.js"), false);
    assert.strictEqual((await readdir(fixture)).some((path) => path.startsWith(".build-")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
