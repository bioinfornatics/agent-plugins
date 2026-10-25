import { HOST_ADAPTER_PROTOCOL_VERSION } from "./host-adapter-types.js";
import { negotiateHostCapabilities } from "./host-adapter.js";
import type { HostCapabilityName, HostCapabilityReport, HostCapabilityRequirement, HostNegotiationRequest } from "./host-adapter-types.js";
import type { HostPreflightConsequence, HostPreflightDiagnostic, HostPreflightInput, HostPreflightInvalidResult, HostPreflightJobInput, HostPreflightJobResult, HostPreflightOutcome, HostPreflightResult } from "./preflight-types.js";

const capabilityNames = new Set<HostCapabilityName>(["isolation", "streaming", "cancellation", "resume", "model", "tools", "filesystem", "network", "browser", "tokenMetrics", "costMetrics"]);
const isolationLevels = new Set(["none", "process", "container", "virtual-machine"]);
const streamingTransports = new Set(["iterator", "jsonl"]);
const filesystemModes = new Set(["read", "write"]);
const filesystemRequirementModes = new Set(["read", "write", "read-write"]);
const viewers = new Set(["none", "static", "live"]);
const booleanCapabilities = new Set<HostCapabilityName>(["cancellation", "resume", "network", "browser", "tokenMetrics", "costMetrics"]);
const HOSTILE_INPUT_DIAGNOSTIC = Object.freeze({
  code: "PREFLIGHT_INPUT_INVALID" as const,
  path: "$",
  message: "input could not be safely read as a closed HostPreflightInput value",
});
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const nonBlank = (value: unknown): value is string => typeof value === "string" && /\S/.test(value);
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const exactKeys = (value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean => required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
const uniqueStrings = (value: unknown, allowed?: Set<string>): value is string[] => Array.isArray(value) && value.every((item) => nonBlank(item) && (!allowed || allowed.has(item))) && new Set(value).size === value.length;

function diagnostic(path: string, message: string): HostPreflightDiagnostic { return { code: "PREFLIGHT_INPUT_INVALID", path, message }; }
function semanticList(value: unknown, allowed?: Set<string>): boolean {
  return nonBlank(value) ? (!allowed || allowed.has(value)) : uniqueStrings(value, allowed) && value.length > 0;
}
function validateRequirement(value: unknown, path: string, diagnostics: HostPreflightDiagnostic[]): value is HostCapabilityRequirement {
  if (!record(value) || !exactKeys(value, ["capability"], ["value"]) || !capabilityNames.has(value.capability as HostCapabilityName)) { diagnostics.push(diagnostic(path, "must be a closed capability requirement with a recognized capability")); return false; }
  const capability = value.capability as HostCapabilityName;
  const requirementValue = value.value;
  let valid: boolean;
  if (booleanCapabilities.has(capability)) valid = requirementValue === undefined || requirementValue === "true";
  else if (capability === "isolation") valid = requirementValue === undefined || semanticList(requirementValue, isolationLevels);
  else if (capability === "streaming") valid = requirementValue === undefined || semanticList(requirementValue, streamingTransports);
  else if (capability === "filesystem") valid = requirementValue === undefined || semanticList(requirementValue, filesystemRequirementModes);
  else if (capability === "model") valid = nonBlank(requirementValue) || (uniqueStrings(requirementValue) && requirementValue.length > 0);
  else valid = nonBlank(requirementValue) || (uniqueStrings(requirementValue) && requirementValue.length > 0);
  if (!valid) diagnostics.push(diagnostic(path + ".value", "does not match the " + capability + " capability report dimension"));
  return valid;
}
function validateNegotiation(value: unknown, path: string, diagnostics: HostPreflightDiagnostic[]): value is HostNegotiationRequest {
  if (!record(value) || !exactKeys(value, ["supportedProtocolVersions", "capabilities"])) { diagnostics.push(diagnostic(path, "must contain only supportedProtocolVersions and capabilities")); return false; }
  let valid = true;
  if (!uniqueStrings(value.supportedProtocolVersions) || value.supportedProtocolVersions.length === 0) { diagnostics.push(diagnostic(path + ".supportedProtocolVersions", "must be a non-empty unique array of non-blank strings")); valid = false; }
  if (!record(value.capabilities) || !exactKeys(value.capabilities, ["required", "optional"]) || !Array.isArray(value.capabilities.required) || !Array.isArray(value.capabilities.optional)) { diagnostics.push(diagnostic(path + ".capabilities", "must contain required and optional arrays")); return false; }
  value.capabilities.required.forEach((item, index) => { if (!validateRequirement(item, path + ".capabilities.required[" + index + "]", diagnostics)) valid = false; });
  value.capabilities.optional.forEach((item, index) => { if (!validateRequirement(item, path + ".capabilities.optional[" + index + "]", diagnostics)) valid = false; });
  return valid;
}
function validateReport(value: unknown, path: string, diagnostics: HostPreflightDiagnostic[]): value is HostCapabilityReport {
  const keys = ["protocolVersion", "supportedProtocolVersions", "host", "isolation", "streaming", "cancellation", "resume", "supportedModels", "supportedTools", "filesystem", "network", "browser", "metrics", "allowedEnvironmentNames"];
  if (!record(value) || !exactKeys(value, keys)) { diagnostics.push(diagnostic(path, "must be a complete closed HostCapabilityReport")); return false; }
  let valid = true;
  const object = (name: string, required: string[], optional: string[] = []): Record<string, unknown> | undefined => {
    const child = value[name]; if (!record(child) || !exactKeys(child, required, optional)) { diagnostics.push(diagnostic(path + "." + name, "has an incomplete or unknown-field shape")); valid = false; return undefined; } return child;
  };
  if (value.protocolVersion !== HOST_ADAPTER_PROTOCOL_VERSION) { diagnostics.push(diagnostic(path + ".protocolVersion", "must equal the supported host adapter protocol version")); valid = false; }
  if (!uniqueStrings(value.supportedProtocolVersions) || value.supportedProtocolVersions.length === 0) { diagnostics.push(diagnostic(path + ".supportedProtocolVersions", "must be a non-empty unique string array")); valid = false; }
  const host = object("host", ["name", "version", "adapterVersion"]); if (host && ![host.name, host.version, host.adapterVersion].every(nonBlank)) { diagnostics.push(diagnostic(path + ".host", "identity fields must be non-blank strings")); valid = false; }
  const isolation = object("isolation", ["supported", "levels"]); if (isolation && (typeof isolation.supported !== "boolean" || !uniqueStrings(isolation.levels, isolationLevels))) { diagnostics.push(diagnostic(path + ".isolation", "supported must be boolean and levels must be unique valid enums")); valid = false; }
  const streaming = object("streaming", ["supported", "transports"]); if (streaming && (typeof streaming.supported !== "boolean" || !uniqueStrings(streaming.transports, streamingTransports))) { diagnostics.push(diagnostic(path + ".streaming", "supported must be boolean and transports must be unique valid enums")); valid = false; }
  for (const name of ["cancellation", "browser"] as const) { const child = object(name, ["supported"]); if (child && typeof child.supported !== "boolean") { diagnostics.push(diagnostic(path + "." + name + ".supported", "must be boolean")); valid = false; } }
  const resume = object("resume", ["supported"], ["tokenTtlSeconds"]); if (resume && (typeof resume.supported !== "boolean" || (resume.tokenTtlSeconds !== undefined && !positiveInteger(resume.tokenTtlSeconds)))) { diagnostics.push(diagnostic(path + ".resume", "supported must be boolean and tokenTtlSeconds a positive safe integer when present")); valid = false; }
  for (const name of ["supportedModels", "supportedTools", "allowedEnvironmentNames"] as const) if (!uniqueStrings(value[name])) { diagnostics.push(diagnostic(path + "." + name, "must be a unique array of non-blank strings")); valid = false; }
  const filesystem = object("filesystem", ["supported", "modes", "workspaceContained"]); if (filesystem && (typeof filesystem.supported !== "boolean" || typeof filesystem.workspaceContained !== "boolean" || !uniqueStrings(filesystem.modes, filesystemModes))) { diagnostics.push(diagnostic(path + ".filesystem", "supported/workspaceContained must be boolean and modes valid unique enums")); valid = false; }
  const network = object("network", ["supported", "allowlistEnforced"]); if (network && (typeof network.supported !== "boolean" || typeof network.allowlistEnforced !== "boolean")) { diagnostics.push(diagnostic(path + ".network", "supported and allowlistEnforced must be boolean")); valid = false; }
  const metrics = object("metrics", ["tokens", "cost"]); if (metrics && (typeof metrics.tokens !== "boolean" || typeof metrics.cost !== "boolean")) { diagnostics.push(diagnostic(path + ".metrics", "tokens and cost must be boolean")); valid = false; }
  return valid;
}
function validateJob(value: unknown, path: string, diagnostics: HostPreflightDiagnostic[]): value is HostPreflightJobInput {
  if (!record(value) || !exactKeys(value, ["jobId", "negotiation"], ["safety", "viewer", "metrics"])) { diagnostics.push(diagnostic(path, "must be a closed preflight job")); return false; }
  let valid = true;
  if (!nonBlank(value.jobId)) { diagnostics.push(diagnostic(path + ".jobId", "must be a non-blank string")); valid = false; }
  if (!validateNegotiation(value.negotiation, path + ".negotiation", diagnostics)) valid = false;
  if (value.viewer !== undefined && !viewers.has(value.viewer as string)) { diagnostics.push(diagnostic(path + ".viewer", "must be none, static, or live")); valid = false; }
  if (value.safety !== undefined) {
    if (!record(value.safety) || !exactKeys(value.safety, [], ["isolation", "tools"])) { diagnostics.push(diagnostic(path + ".safety", "must contain only isolation and tools")); valid = false; }
    else {
      if (value.safety.isolation !== undefined && !isolationLevels.has(value.safety.isolation as string)) { diagnostics.push(diagnostic(path + ".safety.isolation", "must be a valid isolation enum")); valid = false; }
      if (value.safety.tools !== undefined && !uniqueStrings(value.safety.tools)) { diagnostics.push(diagnostic(path + ".safety.tools", "must be unique non-blank strings")); valid = false; }
    }
  }
  if (value.metrics !== undefined) {
    if (!record(value.metrics) || !exactKeys(value.metrics, [], ["tokens", "cost"])) { diagnostics.push(diagnostic(path + ".metrics", "must contain only tokens and cost")); valid = false; }
    else for (const name of ["tokens", "cost"] as const) if (value.metrics[name] !== undefined && typeof value.metrics[name] !== "boolean") { diagnostics.push(diagnostic(path + ".metrics." + name, "must be boolean")); valid = false; }
  }
  return valid;
}
function snapshotInput(value: unknown, active = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (active.has(value)) throw new TypeError("cyclic preflight input");
  active.add(value);
  try {
    const keys = Object.keys(value);
    if (Array.isArray(value)) {
      if (keys.some((key, index) => key !== String(index))) throw new TypeError("non-canonical preflight array");
      return keys.map((key) => snapshotInput((value as unknown as Record<string, unknown>)[key], active));
    }
    const copy: Record<string, unknown> = {};
    for (const key of keys) copy[key] = snapshotInput((value as unknown as Record<string, unknown>)[key], active);
    return copy;
  } finally { active.delete(value); }
}
function validateInput(value: unknown): { input?: HostPreflightInput; diagnostics: HostPreflightDiagnostic[] } {
  const diagnostics: HostPreflightDiagnostic[] = [];
  if (!record(value) || !exactKeys(value, ["report", "jobs"], ["requestedConcurrency", "concurrency"])) return { diagnostics: [diagnostic("$", "must be a complete closed HostPreflightInput object")] };
  let valid = validateReport(value.report, "$.report", diagnostics);
  if (!Array.isArray(value.jobs) || value.jobs.length === 0) { diagnostics.push(diagnostic("$.jobs", "must be a non-empty array")); valid = false; }
  else {
    value.jobs.forEach((job, index) => { if (!validateJob(job, "$.jobs[" + index + "]", diagnostics)) valid = false; });
    const ids = value.jobs.filter(record).map((job) => job.jobId); if (new Set(ids).size !== ids.length) { diagnostics.push(diagnostic("$.jobs", "jobId values must be unique")); valid = false; }
  }
  if (value.requestedConcurrency !== undefined && !positiveInteger(value.requestedConcurrency)) { diagnostics.push(diagnostic("$.requestedConcurrency", "must be a positive safe integer")); valid = false; }
  if (value.concurrency !== undefined) {
    if (!record(value.concurrency) || !exactKeys(value.concurrency, ["supported"], ["maxParallelJobs"])) { diagnostics.push(diagnostic("$.concurrency", "must be a closed concurrency capability")); valid = false; }
    else {
      if (typeof value.concurrency.supported !== "boolean") { diagnostics.push(diagnostic("$.concurrency.supported", "must be boolean")); valid = false; }
      if (value.concurrency.maxParallelJobs !== undefined && !positiveInteger(value.concurrency.maxParallelJobs)) { diagnostics.push(diagnostic("$.concurrency.maxParallelJobs", "must be a positive safe integer")); valid = false; }
    }
  }
  return valid && diagnostics.length === 0 ? { input: value as unknown as HostPreflightInput, diagnostics } : { diagnostics };
}

const key = (item: HostCapabilityRequirement): string => item.capability + ":" + JSON.stringify(item.value ?? null);
function safetyNegotiation(job: HostPreflightJobInput): HostNegotiationRequest {
  const required = [...job.negotiation.capabilities.required]; const safety: HostCapabilityRequirement[] = [];
  if (job.safety?.isolation) safety.push({ capability: "isolation", value: job.safety.isolation });
  if (job.safety?.tools) safety.push({ capability: "tools", value: job.safety.tools });
  const safetyKeys = new Set(safety.map(key)); for (const item of safety) if (!required.some((candidate) => key(candidate) === key(item))) required.push(item);
  return { supportedProtocolVersions: [...job.negotiation.supportedProtocolVersions], capabilities: { required, optional: job.negotiation.capabilities.optional.filter((item) => !safetyKeys.has(key(item))) } };
}
function metric(available: boolean, requested: boolean, label: "token" | "cost") { return { value: null, available, reason: available ? null : requested ? label[0].toUpperCase() + label.slice(1) + " metrics were requested but the host cannot provide them." : label[0].toUpperCase() + label.slice(1) + " metrics are unavailable from this host." } as const; }
function resolveJob(input: HostPreflightInput, job: HostPreflightJobInput, concurrencyConsequence?: HostPreflightConsequence): HostPreflightJobResult {
  const negotiation = negotiateHostCapabilities(input.report, safetyNegotiation(job)); const requestedViewer = job.viewer ?? "none"; const staticFallback = requestedViewer === "live" && !input.report.browser.supported;
  const viewer = staticFallback ? { requested: requestedViewer, resolved: "static" as const, reason: "Live browser serving is unavailable; emit a static viewer artifact instead." } : { requested: requestedViewer, resolved: requestedViewer, reason: null };
  const consequences: HostPreflightConsequence[] = [];
  if (negotiation.compatible) { consequences.push(...negotiation.degradations.map((item) => ({ code: item.code, capability: item.capability, message: item.message }))); if (staticFallback) consequences.push({ code: "STATIC_VIEWER_FALLBACK", capability: "browser", message: viewer.reason! }); if (concurrencyConsequence) consequences.push(concurrencyConsequence); if (job.metrics?.tokens && !input.report.metrics.tokens) consequences.push({ code: "TOKEN_METRICS_UNAVAILABLE", capability: "tokenMetrics", message: "Token metrics remain null because the host cannot provide them." }); if (job.metrics?.cost && !input.report.metrics.cost) consequences.push({ code: "COST_METRICS_UNAVAILABLE", capability: "costMetrics", message: "Cost metrics remain null because the host cannot provide them." }); }
  const errors = negotiation.compatible ? [] : negotiation.errors; const status = errors.length ? "blocked" : consequences.length ? "downgraded" : "runnable";
  return { jobId: job.jobId, status, launchAllowed: status !== "blocked", negotiation, viewer, metrics: { tokens: metric(input.report.metrics.tokens, job.metrics?.tokens === true, "token"), cost: metric(input.report.metrics.cost, job.metrics?.cost === true, "cost") }, consequences, errors };
}
function invalid(diagnostics: HostPreflightDiagnostic[]): HostPreflightInvalidResult { return { invalidInput: true, diagnostics, status: "blocked", launchAllowed: false, requestedConcurrency: null, effectiveConcurrency: 0, executionMode: "sequential", jobs: [] }; }
/** Resolves every planned job against one discovered host before launch. Malformed input returns a typed fail-closed result and is never negotiated. */
export function resolveHostCapabilityPreflight(value: unknown): HostPreflightOutcome {
  try {
    const validation = validateInput(snapshotInput(value)); if (!validation.input) return invalid(validation.diagnostics); const input = validation.input;
    const requestedConcurrency = input.requestedConcurrency ?? 1; let effectiveConcurrency = 1; let consequence: HostPreflightConsequence | undefined;
    if (requestedConcurrency > 1) { if (!input.concurrency?.supported) consequence = { code: "SEQUENTIAL_EXECUTION_FALLBACK", message: "Host concurrency is unavailable; " + input.jobs.length + " job(s) will run sequentially." }; else { effectiveConcurrency = Math.min(requestedConcurrency, input.concurrency.maxParallelJobs ?? requestedConcurrency, input.jobs.length); if (effectiveConcurrency < requestedConcurrency) consequence = { code: "CONCURRENCY_LIMITED", message: "Requested concurrency " + requestedConcurrency + " is limited to " + effectiveConcurrency + " by the host." }; } }
    effectiveConcurrency = Math.min(effectiveConcurrency, input.jobs.length); const jobs = input.jobs.map((job) => resolveJob(input, job, consequence)); const status = jobs.some((job) => job.status === "blocked") ? "blocked" : jobs.some((job) => job.status === "downgraded") ? "downgraded" : "runnable";
    return { invalidInput: false, diagnostics: [], status, launchAllowed: status !== "blocked", report: input.report, requestedConcurrency, effectiveConcurrency, executionMode: effectiveConcurrency === 1 ? "sequential" : "concurrent", jobs };
  } catch {
    return invalid([HOSTILE_INPUT_DIAGNOSTIC]);
  }
}
