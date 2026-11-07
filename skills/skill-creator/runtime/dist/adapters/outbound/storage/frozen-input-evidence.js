import { createHash } from "node:crypto";
import { safeInputPath } from "../../../domain/scenario-import.js";
/** Project only frozen plan bytes, never the mutable source/workspace. Preflight the
 * whole snapshot before decoding: malformed legacy fixture snapshots need the same
 * bounds as declared inputs. The inputs namespace is reserved even for empty snapshots.
 */
export function frozenInputEvidence(files, archive) {
    if (archive.some(entry => entry.path === "inputs" || entry.path.startsWith("inputs/")))
        throw new Error("Archived inputs namespace collision");
    if (files === undefined)
        return [];
    if (!Array.isArray(files) || files.length > 20_000)
        throw new Error("Frozen inputs exceed entry bound");
    const paths = new Set();
    let total = 0;
    for (const file of files) {
        if (!file || typeof file.path !== "string" || !safeInputPath(file.path) || paths.has(file.path))
            throw new Error("Unsafe or duplicate frozen input path");
        paths.add(file.path);
        if (typeof file.content !== "string" || typeof file.executable !== "boolean" || file.content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.content))
            throw new Error("Invalid frozen input base64");
        const bytes = file.content.length / 4 * 3 - (file.content.endsWith("==") ? 2 : file.content.endsWith("=") ? 1 : 0);
        total += bytes;
        if (bytes > 4 * 1024 * 1024 || total > 64 * 1024 * 1024)
            throw new Error("Frozen inputs exceed byte bound");
    }
    for (const path of paths) {
        const parts = path.split("/");
        for (let length = 1; length < parts.length; length++)
            if (paths.has(parts.slice(0, length).join("/")))
                throw new Error("Frozen input ancestor collision");
    }
    return [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(file => {
        const content = Buffer.from(file.content, "base64");
        // Node's permissive decoder accepts nonzero padding bits; only canonical base64
        // can bind a stored snapshot deterministically across ingestion and history.
        if (content.toString("base64") !== file.content)
            throw new Error("Noncanonical frozen input base64");
        const path = `inputs/${file.path}`, sha256 = createHash("sha256").update(content).digest("hex");
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
}
