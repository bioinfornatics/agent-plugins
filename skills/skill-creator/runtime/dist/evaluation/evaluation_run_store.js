import { closeSync, cpSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, truncateSync, writeFileSync, writeSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
export const RUN_IDENTITY_SCHEMA_VERSION = 1;
export const RUN_EVENT_SCHEMA_VERSION = 1;
const SHA256 = /^[a-f0-9]{64}$/;
const LOCK_STALE_MS = 5 * 60_000;
const LOCK_WAIT_MS = 15_000;
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
function jsonScalar(value) { if (value === null)
    return "null"; if (typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value); if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(Object.is(value, -0) ? 0 : value); throw new TypeError("canonical run identity accepts only finite JSON values"); }
export function canonicalRunJson(value, seen = new Set()) { if (value === null || typeof value !== "object")
    return jsonScalar(value); if (seen.has(value))
    throw new TypeError("canonical run identity cannot contain cycles"); seen.add(value); let result; if (Array.isArray(value))
    result = "[" + value.map(item => canonicalRunJson(item, seen)).join(",") + "]";
else {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null)
        throw new TypeError("canonical run identity accepts only plain JSON objects");
    result = "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonicalRunJson(value[key], seen)).join(",") + "}";
} seen.delete(value); return result; }
function sha(value) { return createHash("sha256").update(value).digest("hex"); }
export function evaluationRunIdentity(input) { const canonical = structuredClone(input); const envelope = { schema_version: RUN_IDENTITY_SCHEMA_VERSION, ...canonical }; return { schema_version: RUN_IDENTITY_SCHEMA_VERSION, sha256: sha(canonicalRunJson(envelope)), canonical }; }
function empty() { return { schema_version: 1, last_sequence: 0, runs: {}, counts: { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0, reusable: 0 } }; }
function recount(state) { const counts = { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0, reusable: 0 }; for (const run of Object.values(state.runs)) {
    counts[run.status]++;
    if (run.status === "completed" && run.evidence_validated && SHA256.test(run.evidence_sha256 ?? ""))
        counts.reusable++;
} state.counts = counts; }
function apply(state, event) {
    if (event.sequence !== state.last_sequence + 1)
        throw new Error(`non-monotonic run event sequence: expected ${state.last_sequence + 1}, got ${event.sequence}`);
    if (event.schema_version !== 1 || !event.event_id || !event.run_id)
        throw new Error("invalid run lifecycle event");
    const prior = state.runs[event.run_id] ?? { run_id: event.run_id, status: "pending", evidence_validated: false, last_sequence: 0 };
    const run = { ...prior };
    const payload = (event.payload ?? {});
    if (event.type === "started") {
        run.status = "running";
        run.evidence_validated = false;
        delete run.evidence_sha256;
        delete run.completion_event_id;
        run.claim_owner = payload.owner_id;
        run.lease_expires_at = payload.lease_expires_at;
        run.attempt_id = payload.attempt_id;
    }
    else if (event.type === "lease-renewed" && run.claim_owner === payload.owner_id) {
        run.lease_expires_at = payload.lease_expires_at;
    }
    else if (event.type === "completed") {
        run.status = "completed";
        run.evidence_validated = false;
        delete run.evidence_sha256;
        run.completion_event_id = event.event_id;
    }
    else if (event.type === "failed" && run.status !== "completed") {
        run.status = "failed";
        delete run.claim_owner;
        delete run.lease_expires_at;
        delete run.attempt_id;
    }
    else if (event.type === "cancelled" && run.status !== "completed") {
        run.status = "cancelled";
        delete run.claim_owner;
        delete run.lease_expires_at;
        delete run.attempt_id;
    }
    else if (event.type === "evidence-validated" && run.status === "completed") {
        const digest = payload.evidence_sha256;
        if (typeof digest === "string" && SHA256.test(digest)) {
            run.evidence_validated = true;
            run.evidence_sha256 = digest;
            delete run.claim_owner;
            delete run.lease_expires_at;
            delete run.attempt_id;
        }
        else {
            run.evidence_validated = false;
            delete run.evidence_sha256;
        }
    }
    else if (event.type === "evidence-invalidated") {
        run.evidence_validated = false;
        delete run.evidence_sha256;
        delete run.claim_owner;
        delete run.lease_expires_at;
        delete run.attempt_id;
    }
    run.last_sequence = event.sequence;
    state.runs[event.run_id] = run;
    state.last_sequence = event.sequence;
    recount(state);
}
function atomic(path, text) { mkdirSync(dirname(path), { recursive: true }); const temp = path + `.tmp-${process.pid}-${randomUUID()}`; const fd = openSync(temp, "wx", 0o600); try {
    writeSync(fd, text);
    fsyncSync(fd);
}
finally {
    closeSync(fd);
} renameSync(temp, path); const directory = openSync(dirname(path), "r"); try {
    fsyncSync(directory);
}
finally {
    closeSync(directory);
} }
function syncDirectory(path) { const fd = openSync(path, "r"); try {
    fsyncSync(fd);
}
finally {
    closeSync(fd);
} }
function durableRename(source, target) { renameSync(source, target); syncDirectory(dirname(source)); if (dirname(target) !== dirname(source))
    syncDirectory(dirname(target)); }
function durableRemove(path) { const parent = dirname(path); rmSync(path, { recursive: true, force: true }); if (existsSync(parent))
    syncDirectory(parent); }
function durableCleanupStaging(path) { durableRemove(path); for (const emptyParent of [dirname(path), dirname(dirname(path))])
    try {
        if (existsSync(emptyParent) && readdirSync(emptyParent).length === 0)
            durableRemove(emptyParent);
    }
    catch (error) {
        if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY")
            throw error;
    } }
function syncTree(path) { if (!existsSync(path))
    return; const stat = statSync(path); if (stat.isDirectory()) {
    for (const name of readdirSync(path))
        syncTree(join(path, name));
    syncDirectory(path);
}
else {
    const fd = openSync(path, "r");
    try {
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
} }
function materializeDirectory(source, target) { mkdirSync(target, { recursive: true }); const wanted = new Set(readdirSync(source)); for (const name of [...wanted].sort()) {
    const from = join(source, name), to = join(target, name), temp = join(target, `.publish-${randomUUID()}`);
    cpSync(from, temp, { recursive: true, dereference: false });
    syncTree(temp);
    if (existsSync(to) && statSync(temp).isDirectory())
        durableRemove(to);
    durableRename(temp, to);
} for (const name of readdirSync(target))
    if (!wanted.has(name))
        durableRemove(join(target, name)); syncDirectory(target); }
function within(root, path) { const rel = relative(resolve(root), resolve(path)); return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/")); }
function processAlive(pid) { if (!Number.isInteger(pid) || pid <= 0)
    return false; try {
    process.kill(pid, 0);
    return true;
}
catch (error) {
    return error?.code === "EPERM";
} }
export class EvaluationRunStore {
    directory;
    eventPath;
    snapshotPath;
    lockPath;
    publicationDirectory;
    state;
    eventIds;
    publicationFault;
    constructor(directory, options = {}) { this.directory = resolve(directory); this.eventPath = join(this.directory, "events.jsonl"); this.snapshotPath = join(this.directory, "snapshot.json"); this.lockPath = join(this.directory, ".write-lock"); this.publicationDirectory = join(this.directory, "publications"); this.publicationFault = options.publicationFault; mkdirSync(this.directory, { recursive: true }); this.state = empty(); this.eventIds = new Set(); const recovered = this.withLock(() => { const result = this.recover(); this.state = result.state; this.eventIds = result.eventIds; this.reconcilePublicationsUnlocked(); return { state: this.state, eventIds: this.eventIds }; }); this.state = recovered.state; this.eventIds = recovered.eventIds; }
    withLock(operation) { const deadline = Date.now() + LOCK_WAIT_MS, token = randomUUID(); while (true) {
        try {
            mkdirSync(this.lockPath, { mode: 0o700 });
            writeFileSync(join(this.lockPath, "owner.json"), JSON.stringify({ pid: process.pid, token, created_at: new Date().toISOString() }), { mode: 0o600 });
            break;
        }
        catch (error) {
            if (error?.code !== "EEXIST")
                throw error;
            let stale = false;
            try {
                const owner = JSON.parse(readFileSync(join(this.lockPath, "owner.json"), "utf8"));
                const age = Date.now() - statSync(this.lockPath).mtimeMs;
                stale = age > LOCK_STALE_MS && !processAlive(owner.pid);
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
                throw new Error(`timed out waiting for evaluation run store lock: ${this.lockPath}`);
            Atomics.wait(sleepBuffer, 0, 0, 10);
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
        catch { /* Never remove a lock whose ownership cannot be proven. */ }
    } }
    recover() { let state = empty(), ids = new Set(); if (!existsSync(this.eventPath))
        return { state, eventIds: ids }; const text = readFileSync(this.eventPath, "utf8"), lines = text.split("\n"), completeLength = text.endsWith("\n") ? text.length : text.lastIndexOf("\n") + 1; for (let i = 0; i < lines.length - (text.endsWith("\n") ? 1 : 1); i++) {
        if (!lines[i])
            continue;
        let event;
        try {
            event = JSON.parse(lines[i]);
        }
        catch {
            throw new Error(`corrupt run lifecycle event at line ${i + 1}`);
        }
        if (ids.has(event.event_id))
            continue;
        apply(state, event);
        ids.add(event.event_id);
    } if (!text.endsWith("\n"))
        truncateSync(this.eventPath, completeLength); return { state, eventIds: ids }; }
    refresh() { const recovered = this.recover(); this.state = recovered.state; this.eventIds = recovered.eventIds; this.reconcilePublicationsUnlocked(); }
    transactionPath(transactionId) { return join(this.publicationDirectory, transactionId + ".json"); }
    validateTransaction(tx) { if (tx.schema_version !== 1 || !SHA256.test(tx.run_id) || !tx.attempt_id || tx.transaction_id !== `${tx.run_id}-${tx.attempt_id}`)
        throw new Error("invalid publication transaction"); if (!within(join(this.directory, "staging"), tx.staging_directory) || tx.backup_directory !== tx.target_directory + `.replaced-${tx.attempt_id}`)
        throw new Error("publication transaction paths escape their allowed locations"); }
    appendPublicationEventsUnlocked(tx) { this.appendUnlocked(tx.run_id, tx.type, { ...tx.payload, owner_id: tx.owner_id, attempt_id: tx.attempt_id, ...(tx.evidence_sha256 ? { evidence_sha256: tx.evidence_sha256 } : {}) }, `${tx.type}:${tx.run_id}:${tx.attempt_id}`); if (tx.type === "completed")
        this.appendUnlocked(tx.run_id, "evidence-validated", { evidence_sha256: tx.evidence_sha256, owner_id: tx.owner_id, attempt_id: tx.attempt_id }, `evidence-validated:${tx.run_id}:${tx.attempt_id}:${tx.evidence_sha256}`); }
    reconcilePublicationUnlocked(tx) {
        this.validateTransaction(tx);
        const target = existsSync(tx.target_directory), staging = existsSync(tx.staging_directory), backup = existsSync(tx.backup_directory);
        if (!target && backup && !staging) {
            cpSync(tx.backup_directory, tx.target_directory, { recursive: true, dereference: false });
            syncTree(tx.target_directory);
            durableRemove(tx.backup_directory);
            durableRemove(this.transactionPath(tx.transaction_id));
            return;
        }
        if (!target && backup) {
            cpSync(tx.backup_directory, tx.target_directory, { recursive: true, dereference: false });
            syncTree(tx.target_directory);
        }
        else if (!target)
            throw new Error(`publication ${tx.transaction_id} cannot recover a canonical target`);
        if (staging && !backup) {
            durableCleanupStaging(tx.staging_directory);
            durableRemove(this.transactionPath(tx.transaction_id));
            return;
        }
        if (staging && backup)
            materializeDirectory(tx.staging_directory, tx.target_directory);
        this.appendPublicationEventsUnlocked(tx);
        if (existsSync(tx.backup_directory))
            durableRemove(tx.backup_directory);
        if (existsSync(tx.staging_directory))
            durableCleanupStaging(tx.staging_directory);
        durableRemove(this.transactionPath(tx.transaction_id));
    }
    reconcilePublicationsUnlocked() { if (!existsSync(this.publicationDirectory))
        return; for (const name of readdirSync(this.publicationDirectory).filter(name => name.endsWith(".json")).sort()) {
        const path = join(this.publicationDirectory, name);
        let tx;
        try {
            tx = JSON.parse(readFileSync(path, "utf8"));
        }
        catch {
            throw new Error(`corrupt publication transaction: ${path}`);
        }
        this.reconcilePublicationUnlocked(tx);
    } }
    /** Repairs interrupted publications before callers enumerate canonical run directories. */
    static recoverPublications(directory) { new EvaluationRunStore(directory); }
    fault(boundary) { this.publicationFault?.(boundary); }
    appendUnlocked(runId, type, payload, eventId) { if (this.eventIds.has(eventId))
        return null; const event = { schema_version: 1, sequence: this.state.last_sequence + 1, event_id: eventId, run_id: runId, type, at: new Date().toISOString(), ...(payload === undefined ? {} : { payload }) }; const fd = openSync(this.eventPath, "a", 0o600); try {
        writeSync(fd, JSON.stringify(event) + "\n");
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    } apply(this.state, event); this.eventIds.add(eventId); this.materializeUnlocked(); return event; }
    snapshot() { return this.withLock(() => { this.refresh(); return structuredClone(this.state); }); }
    append(runId, type, payload, eventId) { if (!SHA256.test(runId))
        throw new TypeError("run_id must be a lowercase SHA-256"); if (type === "evidence-validated" && !SHA256.test(payload?.evidence_sha256 ?? ""))
        throw new TypeError("evidence-validated requires a lowercase SHA-256 evidence_sha256"); return this.withLock(() => { this.refresh(); const id = eventId ?? sha(canonicalRunJson({ run_id: runId, type, payload: payload ?? null })); const existing = this.state.runs[runId]; if (type === "completed" && existing?.status === "completed")
        return null; return this.appendUnlocked(runId, type, payload, id); }); }
    claim(runId, ownerId, currentEvidenceSha256, leaseMs, now = undefined, metadata = {}) {
        if (!SHA256.test(runId))
            throw new TypeError("run_id must be a lowercase SHA-256");
        if (!ownerId)
            throw new TypeError("owner_id is required");
        if (!Number.isFinite(leaseMs) || leaseMs < 1)
            throw new TypeError("leaseMs must be positive");
        return this.withLock(() => {
            this.refresh();
            const checkedAt = now ?? Date.now(), evidenceSha256 = typeof currentEvidenceSha256 === "function" ? currentEvidenceSha256() : currentEvidenceSha256;
            let run = this.state.runs[runId];
            if (run?.status === "completed" && run.evidence_validated && SHA256.test(evidenceSha256 ?? "") && run.evidence_sha256 === evidenceSha256)
                return { status: "reusable" };
            if (run?.status === "completed" && run.evidence_validated)
                this.appendUnlocked(runId, "evidence-invalidated", { reason: evidenceSha256 ? "evidence-digest-mismatch" : "evidence-missing" }, `invalidated:${runId}:${run.evidence_sha256 ?? "none"}:${evidenceSha256 ?? "missing"}`);
            run = this.state.runs[runId];
            const expiry = Date.parse(run?.lease_expires_at ?? "");
            if (run?.claim_owner && Number.isFinite(expiry) && expiry > checkedAt)
                return { status: "waiting", owner: run.claim_owner, lease_expires_at: run.lease_expires_at };
            const recovered = Boolean(run?.claim_owner), attemptId = randomUUID(), leaseExpiresAt = new Date(checkedAt + leaseMs).toISOString();
            this.appendUnlocked(runId, "started", { ...metadata, owner_id: ownerId, attempt_id: attemptId, lease_expires_at: leaseExpiresAt, recovered_stale_owner: recovered }, `started:${runId}:${attemptId}`);
            return { status: "claimed", attempt_id: attemptId, lease_expires_at: leaseExpiresAt, recovered_stale_owner: recovered };
        });
    }
    renew(runId, ownerId, attemptId, leaseMs, now) { return this.withLock(() => { this.refresh(); const checkedAt = now ?? Date.now(), run = this.state.runs[runId]; if (run?.claim_owner !== ownerId || run.attempt_id !== attemptId || !run.lease_expires_at || Date.parse(run.lease_expires_at) <= checkedAt)
        return false; const expiry = new Date(checkedAt + leaseMs).toISOString(); this.appendUnlocked(runId, "lease-renewed", { owner_id: ownerId, attempt_id: attemptId, lease_expires_at: expiry }, `renewed:${runId}:${attemptId}:${expiry}`); return true; }); }
    appendOwned(runId, type, ownerId, attemptId, payload = {}, now) { return this.withLock(() => { this.refresh(); const checkedAt = now ?? Date.now(), run = this.state.runs[runId], expiry = Date.parse(run?.lease_expires_at ?? ""); if (run?.claim_owner !== ownerId || run.attempt_id !== attemptId || !Number.isFinite(expiry) || expiry <= checkedAt)
        return null; if (type === "evidence-validated" && !SHA256.test(String(payload.evidence_sha256 ?? "")))
        throw new TypeError("evidence-validated requires a lowercase SHA-256 evidence_sha256"); return this.appendUnlocked(runId, type, { ...payload, owner_id: ownerId, attempt_id: attemptId }, `${type}:${runId}:${attemptId}:${type === "evidence-validated" ? payload.evidence_sha256 ?? "" : ""}`); }); }
    createAttemptStaging(runId, attemptId, sourceDirectory) { if (!SHA256.test(runId) || !attemptId)
        throw new TypeError("run_id and attempt_id are required"); const staging = join(this.directory, "staging", runId, attemptId); rmSync(staging, { recursive: true, force: true }); mkdirSync(dirname(staging), { recursive: true }); cpSync(sourceDirectory, staging, { recursive: true, dereference: false }); return staging; }
    cleanupAttemptStaging(runId, attemptId) { if (!attemptId)
        return; const staging = join(this.directory, "staging", runId, attemptId); if (existsSync(this.transactionPath(`${runId}-${attemptId}`)))
        return; durableCleanupStaging(staging); }
    publishOwned(runId, ownerId, attemptId, stagingDirectory, targetDirectory, type, payload = {}, evidenceSha256, now) {
        if (type === "completed" && !SHA256.test(evidenceSha256 ?? ""))
            throw new TypeError("completed publication requires a lowercase SHA-256 evidence digest");
        return this.withLock(() => {
            this.refresh();
            const checkedAt = now ?? Date.now(), run = this.state.runs[runId], expiry = Date.parse(run?.lease_expires_at ?? "");
            if (run?.claim_owner !== ownerId || run.attempt_id !== attemptId || !Number.isFinite(expiry) || expiry <= checkedAt)
                return false;
            if (!existsSync(stagingDirectory))
                throw new Error("attempt staging directory is missing");
            const absoluteStaging = resolve(stagingDirectory), absoluteTarget = resolve(targetDirectory), backup = absoluteTarget + `.replaced-${attemptId}`, transactionId = `${runId}-${attemptId}`;
            if (!within(join(this.directory, "staging"), absoluteStaging))
                throw new Error("attempt staging directory is outside the run store");
            if (!existsSync(absoluteTarget))
                throw new Error("canonical target directory is missing before publication");
            const tx = { schema_version: 1, transaction_id: transactionId, run_id: runId, owner_id: ownerId, attempt_id: attemptId, staging_directory: absoluteStaging, target_directory: absoluteTarget, backup_directory: backup, type, payload, ...(evidenceSha256 ? { evidence_sha256: evidenceSha256 } : {}) };
            mkdirSync(this.publicationDirectory, { recursive: true });
            atomic(this.transactionPath(transactionId), JSON.stringify(tx, null, 2) + "\n");
            this.fault("after-journal");
            durableRemove(backup);
            cpSync(absoluteTarget, backup, { recursive: true, dereference: false });
            syncTree(backup);
            this.fault("after-target-to-backup");
            materializeDirectory(absoluteStaging, absoluteTarget);
            this.fault("after-staging-to-target");
            this.fault("before-lifecycle-append");
            this.appendUnlocked(runId, type, { ...payload, owner_id: ownerId, attempt_id: attemptId, ...(evidenceSha256 ? { evidence_sha256: evidenceSha256 } : {}) }, `${type}:${runId}:${attemptId}`);
            this.fault("after-completion-append");
            if (type === "completed")
                this.appendUnlocked(runId, "evidence-validated", { evidence_sha256: evidenceSha256, owner_id: ownerId, attempt_id: attemptId }, `evidence-validated:${runId}:${attemptId}:${evidenceSha256}`);
            this.fault("after-lifecycle-append");
            this.fault("before-cleanup");
            durableRemove(backup);
            this.fault("after-cleanup");
            durableCleanupStaging(absoluteStaging);
            this.fault("after-staging-cleanup");
            durableRemove(this.transactionPath(transactionId));
            this.fault("after-journal-delete");
            return true;
        });
    }
    materializeUnlocked() { atomic(this.snapshotPath, JSON.stringify(this.state, null, 2) + "\n"); }
    materialize() { this.withLock(() => { this.refresh(); this.materializeUnlocked(); }); }
    isReusable(runId, currentEvidenceSha256) { if (!SHA256.test(currentEvidenceSha256 ?? ""))
        return false; const run = this.snapshot().runs[runId]; return run?.status === "completed" && run.evidence_validated === true && SHA256.test(run.evidence_sha256 ?? "") && run.evidence_sha256 === currentEvidenceSha256; }
}
