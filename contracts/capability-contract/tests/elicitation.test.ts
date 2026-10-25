import assert from "node:assert/strict";
import test from "node:test";
import { planAdaptiveElicitation } from "../dist/elicitation.js";

const field = (id: string, state: "known" | "assumed" | "unknown" | "contradictory", decisions: Array<"architecture" | "safety" | "evaluation">, ambiguity: "ordinary" | "destructive" | "security" | "production" | "untestable" = "ordinary") => ({
  id, label: id, state, evidence: [], decisions, ambiguity, question: `Confirm ${id}?`,
  ...(ambiguity === "ordinary" ? { default: { value: "conservative", reversible: true as const, consequence: `May limit ${id}.` } } : {}),
});

const request = (fields: ReturnType<typeof field>[], extra = {}) => ({ version: "1.0.0", outcome: "Write reusable instructions", fields, ...extra });

test("novice scenario asks no more than three deterministic high-value questions", () => {
  const result = planAdaptiveElicitation(request([
    field("format", "unknown", ["architecture"]), field("threats", "unknown", ["safety"]),
    field("metric", "contradictory", ["evaluation"]), field("scope", "assumed", ["architecture"]),
  ], { expertise: "novice" }));
  assert.deepEqual(result.questions.map((q) => q.fieldId), ["threats", "format", "metric"]);
  assert.equal(result.questions.length, 3);
  assert.equal(result.preview.ready, true);
  assert.deepEqual(result.preview.unansweredOptionalFieldIds.sort(), ["format", "metric", "scope", "threats"]);
});

test("expert scenario suppresses low-value assumptions and preserves recommendation API output", () => {
  const result = planAdaptiveElicitation(request([field("scope", "assumed", ["architecture"]), field("metric", "unknown", ["evaluation"])], { expertise: "expert" }));
  assert.deepEqual(result.questions.map((q) => q.fieldId), ["metric"]);
  assert.equal(result.recommendation.recommendation, "skill");
});

test("sparse optional input is preview-ready with reversible defaults and consequences", () => {
  const result = planAdaptiveElicitation(request([field("runtime", "unknown", ["architecture"])]));
  assert.equal(result.preview.ready, true);
  assert.deepEqual(result.preview.appliedDefaults, [{ fieldId: "runtime", value: "conservative", consequence: "May limit runtime.", reversible: true }]);
});

test("contradictory evidence is modeled, ranked above an otherwise equal unknown, cloned, and context-deduplicated", () => {
  const input = request([{ ...field("platform", "contradictory", ["architecture"]), evidence: [{ id: "doc-a", state: "known" as const, summary: "Linux" }, { id: "doc-b", state: "contradictory" as const, summary: "Windows" }] }, field("runtime", "unknown", ["architecture"])]);
  const before = JSON.stringify(input);
  const result = planAdaptiveElicitation(input);
  assert.deepEqual(result.questions.map((q) => q.fieldId), ["platform", "runtime"]);
  assert.ok(result.questions[0].value.score > result.questions[1].value.score);
  assert.equal(result.model.fields[0].evidence.length, 2);
  assert.notEqual(result.model.fields[0], input.fields[0]);
  assert.equal(JSON.stringify(input), before);
  const deduplicated = planAdaptiveElicitation({ ...input, context: { askedQuestionIds: ["field:platform"] } });
  assert.deepEqual(deduplicated.questions.map((q) => q.fieldId), ["runtime"]);
});

test("missing ordinary defaults are generated deterministically with consequences", () => {
  const withoutDefault = { ...field("runtime", "unknown", ["architecture"]) };
  delete (withoutDefault as { default?: unknown }).default;
  const first = planAdaptiveElicitation(request([withoutDefault]));
  const second = planAdaptiveElicitation(request([withoutDefault]));
  assert.deepEqual(first, second);
  assert.deepEqual(first.questions[0].default, first.model.fields[0].default);
  assert.deepEqual(first.preview.appliedDefaults, [{ fieldId: "runtime", value: "conservative", consequence: "Uses a conservative provisional choice for runtime; change it before finalization if needed.", reversible: true }]);
});

test("context-resolved fields are preserved without generated defaults", () => {
  const resolved = { ...field("runtime", "unknown", ["architecture"]) };
  delete (resolved as { default?: unknown }).default;
  const result = planAdaptiveElicitation(request([resolved], { context: { answeredFieldIds: ["runtime"] } }));
  assert.equal(result.model.fields[0].default, undefined);
  assert.deepEqual(result.preview.appliedDefaults, []);
});

test("hostile getters, proxies, symbols, and cycles return one sanitized validation error", () => {
  const getter = Object.defineProperty({}, "version", { enumerable: true, get() { throw new Error("SECRET getter detail"); } });
  const proxy = new Proxy({}, { ownKeys() { throw new Error("SECRET proxy detail"); } });
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  const symbol = request([]) as Record<PropertyKey, unknown>; symbol[Symbol("SECRET")] = true;
  for (const bad of [getter, proxy, cycle, symbol]) assert.throws(() => planAdaptiveElicitation(bad), (error: unknown) => error instanceof TypeError && error.message === "request contains an inaccessible, accessor-backed, cyclic, or excessively nested value");
});

test("safety and production ambiguity always blocks preview and never receives defaults", () => {
  const result = planAdaptiveElicitation(request([
    field("credential-boundary", "unknown", ["safety"], "security"),
    field("delete-policy", "assumed", ["safety"], "destructive"),
    field("deployment", "unknown", ["architecture"], "production"),
    field("oracle", "unknown", ["evaluation"], "untestable"),
  ], { expertise: "expert", context: { askedQuestionIds: ["field:credential-boundary"] } }));
  assert.equal(result.preview.ready, false);
  assert.equal(result.preview.blockers.length, 4);
  assert.deepEqual(result.deferredMandatoryFieldIds, ["credential-boundary"]);
  assert.ok(result.questions.every((q) => q.mandatory && q.default === undefined));
});

test("strict total validation rejects malformed nested values without mutation", () => {
  const valid = request([field("scope", "unknown", ["architecture"])]);
  for (const bad of [null, {}, { ...valid, extra: true }, { ...valid, fields: [{ ...valid.fields[0], decisions: [] }] }, { ...valid, fields: [{ ...valid.fields[0], ambiguity: "security", default: valid.fields[0].default }] }, { ...valid, context: { askedQuestionIds: ["BAD ID"] } }]) assert.throws(() => planAdaptiveElicitation(bad), TypeError);
});
