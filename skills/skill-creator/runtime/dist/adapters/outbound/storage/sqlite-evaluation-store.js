import { Database } from "./sqlite-database.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile, lstat } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { prepareRegistryFile, registryDirectory, safeArtifactPath } from "./registry-files.js";
import { canonicalProfileRevision, initializeRegistry, readStoredPlan } from "./registry-schema.js";
import { requestMetadata, verifyCheckpoint } from "./campaign-checkpoint.js";
/** SQLite ownership serializes recovery without a TTL. Only a proven dead local PID permits takeover;
 * PID reuse, EPERM and foreign hosts deliberately fail closed. Filesystem publication precedes DB proof.
 */
export class SqliteEvaluationStore {
    db;
    output;
    campaignId;
    plan;
    token;
    stopped = false;
    completed = false;
    destination;
    registryPath;
    constructor(destination, registryPath) {
        this.destination = destination;
        this.registryPath = registryPath;
    }
    async openRegistry() {
        if (this.db || this.campaignId || this.stopped)
            throw new Error("Store already initialized or closed");
        const registry = await prepareRegistryFile(this.registryPath);
        const db = new Database(registry, { create: false, readwrite: true });
        this.db = db;
        db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
        if (db.query("PRAGMA journal_mode").get()?.journal_mode !== "delete")
            throw new Error("Registry requires DELETE journal mode");
        initializeRegistry(db);
        return registry;
    }
    acquireOwnership(db, id) {
        const owner = db.query("SELECT pid,hostname FROM campaign_owners WHERE campaign_id=?").get(id);
        if (owner) {
            if (owner.hostname !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid <= 0)
                throw new Error("Campaign owned by another or unknown host");
            try {
                process.kill(owner.pid, 0);
                throw new Error("Campaign owned by a live process");
            }
            catch (error) {
                if (!(error && typeof error === "object" && "code" in error && error.code === "ESRCH"))
                    throw error;
            }
        }
        const token = randomUUID();
        db.query("INSERT INTO campaign_owners VALUES(?,?,?,?) ON CONFLICT(campaign_id) DO UPDATE SET pid=excluded.pid,token=excluded.token,hostname=excluded.hostname").run(id, process.pid, token, hostname());
        this.token = token;
    }
    async begin(plan) {
        try {
            const validated = readStoredPlan(JSON.stringify(plan));
            const registry = await this.openRegistry();
            const id = randomUUID();
            const output = join(resolve(this.destination), id);
            await registryDirectory(resolve(this.destination), false);
            await mkdir(output, { mode: 0o700 });
            await registryDirectory(output, true);
            const db = this.db;
            if (!db)
                throw new Error("Store not initialized");
            db.transaction(() => {
                this.insertCampaign(db, id, output, validated);
                for (const [index, trial] of validated.trials.entries())
                    db.query("INSERT INTO planned_trials VALUES(?,?,?,?,?)").run(id, trial.id, index, "pending", null);
                this.acquireOwnership(db, id);
            }).immediate();
            this.campaignId = id;
            this.output = output;
            this.plan = validated;
            return { id, output, registry };
        }
        catch (error) {
            await this.abort();
            throw error;
        }
    }
    async resume(id, retryUncertain) {
        try {
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
                throw new Error("Invalid campaign id");
            const registry = await this.openRegistry();
            const db = this.db;
            if (!db)
                throw new Error("Store not initialized");
            const campaign = db.query("SELECT output,plan_json,profile_id,revision FROM experiments WHERE id=?").get(id);
            if (!campaign?.output || resolve(campaign.output) !== campaign.output)
                throw new Error("Unknown or invalid campaign");
            const plan = readStoredPlan(campaign.plan_json);
            if (plan.profile.id !== campaign.profile_id || plan.profile.revision !== campaign.revision)
                throw new Error("Stored campaign identity mismatch");
            const retained = db.query("SELECT snapshot_json FROM profile_revisions WHERE profile_id=? AND revision=?").get(campaign.profile_id, campaign.revision);
            if (!retained || canonicalProfileRevision(JSON.parse(retained.snapshot_json)) !== canonicalProfileRevision(plan.profile))
                throw new Error("Stored campaign profile content mismatch");
            // Inspect, do not silently recreate missing evidence. No operator source is opened.
            const root = await lstat(campaign.output);
            if (!root.isDirectory() || root.isSymbolicLink())
                throw new Error("Missing or unsafe campaign evidence");
            await registryDirectory(campaign.output, true);
            db.transaction(() => this.acquireOwnership(db, id)).immediate();
            this.campaignId = id;
            this.output = campaign.output;
            this.plan = plan;
            const logical = this.logicalRows();
            if (logical.length !== plan.trials.length || logical.some((row, index) => row.sequence !== index || row.trial_id !== plan.trials[index]?.id))
                throw new Error("Stored logical trial mapping mismatch");
            for (const row of logical) {
                if (row.status === "pending") {
                    if (row.attempt_id !== null)
                        throw new Error("Pending logical trial has an attempt");
                    continue;
                }
                if (!row.attempt_id)
                    throw new Error("Logical trial missing attempt identity");
                const attempt = db.query("SELECT * FROM trials WHERE campaign_id=? AND id=?").get(id, row.attempt_id);
                if (!attempt || attempt.trial_id !== row.trial_id)
                    throw new Error("Logical trial attempt mismatch");
                const request = this.storedRequest(row.sequence, attempt.id);
                if ((!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attempt.id) && attempt.id !== `${id}-${row.sequence + 1}`) ||
                    attempt.pair_id !== request.pairId || attempt.condition !== request.condition || attempt.scenario !== request.scenario.id || attempt.target !== plan.profile.id)
                    throw new Error("Stored attempt identity mismatch");
                if (row.status === "finalized" && attempt.status === "unavailable" && attempt.collection === "unavailable")
                    continue;
                let proof;
                try {
                    proof = await verifyCheckpoint(join(campaign.output, "artifacts", attempt.id), this.checkpoint(request), row.status === "finalized" && attempt.id === `${id}-${row.sequence + 1}` && attempt.receipt_json ? JSON.parse(attempt.receipt_json) : undefined);
                }
                catch (error) {
                    if (row.status === "finalized")
                        throw error;
                    // An existing publication is authoritative evidence, even if corrupt. Retry consent
                    // applies only to absent publications, never to bypassing failed integrity checks.
                    try {
                        await lstat(join(campaign.output, "artifacts", attempt.id));
                    }
                    catch (missing) {
                        if (missing && typeof missing === "object" && "code" in missing && missing.code === "ENOENT") {
                            this.write(() => db.query("UPDATE planned_trials SET status='uncertain' WHERE campaign_id=? AND trial_id=?").run(id, row.trial_id));
                            continue;
                        }
                        throw missing;
                    }
                    throw error;
                }
                if (row.status === "finalized") {
                    if (attempt.receipt_json !== JSON.stringify(proof.receipt) || attempt.status !== proof.receipt.status || attempt.collection !== proof.receipt.collection)
                        throw new Error("Final receipt differs from checkpoint");
                    const indexed = db.query("SELECT path,sha256,bytes FROM artifacts WHERE campaign_id=? AND trial_id=? ORDER BY path").all(id, attempt.id);
                    if (JSON.stringify(indexed) !== JSON.stringify([...proof.manifest].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)))
                        throw new Error("Final manifest differs from registry");
                }
                else
                    this.write(() => this.recordProof(request, proof.receipt, proof.manifest));
            }
            const uncertain = this.logicalRows().filter((row) => row.status === "uncertain");
            if (uncertain.length && !retryUncertain)
                throw new Error("Campaign contains uncertain trials; explicit --retry-uncertain required");
            this.write(() => {
                for (const row of uncertain) {
                    db.query("UPDATE trials SET status='interrupted' WHERE campaign_id=? AND id=?").run(id, row.attempt_id);
                    db.query("UPDATE planned_trials SET status='pending',attempt_id=NULL WHERE campaign_id=? AND trial_id=?").run(id, row.trial_id);
                }
                db.query("UPDATE experiments SET status='running',finished_at=NULL WHERE id=?").run(id);
            });
            const pending = this.logicalRows().filter((row) => row.status === "pending").map((row) => row.trial_id);
            const counts = db.query(`SELECT coalesce(sum(t.status='completed' AND t.collection='complete'),0) AS completed,
        coalesce(sum(NOT(t.status='completed' AND t.collection='complete')),0) AS failed FROM planned_trials p JOIN trials t ON t.campaign_id=p.campaign_id AND t.id=p.attempt_id WHERE p.campaign_id=? AND p.status='finalized'`).get(id);
            return { campaign: { id, output: campaign.output, registry }, plan, pending, completed: counts?.completed ?? 0, failed: counts?.failed ?? 0 };
        }
        catch (error) {
            await this.abort();
            throw error;
        }
    }
    insertCampaign(db, id, output, plan) {
        const now = new Date().toISOString();
        const profile = plan.profile;
        const snapshotJson = canonicalProfileRevision(profile);
        const previous = db.query("SELECT snapshot_json FROM profile_revisions WHERE profile_id=? AND revision=?").get(profile.id, profile.revision);
        if (previous && canonicalProfileRevision(JSON.parse(previous.snapshot_json)) !== snapshotJson)
            throw new Error("Immutable profile revision content conflict");
        db.query("INSERT INTO profiles VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at").run(profile.id, profile.name, now, now);
        db.query("INSERT INTO profile_revisions VALUES(?,?,?,?) ON CONFLICT(profile_id,revision) DO NOTHING").run(profile.id, profile.revision, snapshotJson, now);
        db.query("INSERT INTO experiments VALUES(?,?,?,?,?,?,?,?,?)").run(id, profile.id, profile.revision, now, output, JSON.stringify(plan), "paired-sequential-v1", "running", null);
    }
    async start(request) {
        try {
            this.validateRequest(request);
            this.write(() => {
                const db = this.admittingDatabase();
                const logical = db.query("SELECT * FROM planned_trials WHERE campaign_id=? AND trial_id=?").get(this.campaign(), request.trialId);
                if (logical?.status !== "pending" || logical.attempt_id !== null)
                    throw new Error("Expected pending logical trial");
                db.query("INSERT INTO trials VALUES(?,?,?,?,?,?,?,?,?,?)").run(this.campaign(), request.id, request.pairId, request.condition, request.scenario.id, request.profile.id, "running", "unavailable", null, request.trialId);
                db.query("UPDATE planned_trials SET status='running',attempt_id=? WHERE campaign_id=? AND trial_id=?").run(request.id, this.campaign(), request.trialId);
            });
        }
        catch (error) {
            this.stopped = true;
            throw error;
        }
    }
    async finish(request, result) {
        try {
            this.runningTrial(request);
            this.assertOwnership();
            const root = this.output;
            if (!root)
                throw new Error("Store not initialized");
            const pending = join(root, `${request.id}.pending`);
            const final = join(root, "artifacts", request.id);
            await mkdir(pending, { mode: 0o700 });
            await registryDirectory(pending, true);
            const manifest = [];
            for (const artifact of result.artifacts) {
                safeArtifactPath(artifact.path);
                if (["manifest.json", "checkpoint.json"].includes(artifact.path))
                    throw new Error("Reserved artifact path");
                const path = join(pending, artifact.path);
                await registryDirectory(dirname(path), true);
                this.assertOwnership();
                await writeFile(path, artifact.content, { flag: "wx", mode: 0o600 });
                manifest.push({ path: artifact.path, sha256: createHash("sha256").update(artifact.content).digest("hex"), bytes: artifact.content.length });
            }
            const { artifacts: _artifacts, ...receipt } = result;
            this.assertOwnership();
            await writeFile(join(pending, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: "wx" });
            await writeFile(join(pending, "checkpoint.json"), JSON.stringify(this.checkpoint(request, receipt)), { mode: 0o600, flag: "wx" });
            // Validate our own publication with exactly the verifier used by recovery.
            await verifyCheckpoint(pending, this.checkpoint(request));
            await registryDirectory(dirname(final), true);
            this.assertOwnership();
            await rename(pending, final);
            this.write(() => this.recordProof(request, receipt, manifest));
        }
        catch (error) {
            this.stopped = true;
            throw error;
        }
    }
    recordProof(request, receipt, manifest) {
        const db = this.admittingDatabase();
        const existing = db.query("SELECT path,sha256,bytes FROM artifacts WHERE campaign_id=? AND trial_id=?").all(this.campaign(), request.id);
        for (const artifact of existing)
            if (!manifest.some((entry) => entry.path === artifact.path && entry.sha256 === artifact.sha256 && entry.bytes === artifact.bytes))
                throw new Error("Conflicting indexed artifact");
        for (const artifact of manifest)
            db.query("INSERT INTO artifacts VALUES(?,?,?,?,?) ON CONFLICT(campaign_id,trial_id,path) DO NOTHING").run(this.campaign(), request.id, artifact.path, artifact.sha256, artifact.bytes);
        db.query("UPDATE trials SET status=?,collection=?,receipt_json=? WHERE campaign_id=? AND id=?").run(receipt.status, receipt.collection, JSON.stringify(receipt), this.campaign(), request.id);
        db.query("UPDATE planned_trials SET status='finalized' WHERE campaign_id=? AND trial_id=? AND attempt_id=?").run(this.campaign(), request.trialId, request.id);
    }
    async fail(request) {
        try {
            this.runningTrial(request);
            this.write(() => {
                const db = this.admittingDatabase();
                db.query("UPDATE trials SET status='interrupted',collection='unavailable',receipt_json=? WHERE campaign_id=? AND id=? AND status='running'")
                    .run(JSON.stringify({ error: "Host rejected without a durable result; execution outcome is uncertain; raw diagnostic withheld" }), this.campaign(), request.id);
                db.query("UPDATE planned_trials SET status='uncertain' WHERE campaign_id=? AND trial_id=? AND attempt_id=?").run(this.campaign(), request.trialId, request.id);
            });
        }
        catch (error) {
            this.stopped = true;
            throw error;
        }
    }
    async complete() {
        try {
            this.write(() => {
                const db = this.admittingDatabase();
                const counts = db.query("SELECT count(*) AS total,coalesce(sum(status!='finalized'),0) AS unfinished FROM planned_trials WHERE campaign_id=?").get(this.campaign());
                if (!counts || counts.unfinished || counts.total !== this.plan?.candidateRuns)
                    throw new Error("Campaign trials are not all finalized");
                db.query("UPDATE experiments SET status='completed',finished_at=? WHERE id=?").run(new Date().toISOString(), this.campaign());
            });
            this.completed = true;
        }
        catch (error) {
            this.stopped = true;
            throw error;
        }
    }
    async close() {
        const db = this.db;
        try {
            if (db && this.campaignId && this.token)
                db.transaction(() => {
                    this.assertOwnership();
                    if (!this.completed)
                        db.query("UPDATE experiments SET status='interrupted',finished_at=? WHERE id=? AND status='running'").run(new Date().toISOString(), this.campaign());
                    db.query("DELETE FROM campaign_owners WHERE campaign_id=? AND token=?").run(this.campaign(), this.token ?? "");
                }).immediate();
        }
        finally {
            try {
                db?.close();
            }
            finally {
                this.db = undefined;
                this.token = undefined;
                this.stopped = true;
            }
        }
    }
    async abort() {
        try {
            await this.close();
        }
        catch { /* Preserve the admission/recovery failure, not cleanup diagnostics. */ }
        this.stopped = true;
    }
    assertOwnership() {
        const owner = this.db?.query("SELECT pid,hostname,token FROM campaign_owners WHERE campaign_id=?").get(this.campaign());
        if (!owner || owner.pid !== process.pid || owner.hostname !== hostname() || !this.token || owner.token !== this.token)
            throw new Error("Campaign ownership lost");
    }
    write(operation) {
        const db = this.admittingDatabase();
        db.transaction(() => { this.assertOwnership(); operation(); }).immediate();
    }
    logicalRows() {
        return this.admittingDatabase().query("SELECT * FROM planned_trials WHERE campaign_id=? ORDER BY sequence").all(this.campaign());
    }
    storedRequest(sequence, id) {
        const plan = this.plan;
        const trial = plan?.trials[sequence];
        const scenario = plan?.profile.scenarios.find((entry) => entry.id === trial?.scenario);
        if (!plan || !trial || !scenario)
            throw new Error("Stored logical trial is invalid");
        return { id, trialId: trial.id, pairId: trial.pairId, agent: trial.agent, condition: trial.condition, profile: plan.profile, scenario, options: plan.options };
    }
    checkpoint(request, receipt) {
        return { schemaVersion: 1, campaignId: this.campaign(), attemptId: request.id, trialId: request.trialId,
            request: requestMetadata(request), receipt: receipt ?? {} };
    }
    campaign() {
        if (!this.campaignId)
            throw new Error("Store not initialized");
        return this.campaignId;
    }
    admittingDatabase() {
        if (!this.db || !this.campaignId)
            throw new Error("Store not initialized");
        if (this.stopped || this.completed)
            throw new Error("Campaign no longer admits writes");
        return this.db;
    }
    validateRequest(request) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.id))
            throw new Error("Unsafe attempt id; expected UUID");
        const trial = this.plan?.trials.find((entry) => entry.id === request.trialId);
        const scenario = this.plan?.profile.scenarios.find((entry) => entry.id === trial?.scenario);
        if (!trial || request.profile.id !== this.plan?.profile.id || request.profile.revision !== this.plan.profile.revision ||
            trial.pairId !== request.pairId || trial.condition !== request.condition || trial.scenario !== request.scenario.id || trial.agent !== request.agent ||
            JSON.stringify(request.profile) !== JSON.stringify(this.plan.profile) || JSON.stringify(request.scenario) !== JSON.stringify(scenario) || JSON.stringify(request.options) !== JSON.stringify(this.plan.options))
            throw new Error("Trial does not match stored campaign plan");
    }
    runningTrial(request) {
        const db = this.admittingDatabase();
        this.validateRequest(request);
        this.assertOwnership();
        const trial = db.query("SELECT status,trial_id FROM trials WHERE campaign_id=? AND id=?").get(this.campaign(), request.id);
        const logical = db.query("SELECT * FROM planned_trials WHERE campaign_id=? AND trial_id=?").get(this.campaign(), request.trialId);
        if (trial?.status !== "running" || trial.trial_id !== request.trialId || logical?.status !== "running" || logical.attempt_id !== request.id)
            throw new Error("Expected an owned running trial");
        return db;
    }
}
