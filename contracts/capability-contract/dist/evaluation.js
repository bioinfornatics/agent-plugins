import { createHash } from "node:crypto";
import { EVALUATION_PLAN_VERSION, EVALUATION_PROFILES, } from "./evaluation-types.js";
const PROFILE_NAMES = new Set(["fast", "standard", "release"]);
const EXECUTION_LEVELS = new Set(["static", "behavioral", "integration"]);
const THRESHOLD_OPERATORS = new Set(["<", "<=", "=", ">=", ">"]);
const ROOT_FIELDS = ["schemaVersion", "profile", "scenarios", "baseline", "configurations", "pairs", "repetitions", "concurrency", "budget", "thresholds", "retries", "stopPolicy", "computed"];
const CONFIG_FIELDS = ["id", "executionLevel", "capabilities", "modelRoles", "inputs", "tools", "fixtures", "budget"];
const RUN_BUDGET_FIELDS = ["maxTurns", "timeoutSeconds", "maxTokens", "maxCostUsd"];
const TOTAL_BUDGET_FIELDS = ["maxRuns", "maxTurns", "timeoutSeconds", "maxTokens", "maxCostUsd"];
const HARD_LIMITS = {
    perRun: { maxTurns: 1000, timeoutSeconds: 86400, maxTokens: 10_000_000, maxCostUsd: 10_000 },
    total: { maxRuns: 100_000, maxTurns: 100_000_000, timeoutSeconds: 31_536_000, maxTokens: 1_000_000_000_000, maxCostUsd: 1_000_000 },
    repetitions: 1000, concurrency: 1000, retries: 5,
};
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const nonBlank = (value) => typeof value === "string" && value.trim().length > 0;
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const nonNegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0;
const finitePositive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
const stringList = (value) => Array.isArray(value) && value.every(nonBlank);
/** Locale-independent ascending UTF-16 code-unit order, matching ECMAScript string relational comparison. */
const compareUtf16 = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const sortedStrings = (values) => [...values].map((value) => value.trim()).sort(compareUtf16);
const comparable = (value) => JSON.stringify(canonicalize(value));
export function canonicalJsonEqual(left, right) { return comparable(left) === comparable(right); }
function diagnostic(code, path, message, remediation) { return { code, path, message, remediation }; }
function unknownFields(value, fields, path, diagnostics) {
    const allowed = new Set(fields);
    for (const key of Object.keys(value).sort())
        if (!allowed.has(key))
            diagnostics.push(diagnostic("EVALUATION_UNKNOWN_FIELD", path + "/" + key, "Unknown evaluation plan field: " + key + ".", "Remove " + key + " or use a schema version that defines it."));
}
function validateBudgetObject(value, fields, path, diagnostics) {
    if (!isRecord(value)) {
        diagnostics.push(diagnostic("EVALUATION_BUDGET_INVALID", path, "Budget must be an object.", "Provide finite positive bounds, or omit overrides to use computed profile bounds."));
        return;
    }
    unknownFields(value, fields, path, diagnostics);
    for (const field of fields) {
        const amount = value[field];
        if (amount !== undefined && (!finitePositive(amount) || (field !== "maxCostUsd" && !Number.isSafeInteger(amount))))
            diagnostics.push(diagnostic("EVALUATION_BUDGET_INVALID", path + "/" + field, field + " must be a finite positive " + (field === "maxCostUsd" ? "number" : "integer") + ".", "Set " + field + " to a finite positive bound."));
    }
}
function mergeBudget(base, override) { return { ...base, ...(override ?? {}) }; }
function resolveCore(value) {
    const defaults = EVALUATION_PROFILES[value.profile];
    const repetitions = value.repetitions ?? defaults.repetitions;
    const concurrency = value.concurrency ?? defaults.concurrency;
    const retries = { maxRetries: value.retries?.maxRetries ?? defaults.retries.maxRetries, retryOn: sortedStrings(value.retries?.retryOn ?? defaults.retries.retryOn) };
    const stopPolicy = { budgetExhaustion: value.stopPolicy?.budgetExhaustion ?? "stop", thresholdFailure: value.stopPolicy?.thresholdFailure ?? defaults.stopPolicy.thresholdFailure, maxFailedRuns: value.stopPolicy?.maxFailedRuns ?? defaults.stopPolicy.maxFailedRuns };
    const perRun = mergeBudget(defaults.perRun, value.budget?.perRun);
    const configurations = value.configurations.map((configuration) => ({
        ...configuration, id: configuration.id.trim(), capabilities: sortedStrings(configuration.capabilities),
        modelRoles: configuration.modelRoles.map((role) => ({ role: role.role.trim(), model: role.model.trim() })).sort((a, b) => compareUtf16(a.role, b.role) || compareUtf16(a.model, b.model)),
        inputs: sortedStrings(configuration.inputs), tools: sortedStrings(configuration.tools), fixtures: sortedStrings(configuration.fixtures),
        budget: mergeBudget(perRun, configuration.budget),
    })).sort((a, b) => compareUtf16(a.id, b.id));
    const attempts = retries.maxRetries + 1;
    const multiplier = value.scenarios.length * repetitions * attempts;
    const totalJobs = value.scenarios.length * configurations.length * repetitions;
    const totalRuns = totalJobs * attempts;
    const required = {
        maxRuns: totalRuns,
        maxTurns: multiplier * configurations.reduce((sum, configuration) => sum + configuration.budget.maxTurns, 0),
        timeoutSeconds: multiplier * configurations.reduce((sum, configuration) => sum + configuration.budget.timeoutSeconds, 0),
    };
    if (configurations.every((configuration) => configuration.budget.maxTokens !== undefined))
        required.maxTokens = multiplier * configurations.reduce((sum, configuration) => sum + configuration.budget.maxTokens, 0);
    if (configurations.every((configuration) => configuration.budget.maxCostUsd !== undefined))
        required.maxCostUsd = multiplier * configurations.reduce((sum, configuration) => sum + configuration.budget.maxCostUsd, 0);
    return { repetitions, concurrency, retries, stopPolicy, perRun, configurations, required, totalJobs, totalRuns };
}
export function validateEvaluationPlan(value) {
    const diagnostics = [];
    if (!isRecord(value))
        return { valid: false, diagnostics: [diagnostic("EVALUATION_PLAN_NOT_OBJECT", "/", "Evaluation plan must be a JSON object.", "Provide an object conforming to evaluation-plan 1.0.0.")] };
    unknownFields(value, ROOT_FIELDS, "", diagnostics);
    if (!nonBlank(value.schemaVersion))
        diagnostics.push(diagnostic("EVALUATION_VERSION_REQUIRED", "/schemaVersion", "schemaVersion is required.", "Set schemaVersion to " + EVALUATION_PLAN_VERSION + "."));
    else if (value.schemaVersion !== EVALUATION_PLAN_VERSION)
        diagnostics.push(diagnostic("EVALUATION_VERSION_UNSUPPORTED", "/schemaVersion", "Unsupported evaluation plan version: " + value.schemaVersion + ".", "Use schemaVersion " + EVALUATION_PLAN_VERSION + " or a compatible validator."));
    if (!PROFILE_NAMES.has(value.profile))
        diagnostics.push(diagnostic("EVALUATION_PROFILE_INVALID", "/profile", "profile must be fast, standard, or release.", "Choose one documented deterministic profile."));
    if (!Array.isArray(value.scenarios) || value.scenarios.length === 0)
        diagnostics.push(diagnostic("EVALUATION_SCENARIOS_REQUIRED", "/scenarios", "At least one scenario reference is required.", "Reference existing scenarios by stable id and source without copying their schema."));
    else {
        const ids = new Set();
        value.scenarios.forEach((item, index) => {
            const path = "/scenarios/" + index;
            if (!isRecord(item) || !nonBlank(item.id) || !nonBlank(item.source) || (item.selector !== undefined && !nonBlank(item.selector)))
                diagnostics.push(diagnostic("EVALUATION_SCENARIO_INVALID", path, "Scenario reference requires non-empty id and source, with an optional selector.", "Point to an existing scenario document and selector."));
            else {
                unknownFields(item, ["id", "source", "selector"], path, diagnostics);
                if (ids.has(item.id))
                    diagnostics.push(diagnostic("EVALUATION_SCENARIO_DUPLICATE", path + "/id", "Scenario id is duplicated: " + item.id + ".", "Use each scenario id once."));
                ids.add(item.id);
            }
        });
    }
    if (!nonBlank(value.baseline))
        diagnostics.push(diagnostic("EVALUATION_BASELINE_REQUIRED", "/baseline", "A baseline configuration id is required.", "Set baseline to one declared configuration id."));
    if (!Array.isArray(value.configurations) || value.configurations.length === 0)
        diagnostics.push(diagnostic("EVALUATION_CONFIGURATIONS_REQUIRED", "/configurations", "At least one configuration is required.", "Declare the baseline and each candidate configuration."));
    else {
        const ids = new Set();
        value.configurations.forEach((item, index) => {
            const path = "/configurations/" + index;
            if (!isRecord(item)) {
                diagnostics.push(diagnostic("EVALUATION_CONFIGURATION_INVALID", path, "Configuration must be an object.", "Declare its id, execution level, capabilities, model roles, inputs, tools, and fixtures."));
                return;
            }
            unknownFields(item, CONFIG_FIELDS, path, diagnostics);
            const rolesValid = Array.isArray(item.modelRoles) && item.modelRoles.length > 0 && item.modelRoles.every((role) => isRecord(role) && nonBlank(role.role) && nonBlank(role.model) && Object.keys(role).every((key) => key === "role" || key === "model"));
            if (!nonBlank(item.id) || !EXECUTION_LEVELS.has(item.executionLevel) || !stringList(item.capabilities) || !rolesValid || !stringList(item.inputs) || !stringList(item.tools) || !stringList(item.fixtures))
                diagnostics.push(diagnostic("EVALUATION_CONFIGURATION_INVALID", path, "Configuration requires a non-empty id, supported executionLevel, string-list capabilities/inputs/tools/fixtures, and at least one model role.", "Complete the configuration using static, behavioral, or integration execution and explicit model roles."));
            if (nonBlank(item.id)) {
                if (ids.has(item.id))
                    diagnostics.push(diagnostic("EVALUATION_CONFIGURATION_DUPLICATE", path + "/id", "Configuration id is duplicated: " + item.id + ".", "Use each configuration id once."));
                ids.add(item.id);
            }
            if (item.budget !== undefined)
                validateBudgetObject(item.budget, RUN_BUDGET_FIELDS, path + "/budget", diagnostics);
        });
        if (nonBlank(value.baseline) && !ids.has(value.baseline))
            diagnostics.push(diagnostic("EVALUATION_BASELINE_UNKNOWN", "/baseline", "Baseline configuration does not exist: " + value.baseline + ".", "Reference one id from configurations."));
    }
    if (!Array.isArray(value.pairs))
        diagnostics.push(diagnostic("EVALUATION_PAIR_INVALID", "/pairs", "pairs must be an array.", "Declare each comparison and its four equivalence assertions."));
    else
        value.pairs.forEach((item, index) => {
            const path = "/pairs/" + index;
            if (!isRecord(item) || !nonBlank(item.baseline) || !nonBlank(item.candidate) || item.baseline === item.candidate || !isRecord(item.equivalent))
                diagnostics.push(diagnostic("EVALUATION_PAIR_INVALID", path, "Pair requires distinct baseline and candidate ids plus equivalence declarations.", "Declare a valid baseline/candidate pair."));
            else {
                unknownFields(item, ["baseline", "candidate", "equivalent"], path, diagnostics);
                unknownFields(item.equivalent, ["inputs", "tools", "fixtures", "budgets"], path + "/equivalent", diagnostics);
                if (item.equivalent.inputs !== true || item.equivalent.tools !== true || item.equivalent.fixtures !== true || item.equivalent.budgets !== true)
                    diagnostics.push(diagnostic("EVALUATION_PAIR_EQUIVALENCE_REQUIRED", path + "/equivalent", "Paired variants must explicitly declare equivalent inputs, tools, fixtures, and budgets.", "Set all four declarations to true after verifying the configurations."));
            }
        });
    if (value.repetitions !== undefined && (!positiveInteger(value.repetitions) || value.repetitions > HARD_LIMITS.repetitions))
        diagnostics.push(diagnostic("EVALUATION_REPETITIONS_INVALID", "/repetitions", "repetitions must be a positive safe integer no greater than 1000.", "Use a bounded repetition count."));
    if (value.concurrency !== undefined && (!positiveInteger(value.concurrency) || value.concurrency > HARD_LIMITS.concurrency))
        diagnostics.push(diagnostic("EVALUATION_CONCURRENCY_INVALID", "/concurrency", "concurrency must be a positive safe integer no greater than 1000.", "Use a bounded requested concurrency."));
    if (value.budget !== undefined) {
        if (!isRecord(value.budget))
            diagnostics.push(diagnostic("EVALUATION_BUDGET_INVALID", "/budget", "budget must be an object.", "Declare perRun and total budget objects."));
        else {
            unknownFields(value.budget, ["perRun", "total"], "/budget", diagnostics);
            if (value.budget.perRun !== undefined)
                validateBudgetObject(value.budget.perRun, RUN_BUDGET_FIELDS, "/budget/perRun", diagnostics);
            if (value.budget.total !== undefined)
                validateBudgetObject(value.budget.total, TOTAL_BUDGET_FIELDS, "/budget/total", diagnostics);
        }
    }
    if (value.thresholds !== undefined && (!Array.isArray(value.thresholds) || value.thresholds.some((item) => !isRecord(item) || !nonBlank(item.metric) || !THRESHOLD_OPERATORS.has(item.operator) || typeof item.value !== "number" || !Number.isFinite(item.value) || Object.keys(item).some((key) => !["metric", "operator", "value"].includes(key)))))
        diagnostics.push(diagnostic("EVALUATION_THRESHOLDS_INVALID", "/thresholds", "thresholds must contain finite metric/operator/value records.", "Use a supported operator and finite value."));
    if (value.retries !== undefined && (!isRecord(value.retries) || (value.retries.maxRetries !== undefined && (!nonNegativeInteger(value.retries.maxRetries) || value.retries.maxRetries > HARD_LIMITS.retries)) || (value.retries.retryOn !== undefined && !stringList(value.retries.retryOn)) || Object.keys(value.retries).some((key) => !["maxRetries", "retryOn"].includes(key))))
        diagnostics.push(diagnostic("EVALUATION_RETRIES_INVALID", "/retries", "Retry policy requires maxRetries from 0 through 5 and a string retryOn list.", "Use a small bounded retry count and explicit retry reasons."));
    if (value.stopPolicy !== undefined && (!isRecord(value.stopPolicy) || (value.stopPolicy.budgetExhaustion !== undefined && value.stopPolicy.budgetExhaustion !== "stop") || (value.stopPolicy.thresholdFailure !== undefined && !["stop", "continue"].includes(value.stopPolicy.thresholdFailure)) || (value.stopPolicy.maxFailedRuns !== undefined && !nonNegativeInteger(value.stopPolicy.maxFailedRuns)) || Object.keys(value.stopPolicy).some((key) => !["budgetExhaustion", "thresholdFailure", "maxFailedRuns"].includes(key))))
        diagnostics.push(diagnostic("EVALUATION_STOP_POLICY_INVALID", "/stopPolicy", "Stop policy must stop on budget exhaustion and use bounded failure handling.", "Set budgetExhaustion to stop and bounded threshold/failure fields."));
    if (diagnostics.length > 0)
        return { valid: false, diagnostics };
    const input = value;
    const core = resolveCore(input);
    for (const [field, limit] of Object.entries(HARD_LIMITS.perRun)) {
        const amount = input.budget?.perRun?.[field];
        if (amount !== undefined && amount > limit)
            diagnostics.push(diagnostic("EVALUATION_BUDGET_UNBOUNDED", "/budget/perRun/" + field, field + " exceeds the portable per-run safety ceiling of " + limit + ".", "Choose a smaller explicit bound or split the plan."));
    }
    core.configurations.forEach((configuration) => {
        for (const [field, limit] of Object.entries(HARD_LIMITS.perRun)) {
            const amount = configuration.budget[field];
            if (amount !== undefined && amount > limit)
                diagnostics.push(diagnostic("EVALUATION_BUDGET_UNBOUNDED", "/configurations/" + input.configurations.findIndex((item) => item.id.trim() === configuration.id) + "/budget/" + field, field + " exceeds the portable per-run safety ceiling of " + limit + ".", "Choose a smaller explicit bound or split the plan."));
        }
    });
    input.pairs.forEach((pair, index) => {
        const baseline = core.configurations.find((item) => item.id === pair.baseline.trim());
        const candidate = core.configurations.find((item) => item.id === pair.candidate.trim());
        if (!baseline || !candidate)
            diagnostics.push(diagnostic("EVALUATION_PAIR_UNKNOWN", "/pairs/" + index, "Pair references an unknown configuration.", "Reference declared baseline and candidate ids."));
        else {
            const mismatches = ["inputs", "tools", "fixtures", "budget"].filter((field) => !canonicalJsonEqual(baseline[field], candidate[field]));
            if (mismatches.length)
                diagnostics.push(diagnostic("EVALUATION_PAIR_EQUIVALENCE_MISMATCH", "/pairs/" + index, "Paired configurations differ in: " + mismatches.map((field) => field === "budget" ? "budgets" : field).join(", ") + ".", "Make paired inputs, tools, fixtures, and effective budgets identical."));
        }
    });
    for (const [field, limit] of Object.entries(HARD_LIMITS.total)) {
        const required = core.required[field];
        if (required !== undefined && required > limit)
            diagnostics.push(diagnostic("EVALUATION_BUDGET_UNBOUNDED", "/budget/total/" + field, "Computed required " + field + " exceeds the portable total safety ceiling of " + limit + ".", "Reduce scenarios, configurations, repetitions, retries, or per-run limits."));
        const supplied = input.budget?.total?.[field];
        if (supplied !== undefined && supplied > limit)
            diagnostics.push(diagnostic("EVALUATION_BUDGET_UNBOUNDED", "/budget/total/" + field, field + " exceeds the portable total safety ceiling of " + limit + ".", "Choose a smaller total bound or split the plan."));
        else if (supplied !== undefined && required !== undefined && supplied < required)
            diagnostics.push(diagnostic("EVALUATION_BUDGET_CONTRADICTORY", "/budget/total/" + field, "Total " + field + " is " + supplied + " but the plan requires at least " + required + ".", "Raise the total bound or reduce plan dimensions."));
    }
    if (core.stopPolicy.maxFailedRuns > core.totalRuns)
        diagnostics.push(diagnostic("EVALUATION_STOP_POLICY_INVALID", "/stopPolicy/maxFailedRuns", "maxFailedRuns cannot exceed computed totalRuns " + core.totalRuns + ".", "Set maxFailedRuns at or below totalRuns."));
    if (input.computed !== undefined) {
        const expected = { totalJobs: core.totalJobs, totalRuns: core.totalRuns, effectiveConcurrency: Math.min(core.concurrency, core.totalJobs, input.budget?.total?.maxRuns ?? core.required.maxRuns), requiredBudget: core.required };
        if (!isRecord(input.computed) || !canonicalJsonEqual(input.computed, expected))
            diagnostics.push(diagnostic("EVALUATION_BUDGET_CONTRADICTORY", "/computed", "Supplied computed capacity does not match plan dimensions and budgets.", "Remove computed to recalculate it or replace it with normalizeEvaluationPlan output."));
    }
    return { valid: diagnostics.length === 0, diagnostics };
}
export class EvaluationPlanValidationError extends Error {
    diagnostics;
    constructor(diagnostics) {
        super(diagnostics.map((item) => item.code + " " + item.path + ": " + item.message).join("\n"));
        this.diagnostics = diagnostics;
        this.name = "EvaluationPlanValidationError";
    }
}
export function normalizeEvaluationPlan(value) {
    const result = validateEvaluationPlan(value);
    if (!result.valid)
        throw new EvaluationPlanValidationError(result.diagnostics);
    const input = value;
    const core = resolveCore(input);
    const total = { ...core.required, ...(input.budget?.total ?? {}) };
    return {
        schemaVersion: EVALUATION_PLAN_VERSION, profile: input.profile,
        scenarios: input.scenarios.map((item) => ({ id: item.id.trim(), source: item.source.trim(), ...(item.selector === undefined ? {} : { selector: item.selector.trim() }) })).sort((a, b) => compareUtf16(a.id, b.id) || compareUtf16(a.source, b.source)),
        baseline: input.baseline.trim(), configurations: core.configurations,
        pairs: input.pairs.map((item) => ({ baseline: item.baseline.trim(), candidate: item.candidate.trim(), equivalent: { inputs: true, tools: true, fixtures: true, budgets: true } })).sort((a, b) => compareUtf16(a.baseline, b.baseline) || compareUtf16(a.candidate, b.candidate)),
        repetitions: core.repetitions, concurrency: core.concurrency, budget: { perRun: core.perRun, total },
        thresholds: (input.thresholds ?? []).map((item) => ({ metric: item.metric.trim(), operator: item.operator, value: item.value })).sort((a, b) => compareUtf16(a.metric, b.metric) || compareUtf16(a.operator, b.operator) || a.value - b.value),
        retries: core.retries, stopPolicy: core.stopPolicy,
        computed: { totalJobs: core.totalJobs, totalRuns: core.totalRuns, effectiveConcurrency: Math.min(core.concurrency, core.totalJobs, total.maxRuns), requiredBudget: core.required },
    };
}
function canonicalize(value) {
    if (Array.isArray(value))
        return value.map(canonicalize);
    if (!isRecord(value))
        return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}
export function canonicalSerializeEvaluationPlan(value) { return JSON.stringify(canonicalize(normalizeEvaluationPlan(value))); }
export function hashEvaluationPlan(value) { return createHash("sha256").update(canonicalSerializeEvaluationPlan(value), "utf8").digest("hex"); }
/** Creates references into an existing creator eval document; scenario bodies remain authoritative there. */
export function adaptCreatorEvalsToEvaluationPlan(value, source, profile = "standard") {
    if (!isRecord(value) || !nonBlank(value.skill_name) || !Array.isArray(value.evals) || value.evals.length === 0 || !nonBlank(source))
        throw new EvaluationPlanValidationError([diagnostic("EVALUATION_SCENARIOS_REQUIRED", "/scenarios", "Creator eval document must provide skill_name and a non-empty evals array.", "Pass an existing skills/*/evals/evals.json document and portable source path.")]);
    const scenarios = [];
    const tools = new Set();
    const fixtures = new Set();
    const capabilities = new Set();
    let maxTurns = 0;
    let timeoutSeconds = 0;
    let behavioral = false;
    value.evals.forEach((raw, index) => {
        if (!isRecord(raw) || (typeof raw.id !== "string" && typeof raw.id !== "number"))
            throw new EvaluationPlanValidationError([diagnostic("EVALUATION_SCENARIO_INVALID", "/evals/" + index, "Creator eval requires a stable string or numeric id.", "Add a stable id to the existing scenario.")]);
        scenarios.push({ id: value.skill_name + ":" + raw.id, source: source.trim(), selector: "/evals/" + index });
        if (Array.isArray(raw.files))
            raw.files.filter(nonBlank).forEach((item) => fixtures.add(item));
        if (isRecord(raw.capabilities)) {
            for (const [name, enabled] of Object.entries(raw.capabilities))
                if (enabled === true)
                    capabilities.add(name);
            if (Array.isArray(raw.capabilities.tools))
                raw.capabilities.tools.filter(nonBlank).forEach((item) => tools.add(item));
            behavioral ||= raw.capabilities.agent_runner === true;
        }
        if (isRecord(raw.budget)) {
            if (positiveInteger(raw.budget.max_turns))
                maxTurns = Math.max(maxTurns, raw.budget.max_turns);
            if (positiveInteger(raw.budget.timeout_seconds))
                timeoutSeconds = Math.max(timeoutSeconds, raw.budget.timeout_seconds);
        }
    });
    const defaults = EVALUATION_PROFILES[profile];
    const shared = { executionLevel: (behavioral ? "behavioral" : "static"), capabilities: [...capabilities], modelRoles: [{ role: "subject", model: "host-default" }], inputs: scenarios.map((item) => item.id), tools: [...tools], fixtures: [...fixtures], budget: { maxTurns: maxTurns || defaults.perRun.maxTurns, timeoutSeconds: timeoutSeconds || defaults.perRun.timeoutSeconds } };
    return normalizeEvaluationPlan({ schemaVersion: EVALUATION_PLAN_VERSION, profile, scenarios, baseline: "baseline", configurations: [{ id: "baseline", ...shared }, { id: "candidate", ...shared }], pairs: [{ baseline: "baseline", candidate: "candidate", equivalent: { inputs: true, tools: true, fixtures: true, budgets: true } }], thresholds: [{ metric: "assertion_pass_rate", operator: ">=", value: 1 }] });
}
