/** Signed fixed-point delta; a value rounding to zero prints "+0…", never toFixed's "-0…". */
function signed(value, digits) {
    const text = value.toFixed(digits);
    return Number(text) === 0 ? `+${(0).toFixed(digits)}` : `${value > 0 ? "+" : ""}${text}`;
}
/** Local receipt wall clock, host startup included; not a model latency. Invalid stamps are unavailable. */
function durationSeconds(receipt) {
    const started = Date.parse(receipt.startedAt), finished = Date.parse(receipt.finishedAt);
    return Number.isFinite(started) && Number.isFinite(finished) && finished >= started ? (finished - started) / 1000 : null;
}
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
        // Selection source is not model identity. Sort host keys so map insertion order
        // cannot split identical configured provider/model comparisons.
        const { candidateModels, model, ...options } = m.options;
        const identity = candidateModels === undefined ? { requested: model ?? null, configured: null } :
            { configured: Object.entries(candidateModels).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([agent, value]) => [agent, value.provider, value.model]) };
        return JSON.stringify([m.profile.id, m.profile.revision, m.agent, options, identity, m.receipt.host,
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
    // Resource metrics are summarized only when every selected run of both arms reports them:
    // a partial subset would compare different populations, so it is omitted with its coverage.
    const metric = (run, name) => name === "time_seconds" ? durationSeconds(run.attempt.metadata.receipt) : run.telemetry?.tokens?.total ?? null;
    const resources = {};
    const pick = (select) => Object.fromEntries(Object.entries(resources).map(([name, resource]) => [name, select(resource)]));
    const arm = (passRate, condition) => ({ pass_rate: passRate, ...pick(r => r[condition]) });
    const resourceNotes = [];
    for (const [name, digits] of [["time_seconds", 1], ["tokens", 0]]) {
        const values = runs.map(run => metric(run, name));
        const available = values.filter(value => value !== null).length;
        if (available !== runs.length) {
            resourceNotes.push(`${name} available for ${available}/${runs.length} selected runs; summary omitted, never zero-filled.`);
            continue;
        }
        const of = (condition) => runs.filter(run => run.attempt.metadata.condition === condition).map(run => metric(run, name));
        const difference = of("with").reduce((a, b) => a + b, 0) / of("with").length - of("without").reduce((a, b) => a + b, 0) / of("without").length;
        resources[name] = { with: { ...statistics(of("with")), n: of("with").length }, without: { ...statistics(of("without")), n: of("without").length }, delta: signed(difference, digits) };
    }
    const tokenSources = [...new Set(runs.map(run => run.telemetry?.source).filter((source) => !!source))];
    const notes = ["Experimental QUALITY-ONLY benchmark: full profile present versus absent, not an individual source Skill treatment.",
        "Configured provider/model identities are homogeneous when retained; legacy missing identities remain unknown. Actual candidate backend and effective judge models are unverified. This is not effectiveness or calibrated-model proof.",
        "Only decisive nonempty grades included, complete selected pairs and identical selected repetitions across scenarios; no implicit latest selection.",
        "time_seconds is local receipt wall clock including host startup; tokens are host-reported cumulative session totals (all turns, re-sent context included), not output size. Per-run cost_usd_host_estimated is the host's own price estimate (pricing source unknown) and is never aggregated. Tool calls and errors are unavailable and omitted, never converted to zero. Sample standard deviation uses n-1; singleton stddev is 0.",
        ...resourceNotes];
    return { metadata: { skill_name: first.attempt.metadata.profile.name, skill_path: null,
            executor_model: first.attempt.metadata.options.model ?? null, analyzer_model: first.grade.provenance?.model.requested ?? null,
            timestamp, evals_run: evalIds, runs_per_configuration: reference.length, quality_only: true, effective_models: "unknown", selected_repetitions: reference,
            telemetry: { time_seconds: "local receipt wall clock", tokens: tokenSources.length ? tokenSources : "unavailable", cost: "per-run host estimate only; not aggregated" } },
        runs: runs.map(run => ({ eval_id: run.evalId, eval_name: run.attempt.metadata.scenario.id,
            configuration: run.attempt.metadata.condition === "with" ? "with_skill" : "without_skill", run_number: run.attempt.metadata.repetition,
            // `result` stays the exact grading summary (the report helper binds them); resources live beside it.
            result: run.grading.summary, expectations: run.grading.expectations,
            telemetry: { time_seconds: durationSeconds(run.attempt.metadata.receipt), tokens: run.telemetry?.tokens?.total ?? null,
                cost_usd_host_estimated: run.telemetry?.costUsd ?? null, source: run.telemetry?.source ?? null },
            notes: ["Quality score from the judge; telemetry is host-reported or local, unavailable values are null"] })),
        run_summary: { with_skill: arm(withStats, "with"), without_skill: arm(withoutStats, "without"),
            delta: { pass_rate: signed(delta, 4), ...pick(r => r.delta) } }, notes };
}
