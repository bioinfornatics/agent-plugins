/** Typed trigger outcomes and aggregate efficiency metrics. */
export const TRIGGER_OUTCOME_SCHEMA_VERSION = "1.0";
const finite = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const turnCount = (v) => { const value = finite(v); return value !== null && Number.isSafeInteger(value) ? value : null; };
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v) ? v : null;
const USAGE_CATEGORY_KEYS = Object.freeze({ input_tokens: "input_tokens", inputTokens: "input_tokens", output_tokens: "output_tokens", outputTokens: "output_tokens", total_tokens: "total_tokens", totalTokens: "total_tokens", cached_tokens: "cached_tokens", cachedTokens: "cached_tokens", cache_read_tokens: "cache_read_tokens", cacheReadTokens: "cache_read_tokens", cache_write_tokens: "cache_write_tokens", cacheWriteTokens: "cache_write_tokens", request_count: "request_count", requestCount: "request_count", character_count: "character_count", characterCount: "character_count", audio_seconds: "audio_seconds", audioSeconds: "audio_seconds", compute_units: "compute_units", computeUnits: "compute_units" });
const COST_KEYS = Object.freeze({ cost_usd: true, costUsd: true, total_cost_usd: true, totalCostUsd: true });
export function initialTelemetry() { return { reportedTurns: null, usage: {}, costUsd: null }; }
/** Reads only explicitly allowlisted numeric telemetry and emits canonical names; all other keys and values are discarded. */
export function observeTriggerTelemetry(event, state) { const meta = object(event.meta), metadata = object(event.metadata), usage = object(event.usage) ?? object(meta?.usage) ?? object(metadata?.usage); const turn = turnCount(event.actual_turns ?? event.actualTurns ?? meta?.actual_turns ?? meta?.actualTurns ?? metadata?.actual_turns ?? metadata?.actualTurns); if (turn !== null)
    state.reportedTurns = Math.max(state.reportedTurns ?? 0, turn); if (!usage)
    return; for (const [key, raw] of Object.entries(usage)) {
    const value = finite(raw);
    if (value === null)
        continue;
    const category = USAGE_CATEGORY_KEYS[key];
    if (category)
        state.usage[category] = value;
    else if (COST_KEYS[key])
        state.costUsd = value;
} }
function missing(reason) { return { value: null, unavailable_reason: reason }; }
export function makeTriggerOutcome(kind, startedMs, state, triggerMs) { const duration = Math.max(0, performance.now() - startedMs), classification = kind === "triggered" ? true : kind === "not-triggered" ? false : null, infra = classification === null, telemetryReason = "host stream did not provide this telemetry", reasons = { timeout: "trigger evaluation exceeded its time limit", "host-failure": "trigger evaluation host failed", "malformed-stream": "trigger evaluation host emitted a malformed stream", "unsupported-telemetry": "trigger evaluation host emitted no supported trigger decision telemetry" }, turns = state.reportedTurns, reason = infra ? reasons[kind] : null; return { schema_version: TRIGGER_OUTCOME_SCHEMA_VERSION, outcome: kind, classification, infrastructure_failure: infra, reason, time_to_trigger_ms: kind === "triggered" && triggerMs !== undefined ? { value: Math.max(0, triggerMs - startedMs), unavailable_reason: null } : missing(kind === "not-triggered" ? "skill was not triggered" : reason), total_duration_ms: duration, actual_turns: turns === null ? missing(telemetryReason) : { value: turns, unavailable_reason: null }, usage: { categories: Object.keys(state.usage).length ? { value: { ...state.usage }, unavailable_reason: null } : missing(telemetryReason), cost_usd: state.costUsd === null ? missing(telemetryReason) : { value: state.costUsd, unavailable_reason: null } } }; }
export function distribution(values) { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); if (!sorted.length)
    return { count: 0, min: null, p50: null, p95: null, max: null, mean: null }; const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]; return { count: sorted.length, min: sorted[0], p50: percentile(.5), p95: percentile(.95), max: sorted.at(-1), mean: sorted.reduce((a, b) => a + b, 0) / sorted.length }; }
export function aggregateTriggerOutcomes(records) { let tp = 0, tn = 0, fp = 0, fn = 0; const failures = { timeout: 0, "host-failure": 0, "malformed-stream": 0, "unsupported-telemetry": 0 }; for (const { should_trigger, run } of records) {
    if (run.classification === true)
        should_trigger ? tp++ : fp++;
    else if (run.classification === false)
        should_trigger ? fn++ : tn++;
    else
        failures[run.outcome] = (failures[run.outcome] ?? 0) + 1;
} const classified = tp + tn + fp + fn, total = records.length; const coverage = (select) => { const available = records.filter(x => select(x.run).value !== null).length, reasons = {}; for (const x of records) {
    const m = select(x.run);
    if (m.value === null && m.unavailable_reason)
        reasons[m.unavailable_reason] = (reasons[m.unavailable_reason] ?? 0) + 1;
} return { available, total, rate: total ? available / total : null, reasons }; }; return { classification: { eligible_runs: classified, excluded_infrastructure_runs: total - classified, accuracy: classified ? (tp + tn) / classified : null, false_positives: fp, false_negatives: fn, confusion_matrix: { true_positive: tp, true_negative: tn, false_positive: fp, false_negative: fn } }, infrastructure_failures: { total: total - classified, by_outcome: failures }, latency_ms: { time_to_trigger: distribution(records.flatMap(x => x.run.time_to_trigger_ms.value === null ? [] : [x.run.time_to_trigger_ms.value])), total_duration: distribution(records.map(x => x.run.total_duration_ms)) }, telemetry_coverage: { time_to_trigger: coverage(x => x.time_to_trigger_ms), actual_turns: coverage(x => x.actual_turns), usage_categories: coverage(x => x.usage.categories), cost_usd: coverage(x => x.usage.cost_usd) } }; }
