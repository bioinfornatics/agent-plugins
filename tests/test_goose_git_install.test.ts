import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { projectProduction } from "../scripts/production.mjs";
import { isolatedEnvironment, selectGoose, testProductionInstall } from "../scripts/test-production-install.mjs";

test("required native Git gate rejects absent or conflicting explicit hosts, never PATH fallback", () => {
  assert.throws(() => selectGoose({ PATH: "/usr/local/bin" }), /set GOOSE_EXECUTABLE or GOOSE_TEST_BINARY explicitly/);
  assert.throws(() => selectGoose({ GOOSE_EXECUTABLE: "/a/goose", GOOSE_TEST_BINARY: "/b/goose" }), /conflicting/);
  assert.equal(selectGoose({ GOOSE_EXECUTABLE: "/usr/local/bin/goose" }), "/usr/local/bin/goose");
});

test("install environment excludes operator credentials, config and loader overrides", () => {
  const env = isolatedEnvironment("/private/qa", { PATH: "/usr/bin", HOME: "/operator", NODE_OPTIONS: "--import hostile", NODE_PATH: "/global", OPENAI_API_KEY: "secret", GIT_CONFIG_COUNT: "99", GOOSE_CONFIG_DIR: "/operator/config" });
  assert.equal(env.HOME, "/private/qa/home"); assert.equal(env.GOOSE_PATH_ROOT, "/private/qa/goose");
  for (const name of ["NODE_OPTIONS", "NODE_PATH", "OPENAI_API_KEY", "GOOSE_CONFIG_DIR"]) assert.equal(env[name], undefined, name);
  assert.equal(env.GIT_CONFIG_COUNT, "1"); assert.equal(env.GIT_TERMINAL_PROMPT, "0");
});

test("explicit native Goose installs and updates isolated projected Node distribution", { timeout: 180_000 }, () => {
  // Missing host is a failure in CI and locally; caller must select the measured binary.
  const goose = selectGoose(process.env);
  const temp = mkdtempSync(join(tmpdir(), "node-goose-git-install "));
  try {
    const candidate = join(temp, "candidate");
    const projection = projectProduction(candidate);
    const result = testProductionInstall(candidate, { env: { PATH: process.env.PATH, GOOSE_EXECUTABLE: goose } });
    assert.equal(result.status, "passed");
    assert.equal(result.goose.executable, goose); assert.match(result.goose.version, /\d+\.\d+\.\d+/);
    assert.match(result.goose.sha256, /^[a-f0-9]{64}$/);
    assert.equal(result.candidate.sourceCommit, projection.sourceCommit);
    for (const guarantee of ["gitInstall", "gitUpdate", "skillsListAfterInstall", "skillsListAfterUpdate", "readOnlyHistory"]) assert.equal(result[guarantee], true, guarantee);
    assert.equal(result.discoveredSkills, 5); assert.equal(result.standaloneCommands, 1);
    assert.equal(result.developmentLeakage, 0); assert.equal(result.removedCanaries, 7);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
