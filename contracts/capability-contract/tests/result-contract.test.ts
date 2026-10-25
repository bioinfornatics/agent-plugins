import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  RESULT_CONTRACT_SCHEMA_ID, RESULT_CONTRACT_VERSION, LEGACY_STATUS_MAPPINGS,
  aggregateResultContracts, classifyResultExit, mapLegacyStatus, normalizeResultContract,
  validateResultContract,
} from "../dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(root, "..", "..");
const json = (path: string): any => JSON.parse(readFileSync(join(root, path), "utf8"));
const schema = json("schema/1.0.0/result-contract.schema.json") as { $id: string };
const schemaValidate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const completed = (verdict: "pass" | "fail" | "inconclusive" | "not-applicable" = "not-applicable", approval: "pending" | "approved" | "rejected" | "not-applicable" = "not-applicable", evidence?: "available" | "partial" | "unavailable") => ({
  schemaVersion: "1.0.0", operation: { state: "completed" },
  evaluation: { applicable: verdict !== "not-applicable", verdict },
  evidence: { applicable: verdict !== "not-applicable" || approval !== "not-applicable", availability: evidence ?? (verdict === "pass" || verdict === "fail" || approval === "approved" || approval === "rejected" ? "available" : verdict === "inconclusive" || approval === "pending" ? "unavailable" : "not-applicable") },
  approval: { applicable: approval !== "not-applicable", state: approval, ...(approval !== "not-applicable" ? { context: "production-review" } : {}) },
});

function validContracts(): any[] {
  const values: any[] = [];
  for (const state of ["planned","running","completed","blocked","failed"])
    for (const verdict of ["pass","fail","inconclusive","not-applicable"])
      for (const availability of ["available","partial","unavailable","not-applicable"])
        for (const approval of ["pending","approved","rejected","not-applicable"]) {
          const value = { schemaVersion:"1.0.0", operation:{state}, evaluation:{applicable:verdict!=="not-applicable",verdict}, evidence:{applicable:availability!=="not-applicable",availability}, approval:{applicable:approval!=="not-applicable",state:approval,...(approval!=="not-applicable"?{context:"production-review"}:{})} };
          if (validateResultContract(value).valid) values.push(value);
        }
  return values;
}

const permutations = <T>(items: readonly T[]): T[][] => items.length < 2 ? [Array.from(items)] : items.flatMap((item, index) => permutations([...items.slice(0,index),...items.slice(index+1)]).map((rest) => [item,...rest]));

test("result schema and exports are versioned", () => {
  assert.equal(RESULT_CONTRACT_VERSION, "1.0.0");
  assert.equal(schema.$id, RESULT_CONTRACT_SCHEMA_ID);
  assert.match(schema.$id, /result-contract\/1\.0\.0/);
});

test("valid fixtures pass schema and semantic validation", () => {
  for (const name of ["completed-pass-pending.json", "blocked-evidence.json"]) {
    const value = json("fixtures/result/valid/" + name);
    assert.equal(schemaValidate(value), true, name + ": " + JSON.stringify(schemaValidate.errors));
    assert.equal(validateResultContract(value).valid, true, name);
  }
});

test("blocked never implies pass and completed never supplies approval", () => {
  const blocked = json("fixtures/result/invalid/blocked-pass.json");
  assert.equal(schemaValidate(blocked), false);
  assert.ok(validateResultContract(blocked).diagnostics.some((item) => item.code === "RESULT_BLOCKED_VERDICT"));
  const implicit = json("fixtures/result/invalid/completed-implicit-approval.json");
  assert.equal(schemaValidate(implicit), false);
  assert.deepEqual(validateResultContract(implicit).diagnostics.map((item) => item.code), ["RESULT_APPROVAL_CONTEXT_REQUIRED"]);
  assert.equal(normalizeResultContract(completed()).approval.state, "not-applicable");
});

test("applicability and malformed combinations have stable ordered diagnostics", () => {
  const value = completed("pass") as any;
  value.evaluation = { applicable: false, verdict: "pass" };
  value.evidence = { applicable: false, availability: "not-applicable" };
  value.approval = { applicable: true, state: "approved" };
  assert.deepEqual(validateResultContract(value).diagnostics.map((item) => [item.code, item.path]), [
    ["RESULT_APPLICABILITY_MISMATCH", "/evaluation"], ["RESULT_APPLICABILITY_MISMATCH", "/evidence/applicable"],
    ["RESULT_APPROVAL_CONTEXT_REQUIRED", "/approval/context"], ["RESULT_VERDICT_EVIDENCE_REQUIRED", "/evidence/availability"],
    ["RESULT_APPROVAL_EVIDENCE_REQUIRED", "/evidence/availability"],
  ]);
});

test("aggregation is total, schema-valid, permutation-invariant, and failure-conservative for every valid pair", () => {
  const values = validContracts();
  assert.equal(values.length, 79);
  for (let left = 0; left < values.length; left += 1) for (let right = 0; right < values.length; right += 1) {
    const pair = [values[left], values[right]];
    const aggregate = aggregateResultContracts(pair);
    assert.equal(validateResultContract(aggregate).valid, true, JSON.stringify({left,right,aggregate}));
    assert.equal(schemaValidate(aggregate), true, JSON.stringify({left,right,errors:schemaValidate.errors,aggregate}));
    assert.deepEqual(aggregateResultContracts(pair.slice().reverse()), aggregate, JSON.stringify({left,right}));
    if (pair.some((item) => classifyResultExit(item).code === 1)) assert.equal(classifyResultExit(aggregate).code, 1, JSON.stringify({left,right,aggregate}));
  }
});

test("aggregation is invariant across all permutations and safely synthesizes conclusive evidence conflicts", () => {
  const pass = completed("pass");
  const partial = completed("inconclusive", "not-applicable", "partial");
  const blocked = json("fixtures/result/valid/blocked-evidence.json");
  const expected = aggregateResultContracts([pass, partial, blocked]);
  for (const order of permutations([pass, partial, blocked])) assert.deepEqual(aggregateResultContracts(order), expected);
  assert.equal(expected.operation.state, "blocked");
  assert.equal(expected.evaluation.verdict, "inconclusive");
  assert.equal(expected.evidence.availability, "unavailable");
  const failed = aggregateResultContracts([completed("fail"), blocked]);
  assert.equal(failed.operation.state, "failed");
  assert.equal(failed.evaluation.verdict, "inconclusive");
  assert.ok(failed.operation.reasons.includes("aggregate preserves child evaluation fail"));
  assert.equal(classifyResultExit(failed).code, 1);
  const rejected = aggregateResultContracts([completed("pass", "rejected"), blocked]);
  assert.equal(rejected.operation.state, "failed");
  assert.equal(rejected.approval.state, "pending");
  assert.ok(rejected.operation.reasons.includes("aggregate preserves child approval rejected"));
  assert.equal(classifyResultExit(rejected).code, 1);
});

test("exit classification separates success, failure, blocked, invalid usage, and evidence-backed pending approval", () => {
  assert.deepEqual(classifyResultExit(completed("pass")), { code: 0, reason: "success" });
  assert.deepEqual(classifyResultExit(completed("fail")), { code: 1, reason: "quality-failure" });
  assert.deepEqual(classifyResultExit(json("fixtures/result/valid/blocked-evidence.json")), { code: 3, reason: "blocked-capability-or-evidence" });
  assert.deepEqual(classifyResultExit(completed(), { invalidUsage: true }), { code: 2, reason: "invalid-usage" });
  assert.deepEqual(classifyResultExit(completed("pass", "pending")), { code: 4, reason: "pending-approval" });
  for (const item of json("fixtures/result/valid/pending-human-review-mappings.json").cases) {
    const gate = mapLegacyStatus({creator:item.creator,context:item.evaluation.context,token:item.evaluation.token});
    const review = mapLegacyStatus({creator:item.creator,context:item.review.context,token:item.review.token});
    assert.equal(gate.ok, true);
    assert.equal(review.ok, true);
    assert.equal(review.ok && review.mapping.result?.evidence.availability, item.expected.evidenceAvailability);
    assert.equal(review.ok && review.mapping.result?.approval.state, item.expected.approvalState);
    assert.equal(review.ok && review.mapping.result && classifyResultExit(review.mapping.result).code, item.expected.exitCode);
    assert.equal(gate.ok && review.ok && gate.mapping.result && review.mapping.result && classifyResultExit(aggregateResultContracts([gate.mapping.result, review.mapping.result])).code, item.expected.exitCode);
  }
});

test("legacy mapping requires context and only explicit review contexts decide approval", () => {
  assert.equal(mapLegacyStatus({ token: "pass" }).ok, false);
  assert.deepEqual((mapLegacyStatus({ token: "pass" }) as any).diagnostics.map((item: any) => item.code), ["LEGACY_CONTEXT_REQUIRED"]);
  for (const mapping of LEGACY_STATUS_MAPPINGS) {
    const result = mapLegacyStatus({ creator: mapping.creator, context: mapping.context, token: mapping.token });
    assert.equal(result.ok, true, mapping.creator + "/" + mapping.context + "/" + mapping.token);
    if (mapping.result?.approval.state === "approved" || mapping.result?.approval.state === "rejected") assert.ok(mapping.context.endsWith("human-review-status") || mapping.context === "hook-production-approval-state", JSON.stringify(mapping));
  }
  const ambiguous = mapLegacyStatus({ creator: "agent-creator", context: "agent-cli-ok", token: false });
  assert.equal(ambiguous.ok && ambiguous.mapping.result, undefined);
  assert.equal(ambiguous.ok && ambiguous.mapping.exit, undefined);
});

test("identity-bound approval states map independently from human-review completion", () => {
  for (const token of ["pending","reviewed"]) assert.equal(mapLegacyStatus({creator:"hook-creator",context:"hook-production-approval-state",token}).ok && mapLegacyStatus({creator:"hook-creator",context:"hook-production-approval-state",token}).mapping.result?.approval.state,"pending");
  assert.equal(mapLegacyStatus({creator:"hook-creator",context:"hook-production-approval-state",token:"approved"}).ok && mapLegacyStatus({creator:"hook-creator",context:"hook-production-approval-state",token:"approved"}).mapping.result?.approval.state,"approved");
  assert.equal(mapLegacyStatus({creator:"hook-creator",context:"hook-production-approval-state",token:"rejected"}).ok && mapLegacyStatus({creator:"hook-creator",context:"hook-production-approval-state",token:"rejected"}).mapping.result?.approval.state,"rejected");
  for (const token of ["expired","superseded","stale","invalid"]) assert.equal(mapLegacyStatus({creator:"hook-creator",context:"hook-production-approval-state",token}).ok && mapLegacyStatus({creator:"hook-creator",context:"hook-production-approval-state",token}).mapping.result,undefined);
  assert.equal(mapLegacyStatus({creator:"plugin-creator",context:"plugin-human-review-status",token:"pass"}).ok && mapLegacyStatus({creator:"plugin-creator",context:"plugin-human-review-status",token:"pass"}).mapping.result?.approval.state,"not-applicable");
});

test("current mapping inventory is independently backed by named producer source and excludes documented non-current tokens", () => {
  const inventory = json("fixtures/result/producer-inventory.json");
  assert.deepEqual(new Set(inventory.current.map((item: any) => item.creator)), new Set(["agent-creator","hook-creator","plugin-creator","skill-creator"]));
  const expected = new Set<string>();
  for (const producer of inventory.current) {
    for (const key of ["creator", "sourceFile", "field", "context", "tokens", "provenance"] as const) assert.ok(producer[key], producer.context + " missing " + key);
    const sourceFiles: string[] = producer.sourceFiles ?? [producer.sourceFile];
    const sources = sourceFiles.map((file) => readFileSync(join(repositoryRoot, file), "utf8"));
    assert.equal(producer.provenance.classification, "current");
    assert.ok(producer.provenance.sourceEvidence.length > 0, producer.context);
    for (const evidence of producer.provenance.sourceEvidence) assert.ok(sources.some((source) => source.includes(evidence)), producer.context + " missing source evidence: " + evidence);
    for (const token of producer.tokens) expected.add(producer.creator + "/" + producer.context + "/" + token);
  }
  const actual = new Set(LEGACY_STATUS_MAPPINGS.map((item) => item.creator + "/" + item.context + "/" + item.token));
  assert.deepEqual(actual, expected);
  for (const excluded of inventory.documentedNonCurrent) for (const token of excluded.tokens) {
    assert.equal(actual.has(excluded.creator + "/" + excluded.context + "/" + token), false, excluded.context + "/" + token);
  }
});


test("independent producer expectations cover receipt status, forwarded fail, validation field split, and nested aliases", () => {
  const inventory = json("fixtures/result/producer-inventory.json");
  const byContext = new Map(inventory.current.map((item: any) => [item.context, item]));
  const expected = [
    { context: "plugin-verification-receipt-status", tokens: ["pass","fail","blocked"], file: "apps/plugin-creator-cli/scripts/verify_plugin_gates.ts", snippets: ["const status = aggregate(gates);", "artifact: \"plugin\", name, profile: parsed.profile, status"] },
    { context: "skill-verification-receipt-status", tokens: ["pass","fail","blocked"], file: "apps/skill-creator-cli/scripts/verify_skill_gates.ts", snippets: ["const status = aggregate(gates);", "artifact: \"skill\",", "status,"] },
    { context: "skill-full-eval-status", tokens: ["planned","success","failure","fail","blocked"], file: "apps/skill-creator-cli/scripts/full_eval.ts", snippets: ["return envelope(options,job,verification.status,next"] },
    { context: "plugin-validation-outcome", tokens: ["accepted","rejected","partial"], file: "apps/plugin-creator-cli/scripts/validation_outcomes.ts", snippets: ["return { mode, status: deriveOutcomeStatus(diagnostics, components), diagnostics, components };"] },
    { context: "plugin-component-outcome-status", tokens: ["accepted","skipped","skipped-invalid","skipped-unsupported","runtime-failed"], file: "apps/plugin-creator-cli/scripts/mcp_runtime.ts", snippets: ["return{status:\"runtime-failed\""] },
    { context: "plugin-release-eligible", tokens: ["true","false"], file: "apps/plugin-creator-cli/scripts/verify_plugin_gates.ts", snippets: ["release_eligible: (parsed.profile === \"release\"||parsed.profile === \"production\") && status === \"pass\""] },
  ];
  const mappings = new Set(LEGACY_STATUS_MAPPINGS.map((item) => item.creator + "/" + item.context + "/" + item.token));
  for (const item of expected) {
    const record: any = byContext.get(item.context);
    assert.ok(record, "missing independently expected context " + item.context);
    assert.deepEqual(record.tokens, item.tokens);
    const source = readFileSync(join(repositoryRoot, item.file), "utf8");
    for (const snippet of item.snippets) assert.ok(source.includes(snippet), item.context + " producer changed: " + snippet);
    for (const token of item.tokens) assert.ok(mappings.has(record.creator + "/" + item.context + "/" + token), item.context + "/" + token);
  }
  for (const alias of inventory.copiedNestedFields) {
    const source = readFileSync(join(repositoryRoot, alias.sourceFile), "utf8");
    for (const snippet of alias.sourceEvidence) assert.ok(source.includes(snippet), alias.field + " copy changed: " + snippet);
    const contexts = alias.canonicalContexts ?? [alias.canonicalContext];
    for (const context of contexts) assert.ok(byContext.has(context), alias.field + " missing canonical context " + context);
    if (alias.tokens) assert.deepEqual(alias.tokens, (byContext.get(alias.canonicalContext) as any).tokens);
  }
  assert.ok(inventory.excludedStructuralFields.every((item: any) => item.fields.length && item.rationale.length));
});

test("independent expectedConsumerFields fixture maps every field to exactly one classification with verified source evidence", () => {
  const expected = json("fixtures/result/expected-consumer-fields.json");
  const inventory = json("fixtures/result/producer-inventory.json");
  assert.ok(Array.isArray(expected.records) && expected.records.length >= 13, "fixture must contain at least 13 records");

  const currentKeys = new Set(inventory.current.map((item: any) => item.creator + "/" + item.context));
  const copiedCanonicalContexts = new Set(
    inventory.copiedNestedFields.flatMap((item: any) => item.canonicalContexts ?? [item.canonicalContext]),
  );
  const excludedFieldNames = new Set(
    inventory.excludedStructuralFields.flatMap((item: any) => item.fields as string[]),
  );

  const seenIds = new Set<string>();
  for (const record of expected.records as any[]) {
    for (const key of ["id", "creator", "sourceFile", "field", "sourceEvidence", "classification"] as const) {
      assert.ok(record[key], "expected-consumer-fields record missing " + key);
    }
    assert.equal(seenIds.has(record.id), false, "duplicate expected-consumer-fields id: " + record.id);
    seenIds.add(record.id);
    assert.ok(["current", "copied", "excluded"].includes(record.classification), record.id + " has unsupported classification");

    const source = readFileSync(join(repositoryRoot, record.sourceFile), "utf8");
    const evidence: string[] = Array.isArray(record.sourceEvidence) ? record.sourceEvidence : [record.sourceEvidence];
    assert.ok(evidence.length > 0, record.id + " requires at least one sourceEvidence snippet");
    for (const snippet of evidence) assert.ok(source.includes(snippet), record.id + " sourceEvidence not found in " + record.sourceFile + ": " + snippet);

    if (record.classification === "current") {
      assert.ok(record.context, record.id + " current record requires context");
      assert.ok(currentKeys.has(record.creator + "/" + record.context), record.id + " context missing from producer-inventory.current: " + record.context);
    } else if (record.classification === "copied") {
      assert.ok(record.canonicalContext, record.id + " copied record requires canonicalContext");
      assert.ok(copiedCanonicalContexts.has(record.canonicalContext), record.id + " canonicalContext missing from producer-inventory.copiedNestedFields: " + record.canonicalContext);
      assert.ok(currentKeys.has(record.creator + "/" + record.canonicalContext), record.id + " canonicalContext is not itself a current mapping: " + record.canonicalContext);
    } else {
      assert.ok(record.rationale && record.rationale.length > 0, record.id + " excluded record requires rationale");
      assert.ok(excludedFieldNames.has(record.field), record.id + " field missing from producer-inventory.excludedStructuralFields: " + record.field);
    }
  }

  const byClassification = { current: 0, copied: 0, excluded: 0 } as Record<string, number>;
  for (const record of expected.records as any[]) byClassification[record.classification] += 1;
  assert.equal(byClassification.current, 9);
  assert.equal(byClassification.copied, 8);
  assert.equal(byClassification.excluded, 5);
});

test("non-current status vocabularies remain absent from exact emitting fields and mappings", () => {
  const validation = readFileSync(join(repositoryRoot, "apps/plugin-creator-cli/scripts/validation_outcomes.ts"), "utf8");
  const derive = validation.slice(validation.indexOf("export function deriveOutcomeStatus"), validation.indexOf("export function createValidationOutcome"));
  assert.deepEqual([...derive.matchAll(/return \"([^\"]+)\"/g)].map((match) => match[1]), ["rejected","partial","accepted"]);
  const mcp = readFileSync(join(repositoryRoot, "apps/plugin-creator-cli/scripts/mcp_compatibility.ts"), "utf8");
  assert.equal(/return\{status:\"legacy-compatible\"/.test(mcp), false);
  const packaging = readFileSync(join(repositoryRoot, "apps/plugin-creator-cli/scripts/package_goose_plugin.ts"), "utf8");
  assert.equal(/status\s*[:=]\s*\"packaged\"/.test(packaging), false);
  assert.equal(/(?:return|status\s*:)\s*\"policy-failed\"/.test(validation), false);
  const keys = new Set(LEGACY_STATUS_MAPPINGS.map((item) => item.creator + "/" + item.context + "/" + item.token));
  for (const key of ["plugin-creator/plugin-validation-outcome/skipped","plugin-creator/plugin-validation-outcome/runtime-failed","plugin-creator/plugin-validation-outcome/policy-failed","plugin-creator/plugin-component-outcome-status/rejected","plugin-creator/plugin-component-outcome-status/policy-failed","plugin-creator/plugin-package-status/packaged"]) assert.equal(keys.has(key), false, key);
  assert.equal(keys.has("plugin-creator/plugin-migration-classification/legacy-compatible"), true);
});
