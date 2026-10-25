import { createHash } from "node:crypto";
export const AGENT_RUN_PROFILE_COUNTS = Object.freeze({ fast: 1, standard: 3, release: 5 });
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}` : JSON.stringify(value);
export const evidenceSha256 = (value) => createHash("sha256").update(canonical(value)).digest("hex");
export function parseAgentRunProfile(value) {
    const profile = String(value ?? "fast");
    if (!(profile in AGENT_RUN_PROFILE_COUNTS))
        throw new TypeError("--run-profile must be fast, standard, or release");
    return profile;
}
export function scheduleAgentPairs(binding, baselineConfiguration, profile) {
    if (!baselineConfiguration || baselineConfiguration === "with_agent")
        throw new TypeError("baseline configuration must be distinct from with_agent");
    const count = AGENT_RUN_PROFILE_COUNTS[profile];
    const base = evidenceSha256({ binding, profile });
    const firstCandidate = (Number.parseInt(base.slice(0, 8), 16) & 1) === 0;
    return Array.from({ length: count }, (_, offset) => {
        const pair_index = offset + 1;
        const seed = Number.parseInt(evidenceSha256({ base, pair_index }).slice(0, 8), 16) >>> 0;
        const candidateFirst = offset % 2 === 0 ? firstCandidate : !firstCandidate;
        return { pair_index, seed, order: candidateFirst ? ["with_agent", baselineConfiguration] : [baselineConfiguration, "with_agent"] };
    });
}
function finite(value) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function rounded(value) { return Math.round(value * 1e9) / 1e9; }
function percentile(values, q) { if (!values.length)
    return null; const sorted = [...values].sort((a, b) => a - b), index = (sorted.length - 1) * q, lower = Math.floor(index), upper = Math.ceil(index); return rounded(sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)); }
export function pairedMetricStatistics(deltas, expectedPairs = deltas.length) {
    if (!Number.isInteger(expectedPairs) || expectedPairs < 0 || deltas.length > expectedPairs)
        throw new TypeError("expected pair count must cover supplied evidence");
    const values = deltas.map(finite).filter((value) => value !== null);
    const count = values.length;
    const mean = count ? values.reduce((sum, value) => sum + value, 0) / count : null;
    let stddev = null, confidence = null;
    if (count >= 2 && mean !== null) {
        stddev = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1));
        const margin = 1.96 * stddev / Math.sqrt(count);
        confidence = { lower: rounded(mean - margin), upper: rounded(mean + margin) };
    }
    return { direction: "candidate-minus-baseline", expected_pairs: expectedPairs, covered_pairs: count, missing_pairs: expectedPairs - count, coverage: expectedPairs ? count / expectedPairs : 0, mean: mean === null ? null : rounded(mean), p50: percentile(values, .5), p95: percentile(values, .95), stddev: stddev === null ? null : rounded(stddev), confidence_interval_95: confidence, statistically_valid: count >= 2 };
}
export function summarizePairedAgentRuns(current, baseline, expectedPairs) {
    const key = (run) => `${typeof run.eval_id}:${String(run.eval_id)}\u0000${run.pair_index}`;
    const currentByPair = new Map(current.map(run => [key(run), run]));
    const baselineByPair = new Map(baseline.map(run => [key(run), run]));
    const keys = [...new Set([...currentByPair.keys(), ...baselineByPair.keys()])].sort();
    const metrics = ["quality", "latency_seconds", "actual_turns", "tokens", "cost_usd"];
    const paired = Object.fromEntries(metrics.map(metric => {
        const deltas = keys.map(pair => {
            const candidate = finite(currentByPair.get(pair)?.[metric]), control = finite(baselineByPair.get(pair)?.[metric]);
            return candidate === null || control === null ? null : candidate - control;
        });
        return [metric, pairedMetricStatistics(deltas, expectedPairs)];
    }));
    const quality = paired.quality;
    const stable = quality.covered_pairs >= 2 && quality.coverage === 1 && quality.confidence_interval_95 !== null && quality.confidence_interval_95.lower > 0;
    return {
        expected_pairs: expectedPairs,
        observed_pair_slots: keys.length,
        complete_pairs: keys.filter(pair => currentByPair.has(pair) && baselineByPair.has(pair)).length,
        incomplete: keys.length !== expectedPairs || keys.some(pair => !currentByPair.has(pair) || !baselineByPair.has(pair)),
        paired,
        stable_improvement: stable,
        stable_improvement_reason: stable ? "quality 95% paired confidence interval is wholly above zero with complete coverage" : quality.covered_pairs < 2 ? "at least two covered pairs are required; one pair cannot establish stable improvement" : quality.coverage < 1 ? "stable improvement requires complete quality coverage" : "quality 95% paired confidence interval is not wholly above zero",
    };
}
