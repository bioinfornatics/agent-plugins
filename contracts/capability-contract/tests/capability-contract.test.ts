import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  CAPABILITY_CONTRACT_SCHEMA_ID,
  CAPABILITY_CONTRACT_VERSION,
  CapabilityContractValidationError,
  normalizeCapabilityContract,
  validateCapabilityContract,
} from "../dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (group: "valid" | "invalid", name: string): unknown =>
  JSON.parse(readFileSync(join(root, "fixtures", group, name), "utf8"));
const schema = JSON.parse(readFileSync(join(root, "schema", "1.0.0", "capability-contract.schema.json"), "utf8"));
const schemaValidate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

test("schema version and identifier are pinned", () => {
  assert.equal(CAPABILITY_CONTRACT_VERSION, "1.0.0");
  assert.equal(schema.$id, CAPABILITY_CONTRACT_SCHEMA_ID);
  assert.match(schema.$id, /\/1\.0\.0\//);
});

test("minimal idea-derived and full expert contracts are accepted and normalized", () => {
  const minimal = fixture("valid", "skill-minimal.json");
  assert.equal(schemaValidate(minimal), true, JSON.stringify(schemaValidate.errors));
  assert.deepEqual(validateCapabilityContract(minimal).diagnostics, []);
  const normalized = normalizeCapabilityContract(minimal);
  assert.deepEqual(normalized.users, []);
  assert.deepEqual(normalized.inputs, []);
  assert.deepEqual(normalized.sideEffects.effects, []);
  assert.deepEqual(normalized.productionBoundary.conditions, []);

  const expert = fixture("valid", "plugin-expert.json") as Record<string, unknown>;
  assert.equal(schemaValidate(expert), true, JSON.stringify(schemaValidate.errors));
  assert.equal(validateCapabilityContract(expert).valid, true);
  assert.equal(normalizeCapabilityContract(expert).futureReviewMode, "two-person");
});

test("valid fixtures cover all four candidate types", () => {
  const expected = new Set(["skill", "agent", "hook", "plugin"]);
  const actual = new Set<string>();
  for (const name of readdirSync(join(root, "fixtures", "valid")).sort()) {
    const value = fixture("valid", name) as { artifactRecommendation: { candidateType: string } };
    assert.equal(schemaValidate(value), true, name + ": " + JSON.stringify(schemaValidate.errors));
    assert.equal(validateCapabilityContract(value).valid, true, name);
    actual.add(value.artifactRecommendation.candidateType);
  }
  assert.deepEqual(actual, expected);
});

test("invalid fixtures cover all four candidates with stable actionable diagnostics", () => {
  const expected = new Map([
    ["skill", "CAPABILITY_OBJECTIVE_REQUIRED"],
    ["agent", "CAPABILITY_SUCCESS_SIGNAL_REQUIRED"],
    ["hook", "CAPABILITY_SIDE_EFFECT_DETAILS_REQUIRED"],
    ["plugin", "CAPABILITY_PRODUCTION_BOUNDARY_REQUIRED"],
  ]);
  const actual = new Set<string>();
  for (const name of readdirSync(join(root, "fixtures", "invalid")).sort()) {
    const value = fixture("invalid", name) as { artifactRecommendation: { candidateType: string } };
    assert.equal(schemaValidate(value), false, name + " unexpectedly matched JSON Schema");
    const result = validateCapabilityContract(value);
    assert.equal(result.valid, false, name);
    const expectedCode = expected.get(value.artifactRecommendation.candidateType);
    assert.ok(result.diagnostics.some((item) => item.code === expectedCode), name + ": " + JSON.stringify(result.diagnostics));
    for (const item of result.diagnostics) {
      assert.ok(item.path.startsWith("/"), name + ": diagnostic path");
      assert.ok(item.message.length > 0, name + ": diagnostic message");
      assert.ok(item.remediation.length > 0, name + ": diagnostic remediation");
    }
    actual.add(value.artifactRecommendation.candidateType);
  }
  assert.deepEqual(actual, new Set(["skill", "agent", "hook", "plugin"]));
});

test("objective and measurable success diagnostics are exact and ordered", () => {
  const value = fixture("valid", "skill-minimal.json") as Record<string, unknown>;
  delete value.objective;
  value.successSignals = [];
  assert.deepEqual(validateCapabilityContract(value).diagnostics.slice(0, 2), [
    {
      code: "CAPABILITY_OBJECTIVE_REQUIRED", path: "/objective",
      message: "A non-empty capability objective is required.", remediation: "Describe the user outcome this capability must achieve."
    },
    {
      code: "CAPABILITY_SUCCESS_SIGNAL_REQUIRED", path: "/successSignals",
      message: "At least one measurable success signal is required.",
      remediation: "Add a signal with name, metric, comparison operator, and finite numeric target."
    }
  ]);
});

test("side effects and production boundaries cannot be silently omitted", () => {
  const value = fixture("valid", "hook.json") as Record<string, unknown>;
  delete value.sideEffects;
  delete value.productionBoundary;
  const codes = validateCapabilityContract(value).diagnostics.map((item) => item.code);
  assert.deepEqual(codes, ["CAPABILITY_SIDE_EFFECTS_REQUIRED", "CAPABILITY_PRODUCTION_BOUNDARY_REQUIRED"]);
  assert.throws(() => normalizeCapabilityContract(value), CapabilityContractValidationError);
});

test("unknown future root fields follow the declared compatibility policy", () => {
  const rejected = fixture("valid", "skill-minimal.json") as Record<string, unknown>;
  rejected.futureOption = { enabled: true };
  assert.equal(schemaValidate(rejected), false);
  assert.deepEqual(validateCapabilityContract(rejected).diagnostics.map((item) => [item.code, item.path]), [["CAPABILITY_UNKNOWN_FIELD", "/futureOption"]]);

  const preserved = structuredClone(rejected) as Record<string, unknown>;
  preserved.compatibility = { unknownFields: "preserve" };
  assert.equal(schemaValidate(preserved), true, JSON.stringify(schemaValidate.errors));
  assert.deepEqual(normalizeCapabilityContract(preserved).futureOption, { enabled: true });
});

test("preserve policy applies only to unknown root fields", () => {
  const value = fixture("valid", "skill-minimal.json") as Record<string, unknown>;
  value.compatibility = { unknownFields: "preserve" };
  value.artifactRecommendation = { candidateType: "skill", futureOption: true };
  assert.equal(schemaValidate(value), false);
  assert.deepEqual(validateCapabilityContract(value).diagnostics.map((item) => [item.code, item.path]), [
    ["CAPABILITY_UNKNOWN_FIELD", "/artifactRecommendation/futureOption"],
  ]);
});

test("unsupported versions fail with a stable version diagnostic", () => {
  const value = fixture("valid", "skill-minimal.json") as Record<string, unknown>;
  value.schemaVersion = "2.0.0";
  assert.equal(schemaValidate(value), false);
  assert.deepEqual(validateCapabilityContract(value).diagnostics, [{
    code: "CAPABILITY_VERSION_UNSUPPORTED", path: "/schemaVersion",
    message: "Unsupported capability contract version: 2.0.0.",
    remediation: "Use schemaVersion 1.0.0 or a validator that supports the requested version."
  }]);
});
