import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "..");
const CLI = join(ROOT, "dist", "cli.js");

function makePlugin(root: string): string {
  const plugin = join(root, "demo-plugin");
  mkdirSync(plugin);
  writeFileSync(join(plugin, "plugin.json"), JSON.stringify({ name: "demo-plugin", version: "1.0.0" }));
  return plugin;
}

function run(args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf-8" });
}

test("CLI help and usage exits", () => {
  const help = run(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: hook-creator/);
  const quietHelp = run(["--quiet", "--format=json", "--help"]);
  assert.equal(quietHelp.status, 0);
  assert.match(JSON.parse(quietHelp.stdout).help, /Usage: hook-creator/);
  assert.equal(run([]).status, 2);
  assert.equal(run(["unknown"]).status, 2);
  assert.equal(run(["validate"]).status, 2);
  assert.equal(run(["init", "somewhere"]).status, 2);
  assert.equal(run(["validate", "x", "--format", "yaml"]).status, 2);
});

test("unified init and validate support text, JSON, quiet, and failure exits", () => {
  const tmp = mkdtempSync(join(tmpdir(), "hook-cli-test-"));
  try {
    const plugin = makePlugin(tmp);
    const initialized = run(["init", plugin, "PostToolUse", "record-tool", "--matcher", "developer__shell", "--timeout=10", "--format", "json"]);
    assert.equal(initialized.status, 0, initialized.stderr);
    const initJson = JSON.parse(initialized.stdout);
    assert.equal(initJson.ok, true);
    assert.equal(initJson.command, "init");
    assert.equal(initJson.scriptPath, join(plugin, "scripts", "record-tool.sh"));

    const valid = run(["--format=json", "validate", plugin]);
    assert.equal(valid.status, 0, valid.stderr);
    const validJson = JSON.parse(valid.stdout);
    assert.equal(validJson.ok, true);
    assert.deepEqual(validJson.errors, []);
    assert.equal(run(["validate", plugin, "--quiet"]).stdout, "");

    const duplicate = run(["--format", "json", "init", plugin, "PostToolUse", "record-tool"]);
    assert.equal(duplicate.status, 1);
    assert.equal(JSON.parse(duplicate.stdout).ok, false);

    writeFileSync(join(plugin, "hooks", "hooks.json"), JSON.stringify({ hooks: { UnknownEvent: [] } }));
    const invalid = run(["validate", plugin, "--format=json", "--quiet"]);
    assert.equal(invalid.status, 1);
    const invalidJson = JSON.parse(invalid.stdout);
    assert.equal(invalidJson.ok, false);
    assert.ok(invalidJson.errors.length > 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("CLI module import has no process side effects", () => {
  const imported = spawnSync(process.execPath, ["--input-type=module", "--eval", `await import(${JSON.stringify(pathToFileURL(CLI).href)}); console.log('imported')`], { encoding: "utf-8" });
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, "imported\n");
});

test("package exposes the unified binary", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  assert.equal(pkg.bin["hook-creator"], "dist/cli.js");
});
