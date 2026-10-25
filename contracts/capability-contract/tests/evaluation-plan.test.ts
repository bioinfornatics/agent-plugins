import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import {
  EVALUATION_PLAN_SCHEMA_ID, EVALUATION_PLAN_VERSION, EVALUATION_PROFILES,
  adaptCreatorEvalsToEvaluationPlan, canonicalSerializeEvaluationPlan, hashEvaluationPlan,
  normalizeEvaluationPlan, validateEvaluationPlan,
} from "../dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(root, "..", "..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const fixture = (group: "valid" | "invalid", name: string): unknown => readJson(join(root, "fixtures", "evaluation-plan", group, name));
const schema = readJson(join(root, "schema", "1.0.0", "evaluation-plan.schema.json")) as Record<string, unknown>;
const schemaValidate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

const valid = (): Record<string, unknown> => structuredClone(fixture("valid", "standard-defaults.json")) as Record<string, unknown>;

test("evaluation plan schema and deterministic profile defaults are versioned", () => {
  assert.equal(EVALUATION_PLAN_VERSION, "1.0.0");
  assert.equal(schema.$id, EVALUATION_PLAN_SCHEMA_ID);
  assert.equal(EVALUATION_PROFILES.fast.perRun.maxTurns, 12);
  assert.equal(EVALUATION_PROFILES.standard.max_turns_per_run, 40);
  assert.equal(EVALUATION_PROFILES.standard.perRun.maxTurns, 40);
  assert.equal(EVALUATION_PROFILES.release.perRun.maxTurns, 80);
  assert.equal(schemaValidate(valid()), true, JSON.stringify(schemaValidate.errors));
});

test("standard defaults compute total jobs, worst-case runs, budgets, and effective concurrency before launch", () => {
  const plan = normalizeEvaluationPlan(valid());
  assert.equal(plan.repetitions, 3);
  assert.equal(plan.concurrency, 4);
  assert.equal(plan.budget.perRun.maxTurns, 40);
  assert.deepEqual(plan.computed, {
    totalJobs: 6, totalRuns: 12, effectiveConcurrency: 4,
    requiredBudget: { maxRuns: 12, maxTurns: 480, timeoutSeconds: 14400 },
  });
  assert.deepEqual(plan.budget.total, plan.computed.requiredBudget);
});

test("explicit retry, stop, threshold, token, cost, and configuration budget fields normalize", () => {
  const input = valid();
  input.repetitions = 2; input.concurrency = 99;
  input.retries = { maxRetries: 0, retryOn: [] };
  input.stopPolicy = { budgetExhaustion: "stop", thresholdFailure: "continue", maxFailedRuns: 2 };
  input.budget = { perRun: { maxTurns: 20, timeoutSeconds: 600, maxTokens: 1000, maxCostUsd: 1 } };
  const plan = normalizeEvaluationPlan(input);
  assert.equal(plan.computed.totalJobs, 4);
  assert.equal(plan.computed.totalRuns, 4);
  assert.equal(plan.computed.effectiveConcurrency, 4);
  assert.deepEqual(plan.computed.requiredBudget, { maxRuns: 4, maxTurns: 80, timeoutSeconds: 2400, maxTokens: 4000, maxCostUsd: 4 });
  assert.equal(plan.stopPolicy.thresholdFailure, "continue");
});

test("invalid, contradictory, and effectively unbounded fixtures have stable actionable diagnostics", () => {
  const expected = new Map([
    ["paired-tools-mismatch.json", "EVALUATION_PAIR_EQUIVALENCE_MISMATCH"],
    ["contradictory-total-runs.json", "EVALUATION_BUDGET_CONTRADICTORY"],
    ["effectively-unbounded.json", "EVALUATION_BUDGET_UNBOUNDED"],
  ]);
  for (const [name, code] of expected) {
    const value = fixture("invalid", name);
    const result = validateEvaluationPlan(value);
    assert.equal(result.valid, false, name);
    assert.ok(result.diagnostics.some((item) => item.code === code), name + ": " + JSON.stringify(result.diagnostics));
    result.diagnostics.forEach((item) => { assert.ok(item.path.startsWith("/")); assert.ok(item.message); assert.ok(item.remediation); });
  }
});

test("declared plan-level per-run ceilings cannot be masked by smaller configuration overrides", () => {
  const ceilings = { maxTurns: 1001, timeoutSeconds: 86401, maxTokens: 10_000_001, maxCostUsd: 10_001 };
  for (const [field, amount] of Object.entries(ceilings)) {
    const input = valid();
    input.budget = { perRun: { [field]: amount } };
    (input.configurations as Array<Record<string, unknown>>).forEach((configuration) => {
      configuration.budget = { maxTurns: 1, timeoutSeconds: 1, maxTokens: 1, maxCostUsd: 0.01 };
    });
    assert.deepEqual(validateEvaluationPlan(input).diagnostics.filter((item) => item.path === "/budget/perRun/" + field).map((item) => item.code), ["EVALUATION_BUDGET_UNBOUNDED"], field);
  }
});

test("paired variants must declare all equivalence dimensions", () => {
  const input = valid();
  (input.pairs as Array<Record<string, unknown>>)[0].equivalent = { inputs: true, tools: true, fixtures: true, budgets: false };
  assert.deepEqual(validateEvaluationPlan(input).diagnostics.map((item) => item.code), ["EVALUATION_PAIR_EQUIVALENCE_REQUIRED"]);
});

test("effective budget equality includes profile, plan, and configuration overrides", () => {
  const input = valid();
  const configurations = input.configurations as Array<Record<string, unknown>>;
  configurations[1].budget = { maxTurns: 20 };
  assert.ok(validateEvaluationPlan(input).diagnostics.some((item) => item.code === "EVALUATION_PAIR_EQUIVALENCE_MISMATCH" && item.message.includes("budgets")));
});

test("canonical serialization and SHA-256 are independent of input order and whitespace", () => {
  const first = valid();
  const second = valid();
  second.scenarios = [...(second.scenarios as unknown[])].reverse();
  second.configurations = [...(second.configurations as unknown[])].reverse();
  const configurations = second.configurations as Array<Record<string, unknown>>;
  configurations.forEach((configuration) => { configuration.tools = [...(configuration.tools as string[])].reverse(); configuration.capabilities = [...(configuration.capabilities as string[])].reverse(); });
  assert.equal(canonicalSerializeEvaluationPlan(first), canonicalSerializeEvaluationPlan(second));
  assert.equal(hashEvaluationPlan(first), hashEvaluationPlan(second));
  assert.equal(hashEvaluationPlan(first), createHash("sha256").update(canonicalSerializeEvaluationPlan(first)).digest("hex"));
  assert.match(hashEvaluationPlan(first), /^[a-f0-9]{64}$/);
});

test("non-ASCII normalization uses locale-independent UTF-16 ordering", () => {
  const input = valid();
  input.scenarios = [{ id: "ä", source: "src-ä" }, { id: "z", source: "src-z" }];
  const configurations = input.configurations as Array<Record<string, unknown>>;
  configurations[0].id = "ä"; configurations[1].id = "z"; input.baseline = "ä";
  input.pairs = [{ baseline: "ä", candidate: "z", equivalent: { inputs: true, tools: true, fixtures: true, budgets: true } }];
  configurations.forEach((configuration) => {
    configuration.capabilities = ["ä", "z"];
    configuration.modelRoles = [{ role: "ä", model: "ö" }, { role: "z", model: "a" }];
    configuration.inputs = ["ä", "z"];
    configuration.tools = ["ä", "z"];
    configuration.fixtures = ["ä", "z"];
  });
  input.thresholds = [{ metric: "ä", operator: ">=", value: 1 }, { metric: "z", operator: ">=", value: 1 }];

  const normalized = normalizeEvaluationPlan(input);
  assert.deepEqual(normalized.scenarios.map((item) => item.id), ["z", "ä"]);
  assert.deepEqual(normalized.configurations.map((item) => item.id), ["z", "ä"]);
  assert.deepEqual(normalized.configurations[0].capabilities, ["z", "ä"]);
  assert.deepEqual(normalized.configurations[0].modelRoles.map((item) => item.role), ["z", "ä"]);
  assert.deepEqual(normalized.thresholds.map((item) => item.metric), ["z", "ä"]);

  const serialized = canonicalSerializeEvaluationPlan(input);
  const hash = hashEvaluationPlan(input);
  const probe = "import { canonicalSerializeEvaluationPlan, hashEvaluationPlan } from " + JSON.stringify(join(root, "dist", "index.js")) + "; const value = JSON.parse(process.env.EVALUATION_PLAN); console.log(JSON.stringify([canonicalSerializeEvaluationPlan(value), hashEvaluationPlan(value)]));";
  const availableLocales = new Set(spawnSync("locale", ["-a"], { encoding: "utf8" }).stdout?.split(/\r?\n/).filter(Boolean).map((locale) => locale.toLowerCase().replace(".utf8", ".utf-8")) ?? []);
  const requestedLocales = ["C", "C.UTF-8", "en_US.UTF-8", "sv_SE.UTF-8"];
  let probes = 0;
  for (const locale of requestedLocales) {
    if (!availableLocales.has(locale.toLowerCase())) continue;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", probe], { encoding: "utf8", env: { ...process.env, LC_ALL: locale, EVALUATION_PLAN: JSON.stringify(input) } });
    assert.equal(result.status, 0, locale + ": " + result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [serialized, hash], locale);
    probes += 1;
  }
  assert.ok(probes >= 1, "at least one process locale probe must run");
});

test("compatibility adapter references every existing creator eval fixture without copying scenario bodies", () => {
  for (const creator of ["skill-creator", "agent-creator", "hook-creator", "plugin-creator"]) {
    const absolute = join(repositoryRoot, "skills", creator, "evals", "evals.json");
    const source = relative(repositoryRoot, absolute);
    const document = readJson(absolute) as { evals: unknown[] };
    const before = readFileSync(absolute, "utf8");
    const plan = adaptCreatorEvalsToEvaluationPlan(document, source);
    assert.equal(plan.scenarios.length, document.evals.length, creator);
    assert.ok(plan.scenarios.every((scenario, index) => scenario.source === source && scenario.selector === "/evals/" + index), creator);
    assert.ok(plan.scenarios.every((scenario) => Object.keys(scenario).every((key) => ["id", "source", "selector"].includes(key))), creator);
    assert.equal(plan.budget.perRun.maxTurns, 40, creator + " uses standard default while configuration budgets preserve legacy maxima");
    const expectedLegacyMax = { "skill-creator": 20, "agent-creator": 20, "hook-creator": 12, "plugin-creator": 40 }[creator];
    assert.equal(plan.configurations[0].budget.maxTurns, expectedLegacyMax, creator);
    assert.equal(readFileSync(absolute, "utf8"), before, creator + " fixture remains unchanged");
    assert.equal(validateEvaluationPlan(plan).valid, true, creator + " normalized plan round-trips as a portable document");
    assert.equal(schemaValidate(plan), true, creator + ": " + JSON.stringify(schemaValidate.errors));
  }
});
