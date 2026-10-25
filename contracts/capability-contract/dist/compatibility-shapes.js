import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateCapabilityContract } from "./validation.js";
import { validateEvaluationPlan } from "./evaluation.js";
import { validateResultContract } from "./result.js";
import { OUTCOME_METRIC_IDS, OUTCOME_METRICS_VERSION } from "./outcome-metrics-types.js";
import { validateOutcomeMetricsInput } from "./outcome-metrics.js";
import { hashFeedback, validateFeedbackAnnotation } from "./feedback-annotation.js";
import { FEEDBACK_ANNOTATION_VERSION } from "./feedback-annotation-types.js";
import { validateUsageCostInput, computeUsageCostEvidence } from "./usage-cost.js";
import { isRfc3339Timestamp } from "./host-adapter.js";
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const nonBlank = (value) => typeof value === "string" && /\S/.test(value);
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const nonNegative = (value) => finite(value) && value >= 0;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const stringArray = (value) => Array.isArray(value) && value.every(nonBlank);
const arrayOf = (value, predicate) => Array.isArray(value) && value.every(predicate);
const only = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));
const exact = (value, required, allowed = required) => required.every(key => Object.hasOwn(value, key)) && only(value, allowed);
const enumValue = (value, values) => values.includes(value);
const optional = (value, predicate) => value === undefined || predicate(value);
const nullable = (value, predicate) => value === null || predicate(value);
const scalar = (value) => value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
const recordOf = (value, predicate) => isRecord(value) && Object.values(value).every(predicate);
const sha256 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const semver = (value) => typeof value === "string" && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
const rfc3339 = (value) => isRfc3339Timestamp(value);
const here = dirname(fileURLToPath(import.meta.url));
const schema = (name) => JSON.parse(readFileSync(join(here, "..", "schema", "1.0.0", name), "utf8"));
const evaluationSchema = schema("evaluation-plan.schema.json"), resultSchema = schema("result-contract.schema.json");
const recommendationSchema = JSON.parse(readFileSync(join(here, "..", "schema", "recommendation", "1.0.0", "artifact-recommendation.schema.json"), "utf8"));
const outcomeMetricsSchema = JSON.parse(readFileSync(join(here, "..", "schema", "outcome-metrics", "1.0.0", "outcome-productivity-metrics.schema.json"), "utf8"));
const feedbackSchema = (name) => JSON.parse(readFileSync(join(here, "..", "schema", "feedback-annotation", "1.0.0", name), "utf8"));
const feedbackSchemaDocuments = { "schema.feedback-annotation.v1": feedbackSchema("feedback-annotation.schema.json"), "schema.feedback-proposal.v1": feedbackSchema("feedback-proposal.schema.json"), "schema.feedback-decision.v1": feedbackSchema("feedback-decision.schema.json"), "schema.feedback-decision-result.v1": feedbackSchema("feedback-decision-result.schema.json") };
const usageCostSchema = JSON.parse(readFileSync(join(here, "..", "schema", "usage-cost", "1.0.0", "goose-usage-cost-evidence.schema.json"), "utf8"));
const productionApprovalDocument = JSON.parse(readFileSync(join(here, "..", "fixtures", "compatibility", "cases", "schema.hook-production-approval.v1.json"), "utf8"));
const hostProtocolSchema = schema("host-execution-adapter.schema.json"), hostEventSchema = schema("host-execution-event.schema.json");
const deepEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function resolveLocalRef(root, ref) {
    if (ref === evaluationSchema.$id)
        return evaluationSchema;
    if (ref === resultSchema.$id)
        return resultSchema;
    if (!ref.startsWith("#/"))
        return undefined;
    let current = root;
    for (const raw of ref.slice(2).split("/")) {
        if (!isRecord(current))
            return undefined;
        current = current[raw.replaceAll("~1", "/").replaceAll("~0", "~")];
    }
    return current;
}
/** Deterministic draft-2020 subset for the checked-in schemas; no runtime dependency. */
function validatesSchema(node, value, root) {
    if (typeof node === "boolean")
        return node;
    if (!isRecord(node))
        return false;
    if (typeof node.$ref === "string") {
        if (node.$ref === evaluationSchema.$id)
            return validateEvaluationPlan(value).valid;
        if (node.$ref === resultSchema.$id)
            return validateResultContract(value).valid;
        const target = resolveLocalRef(root, node.$ref);
        return target !== undefined && validatesSchema(target, value, root);
    }
    if (Array.isArray(node.allOf) && !node.allOf.every(x => validatesSchema(x, value, root)))
        return false;
    if (Array.isArray(node.anyOf) && !node.anyOf.some(x => validatesSchema(x, value, root)))
        return false;
    if (Array.isArray(node.oneOf) && node.oneOf.filter(x => validatesSchema(x, value, root)).length !== 1)
        return false;
    if (node.not !== undefined && validatesSchema(node.not, value, root))
        return false;
    if (node.if !== undefined) {
        const branch = validatesSchema(node.if, value, root) ? node.then : node.else;
        if (branch !== undefined && !validatesSchema(branch, value, root))
            return false;
    }
    if (node.const !== undefined && !deepEqual(value, node.const))
        return false;
    if (Array.isArray(node.enum) && !node.enum.some(x => deepEqual(x, value)))
        return false;
    const type = node.type;
    if (type !== undefined) {
        const ok = type === "object" ? isRecord(value) : type === "array" ? Array.isArray(value) : type === "string" ? typeof value === "string" : type === "integer" ? Number.isSafeInteger(value) : type === "number" ? finite(value) : type === "boolean" ? typeof value === "boolean" : type === "null" ? value === null : false;
        if (!ok)
            return false;
    }
    if (typeof value === "string") {
        if (typeof node.minLength === "number" && value.length < node.minLength)
            return false;
        if (typeof node.pattern === "string" && !new RegExp(node.pattern).test(value))
            return false;
        if (node.format === "date-time" && !rfc3339(value))
            return false;
    }
    if (typeof value === "number") {
        if (typeof node.minimum === "number" && value < node.minimum)
            return false;
        if (typeof node.maximum === "number" && value > node.maximum)
            return false;
        if (typeof node.exclusiveMinimum === "number" && value <= node.exclusiveMinimum)
            return false;
    }
    if (Array.isArray(value)) {
        if (typeof node.minItems === "number" && value.length < node.minItems)
            return false;
        if (typeof node.maxItems === "number" && value.length > node.maxItems)
            return false;
        if (node.uniqueItems === true && new Set(value.map(x => JSON.stringify(x))).size !== value.length)
            return false;
        if (node.items !== undefined && !value.every(x => validatesSchema(node.items, x, root)))
            return false;
    }
    if (isRecord(value)) {
        const required = Array.isArray(node.required) ? node.required : [];
        if (!required.every(x => typeof x === "string" && Object.hasOwn(value, x)))
            return false;
        const properties = isRecord(node.properties) ? node.properties : {};
        for (const [key, child] of Object.entries(properties))
            if (Object.hasOwn(value, key) && !validatesSchema(child, value[key], root))
                return false;
        if (node.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(properties, key)))
            return false;
    }
    return true;
}
const host = (definition) => (value) => validatesSchema(resolveLocalRef(hostProtocolSchema, "#/$defs/" + definition), value, hostProtocolSchema);
const hostValidators = Object.fromEntries(["capabilityReport", "negotiationRequest", "negotiationAccepted", "negotiationBlocked", "runRequest", "artifactExchange", "error", "cancellationRequest", "cancellationResponse", "resumeRequest", "artifactRequest"].map(name => [name, host(name)]));
const hostEvent = (value) => validatesSchema(hostEventSchema, value, hostEventSchema);
const diagnostic = (v) => isRecord(v) && exact(v, ["code", "rule", "message", "severity", "scope", "sourcePath", "remediation"], ["code", "rule", "message", "severity", "scope", "sourcePath", "remediation", "componentType", "componentId"]) && nonBlank(v.code) && nonBlank(v.rule) && nonBlank(v.message) && enumValue(v.severity, ["info", "warning", "error"]) && enumValue(v.scope, ["plugin", "component-type", "component-entry", "runtime-process", "release"]) && nonBlank(v.sourcePath) && nonBlank(v.remediation) && optional(v.componentType, x => enumValue(x, ["manifest", "skill", "mcp", "hook", "agent"])) && optional(v.componentId, nonBlank);
const component = (v) => isRecord(v) && exact(v, ["status", "scope", "sourcePath", "diagnostics"], ["status", "scope", "sourcePath", "componentType", "componentId", "diagnostics"]) && enumValue(v.status, ["accepted", "rejected", "partial", "skipped", "skipped-invalid", "skipped-unsupported", "runtime-failed", "unsupported", "policy-failed"]) && enumValue(v.scope, ["plugin", "component-type", "component-entry", "runtime-process", "release"]) && nonBlank(v.sourcePath) && optional(v.componentType, x => enumValue(x, ["manifest", "skill", "mcp", "hook", "agent"])) && optional(v.componentId, nonBlank) && arrayOf(v.diagnostics, diagnostic);
const phase = (v, plugin = false) => isRecord(v) && exact(v, ["name", "status", plugin ? "detail" : "artifacts"], plugin ? ["name", "status", "detail"] : ["name", "status", "artifacts", "detail"]) && nonBlank(v.name) && enumValue(v.status, plugin ? ["planned", "pass", "fail", "blocked", "skipped"] : ["complete", "blocked", "planned", "skipped", "failed"]) && (plugin ? nonBlank(v.detail) : stringArray(v.artifacts)) && optional(v.detail, nonBlank);
const finding = (v, severities = ["error", "warning", "info"]) => isRecord(v) && nonBlank(v.rule) && nonBlank(v.message) && enumValue(v.severity, severities) && optional(v.path, nonBlank) && optional(v.eval_id, x => nonBlank(x) || integer(x));
const gate = (v) => isRecord(v) && enumValue(v.status, ["pass", "fail", "blocked", "na"]) && typeof v.required === "boolean" && stringArray(v.criteria) && stringArray(v.evidence) && optional(v.reason, nonBlank);
const expectation = (v) => isRecord(v) && exact(v, ["text", "passed", "evidence"], ["text", "passed", "evidence"]) && nonBlank(v.text) && typeof v.passed === "boolean" && nonBlank(v.evidence);
const timing = (v) => isRecord(v) && exact(v, ["total_tokens", "total_duration_seconds"], ["total_tokens", "duration_ms", "total_duration_seconds", "executor_start", "executor_end", "executor_duration_seconds", "grader_duration_seconds", "unavailable_reason"]) && nullable(v.total_tokens, nonNegative) && nullable(v.total_duration_seconds, nonNegative) && optional(v.duration_ms, x => nullable(x, nonNegative)) && optional(v.executor_duration_seconds, x => nullable(x, nonNegative)) && optional(v.grader_duration_seconds, x => nullable(x, nonNegative)) && optional(v.executor_start, x => nullable(x, rfc3339)) && optional(v.executor_end, x => nullable(x, rfc3339)) && optional(v.unavailable_reason, nonBlank);
const metrics = (v) => { if (!isRecord(v) || !exact(v, ["tool_calls", "total_tool_calls", "total_steps", "files_created", "errors_encountered", "output_chars", "transcript_chars"]) || !recordOf(v.tool_calls, integer) || !integer(v.total_tool_calls) || !integer(v.total_steps) || !stringArray(v.files_created) || !integer(v.errors_encountered) || !integer(v.output_chars) || !integer(v.transcript_chars))
    return false; return v.total_tool_calls === Object.values(v.tool_calls).reduce((a, b) => a + b, 0); };
const grading = (v) => {
    if (!isRecord(v) || !exact(v, ["expectations", "summary", "timing"], ["expectations", "summary", "execution_metrics", "timing", "claims", "user_notes_summary", "eval_feedback"]) || !arrayOf(v.expectations, expectation) || !isRecord(v.summary) || !exact(v.summary, ["passed", "failed", "total", "pass_rate"]) || !integer(v.summary.passed) || !integer(v.summary.failed) || !integer(v.summary.total) || !nonNegative(v.summary.pass_rate) || v.summary.pass_rate > 1 || v.summary.passed + v.summary.failed !== v.summary.total || v.summary.total !== v.expectations.length || v.summary.passed !== v.expectations.filter((x) => isRecord(x) && x.passed === true).length || Math.abs((v.summary.total ? v.summary.passed / v.summary.total : 0) - v.summary.pass_rate) > 1e-9 || !timing(v.timing))
        return false;
    if (v.execution_metrics !== undefined && !metrics(v.execution_metrics))
        return false;
    if (v.claims !== undefined && !arrayOf(v.claims, x => isRecord(x) && exact(x, ["claim", "type", "verified", "evidence"]) && nonBlank(x.claim) && nonBlank(x.type) && typeof x.verified === "boolean" && nonBlank(x.evidence)))
        return false;
    if (v.user_notes_summary !== undefined && (!isRecord(v.user_notes_summary) || !exact(v.user_notes_summary, ["uncertainties", "needs_review", "workarounds"]) || ![v.user_notes_summary.uncertainties, v.user_notes_summary.needs_review, v.user_notes_summary.workarounds].every(stringArray)))
        return false;
    if (v.eval_feedback !== undefined && (!isRecord(v.eval_feedback) || !exact(v.eval_feedback, ["suggestions", "overall"]) || !arrayOf(v.eval_feedback.suggestions, x => isRecord(x) && exact(x, ["assertion", "reason"]) && nonBlank(x.assertion) && nonBlank(x.reason)) || !nonBlank(v.eval_feedback.overall)))
        return false;
    return true;
};
const targetFields = {
    "skill": ["kind"], "agent": ["kind"], "hook": ["kind"], "plugin": ["kind"],
    "skill-pair": ["kind", "current", "baseline", "eval_set", "execution"], "existing-skill": ["kind", "path", "expected_validation", "expected_error_contains", "execution"], "partial-evaluation": ["kind", "current", "baseline", "workspace", "execution"], "discovery-and-behavior": ["kind", "current", "baseline", "trigger_eval_set", "behavior_eval_set", "execution"], "completed-evaluation-workspace": ["kind", "workspace", "execution"], "new-skill": ["kind", "name", "output", "execution"],
    "agent-file": ["kind", "execution", "path", "expected_validation"], "new-agent": ["kind", "execution", "name", "output"], "agent-pair": ["kind", "execution", "current", "baseline", "eval_set"], "abstraction-decision": ["kind", "execution", "requested_capabilities"],
    "plugin-hook-component": ["kind", "execution", "path", "event"], "existing-plugin-hook": ["kind", "execution", "path", "event", "expected_validation", "allow_payload", "block_payload"], "plugin-handoff": ["kind", "execution", "path"],
    "plugin-root": ["kind", "execution", "path", "expected_validation", "expected_schema_validation", "expected_operational_validation", "archive"], "plugin-pair": ["kind", "execution", "current", "baseline", "integration_eval_set"], "partial-plugin-evaluation": ["kind", "execution", "path", "workspace"]
};
const target = (v) => { if (!isRecord(v) || !nonBlank(v.kind) || !targetFields[v.kind])
    return false; const allowed = targetFields[v.kind]; if (!exact(v, ["kind"], allowed))
    return false; return Object.entries(v).every(([key, value]) => key === "kind" ? nonBlank(value) : key === "requested_capabilities" ? stringArray(value) : nonBlank(value)); };
const evalBudget = (v) => isRecord(v) && only(v, ["max_turns", "timeout_seconds"]) && optional(v.max_turns, positiveInteger) && optional(v.timeout_seconds, positiveInteger);
const evalCapabilities = (v) => isRecord(v) && only(v, ["filesystem", "agent_runner", "browser", "network", "tools"]) && ["filesystem", "agent_runner", "browser", "network"].every(key => optional(v[key], x => typeof x === "boolean")) && optional(v.tools, stringArray);
const navigation = (v) => isRecord(v) && exact(v, ["must_read", "read_when_relevant", "must_not_read"]) && stringArray(v.must_read) && stringArray(v.read_when_relevant) && stringArray(v.must_not_read);
const evalScenario = (v) => isRecord(v) && exact(v, ["id", "prompt"], ["id", "name", "subject", "language", "prompt", "query", "expected_output", "target", "preconditions", "budget", "files", "capabilities", "assertions", "expectations", "coverage_tags", "navigation_expectations"]) && (nonBlank(v.id) || integer(v.id)) && nonBlank(v.prompt) && optional(v.name, nonBlank) && optional(v.subject, nonBlank) && optional(v.language, nonBlank) && optional(v.query, nonBlank) && optional(v.expected_output, nonBlank) && optional(v.target, target) && optional(v.preconditions, stringArray) && optional(v.budget, evalBudget) && optional(v.files, stringArray) && optional(v.capabilities, evalCapabilities) && arrayOf(v.assertions ?? v.expectations, x => nonBlank(x)) && optional(v.coverage_tags, stringArray) && optional(v.navigation_expectations, navigation) && optional(v.execution_binding, x => isRecord(x) && exact(x, ["skill_source_sha256", "eval_plan_sha256", "scenario_sha256"]) && sha256(x.skill_source_sha256) && sha256(x.eval_plan_sha256) && sha256(x.scenario_sha256));
const evalsForm = (v) => isRecord(v) && exact(v, ["skill_name", "evals"], ["skill_name", "coverage_dimensions", "evals"]) && nonBlank(v.skill_name) && optional(v.coverage_dimensions, x => recordOf(x, stringArray)) && Array.isArray(v.evals) && v.evals.length > 0 && v.evals.every(evalScenario);
const evalMetadata = (surfaceId, v) => {
    const skill = surfaceId.startsWith("skill.");
    const required = ["eval_id", "eval_name", "prompt", "subject", "language", "target", "preconditions", ...(skill ? ["budget"] : []), "assertions", "files", "capabilities", "coverage_tags"];
    const allowed = [...required, "expected_output", "navigation_expectations", ...(skill ? ["execution_binding"] : [])];
    return isRecord(v) && exact(v, required, allowed) && (nonBlank(v.eval_id) || integer(v.eval_id)) && nonBlank(v.eval_name) && nonBlank(v.prompt) && nonBlank(v.subject) && nonBlank(v.language) && target(v.target) && v.target.kind === (skill ? "skill" : "agent") && stringArray(v.preconditions) && (!skill || evalBudget(v.budget)) && stringArray(v.assertions) && stringArray(v.files) && evalCapabilities(v.capabilities) && stringArray(v.coverage_tags) && optional(v.expected_output, nonBlank) && optional(v.navigation_expectations, navigation) && optional(v.execution_binding, x => isRecord(x) && exact(x, ["skill_source_sha256", "eval_plan_sha256", "scenario_sha256"]) && sha256(x.skill_source_sha256) && sha256(x.eval_plan_sha256) && sha256(x.scenario_sha256));
};
const assertionChecker = (v) => isRecord(v) && exact(v, ["kind", "value"], ["kind", "value", "flags"]) && enumValue(v.kind, ["contains", "not-contains", "regex"]) && typeof v.value === "string" && optional(v.flags, x => typeof x === "string");
const assertionSpec = (v) => isRecord(v) && exact(v, ["id", "version", "classification", "criterion"], ["id", "version", "classification", "criterion", "checker"]) && nonBlank(v.id) && positiveInteger(v.version) && enumValue(v.classification, ["deterministic", "semantic"]) && nonBlank(v.criterion) && (v.classification === "deterministic" ? assertionChecker(v.checker) : v.checker === undefined);
const agentEvalMetadataV2 = (v) => isRecord(v) && exact(v, ["schema_version", "eval_id", "eval_name", "prompt", "subject", "language", "target", "preconditions", "files", "capabilities", "coverage_tags", "assertions", "variants", "variant_sources", "assertion_hash"]) && v.schema_version === 2 && (nonBlank(v.eval_id) || integer(v.eval_id)) && nonBlank(v.eval_name) && nonBlank(v.prompt) && typeof v.subject === "string" && typeof v.language === "string" && target(v.target) && v.target.kind === "agent" && stringArray(v.preconditions) && stringArray(v.files) && evalCapabilities(v.capabilities) && stringArray(v.coverage_tags) && arrayOf(v.assertions, assertionSpec) && stringArray(v.variants) && v.variants.length >= 2 && new Set(v.variants).size === v.variants.length && isRecord(v.variant_sources) && Object.keys(v.variant_sources).sort().join("\0") === [...v.variants].sort().join("\0") && recordOf(v.variant_sources, x => isRecord(x) && exact(x, ["source_sha256"]) && sha256(x.source_sha256)) && sha256(v.assertion_hash);
const semanticJudgment = (v) => isRecord(v) && exact(v, ["grader_id", "model", "variant", "verdict", "evidence_quote", "rationale", "valid_evidence"]) && nonBlank(v.grader_id) && nonBlank(v.model) && nonBlank(v.variant) && enumValue(v.verdict, ["pass", "fail", "inconclusive"]) && typeof v.evidence_quote === "string" && nonBlank(v.rationale) && typeof v.valid_evidence === "boolean";
const semanticCounts = (v) => isRecord(v) && exact(v, ["pass", "fail", "inconclusive"]) && integer(v.pass) && integer(v.fail) && integer(v.inconclusive);
const semanticAgreement = (v) => isRecord(v) && exact(v, ["grader_count", "valid_evidence_count", "counts", "ratio", "disagreement"]) && integer(v.grader_count) && integer(v.valid_evidence_count) && v.valid_evidence_count <= v.grader_count && semanticCounts(v.counts) && nonNegative(v.ratio) && v.ratio <= 1 && typeof v.disagreement === "boolean";
const semanticExpectation = (v) => isRecord(v) && exact(v, ["id", "version", "classification", "text", "criterion", "verdict", "passed", "human_review", "evidence", "judgments", "agreement"], ["id", "version", "classification", "text", "criterion", "verdict", "passed", "human_review", "evidence", "judgments", "agreement", "reason"]) && nonBlank(v.id) && positiveInteger(v.version) && v.classification === "semantic" && nonBlank(v.text) && nonBlank(v.criterion) && enumValue(v.verdict, ["pass", "fail", "inconclusive"]) && typeof v.passed === "boolean" && v.passed === (v.verdict === "pass") && typeof v.human_review === "boolean" && stringArray(v.evidence) && arrayOf(v.judgments, semanticJudgment) && semanticAgreement(v.agreement) && optional(v.reason, nonBlank);
const semanticGrading = (v) => { if (!isRecord(v) || !exact(v, ["schema_version", "assertion_hash", "expectations", "summary", "grading_budget", "timing"]) || v.schema_version !== 2 || !sha256(v.assertion_hash) || !arrayOf(v.expectations, semanticExpectation) || !isRecord(v.summary) || !exact(v.summary, ["passed", "failed", "inconclusive", "total", "pass_rate", "human_review"]) || ![v.summary.passed, v.summary.failed, v.summary.inconclusive, v.summary.total].every(integer) || v.summary.total !== v.expectations.length || v.summary.passed + v.summary.failed + v.summary.inconclusive !== v.summary.total || !nonNegative(v.summary.pass_rate) || v.summary.pass_rate > 1 || typeof v.summary.human_review !== "boolean" || !isRecord(v.grading_budget) || !exact(v.grading_budget, ["used", "limit"]) || !integer(v.grading_budget.used) || !integer(v.grading_budget.limit) || v.grading_budget.used > v.grading_budget.limit || !isRecord(v.timing))
    return false; return only(v.timing, ["total_tokens", "duration_ms", "total_duration_seconds", "executor_start", "executor_end", "executor_duration_seconds", "grader_duration_seconds", "unavailable_reason"]) && Object.entries(v.timing).every(([k, x]) => k === "unavailable_reason" ? nonBlank(x) : k.endsWith("_start") || k.endsWith("_end") ? nullable(x, rfc3339) : nullable(x, nonNegative)); };
const evaluatorExpectation = (v) => isRecord(v) && exact(v, ["id", "version", "classification", "text", "criterion", "assertion_sha256", "variant_sha256", "output_sha256", "verdict", "passed", "evidence"], ["id", "version", "classification", "text", "criterion", "assertion_sha256", "variant_sha256", "output_sha256", "verdict", "passed", "evidence", "human_review", "judgments", "agreement", "reason"]) && nonBlank(v.id) && positiveInteger(v.version) && enumValue(v.classification, ["deterministic", "semantic"]) && nonBlank(v.text) && nonBlank(v.criterion) && sha256(v.assertion_sha256) && sha256(v.variant_sha256) && sha256(v.output_sha256) && enumValue(v.verdict, ["pass", "fail", "inconclusive"]) && v.passed === (v.verdict === "pass") && stringArray(v.evidence) && (v.classification === "deterministic" ? (v.human_review === undefined && v.judgments === undefined && v.agreement === undefined) : (typeof v.human_review === "boolean" && arrayOf(v.judgments, semanticJudgment) && semanticAgreement(v.agreement)));
const evaluatorGrading = (v) => isRecord(v) && exact(v, ["schema_version", "authority", "assertion_set_sha256", "variant_sha256", "output_sha256", "expectations", "summary", "grading_budget"]) && v.schema_version === 2 && v.authority === "evaluator" && [v.assertion_set_sha256, v.variant_sha256, v.output_sha256].every(sha256) && arrayOf(v.expectations, evaluatorExpectation) && v.expectations.every(x => x.variant_sha256 === v.variant_sha256 && x.output_sha256 === v.output_sha256) && isRecord(v.summary) && exact(v.summary, ["passed", "failed", "inconclusive", "total", "pass_rate", "human_review"]) && [v.summary.passed, v.summary.failed, v.summary.inconclusive, v.summary.total].every(integer) && v.summary.total === v.expectations.length && v.summary.passed === v.expectations.filter(x => x.verdict === "pass").length && v.summary.failed === v.expectations.filter(x => x.verdict === "fail").length && v.summary.inconclusive === v.expectations.filter(x => x.verdict === "inconclusive").length && v.summary.pass_rate === (v.summary.total ? v.summary.passed / v.summary.total : 0) && v.summary.human_review === (v.summary.inconclusive > 0) && isRecord(v.grading_budget) && exact(v.grading_budget, ["used", "limit"]) && integer(v.grading_budget.used) && integer(v.grading_budget.limit) && v.grading_budget.used <= v.grading_budget.limit;
const reviewClaim = (v) => isRecord(v) && exact(v, ["id", "subject", "statement", "evidenceIds", "criterionIds"], ["id", "subject", "statement", "position", "evidenceIds", "criterionIds", "contradicts", "risk"]) && nonBlank(v.id) && nonBlank(v.subject) && nonBlank(v.statement) && optional(v.position, x => enumValue(x, ["support", "oppose", "neutral"])) && stringArray(v.evidenceIds) && stringArray(v.criterionIds) && optional(v.contradicts, stringArray) && optional(v.risk, nonBlank);
const proposedChange = (v) => isRecord(v) && exact(v, ["id", "description", "evidenceIds"], ["id", "description", "evidenceIds", "contractIds", "scenarioIds"]) && nonBlank(v.id) && nonBlank(v.description) && stringArray(v.evidenceIds) && optional(v.contractIds, stringArray) && optional(v.scenarioIds, stringArray);
const publicBranchOutput = (v) => isRecord(v) && exact(v, ["summary", "claims", "proposedChanges"], ["summary", "claims", "proposedChanges", "risks"]) && nonBlank(v.summary) && arrayOf(v.claims, reviewClaim) && arrayOf(v.proposedChanges, proposedChange) && optional(v.risks, x => arrayOf(x, y => isRecord(y) && exact(y, ["id", "statement", "evidenceIds"]) && nonBlank(y.id) && nonBlank(y.statement) && stringArray(y.evidenceIds)));
const reviewMatrix = (v) => isRecord(v) && exact(v, ["builders", "domainChallengers", "uxChallengers", "evaluationChallengers", "verifiers", "maxConcurrency", "branchBudgetMs", "totalBudgetMs"]) && positiveInteger(v.builders) && integer(v.domainChallengers) && integer(v.uxChallengers) && integer(v.evaluationChallengers) && positiveInteger(v.verifiers) && positiveInteger(v.maxConcurrency) && positiveInteger(v.branchBudgetMs) && positiveInteger(v.totalBudgetMs);
const reviewBranch = (v) => isRecord(v) && exact(v, ["branchId", "role", "status", "startedAt", "completedAt", "durationMs", "requestHash", "approvedContextHash", "criteriaHash"], ["branchId", "role", "status", "startedAt", "completedAt", "durationMs", "requestHash", "approvedContextHash", "criteriaHash", "rawOutput", "publicOutput", "error", "lateOutputQuarantined"]) && nonBlank(v.branchId) && enumValue(v.role, ["builder", "domain-challenger", "ux-challenger", "evaluation-challenger", "verifier"]) && enumValue(v.status, ["succeeded", "failed", "timed-out", "skipped-budget"]) && rfc3339(v.startedAt) && rfc3339(v.completedAt) && nonNegative(v.durationMs) && sha256(v.requestHash) && sha256(v.approvedContextHash) && sha256(v.criteriaHash) && optional(v.publicOutput, publicBranchOutput) && optional(v.error, nonBlank) && optional(v.lateOutputQuarantined, x => typeof x === "boolean") && (v.status !== "succeeded" || publicBranchOutput(v.publicOutput));
const independentReview = (v) => isRecord(v) && exact(v, ["schemaVersion", "runId", "frozen", "matrix", "branches", "convergence", "failuresIsolated"]) && v.schemaVersion === 1 && nonBlank(v.runId) && isRecord(v.frozen) && exact(v.frozen, ["approvedContextHash", "criteriaHash"]) && sha256(v.frozen.approvedContextHash) && sha256(v.frozen.criteriaHash) && reviewMatrix(v.matrix) && arrayOf(v.branches, reviewBranch) && isRecord(v.convergence) && exact(v.convergence, ["agreements", "contradictions", "missingEvidence", "risks", "proposedChanges", "autoResolved"]) && arrayOf(v.convergence.agreements, x => isRecord(x) && exact(x, ["subject", "statement", "branchIds", "claimIds", "evidenceIds"]) && nonBlank(x.subject) && nonBlank(x.statement) && stringArray(x.branchIds) && stringArray(x.claimIds) && stringArray(x.evidenceIds)) && arrayOf(v.convergence.contradictions, x => isRecord(x) && exact(x, ["subject", "claims"]) && nonBlank(x.subject) && arrayOf(x.claims, y => isRecord(y) && exact(y, ["branchId", "claimId", "statement", "position"], ["branchId", "claimId", "statement", "position", "contradicts"]) && nonBlank(y.branchId) && nonBlank(y.claimId) && nonBlank(y.statement) && enumValue(y.position, ["support", "oppose", "neutral"]) && optional(y.contradicts, stringArray))) && arrayOf(v.convergence.missingEvidence, x => isRecord(x) && exact(x, ["branchId", "claimId", "statement"]) && nonBlank(x.branchId) && nonBlank(x.claimId) && nonBlank(x.statement)) && arrayOf(v.convergence.risks, x => isRecord(x) && exact(x, ["branchId", "id", "statement", "evidenceIds"]) && nonBlank(x.branchId) && nonBlank(x.id) && nonBlank(x.statement) && stringArray(x.evidenceIds)) && arrayOf(v.convergence.proposedChanges, x => isRecord(x) && exact(x, ["branchId", "change"]) && nonBlank(x.branchId) && proposedChange(x.change)) && v.convergence.autoResolved === false && v.failuresIsolated === true;
const contentLink = (v) => isRecord(v) && exact(v, ["canonical_ref", "kind", "sha256", "uri"]) && nonBlank(v.canonical_ref) && enumValue(v.kind, ["file", "directory"]) && sha256(v.sha256) && v.uri === "sha256:" + v.sha256;
const unavailableLink = (v) => isRecord(v) && exact(v, ["unavailable_reason"]) && nonBlank(v.unavailable_reason);
const runtimeIdentity = (v) => isRecord(v) && exact(v, ["name", "version", "trust_boundary"]) && nonBlank(v.name) && nonBlank(v.version) && nonBlank(v.trust_boundary);
const modelIdentity = (v) => isRecord(v) && exact(v, ["role", "requested", "trust_boundary"], ["role", "requested", "trust_boundary", "resolved", "unavailable_reason"]) && nonBlank(v.role) && nonBlank(v.requested) && nonBlank(v.trust_boundary) && ((nonBlank(v.resolved) && v.unavailable_reason === undefined) || (nonBlank(v.unavailable_reason) && v.resolved === undefined));
const toolIdentity = (v) => isRecord(v) && exact(v, ["name", "trust_boundary"], ["name", "trust_boundary", "version", "unavailable_reason"]) && nonBlank(v.name) && nonBlank(v.trust_boundary) && ((nonBlank(v.version) && v.unavailable_reason === undefined) || (nonBlank(v.unavailable_reason) && v.version === undefined));
const graderIdentity = (v) => isRecord(v) && exact(v, ["name", "version", "trust_boundary"], ["name", "version", "trust_boundary", "model_role"]) && nonBlank(v.name) && nonBlank(v.version) && nonBlank(v.trust_boundary) && optional(v.model_role, nonBlank);
const evaluationRunManifest = (v) => isRecord(v) && exact(v, ["schema_version", "canonical_content_sha256", "input_fingerprint_sha256", "inputs", "execution", "provenance"]) && v.schema_version === "hook-evaluation-run-manifest/v1" && sha256(v.canonical_content_sha256) && sha256(v.input_fingerprint_sha256) && isRecord(v.inputs) && exact(v.inputs, ["path_base", "artifact", "baseline", "scenarios", "fixtures", "plan"]) && nonBlank(v.inputs.path_base) && contentLink(v.inputs.artifact) && (contentLink(v.inputs.baseline) || unavailableLink(v.inputs.baseline)) && contentLink(v.inputs.scenarios) && arrayOf(v.inputs.fixtures, contentLink) && v.inputs.fixtures.length > 0 && contentLink(v.inputs.plan) && isRecord(v.execution) && exact(v.execution, ["environment", "host_adapter", "models", "tools", "budgets", "runner", "graders"]) && enumValue(v.execution.environment, ["local", "ci"]) && runtimeIdentity(v.execution.host_adapter) && arrayOf(v.execution.models, modelIdentity) && v.execution.models.length > 0 && arrayOf(v.execution.tools, toolIdentity) && isRecord(v.execution.budgets) && Object.keys(v.execution.budgets).length > 0 && recordOf(v.execution.budgets, nonNegative) && runtimeIdentity(v.execution.runner) && arrayOf(v.execution.graders, graderIdentity) && v.execution.graders.length > 0 && isRecord(v.provenance) && exact(v.provenance, ["source_control", "timestamps", "secret_names", "trust_boundaries"]) && isRecord(v.provenance.source_control) && exact(v.provenance.source_control, ["commit", "dirty"]) && typeof v.provenance.source_control.commit === "string" && /^[a-f0-9]{7,64}$/.test(v.provenance.source_control.commit) && typeof v.provenance.source_control.dirty === "boolean" && isRecord(v.provenance.timestamps) && exact(v.provenance.timestamps, ["created_at"], ["created_at", "started_at", "finished_at"]) && Object.values(v.provenance.timestamps).every(rfc3339) && Array.isArray(v.provenance.secret_names) && new Set(v.provenance.secret_names).size === v.provenance.secret_names.length && v.provenance.secret_names.every(x => typeof x === "string" && /^[A-Z][A-Z0-9_]*$/.test(x)) && stringArray(v.provenance.trust_boundaries) && new Set(v.provenance.trust_boundaries).size === v.provenance.trust_boundaries.length;
const receipt = (surfaceId, v) => {
    const artifact = surfaceId.startsWith("skill.") ? "skill" : "plugin";
    return isRecord(v) && exact(v, ["schema_version", "artifact", "name", "profile", "status", "source_sha256", "gates"], ["schema_version", "artifact", "name", "profile", "status", "source_sha256", "generated_at", "gates", "critical_failures", "release_eligible", "component_summary", "components", "integration_evidence", "artifacts", "reason"]) && v.schema_version === "1.0" && v.artifact === artifact && nonBlank(v.name) && enumValue(v.profile, artifact === "skill" ? ["static", "evaluation", "release"] : ["static", "evaluation", "release"]) && enumValue(v.status, ["pass", "fail", "blocked", "na"]) && sha256(v.source_sha256) && recordOf(v.gates, gate) && optional(v.generated_at, rfc3339) && optional(v.critical_failures, stringArray) && optional(v.release_eligible, x => typeof x === "boolean") && optional(v.components, isRecord) && optional(v.component_summary, isRecord) && optional(v.integration_evidence, x => nullable(x, isRecord)) && optional(v.artifacts, isRecord) && optional(v.reason, nonBlank);
};
const fullEvalJobPhase = (v) => isRecord(v) && exact(v, ["name", "depends_on", "status", "attempts", "artifacts"], ["name", "depends_on", "status", "attempts", "input_hash", "artifacts", "artifact_hashes", "detail", "error"]) && nonBlank(v.name) && stringArray(v.depends_on) && enumValue(v.status, ["pending", "running", "succeeded", "blocked", "failed", "cancelled", "stale"]) && integer(v.attempts) && stringArray(v.artifacts) && optional(v.input_hash, sha256) && optional(v.artifact_hashes, x => recordOf(x, sha256)) && optional(v.detail, nonBlank) && optional(v.error, nonBlank);
const fullEvalJob = (v) => isRecord(v) && exact(v, ["schema_version", "id", "revision", "status", "state_file", "phases"]) && v.schema_version === "2.0" && nonBlank(v.id) && integer(v.revision) && enumValue(v.status, ["active", "blocked", "failed", "cancelled", "succeeded"]) && nonBlank(v.state_file) && arrayOf(v.phases, fullEvalJobPhase);
const executableAction = (v) => isRecord(v) && exact(v, ["order", "id", "description", "command"]) && positiveInteger(v.order) && nonBlank(v.id) && nonBlank(v.description) && nonBlank(v.command);
const fullEvalCheckpoint = (v) => nullable(v, x => isRecord(x) && exact(x, ["kind", "status", "failure", "review"]) && x.kind === "human-review" && x.status === "decision-required" && x.failure === false && nonBlank(x.review));
const fullEval = (surfaceId, v) => {
    const plugin = surfaceId.startsWith("plugin."), skillV11 = !plugin && isRecord(v) && v.schema_version === "1.1";
    const required = plugin ? ["schema_version", "command", "status", "exit_code", "dry_run", "resume", "plugin", "workspace", "archive", "state_file", "graph_hash", "revision", "jobs", "phases", "components", "next_actions", "verification"] : ["schema_version", "command", "status", "exit_code", "skill", "workspace", "eval_set", "resume", "dry_run", "phases", "job", "next_actions", ...(skillV11 ? ["checkpoint", "executable_actions"] : [])];
    const allowed = plugin ? required : [...required, "audit", "design", "receipt", "verification"];
    return isRecord(v) && exact(v, required, allowed) && (plugin ? v.schema_version === "1.0" : enumValue(v.schema_version, ["1.0", "1.1"])) && v.command === "full-eval" && enumValue(v.status, ["planned", "success", "failure", "blocked", "cancelled"]) && enumValue(v.exit_code, [0, 1, 3]) && typeof v.dry_run === "boolean" && typeof v.resume === "boolean" && nonBlank(v.workspace) && nonBlank(plugin ? v.plugin : v.skill) && (!plugin && nonBlank(v.eval_set) || plugin) && (!plugin || nonBlank(v.archive)) && (!plugin || Array.isArray(v.components)) && arrayOf(v.phases, x => phase(x, plugin)) && stringArray(v.next_actions) && (!skillV11 || (fullEvalCheckpoint(v.checkpoint) && arrayOf(v.executable_actions, executableAction))) && (!plugin || nullable(v.verification, isRecord)) && (!plugin || nonBlank(v.state_file) && sha256(v.graph_hash) && integer(v.revision) && arrayOf(v.jobs, pluginStateJob)) && (plugin || fullEvalJob(v.job));
};
const audit = (v) => isRecord(v) && exact(v, ["schema_version", "artifact", "status", "skill", "line_count", "description", "findings", "pattern_review", "summary"]) && v.schema_version === "1.0" && v.artifact === "skill-authoring-audit" && enumValue(v.status, ["pass", "warning", "fail"]) && nonBlank(v.skill) && integer(v.line_count) && isRecord(v.description) && exact(v.description, ["characters", "words"]) && integer(v.description.characters) && integer(v.description.words) && arrayOf(v.findings, finding) && arrayOf(v.pattern_review, x => isRecord(x) && exact(x, ["pattern", "relevant", "reason", "apply_to"]) && nonBlank(x.pattern) && typeof x.relevant === "boolean" && nonBlank(x.reason) && nonBlank(x.apply_to)) && v.pattern_review.length === 13 && isRecord(v.summary) && exact(v.summary, ["errors", "warnings", "info"]) && integer(v.summary.errors) && integer(v.summary.warnings) && integer(v.summary.info) && v.summary.errors === v.findings.filter(x => isRecord(x) && x.severity === "error").length && v.summary.warnings === v.findings.filter(x => isRecord(x) && x.severity === "warning").length && v.summary.info === v.findings.filter(x => isRecord(x) && x.severity === "info").length && v.status === (v.summary.errors ? "fail" : v.summary.warnings ? "warning" : "pass");
const design = (v) => isRecord(v) && exact(v, ["schema_version", "artifact", "status", "eval_set", "skill_name", "scenarios", "coverage", "findings", "summary"], ["schema_version", "artifact", "status", "eval_set", "skill_path", "skill_name", "scenarios", "coverage", "findings", "summary"]) && v.schema_version === "1.0" && v.artifact === "evaluation-design" && enumValue(v.status, ["pass", "warning", "fail"]) && nonBlank(v.eval_set) && optional(v.skill_path, nonBlank) && typeof v.skill_name === "string" && arrayOf(v.scenarios, evalScenario) && isRecord(v.coverage) && exact(v.coverage, ["declared", "covered", "missing"]) && recordOf(v.coverage.declared, stringArray) && stringArray(v.coverage.covered) && stringArray(v.coverage.missing) && arrayOf(v.findings, x => finding(x, ["error", "warning"])) && isRecord(v.summary) && exact(v.summary, ["scenarios", "errors", "warnings"]) && integer(v.summary.scenarios) && integer(v.summary.errors) && integer(v.summary.warnings) && v.summary.scenarios === v.scenarios.length;
const failure = (v) => isRecord(v) && exact(v, ["eval", "configuration", "assertion", "evidence", "category", "recommended_patterns"]) && nonBlank(v.eval) && nonBlank(v.configuration) && nonBlank(v.assertion) && nonBlank(v.evidence) && nonBlank(v.category) && stringArray(v.recommended_patterns);
const analysis = (versioned, v) => isRecord(v) && exact(v, [...(versioned ? ["schema_version"] : []), "artifact", "status", "decision", "failures", "patterns"], versioned ? ["schema_version", "artifact", "status", "workspace", "skill_path", "evidence", "benchmark", "failures", "navigation", "authoring_audit", "pattern_review", "decision", "patterns"] : ["artifact", "status", "workspace", "skill_path", "evidence", "benchmark", "failures", "navigation", "authoring_audit", "pattern_review", "decision", "patterns"]) && (!versioned || v.schema_version === "1.0") && v.artifact === "evaluation-analysis" && enumValue(v.status, ["complete", "blocked"]) && enumValue(v.decision, ["retain", "revise", "accept"]) && arrayOf(v.failures, x => versioned ? failure(x) : isRecord(x) && only(x, ["eval", "configuration", "assertion", "evidence", "category", "recommended_patterns"])) && stringArray(v.patterns) && optional(v.workspace, nonBlank) && optional(v.skill_path, nonBlank) && optional(v.evidence, isRecord) && optional(v.benchmark, isRecord) && optional(v.navigation, x => Array.isArray(x) && x.every(isRecord)) && optional(v.authoring_audit, isRecord) && optional(v.pattern_review, isRecord);
const evaluationReceipt = (v) => isRecord(v) && exact(v, ["status", "evals", "workspace"], ["status", "evals", "workspace", "missing"]) && enumValue(v.status, ["complete", "blocked"]) && (integer(v.evals) || stringArray(v.evals)) && nonBlank(v.workspace) && (v.status === "blocked" ? stringArray(v.missing) : optional(v.missing, stringArray));
const feedback = (v) => isRecord(v) && exact(v, ["reviews"], ["reviews", "status"]) && arrayOf(v.reviews, x => isRecord(x) && exact(x, ["run_id", "feedback", "timestamp"]) && nonBlank(x.run_id) && typeof x.feedback === "string" && rfc3339(x.timestamp)) && optional(v.status, x => enumValue(x, ["in_progress", "complete"]));
const transcriptContent = (v) => { if (!isRecord(v) || !nonBlank(v.type))
    return false; if (v.type === "text")
    return exact(v, ["type", "text"]) && nonBlank(v.text); if (v.type === "thinking")
    return exact(v, ["type", "thinking", "signature"]) && typeof v.thinking === "string" && typeof v.signature === "string"; if (v.type === "toolRequest")
    return exact(v, ["type", "id", "toolCall"], ["type", "id", "toolCall", "_meta"]) && nonBlank(v.id) && isRecord(v.toolCall) && exact(v.toolCall, ["status", "value"]) && nonBlank(v.toolCall.status) && isRecord(v.toolCall.value) && exact(v.toolCall.value, ["name", "arguments"]) && nonBlank(v.toolCall.value.name) && isRecord(v.toolCall.value.arguments) && optional(v._meta, x => isRecord(x) && recordOf(x, scalar)); if (v.type === "toolResponse")
    return exact(v, ["type", "id", "toolResult"]) && nonBlank(v.id) && isRecord(v.toolResult) && exact(v.toolResult, ["status", "value"]) && nonBlank(v.toolResult.status) && isRecord(v.toolResult.value) && only(v.toolResult.value, ["resultType", "content"]); return false; };
const transcriptMetadata = (v) => isRecord(v) && only(v, ["total_tokens", "input_tokens", "output_tokens", "cache_read_input_tokens", "cache_write_input_tokens", "status"]) && Object.entries(v).every(([key, value]) => key === "status" ? nonBlank(value) : integer(value));
const transcript = (v) => isRecord(v) && exact(v, ["messages", "metadata"]) && arrayOf(v.messages, x => isRecord(x) && exact(x, ["role", "content"], ["role", "content", "name"]) && enumValue(x.role, ["system", "user", "assistant", "tool"]) && optional(x.name, nonBlank) && Array.isArray(x.content) && x.content.every(transcriptContent)) && transcriptMetadata(v.metadata);
const stats = (v) => isRecord(v) && exact(v, ["mean", "stddev", "min", "max"], ["mean", "stddev", "min", "max", "count"]) && [v.mean, v.stddev, v.min, v.max].every(x => x === null || finite(x)) && optional(v.count, integer);
const runResult = (v) => isRecord(v) && exact(v, ["eval_id", "configuration", "run_number", "result", "expectations", "notes"]) && (nonBlank(v.eval_id) || integer(v.eval_id)) && nonBlank(v.configuration) && positiveInteger(v.run_number) && isRecord(v.result) && exact(v.result, ["pass_rate", "passed", "failed", "total", "time_seconds", "tokens", "tool_calls", "errors"]) && nonNegative(v.result.pass_rate) && v.result.pass_rate <= 1 && integer(v.result.passed) && integer(v.result.failed) && integer(v.result.total) && v.result.passed + v.result.failed === v.result.total && nullable(v.result.time_seconds, nonNegative) && nullable(v.result.tokens, nonNegative) && integer(v.result.tool_calls) && integer(v.result.errors) && arrayOf(v.expectations, expectation) && stringArray(v.notes);
const benchmarkMetadata = (surfaceId, v) => { if (!isRecord(v) || !exact(v, ["skill_name", "skill_path", "executor_model", "analyzer_model", "timestamp", "evals_run", "runs_per_configuration"], ["skill_name", "skill_path", "executor_model", "analyzer_model", "timestamp", "evals_run", "runs_per_configuration", "source_sha256", "evaluated_source_sha256", "evaluation_kind", "human_review", "human_reviewed_at"]))
    return false; const agent = surfaceId.startsWith("agent."); return nonBlank(v.skill_name) && nonBlank(v.skill_path) && nonBlank(v.executor_model) && nonBlank(v.analyzer_model) && rfc3339(v.timestamp) && Array.isArray(v.evals_run) && v.evals_run.every(x => nonBlank(x) || integer(x)) && (agent ? positiveInteger(v.runs_per_configuration) : recordOf(v.runs_per_configuration, positiveInteger)) && optional(v.source_sha256, sha256) && optional(v.evaluated_source_sha256, sha256) && optional(v.evaluation_kind, nonBlank) && optional(v.human_review, nonBlank) && optional(v.human_reviewed_at, rfc3339); };
const summaryMetrics = (v) => isRecord(v) && exact(v, ["pass_rate", "time_seconds", "tokens"]) && stats(v.pass_rate) && stats(v.time_seconds) && stats(v.tokens);
const summaryDelta = (v) => isRecord(v) && exact(v, ["pass_rate", "time_seconds", "tokens"]) && Object.values(v).every(x => x === null || typeof x === "string");
const benchmarkSummary = (v) => isRecord(v) && Object.entries(v).every(([key, value]) => key === "delta" ? summaryDelta(value) : summaryMetrics(value));
const benchmark = (surfaceId, v) => isRecord(v) && exact(v, ["metadata", "runs", "run_summary", "notes"]) && benchmarkMetadata(surfaceId, v.metadata) && Array.isArray(v.runs) && v.runs.every(runResult) && benchmarkSummary(v.run_summary) && stringArray(v.notes);
const runSummary = (v) => isRecord(v) && exact(v, ["agent", "agent_path", "eval_count", "configurations", "runs"]) && nonBlank(v.agent) && nonBlank(v.agent_path) && integer(v.eval_count) && stringArray(v.configurations) && arrayOf(v.runs, x => isRecord(x) && (nonBlank(x.eval_id) || integer(x.eval_id)) && nonBlank(x.configuration) && nonNegative(x.total_tokens) && nonNegative(x.total_duration_seconds));
const availability = (v, p) => isRecord(v) && exact(v, ["value", "unavailable_reason"]) && ((v.value === null && nonBlank(v.unavailable_reason)) || (p(v.value) && v.unavailable_reason === null));
const triggerOutcome = (v) => isRecord(v) && exact(v, ["schema_version", "outcome", "classification", "infrastructure_failure", "reason", "time_to_trigger_ms", "total_duration_ms", "actual_turns", "usage"]) && v.schema_version === "1.0" && enumValue(v.outcome, ["triggered", "not-triggered", "timeout", "host-failure", "malformed-stream", "unsupported-telemetry"]) && nullable(v.classification, x => typeof x === "boolean") && v.infrastructure_failure === (v.classification === null) && nullable(v.reason, nonBlank) && availability(v.time_to_trigger_ms, nonNegative) && nonNegative(v.total_duration_ms) && availability(v.actual_turns, integer) && isRecord(v.usage) && exact(v.usage, ["categories", "cost_usd"]) && availability(v.usage.categories, x => recordOf(x, nonNegative)) && availability(v.usage.cost_usd, nonNegative);
const distribution = (v) => isRecord(v) && exact(v, ["count", "min", "p50", "p95", "max", "mean"]) && integer(v.count) && [v.min, v.p50, v.p95, v.max, v.mean].every(x => nullable(x, nonNegative));
const triggerCoverage = (v) => isRecord(v) && exact(v, ["available", "total", "rate", "reasons"]) && integer(v.available) && integer(v.total) && v.available <= v.total && nullable(v.rate, x => nonNegative(x) && x <= 1) && recordOf(v.reasons, integer);
const triggerMetrics = (v) => isRecord(v) && exact(v, ["classification", "infrastructure_failures", "latency_ms", "telemetry_coverage"]) && isRecord(v.classification) && exact(v.classification, ["eligible_runs", "excluded_infrastructure_runs", "accuracy", "false_positives", "false_negatives", "confusion_matrix"]) && integer(v.classification.eligible_runs) && integer(v.classification.excluded_infrastructure_runs) && nullable(v.classification.accuracy, x => nonNegative(x) && x <= 1) && integer(v.classification.false_positives) && integer(v.classification.false_negatives) && isRecord(v.classification.confusion_matrix) && recordOf(v.classification.confusion_matrix, integer) && isRecord(v.infrastructure_failures) && exact(v.infrastructure_failures, ["total", "by_outcome"]) && integer(v.infrastructure_failures.total) && recordOf(v.infrastructure_failures.by_outcome, integer) && isRecord(v.latency_ms) && exact(v.latency_ms, ["time_to_trigger", "total_duration"]) && distribution(v.latency_ms.time_to_trigger) && distribution(v.latency_ms.total_duration) && isRecord(v.telemetry_coverage) && exact(v.telemetry_coverage, ["time_to_trigger", "actual_turns", "usage_categories", "cost_usd"]) && Object.values(v.telemetry_coverage).every(triggerCoverage);
const triggerEvalV2 = (v) => isRecord(v) && exact(v, ["schema_version", "skill_name", "description", "results", "summary", "metrics"]) && v.schema_version === "2.0" && nonBlank(v.skill_name) && nonBlank(v.description) && arrayOf(v.results, x => isRecord(x) && exact(x, ["query", "should_trigger", "trigger_rate", "triggers", "runs", "pass", "classification_runs", "infrastructure_failures", "outcomes"]) && nonBlank(x.query) && typeof x.should_trigger === "boolean" && nonNegative(x.trigger_rate) && x.trigger_rate <= 1 && integer(x.triggers) && positiveInteger(x.runs) && typeof x.pass === "boolean" && integer(x.classification_runs) && integer(x.infrastructure_failures) && x.runs === x.classification_runs + x.infrastructure_failures && arrayOf(x.outcomes, triggerOutcome) && x.outcomes.length === x.runs) && isRecord(v.summary) && exact(v.summary, ["total", "passed", "failed"]) && integer(v.summary.total) && integer(v.summary.passed) && integer(v.summary.failed) && v.summary.total === v.results.length && v.summary.passed + v.summary.failed === v.summary.total && triggerMetrics(v.metrics);
const deterministicChecker = (v) => {
    if (!isRecord(v))
        return false;
    if (enumValue(v.kind, ["contains", "not-contains"]))
        return exact(v, ["kind", "value"]) && nonBlank(v.value);
    if (v.kind === "regex")
        return exact(v, ["kind", "value"], ["kind", "value", "flags"]) && nonBlank(v.value) && optional(v.flags, x => typeof x === "string");
    if (enumValue(v.kind, ["equals", "not-equals", "exists"]))
        return exact(v, ["kind", "pointer", "expected"]) && typeof v.pointer === "string";
    return false;
};
const deterministicEvidenceDetail = (v) => isRecord(v) && deterministicChecker(v.checker) && ((exact(v, ["checker", "matched", "span"], ["checker", "matched", "span", "quote", "output_sha256"]) && typeof v.matched === "boolean" && (v.span === null || isRecord(v.span) && exact(v.span, ["start", "end", "quote"]) && integer(v.span.start) && integer(v.span.end) && typeof v.span.quote === "string") && optional(v.quote, x => typeof x === "string") && optional(v.output_sha256, sha256)) || (exact(v, ["checker", "found", "actual", "expected"], ["checker", "found", "actual", "expected", "quote", "output_sha256"]) && typeof v.found === "boolean" && optional(v.quote, x => typeof x === "string") && optional(v.output_sha256, sha256)) || (exact(v, ["checker", "reason", "output_sha256"]) && nonBlank(v.reason) && sha256(v.output_sha256)));
const deterministicEvidence = (v) => isRecord(v) && exact(v, ["schema_version", "variant_sha256", "output_sha256", "assertions"]) && v.schema_version === 1 && sha256(v.variant_sha256) && sha256(v.output_sha256) && arrayOf(v.assertions, x => isRecord(x) && exact(x, ["id", "version", "classification", "text", "criterion", "assertion_sha256", "variant_sha256", "output_sha256", "verdict", "passed", "evidence"]) && nonBlank(x.id) && Number.isSafeInteger(x.version) && Number(x.version) > 0 && x.classification === "deterministic" && nonBlank(x.text) && nonBlank(x.criterion) && sha256(x.assertion_sha256) && x.variant_sha256 === v.variant_sha256 && x.output_sha256 === v.output_sha256 && enumValue(x.verdict, ["pass", "fail", "inconclusive"]) && x.passed === (x.verdict === "pass") && deterministicEvidenceDetail(x.evidence));
const evidenceMode = (v) => isRecord(v) && exact(v, ["schema_version", "planned"]) && v.schema_version === 1 && enumValue(v.planned, ["goose-evaluator", "manual-governed-import"]);
const loopHistory = (v) => isRecord(v) && positiveInteger(v.iteration) && nonBlank(v.description) && integer(v.train_passed) && integer(v.train_failed) && integer(v.train_total) && Array.isArray(v.train_results) && nullable(v.test_passed, integer) && nullable(v.test_failed, integer) && nullable(v.test_total, integer) && nullable(v.test_results, x => Array.isArray(x)) && integer(v.passed) && integer(v.failed) && integer(v.total) && Array.isArray(v.results) && v.train_passed + v.train_failed === v.train_total && v.passed + v.failed === v.total;
const loopResult = (v) => isRecord(v) && exact(v, ["original_description", "best_description", "best_score", "iterations_run", "holdout", "train_size", "test_size", "history"], ["exit_reason", "original_description", "best_description", "best_score", "best_train_score", "best_test_score", "final_description", "iterations_run", "holdout", "train_size", "test_size", "history"]) && nonBlank(v.original_description) && nonBlank(v.best_description) && (nonBlank(v.best_score) || nonNegative(v.best_score)) && integer(v.iterations_run) && nonNegative(v.holdout) && v.holdout <= 1 && integer(v.train_size) && integer(v.test_size) && arrayOf(v.history, loopHistory) && (v.history.length === 0 || v.iterations_run === v.history.length);
const validationOutcome = (v) => isRecord(v) && exact(v, ["mode", "status", "diagnostics", "components"]) && enumValue(v.mode, ["portable-load", "strict-authoring", "goose-extension", "release-gate"]) && enumValue(v.status, ["accepted", "rejected", "partial", "skipped", "skipped-invalid", "skipped-unsupported", "runtime-failed", "unsupported", "policy-failed"]) && arrayOf(v.diagnostics, diagnostic) && arrayOf(v.components, component);
const migrationFinding = (v) => isRecord(v) && exact(v, ["artifact", "classification", "message", "blocking"]) && nonBlank(v.artifact) && enumValue(v.classification, ["portable-core", "goose-extension", "legacy-compatible", "migratable", "unsupported"]) && nonBlank(v.message) && typeof v.blocking === "boolean";
const migrationReport = (v) => isRecord(v) && exact(v, ["root", "mode", "status", "findings", "proposedMoves", "proposedDocuments", "changed"], ["root", "mode", "status", "findings", "proposedMoves", "proposedDocuments", "backupDirectory", "changed"]) && nonBlank(v.root) && enumValue(v.mode, ["dry-run", "apply"]) && enumValue(v.status, ["ready", "blocked", "applied"]) && arrayOf(v.findings, migrationFinding) && arrayOf(v.proposedMoves, x => isRecord(x) && exact(x, ["from", "to", "reason"]) && nonBlank(x.from) && nonBlank(x.to) && nonBlank(x.reason)) && arrayOf(v.proposedDocuments, x => isRecord(x) && exact(x, ["path", "document", "reason"]) && nonBlank(x.path) && Object.hasOwn(x, "document") && nonBlank(x.reason)) && stringArray(v.changed) && optional(v.backupDirectory, nonBlank);
const cli = (surfaceId, v) => {
    if (!isRecord(v))
        return false;
    if (surfaceId.startsWith("skill."))
        return exact(v, ["command", "status", "exit_code", "output", "stderr"]) && enumValue(v.command, ["validate", "audit", "design-evals", "run-eval", "analyze-evaluation", "generate-report", "verify", "full-eval", "run-loop"]) && enumValue(v.status, ["success", "failure", "blocked", "usage"]) && enumValue(v.exit_code, [0, 1, 2, 3]) && nullable(v.stderr, x => typeof x === "string") && isRecord(v.output) && exact(v.output, ["valid"]) && typeof v.output.valid === "boolean";
    if (surfaceId.startsWith("agent."))
        return exact(v, ["ok", "command", "exitCode"], ["ok", "command", "exitCode", "stdout", "stderr", "error", "help"]) && typeof v.ok === "boolean" && nullable(v.command, x => enumValue(x, ["init", "validate", "install", "run-eval", "grade-eval", "aggregate-benchmark", "generate-review"])) && enumValue(v.exitCode, [0, 1, 2, 3]) && optional(v.stdout, x => typeof x === "string") && optional(v.stderr, x => typeof x === "string") && optional(v.error, nonBlank) && optional(v.help, nonBlank) && ((v.ok && v.exitCode === 0) || (!v.ok && v.exitCode !== 0));
    if (surfaceId.startsWith("hook."))
        return exact(v, ["ok", "command", "path", "warnings", "errors"]) && typeof v.ok === "boolean" && enumValue(v.command, ["init", "validate"]) && nonBlank(v.path) && stringArray(v.warnings) && stringArray(v.errors) && v.ok === (v.errors.length === 0);
    return exact(v, ["ok", "command", "output"], ["ok", "command", "output", "error"]) && typeof v.ok === "boolean" && enumValue(v.command, ["init", "validate", "migrate", "verify", "package", "full-eval"]) && scalar(v.output) && optional(v.error, nonBlank);
};
const pluginManifest = (v) => isRecord(v) && exact(v, ["$schema", "name", "version", "description"], ["$schema", "name", "version", "description", "author", "homepage", "repository", "license", "keywords", "extensions"]) && typeof v.$schema === "string" && /\/1\.0\.0\/plugin\.schema\.json$/.test(v.$schema) && nonBlank(v.name) && semver(v.version) && nonBlank(v.description) && optional(v.keywords, stringArray) && optional(v.author, isRecord) && optional(v.extensions, isRecord);
const mcpServer = (v) => isRecord(v) && nonBlank(v.type) && enumValue(v.type, ["stdio", "streamable-http"]) && (v.type === "stdio" ? exact(v, ["type", "command"], ["type", "command", "args", "env", "cwd"]) && nonBlank(v.command) && optional(v.args, stringArray) && optional(v.env, x => recordOf(x, nonBlank)) && optional(v.cwd, nonBlank) : exact(v, ["type", "url"], ["type", "url", "headers"]) && nonBlank(v.url) && optional(v.headers, x => recordOf(x, nonBlank)));
const mcp = (v) => isRecord(v) && exact(v, ["$schema", "mcpServers"]) && typeof v.$schema === "string" && /\/1\.0\.0\/mcp\.schema\.json$/.test(v.$schema) && recordOf(v.mcpServers, mcpServer);
const hookDocument = (v) => isRecord(v) && exact(v, ["hooks"]) && isRecord(v.hooks) && Object.values(v.hooks).every(x => Array.isArray(x) && x.every(y => isRecord(y) && nonBlank(y.type) && nonBlank(y.command)));
const productionApprovalIdentity = (v) => isRecord(v) && exact(v, ["id", "role"]) && nonBlank(v.id) && nonBlank(v.role) && String(v.id).trim().toLowerCase() !== "anonymous" && String(v.role).trim().toLowerCase() !== "anonymous";
const productionApprovalLineage = (v) => isRecord(v) && exact(v, ["request_id", "request_sha256"]) && nonBlank(v.request_id) && sha256(v.request_sha256);
const productionApprovalBindings = (v) => isRecord(v) && exact(v, ["artifact_sha256", "archive_sha256", "manifest_sha256", "benchmark_sha256", "test_sha256", "review_sha256"]) && Object.values(v).every(sha256);
const productionApprovalEvent = (v) => isRecord(v) && exact(v, ["revision", "action", "reviewer", "timestamp", "rationale", "accepted_risks", "waivers", "previous_event_sha256", "signature"], ["revision", "action", "reviewer", "timestamp", "rationale", "accepted_risks", "waivers", "superseded_by", "previous_event_sha256", "signature"]) && positiveInteger(v.revision) && enumValue(v.action, ["review", "approve", "reject", "expire", "supersede"]) && productionApprovalIdentity(v.reviewer) && rfc3339(v.timestamp) && nonBlank(v.rationale) && stringArray(v.accepted_risks) && stringArray(v.waivers) && sha256(v.previous_event_sha256) && isRecord(v.signature) && exact(v.signature, ["algorithm", "keyid", "value"]) && v.signature.algorithm === "Ed25519" && sha256(v.signature.keyid) && nonBlank(v.signature.value) && optional(v.superseded_by, productionApprovalLineage) && ((v.action === "supersede") === (v.superseded_by !== undefined));
const productionApproval = (v) => isRecord(v) && exact(v, ["version", "request_id", "requested_at", "expires_at", "requester", "automated_evidence", "bindings", "events"], ["version", "request_id", "requested_at", "expires_at", "requester", "automated_evidence", "bindings", "events", "supersedes"]) && v.version === "hook-production-approval/v1" && nonBlank(v.request_id) && rfc3339(v.requested_at) && rfc3339(v.expires_at) && Date.parse(String(v.expires_at)) > Date.parse(String(v.requested_at)) && productionApprovalIdentity(v.requester) && isRecord(v.automated_evidence) && exact(v.automated_evidence, ["status", "attestation_sha256"]) && enumValue(v.automated_evidence.status, ["pass", "fail"]) && sha256(v.automated_evidence.attestation_sha256) && productionApprovalBindings(v.bindings) && arrayOf(v.events, productionApprovalEvent) && optional(v.supersedes, productionApprovalLineage);
const productionApprovalSchema = (v) => deepEqual(v, productionApprovalDocument);
const schemaDocument = (surfaceId, v) => deepEqual(v, surfaceId === "schema.host-adapter.v1" ? hostProtocolSchema : surfaceId === "schema.host-event.v1" ? hostEventSchema : surfaceId === "schema.artifact-recommendation.v1" ? recommendationSchema : surfaceId === "schema.outcome-metrics.v1" ? outcomeMetricsSchema : null);
const feedbackReviewer = (v) => isRecord(v) && exact(v, ["reviewerId", "role"], ["reviewerId", "displayName", "role"]) && nonBlank(v.reviewerId) && nonBlank(v.role) && optional(v.displayName, nonBlank);
const feedbackOperation = (v) => isRecord(v) && ((exact(v, ["op", "path", "value"]) && enumValue(v.op, ["add", "replace"])) || (exact(v, ["op", "path"]) && v.op === "remove")) && nonBlank(v.path) && /^\/(?:[^~/]|~0|~1)*(?:\/(?:[^~/]|~0|~1)*)*$/.test(v.path) && !String(v.path).split("/").some(x => ["__proto__", "prototype", "constructor"].includes(x));
const feedbackHashed = (v, field) => sha256(v[field]) && hashFeedback(Object.fromEntries(Object.entries(v).filter(([key]) => key !== field))) === v[field];
const feedbackInterpretation = (v) => isRecord(v) && exact(v, ["schemaVersion", "interpretationId", "annotationId", "annotationHash", "createdAt", "interpreter", "intent", "summary", "operations", "affectedResourceIds", "requiredTests", "interpretationHash"]) && v.schemaVersion === FEEDBACK_ANNOTATION_VERSION && [v.interpretationId, v.annotationId].every(nonBlank) && sha256(v.annotationHash) && rfc3339(v.createdAt) && feedbackReviewer(v.interpreter) && enumValue(v.intent, ["modify", "remove", "move", "simplify", "explain", "replace", "merge", "behavior"]) && nonBlank(v.summary) && arrayOf(v.operations, feedbackOperation) && stringArray(v.affectedResourceIds) && stringArray(v.requiredTests) && feedbackHashed(v, "interpretationHash");
const feedbackProposal = (v) => isRecord(v) && exact(v, ["schemaVersion", "proposalId", "annotationId", "annotationHash", "interpretationId", "interpretationHash", "baseResourceId", "baseRevision", "baseHash", "action", "rationale", "operations", "affectedResourceIds", "requiredTests", "proposedAt", "proposer", "proposalHash"]) && v.schemaVersion === FEEDBACK_ANNOTATION_VERSION && [v.proposalId, v.annotationId, v.interpretationId, v.baseResourceId].every(nonBlank) && [v.annotationHash, v.interpretationHash, v.baseHash].every(sha256) && integer(v.baseRevision) && enumValue(v.action, ["accept", "reject", "correct"]) && nonBlank(v.rationale) && arrayOf(v.operations, feedbackOperation) && stringArray(v.affectedResourceIds) && stringArray(v.requiredTests) && rfc3339(v.proposedAt) && feedbackReviewer(v.proposer) && feedbackHashed(v, "proposalHash") && (v.action !== "reject" || v.operations.length === 0);
const feedbackPreview = (v) => isRecord(v) && exact(v, ["schemaVersion", "proposalId", "proposalHash", "baseResourceId", "baseRevision", "baseHash", "before", "after", "operations", "affectedResourceIds", "requiredTests", "previewHash"]) && v.schemaVersion === FEEDBACK_ANNOTATION_VERSION && nonBlank(v.proposalId) && sha256(v.proposalHash) && nonBlank(v.baseResourceId) && integer(v.baseRevision) && sha256(v.baseHash) && arrayOf(v.operations, feedbackOperation) && stringArray(v.affectedResourceIds) && stringArray(v.requiredTests) && feedbackHashed(v, "previewHash");
const feedbackDecision = (v) => isRecord(v) && exact(v, ["schemaVersion", "decisionId", "proposalId", "proposalHash", "decision", "rationale", "reviewer", "decidedAt", "expectedRevision", "expectedResourceHash", "previewHash", "decisionHash"]) && v.schemaVersion === FEEDBACK_ANNOTATION_VERSION && [v.decisionId, v.proposalId].every(nonBlank) && sha256(v.proposalHash) && enumValue(v.decision, ["accepted", "rejected"]) && nonBlank(v.rationale) && feedbackReviewer(v.reviewer) && rfc3339(v.decidedAt) && integer(v.expectedRevision) && sha256(v.expectedResourceHash) && sha256(v.previewHash) && feedbackHashed(v, "decisionHash");
const feedbackProvenance = (v) => isRecord(v) && exact(v, ["annotationId", "annotationHash", "interpretationId", "interpretationHash", "proposalId", "proposalHash", "decisionId", "decisionHash"]) && [v.annotationId, v.interpretationId, v.proposalId, v.decisionId].every(nonBlank) && [v.annotationHash, v.interpretationHash, v.proposalHash, v.decisionHash].every(sha256);
const feedbackRevision = (v) => isRecord(v) && exact(v, ["resourceId", "resourceKind", "revision", "parentRevision", "parentHash", "content", "resourceHash"], ["resourceId", "resourceKind", "revision", "parentRevision", "parentHash", "content", "resourceHash", "provenance"]) && nonBlank(v.resourceId) && enumValue(v.resourceKind, ["product", "scenario", "candidate"]) && integer(v.revision) && nullable(v.parentRevision, integer) && nullable(v.parentHash, sha256) && sha256(v.resourceHash) && hashFeedback(v.content) === v.resourceHash && optional(v.provenance, feedbackProvenance);
const feedbackEffect = (v) => isRecord(v) && ((exact(v, ["kind", "resourceId", "status", "reason", "sourceResourceId", "sourceRevision", "sourceHash"]) && v.kind === "resource" && nonBlank(v.resourceId) && enumValue(v.status, ["rerun-required", "invalidated"])) || (exact(v, ["kind", "testId", "status", "reason", "sourceResourceId", "sourceRevision", "sourceHash"]) && v.kind === "test" && nonBlank(v.testId) && v.status === "rerun-required")) && nonBlank(v.reason) && nonBlank(v.sourceResourceId) && positiveInteger(v.sourceRevision) && sha256(v.sourceHash);
const feedbackDecisionResult = (v) => isRecord(v) && exact(v, ["decision", "revision", "effects"]) && feedbackDecision(v.decision) && nullable(v.revision, feedbackRevision) && arrayOf(v.effects, feedbackEffect);
const metricTarget = (v) => isRecord(v) && exact(v, ["operator", "value", "unit"]) && enumValue(v.operator, ["<=", ">="]) && finite(v.value) && nonBlank(v.unit);
const outcomeMetricResult = (v) => isRecord(v) && exact(v, ["id", "status", "unit", "target", "provenanceIds"], ["id", "status", "value", "unit", "target", "met", "numerator", "denominator", "provenanceIds"]) && OUTCOME_METRIC_IDS.includes(v.id) && enumValue(v.status, ["computed", "missing", "opted-out", "guardrail-blocked"]) && optional(v.value, finite) && nonBlank(v.unit) && metricTarget(v.target) && optional(v.met, x => typeof x === "boolean") && optional(v.numerator, finite) && optional(v.denominator, finite) && stringArray(v.provenanceIds) && new Set(v.provenanceIds).size === v.provenanceIds.length;
const outcomeMetricsReport = (v) => isRecord(v) && exact(v, ["schemaVersion", "dictionaryVersion", "journeyId", "privacyStatus", "metrics", "northStar", "guardrails", "computationHash"]) && v.schemaVersion === OUTCOME_METRICS_VERSION && v.dictionaryVersion === OUTCOME_METRICS_VERSION && nonBlank(v.journeyId) && enumValue(v.privacyStatus, ["local-only", "opted-out"]) && Array.isArray(v.metrics) && v.metrics.length === OUTCOME_METRIC_IDS.length && v.metrics.every(outcomeMetricResult) && v.metrics.every((x, i) => x.id === OUTCOME_METRIC_IDS[i]) && outcomeMetricResult(v.northStar) && isRecord(v.northStar) && v.northStar.id === OUTCOME_METRIC_IDS.at(-1) && isRecord(v.guardrails) && exact(v.guardrails, ["releaseEligible", "blockedRunIds", "reasons"]) && typeof v.guardrails.releaseEligible === "boolean" && stringArray(v.guardrails.blockedRunIds) && stringArray(v.guardrails.reasons) && typeof v.computationHash === "string" && /^sha256:[a-f0-9]{64}$/.test(v.computationHash);
const html = (surfaceId, v) => {
    if (typeof v !== "string" || !/^\s*<!doctype html>/i.test(v) || !/<html[\s>]/i.test(v) || !/<body[\s>]/i.test(v) || !/<\/html>\s*$/i.test(v))
        return false;
    const escaped = surfaceId.replace(/[^A-Za-z0-9_-]/g, "\$&");
    const fixture = v.includes("<title>" + surfaceId + "</title>") && v.includes('data-surface="' + surfaceId + '"');
    if (fixture)
        return true;
    if (surfaceId === "skill.run-loop-report.unversioned")
        return /Skill Description Optimization/.test(v) && /<h1/.test(v);
    if (surfaceId.startsWith("skill."))
        return ((/<title>Eval Review<\/title>/.test(v) && /Eval Review:/.test(v) && v.includes("const EMBEDDED_DATA =")) || (/<title>Evaluation decision review<\/title>/.test(v) && /Evaluation decision review/.test(v) && v.includes("REVIEW_IR"))) && !/Agent Eval Review:/.test(v) && (v.includes("/*__EMBEDDED_DATA__*/") || v.includes("const REVIEW_IR="));
    if (surfaceId.startsWith("agent."))
        return /<title>Eval Review<\/title>/.test(v) && /Agent Eval Review:/.test(v) && (v.includes("const EMBEDDED_DATA =") || v.includes("/*__EMBEDDED_DATA__*/"));
    return false;
};
const markdown = (surfaceId, v) => {
    if (typeof v !== "string" || !v.trim())
        return false;
    const fixture = v.trim() === "# " + surfaceId;
    if (surfaceId === "skill.benchmark-markdown.unversioned")
        return fixture || (/^# Skill Benchmark:/m.test(v) && /^## Summary$/m.test(v) && /^\| Metric \|/m.test(v));
    if (surfaceId === "agent.benchmark-markdown.unversioned")
        return fixture || (/^# Agent Benchmark:/m.test(v) && /^## Summary$/m.test(v) && /^\| Metric \|/m.test(v));
    if (surfaceId === "creator.transcript-markdown.unversioned")
        return /^## Eval Prompt$/m.test(v) && /^## (?:Transcript|Response|Output)$/m.test(v);
    if (surfaceId === "creator.user-notes-markdown.unversioned")
        return /^#(?:#)? User Notes$/m.test(v) && /\S/.test(v.replace(/^#(?:#)? User Notes$/m, ""));
    if (surfaceId === "agent.response-markdown.unversioned")
        return /^# Agent [Rr]esponse$/m.test(v) && !/^## Eval Prompt$/m.test(v);
    return false;
};
const layout = (surfaceId, v) => isRecord(v) && exact(v, ["surface", "paths"]) && v.surface === surfaceId && Array.isArray(v.paths) && v.paths.length > 0 && v.paths.every(nonBlank) && new Set(v.paths).size === v.paths.length && v.paths.every(x => x === surfaceId || x.startsWith(surfaceId + "/"));
const exitFamily = (surfaceId, v) => isRecord(v) && exact(v, ["success", "failure", "usage", "blocked"]) && v.success === 0 && v.failure === 1 && v.usage === 2 && v.blocked === 3 && surfaceId.startsWith("result.exit-family.");
const pairedTextContent = (v) => isRecord(v) && exact(v, ["type", "text"]) && v.type === "text" && typeof v.text === "string";
const pairedMessage = (v) => isRecord(v) && exact(v, ["content"]) && arrayOf(v.content, pairedTextContent);
const pairedUsage = (v) => isRecord(v) && exact(v, [], ["total_tokens", "totalTokens"]) && Object.keys(v).length > 0 && optional(v.total_tokens, integer) && optional(v.totalTokens, integer);
const pairedEvent = (v) => isRecord(v) && ((exact(v, ["type", "message"]) && v.type === "message" && pairedMessage(v.message)) ||
    (exact(v, ["type", "output"], ["type", "output", "usage", "tokens"]) && v.type === "complete" && typeof v.output === "string" && optional(v.usage, pairedUsage) && optional(v.tokens, integer)) ||
    (exact(v, ["type", "message"]) && v.type === "progress" && typeof v.message === "string") ||
    (exact(v, ["type"], ["type", "message"]) && v.type === "error" && optional(v.message, nonBlank)));
const pairedEvents = (v) => Array.isArray(v) && v.length > 0 && v.every(pairedEvent);
const pairedFailure = (v) => isRecord(v) && exact(v, ["schema_version", "status", "failure_code", "message", "host_version", "exit_reason", "exit_code", "command", "artifact_sha256"]) && v.schema_version === "1.0" && enumValue(v.status, ["failed", "cancelled"]) && nonBlank(v.failure_code) && nonBlank(v.message) && nonBlank(v.host_version) && nonBlank(v.exit_reason) && nullable(v.exit_code, integer) && stringArray(v.command) && recordOf(v.artifact_sha256, sha256);
const evidenceReference = (v) => isRecord(v) && exact(v, ["ref", "sha256"]) && nonBlank(v.ref) && sha256(v.sha256);
const evidenceAgentReference = (v) => isRecord(v) && exact(v, ["name", "ref", "sha256"]) && nonBlank(v.name) && evidenceReference({ ref: v.ref, sha256: v.sha256 });
const evidenceCapabilities = (v) => isRecord(v) && only(v, ["filesystem", "agent_runner", "browser", "network", "tools"]) && optional(v.filesystem, x => typeof x === "boolean") && optional(v.agent_runner, x => typeof x === "boolean") && optional(v.browser, x => typeof x === "boolean") && optional(v.network, x => typeof x === "boolean") && optional(v.tools, stringArray);
const evidenceEval = (v) => isRecord(v) && exact(v, ["id", "name", "prompt", "subject", "language", "target", "preconditions", "files", "capabilities", "coverage_tags", "assertions", "metadata_sha256"]) && (nonBlank(v.id) || integer(v.id)) && nonBlank(v.name) && nonBlank(v.prompt) && nonBlank(v.subject) && nonBlank(v.language) && isRecord(v.target) && only(v.target, ["kind", "execution", "path"]) && nonBlank(v.target.kind) && optional(v.target.execution, nonBlank) && optional(v.target.path, nonBlank) && stringArray(v.preconditions) && stringArray(v.files) && evidenceCapabilities(v.capabilities) && stringArray(v.coverage_tags) && stringArray(v.assertions) && sha256(v.metadata_sha256);
const evidenceJob = (v) => isRecord(v) && exact(v, ["schema_version", "job_id", "created_at", "agent", "eval_set", "fixture_root", "fixtures", "configurations", "evals", "notice"]) && v.schema_version === "agent-creator.evidence-job/v1" && /^job_[a-f0-9]{64}$/.test(String(v.job_id)) && rfc3339(v.created_at) && evidenceAgentReference(v.agent) && evidenceReference(v.eval_set) && nonBlank(v.fixture_root) && arrayOf(v.fixtures, evidenceReference) && stringArray(v.configurations) && Array.isArray(v.evals) && v.evals.length > 0 && v.evals.every(evidenceEval) && nonBlank(v.notice);
const evidenceRun = (v) => isRecord(v) && exact(v, ["schema_version", "job_id", "run_id", "eval_id", "configuration", "response", "timing", "provenance", "trust"]) && v.schema_version === "agent-creator.evidence-run/v1" && nonBlank(v.job_id) && nonBlank(v.run_id) && (nonBlank(v.eval_id) || integer(v.eval_id)) && nonBlank(v.configuration) && isRecord(v.response) && exact(v.response, ["text", "sha256"]) && nonBlank(v.response.text) && sha256(v.response.sha256) && isRecord(v.timing) && exact(v.timing, ["total_duration_seconds"], ["total_duration_seconds", "total_tokens"]) && nonNegative(v.timing.total_duration_seconds) && optional(v.timing.total_tokens, integer) && isRecord(v.provenance) && exact(v.provenance, ["source", "producer", "captured_at"], ["source", "producer", "captured_at", "host", "notes"]) && enumValue(v.provenance.source, ["manual", "external"]) && nonBlank(v.provenance.producer) && rfc3339(v.provenance.captured_at) && optional(v.provenance.host, nonBlank) && optional(v.provenance.notes, x => typeof x === "string") && isRecord(v.trust) && exact(v.trust, ["level", "reason"], ["level", "reason", "reviewed_by"]) && enumValue(v.trust.level, ["unverified", "human-reviewed", "independently-verified"]) && nonBlank(v.trust.reason) && optional(v.trust.reviewed_by, nonBlank) && (!enumValue(v.trust.level, ["human-reviewed", "independently-verified"]) || nonBlank(v.trust.reviewed_by));
const componentEvidenceCheck = (v) => isRecord(v) && exact(v, ["id", "status", "evidence"], ["id", "status", "evidence", "reason"]) && nonBlank(v.id) && enumValue(v.status, ["pass", "fail", "blocked", "na"]) && stringArray(v.evidence) && optional(v.reason, nonBlank);
const componentEvidencePayload = (kind, v) => isRecord(v) && (kind === "skill" ? exact(v, ["evaluated_behaviors"]) && stringArray(v.evaluated_behaviors) : kind === "agent" ? exact(v, ["evaluated_tasks"]) && stringArray(v.evaluated_tasks) : kind === "hook" ? exact(v, ["events", "safety_cases"]) && stringArray(v.events) && stringArray(v.safety_cases) : kind === "mcp" ? exact(v, ["servers", "capabilities"]) && stringArray(v.servers) && stringArray(v.capabilities) : kind === "integration" ? exact(v, ["covered_components", "scenarios", "handoffs"]) && stringArray(v.covered_components) && Array.isArray(v.scenarios) && Array.isArray(v.handoffs) : false);
const componentEvidenceReceipt = (v) => isRecord(v) && exact(v, ["schema_version", "artifact", "name", "status", "source_sha256", "applicability", "checks", "payload"], ["schema_version", "artifact", "name", "status", "source_sha256", "generated_at", "applicability", "checks", "payload"]) && v.schema_version === "1.0" && enumValue(v.artifact, ["skill", "agent", "hook", "mcp", "integration"]) && nonBlank(v.name) && enumValue(v.status, ["pass", "fail", "blocked", "na"]) && sha256(v.source_sha256) && optional(v.generated_at, rfc3339) && isRecord(v.applicability) && exact(v.applicability, ["status"], ["status", "reason"]) && enumValue(v.applicability.status, ["applicable", "na"]) && optional(v.applicability.reason, nonBlank) && arrayOf(v.checks, componentEvidenceCheck) && componentEvidencePayload(v.artifact, v.payload);
const graderIdentityV2 = (v) => isRecord(v) && exact(v, ["id", "model"], ["id", "model", "provider", "command", "config", "invocation_id", "blinded"]) && nonBlank(v.id) && nonBlank(v.model) && optional(v.provider, nonBlank) && optional(v.command, stringArray) && optional(v.config, isRecord) && optional(v.invocation_id, nonBlank) && optional(v.blinded, x => typeof x === "boolean");
const executionEvidence = (v) => isRecord(v) && exact(v, ["schema_version", "skill_source_sha256", "eval_plan_sha256", "scenario_sha256", "configuration", "run_index", "artifact_sha256"], ["schema_version", "skill_source_sha256", "eval_plan_sha256", "scenario_sha256", "evidence_mode_sha256", "configuration", "run_index", "pair_index", "seed", "order", "order_position", "pair_equivalence", "grading_binding", "executor", "manual_import", "artifact_sha256"]) && v.schema_version === "1.0" && sha256(v.skill_source_sha256) && sha256(v.eval_plan_sha256) && sha256(v.scenario_sha256) && optional(v.evidence_mode_sha256, sha256) && nonBlank(v.configuration) && positiveInteger(v.run_index) && optional(v.pair_index, positiveInteger) && optional(v.seed, integer) && optional(v.order, x => arrayOf(x, y => enumValue(y, ["with_skill", "baseline"]))) && optional(v.order_position, positiveInteger) && optional(v.pair_equivalence, x => isRecord(x) && exact(x, ["model", "tools", "fixture_sha256", "timeout_seconds", "max_turns"]) && nullable(x.model, nonBlank) && stringArray(x.tools) && sha256(x.fixture_sha256) && positiveInteger(x.timeout_seconds) && positiveInteger(x.max_turns)) && optional(v.grading_binding, x => isRecord(x) && exact(x, ["authority", "assertion_set_sha256", "variant_sha256", "output_sha256", "grader_identities"]) && x.authority === "evaluator" && sha256(x.assertion_set_sha256) && sha256(x.variant_sha256) && sha256(x.output_sha256) && arrayOf(x.grader_identities, graderIdentityV2)) && optional(v.executor, x => isRecord(x) && exact(x, ["adapter", "host_version", "exit_reason", "command", "seed", "pair_index", "order_position", "executed_skill_sha256"]) && x.adapter === "goose" && nonBlank(x.host_version) && nonBlank(x.exit_reason) && stringArray(x.command) && integer(x.seed) && positiveInteger(x.pair_index) && positiveInteger(x.order_position) && nullable(x.executed_skill_sha256, sha256)) && optional(v.manual_import, x => isRecord(x) && exact(x, ["governed"]) && x.governed === true) && isRecord(v.artifact_sha256) && Object.keys(v.artifact_sha256).length > 0 && recordOf(v.artifact_sha256, sha256);
const skillStatePhase = (v) => isRecord(v) && exact(v, ["name", "depends_on", "status", "attempts", "artifacts"], ["name", "depends_on", "status", "attempts", "input_hash", "artifacts", "artifact_hashes", "detail", "error"]) && nonBlank(v.name) && stringArray(v.depends_on) && enumValue(v.status, ["pending", "running", "succeeded", "blocked", "failed", "cancelled", "stale"]) && integer(v.attempts) && stringArray(v.artifacts) && optional(v.input_hash, sha256) && optional(v.artifact_hashes, x => recordOf(x, sha256)) && optional(v.detail, nonBlank) && optional(v.error, nonBlank);
const skillFullEvalState = (v) => isRecord(v) && exact(v, ["schema_version", "job_id", "revision", "status", "skill", "workspace", "eval_set", "baseline", "phases"]) && v.schema_version === "2.0" && nonBlank(v.job_id) && integer(v.revision) && enumValue(v.status, ["active", "blocked", "failed", "cancelled", "succeeded"]) && nonBlank(v.skill) && nonBlank(v.workspace) && nonBlank(v.eval_set) && enumValue(v.baseline, ["old_skill", "without_skill"]) && arrayOf(v.phases, skillStatePhase);
const persistedPluginConfiguration = (v) => isRecord(v) && exact(v, ["pluginPath", "workspace", "componentReceipts", "integration", "archive"], ["pluginPath", "workspace", "componentReceipts", "integration", "archive", "testsStatus", "humanReview", "minPassRate", "minDelta"]) && nonBlank(v.pluginPath) && nonBlank(v.workspace) && stringArray(v.componentReceipts) && nonBlank(v.integration) && nonBlank(v.archive) && optional(v.testsStatus, nonBlank) && optional(v.humanReview, nonBlank) && optional(v.minPassRate, finite) && optional(v.minDelta, finite);
const pluginStateJob = (v) => isRecord(v) && exact(v, ["id", "phase", "depends_on", "input_hash", "idempotency_key", "status", "attempts", "detail", "output_hashes"]) && nonBlank(v.id) && nonBlank(v.phase) && stringArray(v.depends_on) && sha256(v.input_hash) && sha256(v.idempotency_key) && enumValue(v.status, ["planned", "running", "succeeded", "failed", "blocked", "cancelled", "skipped"]) && integer(v.attempts) && typeof v.detail === "string" && recordOf(v.output_hashes, x => sha256(x) || x === "missing");
const pluginFullEvalState = (v) => isRecord(v) && exact(v, ["schema_version", "command", "graph_hash", "revision", "status", "configuration", "jobs"], ["schema_version", "command", "graph_hash", "revision", "status", "configuration", "verification", "jobs"]) && v.schema_version === "1.0" && v.command === "full-eval" && sha256(v.graph_hash) && integer(v.revision) && enumValue(v.status, ["planned", "success", "failure", "blocked", "cancelled"]) && persistedPluginConfiguration(v.configuration) && arrayOf(v.jobs, pluginStateJob);
export function validateShapeById(surfaceId, validatorId, value) {
    if (validatorId === "unsupported:typescript-only")
        return false;
    if (validatorId === "schema:capability-contract")
        return validateCapabilityContract(value).valid;
    if (validatorId === "schema:evaluation-plan")
        return validateEvaluationPlan(value).valid;
    if (validatorId === "schema:result-contract")
        return validateResultContract(value).valid;
    if (validatorId === "schema:artifact-recommendation")
        return validatesSchema(recommendationSchema, value, recommendationSchema);
    if (validatorId === "schema:outcome-metrics-input")
        return validateOutcomeMetricsInput(value).valid;
    if (validatorId === "schema:feedback-annotation")
        return validateFeedbackAnnotation(value).valid;
    if (validatorId === "artifact:feedback-interpretation")
        return feedbackInterpretation(value);
    if (validatorId === "schema:feedback-proposal")
        return feedbackProposal(value);
    if (validatorId === "artifact:feedback-preview")
        return feedbackPreview(value);
    if (validatorId === "schema:feedback-decision")
        return feedbackDecision(value);
    if (validatorId === "artifact:feedback-revision")
        return feedbackRevision(value);
    if (validatorId === "schema:feedback-decision-result")
        return feedbackDecisionResult(value);
    if (validatorId === "schema:usage-cost-input")
        return validateUsageCostInput(value).valid;
    if (validatorId === "artifact:usage-cost-evidence") {
        try {
            if (!isRecord(value) || !isRecord(value.observations))
                return false;
            return deepEqual(computeUsageCostEvidence({ schemaVersion: value.schemaVersion, evidenceId: value.evidenceId, observedAt: value.observedAt, executor: value.observations.executor, grader: value.observations.grader, pricing: value.pricing, quality: value.quality }), value);
        }
        catch {
            return false;
        }
    }
    if (validatorId === "artifact:usage-cost-delta") {
        const reason = (x) => x === null || enumValue(x, ["not-exposed", "not-applicable", "provider-omitted", "adapter-omitted", "pricing-unavailable", "pricing-incomplete", "pricing-incompatible", "currency-incompatible", "zero-cost"]), metric = (x) => isRecord(x) && exact(x, ["value", "unavailableReason"]) && ((finite(x.value) && x.unavailableReason === null) || (x.value === null && reason(x.unavailableReason) && x.unavailableReason !== null)), tokens = (x) => isRecord(x) && exact(x, ["input", "output", "cached", "reasoning", "total"]) && [x.input, x.output, x.cached, x.reasoning, x.total].every(metric), totals = (x) => isRecord(x) && exact(x, ["tokens", "actualTurns", "latencyMs", "monetaryCost", "currency"]) && tokens(x.tokens) && metric(x.actualTurns) && isRecord(x.latencyMs) && exact(x.latencyMs, ["wall", "model"]) && metric(x.latencyMs.wall) && metric(x.latencyMs.model) && metric(x.monetaryCost) && nullable(x.currency, nonBlank);
        if (!isRecord(value) || !exact(value, ["schemaVersion", "baselineEvidenceHash", "candidateEvidenceHash", "executor", "grader", "combined", "quality", "qualityPerDollar", "deltaHash"]) || value.schemaVersion !== "1.0.0" || ![value.baselineEvidenceHash, value.candidateEvidenceHash, value.deltaHash].every(x => typeof x === "string" && /^sha256:[a-f0-9]{64}$/.test(x)) || !totals(value.executor) || !totals(value.grader) || !totals(value.combined) || !metric(value.quality) || !metric(value.qualityPerDollar))
            return false;
        const body = { ...value };
        delete body.deltaHash;
        const canonical = (x) => Array.isArray(x) ? x.map(canonical) : isRecord(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
        return value.deltaHash === "sha256:" + createHash("sha256").update(JSON.stringify(canonical(body))).digest("hex");
    }
    if (validatorId === "artifact:outcome-metrics-report")
        return outcomeMetricsReport(value);
    if (validatorId === "shape:json-schema-document" || validatorId === "shape:artifact-recommendation-schema-document" || validatorId === "shape:outcome-metrics-schema-document")
        return schemaDocument(surfaceId, value);
    if (validatorId === "shape:usage-cost-schema-document")
        return deepEqual(value, usageCostSchema);
    if (validatorId === "shape:production-approval-schema-document")
        return productionApprovalSchema(value);
    if (validatorId === "shape:feedback-schema-document")
        return deepEqual(value, feedbackSchemaDocuments[surfaceId]);
    const hostMap = { "host:capability-report": "capabilityReport", "host:negotiation-request": "negotiationRequest", "host:run-request": "runRequest", "host:artifact-exchange": "artifactExchange", "host:error": "error", "host:cancellation-request": "cancellationRequest", "host:cancellation-response": "cancellationResponse", "host:resume-request": "resumeRequest", "host:artifact-request": "artifactRequest" };
    if (validatorId === "host:negotiation-result")
        return Boolean(hostValidators[surfaceId.endsWith("blocked.v1") ? "negotiationBlocked" : "negotiationAccepted"]?.(value));
    if (hostMap[validatorId])
        return Boolean(hostValidators[hostMap[validatorId]]?.(surfaceId.endsWith("adapter-error.v1") && isRecord(value) ? value.data : value));
    if (validatorId === "host:event-envelope")
        return Boolean(hostEvent(value)) && (surfaceId === "contract.host.event-family.v1" || surfaceId.endsWith("event-" + String(isRecord(value) ? value.type : "") + ".v1"));
    if (validatorId === "artifact:cli-envelope")
        return cli(surfaceId, value);
    if (validatorId === "artifact:full-eval")
        return fullEval(surfaceId, value);
    if (validatorId === "artifact:skill-full-eval-state")
        return skillFullEvalState(value);
    if (validatorId === "artifact:plugin-full-eval-state")
        return pluginFullEvalState(value);
    if (validatorId === "artifact:paired-stream" || validatorId === "artifact:paired-events")
        return pairedEvents(value);
    if (validatorId === "artifact:paired-failure")
        return pairedFailure(value);
    if (validatorId === "artifact:evidence-job")
        return evidenceJob(value);
    if (validatorId === "artifact:evidence-run")
        return evidenceRun(value);
    if (validatorId === "artifact:component-evidence-receipt")
        return componentEvidenceReceipt(value);
    if (validatorId === "artifact:agent-eval-metadata-v2")
        return agentEvalMetadataV2(value);
    if (validatorId === "artifact:semantic-grading")
        return semanticGrading(value);
    if (validatorId === "artifact:evaluator-grading-v2")
        return evaluatorGrading(value);
    if (validatorId === "artifact:deterministic-evidence-v1")
        return deterministicEvidence(value);
    if (validatorId === "artifact:evidence-mode-v1")
        return evidenceMode(value);
    if (validatorId === "artifact:trigger-run-outcome-v1")
        return triggerOutcome(value);
    if (validatorId === "artifact:independent-review")
        return independentReview(value);
    if (validatorId === "artifact:evaluation-run-manifest")
        return evaluationRunManifest(value);
    if (validatorId === "artifact:production-approval")
        return productionApproval(value);
    if (validatorId === "artifact:execution-evidence")
        return executionEvidence(value);
    if (validatorId === "artifact:authoring-audit")
        return audit(value);
    if (validatorId === "artifact:evaluation-design")
        return design(value);
    if (validatorId === "artifact:evaluation-analysis")
        return analysis(surfaceId === "skill.evaluation-analysis.v1", value);
    if (validatorId === "artifact:evaluation-receipt")
        return evaluationReceipt(value);
    if (validatorId === "artifact:verification-receipt")
        return receipt(surfaceId, value);
    if (validatorId === "artifact:validation-outcome")
        return validationOutcome(value);
    if (validatorId === "artifact:migration-report")
        return migrationReport(value);
    if (validatorId === "artifact:evals-form")
        return evalsForm(value);
    if (validatorId === "artifact:eval-metadata")
        return evalMetadata(surfaceId, value);
    if (validatorId === "artifact:grading")
        return grading(value);
    if (validatorId === "artifact:timing")
        return timing(value);
    if (validatorId === "artifact:metrics")
        return metrics(value);
    if (validatorId === "artifact:feedback")
        return feedback(value);
    if (validatorId === "artifact:transcript")
        return transcript(value);
    if (validatorId === "artifact:trigger-eval-v2")
        return triggerEvalV2(value);
    if (validatorId === "artifact:run-loop-result")
        return loopResult(value);
    if (validatorId === "artifact:benchmark")
        return benchmark(surfaceId, value);
    if (validatorId === "artifact:run-summary")
        return runSummary(value);
    if (validatorId === "artifact:plugin-manifest")
        return pluginManifest(value);
    if (validatorId === "artifact:mcp-document")
        return mcp(value);
    if (validatorId === "artifact:hook-document")
        return hookDocument(value);
    if (validatorId === "artifact:hook-extension")
        return isRecord(value) && exact(value, ["version", "hooks"]) && value.version === 1 && nonBlank(value.hooks) && value.hooks.endsWith("/hooks.json");
    if (validatorId === "artifact:exit-family")
        return exitFamily(surfaceId, value);
    if (validatorId === "signature:html-document")
        return html(surfaceId, value);
    if (validatorId === "signature:markdown-document")
        return markdown(surfaceId, value);
    if (validatorId === "shape:workspace-layout")
        return layout(surfaceId, value);
    return false;
}
