import { legacyJudgmentPacket } from "../judge/legacy-judgment-packet.js";
import { createHash } from "node:crypto";
import { judgmentPacket } from "../judge/judgment-packet.js";
import { instructionLocation, validateInstructionArtifact, verifyInstructionFile, verifyEvidenceManifest } from "./judge-instruction-files.js";
import { resolve } from "node:path";
import { validateJudgment } from "../../../domain/judgment.js";
import { validateGradingProvenance } from "./grading-provenance.js";
import { serializeGradingJson } from "./grading-serialization.js";
import { Database } from "./sqlite-database.js";
import { authenticatedAttempt, attemptSnapshotDigest, captureAttemptMetadata, evidenceDigest, inspectExistingRegistry } from "./sqlite-verified-attempt.js";
import { validateGradingExtension } from "./grading-schema.js";
export class SqliteJudgmentStore {
    registry;
    constructor(registry) { this.registry = resolve(registry); }
    async prepareInstructions(id, attempt, options) {
        const { snapshot } = this.prepareAppend(id, attempt, options);
        const output = JSON.parse(snapshot.metadata).campaign.output;
        return instructionLocation(output, id, snapshot.value.campaignId, snapshot.value.attemptId);
    }
    /** Immutable serialization must precede allocation/host work, and be rechecked at append. */
    prepareAppend(id, attempt, options) {
        if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
            throw new Error("Grading ID must be a new UUID");
        const snapshot = authenticatedAttempt(attempt, this.registry);
        if (attemptSnapshotDigest(attempt) !== attemptSnapshotDigest(snapshot.value))
            throw new Error("Verified attempt snapshot was modified");
        if (options !== undefined && (!options || typeof options !== "object" || Object.keys(options).some(key => !["model", "maxTurns", "timeout"].includes(key)) ||
            (options.model !== undefined && (typeof options.model !== "string" || !options.model.trim())) || (options.maxTurns !== undefined && (!Number.isSafeInteger(options.maxTurns) || options.maxTurns < 1)) ||
            (options.timeout !== undefined && (!Number.isSafeInteger(options.timeout) || options.timeout < 0 || options.timeout > 2147483))))
            throw new Error("Unsafe grading options");
        const request = { ...snapshot.value.request, ...(options === undefined ? {} : { options: { ...options } }) };
        const immutable = {
            criteria: serializeGradingJson(request.criteria, "criteria"), request: serializeGradingJson(request, "request"),
            manifest: serializeGradingJson(JSON.parse(snapshot.metadata).manifest, "manifest"),
        };
        return { snapshot, request, immutable };
    }
    async appendJudgment(id, attempt, input, options) {
        const { snapshot, request, immutable } = this.prepareAppend(id, attempt, options);
        const outcome = validateJudgment(request.criteria, request.artifacts, input.outcome);
        const provenance = validateGradingProvenance(input.provenance, options, outcome.status === "technical-error");
        if (provenance?.instructionArtifact) {
            const expected = await this.prepareInstructions(id, attempt, options);
            validateInstructionArtifact(provenance.instructionArtifact, expected, provenance.instructionsSha256);
            if (createHash("sha256").update((provenance.packetVersion === 2 ? judgmentPacket(request) : legacyJudgmentPacket(request)).instructions).digest("hex") !== provenance.instructionsSha256)
                throw new Error("Judge instruction packet mismatch");
            if (provenance.packetVersion === 2 && createHash("sha256").update(judgmentPacket(request).bundle.manifest).digest("hex") !== provenance.evidenceManifestSha256)
                throw new Error("Judge manifest packet mismatch");
            await verifyInstructionFile(provenance.instructionArtifact);
            if (provenance.packetVersion === 2)
                await verifyEvidenceManifest(provenance.instructionArtifact, provenance.evidenceManifestSha256 ?? "");
        }
        const result = structuredClone({ outcome, provenance });
        // Freeze and measure all encoded columns before opening SQLite or creating the
        // grading extension. Oversized fields must leave even an ungraded registry intact.
        const encoded = {
            ...immutable,
            provenance: serializeGradingJson(result.provenance, "provenance"), outcome: serializeGradingJson(result.outcome, "outcome"),
            rows: outcome.status === "completed" ? outcome.judgments.map(judgment => ({ judgment, evidence: serializeGradingJson(judgment.evidence, "evidence") })) : [],
        };
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
                db.query("INSERT INTO grading_runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, snapshot.value.campaignId, snapshot.value.attemptId, snapshot.value.trialId, new Date().toISOString(), snapshot.value.manifestDigest, snapshot.value.evidenceDigest, evidenceDigest(request), encoded.criteria, encoded.request, encoded.manifest, encoded.provenance, encoded.outcome, outcome.status);
                for (const { judgment, evidence } of encoded.rows) {
                    db.query("INSERT INTO judgments VALUES(?,?,?,?,?,?)").run(id, judgment.id, judgment.text, judgment.verdict, judgment.rationale, evidence);
                }
            }).immediate();
            return { id, result };
        }
        finally {
            db.close();
        }
    }
}
