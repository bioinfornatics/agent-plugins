import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeOutput, isMetaGradingClaim } from "../dist/scripts/evaluator_grading.js";

const criterion = "The output selects small-task mode with numeric score not applicable.";
const quote = "Review mode: independent, read-only, qualitative review. No numeric score is requested or planned.";

async function evaluate(output: string, evidence: string, assertion = criterion, second = "pass") {
  let calls = 0;
  return gradeOutput({ prompt: "Synthetic filter regression only", output,
    assertions: [assertion], variantSha256: "a".repeat(64),
    graders: [{ id: "a", model: "fixture" }, { id: "b", model: "fixture" }],
    adapter: { async grade() { return { raw: JSON.stringify({ verdict: calls++ ? second : "pass", evidence_quote: evidence, rationale: "fixture" }), usage: null }; } },
    budget: { used: 0, limit: 2 } });
}

test("criterion-requested score vocabulary is valid domain evidence, not auto-grading", async () => {
  assert.equal(isMetaGradingClaim(criterion, quote), false);
  const result = await evaluate(quote, quote);
  assert.equal(result.grading.expectations[0].verdict, "pass");
  assert.ok(result.graderEvidence.every(j => j.valid_evidence));
});

test("domain exception retains exact containment, lexical gate and disagreement handling", async () => {
  for (const [output, evidence, assertion, second] of [
    ["Other output", quote, criterion, "pass"],
    ["No numeric score requested", "No numeric score requested", "Contains verified source citations", "pass"],
    [quote, quote, criterion, "fail"],
  ]) {
    const result = await evaluate(output, evidence, assertion, second);
    assert.equal(result.grading.expectations[0].verdict, "inconclusive");
  }
});

test("shared meta-claim gate still rejects self-awarded outcomes and keyword-only overlap", () => {
  for (const evidence of ["I pass this criterion", "score: 100", "the grade is pass", "numeric score: 100", "score"])
    assert.equal(isMetaGradingClaim(criterion, evidence), true, evidence);
  assert.equal(isMetaGradingClaim("Numeric score for the release", "I assign myself a numeric score of 100"), true);
  assert.equal(isMetaGradingClaim("The output selects small-task mode", quote), true);
});
