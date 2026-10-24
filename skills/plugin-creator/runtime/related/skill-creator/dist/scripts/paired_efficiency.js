const contextBoundary = "Context/prompt overhead; never evidence of downstream execution savings.";
const downstreamBoundary = "Execution-derived downstream metric; eligible for paired downstream savings evidence.";
const METRICS = [
    { id: "turns", telemetry: "turns", unit: "turns", category: "downstream_execution", downstreamSavingsEligible: true, boundary: downstreamBoundary, integer: true },
    { id: "input_tokens", telemetry: "input_tokens", unit: "tokens", category: "context_overhead", downstreamSavingsEligible: false, boundary: contextBoundary, integer: true },
    { id: "output_tokens", telemetry: "output_tokens", unit: "tokens", category: "downstream_execution", downstreamSavingsEligible: true, boundary: downstreamBoundary, integer: true },
    { id: "reasoning_tokens", telemetry: "reasoning_tokens", unit: "tokens", category: "downstream_execution", downstreamSavingsEligible: true, boundary: downstreamBoundary, integer: true },
    { id: "cache_read_tokens", telemetry: "cache_read_tokens", unit: "tokens", category: "context_overhead", downstreamSavingsEligible: false, boundary: contextBoundary, integer: true },
    { id: "cache_write_tokens", telemetry: "cache_write_tokens", unit: "tokens", category: "context_overhead", downstreamSavingsEligible: false, boundary: contextBoundary, integer: true },
    { id: "total_tokens", telemetry: "total_tokens", unit: "tokens", category: "overall_consumption", downstreamSavingsEligible: false, boundary: "Overall consumption only: it contains context/prompt overhead and may report a delta, but can never independently prove downstream savings.", integer: true },
    { id: "tool_calls", telemetry: "tool_calls", unit: "calls", category: "downstream_execution", downstreamSavingsEligible: true, boundary: downstreamBoundary, integer: true },
    { id: "unique_tool_calls", telemetry: "unique_tool_calls", unit: "calls", category: "downstream_execution", downstreamSavingsEligible: true, boundary: downstreamBoundary, integer: true },
    { id: "references_read", telemetry: "references_read", unit: "references", category: "downstream_execution", downstreamSavingsEligible: true, boundary: "Execution-derived reference count; eligible only because it is observed from tool execution.", integer: true },
    { id: "unique_references_read", telemetry: "unique_references_read", unit: "references", category: "downstream_execution", downstreamSavingsEligible: true, boundary: "Execution-derived unique reference count; eligible only because it is observed from tool execution.", integer: true },
    { id: "files_read", telemetry: "files_read", unit: "files", category: "downstream_execution", downstreamSavingsEligible: true, boundary: "Execution-derived file count; eligible only because it is observed from tool execution.", integer: true },
    { id: "unique_files_read", telemetry: "unique_files_read", unit: "files", category: "downstream_execution", downstreamSavingsEligible: true, boundary: "Execution-derived unique file count; eligible only because it is observed from tool execution.", integer: true },
    { id: "time_to_first_useful_action_seconds", telemetry: "time_to_first_useful_action_seconds", unit: "seconds", category: "downstream_execution", downstreamSavingsEligible: true, boundary: downstreamBoundary },
    { id: "total_duration_seconds", telemetry: "total_duration_seconds", unit: "seconds", category: "downstream_execution", downstreamSavingsEligible: true, boundary: downstreamBoundary },
    { id: "retries", telemetry: "retries", unit: "retries", category: "downstream_execution", downstreamSavingsEligible: true, boundary: downstreamBoundary, integer: true },
    { id: "cost", telemetry: "cost", unit: "currency", category: "resource_tradeoff", downstreamSavingsEligible: false, boundary: "Aggregate cost is not component-decomposed by context versus downstream execution; report only as a resource tradeoff." }
];
const round = (n) => Math.round(n * 10000) / 10000;
function percentile(v, q) { const s = [...v].sort((a, b) => a - b), i = (s.length - 1) * q, l = Math.floor(i), u = Math.ceil(i); return round(s[l] + (s[u] - s[l]) * (i - l)); }
function summary(v) { if (!v.length)
    return { mean: null, p50: null, p95: null, sample_count: 0, min: null, max: null }; return { mean: round(v.reduce((a, b) => a + b, 0) / v.length), p50: percentile(v, .5), p95: percentile(v, .95), sample_count: v.length, min: round(Math.min(...v)), max: round(Math.max(...v)) }; }
function observed(t, d) {
    if (!t)
        return { metric: null, reason: "normalized telemetry v1.3 unavailable" };
    if (t.schema_version !== "1.3" || t.parser_protocol !== "provider-event-metadata-v4-closed-labels")
        return { metric: null, reason: "unsupported normalized telemetry schema or parser protocol" };
    const v = t[d.telemetry];
    if (!v || typeof v !== "object" || Array.isArray(v))
        return { metric: null, reason: "malformed normalized metric" };
    if (v.value === null)
        return { metric: null, reason: typeof v.reason === "string" && v.reason ? v.reason : "metric unavailable without reason" };
    if (typeof v.value !== "number" || !Number.isFinite(v.value))
        return { metric: null, reason: "non-finite normalized metric value" };
    if (v.value < 0 || v.value > Number.MAX_SAFE_INTEGER)
        return { metric: null, reason: "normalized metric value outside supported nonnegative range" };
    if (d.integer && !Number.isSafeInteger(v.value))
        return { metric: null, reason: "normalized count metric is not a safe integer" };
    if (typeof v.source !== "string" || !v.source)
        return { metric: null, reason: "malformed normalized metric source" };
    return { metric: v, reason: null };
}
const pairKey = (r) => JSON.stringify([r.scenario_id, r.model, r.reasoning, r.run_number]);
function metric(d, pairs) {
    const rows = [], reasons = new Set(), sources = new Set();
    for (const [c, b] of pairs) {
        const cv = observed(c.telemetry, d), bv = observed(b.telemetry, d);
        if (cv.metric)
            sources.add("candidate:" + cv.metric.source);
        else
            reasons.add("candidate: " + cv.reason);
        if (bv.metric)
            sources.add("baseline:" + bv.metric.source);
        else
            reasons.add("baseline: " + bv.reason);
        if (!cv.metric || !bv.metric)
            continue;
        let currency = null;
        if (d.id === "cost") {
            const cc = String(c.telemetry.cost.currency ?? "").trim().toUpperCase(), bc = String(b.telemetry.cost.currency ?? "").trim().toUpperCase();
            if (!cc || !bc) {
                reasons.add("cost currency unavailable");
                continue;
            }
            if (cc !== bc) {
                reasons.add("cost currency mismatch: candidate " + cc + ", baseline " + bc);
                continue;
            }
            currency = cc;
        }
        rows.push({ c: cv.metric.value, b: bv.metric.value, currency });
    }
    let included = rows;
    if (d.id === "cost") {
        const currencies = [...new Set(rows.map(x => x.currency))].sort();
        if (currencies.length > 1) {
            reasons.add("mixed cost currencies excluded: " + currencies.join(", "));
            included = [];
        }
    }
    const cs = included.map(x => x.c), bs = included.map(x => x.b), ds = included.map(x => x.c - x.b), currency = included[0]?.currency;
    return { id: d.id, unit: d.id === "cost" ? (currency ?? "currency") : d.unit, taxonomy: { category: d.category, downstream_savings_eligible: d.downstreamSavingsEligible, boundary: d.boundary }, lower_is_better: true, candidate: summary(cs), baseline: summary(bs), delta: summary(ds), availability: { available: ds.length > 0, paired_sample_count: ds.length, excluded_pair_count: pairs.length - ds.length, reasons: [...reasons].sort() }, provenance: { telemetry_schema: "1.3", sources: [...sources].sort(), cost_provider_reported: d.id === "cost" && ds.length > 0 } };
}
function validRate(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }
function validDelta(value) { return typeof value === "number" && Number.isFinite(value) && value >= -1 && value <= 1; }
function stratum(scenario, model, reasoning, pairs) {
    const qualityReasons = new Set(), qualityRows = [];
    for (const [c, b] of pairs) {
        if (!validRate(c.pass_rate)) {
            qualityReasons.add("candidate pass rate outside finite [0,1] range");
            continue;
        }
        if (!validRate(b.pass_rate)) {
            qualityReasons.add("baseline pass rate outside finite [0,1] range");
            continue;
        }
        qualityRows.push([c.pass_rate, b.pass_rate]);
    }
    const qc = summary(qualityRows.map(x => x[0])), qb = summary(qualityRows.map(x => x[1])), qd = summary(qualityRows.map(x => x[0] - x[1])), configured = pairs.map(([c]) => c.quality_requirement).find(Boolean), rawMin = configured?.minimum_candidate_pass_rate ?? 0, rawDelta = configured?.minimum_delta ?? 0, thresholdsValid = validRate(rawMin) && validDelta(rawDelta);
    if (!thresholdsValid)
        qualityReasons.add("quality requirement threshold outside supported finite range");
    const req = { minimum_candidate_pass_rate: thresholdsValid ? rawMin : null, minimum_delta: thresholdsValid ? rawDelta : null, source: configured ? "eval_metadata.quality_requirement" : "default non-regression", valid: thresholdsValid }, qualityAvailable = qualityRows.length === pairs.length && thresholdsValid, regressed = !qualityAvailable ? null : qc.mean < rawMin || qd.mean < rawDelta, metrics = METRICS.map(d => metric(d, pairs)), available = metrics.filter(m => m.delta.mean !== null), lower = available.filter(m => m.delta.mean < 0), higher = available.filter(m => m.delta.mean > 0);
    let verdict = "inconclusive", explanation = "No paired normalized resource dimensions are available.";
    if (!qualityAvailable)
        explanation = "Paired quality or its configured thresholds are invalid or unavailable; efficiency fails closed.";
    else if (regressed === true) {
        verdict = "quality_regression";
        explanation = "Configured quality regressed; lower resource use is a tradeoff, not an efficiency improvement.";
    }
    else if (!available.length)
        explanation = "Quality did not regress, but paired normalized resource dimensions are unavailable.";
    else if (qd.mean > rawDelta && higher.length) {
        verdict = "higher_quality_cost_tradeoff";
        explanation = "Quality improved while one or more observed resource dimensions increased.";
    }
    else if (lower.length && higher.length) {
        verdict = "resource_tradeoff";
        explanation = "Quality did not regress, but observed resource dimensions moved in both directions.";
    }
    else if (lower.length) {
        verdict = "efficient_improvement";
        explanation = "Quality did not regress and at least one observed resource dimension decreased with none increasing.";
    }
    else if (higher.length) {
        verdict = "efficiency_regression";
        explanation = "Quality did not regress, but observed resource usage increased.";
    }
    else {
        verdict = "no_material_change";
        explanation = "Quality did not regress and observed resource means were unchanged.";
    }
    const execution = metrics.filter(m => m.taxonomy.downstream_savings_eligible && m.availability.available), saved = execution.filter(m => m.delta.mean < 0), downstreamAvailability = saved.length ? "observed" : execution.length ? "no_savings" : "unavailable";
    const taxonomy = { context_overhead_metric_ids: METRICS.filter(d => d.category === "context_overhead").map(d => d.id), downstream_execution_metric_ids: METRICS.filter(d => d.category === "downstream_execution").map(d => d.id), overall_consumption_metric_ids: METRICS.filter(d => d.category === "overall_consumption").map(d => d.id), resource_tradeoff_metric_ids: METRICS.filter(d => d.category === "resource_tradeoff").map(d => d.id), boundary: "Input/cache and any prompt/context-overhead metric are excluded from downstream savings. Total tokens reports overall consumption only. Aggregate cost is a resource tradeoff unless context/downstream cost components are available." };
    return { scenario_id: scenario, model, reasoning, pair_sample_count: pairs.length, quality: { candidate: qc, baseline: qb, delta: qd, requirement: req, regressed, availability: { available: qualityAvailable, paired_sample_count: qualityRows.length, excluded_pair_count: pairs.length - qualityRows.length, reasons: [...qualityReasons].sort() } }, metric_taxonomy: taxonomy, metrics, skill_context_overhead: { availability: "unavailable", reason: "Normalized telemetry v1.3 does not attribute input, cache, total tokens, or cost specifically to Skill context; component attribution is unavailable.", observed_metric_ids: metrics.filter(m => m.taxonomy.category === "context_overhead").map(m => m.id) }, downstream_execution_savings: { availability: downstreamAvailability, rule: "Observed only when at least one eligible, component-specific downstream execution metric has candidate-minus-baseline mean below zero; input, cache, total tokens, and undecomposed cost are excluded.", attribution: downstreamAvailability === "unavailable" ? "unavailable: no eligible component-specific downstream observation" : "paired observed differential only; never causal attribution", observed_metric_ids: saved.map(m => m.id), excluded_metric_ids: metrics.filter(m => !m.taxonomy.downstream_savings_eligible).map(m => m.id), reason: downstreamAvailability === "observed" ? "Paired component-specific downstream resource deltas demonstrate lower observed use." : downstreamAvailability === "no_savings" ? "Eligible paired downstream metrics show no lower mean resource use." : "Downstream attribution unavailable because no valid eligible component-specific downstream metrics are available." }, verdict, explanation };
}
export function buildQualityConditionedEfficiency(runs, candidateConfig, baselineConfig) { const cm = new Map(runs.filter(r => r.configuration === candidateConfig).map(r => [pairKey(r), r])), bm = new Map(runs.filter(r => r.configuration === baselineConfig).map(r => [pairKey(r), r])), groups = new Map(); for (const [k, c] of cm) {
    const b = bm.get(k);
    if (!b)
        continue;
    const gk = JSON.stringify([c.scenario_id, c.model, c.reasoning]), g = groups.get(gk) ?? { scenario: c.scenario_id, model: c.model, reasoning: c.reasoning, pairs: [] };
    g.pairs.push([c, b]);
    groups.set(gk, g);
} const strata = [...groups.values()].sort((a, b) => a.scenario.localeCompare(b.scenario) || a.model.localeCompare(b.model) || a.reasoning.localeCompare(b.reasoning)).map(g => stratum(g.scenario, g.model, g.reasoning, g.pairs.sort((a, b) => a[0].run_number - b[0].run_number))); return { schema_version: "1.0", telemetry_schema_version: "1.3", candidate_configuration: candidateConfig, baseline_configuration: baselineConfig, stratification: ["scenario_id", "model", "reasoning"], delta_definition: "candidate - baseline; negative resource deltas mean lower candidate usage", quality_policy: "An efficiency improvement requires configured quality not to regress; invalid quality values or thresholds fail closed.", currency_policy: "Cost is paired only within one matching currency; mismatched or mixed currencies are excluded with reasons.", metric_taxonomy_policy: "Context/overhead: input and cache. Downstream: output, reasoning, turns, execution-derived tool/reference/file counts, TTFA, duration, and retries. Overall consumption: total tokens. Resource tradeoff: undecomposed cost.", downstream_savings_policy: "Observed only from an eligible component-specific downstream metric with a negative paired mean. Input, cache, total tokens, prompt/context overhead, and undecomposed cost are excluded; total tokens may report overall consumption but never independently proves downstream savings.", strata }; }
