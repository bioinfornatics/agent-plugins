import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalScenarioHash, deriveScenarioPlan, freezeScenarioPlan, scenarioKinds } from "../dist/scripts/freeze_eval_scenarios.js";

const at = "2026-09-17T20:00:00Z";
function locator(path = "outputs/result.json") { return { kind: "json-pointer", path, pointer: "/status" }; }
function semantics(kind: string): unknown {
  if (kind === "normal") return { kind, success_path: "A supported request produces its result." };
  if (kind === "boundary") return { kind, boundary_condition: "The request contains the maximum supported routes." };
  if (kind === "restraint") return { kind, non_goal: "Changing an unrelated file", expected_response: "leave-unchanged" };
  if (kind === "missing-capability") return { kind, unavailable_capability: "filesystem", expected_response: "block" };
  return { kind, preservation_reference: { baseline_id: "release-17", behavior: "Supported requests retain their route status.", evidence_locator: locator("baseline/result.json") } };
}
function complete() {
  const input: any = { skill_name: "demo", language: "en", material_capabilities: [{ id: "route", name: "Route requests", description: "Routes supported requests" }], provenance: { created_by: "user-7", created_at: at, user_edits: [] }, scenarios: [] };
  for (const kind of scenarioKinds) input.scenarios.push({ id: `route-${kind}`, capability_id: "route", kind, name: `route-${kind}`, subject: "Route requests", language: "en", prompt: `Handle the supplied ${kind} routing request using workspace/input.json.`, expected_output: `A ${kind} routing result.`, execution_level: "execute", target: { kind: "existing-skill", execution: "execute", path: "fixtures/demo" }, fixtures: ["fixtures/demo"], files: ["fixtures/demo"], preconditions: ["Fixture is immutable"], budget: { max_turns: 8, timeout_seconds: 120 }, capabilities: { filesystem: true, agent_runner: true, browser: false, network: false, tools: [] }, assertions: [{ id: "a1", subject: "Output status", operator: "equals", expected: kind, locator: locator(), deterministic: true }], review_questions: ["Is the explanation concise for its intended user?"], coverage_tags: [`capability:route`, `category:${kind}`, "language:en"], navigation_expectations: { must_read: ["SKILL.md"], read_when_relevant: [], must_not_read: [] }, semantics: semantics(kind), user_edits: [] });
  return input;
}
const rules = (result: ReturnType<typeof freezeScenarioPlan>) => new Set(result.findings.map(f => f.rule));

test("derivation creates deterministic shells without synthesizing provenance", () => {
  const source = { skill_name: "demo", material_capabilities: [{ id: "one", name: "One" }, { id: "two", name: "Two" }] };
  const first = deriveScenarioPlan(source), second = deriveScenarioPlan(source);
  assert.deepEqual(first, second);
  assert.equal(first.provenance.created_at, "");
  assert.equal(first.scenarios.length, 10);
  for (const id of ["one", "two"]) assert.deepEqual(first.scenarios.filter(s => s.capability_id === id).map(s => s.kind), scenarioKinds);
});

test("complete strict input freezes with structured evidence and explicit empty edit acknowledgements", () => {
  const result = freezeScenarioPlan(complete());
  assert.equal(result.status, "frozen", JSON.stringify(result.findings));
  assert.match(result.canonical_content_sha256!, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.provenance.user_edits, []);
  assert.equal(result.scenarios[0].assertions[0].locator.kind, "json-pointer");
});

test("freeze requires explicit user_edits, complete actors, and strict real UTC timestamps", () => {
  for (const mutate of [
    (x: any) => delete x.provenance.user_edits,
    (x: any) => delete x.scenarios[0].user_edits,
    (x: any) => { x.provenance.created_by = ""; },
    (x: any) => { x.provenance.created_at = "now"; },
    (x: any) => { x.provenance.created_at = "2026-02-31T20:00:00Z"; },
    (x: any) => { x.scenarios[0].user_edits = [{ field: "prompt", after: "x", actor: "", at }]; },
    (x: any) => { x.scenarios[0].user_edits = [{ field: "prompt", after: "x", actor: "u", at: "2026-09-17T22:00:00+02:00" }]; },
  ]) { const input = complete(); mutate(input); assert.equal(freezeScenarioPlan(input).status, "fail"); }
});

test("strict total validation rejects unknown, missing, mistyped, non-finite, and inherited nested values", () => {
  const mutations = [
    (x: any) => { x.scenarios[0].budget.extra = 1; },
    (x: any) => { x.scenarios[0].capabilities.filesystem = "true"; },
    (x: any) => { x.scenarios[0].budget.timeout_seconds = Number.NaN; },
    (x: any) => { delete x.scenarios[0].target.kind; },
    (x: any) => { x.scenarios[0].target.path = ""; },
    (x: any) => { x.scenarios[0].navigation_expectations.must_read = [7]; },
    (x: any) => { x.scenarios[0].assertions[0].unexpected = true; },
    (x: any) => { x.material_capabilities[0] = Object.create({ id: "route" }); x.material_capabilities[0].name = "Route"; x.material_capabilities[0].description = "Route"; },
  ];
  for (const mutate of mutations) { const input = complete(); mutate(input); const result = freezeScenarioPlan(input); assert.equal(result.status, "fail", JSON.stringify(result.findings)); }
});


test("optional root and provenance fields are strictly typed and enum constrained", () => {
  const mutations = [
    (x: any) => { x.schema_version = 1; },
    (x: any) => { x.schema_version = "2.0"; },
    (x: any) => { x.artifact = "other"; },
    (x: any) => { x.status = "ready"; },
    (x: any) => { x.elicitation_questions = [7]; },
    (x: any) => { x.findings = [{ severity: "notice", rule: "x", message: "x" }]; },
    (x: any) => { x.canonical_content_sha256 = 7; },
    (x: any) => { x.provenance.source = 7; },
    (x: any) => { x.provenance.source = ""; },
    (x: any) => { x.scenarios[0].user_edits = [{ field: "prompt", after: "x", actor: "u", at, reason: 7 }]; },
    (x: any) => { x.scenarios[0].user_edits = [{ field: "prompt", after: "x", actor: "u", at, reason: "" }]; },
  ];
  for (const mutate of mutations) { const input = complete(); mutate(input); const result = freezeScenarioPlan(input); assert.equal(result.status, "fail", JSON.stringify(result.findings)); }
});

test("scenario ids are globally unique across capabilities and categories", () => {
  const input = complete(); input.scenarios[1].id = input.scenarios[0].id;
  assert.ok(rules(freezeScenarioPlan(input)).has("scenario-id"));
});

test("coverage tags are non-empty, well formed, and encode capability plus category", () => {
  for (const tags of [[], ["capability:route"], ["scenario:normal"], ["capability:route", "category:normal", "broken"], ["capability:route", "category:normal", "risk:has spaces"], ["capability:other", "category:normal"]]) {
    const input = complete(); input.scenarios[0].coverage_tags = tags;
    assert.ok(rules(freezeScenarioPlan(input)).has("coverage-tags"), JSON.stringify(tags));
  }
});

test("structured assertions close free-form trailing-clause regressions", () => {
  for (const expected of ["normal because metadata is retained", "normal if metadata remains intact", "normal when metadata remains intact", "normal metadata remains intact", "normal status equals routed"]) { const input = complete(); input.scenarios[0].assertions[0].expected = expected; assert.ok(rules(freezeScenarioPlan(input)).has("deterministic-assertion"), expected); }
  for (const operator of ["is", "equal", "frobnitz"]) { const input = complete(); input.scenarios[0].assertions[0].operator = operator; assert.ok(rules(freezeScenarioPlan(input)).has("deterministic-assertion"), operator); }
  const legacy = complete(); legacy.scenarios[0].assertions[0] = { id: "a1", statement: "Output status equals normal because metadata remains intact", evidence_locator: locator(), deterministic: true };
  assert.equal(freezeScenarioPlan(legacy).status, "fail");
});

test("evidence locators are structured, closed, and semantically validated", () => {
  for (const bad of ["outputs/result.json#/status", {}, { kind: "file", path: "" }, { kind: "json-pointer", path: "x.json", pointer: "status" }, { kind: "exit-code", expected: 300 }, { kind: "stdout", pattern: "ok", extra: true }, { kind: "database", query: "x" }]) {
    const input = complete(); input.scenarios[0].assertions[0].locator = bad;
    assert.ok(rules(freezeScenarioPlan(input)).has("evidence-locator") || rules(freezeScenarioPlan(input)).has("unknown-field"), JSON.stringify(bad));
  }
});

test("freeze rejects duplicate and orphan scenarios instead of silently dropping them", () => {
  const duplicate = complete(); duplicate.scenarios.push(structuredClone(duplicate.scenarios[0]));
  assert.ok(rules(freezeScenarioPlan(duplicate)).has("scenario-cardinality"));
  const orphan = complete(); orphan.scenarios.push({ ...structuredClone(orphan.scenarios[0]), id: "ghost-normal", capability_id: "ghost" });
  assert.ok(rules(freezeScenarioPlan(orphan)).has("orphan-scenario"));
});

test("category semantics are required and non-regression needs an evidence-bound preservation reference", () => {
  for (let i = 0; i < scenarioKinds.length; i++) { const input = complete(); input.scenarios[i].semantics = { kind: scenarioKinds[i] }; assert.ok(rules(freezeScenarioPlan(input)).has("category-semantics") || rules(freezeScenarioPlan(input)).has("required-field"), scenarioKinds[i]); }
  const input = complete(); input.scenarios[4].semantics.preservation_reference.baseline_id = "";
  assert.ok(rules(freezeScenarioPlan(input)).has("category-semantics"));
  const labelsOnly = complete(); delete labelsOnly.scenarios[4].semantics; labelsOnly.scenarios[4].coverage_tags.push("preserved:yes");
  assert.equal(freezeScenarioPlan(labelsOnly).status, "fail");
});

test("prompt leakage normalizes morphology and catches short semantic overlap", () => {
  for (const [subject, operator, expected, prompt] of [["File", "exists", true, "Ensure files exist true."], ["Route status", "equals", "ready", "Make routes statuses equal READY."], ["Résumé status", "equals", "ready", "Ensure resume statuses equal ready."], ["Result", "equals", "OK", "Return result equal ok."], ["Citation", "equals", "exact", "The response cited the exact source."]]) { const input = complete(); Object.assign(input.scenarios[0].assertions[0], { subject, operator, expected }); input.scenarios[0].prompt = prompt; assert.ok(rules(freezeScenarioPlan(input)).has("assertion-leakage"), String(prompt)); }
  const safe = complete(); safe.scenarios[0].prompt = "Handle a normal routing request."; assert.equal(freezeScenarioPlan(safe).status, "frozen", JSON.stringify(freezeScenarioPlan(safe).findings));
});

test("prompt leakage stems common verb inflections", () => {
  const families = [
    ["Create marker", "create marker", "creates marker", "created marker", "creating marker"],
    ["Generate report", "generate report", "generates report", "generated report", "generating report"],
    ["Write summary", "write summary", "writes summary", "wrote summary", "written summary", "writing summary"],
    ["Cite source", "cite source", "cites source", "cited source", "citing source", "citation source"],
  ];
  for (const [subject, ...phrases] of families) for (const phrase of phrases) {
    const input = complete(); Object.assign(input.scenarios[0].assertions[0], { subject, operator: "equals", expected: "done" }); input.scenarios[0].prompt = `Please ${phrase} and mark it done.`;
    assert.ok(rules(freezeScenarioPlan(input)).has("assertion-leakage"), `${subject} <- ${phrase}`);
  }
});

test("assertion fields reject conditional, coordinated, and embedded predicate clauses individually", () => {
  const badSubjects = ["Output when routed", "Output and metadata remains intact", "Output but status equals routed"];
  const badExpected = ["normal because input is valid", "normal if metadata exists", "normal when retries fail", "normal and metadata is retained", "normal or status is generated", "normal but report was written", "normal metadata remains intact", "normal status equals routed"];
  for (const field of ["subject", "expected"] as const) for (const value of field === "subject" ? badSubjects : badExpected) {
    const input = complete(); input.scenarios[0].assertions[0][field] = value;
    assert.ok(rules(freezeScenarioPlan(input)).has("deterministic-assertion"), `${field}: ${value}`);
  }
});

test("canonical hash is key-order invariant and ignores only its root hash field", () => {
  const frozen = freezeScenarioPlan(complete());
  const reordered: any = {}; for (const key of Object.keys(frozen).reverse()) reordered[key] = (frozen as any)[key];
  assert.equal(canonicalScenarioHash(frozen), canonicalScenarioHash(reordered));
  reordered.canonical_content_sha256 = "different";
  assert.equal(canonicalScenarioHash(frozen), canonicalScenarioHash(reordered));
});

test("hash is sensitive to every logical frozen field including nested values", () => {
  const frozen = freezeScenarioPlan(complete()); const baseline = canonicalScenarioHash(frozen);
  const mutations = [
    (x: any) => { x.skill_name += "-2"; }, (x: any) => { x.material_capabilities[0].description += "!"; },
    (x: any) => { x.scenarios[0].prompt += " Extra context."; }, (x: any) => { x.scenarios[0].assertions[0].expected += " exactly"; },
    (x: any) => { x.scenarios[0].assertions[0].locator.pointer = "/other"; }, (x: any) => { x.scenarios[0].capabilities.network = true; },
    (x: any) => { x.scenarios[0].budget.max_turns++; }, (x: any) => { x.scenarios[0].semantics.success_path += " Always."; },
    (x: any) => { x.scenarios[4].semantics.preservation_reference.behavior += " Exactly."; }, (x: any) => { x.scenarios[0].user_edits.push({ field: "prompt", after: "changed", actor: "u", at }); },
    (x: any) => { x.provenance.created_at = "2026-09-17T20:00:01Z"; }, (x: any) => { x.findings.push({ severity: "warning", rule: "x", message: "x" }); },
  ];
  for (const mutate of mutations) { const changed = structuredClone(frozen); mutate(changed); assert.notEqual(canonicalScenarioHash(changed), baseline); }
});

test("canonical hash rejects non-JSON, cyclic, and non-finite nested values", () => {
  const frozen: any = freezeScenarioPlan(complete());
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, undefined, 1n, () => 1]) { const changed = structuredClone(frozen); changed.scenarios[0].target.poison = value; assert.throws(() => canonicalScenarioHash(changed)); }
  const cyclic = structuredClone(frozen); cyclic.scenarios[0].target.cycle = cyclic; assert.throws(() => canonicalScenarioHash(cyclic), /cycle/);
});
