import { closeSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { artifactHash, evidenceArtifactHashes, expectedExecutionBinding } from "./evaluation_provenance.js";
import { canonicalRunJson, evaluationRunIdentity } from "./evaluation_run_store.js";
const SHA256 = /^[a-f0-9]{64}$/;
const LOCK_STALE_MS = 5 * 60_000;
function same(a, b) { return canonicalRunJson(a) === canonicalRunJson(b); }
function load(path) { try {
    return JSON.parse(readFileSync(path, "utf8"));
}
catch {
    return null;
} }
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function processAlive(pid) { if (!Number.isInteger(pid) || pid <= 0)
    return false; try {
    process.kill(pid, 0);
    return true;
}
catch (error) {
    return error?.code === "EPERM";
} }
function within(root, path) { const rel = relative(resolve(root), resolve(path)); return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)); }
function safeTree(root, path = root) { try {
    if (!within(root, path))
        return false;
    const st = lstatSync(path);
    if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile()))
        return false;
    const rel = relative(realpathSync(root), realpathSync(path));
    if (rel.startsWith("..") || isAbsolute(rel))
        return false;
    if (st.isDirectory())
        for (const name of readdirSync(path))
            if (!safeTree(root, join(path, name)))
                return false;
    return true;
}
catch {
    return false;
} }
function syncDir(path) { const fd = openSync(path, "r"); try {
    fsyncSync(fd);
}
finally {
    closeSync(fd);
} }
function syncFile(path) { const fd = openSync(path, "r"); try {
    fsyncSync(fd);
}
finally {
    closeSync(fd);
} }
function syncTree(path) { const st = lstatSync(path); if (st.isDirectory()) {
    for (const name of readdirSync(path))
        syncTree(join(path, name));
    syncDir(path);
}
else if (st.isFile())
    syncFile(path);
else
    throw new Error("refusing to sync unsafe cache tree"); }
function atomic(path, text) { const temp = path + ".tmp-" + process.pid + "-" + randomUUID(), fd = openSync(temp, "wx", 0o600); try {
    writeSync(fd, text);
    fsyncSync(fd);
}
finally {
    closeSync(fd);
} renameSync(temp, path); syncDir(dirname(path)); }
function identityValid(identity, runId) { try {
    return identity?.schema_version === 1 && identity.sha256 === runId && evaluationRunIdentity(identity.canonical).sha256 === runId;
}
catch {
    return false;
} }
function copyContents(source, target) { if (!safeTree(source))
    throw new Error("cache tree contains a symlink, special file, or path escape"); mkdirSync(target, { recursive: true }); for (const name of readdirSync(source))
    if (name !== "cache-manifest.json")
        cpSync(join(source, name), join(target, name), { recursive: true, dereference: false }); if (!safeTree(target))
    throw new Error("materialized cache tree is unsafe"); }
export function validatedCompleteArtifactDigest(runDir, runId, evidenceSha256, expectedIdentity) {
    if (!safeTree(runDir))
        return undefined;
    const identity = load(join(runDir, "run-identity.json")), manifest = load(join(runDir, "execution-evidence.json")), grading = load(join(runDir, "grading.json")), wanted = expectedExecutionBinding(runDir);
    if (!identityValid(expectedIdentity ?? identity, runId) || !same(identity, expectedIdentity ?? identity) || !wanted || !manifest || manifest.schema_version !== "1.0" || !same(Object.fromEntries(Object.keys(wanted).map(k => [k, manifest[k]])), wanted))
        return undefined;
    if (!existsSync(join(runDir, "outputs", "result.txt")) || !grading || grading.schema_version !== 2 || grading.authority !== "evaluator")
        return undefined;
    const actual = evidenceArtifactHashes(runDir), claimed = manifest.artifact_sha256;
    if (!claimed || !same(actual, claimed))
        return undefined;
    const digest = artifactHash(join(runDir, "execution-evidence.json"));
    return evidenceSha256 === undefined || digest === evidenceSha256 ? digest : undefined;
}
/** Immutable content-addressed cache for complete, validated run plus grade artifacts. */
export class EvaluationArtifactCache {
    directory;
    accounting;
    fault;
    constructor(directory, options = {}) { this.directory = directory ? resolve(directory) : ""; this.fault = options.publicationFault; this.accounting = { hits: 0, misses: 0, invalidated: 0, published: 0, disabled: !directory }; if (directory) {
        mkdirSync(this.directory, { recursive: true });
        if (lstatSync(this.directory).isSymbolicLink())
            throw new Error("cache directory must not be a symlink");
        syncDir(this.directory);
        syncDir(dirname(this.directory));
        this.reconcileStartup();
    } }
    entry(runId) { return join(this.directory, "objects", runId.slice(0, 2), runId); }
    reconcileStartup() { const objects = join(this.directory, "objects"); if (!existsSync(objects) || !safeTree(objects))
        return; for (const shard of readdirSync(objects)) {
        const parent = join(objects, shard);
        if (!/^[a-f0-9]{2}$/.test(shard) || !lstatSync(parent).isDirectory())
            continue;
        const names = readdirSync(parent);
        const ids = new Set(names.map(name => name.match(/^([a-f0-9]{64})(?:\.publish\.json|\.staging-)/)?.[1]).filter((id) => Boolean(id)));
        for (const id of ids)
            if (id.startsWith(shard)) {
                const target = this.entry(id), ownership = this.acquire(target);
                try {
                    if (existsSync(target + ".publish.json"))
                        this.recoverPublication(id);
                    else
                        this.cleanupOrphans(target);
                }
                finally {
                    this.release(ownership.lock, ownership.token);
                }
            }
    } }
    boundary(point) { this.fault?.(point); }
    quarantine(path, reason) { if (!existsSync(path))
        return; if (!within(this.directory, path))
        throw new Error("refusing to quarantine outside cache"); const root = join(this.directory, "quarantine"); mkdirSync(root, { recursive: true }); syncDir(this.directory); syncDir(root); const target = join(root, `${basename(path)}-${Date.now()}-${randomUUID()}`); mkdirSync(target, { mode: 0o700 }); renameSync(path, join(target, "payload")); syncDir(dirname(path)); syncDir(target); atomic(join(target, "quarantine-reason.txt"), reason + "\n"); syncDir(root); this.accounting.invalidated++; }
    acquire(target) { const parent = dirname(target), objects = dirname(parent); mkdirSync(objects, { recursive: true }); syncDir(this.directory); mkdirSync(parent, { recursive: true }); syncDir(objects); syncDir(parent); for (const path of [objects, parent]) {
        const st = lstatSync(path), rel = relative(realpathSync(this.directory), realpathSync(path));
        if (!st.isDirectory() || st.isSymbolicLink() || rel.startsWith("..") || isAbsolute(rel))
            throw new Error("cache object directory must be a real directory within the cache");
    } const lock = target + ".lock", deadline = Date.now() + 15_000, token = randomUUID(); while (true) {
        try {
            mkdirSync(lock, { mode: 0o700 });
            syncDir(parent);
            atomic(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, host: hostname(), token, created_at: new Date().toISOString() }) + "\n");
            return { lock, token };
        }
        catch (error) {
            if (error?.code !== "EEXIST")
                throw error;
            let stale = false;
            try {
                const owner = load(join(lock, "owner.json"));
                stale = Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS && owner?.host === hostname() && !processAlive(owner.pid);
            }
            catch {
                try {
                    stale = Date.now() - lstatSync(lock).mtimeMs > LOCK_STALE_MS;
                }
                catch { }
            }
            if (stale) {
                this.quarantine(lock, "stale cache lock");
                syncDir(parent);
                continue;
            }
            if (Date.now() > deadline)
                throw new Error("timed out waiting for evaluation cache lock: " + lock);
            sleep(10);
        }
    } }
    release(lock, token) { try {
        const owner = load(join(lock, "owner.json"));
        if (owner?.token === token) {
            rmSync(lock, { recursive: true, force: true });
            syncDir(dirname(lock));
        }
    }
    catch { } }
    validPublished(target, runId, digest) { if (!safeTree(target))
        return false; const manifest = load(join(target, "cache-manifest.json")); return manifest?.schema_version === 1 && manifest.run_id === runId && manifest.artifact_sha256 === digest && artifactHash(join(target, "artifact")) === digest; }
    journalValid(tx, runId, target) { return tx?.schema_version === 1 && tx.kind === "evaluation-artifact-cache-publication" && tx.run_id === runId && tx.target_directory === target && typeof tx.staging_directory === "string" && within(dirname(target), tx.staging_directory) && basename(tx.staging_directory).startsWith(runId + ".staging-") && SHA256.test(tx.artifact_sha256) && ["prepared", "renamed", "committed"].includes(tx.phase); }
    recoverPublication(runId) { const target = this.entry(runId), parent = dirname(target), journal = target + ".publish.json"; if (!existsSync(journal)) {
        this.cleanupOrphans(target);
        return;
    } const tx = load(journal); if (!this.journalValid(tx, runId, target)) {
        this.quarantine(journal, "truncated or invalid cache publication journal");
        this.cleanupOrphans(target);
        return;
    } const staging = resolve(tx.staging_directory); if (existsSync(target)) {
        if (!this.validPublished(target, runId, tx.artifact_sha256)) {
            this.quarantine(target, "interrupted cache publication target failed validation");
            if (existsSync(staging) && safeTree(staging) && this.validPublished(staging, runId, tx.artifact_sha256)) {
                renameSync(staging, target);
                syncDir(parent);
            }
        }
        else if (existsSync(staging))
            rmSync(staging, { recursive: true, force: true });
    }
    else if (existsSync(staging) && safeTree(staging) && this.validPublished(staging, runId, tx.artifact_sha256)) {
        renameSync(staging, target);
        syncDir(parent);
    }
    else if (existsSync(staging))
        this.quarantine(staging, "unsafe or invalid interrupted cache publication"); if (existsSync(target) && this.validPublished(target, runId, tx.artifact_sha256)) {
        const committed = { ...tx, phase: "committed" };
        atomic(journal, JSON.stringify(committed) + "\n");
    } rmSync(journal, { force: true }); syncDir(parent); this.cleanupOrphans(target); }
    cleanupOrphans(target) { const parent = dirname(target); if (!existsSync(parent))
        return; for (const name of readdirSync(parent))
        if (name.startsWith(basename(target) + ".staging-") || name.startsWith(basename(target) + ".publish.json.tmp-"))
            rmSync(join(parent, name), { recursive: true, force: true }); syncDir(parent); }
    materialize(runId, targetRunDir, bindingRunDir, expectedIdentity) {
        if (!identityValid(expectedIdentity, runId))
            throw new Error("canonical run identity does not match cache key");
        if (this.accounting.disabled)
            return null;
        const target = this.entry(runId), ownership = this.acquire(target);
        try {
            this.recoverPublication(runId);
            const entry = this.entry(runId);
            if (!existsSync(entry)) {
                this.accounting.misses++;
                return null;
            }
            const manifest = load(join(entry, "cache-manifest.json"));
            if (!safeTree(entry) || !manifest || manifest.schema_version !== 1 || manifest.run_id !== runId || !SHA256.test(manifest.evidence_sha256) || manifest.artifact_sha256 !== artifactHash(join(entry, "artifact")) || isAbsolute(manifest.provenance?.publisher_run_directory ?? "") || relative(".", manifest.provenance?.publisher_run_directory ?? "").startsWith("..")) {
                this.quarantine(entry, "cache manifest or artifact digest is invalid");
                this.accounting.misses++;
                return null;
            }
            if (!safeTree(targetRunDir)) {
                this.quarantine(entry, "materialization target contains a symlink or special file");
                this.accounting.misses++;
                return null;
            }
            const temp = targetRunDir + `.cache-${randomUUID()}`;
            try {
                copyContents(join(entry, "artifact"), temp);
                const wanted = expectedExecutionBinding(bindingRunDir);
                if (!wanted || !same(load(join(temp, "run-identity.json")), expectedIdentity) || !requiredCompleteWithBinding(temp, runId, manifest.evidence_sha256, wanted)) {
                    this.quarantine(entry, "cached artifact is incomplete, corrupt, or has invalid provenance");
                    this.accounting.misses++;
                    return null;
                }
                const cachedEvidence = load(join(temp, "execution-evidence.json"));
                for (const [key, value] of Object.entries(wanted))
                    cachedEvidence[key] = value;
                writeFileSync(join(temp, "execution-evidence.json"), JSON.stringify(cachedEvidence, null, 2) + "\n", { mode: 0o600 });
                const reboundDigest = artifactHash(join(temp, "execution-evidence.json"));
                if (!requiredCompleteWithBinding(temp, runId, reboundDigest, wanted)) {
                    this.quarantine(entry, "cached artifact cannot be rebound to the current execution plan");
                    this.accounting.misses++;
                    return null;
                }
                copyContents(temp, targetRunDir);
                writeFileSync(join(targetRunDir, "cache-provenance.json"), JSON.stringify({ schema_version: 1, cache: "content-addressed", run_id: runId, evidence_sha256: reboundDigest, published_evidence_sha256: manifest.evidence_sha256, published: manifest.provenance, materialized_at: new Date().toISOString() }, null, 2) + "\n", { mode: 0o600 });
                this.accounting.hits++;
                return { ...manifest, evidence_sha256: reboundDigest };
            }
            finally {
                rmSync(temp, { recursive: true, force: true });
            }
        }
        finally {
            this.release(ownership.lock, ownership.token);
        }
    }
    publish(runId, runDir, evidenceSha256, workspace, expectedIdentity) {
        if (this.accounting.disabled || !identityValid(expectedIdentity, runId) || !validatedCompleteArtifactDigest(runDir, runId, evidenceSha256, expectedIdentity))
            return false;
        const target = this.entry(runId), ownership = this.acquire(target), parent = dirname(target), staging = target + `.staging-${process.pid}-${randomUUID()}`, journal = target + ".publish.json";
        let journalDurable = false;
        try {
            this.boundary("after-lock-acquired");
            this.recoverPublication(runId);
            if (existsSync(target)) {
                if (!safeTree(target))
                    this.quarantine(target, "existing cache entry is unsafe");
                else {
                    const existing = load(join(target, "cache-manifest.json"));
                    if (existing?.run_id === runId && existing?.artifact_sha256 === artifactHash(join(target, "artifact")))
                        return false;
                    this.quarantine(target, "existing cache entry failed validation during publish");
                }
            }
            mkdirSync(staging, { mode: 0o700 });
            copyContents(runDir, join(staging, "artifact"));
            syncTree(join(staging, "artifact"));
            this.boundary("after-artifact-sync");
            const manifest = { schema_version: 1, run_id: runId, evidence_sha256: evidenceSha256, artifact_sha256: artifactHash(join(staging, "artifact")), created_at: new Date().toISOString(), provenance: { publisher_workspace: resolve(workspace), publisher_run_directory: relative(resolve(workspace), resolve(runDir)), run_identity_sha256: runId } };
            atomic(join(staging, "cache-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
            this.boundary("after-manifest-sync");
            syncDir(staging);
            syncDir(parent);
            this.boundary("after-staging-sync");
            let tx = { schema_version: 1, kind: "evaluation-artifact-cache-publication", run_id: runId, target_directory: target, staging_directory: staging, artifact_sha256: manifest.artifact_sha256, phase: "prepared" };
            atomic(journal, JSON.stringify(tx) + "\n");
            journalDurable = true;
            this.boundary("after-journal-sync");
            renameSync(staging, target);
            this.boundary("after-rename");
            syncDir(parent);
            this.boundary("after-target-parent-sync");
            tx = { ...tx, phase: "renamed" };
            atomic(journal, JSON.stringify(tx) + "\n");
            this.boundary("after-rename-journal-sync");
            tx = { ...tx, phase: "committed" };
            atomic(journal, JSON.stringify(tx) + "\n");
            this.boundary("after-commit-journal-sync");
            rmSync(staging, { recursive: true, force: true });
            this.boundary("after-staging-cleanup");
            rmSync(journal, { force: true });
            syncDir(parent);
            this.boundary("after-journal-delete");
            this.accounting.published++;
            return true;
        }
        finally {
            if (!journalDurable) {
                rmSync(staging, { recursive: true, force: true });
                syncDir(parent);
            }
            this.release(ownership.lock, ownership.token);
        }
    }
}
function requiredCompleteWithBinding(runDir, runId, evidenceSha256, wanted) { const identity = load(join(runDir, "run-identity.json")), manifest = load(join(runDir, "execution-evidence.json")), grading = load(join(runDir, "grading.json")); if (identity?.sha256 !== runId || !manifest || !grading || grading.schema_version !== 2 || grading.authority !== "evaluator" || !existsSync(join(runDir, "outputs", "result.txt")))
    return false; if (!same(Object.fromEntries(Object.keys(wanted).map(k => [k, manifest[k]])), wanted) || artifactHash(join(runDir, "execution-evidence.json")) !== evidenceSha256)
    return false; return same(evidenceArtifactHashes(runDir), manifest.artifact_sha256); }
