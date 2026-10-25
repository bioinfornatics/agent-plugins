import { lstatSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
function kindOf(stats) {
    if (stats.isFile())
        return "file";
    if (stats.isDirectory())
        return "directory";
    return "other";
}
function expectedOutcome(kind, expected) {
    if (expected === "any")
        return "match";
    if (kind === "missing")
        return expected === "missing" ? "match" : "missing";
    return kind === expected ? "match" : "mismatch";
}
/**
 * Tests containment without vulnerable string-prefix comparisons. On Windows,
 * comparisons are case-insensitive, matching normal Windows filesystem rules.
 * Paths passed here must already be absolute and normalized for the host OS.
 */
export function isPathWithin(root, candidate) {
    const fold = (value) => process.platform === "win32" ? value.toLowerCase() : value;
    const rel = relative(fold(root), fold(candidate));
    return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
}
function baseResult(lexicalRoot, lexicalPath, expectedKind) {
    return {
        lexicalRoot,
        lexicalPath,
        expectedKind,
        exists: false,
        kind: "missing",
        kindOutcome: expectedOutcome("missing", expectedKind),
    };
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * Resolves a candidate beneath an existing directory and verifies containment
 * twice: first lexically (blocking `..` escapes and prefix collisions), then
 * after native realpath resolution (blocking symlink, junction, and supported
 * reparse-point escapes). The candidate may exist, or its final component may
 * be missing; for a missing final component its parent must already exist.
 *
 * This is a validation primitive, not an atomic filesystem sandbox. A hostile
 * process can replace a checked component between this call and a later open,
 * rename, mkdir, or write (TOCTOU). Missing targets are especially susceptible
 * to their parent being replaced after validation. Callers operating in
 * attacker-writable trees must use descriptor/handle-relative, no-follow OS
 * operations and revalidate opened objects where the platform permits it.
 */
export function resolveContainedPath(rootPath, candidatePath, options = {}) {
    const expectedKind = options.expectedKind ?? "any";
    const lexicalRoot = resolve(rootPath);
    const lexicalPath = isAbsolute(candidatePath) ? resolve(candidatePath) : resolve(lexicalRoot, candidatePath);
    const base = baseResult(lexicalRoot, lexicalPath, expectedKind);
    if (!isPathWithin(lexicalRoot, lexicalPath)) {
        return { ...base, contained: false, status: "lexical-outside", message: "candidate escapes the lexical root" };
    }
    let resolvedRoot;
    try {
        resolvedRoot = realpathSync.native(lexicalRoot);
        if (!statSync(resolvedRoot).isDirectory()) {
            return { ...base, contained: false, status: "invalid-root", resolvedRoot, message: "root is not a directory" };
        }
    }
    catch (error) {
        return { ...base, contained: false, status: "invalid-root", message: errorMessage(error) };
    }
    let exists = true;
    try {
        lstatSync(lexicalPath);
    }
    catch (error) {
        const code = error.code;
        if (code !== "ENOENT") {
            return { ...base, contained: false, status: "filesystem-error", resolvedRoot, message: errorMessage(error) };
        }
        exists = false;
    }
    let resolvedPath;
    let kind;
    try {
        if (exists) {
            resolvedPath = realpathSync.native(lexicalPath);
            kind = kindOf(statSync(resolvedPath));
        }
        else {
            const missingParts = [];
            let existingAncestor = lexicalPath;
            while (existingAncestor !== dirname(existingAncestor)) {
                try {
                    lstatSync(existingAncestor);
                    break;
                }
                catch (error) {
                    if (error.code !== "ENOENT")
                        throw error;
                    missingParts.unshift(existingAncestor.slice(dirname(existingAncestor).length + (dirname(existingAncestor).endsWith(sep) ? 0 : 1)));
                    existingAncestor = dirname(existingAncestor);
                }
            }
            const resolvedParent = realpathSync.native(existingAncestor);
            if (!statSync(resolvedParent).isDirectory()) {
                return { ...base, contained: false, status: "unresolved-parent", resolvedRoot, message: "nearest existing ancestor is not a directory" };
            }
            resolvedPath = resolve(resolvedParent, ...missingParts);
            kind = "missing";
        }
    }
    catch (error) {
        const code = error.code;
        const status = !exists && (code === "ENOENT" || code === "ENOTDIR")
            ? "unresolved-parent"
            : "filesystem-error";
        return { ...base, contained: false, status, resolvedRoot, message: errorMessage(error) };
    }
    const contained = isPathWithin(resolvedRoot, resolvedPath);
    return {
        ...base,
        contained,
        status: contained ? "contained" : "resolved-outside",
        resolvedRoot,
        resolvedPath,
        exists,
        kind,
        kindOutcome: expectedOutcome(kind, expectedKind),
        ...(!contained ? { message: "candidate escapes the resolved root" } : {}),
    };
}
