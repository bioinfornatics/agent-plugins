import { resolve } from "node:path";
import { validateJudgment } from "../../../domain/judgment.js";
import { Database } from "./sqlite-database.js";
import { authenticatedAttempt, attemptSnapshotDigest, captureAttemptMetadata, evidenceDigest, inspectExistingRegistry } from "./sqlite-verified-attempt.js";
import { validateGradingExtension } from "./grading-schema.js";
export class SqliteJudgmentStore {
    registry;
    constructor(registry) { this.registry = resolve(registry); }
    async appendJudgment(id, attempt, input, options) {
        if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
            throw new Error("Grading ID must be a new UUID");
        const snapshot = authenticatedAttempt(attempt, this.registry);
        if (attemptSnapshotDigest(attempt) !== attemptSnapshotDigest(snapshot.value))
            throw new Error("Verified attempt snapshot was modified");
        if (options !== undefined && (!options || typeof options !== "object" || Object.keys(options).some(key => !["model", "maxTurns", "timeout"].includes(key)) ||
            (options.model !== undefined && typeof options.model !== "string") || (options.maxTurns !== undefined && (!Number.isSafeInteger(options.maxTurns) || options.maxTurns < 1)) ||
            (options.timeout !== undefined && (!Number.isSafeInteger(options.timeout) || options.timeout < 0))))
            throw new Error("Unsafe grading options");
        const request = { ...snapshot.value.request, ...(options === undefined ? {} : { options: { ...options } }) };
        const outcome = validateJudgment(request.criteria, request.artifacts, input.outcome);
        const provenance = input.provenance;
        if (provenance === null && outcome.status !== "technical-error")
            throw new Error("Completed grading requires provenance");
        if (provenance !== null && (!provenance || typeof provenance !== "object" || !provenance.host || typeof provenance.host.id !== "string" ||
            !provenance.model || provenance.model.effective !== "unknown" || provenance.model.source !== (options?.model === undefined ? "configuration-default" : "override") ||
            provenance.model.requested !== options?.model || !provenance.limits || ["maxTurns", "timeout", "preflightTimeout", "exportTimeout", "outputBytes"].some(key => {
            const value = provenance.limits[key];
            return typeof value !== "number" || !Number.isSafeInteger(value) || value < (key === "maxTurns" || key === "outputBytes" ? 1 : 0);
        })))
            throw new Error("Invalid or mismatched judge provenance");
        const result = structuredClone({ outcome, provenance });
        await inspectExistingRegistry(this.registry, true);
        const db = new Database(this.registry, { readwrite: true, create: false });
        try {
            db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
            if (db.query("PRAGMA journal_mode").get()?.journal_mode !== "delete")
                throw new Error("Grading requires DELETE journal mode");
            db.transaction(() => {
                // Revalidate coherent frozen result state after the Judge await, before any
                // extension writes. Retained verified bytes are not reopened or replaced.
                const metadata = captureAttemptMetadata(db, snapshot.value);
                if (JSON.stringify(metadata) !== snapshot.metadata)
                    throw new Error("Verified attempt metadata changed before grading append");
                validateGradingExtension(db, true);
                db.query("INSERT INTO grading_runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, snapshot.value.campaignId, snapshot.value.attemptId, snapshot.value.trialId, new Date().toISOString(), snapshot.value.manifestDigest, snapshot.value.evidenceDigest, evidenceDigest(request), JSON.stringify(request.criteria), JSON.stringify(request), JSON.stringify(metadata.manifest), JSON.stringify(result.provenance), JSON.stringify(outcome), outcome.status);
                if (outcome.status === "completed")
                    for (const judgment of outcome.judgments) {
                        db.query("INSERT INTO judgments VALUES(?,?,?,?,?,?)").run(id, judgment.id, judgment.text, judgment.verdict, judgment.rationale, JSON.stringify(judgment.evidence));
                    }
            }).immediate();
            return { id, result };
        }
        finally {
            db.close();
        }
    }
}
