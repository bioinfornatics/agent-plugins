import { createHash } from "node:crypto";
import { join, parse, resolve, sep } from "node:path";
import { lstat } from "node:fs/promises";
import { assertSafeFixtureValue, bindFixturePrompt } from "../../../domain/retained-preparation.js";
import { readRegular } from "./campaign-checkpoint.js";
export function preparationDigest(proof) { return createHash("sha256").update(JSON.stringify(proof)).digest("hex"); }
export function preparationLocations(output, id) { assertSafeFixtureValue(output); assertSafeFixtureValue(id); return { candidate: join(output, "trial-data", id, "candidate"), evaluator: join(output, "trial-data", id, "evaluator") }; }
/** Authenticate evaluator-owned seed bytes, not candidate files which tasks may modify.
 * Fake HOME is not a sandbox: this integrity proof detects tampering, not malicious access. */
export async function readPreparation(output, request, receiptJson) {
    if (!request.scenario.preparation)
        return undefined;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.id) || resolve(output) !== output)
        throw new Error("Unsafe preparation identity");
    const digest = receiptJson ? JSON.parse(receiptJson).preparationDigest : undefined;
    if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest))
        throw new Error("Missing preparation provenance");
    const locations = preparationLocations(output, request.id);
    let ancestor = parse(resolve(locations.evaluator)).root;
    for (const part of resolve(locations.evaluator).slice(ancestor.length).split(sep).filter(Boolean)) {
        ancestor = join(ancestor, part);
        const info = await lstat(ancestor);
        if (!info.isDirectory() || info.isSymbolicLink())
            throw new Error("Unsafe preparation directory");
    }
    const proof = JSON.parse((await readRegular(locations.evaluator, "preparation.json", 8 * 1024 * 1024)).toString());
    validatePreparationBinding(proof, output, request, digest);
    let total = 0;
    const seen = new Set();
    for (const entry of proof.manifest) {
        if (!entry || seen.has(entry.path) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 64 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(entry.sha256))
            throw new Error("Invalid seed manifest");
        seen.add(entry.path);
        total += entry.bytes;
        if (total > 256 * 1024 * 1024)
            throw new Error("Seed exceeds bound");
        const bytes = await readRegular(locations.evaluator, `seed/${entry.path}`, 64 * 1024 * 1024);
        if (bytes.length !== entry.bytes || createHash("sha256").update(bytes).digest("hex") !== entry.sha256)
            throw new Error("Seed integrity mismatch");
    }
    return proof;
}
/** Validate retained proof against durable receipt and frozen identity without archive I/O.
 * The receipt digest was authenticated with checkpoint bytes by the verified reader. */
export function validatePreparationBinding(proof, output, request, digest) {
    if (!request.scenario.preparation || typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest))
        throw new Error("Missing preparation provenance");
    const locations = preparationLocations(output, request.id);
    if (preparationDigest(proof) !== digest || proof.schemaVersion !== 1 || proof.provenance !== "synthetic-public-seams-no-model" ||
        JSON.stringify(proof.declaration) !== JSON.stringify(request.scenario.preparation) || JSON.stringify(proof.locations) !== JSON.stringify(locations) ||
        proof.task !== bindFixturePrompt(request.scenario.prompt, request.scenario.preparation, proof.bindings) || !Array.isArray(proof.manifest) || !proof.manifest.length || proof.manifest.length > 10000)
        throw new Error("Invalid preparation provenance");
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const keys = request.scenario.preparation.campaign === "completed" ? ["campaign_id", "new_export_path", "registry_path", "with_attempt_id", "without_attempt_id"] : ["campaign_id", "new_export_path", "registry_path", "with_attempt_id"];
    if (!proof.bindings || Object.keys(proof.bindings).sort().join(",") !== keys.join(",") ||
        proof.bindings.registry_path !== join(locations.candidate, "registry/evaluations.sqlite") || proof.bindings.new_export_path !== join(locations.candidate, "new-export") ||
        !uuid.test(proof.bindings.campaign_id ?? "") || !uuid.test(proof.bindings.with_attempt_id ?? "") ||
        (request.scenario.preparation.campaign === "completed" && (!uuid.test(proof.bindings.without_attempt_id ?? "") || proof.bindings.with_attempt_id === proof.bindings.without_attempt_id)))
        throw new Error("Invalid preparation bindings");
}
