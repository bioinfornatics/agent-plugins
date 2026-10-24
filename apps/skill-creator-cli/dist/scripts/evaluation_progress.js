import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, truncateSync, writeFileSync, writeSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
const LOCK_STALE_MS = 5 * 60_000, LOCK_WAIT_MS = 15_000, sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
function atomic(path, value) { mkdirSync(dirname(path), { recursive: true }); const tmp = path + `.tmp-${process.pid}-${randomUUID()}`; const fd = openSync(tmp, "wx", 0o600); try {
    writeSync(fd, value);
    fsyncSync(fd);
}
finally {
    closeSync(fd);
} renameSync(tmp, path); const dir = openSync(dirname(path), "r"); try {
    fsyncSync(dir);
}
finally {
    closeSync(dir);
} }
function percentile(values, p) { if (!values.length)
    return null; const sorted = [...values].sort((a, b) => a - b), index = Math.ceil(p * sorted.length) - 1; return sorted[Math.max(0, index)]; }
function processAlive(pid) { if (!Number.isInteger(pid) || pid <= 0)
    return false; try {
    process.kill(pid, 0);
    return true;
}
catch (error) {
    return error?.code === "EPERM";
} }
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function fresh(started, total) { return { sequence: 0, eventIds: new Set(), started, phase: null, total, active: new Set(), terminal: new Map(), durations: new Map(), cache: { hits: 0, misses: 0, invalidated: 0 }, retries: 0, final: false }; }
function idFor(event) { if (event.event_id)
    return event.event_id; if (event.run && event.type === "run-start")
    return `run-start:${event.run}`; if (event.run && event.type === "run-complete")
    return `run-complete:${event.run}:${event.status ?? "unknown"}`; if (event.type === "phase-transition")
    return "phase:" + (event.phase ?? "unknown") + ":" + (event.status ?? "unknown"); return hash(JSON.stringify(event) + ":" + randomUUID()); }
function apply(state, event) { if (state.final)
    return; if (event.phase !== undefined)
    state.phase = event.phase; if (typeof event.total === "number")
    state.total = Math.max(state.total, event.total); if (event.type === "run-start" && event.run && !state.terminal.has(event.run))
    state.active.add(event.run); if (event.type === "retry")
    state.retries++; if (event.cache)
    state.cache[event.cache === "hit" ? "hits" : event.cache === "miss" ? "misses" : "invalidated"]++; if (event.run && ["succeeded", "failed", "blocked", "cancelled"].includes(String(event.status))) {
    state.active.delete(event.run);
    if (!state.terminal.has(event.run)) {
        state.terminal.set(event.run, String(event.status));
        if (typeof event.duration_seconds === "number" && Number.isFinite(event.duration_seconds) && event.duration_seconds >= 0)
            state.durations.set(event.run, event.duration_seconds);
    }
} if (event.sequential !== undefined)
    state.sequential = event.sequential; if (event.type === "evaluation-complete")
    state.final = true; }
function makeSnapshot(state, event, id, now) { const elapsed = Math.max(0, (now - state.started) / 1000), completed = state.terminal.size, total = Math.max(state.total, completed), queued = Math.max(0, total - completed - state.active.size), values = [...state.terminal.values()], durations = [...state.durations.values()], p50 = percentile(durations, .5), p95 = percentile(durations, .95); let lower = null, upper = null, confidence = null, reason = null; if (total <= 0)
    reason = "total work is not known yet";
else if (completed >= total)
    lower = upper = 0, confidence = "high";
else if (durations.length < 2)
    reason = "at least two completed run durations are required";
else {
    const slots = Math.max(1, state.active.size), pending = total - completed;
    lower = Math.max(0, Math.round((p50 ?? 0) * pending / slots));
    upper = Math.max(lower, Math.round((p95 ?? 0) * pending / slots));
    confidence = durations.length >= 10 ? "high" : durations.length >= 5 ? "medium" : "low";
} return { schema_version: "1.1", status: state.final ? "complete" : String(event.status ?? "running"), provisional: !state.final, final_receipt: state.final, sequence: state.sequence, event_id: id, event: event.type, phase: state.phase, completed, total, active: state.active.size, queued, succeeded: values.filter(x => x === "succeeded").length, failed: values.filter(x => x === "failed" || x === "cancelled").length, blocked: values.filter(x => x === "blocked").length, cache: { ...state.cache }, retries: state.retries, elapsed_seconds: elapsed, throughput_per_second: elapsed > 0 ? completed / elapsed : null, duration_seconds: { p50, p95 }, eta: { lower_seconds: lower, upper_seconds: upper, confidence, unavailable_reason: reason }, updated_at: new Date(now).toISOString(), ...(state.sequential !== undefined ? { sequential: state.sequential } : {}) }; }
export class EvaluationProgress {
    options;
    started;
    mode;
    write;
    timer;
    pending;
    lastPublishedAt = -Infinity;
    lockPath;
    eventPath;
    snapshotPath;
    constructor(options) {
        this.options = options;
        this.started = options.now?.() ?? Date.now();
        this.mode = options.mode === "auto" || !options.mode ? (options.isTTY ? "terminal" : "jsonl") : options.mode;
        this.write = options.write ?? (text => process.stderr.write(text));
        this.lockPath = join(options.workspace, ".progress-write-lock");
        this.eventPath = join(options.workspace, "progress.jsonl");
        this.snapshotPath = join(options.workspace, "progress.json");
        mkdirSync(options.workspace, { recursive: true });
        if ((options.intervalMs ?? 0) > 0 && this.mode !== "none") {
            this.timer = setInterval(() => this.flush(), options.intervalMs);
            this.timer.unref();
        }
    }
    withLock(operation) { const deadline = Date.now() + LOCK_WAIT_MS, token = randomUUID(); while (true) {
        try {
            mkdirSync(this.lockPath, { mode: 0o700 });
            writeFileSync(join(this.lockPath, "owner.json"), JSON.stringify({ pid: process.pid, token }), { mode: 0o600 });
            break;
        }
        catch (error) {
            if (error?.code !== "EEXIST")
                throw error;
            let stale = false;
            try {
                const owner = JSON.parse(readFileSync(join(this.lockPath, "owner.json"), "utf8"));
                stale = Date.now() - statSync(this.lockPath).mtimeMs > LOCK_STALE_MS && !processAlive(owner.pid);
            }
            catch {
                try {
                    stale = Date.now() - statSync(this.lockPath).mtimeMs > LOCK_STALE_MS;
                }
                catch {
                    continue;
                }
            }
            if (stale) {
                const quarantine = this.lockPath + `.stale-${randomUUID()}`;
                try {
                    renameSync(this.lockPath, quarantine);
                    rmSync(quarantine, { recursive: true, force: true });
                    continue;
                }
                catch { }
            }
            if (Date.now() >= deadline)
                throw new Error("timed out waiting for progress lock");
            Atomics.wait(sleepBuffer, 0, 0, 5);
        }
    } try {
        return operation();
    }
    finally {
        try {
            const owner = JSON.parse(readFileSync(join(this.lockPath, "owner.json"), "utf8"));
            if (owner.token === token)
                rmSync(this.lockPath, { recursive: true, force: true });
        }
        catch { }
    } }
    replay() { const state = fresh(this.started, this.options.total ?? 0); if (!existsSync(this.eventPath))
        return state; const text = readFileSync(this.eventPath, "utf8"), complete = text.endsWith("\n") ? text.length : text.lastIndexOf("\n") + 1; if (complete !== text.length)
        truncateSync(this.eventPath, complete); for (const [index, line] of text.slice(0, complete).split("\n").entries()) {
        if (!line)
            continue;
        const record = JSON.parse(line);
        if (record.schema_version !== "1.1" || record.sequence !== state.sequence + 1)
            throw new Error(`non-monotonic progress event at line ${index + 1}`);
        if (state.eventIds.has(record.event_id))
            continue;
        state.sequence = record.sequence;
        state.eventIds.add(record.event_id);
        apply(state, record.source_event);
        state.last = record;
    } return state; }
    setTotal(total) { this.options.total = Math.max(this.options.total ?? 0, total); }
    emit(input) { return this.withLock(() => { const state = this.replay(), id = idFor(input); if (state.eventIds.has(id))
        return state.last; const event = { ...input, event_id: id, total: Math.max(input.total ?? 0, this.options.total ?? 0) }; const hadCompletion = state.terminal.size > 0, ignored = state.final; apply(state, event); state.sequence++; const value = makeSnapshot(state, event, id, this.options.now?.() ?? Date.now()); if (ignored)
        value.ignored_after_final = { event: event.type, event_id: id, reason: "terminal progress is immutable" }; const record = { ...value, source_event: event }; const fd = openSync(this.eventPath, "a", 0o600); try {
        writeSync(fd, JSON.stringify(record) + "\n");
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    } const urgent = event.type === "evaluation-complete" || event.status === "failed" || event.status === "blocked" || event.status === "cancelled" || (!hadCompletion && state.terminal.size > 0), interval = this.options.intervalMs ?? 0, now = this.options.now?.() ?? Date.now(); if (urgent || interval === 0 || now - this.lastPublishedAt >= interval)
        this.publish(value);
    else
        this.pending = value; return value; }); }
    publish(value) { if (this.pending && this.pending.sequence > value.sequence)
        value = this.pending; this.pending = undefined; atomic(this.snapshotPath, JSON.stringify(value, null, 2) + "\n"); this.lastPublishedAt = this.options.now?.() ?? Date.now(); if (this.mode === "jsonl")
        this.write(JSON.stringify(value) + "\n");
    else if (this.mode === "terminal")
        this.write(`[${value.phase ?? "evaluation"}] ${value.completed}/${value.total || "?"} complete · ${value.active} active · ${value.queued} queued · ${value.failed} failed · ${value.blocked} blocked · ${value.elapsed_seconds.toFixed(1)}s · ETA ${value.eta.unavailable_reason ?? `${value.eta.lower_seconds}-${value.eta.upper_seconds}s (${value.eta.confidence})`}\n`); this.options.onPublish?.(value); }
    flush() { if (!this.pending)
        return; this.withLock(() => { if (!this.pending)
        return; const state = this.replay(), latest = state.last; this.publish(latest && (state.final || latest.sequence > this.pending.sequence) ? latest : this.pending); }); }
    finalize(phase = "verify") { return this.emit({ type: "evaluation-complete", event_id: "evaluation-complete", phase, status: "succeeded" }); }
    snapshot(event = "snapshot") { const state = this.withLock(() => this.replay()), id = hash(event + ":" + state.sequence); return makeSnapshot(state, { type: event }, id, this.options.now?.() ?? Date.now()); }
    close() { this.flush(); if (this.timer)
        clearInterval(this.timer); this.timer = undefined; }
}
