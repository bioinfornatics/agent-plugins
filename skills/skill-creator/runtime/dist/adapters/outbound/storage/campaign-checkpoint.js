import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { safeArtifactPath } from "./registry-files.js";
export function requestMetadata(request) {
    return { agent: request.agent, pairId: request.pairId, condition: request.condition, scenario: request.scenario.id,
        profileId: request.profile.id, revision: request.profile.revision, options: request.options };
}
/** Bounds prevent hostile metadata/files exhausting recovery; NOFOLLOW plus inode checks reject links.
 * Ancestor checks still do not constitute a sandbox against malicious concurrent directory replacement. */
async function readRegular(root, path, limit) {
    safeArtifactPath(path);
    let current = root;
    for (const part of path.split("/").slice(0, -1)) {
        current = join(current, part);
        const info = await lstat(current);
        if (!info.isDirectory() || info.isSymbolicLink())
            throw new Error("Unsafe checkpoint directory");
    }
    const file = join(root, path);
    const before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > limit)
        throw new Error("Unsafe or oversized checkpoint file");
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const info = await handle.stat();
        if (info.ino !== before.ino || info.dev !== before.dev || !info.isFile() || info.nlink !== 1 || info.size > limit)
            throw new Error("Checkpoint file changed");
        // Read at most limit+1 even if the file grows after stat.
        const bytes = Buffer.alloc(Math.min(info.size + 1, limit + 1));
        let offset = 0;
        while (offset < bytes.length) {
            const read = await handle.read(bytes, offset, bytes.length - offset, offset);
            if (!read.bytesRead)
                break;
            offset += read.bytesRead;
        }
        if (offset !== info.size)
            throw new Error("Checkpoint file changed during read");
        return bytes.subarray(0, offset);
    }
    finally {
        await handle.close();
    }
}
export async function verifyCheckpoint(root, expected, legacyReceipt) {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("Unsafe checkpoint root");
    // V1 finalized attempts predate checkpoint.json; their indexed receipt and manifest are still
    // verified. This exception is never used for running attempts or newly assigned UUID attempts.
    const checkpoint = legacyReceipt ? { ...expected, receipt: legacyReceipt } : JSON.parse((await readRegular(root, "checkpoint.json", 8 * 1024 * 1024)).toString());
    if (checkpoint.schemaVersion !== 1 || checkpoint.campaignId !== expected.campaignId || checkpoint.attemptId !== expected.attemptId ||
        checkpoint.trialId !== expected.trialId || JSON.stringify(checkpoint.request) !== JSON.stringify(expected.request))
        throw new Error("Checkpoint identity mismatch");
    const receipt = checkpoint.receipt;
    if (!receipt || !["completed", "nonzero", "timeout"].includes(receipt.status) || !["complete", "partial", "unavailable"].includes(receipt.collection) ||
        !(receipt.exitCode === null || Number.isInteger(receipt.exitCode)) || typeof receipt.sessionName !== "string" ||
        typeof receipt.startedAt !== "string" || typeof receipt.finishedAt !== "string" || !receipt.host ||
        typeof receipt.host.id !== "string" || typeof receipt.host.version !== "string" || !Array.isArray(receipt.limitations) ||
        receipt.limitations.some((value) => typeof value !== "string") || "artifacts" in receipt)
        throw new Error("Invalid checkpoint receipt");
    const manifest = JSON.parse((await readRegular(root, "manifest.json", 8 * 1024 * 1024)).toString());
    if (!Array.isArray(manifest) || manifest.length > 10000)
        throw new Error("Invalid checkpoint manifest");
    const paths = new Set();
    let total = 0;
    for (const artifact of manifest) {
        if (!artifact || typeof artifact.path !== "string" || ["checkpoint.json", "manifest.json"].includes(artifact.path) || paths.has(artifact.path) ||
            !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0 || artifact.bytes > 64 * 1024 * 1024)
            throw new Error("Invalid checkpoint artifact");
        paths.add(artifact.path);
        total += artifact.bytes;
        if (total > 256 * 1024 * 1024)
            throw new Error("Checkpoint evidence exceeds recovery bound");
        const bytes = await readRegular(root, artifact.path, 64 * 1024 * 1024);
        if (bytes.length !== artifact.bytes || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256)
            throw new Error("Checkpoint artifact integrity mismatch");
    }
    return { receipt, manifest };
}
