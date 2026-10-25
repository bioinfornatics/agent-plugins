import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAgent, AgentFormatError } from "../dist/scripts/agent_format.js";
import { validateEvalSet } from "../dist/scripts/run_agent_eval.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const FIXTURES = join(ROOT, "test-resources", "evaluation-fixtures");

test("agent evaluation fixtures expose valid current/baseline and known invalid metadata", () => {
  const current = parseAgent(join(FIXTURES, "role-comparison/current/security-reviewer.md"));
  const baseline = parseAgent(join(FIXTURES, "role-comparison/baseline/security-reviewer.md"));
  assert.equal(current.name, baseline.name);
  assert.ok(current.body.length > baseline.body.length);
  assert.match(current.body, /attack preconditions/);
  assert.doesNotMatch(baseline.body, /attack preconditions/);
  assert.throws(
    () => parseAgent(join(FIXTURES, "invalid-agent.md")),
    (error: unknown) => error instanceof AgentFormatError && /permissionMode, tools/.test(error.message)
  );
  const evals = JSON.parse(readFileSync(join(FIXTURES, "role-comparison/evals.json"), "utf8"));
  assert.equal(evals.evals.length, 2);
});

test("agent creator ships autonomous target-backed evaluations", () => {
  const document = JSON.parse(readFileSync(join(ROOT, "test-resources", "evals", "evals.json"), "utf8"));
  const cases = validateEvalSet(document);
  assert.equal(cases.length, 4);
  assert.equal(cases.filter((item: any) => item.language === "fr").length, 1);
  for (const item of cases as any[]) {
    assert.ok(item.subject);
    assert.ok(item.target?.kind);
    assert.match(item.target.execution, /^(explain|dry-run|execute|resume)$/);
    assert.ok(item.preconditions.length);
    assert.ok(item.coverage_tags.includes(`language:${item.language}`));
    assert.doesNotMatch(item.prompt, /\b(?:this|that) agent\b|cet agent/i);
  }
});
