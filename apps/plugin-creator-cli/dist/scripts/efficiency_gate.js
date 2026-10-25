import { writeFileSync } from "node:fs";
import { join } from "node:path";
export const EFFICIENCY_DIMENSIONS = ["p50_wall_latency_ms", "p95_wall_latency_ms", "actual_turns", "tokens.input", "tokens.output", "tokens.cached", "tokens.reasoning", "tokens.total", "cost"];
const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v) ? v : null;
const finite = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? (Object.is(v, -0) ? 0 : v) : null;
const signed = (v) => typeof v === "number" && Number.isFinite(v) ? (Object.is(v, -0) ? 0 : v) : null;
const rate = (v) => { const n = finite(v); return n !== null && n <= 1 ? n : null; };
const at = (v, path) => path.reduce((x, k) => record(x)?.[k], v);
const first = (v, paths, allowSigned = false) => { for (const p of paths) {
    const raw = at(v, p), n = (allowSigned ? signed : finite)(record(raw)?.value ?? record(raw)?.mean ?? raw);
    if (n !== null)
        return n;
} return null; };
const ci = (v, paths) => { for (const p of paths) {
    const x = record(at(v, p));
    if (!x)
        continue;
    const lower = signed(x.lower), upper = signed(x.upper);
    if (lower !== null && upper !== null && lower <= upper)
        return { lower, upper };
} return null; };
const coverage = (v, paths) => { for (const p of paths) {
    const x = at(v, p), n = rate(record(x)?.rate ?? record(x)?.coverage ?? x);
    if (n !== null)
        return n;
} return null; };
function variants(summary) { const keys = Object.keys(record(summary) ?? {}).filter(k => !["delta", "paired", "efficiency_conclusions"].includes(k)); const currentKey = keys.find(k => /with_(skill|agent)|candidate|current/i.test(k)) ?? keys[0]; const baselineKey = keys.find(k => /old_|without_|baseline|control/i.test(k)) ?? keys.find(k => k !== currentKey); return { current: currentKey ? summary[currentKey] : {}, baseline: baselineKey ? summary[baselineKey] : {} }; }
const absoluteAliases = {
    p50_wall_latency_ms: [{ path: ["p50_wall_latency_ms"] }, { path: ["wall_latency_ms"] }, { path: ["latency_ms"] }, { path: ["latency_seconds"], factor: 1000 }, { path: ["time_seconds"], factor: 1000 }],
    p95_wall_latency_ms: [{ path: ["p95_wall_latency_ms"] }, { path: ["wall_latency_ms"] }, { path: ["latency_ms"] }, { path: ["latency_seconds"], factor: 1000 }, { path: ["time_seconds"], factor: 1000 }],
    actual_turns: [{ path: ["actual_turns"] }, { path: ["turns"] }],
    "tokens.input": [{ path: ["tokens", "input"] }, { path: ["input_tokens"] }], "tokens.output": [{ path: ["tokens", "output"] }, { path: ["output_tokens"] }], "tokens.cached": [{ path: ["tokens", "cached"] }, { path: ["cached_tokens"] }], "tokens.reasoning": [{ path: ["tokens", "reasoning"] }, { path: ["reasoning_tokens"] }], "tokens.total": [{ path: ["tokens", "total"] }, { path: ["tokens"] }, { path: ["total_tokens"] }], cost: [{ path: ["cost"] }, { path: ["cost_usd"] }, { path: ["monetary_cost"] }],
};
const coverageAliases = {
    p50_wall_latency_ms: [["p50_wall_latency_ms"], ["wall_latency_ms"], ["latency_ms"], ["latency_seconds"], ["time_seconds"], ["duration_seconds"]], p95_wall_latency_ms: [["p95_wall_latency_ms"], ["wall_latency_ms"], ["latency_ms"], ["latency_seconds"], ["time_seconds"], ["duration_seconds"]], actual_turns: [["actual_turns"], ["turns"]],
    "tokens.input": [["tokens", "input"], ["input_tokens"]], "tokens.output": [["tokens", "output"], ["output_tokens"]], "tokens.cached": [["tokens", "cached"], ["cached_tokens"]], "tokens.reasoning": [["tokens", "reasoning"], ["reasoning_tokens"]], "tokens.total": [["tokens", "total"], ["tokens"], ["total_tokens"]], cost: [["cost"], ["cost_usd"], ["monetary_cost"]],
};
function distributionValue(root, dim) { for (const alias of absoluteAliases[dim]) {
    const node = at(root, alias.path), obj = record(node);
    let raw;
    if (dim.startsWith("p50_"))
        raw = obj?.p50 ?? (!obj ? node : undefined);
    else if (dim.startsWith("p95_"))
        raw = obj?.p95;
    else
        raw = obj?.mean ?? obj?.value ?? (!obj ? node : undefined);
    const value = finite(raw);
    if (value !== null)
        return value * (alias.factor ?? 1);
} return null; }
function pairedCandidates(summary, dim) { const root = summary?.paired?.paired ?? summary?.delta?.paired ?? summary?.paired ?? {}; const paths = { p50_wall_latency_ms: [{ path: ["p50_wall_latency_ms"] }, { path: ["latency_seconds"], factor: 1000 }, { path: ["time_seconds"], factor: 1000 }], p95_wall_latency_ms: [{ path: ["p95_wall_latency_ms"] }, { path: ["latency_seconds"], factor: 1000 }, { path: ["time_seconds"], factor: 1000 }], actual_turns: [{ path: ["actual_turns"] }, { path: ["turns"] }], "tokens.input": [{ path: ["tokens", "input"] }, { path: ["input_tokens"] }], "tokens.output": [{ path: ["tokens", "output"] }, { path: ["output_tokens"] }], "tokens.cached": [{ path: ["tokens", "cached"] }, { path: ["cached_tokens"] }], "tokens.reasoning": [{ path: ["tokens", "reasoning"] }, { path: ["reasoning_tokens"] }], "tokens.total": [{ path: ["tokens", "total"] }, { path: ["tokens"] }, { path: ["total_tokens"] }], cost: [{ path: ["cost"] }, { path: ["cost_usd"] }, { path: ["monetary_cost"] }] }; return paths[dim].map(x => ({ node: at(root, x.path), factor: x.factor ?? 1 })).filter(x => x.node !== undefined); }
function coverageFor(root, dim) { const telemetry = record(root)?.telemetry_coverage ?? record(root)?.coverage; for (const alias of coverageAliases[dim]) {
    const x = at(telemetry, alias), n = rate(record(x)?.rate ?? record(x)?.coverage ?? x);
    if (n !== null)
        return n;
} return null; }
function reportMetric(summary, dim, limit, policy) { const { current, baseline } = variants(summary), currentValue = distributionValue(current, dim), baselineValue = distributionValue(baseline, dim), candidates = pairedCandidates(summary, dim); let paired = null, factor = 1, pairedDelta = null; for (const candidate of candidates) {
    const preferred = dim.startsWith("p50_") ? [["p50"], ["value"]] : dim.startsWith("p95_") ? [["p95"], ["value"]] : [["mean"], ["value"]];
    const value = first(candidate.node, preferred, true) ?? signed(candidate.node);
    if (value !== null) {
        paired = candidate.node;
        factor = candidate.factor;
        pairedDelta = value * factor;
        break;
    }
} if (pairedDelta === null && currentValue !== null && baselineValue !== null)
    pairedDelta = currentValue - baselineValue; const interval = paired === null ? null : ci(paired, [["confidence_interval_95"], ["ci95"]]), confidence = interval ? { lower: interval.lower * factor, upper: interval.upper * factor } : null, currentCoverage = coverageFor(current, dim), baselineCoverage = coverageFor(baseline, dim), pairedCoverage = paired === null ? null : coverage(paired, [["coverage"], ["telemetry_coverage"], ["rate"]]), covered = paired === null ? null : finite(record(paired)?.covered_pairs ?? record(paired)?.count), expected = paired === null ? null : finite(record(paired)?.expected_pairs); const configured = limit !== undefined, missing = currentValue === null || baselineValue === null || pairedDelta === null; let verdict = "ignored", reason = "dimension is reported but has no configured maximum regression"; if (configured && missing) {
    verdict = policy === "block" ? "blocked" : policy === "warn" ? "warn" : "ignored";
    reason = "configured dimension has missing or invalid telemetry (policy: " + policy + ")";
}
else if (configured) {
    verdict = pairedDelta > limit ? "fail" : "pass";
    reason = verdict === "pass" ? `paired regression ${pairedDelta} <= configured maximum ${limit}` : `paired regression ${pairedDelta} exceeds configured maximum ${limit}`;
} return { configured, maximum_regression: limit ?? null, current: currentValue, baseline: baselineValue, paired_delta: pairedDelta, confidence_interval_95: confidence, coverage: { current: currentCoverage, baseline: baselineCoverage, paired: pairedCoverage, covered_pairs: covered, expected_pairs: expected }, availability: missing ? "missing" : "available", verdict, reason }; }
export function evaluateEfficiencyGate(benchmark, policy = {}) { const missing = policy.missing_telemetry ?? "ignore"; if (!["block", "warn", "ignore"].includes(missing))
    throw new TypeError("missing telemetry policy must be block, warn, or ignore"); const limits = policy.max_regressions ?? {}; for (const [key, value] of Object.entries(limits)) {
    if (!EFFICIENCY_DIMENSIONS.includes(key))
        throw new TypeError("unknown efficiency dimension: " + key);
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        throw new TypeError("maximum efficiency regressions must be finite nonnegative numbers");
} const summary = record(record(benchmark)?.run_summary) ?? {}, dimensions = Object.fromEntries(EFFICIENCY_DIMENSIONS.map(dim => [dim, reportMetric(summary, dim, limits[dim], missing)])); const values = Object.values(dimensions), failed = values.filter(x => x.verdict === "fail").length, blocked = values.filter(x => x.verdict === "blocked").length, warned = values.filter(x => x.verdict === "warn").length, configured = values.filter(x => x.configured).length, missingCount = values.filter(x => x.availability === "missing").length; return { status: failed ? "fail" : blocked ? "blocked" : "pass", reason: failed ? failed + " configured efficiency constraint(s) failed" : blocked ? blocked + " configured efficiency dimension(s) missing; block policy applied" : warned ? warned + " configured efficiency dimension(s) missing; warning policy applied" : configured ? "all configured efficiency constraints pass" : "no efficiency regression constraints configured", missing_telemetry: missing, pareto_report: { schema_version: "1.0", direction: "candidate-minus-baseline", dimensions, summary: { configured, failed, blocked, warned, missing: missingCount } } }; }
const esc = (v) => v.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export function writeEfficiencyViewer(workspace, result) { const path = join(workspace, "efficiency-report.html"), rows = EFFICIENCY_DIMENSIONS.map(d => { const x = result.pareto_report.dimensions[d], fmt = (v) => v === null ? "unavailable" : String(v), cov = x.coverage.paired === null ? "unavailable" : String(x.coverage.paired); return `<tr><th>${esc(d)}</th><td>${fmt(x.current)}</td><td>${fmt(x.baseline)}</td><td>${fmt(x.paired_delta)}</td><td>${x.confidence_interval_95 ? esc(`[${x.confidence_interval_95.lower}, ${x.confidence_interval_95.upper}]`) : "unavailable"}</td><td>${cov}</td><td>${esc(x.verdict)}</td></tr>`; }).join(""); writeFileSync(path, `<!doctype html><meta charset="utf-8"><title>Plugin efficiency Pareto report</title><h1>Plugin efficiency Pareto report</h1><p>Status: <strong>${esc(result.status)}</strong>. Missing telemetry: ${esc(result.missing_telemetry)}.</p><table><thead><tr><th>Dimension</th><th>Current</th><th>Baseline</th><th>Paired delta</th><th>95% CI</th><th>Paired coverage</th><th>Verdict</th></tr></thead><tbody>${rows}</tbody></table>`); return path; }
