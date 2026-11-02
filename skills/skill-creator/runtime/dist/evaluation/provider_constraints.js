import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { PairedExecutionError } from "./runners/paired.js";
const ACTIVE_LEASE_DEFAULT_MS = 600_000;
export const MAX_ACTIVE_LEASE_MS = 86_400_000;
const LOCK_STALE_MS = 5 * 60_000;
const LOCK_WAIT_MS = 15_000;
const currentHost = hostname();
const zero = () => ({ costUsd: 0, tokens: 0, providerSeconds: 0 });
const initial = (key) => ({ measured: zero(), reserved: zero(), unavailable: zero(), attempts: 0, retries: 0, delayedMs: 0, policy: "retain-reservation", key, starts: [], cooldownUntil: 0, active: {} });
const finite = (value, name, integer = false) => { if (value === undefined)
    return undefined; const n = Number(value); if (!Number.isFinite(n) || n < 0 || (integer && !Number.isInteger(n)))
    throw new TypeError(name + " must be a non-negative " + (integer ? "integer" : "number")); return n; };
function processStart(pid) { try {
    const text = readFileSync(`/proc/${pid}/stat`, "utf8"), end = text.lastIndexOf(")");
    if (end < 0)
        return null;
    return text.slice(end + 1).trim().split(/\s+/)[19] ?? null;
}
catch {
    return null;
} }
const selfOwner = () => ({ pid: process.pid, host: currentHost, processStart: processStart(process.pid) });
function processAlive(owner) { if (owner.host !== currentHost)
    return null; if (!Number.isInteger(owner.pid) || Number(owner.pid) <= 0)
    return false; try {
    process.kill(Number(owner.pid), 0);
}
catch (error) {
    if (error?.code === "ESRCH")
        return false;
    if (error?.code !== "EPERM")
        return null;
} const actual = processStart(Number(owner.pid)); if (owner.processStart && actual && owner.processStart !== actual)
    return false; return true; }
function validActive(value) { const x = value; return Boolean(x && typeof x === "object" && typeof x.token === "string" && x.token && Number.isInteger(x.pid) && x.pid > 0 && typeof x.host === "string" && Number.isFinite(x.expiresAt) && Number.isFinite(x.updatedAt)); }
export function validateProviderConstraints(value = {}) {
    const config = { ...value, concurrency: value.concurrency ?? 1, maxAttempts: value.maxAttempts ?? 3, baseBackoffMs: value.baseBackoffMs ?? 250, maxBackoffMs: value.maxBackoffMs ?? 30000 };
    finite(config.concurrency, "provider concurrency", true);
    finite(config.requestsPerMinute, "provider requests per minute");
    finite(config.maxAttempts, "provider retry attempts", true);
    finite(config.baseBackoffMs, "provider retry base milliseconds");
    finite(config.maxBackoffMs, "provider retry maximum milliseconds");
    finite(config.maxCostUsd, "cost budget");
    finite(config.maxTokens, "token budget", true);
    finite(config.maxProviderSeconds, "provider time budget");
    finite(config.reserveCostUsd, "cost reservation");
    finite(config.reserveTokens, "token reservation", true);
    finite(config.reserveProviderSeconds, "provider time reservation");
    finite(config.activeLeaseMs, "provider active lease milliseconds", true);
    if (config.concurrency < 1)
        throw new TypeError("provider concurrency must be positive");
    if (config.maxAttempts < 1)
        throw new TypeError("provider retry attempts must be positive");
    if (config.maxBackoffMs < config.baseBackoffMs)
        throw new TypeError("provider retry maximum must be at least the base delay");
    if (config.requestsPerMinute !== undefined && config.requestsPerMinute <= 0)
        throw new TypeError("provider requests per minute must be positive");
    if (config.activeLeaseMs !== undefined && (config.activeLeaseMs < 1 || config.activeLeaseMs > MAX_ACTIVE_LEASE_MS))
        throw new TypeError(`provider active lease milliseconds must be between 1 and ${MAX_ACTIVE_LEASE_MS}`);
    if (config.unknownUsagePolicy !== undefined && config.unknownUsagePolicy !== "retain-reservation")
        throw new TypeError("unknown usage policy must be retain-reservation");
    return config;
}
const defaultClock = { now: () => Date.now(), random: () => Math.random(), sleep: (ms, signal) => new Promise((resolve, reject) => { let settled = false; const done = () => { if (settled)
        return; settled = true; signal?.removeEventListener("abort", abort); clearTimeout(timer); resolve(); }, abort = () => { if (settled)
        return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new PairedExecutionError("cancelled", "Provider wait cancelled", "cancelled")); }, timer = setTimeout(done, ms); signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted)
        abort(); }) };
export function parseRetryAfter(value, now) { if (typeof value === "number")
    return Number.isFinite(value) && value >= 0 ? value * 1000 : null; if (typeof value !== "string" || value.trim() !== value || !value)
    return null; if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
} const date = Date.parse(value); if (!Number.isFinite(date))
    return null; const delta = date - now; return delta >= 0 ? delta : null; }
function retryAfterMs(error, now, trustedAdapter) { const direct = error.retryAfterMs ?? (trustedAdapter ? error.provider?.retryAfterMs : undefined); if (direct !== undefined && direct !== null)
    return Number.isFinite(direct) && Number(direct) >= 0 ? Number(direct) : null; return parseRetryAfter(error.retryAfter, now); }
export function classifyProviderError(error, now = Date.now()) {
    const item = error, trustedAdapter = error instanceof PairedExecutionError;
    const outerStatus = Number(item?.status ?? item?.statusCode), adapterStatus = trustedAdapter ? Number(item.provider?.status) : Number.NaN, status = Number.isFinite(outerStatus) ? outerStatus : Number.isFinite(adapterStatus) ? adapterStatus : null;
    const outerCode = String(item?.code ?? "").toLowerCase(), closedTransient = trustedAdapter && (item.exitReason === "provider-transient" || item.code === "provider-limited"), closedPermanent = trustedAdapter && (item.exitReason === "provider-permanent" || item.code === "provider-permanent" || item.code === "model-rejected" || item.code === "tool-rejected");
    const transientStatus = status === 408 || status === 409 || status === 425 || status === 429 || (status !== null && status >= 500 && status <= 599), permanentHttp = status !== null && status >= 400 && status <= 499 && !transientStatus;
    const transient = !permanentHttp && !closedPermanent && (transientStatus || closedTransient || ["etimedout", "econnreset", "econnrefused", "eai_again", "enetwork"].includes(outerCode));
    return { classification: transient ? "transient" : "permanent", status, code: outerCode || (trustedAdapter ? item.provider?.code ?? null : null), retryAfterMs: retryAfterMs(item, now, trustedAdapter), retryOwner: "provider-scheduler" };
}
function cleanUsage(value) { const metric = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null; return { costUsd: metric(value?.costUsd), tokens: metric(value?.tokens), providerSeconds: metric(value?.providerSeconds) }; }
function telemetryUsage(value, fallbackSeconds = null) { const usage = value?.usage && typeof value.usage === "object" ? value.usage : {}; return cleanUsage({ tokens: value?.telemetry?.total_tokens?.value ?? value?.tokens ?? usage.total_tokens ?? usage.totalTokens ?? usage.tokens, costUsd: value?.telemetry?.cost?.currency === "USD" ? value.telemetry.cost.value : value?.costUsd ?? usage.cost_usd ?? usage.costUsd, providerSeconds: value?.telemetry?.total_duration_seconds?.value ?? value?.durationSeconds ?? usage.provider_seconds ?? usage.providerSeconds ?? fallbackSeconds }); }
function budgetError(kind) { return new PairedExecutionError("budget-exhausted", "Provider " + kind + " safety budget is exhausted", "budget-exhausted", null, undefined, { classification: "permanent", status: null, code: "budget-exhausted", retryAfterMs: null, retryOwner: "provider-scheduler", resumable: true }); }
function leaseLostError() { return new PairedExecutionError("provider-limited", "Provider admission lease ownership was lost", "provider-limited", null, undefined, { classification: "permanent", status: null, code: "lease-lost", retryAfterMs: null, retryOwner: "provider-scheduler", resumable: true }); }
class DurableState {
    path;
    key;
    clock;
    memory;
    constructor(path, key, clock) {
        this.path = path;
        this.key = key;
        this.clock = clock;
        this.memory = initial(key);
    }
    read() { if (!this.path || !existsSync(this.path))
        return {}; let v; try {
        v = JSON.parse(readFileSync(this.path, "utf8"));
    }
    catch {
        throw new PairedExecutionError("budget-exhausted", "Provider accounting state is malformed; refusing to reset budgets", "budget-exhausted");
    } if (!v || v.schema_version !== 1 || !v.providers || typeof v.providers !== "object")
        throw new PairedExecutionError("budget-exhausted", "Provider accounting state has an unsupported shape", "budget-exhausted"); return v.providers; }
    write(all) { if (!this.path)
        return; mkdirSync(dirname(this.path), { recursive: true }); const temp = this.path + ".tmp-" + process.pid + "-" + randomUUID(); writeFileSync(temp, JSON.stringify({ schema_version: 1, providers: all }, null, 2) + "\n", { mode: 0o600 }); renameSync(temp, this.path); }
    lockOwner(path) { let age = 0; try {
        age = Date.now() - statSync(path).mtimeMs;
    }
    catch {
        return { owner: null, age: 0 };
    } try {
        const raw = readFileSync(join(path, "owner.json"), "utf8"), value = JSON.parse(raw);
        if (value && typeof value === "object" && typeof value.token === "string" && Number.isInteger(value.pid) && typeof value.host === "string")
            return { owner: value, age };
    }
    catch {
        try {
            const raw = readFileSync(path, "utf8").trim(), pid = Number(raw);
            if (Number.isInteger(pid) && pid > 0)
                return { owner: { pid, host: currentHost, processStart: null }, age };
        }
        catch { }
    } return { owner: null, age }; }
    staleLock(path) { const { owner, age } = this.lockOwner(path); if (age <= LOCK_STALE_MS)
        return false; if (!owner)
        return true; return processAlive(owner) === false; }
    async transaction(fn, signal) {
        if (!this.path)
            return fn(this.memory);
        mkdirSync(dirname(this.path), { recursive: true });
        const lock = this.path + ".lock", token = randomUUID(), owner = { ...selfOwner(), token, createdAt: Date.now() }, deadline = this.clock.now() + LOCK_WAIT_MS;
        for (;;) {
            try {
                mkdirSync(lock, { mode: 0o700 });
                try {
                    writeFileSync(join(lock, "owner.json"), JSON.stringify(owner) + "\n", { mode: 0o600 });
                }
                catch (error) {
                    rmSync(lock, { recursive: true, force: true });
                    throw error;
                }
                break;
            }
            catch (error) {
                if (error.code !== "EEXIST")
                    throw error;
                if (this.staleLock(lock)) {
                    const quarantine = lock + ".stale-" + randomUUID();
                    try {
                        renameSync(lock, quarantine);
                        rmSync(quarantine, { recursive: true, force: true });
                        continue;
                    }
                    catch { }
                }
                if (signal?.aborted)
                    throw new PairedExecutionError("cancelled", "Provider state lock cancelled", "cancelled");
                if (this.clock.now() >= deadline)
                    throw new PairedExecutionError("provider-limited", "Timed out waiting for provider accounting lock", "provider-limited", null, undefined, { classification: "permanent", status: null, code: "accounting-lock-timeout", retryAfterMs: null, retryOwner: "provider-scheduler", resumable: true });
                await this.clock.sleep(5, signal);
            }
        }
        try {
            const all = this.read(), state = all[this.key] ?? initial(this.key), out = fn(state);
            all[this.key] = state;
            this.write(all);
            return out;
        }
        finally {
            try {
                const current = JSON.parse(readFileSync(join(lock, "owner.json"), "utf8"));
                if (current?.token === token)
                    rmSync(lock, { recursive: true, force: true });
            }
            catch { /* Ownership is unproven: never delete another owner's lock. */ }
        }
    }
    snapshotSync() { if (!this.path)
        return structuredClone(this.memory); const all = this.read(); return structuredClone(all[this.key] ?? initial(this.key)); }
}
export class SafetyBudget {
    config;
    measured = zero();
    reserved = zero();
    unavailable = zero();
    constructor(config) {
        this.config = config;
    }
    limit(kind) { return kind === "costUsd" ? this.config.maxCostUsd : kind === "tokens" ? this.config.maxTokens : this.config.maxProviderSeconds; }
    reserve(request) { for (const kind of Object.keys(request)) {
        const limit = this.limit(kind);
        if (limit !== undefined && this.measured[kind] + this.reserved[kind] + request[kind] > limit)
            throw budgetError(kind);
    } for (const kind of Object.keys(request))
        this.reserved[kind] += request[kind]; }
    reconcile(request, actual) { for (const kind of Object.keys(request)) {
        if (actual[kind] === null) {
            this.unavailable[kind]++;
            continue;
        }
        this.reserved[kind] = Math.max(0, this.reserved[kind] - request[kind]);
        this.measured[kind] += actual[kind];
    } }
    snapshot() { return { measured: { ...this.measured }, reserved: { ...this.reserved }, unavailable: { ...this.unavailable } }; }
}
export class ProviderAdmissionController {
    config;
    clock;
    active = 0;
    starts = [];
    cooldownUntil = 0;
    constructor(config, clock = defaultClock) {
        this.config = config;
        this.clock = clock;
    }
    cooldown(ms) { this.cooldownUntil = Math.max(this.cooldownUntil, this.clock.now() + Math.max(0, ms)); }
    async acquire(signal) { let delayedMs = 0; for (;;) {
        if (signal?.aborted)
            throw new PairedExecutionError("cancelled", "Provider admission cancelled", "cancelled");
        const now = this.clock.now();
        this.starts = this.starts.filter(value => now - value < 60000);
        const rateWait = this.config.requestsPerMinute === undefined || this.starts.length < this.config.requestsPerMinute ? 0 : Math.max(1, 60000 - (now - this.starts[0]));
        const wait = Math.max(0, this.cooldownUntil - now, rateWait);
        if (this.active < this.config.concurrency && wait === 0) {
            this.active++;
            this.starts.push(now);
            let released = false;
            return { delayedMs, release: () => { if (!released) {
                    released = true;
                    this.active--;
                } } };
        }
        const delay = wait || 1;
        delayedMs += delay;
        await this.clock.sleep(delay, signal);
    } }
}
export function providerModelKey(provider, model) { return (provider?.trim() || "unspecified") + "::" + (model?.trim() || "default"); }
export class ProviderScheduler {
    clock;
    config;
    state;
    key;
    constructor(config = {}, clock = defaultClock) {
        this.clock = clock;
        this.config = validateProviderConstraints(config);
        this.key = config.accountingKey ?? "unspecified::default";
        this.state = new DurableState(config.statePath, this.key, clock);
    }
    leaseMs() { return this.config.activeLeaseMs ?? ACTIVE_LEASE_DEFAULT_MS; }
    reservation() { return { costUsd: this.config.reserveCostUsd ?? 0, tokens: this.config.reserveTokens ?? 0, providerSeconds: this.config.reserveProviderSeconds ?? 0 }; }
    limit(kind) { return kind === "costUsd" ? this.config.maxCostUsd : kind === "tokens" ? this.config.maxTokens : this.config.maxProviderSeconds; }
    reap(s, now) { for (const [id, value] of Object.entries(s.active)) {
        if (typeof value === "number") {
            const legacyPid = Number(id.split(":", 1)[0]), legacyOwner = { pid: legacyPid, host: currentHost, processStart: null };
            if (value <= now || processAlive(legacyOwner) === false)
                delete s.active[id];
            continue;
        }
        if (!validActive(value) || value.expiresAt <= now || processAlive(value) === false)
            delete s.active[id];
    } }
    async admit(reservation, signal) { let delayedMs = 0; for (;;) {
        if (signal?.aborted)
            throw new PairedExecutionError("cancelled", "Provider admission cancelled", "cancelled");
        const now = this.clock.now(), decision = await this.state.transaction(s => { s.starts = s.starts.filter(x => now - x < 60000); this.reap(s, now); const active = Object.keys(s.active).length, rateWait = this.config.requestsPerMinute === undefined || s.starts.length < this.config.requestsPerMinute ? 0 : Math.max(1, 60000 - (now - s.starts[0])), wait = Math.max(0, s.cooldownUntil - now, rateWait); if (active >= this.config.concurrency || wait > 0)
            return { wait: wait || 1, id: "" }; for (const kind of Object.keys(reservation)) {
            const limit = this.limit(kind);
            if (limit !== undefined && s.measured[kind] + s.reserved[kind] + reservation[kind] > limit)
                throw budgetError(kind);
        } for (const kind of Object.keys(reservation))
            s.reserved[kind] += reservation[kind]; const id = randomUUID(), owner = selfOwner(); s.active[id] = { ...owner, token: id, expiresAt: now + this.leaseMs(), updatedAt: now }; s.starts.push(now); s.attempts++; s.delayedMs += delayedMs; return { id, wait: 0 }; }, signal);
        if (decision.id)
            return { id: decision.id, delayedMs };
        delayedMs += decision.wait;
        await this.clock.sleep(decision.wait, signal);
    } }
    async renew(id, signal) { const now = this.clock.now(); return this.state.transaction(s => { const lease = s.active[id]; if (!validActive(lease) || lease.token !== id || lease.pid !== process.pid || lease.host !== currentHost || lease.processStart !== processStart(process.pid) || lease.expiresAt <= now)
        return false; lease.expiresAt = now + this.leaseMs(); lease.updatedAt = now; return true; }, signal); }
    async finish(id, reservation, actual, signal) { return this.state.transaction(s => { const lease = s.active[id], now = this.clock.now(); if (!validActive(lease) || lease.token !== id || lease.pid !== process.pid || lease.host !== currentHost || lease.processStart !== processStart(process.pid) || lease.expiresAt <= now)
        return false; delete s.active[id]; for (const kind of Object.keys(reservation)) {
        if (actual[kind] === null) {
            s.unavailable[kind]++;
            continue;
        }
        s.reserved[kind] = Math.max(0, s.reserved[kind] - reservation[kind]);
        s.measured[kind] += actual[kind];
    } return true; }, signal); }
    heartbeat(id, controller) { let stopped = false, lost = false, inFlight = Promise.resolve(); const timer = setInterval(() => { if (stopped)
        return; inFlight = inFlight.then(async () => { if (!await this.renew(id, controller.signal)) {
        lost = true;
        controller.abort();
    } }).catch(() => { lost = true; controller.abort(); }); }, Math.max(1, Math.floor(this.leaseMs() / 3))); timer.unref(); return async () => { stopped = true; clearInterval(timer); await inFlight; return lost; }; }
    async execute(operation, signal) { for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
        const reservation = this.reservation(), admitted = await this.admit(reservation, signal), started = this.clock.now(), leaseAbort = new AbortController(), combined = signal ? AbortSignal.any([signal, leaseAbort.signal]) : leaseAbort.signal, stopHeartbeat = this.heartbeat(admitted.id, leaseAbort);
        let result, caught, usage;
        try {
            result = await operation(combined);
            usage = telemetryUsage(result, (this.clock.now() - started) / 1000);
        }
        catch (error) {
            caught = error;
            const item = error, evidence = item.evidence;
            usage = telemetryUsage(evidence ?? { ...item.usage }, evidence?.durationSeconds ?? null);
        }
        const heartbeatLost = await stopHeartbeat();
        let owned = false;
        try {
            owned = await this.finish(admitted.id, reservation, usage);
        }
        catch (error) {
            if (!caught)
                caught = error;
        }
        if (heartbeatLost || !owned)
            throw leaseLostError();
        if (!caught)
            return result;
        const error = caught, item = error, evidence = item.evidence;
        if (error instanceof PairedExecutionError && ["cancelled", "budget-exhausted", "provider-limited"].includes(error.code))
            throw error;
        const provider = classifyProviderError(error, this.clock.now());
        if (provider.classification === "permanent")
            throw new PairedExecutionError("provider-permanent", error.message, "provider-permanent", null, evidence, provider);
        if (attempt >= this.config.maxAttempts)
            throw new PairedExecutionError("provider-limited", error.message, "provider-limited", null, evidence, { ...provider, resumable: true });
        const retryAfter = provider.retryAfterMs ?? 0, raw = this.clock.random(), unit = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0, cap = Math.min(this.config.maxBackoffMs, this.config.baseBackoffMs * 2 ** (attempt - 1)), delay = Math.max(retryAfter, Math.floor(unit * cap));
        await this.state.transaction(s => { s.retries++; s.delayedMs += delay; s.cooldownUntil = Math.max(s.cooldownUntil, this.clock.now() + retryAfter); }, signal);
        await this.clock.sleep(delay, signal);
    } throw new Error("unreachable"); }
    accounting() { const s = this.state.snapshotSync(); return { measured: s.measured, reserved: s.reserved, unavailable: s.unavailable, attempts: s.attempts, retries: s.retries, delayedMs: s.delayedMs, policy: s.policy, key: s.key }; }
}
export class ScheduledPairedRunner {
    inner;
    scheduler;
    retryBehavior = "none";
    constructor(inner, scheduler) {
        this.inner = inner;
        this.scheduler = scheduler;
        if (inner.retryBehavior !== "none")
            throw new TypeError(inner.retryBehavior ? "Nested retry policy is not allowed: " + inner.retryBehavior : "Runner must declare retryBehavior before provider scheduling");
    }
    executePaired(plan) { return this.scheduler.execute(leaseSignal => this.inner.executePaired({ ...plan, signal: leaseSignal }), plan.signal); }
}
