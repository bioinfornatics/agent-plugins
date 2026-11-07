import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const readJson = (relative: string) => JSON.parse(readFileSync(path.join(root, relative), "utf8"));

// Guarantee retirement: native compilation/staging, archive installation, force
// replacement, installer logging and symlink/tampering tests belonged to the
// retired Bun facade. Their removal is not acceptance of those native guarantees.
// Current installation isolation and Git install/update safety have their own
// public seam in scripts/test-production-install.mjs and
// tests/test_production_install_contract.test.ts; do not replace it with copied
// stage inventories or installer mocks here. These facade checks only read files
// and invoke Make help/dry-runs, never build, clean or mutate an installation.
function make(args: string[]): string {
  const result = spawnSync("make", ["--no-print-directory", ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stderr, "");
  return result.stdout;
}

test("developer runtime mapping retains the single contained Node evaluation app", () => {
  // Detect accidentally restoring a retired compiler or moving installation to app sources.
  const mapping = readJson("config/skill-runtimes/skill-runtime-map.json");
  assert.equal(mapping.node, ">=22.22.2");
  assert.equal(mapping.skills.length, 1);
  assert.equal(mapping.skills[0].logicalName, "skill-creator");
  assert.equal(mapping.skills[0].skill, "skills/skill-creator");
  assert.equal(mapping.skills[0].app, "apps/agent-plugin");
  assert.equal(mapping.skills[0].sourceEntry, "src/index.ts");
  assert.equal(mapping.skills[0].emittedEntry, "dist/index.js");
  const app = readJson("apps/agent-plugin/package.json");
  assert.equal(app.scripts.build, "node scripts/build.mjs");
  assert.equal(app.engines.node, ">=22.22.2");
});

test("Make help advertises only current help, clean and test developer commands", () => {
  // Execute the real public help seam: stale native advice is a user-visible regression.
  const help = make(["help"]);
  assert.match(help, /Node\.js/);
  assert.match(help, /make clean[^\n]*(?:[Rr]emove|[Cc]lean)[^\n]*generated/);
  assert.match(help, /make test[^\n]*(?:[Rr]un|[Tt]est)[^\n]*(?:canonical|suite|tests)/);
  const advertised = [...help.matchAll(/\bmake\s+([\w-]+)/g)].map(match => match[1]);
  assert.ok(advertised.includes("clean"));
  assert.ok(advertised.includes("test"));
  for (const command of advertised) assert.ok(["help", "clean", "test"].includes(command), command);
  assert.doesNotMatch(help, /\bbun\b|staging\s*->|\.agents\/plugins/i);
});

test("root package uses Node and does not reference removed script files", () => {
  // Catch dangling package entrypoints, including scripts renamed outside the retired list.
  const pkg = readJson("package.json");
  assert.equal(pkg.engines.node, ">=22.22.2");
  assert.equal(pkg.engines.bun, undefined);
  assert.equal(pkg.packageManager, undefined);
  assert.equal(pkg.scripts.clean, "node scripts/clean.mjs");
  assert.equal(pkg.scripts.test, "node scripts/test.mjs");
  for (const retired of [
    "build:executables", "test:executables", "test:release", "stage:release",
    "package:release", "package:offline", "test:offline", "bundle", "release", "install:plugin",
  ]) assert.equal(pkg.scripts[retired], undefined, retired);
  for (const [name, command] of Object.entries(pkg.scripts) as [string, string][]) {
    assert.doesNotMatch(command, /\bbun\b/, name);
    assert.doesNotMatch(command, /scripts\/(?:build-bun-executables|package-bun-release-assets|package-offline|test-offline-bundle|release-all|install-staged-plugin)\.mjs/, name);
    for (const match of command.matchAll(/\b(?:scripts|tests)\/[\w./-]+\.(?:mjs|[cm]?js|ts|py|sh)\b/g)) {
      assert.ok(existsSync(path.join(root, match[0])), `${name} references missing ${match[0]}`);
    }
  }
});

test("Make test and clean dry-runs delegate directly to canonical Node scripts", () => {
  // -n is essential: actually running clean/test would mutate shared build outputs.
  for (const [target, script] of [["test", "test.mjs"], ["clean", "clean.mjs"]]) {
    assert.equal(make(["-n", target]).trim(), `node scripts/${script}`);
  }
});
