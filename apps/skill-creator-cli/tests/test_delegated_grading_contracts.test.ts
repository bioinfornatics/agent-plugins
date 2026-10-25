import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGradingRequest, buildGradingJudgment, validateGradingRequest, validateGradingJudgment,
  validateGradingRequestBundle, bindJudgmentToRequest, assertNoInvocationReplay,
} from "../dist/scripts/delegated_grading_contracts.js";

const bindings = { assertion_sha256: "a".repeat(64), variant_sha256: "b".repeat(64), output_sha256: "c".repeat(64) };
const grader = { model: "model-a", provider: "acme" };
function request(overrides: Partial<Parameters<typeof buildGradingRequest>[0]> = {}) {
  return buildGradingRequest({
    invocationId: "inv-1",
    prompt: "Prepare a report",
    candidateAlias: "variant-" + "1".repeat(12),
    candidateOutput: "The report cites verified sources.",
    assertion: { id: "a1", version: 1, criterion: "Cites verified sources" },
    instructions: "Judge only the published criterion.",
    bindings,
    grader,
    ...overrides,
  });
}

test("buildGradingRequest / validateGradingRequest round-trip and reject a tampered hash", () => {
  const r = request();
  assert.deepEqual(validateGradingRequest(r), r);
  const tampered = { ...r, prompt: "Different prompt" };
  assert.throws(() => validateGradingRequest(tampered), /request_sha256/);
});

test("grading request rejects unknown fields and non-finite assertion version", () => {
  const r = request() as any;
  assert.throws(() => validateGradingRequest({ ...r, extra: "field" }), /invalid shape/);
  assert.throws(() => validateGradingRequest({ ...r, assertion: { ...r.assertion, version: NaN } }), /invalid shape|positive finite integer/);
  assert.throws(() => validateGradingRequest({ ...r, assertion: { ...r.assertion, version: 1.5 } }), /positive finite integer/);
});

test("grading request refuses a candidate alias that leaks configuration or verdict state", () => {
  for (const alias of ["with_skill-" + "1".repeat(1), "without_skill", "baseline-run", "variant-passfail000000"]) {
    assert.throws(() => request({ candidateAlias: alias }), /must not reveal configuration|must match/);
  }
});

test("grading request bounds prompt, output, instructions, and evidence-adjacent string sizes", () => {
  assert.throws(() => request({ prompt: "x".repeat(64 * 1024 + 1) }), /exceeds the .*byte bound/);
  assert.throws(() => request({ candidateOutput: "x".repeat(256 * 1024 + 1) }), /exceeds the .*byte bound/);
  assert.throws(() => request({ instructions: "x".repeat(4097) }), /exceeds the .*byte bound/);
});

test("grading request bindings must be well-formed SHA-256, not arbitrary strings", () => {
  assert.throws(() => request({ bindings: { ...bindings, assertion_sha256: "not-a-hash" } }), /SHA-256/);
});

test("validateGradingRequestBundle rejects duplicate invocation_id within one bundle", () => {
  const a = request({ invocationId: "dup" });
  const b = request({ invocationId: "dup", candidateAlias: "variant-" + "2".repeat(12) });
  assert.throws(() => validateGradingRequestBundle([a, b]), /duplicate invocation_id/);
  assert.equal(validateGradingRequestBundle([a]).length, 1);
});

test("assertNoInvocationReplay rejects a previously consumed invocation_id", () => {
  const consumed = new Set(["inv-used"]);
  assert.throws(() => assertNoInvocationReplay(consumed, "inv-used"), /already been consumed/);
  assert.doesNotThrow(() => assertNoInvocationReplay(consumed, "inv-fresh"));
});

test("buildGradingJudgment / validateGradingJudgment round-trip and reject a tampered hash", () => {
  const j = buildGradingJudgment({
    invocationId: "inv-1", requestSha256: "d".repeat(64), bindings,
    grader: { id: "grader-a", model: "model-a", provider: "acme" },
    verdict: "pass", evidenceQuote: "cites verified sources", rationale: "supported", usage: { total_tokens: 12 },
  });
  assert.deepEqual(validateGradingJudgment(j), j);
  assert.throws(() => validateGradingJudgment({ ...j, verdict: "fail" }), /judgment_sha256/);
});

test("grading judgment rejects an invalid verdict and non-finite usage", () => {
  const base = { invocationId: "inv-1", requestSha256: "d".repeat(64), bindings, grader: { id: "g", model: "m", provider: "p" }, evidenceQuote: "x", rationale: "y" };
  assert.throws(() => buildGradingJudgment({ ...base, verdict: "yes" as any }), /verdict must be/);
  assert.throws(() => buildGradingJudgment({ ...base, verdict: "pass", usage: { total_tokens: -1 } }), /non-negative finite/);
  assert.throws(() => buildGradingJudgment({ ...base, verdict: "pass", usage: { total_tokens: Infinity } }), /non-negative finite/);
});

test("bindJudgmentToRequest accepts a matching pair and rejects a mismatched invocation, hash, or binding", () => {
  const r = request();
  const j = buildGradingJudgment({
    invocationId: r.invocation_id, requestSha256: r.request_sha256, bindings: r.bindings,
    grader: { id: "grader-a", model: "model-a", provider: "acme" }, verdict: "pass",
    evidenceQuote: "cites verified sources", rationale: "supported",
  });
  assert.doesNotThrow(() => bindJudgmentToRequest(r, j));

  const wrongInvocation = buildGradingJudgment({ invocationId: "different", requestSha256: r.request_sha256, bindings: r.bindings, grader: j.grader, verdict: "pass", evidenceQuote: "x", rationale: "y" });
  assert.throws(() => bindJudgmentToRequest(r, wrongInvocation), /invocation_id does not match/);

  const wrongRequestHash = buildGradingJudgment({ invocationId: r.invocation_id, requestSha256: "e".repeat(64), bindings: r.bindings, grader: j.grader, verdict: "pass", evidenceQuote: "x", rationale: "y" });
  assert.throws(() => bindJudgmentToRequest(r, wrongRequestHash), /request_sha256 does not match/);

  const staleBindings = buildGradingJudgment({ invocationId: r.invocation_id, requestSha256: r.request_sha256, bindings: { ...r.bindings, output_sha256: "f".repeat(64) }, grader: j.grader, verdict: "pass", evidenceQuote: "x", rationale: "y" });
  assert.throws(() => bindJudgmentToRequest(r, staleBindings), /bindings do not match/);
});

test("grading judgment rejects unknown fields (closed schema)", () => {
  const j = buildGradingJudgment({
    invocationId: "inv-1", requestSha256: "d".repeat(64), bindings,
    grader: { id: "grader-a", model: "model-a", provider: "acme" },
    verdict: "pass", evidenceQuote: "x", rationale: "y",
  }) as any;
  assert.throws(() => validateGradingJudgment({ ...j, extra: "field" }), /invalid shape/);
  assert.throws(() => validateGradingJudgment({ ...j, grader: { ...j.grader, secret: "leak" } }), /invalid shape/);
});
