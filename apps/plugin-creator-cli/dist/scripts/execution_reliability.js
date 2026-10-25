import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, truncateSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname, basename } from "node:path";
export const DEFAULT_EXECUTION_RELIABILITY_PLAN = { lease_ms: 30_000, heartbeat_ms: 5_000, stale_after_ms: 45_000, max_attempts: 3, backoff_ms: 25, max_backoff_ms: 250, cancellation_grace_ms: 250, total_budget_ms: 120_000 };
export function newReliabilityLedger(now = Date.now()) { return { started_at: new Date(now).toISOString(), consumed_ms: 0, attempts: 0 }; }
export function normalizePlan(plan = {}) { const p = { ...DEFAULT_EXECUTION_RELIABILITY_PLAN, ...plan }; for (const [key, value] of Object.entries(p))
    if (!Number.isFinite(value) || value < 0)
        throw new Error("invalid execution reliability plan: " + key); if (p.max_attempts < 1 || p.heartbeat_ms < 1 || p.heartbeat_ms > p.stale_after_ms || p.lease_ms > p.stale_after_ms)
    throw new Error("invalid execution reliability plan thresholds"); return p; }
export function beginAttempt(records, now = Date.now()) { const prior = records ?? []; return [...prior, { attempt_id: randomUUID(), number: prior.length + 1, started_at: new Date(now).toISOString(), status: "running" }]; }
export function finishAttempt(records, status, options = {}) { if (!records.length || records.at(-1).status !== "running")
    throw new Error("no running execution attempt"); const now = options.now ?? Date.now(), last = records.at(-1); return [...records.slice(0, -1), { ...last, status, retryable: options.retryable, stop_reason: options.stop_reason, completed_at: new Date(now).toISOString(), elapsed_ms: Math.max(0, now - Date.parse(last.started_at)) }]; }
export function retryBackoffMs(attempt, plan) { return Math.min(plan.max_backoff_ms, plan.backoff_ms * Math.max(1, 2 ** Math.max(0, attempt - 1))); }
export function elapsedBudgetMs(ledger, now = Date.now()) { return Math.max(ledger.consumed_ms, Math.max(0, now - Date.parse(ledger.started_at))); }
export function remainingBudgetMs(ledger, plan, now = Date.now()) { return Math.max(0, plan.total_budget_ms - elapsedBudgetMs(ledger, now)); }
export function mayRetry(input, plan) { if (!input.retryable)
    return { retry: false, reason: "nonretryable", backoff_ms: 0 }; if (input.attempts >= plan.max_attempts)
    return { retry: false, reason: "retry-limit-exhausted", backoff_ms: 0 }; const backoff = retryBackoffMs(input.attempts, plan), remaining = input.remaining_ms ?? plan.total_budget_ms - input.consumed_ms; if (remaining <= backoff)
    return { retry: false, reason: "total-budget-exhausted", backoff_ms: 0 }; return { retry: true, backoff_ms: backoff }; }
export function chargeBudget(ledger, _elapsedMs, plan, now = Date.now()) { const consumed_ms = elapsedBudgetMs(ledger, now); return { ...ledger, consumed_ms, attempts: ledger.attempts + 1, ...(consumed_ms >= plan.total_budget_ms ? { stop_reason: "total-budget-exhausted" } : {}) }; }
export const sleep = (ms) => { if (ms > 0)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
export function processAlive(pid) { try {
    process.kill(pid, 0);
    if (process.platform === "linux") {
        try {
            const stat = readFileSync("/proc/" + pid + "/stat", "utf8"), state = stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3);
            if (state === "Z")
                return false;
        }
        catch { }
    }
    return true;
}
catch (error) {
    return error?.code === "EPERM";
} }
export function readLease(path) { try {
    const v = JSON.parse(readFileSync(path, "utf8"));
    return v?.schema_version === "1.1" && typeof v.owner === "string" && Number.isInteger(v.generation) && typeof v.fencing_token === "string" && Number.isInteger(v.pid) && Number.isInteger(v.process_group_id) && typeof v.heartbeat_at === "string" && typeof v.expires_at === "string" ? v : null;
}
catch {
    return null;
} }
function replaceJson(path, value) { const tmp = path + ".tmp-" + process.pid + "-" + randomUUID(); writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 }); renameSync(tmp, path); }
function readMutex(path) { try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value?.schema_version === "1.0" && typeof value.owner === "string" && Number.isInteger(value.pid) ? value : null;
}
catch {
    return null;
} }
function removeOwnedMutex(path, owner) { if (readMutex(path)?.owner !== owner)
    return; try {
    unlinkSync(path);
}
catch (error) {
    if (error?.code !== "ENOENT")
        throw error;
} }
function createMutex(path, record) { const candidate = path + ".candidate-" + record.owner; try {
    writeFileSync(candidate, JSON.stringify(record), { flag: "wx", mode: 0o600 });
    try {
        linkSync(candidate, path);
        return true;
    }
    catch (error) {
        if (error?.code !== "EEXIST")
            throw error;
        return false;
    }
}
finally {
    try {
        unlinkSync(candidate);
    }
    catch (error) {
        if (error?.code !== "ENOENT")
            throw error;
    }
} }
function sameFile(left, right) { try {
    const a = statSync(left), b = statSync(right);
    return a.dev === b.dev && a.ino === b.ino;
}
catch {
    return false;
} }
function reapDeadMutex(path) { const reap = path + ".reap", owner = randomUUID(), record = { schema_version: "1.0", owner, pid: process.pid }; if (!createMutex(reap, record))
    return; try {
    const current = readMutex(path);
    if (current && !processAlive(current.pid))
        try {
            unlinkSync(path);
        }
        catch (error) {
            if (error?.code !== "ENOENT")
                throw error;
        }
}
finally {
    removeOwnedMutex(reap, owner);
} }
function withMutex(path, fn, recover) { mkdirSync(dirname(path), { recursive: true }); const owner = randomUUID(), record = { schema_version: "1.0", owner, pid: process.pid }; for (let i = 0; i < 400; i++) {
    if (createMutex(path, record)) {
        try {
            return fn();
        }
        finally {
            removeOwnedMutex(path, owner);
        }
    }
    const current = readMutex(path);
    if (current) {
        recover?.(current);
        if (!processAlive(current.pid))
            reapDeadMutex(path);
    }
    sleep(5);
} throw new Error("timed out acquiring execution fence mutex"); }
function fenceGeneration(path) { try {
    const x = JSON.parse(readFileSync(path, "utf8"));
    return Number.isInteger(x.generation) ? x.generation : 0;
}
catch {
    return 0;
} }
function ownProcessGroup() { return process.platform === "win32" ? process.pid : process.pid; }
export function leaseIsStale(lease, plan, now = Date.now()) { return now >= Date.parse(lease.expires_at) || now - Date.parse(lease.heartbeat_at) >= plan.stale_after_ms || !processAlive(lease.pid); }
export class ExecutionLease {
    path;
    owner;
    generation;
    fencingToken;
    plan;
    timer = null;
    constructor(path, owner, generation, fencingToken, plan) {
        this.path = path;
        this.owner = owner;
        this.generation = generation;
        this.fencingToken = fencingToken;
        this.plan = plan;
    }
    static acquire(path, plan = DEFAULT_EXECUTION_RELIABILITY_PLAN, now = Date.now()) { const p = normalizePlan(plan), owner = randomUUID(), token = randomUUID(), mutex = path + ".mutex", fence = path + ".fence"; mkdirSync(dirname(path), { recursive: true }); for (let n = 0; n < 100; n++) {
        let won = null, busy = false, stalePid;
        withMutex(mutex, () => { const current = readLease(path); if (current && !leaseIsStale(current, p, now)) {
            busy = true;
            return;
        } if (current && processAlive(current.pid) && current.pid !== process.pid)
            stalePid = current.pid; const generation = Math.max(fenceGeneration(fence), current?.generation ?? 0) + 1; replaceJson(fence, { schema_version: "1.0", generation, fencing_token: token, updated_at: new Date(now).toISOString() }); replaceJson(path, { schema_version: "1.1", owner, generation, fencing_token: token, pid: process.pid, process_group_id: ownProcessGroup(), acquired_at: new Date(now).toISOString(), heartbeat_at: new Date(now).toISOString(), expires_at: new Date(now + p.lease_ms).toISOString() }); won = new ExecutionLease(path, owner, generation, token, p); }, lock => { const current = readLease(path); if (current?.pid === lock.pid && leaseIsStale(current, p, Date.now()) && lock.pid !== process.pid)
            forceTerminate(lock.pid, p.cancellation_grace_ms); });
        if (won) {
            if (stalePid)
                forceTerminate(stalePid, p.cancellation_grace_ms);
            return won;
        }
        if (!busy)
            continue;
        sleep(Math.min(25, p.heartbeat_ms));
        now = Date.now();
    } throw new Error("full-eval workspace is leased by another active run"); }
    assertCurrentUnlocked() { const current = readLease(this.path), fence = this.path + ".fence"; if (!current || current.owner !== this.owner || current.generation !== this.generation || current.fencing_token !== this.fencingToken || fenceGeneration(fence) !== this.generation)
        throw new Error("full-eval execution lease was fenced"); return current; }
    heartbeat(now = Date.now()) { withMutex(this.path + ".mutex", () => { const current = this.assertCurrentUnlocked(); replaceJson(this.path, { ...current, heartbeat_at: new Date(now).toISOString(), expires_at: new Date(now + this.plan.lease_ms).toISOString() }); }); }
    checkpoint(fn) { withMutex(this.path + ".mutex", () => { this.assertCurrentUnlocked(); fn(); }); }
    startHeartbeat(onError) { if (this.timer)
        return; this.timer = setInterval(() => { try {
        this.heartbeat();
    }
    catch (error) {
        if (onError)
            onError(error);
        else
            queueMicrotask(() => { throw error; });
    } }, this.plan.heartbeat_ms); this.timer.unref(); }
    release() { if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
    } withMutex(this.path + ".mutex", () => { const current = readLease(this.path); if (current?.owner === this.owner && current.generation === this.generation)
        rmSync(this.path, { force: true }); }); }
}
export function requestCancellation(path, lease, now = Date.now()) { const request = { schema_version: "1.0", requested_at: new Date(now).toISOString(), requester_pid: process.pid, ...(lease ? { target_owner: lease.owner, target_pid: lease.pid } : {}) }; mkdirSync(dirname(path), { recursive: true }); replaceJson(path, request); return request; }
export function readCancellation(path) { try {
    const x = JSON.parse(readFileSync(path, "utf8"));
    return x?.schema_version === "1.0" && typeof x.requested_at === "string" ? x : null;
}
catch {
    return null;
} }
export function clearCancellation(path) { rmSync(path, { force: true }); }
function linuxDescendants(root) { if (process.platform !== "linux")
    return [root]; const rows = new Map(); for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name))
        continue;
    try {
        const text = readFileSync("/proc/" + name + "/stat", "utf8"), tail = text.slice(text.lastIndexOf(")") + 2).split(" ");
        rows.set(Number(name), { ppid: Number(tail[1]), pgrp: Number(tail[2]) });
    }
    catch { }
} const found = new Set([root]); let changed = true; while (changed) {
    changed = false;
    for (const [pid, row] of rows)
        if (found.has(row.ppid) && !found.has(pid)) {
            found.add(pid);
            changed = true;
        }
} return [...found]; }
export function forceTerminate(pid, graceMs) { const initial = linuxDescendants(pid).filter(processAlive); if (!initial.length)
    return { outcome: "already-exited", signals: [], survivors: [] }; const signals = [], send = (signal, targets) => { const live = targets.filter(processAlive); if (!live.length)
    return; signals.push({ signal, targets: [...live], at: new Date().toISOString() }); for (const target of [...live].reverse())
    try {
        process.kill(target, signal);
    }
    catch { } }; send("SIGTERM", initial); let deadline = Date.now() + Math.max(0, graceMs); while (initial.some(processAlive) && Date.now() < deadline)
    sleep(10); let survivors = initial.filter(processAlive); if (survivors.length) {
    send("SIGKILL", survivors);
    deadline = Date.now() + Math.max(250, graceMs);
    while (survivors.some(processAlive) && Date.now() < deadline)
        sleep(10);
    survivors = survivors.filter(processAlive);
} return { outcome: survivors.length ? "survivors" : signals.some(x => x.signal === "SIGKILL") ? "killed" : "terminated", signals, survivors }; }
export function environmentFaultInjector(point) { const fault = process.env.PLUGIN_CREATOR_FAULT_INJECTION; if (fault === point)
    throw new Error("injected execution fault: " + point); if (fault === "process-crash:" + point)
    process.kill(process.pid, "SIGKILL"); }
export function atomicCheckpoint(path, value, inject = environmentFaultInjector) { mkdirSync(dirname(path), { recursive: true }); const tmp = path + ".tmp-" + process.pid + "-" + randomUUID(), bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n"); inject("checkpoint-before-write", path); const fd = openSync(tmp, "wx", 0o600); try {
    const split = Math.max(1, Math.floor(bytes.length / 2));
    writeSync(fd, bytes.subarray(0, split));
    fsyncSync(fd);
    inject("checkpoint-partial-write", path);
    writeSync(fd, bytes.subarray(split));
    fsyncSync(fd);
}
finally {
    closeSync(fd);
} try {
    inject("checkpoint-before-rename", path);
    renameSync(tmp, path);
    inject("checkpoint-after-rename", path);
}
finally {
    rmSync(tmp, { force: true });
} }
export function cleanupCheckpointPartials(path) { const prefix = basename(path) + ".tmp-", dir = dirname(path); if (!existsSync(dir))
    return; for (const name of readdirSync(dir))
    if (name.startsWith(prefix))
        rmSync(dir + "/" + name, { force: true }); }
export function repairInterruptedJsonl(path) { if (!existsSync(path))
    return false; const data = readFileSync(path); if (!data.length || data.at(-1) === 10)
    return false; const newline = data.lastIndexOf(10); truncateSync(path, newline < 0 ? 0 : newline + 1); return true; }
export function cancellationDecision(requestedAt, now, graceMs, cooperativeComplete) { if (cooperativeComplete)
    return "cooperative"; return now - requestedAt >= graceMs ? "forced" : "wait"; }
