const TERMINAL_EVENTS = new Set(["completion", "cancellation"]);
const DONE = new Set(["succeeded", "failed", "blocked", "cancelled", "skipped"]);
const ANSI = /[\u001b\u009b](?:(?:\][^\u0007]*(?:\u0007|\u001b\\))|(?:\[[0-?]*[ -/]*[@-~])|(?:[PX^_][^\u001b]*(?:\u001b\\))|(?:[@-_]))/g;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function artifact(value) { return object(value) && value.kind === "protected-artifact-ref" && typeof value.ref === "string"; }
function artifactUri(value) { return "artifact://" + value.ref.replace(/^sha256:/, ""); }
function escapeHtml(value) { return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
/** Shared untrusted-text boundary for every human-facing projection. */
export function sanitizeDisplayText(value, surface) {
    let text = String(value ?? "").replace(ANSI, "").replace(/\r\n?|\n/g, " ").replace(CONTROL, "").replace(/\s+/g, " ").trim();
    if (surface === "ci")
        text = text.replace(/%/g, "%25").replace(/:/g, "%3A");
    return surface === "html" ? escapeHtml(text) : text;
}
function safe(value, surface = "terminal") { return sanitizeDisplayText(value, surface) || "unknown"; }
function finiteNonnegative(value, fallback) { return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : fallback; }
function progressBudget(data, prior) { const raw = object(data.budget) ? data.budget : null; if (!raw)
    return prior; const consumed = finiteNonnegative(raw.consumed_ms, prior.consumed_ms), total = finiteNonnegative(raw.total_ms, prior.total_ms), derived = Math.max(0, total - consumed), remaining = Math.min(total, finiteNonnegative(raw.remaining_ms ?? derived, derived)); return { consumed_ms: consumed, total_ms: total, remaining_ms: remaining, percent: total ? Math.min(100, Math.max(0, Math.round(consumed / total * 100))) : 0 }; }
function emptyCounts() { return { total: 0, planned: 0, running: 0, succeeded: 0, failed: 0, blocked: 0, cancelled: 0, skipped: 0, completed: 0 }; }
function eventState(event, state) { const status = String(event.data.status ?? ""); if (event.event_type === "completion")
    return "completed"; if (event.event_type === "cancellation")
    return "cancelled"; if (event.event_type === "failure" && event.job_id === null)
    return "failed"; if (event.event_type === "heartbeat" || event.event_type === "checkpoint") {
    if (status === "success")
        return "completed";
    if (status === "failure" || status === "failed")
        return "failed";
    if (status === "cancelled")
        return "cancelled";
    if (status === "blocked")
        return "blocked";
    if (status === "running")
        return "running";
} if ((event.event_type === "job-transition" || event.event_type === "phase-transition") && status === "running")
    return "running"; return state; }
/** Pure canonical projection. It never reads checkpoints, clocks, environment, or the terminal. */
export function projectExecutionProgress(events) { const statuses = new Map(); let phaseName = null, phaseState = null, state = "planned", budget = { consumed_ms: 0, total_ms: 0, remaining_ms: 0, percent: 0 }, retry = { attempts: 0, retries: 0, max_attempts: 0 }, elapsed_ms = 0, active_workers = [], active_models = [], checkpoint = { revision: 0, timestamp: null }, stale = { status: "unavailable", age_ms: 0, threshold_ms: 0 }, eta = null; const failures = [], artifacts = []; let declaredTotal = 0; for (const event of events) {
    state = eventState(event, state);
    budget = progressBudget(event.data, budget);
    if (event.event_type === "heartbeat") {
        const d = event.data;
        if (object(d.retry))
            retry = d.retry;
        if (typeof d.elapsed_ms === "number")
            elapsed_ms = d.elapsed_ms;
        if (Array.isArray(d.active_workers))
            active_workers = d.active_workers;
        if (Array.isArray(d.active_models))
            active_models = d.active_models.filter(x => typeof x === "string");
        if (object(d.checkpoint))
            checkpoint = d.checkpoint;
        if (object(d.stale))
            stale = d.stale;
        if (object(d.eta))
            eta = d.eta;
    }
    if (event.event_type === "checkpoint") {
        checkpoint = { revision: Number(event.data.revision), timestamp: event.timestamp };
        elapsed_ms = Math.max(elapsed_ms, budget.consumed_ms);
    }
    if (Number.isInteger(event.data.job_count))
        declaredTotal = Math.max(declaredTotal, Number(event.data.job_count));
    const phase = typeof event.data.phase === "string" ? event.data.phase : null, status = typeof event.data.status === "string" ? event.data.status : null;
    if (event.event_type === "phase-transition" && phase) {
        phaseName = phase;
        phaseState = status;
    }
    if (event.event_type === "job-transition" && event.job_id && status)
        statuses.set(event.job_id, status);
    if (event.event_type === "checkpoint" && Array.isArray(event.data.jobs))
        for (const raw of event.data.jobs) {
            if (object(raw) && typeof raw.id === "string" && typeof raw.status === "string")
                statuses.set(raw.id, raw.status);
        }
    if (event.event_type === "failure" && (event.job_id !== null || phase !== null))
        failures.push({ job_id: event.job_id, phase });
    for (const value of Object.values(event.data)) {
        if (artifact(value))
            artifacts.push(value);
        else if (Array.isArray(value))
            for (const item of value)
                if (artifact(item))
                    artifacts.push(item);
    }
} const counts = emptyCounts(); counts.total = Math.max(declaredTotal, statuses.size); for (const status of statuses.values())
    if (status in counts)
        counts[status]++; counts.planned += Math.max(0, counts.total - statuses.size); counts.completed = [...statuses.values()].filter(x => DONE.has(x)).length; const last = events.at(-1) ?? null, lifecycle = last && TERMINAL_EVENTS.has(last.event_type) || ["completed", "cancelled", "failed"].includes(state) ? "completed" : "live", resumable = state === "blocked" || state === "cancelled" || state === "failed"; if (lifecycle === "completed") {
    active_workers = [];
    active_models = [];
} return { schema_version: "1.0", run_id: last?.run_id ?? null, sequence: last?.sequence ?? 0, timestamp: last?.timestamp ?? null, lifecycle, state, phase: { name: phaseName, state: phaseState }, counts, budget, retry, elapsed_ms, active_workers, active_models, checkpoint, stale, eta, failures, artifacts: [...new Map(artifacts.map(x => [x.ref, x])).values()], resume: { available: resumable, guidance: resumable ? "Resolve the reported condition, then run plugin-creator full-eval with --resume." : null } }; }
function summary(s, surface = "terminal") { const eta = !s.eta ? "unavailable" : s.eta.total.status === "available" ? `${s.eta.total.range.remaining_ms.low}-${s.eta.total.range.remaining_ms.high}ms/${s.eta.total.range.confidence}` : `${s.eta.total.status}:${s.eta.total.reason}`; return `state=${s.state} lifecycle=${s.lifecycle} phase=${safe(s.phase.name ?? "none", surface)} phase_state=${safe(s.phase.state ?? "none", surface)} jobs=${s.counts.completed}/${s.counts.total} running=${s.counts.running} blocked=${s.counts.blocked} failed=${s.counts.failed} retries=${s.retry.retries} elapsed=${s.elapsed_ms}ms workers=${s.active_workers.length} models=${s.active_models.length} checkpoint=${s.checkpoint.revision} stale=${s.stale.status} eta=${eta} budget=${s.budget.consumed_ms}/${s.budget.total_ms}ms (${s.budget.percent}%)`; }
export function renderTerminalProgress(events, verbosity = "normal") { const snapshot = projectExecutionProgress(events); if (verbosity === "quiet")
    return { snapshot, output: "" }; const lines = [`full-eval progress: ${summary(snapshot)}`]; if (snapshot.failures.length)
    lines.push(...snapshot.failures.map(x => `failure: phase=${safe(x.phase ?? "unknown")} job=${safe(x.job_id ?? "run")}`)); if (snapshot.resume.guidance)
    lines.push("resume: " + safe(snapshot.resume.guidance)); if (verbosity === "verbose")
    for (const event of events)
        lines.push(`event ${event.sequence}: ${safe(event.event_type)} job=${safe(event.job_id ?? "run")}`); return { snapshot, output: lines.join("\n") }; }
/** Every non-empty line is JSON. Consumers never need to filter human prose. */
export function renderMachineJsonl(events) { let snapshot = projectExecutionProgress([]); const lines = []; for (let i = 0; i < events.length; i++) {
    snapshot = projectExecutionProgress(events.slice(0, i + 1));
    lines.push(JSON.stringify({ kind: "full-eval-progress", ...snapshot }));
} if (!lines.length)
    lines.push(JSON.stringify({ kind: "full-eval-progress", ...snapshot })); return { snapshot, output: lines.join("\n") + "\n" }; }
/** Workflow command markers are static; every dynamic value is command-neutralized. */
export function renderCiProgress(events) { const snapshot = projectExecutionProgress(events), lines = ["::group::full-eval progress", summary(snapshot, "ci"), "::endgroup::"]; if (snapshot.failures.length)
    lines.push("::group::full-eval failures", ...snapshot.failures.map(x => `failure: phase=${safe(x.phase ?? "unknown", "ci")} job=${safe(x.job_id ?? "run", "ci")}`), "::endgroup::"); if (snapshot.artifacts.length)
    lines.push("::group::full-eval artifacts", ...snapshot.artifacts.map(x => artifactUri(x)), "::endgroup::"); if (snapshot.resume.guidance)
    lines.push("::group::full-eval resume", safe(snapshot.resume.guidance, "ci"), "::endgroup::"); return { snapshot, output: lines.join("\n") }; }
/** Historical replay model plus an accessible, script-free review fragment. */
export function renderHistoricalReview(events) { const snapshots = events.map((_event, index) => projectExecutionProgress(events.slice(0, index + 1))), snapshot = snapshots.at(-1) ?? projectExecutionProgress([]), rows = snapshots.map(s => `<li><time datetime="${sanitizeDisplayText(s.timestamp ?? "", "html")}">${sanitizeDisplayText(s.timestamp ?? "", "html")}</time> <strong>${s.lifecycle}: ${s.state}</strong> — phase ${sanitizeDisplayText(s.phase.name ?? "none", "html")}; jobs ${s.counts.completed}/${s.counts.total}; budget ${s.budget.consumed_ms}/${s.budget.total_ms} ms</li>`).join(""), output = `<section aria-labelledby="full-eval-progress-title" data-lifecycle="${snapshot.lifecycle}"><h2 id="full-eval-progress-title">Full evaluation history (${snapshot.lifecycle})</h2><p aria-live="off">${summary(snapshot, "html")}</p><ol>${rows}</ol></section>`; return { snapshot, output }; }
export const projectProgress = projectExecutionProgress;
export const renderProgressJsonl = renderMachineJsonl;
export const renderProgressCi = renderCiProgress;
export const renderProgressReview = renderHistoricalReview;
