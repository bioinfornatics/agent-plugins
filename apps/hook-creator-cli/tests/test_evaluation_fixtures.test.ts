import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { validateHook } from "../dist/validate_hook.js";

const ROOT = resolve(".");
const FIXTURES = join(ROOT, "tests", "fixtures", "evaluation-fixtures");

test("hook fixtures have known validation and runtime behavior", () => {
  const valid = validateHook(join(FIXTURES, "exact-rm-guard"));
  assert.deepEqual(valid.errors, []);
  const invalid = validateHook(join(FIXTURES, "unsafe-stop-hook"));
  assert.ok(invalid.errors.some((item) => item.includes("matcher '*'")));
  assert.ok(invalid.errors.some((item) => item.includes("missing-handler.sh")));

  const script = join(FIXTURES, "exact-rm-guard/scripts/block-rm-root.py");
  assert.ok(statSync(script).mode & 0o111);
  const allow = spawnSync(script, { input: readFileSync(join(FIXTURES, "exact-rm-guard/payloads/allow.json")), encoding: "utf8" });
  const block = spawnSync(script, { input: readFileSync(join(FIXTURES, "exact-rm-guard/payloads/block.json")), encoding: "utf8" });
  assert.equal(allow.status, 0);
  assert.equal(block.status, 2);
  assert.match(block.stderr, /Blocked exact root deletion/);
});

test("hook creator evals are autonomous and execution-level aligned", () => {
  const document = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "evals.json"), "utf8"));
  assert.equal(document.evals.length, 4);
  assert.equal(document.evals.filter((item: any) => item.language === "fr").length, 1);
  for (const item of document.evals) {
    assert.ok(item.subject && item.target?.kind && item.preconditions?.length);
    assert.match(item.target.execution, /^(explain|dry-run|execute|resume)$/);
    assert.ok(item.coverage_tags.includes(`language:${item.language}`));
    assert.doesNotMatch(item.prompt, /\b(?:this|that) hook\b|ce hook/i);
  }
  assert.equal(document.evals.find((item: any) => item.id === 4).target.execution, "explain");
  assert.match(document.evals.find((item: any) => item.id === 4).prompt, /Ne package ni ne publie rien/);
});
