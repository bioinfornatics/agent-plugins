import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { join, parse, resolve, sep } from "node:path";
import { validateGradingJsonBytes } from "./grading-serialization.js";
import { Database } from "./sqlite-database.js";
import { canonicalProfileRevision, readStoredPlan } from "./registry-schema.js";
import { requestMetadata, verifyCheckpoint } from "./campaign-checkpoint.js";
import { validateGradingExtension } from "./grading-schema.js";
import { safeArtifactPath } from "./registry-files.js";
const snapshots = new WeakMap();
export function authenticatedAttempt(attempt, registry) {
    const snapshot = snapshots.get(attempt);
    if (!snapshot || snapshot.registry !== resolve(registry))
        throw new Error("Unverified attempt snapshot");
    return { ...snapshot, value: structuredClone(snapshot.value) };
}
export function evidenceDigest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function attemptSnapshotDigest(attempt) {
    const { artifacts, ...metadata } = attempt;
    const hash = createHash("sha256").update(JSON.stringify(metadata));
    for (const artifact of artifacts) {
        hash.update(JSON.stringify([artifact.path, artifact.sha256, artifact.content.length]));
        hash.update(artifact.content);
    }
    return hash.digest("hex");
}
export async function inspectExistingPath(path) {
    const absolute = resolve(path);
    let current = parse(absolute).root;
    for (const part of absolute.slice(current.length).split(sep).filter(Boolean)) {
        current = join(current, part);
        const info = await lstat(current);
        if (info.isSymbolicLink())
            throw new Error("Unsafe evidence/registry parent path");
        if (current !== absolute && !info.isDirectory())
            throw new Error("Unsafe evidence/registry parent directory");
    }
}
/** Existing-only inspection, shared by readonly verification and explicit append. Never
 * creates/chmods directories or a DB. WAL sidecars are outside the retained registry contract. */
export async function inspectExistingRegistry(registry, write) {
    await inspectExistingPath(registry);
    const info = await lstat(registry);
    if (!info.isFile() || info.nlink !== 1 || (write && ((info.mode & 0o777) !== 0o600 || (process.getuid && info.uid !== process.getuid()))))
        throw new Error("Unsafe registry file");
    for (const suffix of ["-journal", "-wal", "-shm"]) {
        let sidecar;
        try {
            sidecar = await lstat(`${registry}${suffix}`);
        }
        catch (error) {
            if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
                continue;
            throw error;
        }
        if (!sidecar.isFile() || sidecar.isSymbolicLink() || sidecar.nlink !== 1 || (sidecar.mode & 0o777) !== 0o600)
            throw new Error("Unsafe registry sidecar");
        if (suffix !== "-journal")
            throw new Error("WAL registries are unsupported");
    }
}
export function validatePrincipalRegistry(db) {
    if (db.query("PRAGMA user_version").get()?.user_version !== 2)
        throw new Error("Verified attempts require registry schema v2");
    const tables = {
        profiles: "id,name,created_at,updated_at", profile_revisions: "profile_id,revision,snapshot_json,created_at",
        experiments: "id,profile_id,revision,created_at,output,plan_json,method,status,finished_at",
        planned_trials: "campaign_id,trial_id,sequence,status,attempt_id", trials: "campaign_id,id,pair_id,condition,scenario,target,status,collection,receipt_json,trial_id",
        artifacts: "campaign_id,trial_id,path,sha256,bytes", campaign_owners: "campaign_id,pid,token,hostname",
    };
    for (const [table, columns] of Object.entries(tables)) {
        if (db.query(`PRAGMA table_info(${table})`).all().map(row => row.name).join(",") !== columns)
            throw new Error("Malformed principal registry");
    }
    if (db.query("PRAGMA foreign_key_check").all().length)
        throw new Error("Invalid registry relationships");
}
/** Capture all metadata in one synchronous SQLite read snapshot. Never hold a transaction
 * across filesystem awaits, and never acquire campaign ownership or repair candidate state. */
export function captureAttemptMetadata(db, selection) {
    validatePrincipalRegistry(db);
    validateGradingExtension(db, false);
    const campaign = db.query("SELECT profile_id,revision,plan_json,output FROM experiments WHERE id=?").get(selection.campaignId);
    if (!campaign || resolve(campaign.output) !== campaign.output)
        throw new Error("Unknown or invalid campaign");
    const retained = db.query("SELECT snapshot_json FROM profile_revisions WHERE profile_id=? AND revision=?").get(campaign.profile_id, campaign.revision);
    // Captured production profiles are bounded to 64 MiB raw bytes. Base64 plus
    // metadata fits this ceiling; reject hostile indexed JSON before parsing it.
    validateGradingJsonBytes(campaign.plan_json, "plan");
    if (retained)
        validateGradingJsonBytes(retained.snapshot_json, "snapshot");
    const plan = readStoredPlan(campaign.plan_json);
    if (plan.profile.id !== campaign.profile_id || plan.profile.revision !== campaign.revision || !retained || canonicalProfileRevision(JSON.parse(retained.snapshot_json)) !== canonicalProfileRevision(plan.profile))
        throw new Error("Stored campaign profile content/identity mismatch");
    const attempt = db.query("SELECT trial_id,pair_id,condition,scenario,target,status,collection,receipt_json FROM trials WHERE campaign_id=? AND id=?").get(selection.campaignId, selection.attemptId);
    if (!attempt || !["completed", "nonzero", "timeout"].includes(attempt.status) || !attempt.receipt_json)
        throw new Error("Explicit finalized attempt required");
    validateGradingJsonBytes(attempt.receipt_json, "receipt");
    const logical = db.query("SELECT * FROM planned_trials WHERE campaign_id=? ORDER BY sequence").all(selection.campaignId);
    if (logical.length !== plan.trials.length || logical.some((row, index) => row.sequence !== index || row.trial_id !== plan.trials[index]?.id))
        throw new Error("Logical trial mapping mismatch");
    const row = logical.find(entry => entry.trial_id === attempt.trial_id);
    if (row?.status !== "finalized" || row.attempt_id !== selection.attemptId)
        throw new Error("Explicit finalized logical attempt required");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selection.attemptId) && selection.attemptId !== `${selection.campaignId}-${row.sequence + 1}`)
        throw new Error("Unsafe attempt identity");
    const trial = plan.trials[row.sequence];
    const scenario = plan.profile.scenarios.find(entry => entry.id === trial?.scenario);
    if (!trial || !scenario || attempt.pair_id !== trial.pairId || attempt.condition !== trial.condition || attempt.scenario !== trial.scenario || attempt.target !== plan.profile.id)
        throw new Error("Stored attempt identity mismatch");
    const request = { id: selection.attemptId, trialId: trial.id, pairId: trial.pairId, agent: trial.agent, condition: trial.condition, profile: plan.profile, scenario, options: plan.options };
    const manifest = db.query("SELECT path,sha256,bytes FROM artifacts WHERE campaign_id=? AND trial_id=? ORDER BY path").all(selection.campaignId, selection.attemptId);
    let totalBytes = 0;
    if (manifest.length > 10000)
        throw new Error("Registry manifest exceeds bound");
    for (const entry of manifest) {
        safeArtifactPath(entry.path);
        if (!/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 64 * 1024 * 1024)
            throw new Error("Invalid registry manifest");
        totalBytes += entry.bytes;
    }
    if (totalBytes > 256 * 1024 * 1024)
        throw new Error("Registry evidence exceeds bound");
    return { campaign, retained, attempt, logical, request, manifest };
}
export class SqliteVerifiedAttemptReader {
    registry;
    constructor(registry) { this.registry = resolve(registry); }
    async readAttempt(selection) {
        if (!selection || typeof selection.campaignId !== "string" || typeof selection.attemptId !== "string")
            throw new Error("Explicit attempt selection required");
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selection.campaignId))
            throw new Error("Invalid campaign identity");
        safeArtifactPath(selection.attemptId);
        // Detach selectors before the first await; callers cannot redirect verified data.
        selection = { campaignId: selection.campaignId, attemptId: selection.attemptId };
        await inspectExistingRegistry(this.registry, false);
        const db = new Database(this.registry, { readonly: true, create: false });
        let metadata;
        try {
            db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN;");
            metadata = captureAttemptMetadata(db, selection);
            db.exec("COMMIT;");
        }
        finally {
            db.close();
        }
        const { campaign, request, attempt, manifest } = metadata;
        const root = join(campaign.output, "artifacts", selection.attemptId);
        await inspectExistingPath(root);
        const expected = { schemaVersion: 1, ...selection, trialId: request.trialId, request: requestMetadata(request), receipt: JSON.parse(attempt.receipt_json ?? "null") };
        const sequence = metadata.logical.find(row => row.trial_id === request.trialId)?.sequence;
        const legacy = sequence !== undefined && selection.attemptId === `${selection.campaignId}-${sequence + 1}`;
        const proof = await verifyCheckpoint(root, expected, legacy ? expected.receipt : undefined, { retainBytes: true });
        if (JSON.stringify(proof.receipt) !== attempt.receipt_json || proof.receipt.status !== attempt.status || proof.receipt.collection !== attempt.collection)
            throw new Error("Final receipt differs from checkpoint");
        const sorted = [...proof.manifest].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
        if (JSON.stringify(sorted) !== JSON.stringify(manifest))
            throw new Error("Final manifest differs from registry");
        const artifacts = proof.artifacts ?? [];
        const judgeArtifacts = artifacts.map(({ path, sha256, content }) => {
            try {
                const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content);
                if (content.some(byte => (byte < 32 && ![9, 10, 13].includes(byte)) || byte === 127))
                    throw new Error("Nontext control bytes");
                return { path, sha256, kind: "text", text };
            }
            catch {
                return { path, sha256, kind: "nontext" };
            }
        });
        const value = { ...selection, trialId: request.trialId, manifestDigest: evidenceDigest(manifest), evidenceDigest: evidenceDigest(metadata),
            request: { task: request.scenario.prompt, ...(request.scenario.expectedOutput === undefined ? {} : { expectedOutput: request.scenario.expectedOutput }), criteria: request.scenario.expectations.map((text, index) => ({ id: `criterion-${index + 1}`, text })), artifacts: judgeArtifacts }, artifacts };
        const view = structuredClone(value);
        snapshots.set(view, { registry: this.registry, metadata: JSON.stringify(metadata), value });
        return view;
    }
}
