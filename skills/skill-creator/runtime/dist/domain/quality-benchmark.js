const round = (value) => Math.round(value * 10000) / 10000;
function statistics(values) {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return { mean: round(mean), stddev: round(values.length === 1 ? 0 : Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1))), min: round(Math.min(...values)), max: round(Math.max(...values)) };
}
export function qualityBenchmark(runs, timestamp) {
    const first = runs[0];
    if (!first)
        throw new Error("Benchmark requires selected paired runs");
    function signature(run) {
        const m = run.attempt.metadata, judge = run.grade.provenance;
        if (!judge)
            throw new Error("Benchmark requires judge provenance");
        // Packet hashes bind run-specific evidence, not judge configuration; retain them in the export manifest.
        return JSON.stringify([m.profile.id, m.profile.revision, m.agent, m.options, m.receipt.host,
            judge.host, judge.model.requested ?? null, judge.model.source, judge.model.effective, judge.limits]);
    }
    const expected = signature(first), pairs = new Map();
    for (const run of runs) {
        if (signature(run) !== expected)
            throw new Error("Benchmark requested candidate/judge configurations must be homogeneous");
        const m = run.attempt.metadata;
        if (m.receipt.status !== "completed" || m.receipt.collection !== "complete")
            throw new Error("Benchmark requires completed, completely collected runs");
        const key = JSON.stringify([m.scenario.id, m.repetition]);
        pairs.set(key, [...(pairs.get(key) ?? []), run]);
    }
    for (const pair of pairs.values())
        if (pair.length !== 2 || pair[0]?.attempt.metadata.condition === pair[1]?.attempt.metadata.condition || pair[0]?.attempt.metadata.pairId !== pair[1]?.attempt.metadata.pairId)
            throw new Error("Benchmark requires complete selected with/without pairs");
    const evalIds = [...new Set(runs.map(run => run.evalId))].sort((a, b) => a - b);
    const repetitions = (evalId) => [...new Set(runs.filter(run => run.evalId === evalId).map(run => run.attempt.metadata.repetition))].sort((a, b) => a - b);
    const reference = repetitions(first.evalId);
    if (evalIds.some(id => JSON.stringify(repetitions(id)) !== JSON.stringify(reference)))
        throw new Error("Benchmark selected repetitions must be rectangular across scenarios");
    const withStats = statistics(runs.filter(run => run.attempt.metadata.condition === "with").map(run => run.grading.summary.pass_rate));
    const withoutStats = statistics(runs.filter(run => run.attempt.metadata.condition === "without").map(run => run.grading.summary.pass_rate));
    const mean = (condition) => {
        const rates = runs.filter(run => run.attempt.metadata.condition === condition).map(run => run.grading.summary.pass_rate);
        return rates.reduce((sum, value) => sum + value, 0) / rates.length;
    };
    // Round the raw difference, not a difference of already-rounded summary means.
    const delta = round(mean("with") - mean("without"));
    const notes = ["Experimental QUALITY-ONLY benchmark: full profile present versus absent, not an individual source Skill treatment.",
        "Requested configurations are homogeneous; effective candidate and judge models remain unknown. This is not effectiveness or calibrated-model proof.",
        "Only decisive nonempty grades included, complete selected pairs and identical selected repetitions across scenarios; no implicit latest selection.",
        "Duration, tokens, cost, tool calls and errors are unavailable and omitted, never converted to zero. Sample standard deviation uses n-1; singleton stddev is 0."];
    return { metadata: { skill_name: first.attempt.metadata.profile.name, skill_path: null,
            executor_model: first.attempt.metadata.options.model ?? null, analyzer_model: first.grade.provenance?.model.requested ?? null,
            timestamp, evals_run: evalIds, runs_per_configuration: reference.length, quality_only: true, effective_models: "unknown", selected_repetitions: reference },
        runs: runs.map(run => ({ eval_id: run.evalId, eval_name: run.attempt.metadata.scenario.id,
            configuration: run.attempt.metadata.condition === "with" ? "with_skill" : "without_skill", run_number: run.attempt.metadata.repetition,
            result: run.grading.summary, expectations: run.grading.expectations, notes: ["Quality only; unavailable telemetry omitted"] })),
        run_summary: { with_skill: { pass_rate: withStats }, without_skill: { pass_rate: withoutStats }, delta: { pass_rate: `${delta >= 0 ? "+" : ""}${delta.toFixed(4)}` } }, notes };
}
