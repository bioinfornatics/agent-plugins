import { tmpdir } from "node:os";
import { materializeFixtures } from "../../../skills/skill-creator/assets/materialize-fixtures.mjs";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { validateSkill } from "../dist/scripts/quick_validate.js";
import { validateEvaluationReceipt } from "../dist/scripts/validate_evaluation_receipt.js";
import { designEvals } from "../dist/scripts/design_evals.js";

const SKILL = resolve(process.env.SKILL_CREATOR_SKILL_ROOT ?? "../../skills/skill-creator");
const FIXTURES = materializeFixtures(join(SKILL, "assets", "evaluation-fixtures"), join(mkdtempSync(join(tmpdir(), "skill-fixtures-")), "corpus"));
after(() => rmSync(dirname(FIXTURES), { recursive: true, force: true }));

test("evaluation fixtures have their documented deterministic properties", () => {
  for (const [relative, expected] of [
    ["frontmatter-invalid", /Unexpected key.*permissionMode/],
    ["frontmatter-name-mismatch", /must match skill directory/],
    ["frontmatter-missing-description", /Missing 'description'/],
    ["frontmatter-malformed-yaml", /Invalid YAML/],
  ] as const) {
    const result = validateSkill(join(FIXTURES, relative));
    assert.equal(result[0], false, relative);
    assert.match(result[1], expected, relative);
  }

  for (const relative of [
    "skill-comparison/baseline/invoice-normalizer",
    "skill-comparison/current/invoice-normalizer",
  ]) {
    const result = validateSkill(join(FIXTURES, relative));
    assert.equal(result[0], true, `${relative}: ${result[1]}`);
  }

  const current = readFileSync(join(FIXTURES, "skill-comparison/current/invoice-normalizer/SKILL.md"), "utf8");
  assert.match(current, /Use when/);
  assert.match(current, /references\/field-contract\.md/);
  assert.match(current, /scripts\/validate_record\.py/);
  assert.ok(current.split(/\r?\n/).length <= 500);

  const baseline = readFileSync(join(FIXTURES, "skill-comparison/baseline/invoice-normalizer/SKILL.md"), "utf8");
  assert.doesNotMatch(baseline, /Use when/);
  assert.doesNotMatch(baseline, /validate_record\.py/);
  assert.ok(current.length > baseline.length);

  const validator = join(FIXTURES, "skill-comparison/current/invoice-normalizer/scripts/validate_record.py");
  const validRecord = join(FIXTURES, "skill-comparison/records/valid.json");
  const invalidRecord = join(FIXTURES, "skill-comparison/records/invalid-total.json");
  const validResult = spawnSync("python3", [validator, validRecord], { encoding: "utf8" });
  assert.equal(validResult.status, 0, validResult.stderr);
  assert.match(validResult.stdout, /OK/);
  const invalidResult = spawnSync("python3", [validator, invalidRecord], { encoding: "utf8" });
  assert.notEqual(invalidResult.status, 0);
  assert.match(invalidResult.stderr, /does not equal total/);

  const partial = validateEvaluationReceipt(join(FIXTURES, "partial-evaluation-workspace"));
  assert.equal(partial.status, "blocked");
  assert.ok(partial.missing.some((item) => /old_skill or without_skill run/.test(item)));

  const complete = validateEvaluationReceipt(join(FIXTURES, "completed-evaluation-workspace"));
  assert.equal(complete.status, "complete");
});

test("skill-creator scenarios are autonomous, target-backed, and intentionally multilingual", () => {
  const evalPath = join(SKILL, "evals", "evals.json");
  const document = JSON.parse(readFileSync(evalPath, "utf8"));
  const result = designEvals(evalPath, SKILL);
  assert.equal(result.status, "pass", JSON.stringify(result.findings));
  assert.equal(result.summary.warnings, 0);
  assert.deepEqual(document.evals.map((item: any) => item.id), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const [id, mode, name] of [
    [7, "action-local-authoring", "phase-skill-created-without-recurring-authoring-fixes"],
    [8, "blocked-phase-authoring", "bounded-document-review-and-blocked-delivery"],
  ] as const) {
    const scenario = document.evals.find((item: any) => item.id === id);
    assert.equal(scenario.name, name);
    assert.equal(scenario.target.kind, "new-skill");
    assert.ok(scenario.coverage_tags.includes(`mode:${mode}`));
    assert.ok(document.coverage_dimensions.mode.includes(mode));
  }
  assert.equal(document.evals.filter((item: any) => item.language === "fr").length, 1);

  for (const item of document.evals) {
    assert.ok(item.subject);
    assert.ok(item.language);
    assert.ok(item.target?.kind);
    assert.ok(item.preconditions?.length);
    assert.ok(item.coverage_tags.includes(`language:${item.language}`));
    assert.doesNotMatch(item.prompt, /\b(?:this|that) skill\b|\bcette skill\b/i);
    for (const path of item.files ?? []) assert.ok(existsSync(join(SKILL, path)), `${item.id}: ${path}`);
  }
});

test("quick validation guidance uses a canonical absolute skill path", () => {
  const guidance = readFileSync(join(SKILL, "AGENTS.md"), "utf8");
  assert.doesNotMatch(guidance, /skill-creator validate \.`/);
  assert.match(guidance, /skill-creator validate \"\$\(realpath \.\)\"/);
  const result = validateSkill(SKILL);
  assert.equal(result[0], true, result[1]);
});
