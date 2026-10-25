import { lstatSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { EvaluationPlanValidationError, canonicalJsonEqual, hashEvaluationPlan } from "./evaluation.js";
import { validateResultContract } from "./result.js";
import { HOST_ADAPTER_PROTOCOL_VERSION, HostAdapterError } from "./host-adapter-types.js";
const terminal = new Set(["completed", "blocked", "failed", "cancelled"]);
const capabilityNames = new Set(["isolation", "streaming", "cancellation", "resume", "model", "tools", "filesystem", "network", "browser", "tokenMetrics", "costMetrics"]);
const sensitiveKey = /(?:^|_)(?:secret|password|credential|api[_-]?key|access[_-]?token|refresh[_-]?token)(?:$|_)/i;
const credentialReference = /^[a-z][a-z0-9+.-]*:\/\/[^ \t\r\n]+$/i;
const sha256Pattern = /^[a-f0-9]{64}$/;
const rfc3339Pattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;
function error(code, message, retryable = false, details) { return { code, message, retryable, ...(details ? { details } : {}) }; }
function pathEntryExists(candidate) { try {
    lstatSync(candidate);
    return true;
}
catch {
    return false;
} }
function canonicalExistingPath(candidate) {
    let ancestor = resolve(candidate);
    const suffix = [];
    while (!pathEntryExists(ancestor)) {
        const parent = dirname(ancestor);
        if (parent === ancestor)
            return undefined;
        suffix.unshift(basename(ancestor));
        ancestor = parent;
    }
    try {
        return resolve(realpathSync.native(ancestor), ...suffix);
    }
    catch {
        return undefined;
    }
}
function contained(root, candidate) {
    const canonicalRoot = canonicalExistingPath(root);
    const canonicalCandidate = canonicalExistingPath(candidate);
    if (!canonicalRoot || !canonicalCandidate)
        return false;
    const rel = relative(canonicalRoot, canonicalCandidate);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
function hasSensitiveData(value) {
    if (Array.isArray(value))
        return value.some(hasSensitiveData);
    if (!value || typeof value !== "object")
        return false;
    return Object.entries(value).some(([key, child]) => sensitiveKey.test(key) || hasSensitiveData(child));
}
function filesystemModeAvailable(modes, value) {
    if (value === "read-write")
        return modes.includes("read") && modes.includes("write");
    return (value === "read" || value === "write") && modes.includes(value);
}
function requirementAvailable(report, requirement) {
    const values = Array.isArray(requirement.value) ? requirement.value : requirement.value === undefined ? [] : [requirement.value];
    switch (requirement.capability) {
        case "isolation": return report.isolation.supported && (!values.length || values.every((v) => report.isolation.levels.includes(v)));
        case "streaming": return report.streaming.supported && (!values.length || values.every((v) => report.streaming.transports.includes(v)));
        case "cancellation": return report.cancellation.supported;
        case "resume": return report.resume.supported;
        case "model": return values.length > 0 && values.every((v) => report.supportedModels.includes(v));
        case "tools": return values.every((v) => report.supportedTools.includes(v));
        case "filesystem": return report.filesystem.supported && report.filesystem.workspaceContained && values.every((v) => filesystemModeAvailable(report.filesystem.modes, v));
        case "network": return report.network.supported;
        case "browser": return report.browser.supported;
        case "tokenMetrics": return report.metrics.tokens;
        case "costMetrics": return report.metrics.cost;
    }
}
const hostAdapterErrorCodes = new Set(["PROTOCOL_VERSION_UNSUPPORTED", "REQUIRED_CAPABILITY_MISSING", "RUN_REQUEST_INVALID", "WORKSPACE_BOUNDARY_VIOLATION", "FILE_BOUNDARY_VIOLATION", "TOOL_NOT_ALLOWED", "ENVIRONMENT_NOT_ALLOWED", "CREDENTIAL_VALUE_FORBIDDEN", "SECRET_IN_EVENT", "EVENT_SEQUENCE_INVALID", "ARTIFACT_INVALID", "RUN_NOT_FOUND", "RESUME_INVALID", "RESUME_STALE", "CANCELLATION_UNSUPPORTED", "INTERNAL_ERROR"]);
const eventTypes = new Set(["accepted", "started", "progress", "heartbeat", "artifact", "completed", "blocked", "failed", "cancelled"]);
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const nonBlank = (value) => typeof value === "string" && /\S/.test(value);
const nonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
const nonNegativeNumber = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
function hasOnlyKeys(value, allowed) { const keys = new Set(allowed); return Object.keys(value).every((key) => keys.has(key)); }
function degradationMatchesSchema(value) {
    if (!isRecord(value) || !hasOnlyKeys(value, ["capability", "code", "message"]))
        return false;
    return Object.keys(value).length === 3 && capabilityNames.has(value.capability) && value.code === "OPTIONAL_CAPABILITY_UNAVAILABLE" && nonBlank(value.message);
}
function acceptedDataMatchesSchema(value) {
    if (!isRecord(value) || !hasOnlyKeys(value, ["resumeToken", "degradations"]) || !Array.isArray(value.degradations))
        return false;
    return (value.resumeToken === undefined || nonBlank(value.resumeToken)) && value.degradations.every(degradationMatchesSchema);
}
function optionalMessageDataMatchesSchema(value) {
    return isRecord(value) && hasOnlyKeys(value, ["message"]) && (value.message === undefined || nonBlank(value.message));
}
function progressDataMatchesSchema(value) {
    if (!isRecord(value) || !hasOnlyKeys(value, ["message", "completed", "total"]) || !nonBlank(value.message))
        return false;
    if (value.completed !== undefined && !nonNegativeInteger(value.completed))
        return false;
    if (value.total !== undefined && !nonNegativeInteger(value.total))
        return false;
    return value.completed === undefined || value.total === undefined || value.completed <= value.total;
}
function artifactDescriptorMatchesSchema(value) {
    if (!isRecord(value) || !hasOnlyKeys(value, ["artifactId", "path", "sha256", "mediaType", "size"]) || Object.keys(value).length !== 5)
        return false;
    return nonBlank(value.artifactId) && nonBlank(value.path) && typeof value.sha256 === "string" && sha256Pattern.test(value.sha256) && nonBlank(value.mediaType) && nonNegativeInteger(value.size);
}
function artifactDataMatchesSchema(value) {
    return isRecord(value) && hasOnlyKeys(value, ["artifact"]) && Object.keys(value).length === 1 && artifactDescriptorMatchesSchema(value.artifact);
}
function metricsMatchSchema(value) {
    if (!isRecord(value) || !hasOnlyKeys(value, ["inputTokens", "outputTokens", "totalTokens", "costUsd"]))
        return false;
    return [value.inputTokens, value.outputTokens, value.totalTokens].every((item) => item === undefined || nonNegativeInteger(item)) && (value.costUsd === undefined || nonNegativeNumber(value.costUsd));
}
function errorDataMatchesSchema(value) {
    if (!isRecord(value) || !hasOnlyKeys(value, ["code", "message", "retryable", "details"]))
        return false;
    return hostAdapterErrorCodes.has(value.code) && nonBlank(value.message) && typeof value.retryable === "boolean" && (value.details === undefined || isRecord(value.details));
}
function validateTerminalResult(value, eventType) {
    const validation = validateResultContract(value);
    if (!validation.valid)
        throw new HostAdapterError(error("EVENT_SEQUENCE_INVALID", "Terminal event contains an invalid ResultContract.", false, { diagnostics: validation.diagnostics }));
    if (value.operation.state !== eventType)
        throw new HostAdapterError(error("EVENT_SEQUENCE_INVALID", "Terminal event type and ResultContract operation state must agree."));
}
function validateEventPayload(event) {
    const data = event.data;
    let shapeValid = false;
    switch (event.type) {
        case "accepted":
            shapeValid = acceptedDataMatchesSchema(data);
            break;
        case "started":
        case "heartbeat":
            shapeValid = optionalMessageDataMatchesSchema(data);
            break;
        case "progress":
            shapeValid = progressDataMatchesSchema(data);
            break;
        case "artifact":
            shapeValid = artifactDataMatchesSchema(data);
            break;
        case "completed": {
            if (isRecord(data)) {
                shapeValid = hasOnlyKeys(data, ["result", "metrics"]) && Object.hasOwn(data, "result") && (data.metrics === undefined || metricsMatchSchema(data.metrics));
                if (shapeValid)
                    validateTerminalResult(data.result, "completed");
            }
            break;
        }
        case "blocked":
        case "failed": {
            if (isRecord(data)) {
                shapeValid = hasOnlyKeys(data, ["result", "error"]) && Object.hasOwn(data, "result") && Object.hasOwn(data, "error") && errorDataMatchesSchema(data.error);
                if (shapeValid)
                    validateTerminalResult(data.result, event.type);
            }
            break;
        }
        case "cancelled":
            shapeValid = isRecord(data) && hasOnlyKeys(data, ["reason"]) && Object.keys(data).length === 1 && nonBlank(data.reason);
            break;
        default: shapeValid = false;
    }
    if (!shapeValid)
        throw new HostAdapterError(error("EVENT_SEQUENCE_INVALID", "Event data does not match the closed payload contract for type " + String(event.type) + "."));
}
function eventEnvelopeMatchesSchema(value) {
    if (!isRecord(value) || !hasOnlyKeys(value, ["protocolVersion", "host", "runId", "sequence", "timestamp", "type", "data"]) || Object.keys(value).length !== 7)
        return false;
    if (!isRecord(value.host) || !hasOnlyKeys(value.host, ["name", "version", "adapterVersion"]) || Object.keys(value.host).length !== 3)
        return false;
    return value.protocolVersion === HOST_ADAPTER_PROTOCOL_VERSION && nonBlank(value.host.name) && nonBlank(value.host.version) && nonBlank(value.host.adapterVersion) && nonBlank(value.runId) && Number.isSafeInteger(value.sequence) && value.sequence >= 1 && isRfc3339Timestamp(value.timestamp) && eventTypes.has(value.type) && isRecord(value.data);
}
export function isRfc3339Timestamp(value) {
    if (typeof value !== "string")
        return false;
    const match = rfc3339Pattern.exec(value);
    if (!match)
        return false;
    const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
    const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && hour <= 23 && minute <= 59 && second <= 59 && offsetHour <= 23 && offsetMinute <= 59;
}
export function evaluationPlanId(plan) { return "sha256:" + hashEvaluationPlan(plan); }
export function negotiateHostCapabilities(report, request) {
    if (report.protocolVersion !== HOST_ADAPTER_PROTOCOL_VERSION || !request.supportedProtocolVersions.includes(HOST_ADAPTER_PROTOCOL_VERSION) || !report.supportedProtocolVersions.includes(HOST_ADAPTER_PROTOCOL_VERSION)) {
        return { compatible: false, host: report.host, report, errors: [error("PROTOCOL_VERSION_UNSUPPORTED", "Capability report protocolVersion must match the mutually selected host adapter protocol version.", false, { requested: request.supportedProtocolVersions, reported: report.protocolVersion, supported: report.supportedProtocolVersions })] };
    }
    const missing = request.capabilities.required.filter((item) => !requirementAvailable(report, item));
    if (missing.length)
        return { compatible: false, protocolVersion: HOST_ADAPTER_PROTOCOL_VERSION, host: report.host, report, errors: missing.map((item) => error("REQUIRED_CAPABILITY_MISSING", "Required capability is unavailable: " + item.capability, false, { capability: item.capability, value: item.value })) };
    const degradations = request.capabilities.optional.filter((item) => !requirementAvailable(report, item)).map((item) => ({ capability: item.capability, code: "OPTIONAL_CAPABILITY_UNAVAILABLE", message: "Optional capability is unavailable: " + item.capability }));
    return { compatible: true, protocolVersion: HOST_ADAPTER_PROTOCOL_VERSION, host: report.host, report, degradations };
}
export function assertHostIdentity(expected, actual) { if (expected.name !== actual.name || expected.version !== actual.version || expected.adapterVersion !== actual.adapterVersion)
    throw new HostAdapterError(error("RUN_REQUEST_INVALID", "Run request host identity does not match the negotiated host.")); }
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const finitePositive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
const uniqueNonBlankStrings = (value) => Array.isArray(value) && value.every(nonBlank) && new Set(value).size === value.length;
function requirementMatchesSchema(value) {
    if (!isRecord(value) || !hasOnlyKeys(value, ["capability", "value"]) || !capabilityNames.has(value.capability))
        return false;
    return value.value === undefined || nonBlank(value.value) || uniqueNonBlankStrings(value.value);
}
function runRequestStructureMatchesSchema(value) {
    if (!isRecord(value) || !hasOnlyKeys(value, ["protocolVersion", "host", "identity", "plan", "scenario", "workspace", "tools", "environment", "model", "budget", "capabilities", "idempotency"]) || Object.keys(value).length !== 12)
        return false;
    const { host, identity, scenario, workspace, environment, budget, capabilities, idempotency } = value;
    if (!isRecord(host) || !hasOnlyKeys(host, ["name", "version", "adapterVersion"]) || Object.keys(host).length !== 3 || !nonBlank(host.name) || !nonBlank(host.version) || !nonBlank(host.adapterVersion))
        return false;
    if (!isRecord(identity) || !hasOnlyKeys(identity, ["runId", "planId", "scenarioId", "configurationId", "attempt"]) || Object.keys(identity).length !== 5 || !nonBlank(identity.runId) || typeof identity.planId !== "string" || !/^sha256:[a-f0-9]{64}$/.test(identity.planId) || !nonBlank(identity.scenarioId) || !nonBlank(identity.configurationId) || !positiveInteger(identity.attempt))
        return false;
    if (!isRecord(scenario) || !hasOnlyKeys(scenario, ["id", "source", "selector"]) || !nonBlank(scenario.id) || !nonBlank(scenario.source) || (scenario.selector !== undefined && !nonBlank(scenario.selector)))
        return false;
    if (!isRecord(workspace) || !hasOnlyKeys(workspace, ["root", "cwd", "files"]) || Object.keys(workspace).length !== 3 || !nonBlank(workspace.root) || !nonBlank(workspace.cwd) || !Array.isArray(workspace.files))
        return false;
    if (!workspace.files.every((file) => isRecord(file) && hasOnlyKeys(file, ["path", "sha256", "mediaType", "size", "access"]) && Object.keys(file).length === 5 && nonBlank(file.path) && typeof file.sha256 === "string" && sha256Pattern.test(file.sha256) && nonBlank(file.mediaType) && nonNegativeInteger(file.size) && ["read", "write", "read-write"].includes(file.access)))
        return false;
    if (!uniqueNonBlankStrings(value.tools) || !nonBlank(value.model))
        return false;
    if (!isRecord(environment) || !hasOnlyKeys(environment, ["names", "credentials"]) || Object.keys(environment).length !== 2 || !uniqueNonBlankStrings(environment.names) || !Array.isArray(environment.credentials))
        return false;
    if (!environment.credentials.every((credential) => isRecord(credential) && hasOnlyKeys(credential, ["name", "reference"]) && Object.keys(credential).length === 2 && nonBlank(credential.name) && nonBlank(credential.reference)))
        return false;
    if (!isRecord(budget) || !hasOnlyKeys(budget, ["maxTurns", "timeoutSeconds", "maxTokens", "maxCostUsd"]) || !positiveInteger(budget.maxTurns) || !positiveInteger(budget.timeoutSeconds) || (budget.maxTokens !== undefined && !positiveInteger(budget.maxTokens)) || (budget.maxCostUsd !== undefined && !finitePositive(budget.maxCostUsd)))
        return false;
    if (!isRecord(capabilities) || !hasOnlyKeys(capabilities, ["required", "optional"]) || Object.keys(capabilities).length !== 2 || !Array.isArray(capabilities.required) || !Array.isArray(capabilities.optional) || ![...capabilities.required, ...capabilities.optional].every(requirementMatchesSchema))
        return false;
    return isRecord(idempotency) && hasOnlyKeys(idempotency, ["key", "resumeToken", "afterSequence"]) && nonBlank(idempotency.key) && (idempotency.resumeToken === undefined || nonBlank(idempotency.resumeToken)) && (idempotency.afterSequence === undefined || nonNegativeInteger(idempotency.afterSequence));
}
/** Validates every structural, binding, and security invariant except requested capability availability. */
export function validateHostRunRequestBinding(request, report) {
    if (!runRequestStructureMatchesSchema(request))
        throw new HostAdapterError(error("RUN_REQUEST_INVALID", "Run request does not match the closed structural contract."));
    if (request.protocolVersion !== HOST_ADAPTER_PROTOCOL_VERSION)
        throw new HostAdapterError(error("PROTOCOL_VERSION_UNSUPPORTED", "Unsupported run request protocolVersion."));
    assertHostIdentity(report.host, request.host);
    let boundPlanId;
    try {
        boundPlanId = evaluationPlanId(request.plan);
    }
    catch (caught) {
        const details = caught instanceof EvaluationPlanValidationError ? { diagnostics: caught.diagnostics } : { cause: caught instanceof Error ? caught.name : typeof caught };
        throw new HostAdapterError(error("RUN_REQUEST_INVALID", "EvaluationPlan normalization or hashing failed.", false, details));
    }
    if (!isAbsolute(request.workspace.root) || !isAbsolute(request.workspace.cwd) || !contained(request.workspace.root, request.workspace.cwd))
        throw new HostAdapterError(error("WORKSPACE_BOUNDARY_VIOLATION", "cwd must be an absolute path canonically contained by the declared workspace root."));
    for (const file of request.workspace.files)
        if (!isAbsolute(file.path) || !contained(request.workspace.root, file.path))
            throw new HostAdapterError(error("FILE_BOUNDARY_VIOLATION", "Every file path must be canonically contained by the declared workspace root.", false, { path: file.path }));
    const undeclaredTool = request.tools.find((tool) => !report.supportedTools.includes(tool));
    if (undeclaredTool)
        throw new HostAdapterError(error("TOOL_NOT_ALLOWED", "Tool is not allowlisted by the host: " + undeclaredTool));
    const undeclaredEnvironment = request.environment.names.find((name) => !report.allowedEnvironmentNames.includes(name));
    if (undeclaredEnvironment)
        throw new HostAdapterError(error("ENVIRONMENT_NOT_ALLOWED", "Environment variable name is not allowlisted: " + undeclaredEnvironment));
    if (request.environment.credentials.some((credential) => !credentialReference.test(credential.reference) || sensitiveKey.test(credential.reference) || credential.reference.includes("=")))
        throw new HostAdapterError(error("CREDENTIAL_VALUE_FORBIDDEN", "Credentials must be opaque references; values must never be serialized."));
    if (!report.supportedModels.includes(request.model))
        throw new HostAdapterError(error("REQUIRED_CAPABILITY_MISSING", "Requested model is unavailable: " + request.model));
    const plannedScenario = request.plan.scenarios.find((scenario) => scenario.id === request.identity.scenarioId);
    const configuration = request.plan.configurations.find((item) => item.id === request.identity.configurationId);
    const sameScenario = plannedScenario && plannedScenario.source === request.scenario.source && plannedScenario.selector === request.scenario.selector;
    const sameTools = configuration && configuration.tools.length === request.tools.length && configuration.tools.every((tool) => request.tools.includes(tool));
    const sameBudget = configuration && canonicalJsonEqual(configuration.budget, request.budget);
    const modelBound = configuration?.modelRoles.some((role) => role.model === request.model);
    const planBound = request.identity.planId === boundPlanId;
    if (request.identity.scenarioId !== request.scenario.id || !sameScenario || !configuration || !sameTools || !sameBudget || !modelBound || !planBound)
        throw new HostAdapterError(error("RUN_REQUEST_INVALID", "Run identity, deterministic plan ID, positive attempt, scenario, tools, model, and budget must bind the selected EvaluationPlan configuration."));
}
export function validateHostRunRequest(request, report) {
    validateHostRunRequestBinding(request, report);
    const negotiated = negotiateHostCapabilities(report, { supportedProtocolVersions: [request.protocolVersion], capabilities: request.capabilities });
    if (!negotiated.compatible)
        throw new HostAdapterError(negotiated.errors[0]);
}
export function validateArtifactDescriptor(artifact, workspaceRoot) { if (!artifact.artifactId || !isAbsolute(artifact.path) || !contained(workspaceRoot, artifact.path) || !sha256Pattern.test(artifact.sha256) || !artifact.mediaType || !Number.isSafeInteger(artifact.size) || artifact.size < 0)
    throw new HostAdapterError(error("ARTIFACT_INVALID", "Artifact must be canonically contained and include id, SHA-256, media type, and non-negative integer size.")); }
export function sha256(content) { return createHash("sha256").update(content).digest("hex"); }
export function validateHostEventSequence(events) {
    if (!events.length)
        throw new HostAdapterError(error("EVENT_SEQUENCE_INVALID", "An event stream cannot be empty."));
    const runId = events[0].runId;
    const host = events[0].host;
    for (let index = 0; index < events.length; index += 1) {
        const event = events[index];
        if (!eventEnvelopeMatchesSchema(event) || event.runId !== runId || event.host.name !== host.name || event.host.version !== host.version || event.host.adapterVersion !== host.adapterVersion || event.sequence !== index + 1)
            throw new HostAdapterError(error("EVENT_SEQUENCE_INVALID", "Events require closed envelopes, stable protocol/host/run identity, strict RFC 3339 timestamps, and contiguous monotonically increasing sequence numbers."));
        if (hasSensitiveData(event.data))
            throw new HostAdapterError(error("SECRET_IN_EVENT", "Event payloads must not carry secrets or credential values."));
        validateEventPayload(event);
        if (index === 0 && event.type !== "accepted")
            throw new HostAdapterError(error("EVENT_SEQUENCE_INVALID", "The first event must be accepted."));
        if (index > 0 && terminal.has(events[index - 1].type))
            throw new HostAdapterError(error("EVENT_SEQUENCE_INVALID", "No event may follow a terminal event."));
        if (index === 1 && event.type !== "started" && event.type !== "blocked" && event.type !== "cancelled" && event.type !== "failed")
            throw new HostAdapterError(error("EVENT_SEQUENCE_INVALID", "Accepted must be followed by started or a pre-execution terminal event."));
        if (index > 1 && !["progress", "heartbeat", "artifact", "completed", "blocked", "failed", "cancelled"].includes(event.type))
            throw new HostAdapterError(error("EVENT_SEQUENCE_INVALID", "Invalid event after started."));
    }
    if (!terminal.has(events.at(-1).type))
        throw new HostAdapterError(error("EVENT_SEQUENCE_INVALID", "A complete captured stream must end with a terminal event."));
}
