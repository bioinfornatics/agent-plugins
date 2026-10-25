/** Pure, cautious ETA estimation from comparable completed jobs. */
export const EXECUTION_ETA_SCHEMA = "agent-creator.execution-eta/v1";
export const DEFAULT_ETA_MINIMUM_SAMPLES = 5;
const ms = (value) => {
    const result = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
    if (!Number.isFinite(result))
        throw new Error("ETA timestamps must be valid");
    return result;
};
const validRetries = (value) => value === undefined || (Number.isInteger(value) && value >= 0);
const retries = (value) => value ?? 0;
const validConcurrency = (value) => Number.isInteger(value) && value >= 1;
const uniqueNames = (names) => names.every(Boolean) && new Set(names).size === names.length;
const quantile = (values, p) => { const i = (values.length - 1) * p, low = Math.floor(i), high = Math.ceil(i); return values[low] + (values[high] - values[low]) * (i - low); };
function range(values, now) {
    const sorted = values.map(value => Math.max(0, value)).sort((a, b) => a - b);
    const raw = quantile(sorted, .5);
    const unit = raw >= 3_600_000 ? 300_000 : raw >= 60_000 ? 10_000 : 1_000;
    const rounded = (value, mode) => Math.max(0, Math[mode](value / unit) * unit);
    const low = Math.max(0, rounded(quantile(sorted, .1), "floor") - unit);
    const high = Math.max(low, rounded(quantile(sorted, .9), "ceil") + unit);
    const likely = Math.min(high, Math.max(low, rounded(raw, "round")));
    const spread = high - low;
    const confidence = sorted.length >= 20 && spread <= Math.max(unit, likely * .5) ? "high" : sorted.length >= 10 && spread <= Math.max(unit, likely) ? "medium" : "low";
    return { estimate_at: new Date(now + likely).toISOString(), earliest_at: new Date(now + low).toISOString(), latest_at: new Date(now + high).toISOString(), remaining_ms: { likely, low, high }, confidence };
}
function absent(count, minimum, empty) {
    return count === 0 ? { status: "unavailable", reason: empty, sample_count: 0 } : count < minimum ? { status: "calculating", reason: "insufficient_samples", sample_count: count } : { status: "unavailable", reason: empty, sample_count: count };
}
/** A completed job is evidence only when every phase is bounded by, and ordered within, its job interval. */
function checked(job) {
    if (!validConcurrency(job.concurrency) || !validRetries(job.retries) || !job.id || !job.kind || !Array.isArray(job.phases))
        throw new Error("invalid completed ETA job");
    const start = ms(job.startedAt), end = ms(job.completedAt);
    if (end < start || !uniqueNames(job.phases.map(phase => phase.name)))
        throw new Error("invalid completed ETA job");
    let previousEnd = start;
    for (const phase of job.phases) {
        const phaseStart = ms(phase.startedAt), phaseEnd = ms(phase.completedAt);
        if (!validRetries(phase.retries) || phaseStart < start || phaseEnd > end || phaseEnd < phaseStart || phaseStart < previousEnd)
            throw new Error("invalid completed ETA phase history");
        previousEnd = phaseEnd;
    }
    return { ...job, phases: job.phases.map(phase => ({ ...phase })) };
}
export function createEtaEstimatorState(options = {}) {
    const minimum = options.minimumSamples ?? DEFAULT_ETA_MINIMUM_SAMPLES;
    if (!Number.isInteger(minimum) || minimum < 2)
        throw new Error("ETA minimumSamples must be an integer of at least 2");
    return { schema_version: EXECUTION_ETA_SCHEMA, minimum_samples: minimum, completed_jobs: (options.completedJobs ?? []).map(checked), latest_estimates: {}, errors: [] };
}
function phaseSamples(jobs, name, concurrency, retryCount) {
    return jobs.flatMap(job => job.phases.filter(phase => phase.name === name).map(phase => ({ duration: ms(phase.completedAt) - ms(phase.startedAt), concurrency: job.concurrency, retries: retries(phase.retries ?? job.retries) })))
        .sort((a, b) => Math.abs(a.retries - retryCount) - Math.abs(b.retries - retryCount) || Math.abs(a.concurrency - concurrency) - Math.abs(b.concurrency - concurrency))
        .map(sample => sample.duration * sample.concurrency / concurrency * (1 + retryCount) / (1 + sample.retries));
}
/** Validates snapshot chronology before any duration is inferred. */
function validSnapshot(job, now, plan, current) {
    if (!job.id || !job.kind || !Array.isArray(job.phases) || !validConcurrency(job.concurrency) || !validRetries(job.retries) || !uniqueNames(plan) || !uniqueNames(job.phases.map(phase => phase.name)))
        return false;
    let jobStart;
    try {
        jobStart = ms(job.startedAt);
    }
    catch {
        return false;
    }
    if (jobStart > now)
        return false;
    if (job.updatedAt !== undefined) {
        try {
            const updated = ms(job.updatedAt);
            if (updated < jobStart || updated > now)
                return false;
        }
        catch {
            return false;
        }
    }
    if (job.phases.some(phase => !plan.includes(phase.name)) || (current !== undefined && !plan.includes(current)))
        return false;
    let previousPlanIndex = -1;
    for (const phase of job.phases) {
        const index = plan.indexOf(phase.name);
        if (index <= previousPlanIndex)
            return false;
        previousPlanIndex = index;
    }
    let previousRank = -1, previousEnd = jobStart, runningCount = 0;
    for (const phase of job.phases) {
        if (!validRetries(phase.retries) || !["pending", "running", "completed"].includes(phase.status))
            return false;
        const rank = phase.status === "completed" ? 0 : phase.status === "running" ? 1 : 2;
        if (rank < previousRank || (rank === 1 && ++runningCount > 1))
            return false;
        previousRank = rank;
        let started, completed;
        try {
            started = phase.startedAt === undefined ? undefined : ms(phase.startedAt);
            completed = phase.completedAt === undefined ? undefined : ms(phase.completedAt);
        }
        catch {
            return false;
        }
        if ((started !== undefined && (started < jobStart || started > now)) || (completed !== undefined && (completed < jobStart || completed > now)))
            return false;
        if (phase.status === "completed") {
            if (started === undefined || completed === undefined || completed < started || started < previousEnd)
                return false;
            previousEnd = completed;
        }
        else if (phase.status === "running") {
            if (started === undefined || completed !== undefined || started < previousEnd)
                return false;
        }
        else if (started !== undefined || completed !== undefined)
            return false;
    }
    const running = job.phases.find(phase => phase.status === "running");
    if (!job.terminal && (!current || !running || running.name !== current))
        return false;
    const currentRecord = current ? job.phases.find(phase => phase.name === current) : undefined;
    if (currentRecord?.status === "completed")
        return false;
    return true;
}
function invalidEstimate(state, job, now) {
    const comparable = state.completed_jobs.filter(candidate => candidate.kind === job.kind).length;
    const component = { status: "unavailable", reason: "invalid_input", sample_count: 0 };
    return { schema_version: EXECUTION_ETA_SCHEMA, timestamp: new Date(now).toISOString(), last_update: new Date(now).toISOString(), current_phase: { ...component, ...(typeof job.currentPhase === "string" ? { name: job.currentPhase } : {}) }, total: { ...component }, basis: { comparable_kind: typeof job.kind === "string" ? job.kind : "", comparable_jobs: comparable, minimum_samples: state.minimum_samples, current_concurrency: validConcurrency(job.concurrency) ? job.concurrency : 0, current_retries: validRetries(job.retries) ? retries(job.retries) : 0, method: "phase-history-concurrency-normalized", phase_samples: {} } };
}
export function estimateExecutionEta(state, job, timestamp) {
    const now = ms(timestamp);
    const plan = job.phasePlan ?? (Array.isArray(job.phases) ? job.phases.map(phase => phase.name) : []);
    const current = job.currentPhase ?? (Array.isArray(job.phases) ? job.phases.find(phase => phase.status === "running")?.name : undefined);
    if (!validSnapshot(job, now, plan, current))
        return invalidEstimate(state, job, now);
    const comparable = state.completed_jobs.filter(candidate => candidate.kind === job.kind);
    const record = current ? job.phases.find(phase => phase.name === current) : undefined;
    const counts = {}, sets = new Map();
    for (const name of plan) {
        const values = phaseSamples(comparable, name, job.concurrency, retries(record?.retries ?? job.retries));
        sets.set(name, values);
        counts[name] = values.length;
    }
    let currentPhase;
    if (job.terminal)
        currentPhase = { status: "unavailable", reason: "job_already_terminal", sample_count: 0, ...(current ? { name: current } : {}) };
    else if (!current || !record?.startedAt)
        currentPhase = { status: "unavailable", reason: "missing_phase_plan", sample_count: 0 };
    else {
        const values = sets.get(current) ?? [];
        const elapsed = now - ms(record.startedAt);
        currentPhase = values.length >= state.minimum_samples ? { name: current, status: "available", sample_count: values.length, range: range(values.map(value => value - elapsed), now) } : { name: current, ...absent(values.length, state.minimum_samples, "phase_not_observed") };
    }
    let total;
    if (job.terminal)
        total = { status: "unavailable", reason: "job_already_terminal", sample_count: 0 };
    else if (!current || !plan.includes(current))
        total = { status: "unavailable", reason: "missing_phase_plan", sample_count: 0 };
    else {
        const remaining = plan.slice(plan.indexOf(current)).map(name => sets.get(name) ?? []), count = remaining.length ? Math.min(...remaining.map(values => values.length)) : 0;
        if (count < state.minimum_samples)
            total = absent(count, state.minimum_samples, comparable.length ? "phase_not_observed" : "no_comparable_jobs");
        else {
            const elapsed = record?.startedAt ? now - ms(record.startedAt) : 0;
            total = { status: "available", sample_count: count, range: range(Array.from({ length: count }, (_, index) => remaining.reduce((sum, values, offset) => sum + Math.max(0, values[index] - (offset ? 0 : elapsed)), 0)), now) };
        }
    }
    return { schema_version: EXECUTION_ETA_SCHEMA, timestamp: new Date(now).toISOString(), last_update: new Date(job.updatedAt === undefined ? now : ms(job.updatedAt)).toISOString(), current_phase: currentPhase, total, basis: { comparable_kind: job.kind, comparable_jobs: comparable.length, minimum_samples: state.minimum_samples, current_concurrency: job.concurrency, current_retries: retries(job.retries), method: "phase-history-concurrency-normalized", phase_samples: counts } };
}
function measure(job, estimate) {
    const at = ms(estimate.timestamp), done = ms(job.completedAt);
    if (at > done || !estimate.total.range)
        return;
    const actual = done - at, predicted = estimate.total.range.remaining_ms.likely;
    const output = { job_id: job.id, estimated_at: estimate.timestamp, completed_at: new Date(done).toISOString(), total: { estimated_remaining_ms: predicted, actual_remaining_ms: actual, signed_error_ms: predicted - actual, absolute_error_ms: Math.abs(predicted - actual), ...(actual > 0 ? { absolute_percentage_error: Math.abs(predicted - actual) / actual } : {}), range_covered: actual >= estimate.total.range.remaining_ms.low && actual <= estimate.total.range.remaining_ms.high } };
    const name = estimate.current_phase.name, phase = name ? job.phases.find(candidate => candidate.name === name) : undefined, phaseRange = estimate.current_phase.range;
    if (phase && phaseRange && at <= ms(phase.completedAt)) {
        const phaseActual = ms(phase.completedAt) - at, phasePredicted = phaseRange.remaining_ms.likely;
        output.current_phase = { name: phase.name, estimated_remaining_ms: phasePredicted, actual_remaining_ms: phaseActual, signed_error_ms: phasePredicted - phaseActual, absolute_error_ms: Math.abs(phasePredicted - phaseActual), range_covered: phaseActual >= phaseRange.remaining_ms.low && phaseActual <= phaseRange.remaining_ms.high };
    }
    return output;
}
export function updateEtaEstimator(state, event) {
    const next = { ...state, completed_jobs: [...state.completed_jobs], latest_estimates: { ...state.latest_estimates }, errors: [...state.errors] };
    if (event.type === "snapshot") {
        const estimate = estimateExecutionEta(next, event.job, event.timestamp);
        next.latest_estimates[event.job.id] = estimate;
        return { state: next, estimate };
    }
    const job = checked(event.job);
    if (next.completed_jobs.some(candidate => candidate.id === job.id))
        throw new Error("completed ETA job id already exists");
    const error = next.latest_estimates[job.id] ? measure(job, next.latest_estimates[job.id]) : undefined;
    next.completed_jobs.push(job);
    delete next.latest_estimates[job.id];
    if (error)
        next.errors.push(error);
    return { state: next, ...(error ? { error } : {}) };
}
