// Versioned normalized execution-efficiency telemetry. Only provider event metadata is trusted; assistant output is never telemetry.
import { isAbsolute, normalize, relative, resolve } from "node:path";
export const EXECUTION_TELEMETRY_SCHEMA_VERSION = "1.3";
export const EXECUTION_TELEMETRY_PARSER_PROTOCOL = "provider-event-metadata-v4-closed-labels";
const unavailable = (source, reason) => ({ value: null, source, reason });
const observed = (value, source) => ({ value, source, reason: null });
const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const has = (o, n) => Object.prototype.hasOwnProperty.call(o, n);
function aliases(objects, names) { const out = []; for (const o of objects)
    for (const n of names)
        if (has(o, n))
            out.push(o[n]); return out; }
function numberMetric(objects, names, label, integer = true) { const values = aliases(objects, names).filter(v => v !== undefined && v !== null); if (!values.length)
    return unavailable("provider", `Provider did not report ${label}`); const valid = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && (!integer || (Number.isSafeInteger(v) && v <= Number.MAX_SAFE_INTEGER)); if (values.some(v => !valid(v)))
    return unavailable("provider", `Provider reported invalid ${label}`); if (values.some(v => v !== values[0]))
    return unavailable("provider", `Provider reported conflicting aliases for ${label}`); return observed(values[0], "provider"); }
function toolCalls(event) { const content = record(event.message).content; if (!Array.isArray(content))
    return []; return content.flatMap(item => { const value = record(item); if (!["toolRequest", "tool_request", "tool_call"].includes(String(value.type)))
    return []; let call = record(value.toolCall ?? value.tool_call); call = record(call.Ok ?? call); call = record(call.value ?? call); return Object.keys(call).length ? [call] : []; }); }
function args(call) { let value = call.arguments ?? call.args; try {
    if (typeof value === "string")
        value = JSON.parse(value);
}
catch {
    return {};
} return record(value); }
function target(call) { const values = args(call); for (const key of ["path", "file", "file_path", "source", "name"])
    if (typeof values[key] === "string" && values[key])
        return values[key]; return null; }
export function safeLocator(raw, workspaceRoot) {
    if (!raw || raw.length > 1024 || /[\x00-\x1f\x7f]/.test(raw) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) || /^[A-Za-z]:[\\/]/.test(raw) || /^\\\\/.test(raw) || /[?#@]/.test(raw) || /(?:^|[\/._-])(?:passwords?|passwds?|secrets?|tokens?|api[-_]?keys?|access[-_]?keys?|credentials?|bearer|sk-[A-Za-z0-9]|gh[pousr]_[A-Za-z0-9])(?:[=\/._:-]|$)/i.test(raw))
        return null;
    const root = resolve(workspaceRoot), resolved = isAbsolute(raw) ? resolve(raw) : resolve(root, normalize(raw)), rel = relative(root, resolved).replaceAll("\\", "/");
    return !rel || rel === ".." || rel.startsWith("../") || isAbsolute(rel) ? null : rel;
}
function callIdentity(call) { const name = String(call.name ?? ""); let value = call.arguments ?? call.args ?? null; if (typeof value === "string")
    try {
        value = JSON.parse(value);
    }
    catch { } ; return name + "\n" + JSON.stringify(value); }
/** Useful means an observable tool request or non-reasoning terminal task output, never streamed message/reasoning text. */
export function isUsefulStreamEvent(event) { if (toolCalls(event).length)
    return true; if (!["complete", "completed", "final"].includes(String(event.type)))
    return false; for (const key of ["output", "response", "result"]) {
    const value = event[key];
    if (typeof value === "string" && value.trim())
        return true;
    const object = record(value);
    if (typeof object.output === "string" && object.output.trim())
        return true;
} return false; }
export function normalizeExecutionEfficiency(input) {
    const terminal = record(input.terminal ?? [...input.events].reverse().find(event => ["complete", "completed", "error", "failed"].includes(String(event.type))) ?? {});
    // Provider telemetry may occur only in the event envelope and its dedicated metadata containers. Never inspect output/message/result.
    const usageValues = aliases([terminal], ["usage", "metrics"]);
    const usageObjects = usageValues.map(record);
    const malformedContainer = usageValues.some(v => !v || typeof v !== "object" || Array.isArray(v));
    const detailsValues = usageObjects.flatMap(o => aliases([o], ["details", "token_details", "tokenDetails"]));
    const detailsObjects = detailsValues.map(record);
    const malformedDetails = detailsValues.some(v => !v || typeof v !== "object" || Array.isArray(v));
    const objects = malformedContainer || malformedDetails ? [] : [terminal, ...usageObjects, ...detailsObjects];
    const metric = (names, label, integer = true) => malformedContainer || malformedDetails ? unavailable("provider", `Provider reported malformed telemetry metadata for ${label}`) : numberMetric(objects, names, label, integer);
    const inputTokens = metric(["input_tokens", "inputTokens", "prompt_tokens", "promptTokens"], "input tokens"), outputTokens = metric(["output_tokens", "outputTokens", "completion_tokens", "completionTokens"], "output tokens"), reasoningTokens = metric(["reasoning_tokens", "reasoningTokens"], "reasoning tokens"), cacheReadTokens = metric(["cache_read_tokens", "cacheReadTokens", "cached_tokens", "cachedTokens"], "cache-read tokens"), cacheWriteTokens = metric(["cache_write_tokens", "cacheWriteTokens"], "cache-write tokens"), totalTokens = metric(["total_tokens", "totalTokens", "tokens"], "total tokens");
    // Provider contract: total must equal all five components when complete, and must never be below the sum of a partial reported component set.
    const components = [inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens], reportedComponents = components.filter(item => item.value !== null), reportedSum = reportedComponents.reduce((sum, item) => sum + item.value, 0);
    if (totalTokens.value !== null && reportedComponents.length && ((reportedComponents.length === components.length && totalTokens.value !== reportedSum) || (reportedComponents.length < components.length && totalTokens.value < reportedSum))) {
        totalTokens.value = null;
        totalTokens.reason = "Provider total tokens disagree with reported token components";
    }
    const calls = input.events.flatMap(toolCalls), references = [], files = [], root = input.workspaceRoot ?? process.cwd();
    for (const call of calls) {
        const name = String(call.name ?? "").toLowerCase(), raw = target(call);
        if (!raw)
            continue;
        const value = safeLocator(raw, root);
        if (!value)
            continue;
        if (name.split("__").pop() === "load_skill")
            references.push(value);
        else if (/(^|__|[._-])(read|read_file|get_source_preview)$/.test(name) || name.includes("read_file"))
            files.push(value);
    }
    const unique = (values) => [...new Set(values)];
    const currencyValues = aliases(objects, ["currency", "cost_currency", "costCurrency"]).filter(v => v !== undefined && v !== null), cost = metric(["cost_usd", "costUsd", "cost"], "cost", false);
    let currency = null;
    if (cost.value !== null) {
        const impliedUsd = aliases(objects, ["cost_usd", "costUsd"]).length > 0;
        if (currencyValues.length) {
            if (currencyValues.some(v => typeof v !== "string") || currencyValues.map(v => String(v).trim().toUpperCase()).some(v => v !== String(currencyValues[0]).trim().toUpperCase())) {
                cost.value = null;
                cost.reason = "Provider reported invalid or conflicting cost currency";
            }
            else
                currency = String(currencyValues[0]).trim().toUpperCase();
        }
        else if (impliedUsd)
            currency = "USD";
        else {
            cost.value = null;
            cost.reason = "Provider reported cost without currency";
        }
        if (cost.value !== null && impliedUsd && currency !== "USD") {
            cost.value = null;
            cost.reason = "Provider cost_usd conflicts with explicit non-USD currency";
            currency = null;
        }
        if (currency && !/^(USD|EUR|GBP|JPY|CAD|AUD|CHF|CNY|INR)$/.test(currency)) {
            cost.value = null;
            cost.reason = "Provider reported unsupported cost currency";
            currency = null;
        }
    }
    return { schema_version: EXECUTION_TELEMETRY_SCHEMA_VERSION, parser_protocol: EXECUTION_TELEMETRY_PARSER_PROTOCOL, input_tokens: inputTokens, output_tokens: outputTokens, reasoning_tokens: reasoningTokens, cache_read_tokens: cacheReadTokens, cache_write_tokens: cacheWriteTokens, total_tokens: totalTokens, turns: metric(["turns", "turn_count", "turnCount"], "turns"), tool_calls: observed(calls.length, "runner-stream"), unique_tool_calls: observed(unique(calls.map(callIdentity)).length, "runner-stream"), references_read: observed(references.length, "runner-stream"), unique_references_read: observed(unique(references).length, "runner-stream"), files_read: observed(files.length, "runner-stream"), unique_files_read: observed(unique(files).length, "runner-stream"), time_to_first_useful_action_seconds: input.firstUsefulActionSeconds === null ? unavailable("runner-clock", "No useful action was observed in the stream") : observed(input.firstUsefulActionSeconds, "runner-clock"), total_duration_seconds: Number.isFinite(input.durationSeconds) && input.durationSeconds >= 0 ? observed(input.durationSeconds, "runner-clock") : unavailable("runner-clock", "Runner clock produced an invalid duration"), retries: Number.isSafeInteger(input.retries) && input.retries >= 0 ? observed(input.retries, "runner") : unavailable("runner", "Runner did not report valid nonnegative retries"), failed: observed(input.failed, "runner"), cost: { ...cost, currency: cost.value === null ? null : currency }, stream_parse: (input.streamParseErrors ?? 0) > 0 ? { status: "invalid", source: "runner-stream", error_count: input.streamParseErrors, reason: "Runner rejected " + input.streamParseErrors + " malformed stream JSON record(s)" } : { status: "valid", source: "runner-stream", error_count: 0, reason: null }, observed_references: unique(references).map(reference => ({ reference, source: "runner-stream" })), observed_files: unique(files).map(path => ({ path, source: "runner-stream" })) };
}
