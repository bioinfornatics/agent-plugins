import { tmpdir } from "node:os";
import { materializeFixtures } from "../../../skills/plugin-creator/assets/materialize-fixtures.mjs";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { validateAgentPluginSchema } from "../dist/scripts/validate_agent_plugin_schema.js";
import { validate } from "../dist/scripts/validate_goose_plugin.js";

const ROOT = resolve("../../skills/plugin-creator");
const FIXTURES = materializeFixtures(join(ROOT, "assets", "evaluation-fixtures"), join(mkdtempSync(join(tmpdir(), "plugin-fixtures-")), "corpus"));
after(() => rmSync(dirname(FIXTURES), { recursive: true, force: true }));

test("plugin fixtures distinguish schema conformance, operational readiness, and component changes", () => {
  const minimal = join(FIXTURES, "schema-invalid");
  assert.equal(validateAgentPluginSchema(minimal).valid, true);
  const operational = validate(minimal);
  assert.ok(operational.errors.some((item) => item.includes("version must be a non-empty string")));
  assert.ok(operational.errors.some((item) => item.includes("contains no skills")));

  for (const relative of ["package-ready", "multi-component/baseline", "multi-component/current"]) {
    assert.deepEqual(validate(join(FIXTURES, relative)).errors, [], relative);
  }
  assert.equal(existsSync(join(FIXTURES, "multi-component/baseline/hooks/hooks.json")), false);
  assert.equal(existsSync(join(FIXTURES, "multi-component/current/hooks/hooks.json")), true);
  assert.equal(existsSync(join(FIXTURES, "multi-component/current/integration/evals.json")), true);
});

test("plugin creator evals have explicit targets, execution levels, and no hidden run claims", () => {
  const document = JSON.parse(readFileSync(join(ROOT, "evals", "evals.json"), "utf8"));
  assert.equal(document.evals.length, 5);
  assert.equal(document.evals.filter((item: any) => item.language === "fr").length, 1);
  for (const item of document.evals) {
    assert.ok(item.subject && item.target?.kind && item.preconditions?.length);
    assert.match(item.target.execution, /^(explain|dry-run|execute|resume)$/);
    assert.ok(item.coverage_tags.includes(`language:${item.language}`));
    assert.doesNotMatch(item.prompt, /\b(?:this|that) plugin\b|ce plugin/i);
  }
  const explain = document.evals.find((item: any) => item.id === 4);
  assert.equal(explain.target.execution, "explain");
  assert.match(explain.prompt, /N’affirme pas que l’évaluation a été exécutée/);
  const resume = document.evals.find((item: any) => item.id === 5);
  assert.equal(resume.target.execution, "resume");
  assert.match(resume.assertions.join("\n"), /still blocks|missing/i);
});
