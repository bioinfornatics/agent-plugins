import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { resolveContainedPath } from "./path_containment.js";
const EXCLUDED_PARTS = new Set([".git", ".hg", ".svn", ".beads", "__pycache__", "node_modules"]);
const ROOT_INCLUDED_HIDDEN_PARTS = new Set([".vscode"]);
const ROOT_EXCLUDED_PARTS = new Set(["evaluations"]);
const EXCLUDED_SUFFIXES = new Set([".pyc", ".pyo"]);
export function shouldExcludePackagePath(path, rootArg, profile = "authoring") {
    const root = resolve(rootArg);
    const rel = relative(root, resolve(path));
    if (!rel || rel === ".." || rel.startsWith(".." + sep))
        return false;
    const parts = rel.split(sep);
    if (ROOT_EXCLUDED_PARTS.has(parts[0]) || (parts[0].startsWith(".") && !ROOT_INCLUDED_HIDDEN_PARTS.has(parts[0])))
        return true;
    if (parts.some((part, index) => EXCLUDED_PARTS.has(part) && !(part === "node_modules" && parts[index - 1] === "vendor")))
        return true;
    const suffix = parts.at(-1)?.match(/\.[^.]+$/)?.[0] ?? "";
    if (EXCLUDED_SUFFIXES.has(suffix))
        return true;
    if (profile !== "release")
        return false;
    // A release is intentionally selected from the validated authoring tree. Keep
    // portable declarations and resources, but remove inputs needed only to build
    // or test the native executables. Do not use a blanket *.ts exclusion: emitted
    // contract declarations in dist/*.d.ts are part of the public format surface.
    if (parts.includes("tests"))
        return true;
    if (parts.some((part, index) => part === "node_modules" && parts[index - 1] === "vendor"))
        return true;
    if (/^tsconfig(?:\.[^.]+)?\.json$/.test(parts.at(-1) ?? ""))
        return true;
    if (parts[0] === "skills" && parts.length >= 3) {
        if (parts[2] === "scripts")
            return true;
        if (suffix === ".ts" && !parts.at(-1)?.endsWith(".d.ts"))
            return true;
    }
    if (parts[0] === "tests" || parts[0] === "scripts")
        return true;
    if (parts[0] === "contracts" && parts[1] === "capability-contract" && ["src", "tests", "scripts"].includes(parts[2] ?? ""))
        return true;
    return false;
}
function containmentError(path, root, result, expected) {
    const rel = relative(root, path) || ".";
    if (!result.contained)
        return new Error(`package path escapes plugin root (${result.status}): ${rel}`);
    if (result.kindOutcome === "missing")
        return new Error(`package path is missing: ${rel}`);
    return new Error(`package path has wrong kind (expected ${expected}, found ${result.kind}): ${rel}`);
}
function requireContained(root, path, expected) {
    const result = resolveContainedPath(root, path, { expectedKind: expected });
    if (!result.contained || result.kindOutcome !== "match")
        throw containmentError(path, root, result, expected);
    return result;
}
export function collectPackageFiles(rootArg, omitted = [], profile = "authoring") {
    const lexicalRoot = resolve(rootArg);
    const rootCheck = resolveContainedPath(lexicalRoot, lexicalRoot, { expectedKind: "directory" });
    if (!rootCheck.contained || rootCheck.kindOutcome !== "match")
        throw containmentError(lexicalRoot, lexicalRoot, rootCheck, "directory");
    const root = rootCheck.resolvedPath;
    const omittedSet = new Set(omitted.map(path => resolve(path)));
    const files = [];
    const visited = new Set();
    function walk(directory) {
        const directoryCheck = requireContained(root, directory, "directory");
        const resolvedDirectory = directoryCheck.resolvedPath;
        if (visited.has(resolvedDirectory))
            throw new Error("package directory cycle detected: " + relative(root, directory));
        visited.add(resolvedDirectory);
        for (const name of readdirSync(resolvedDirectory).sort()) {
            const path = resolve(resolvedDirectory, name);
            if (shouldExcludePackagePath(path, root, profile) || omittedSet.has(path))
                continue;
            const rel = relative(root, path);
            if (!rel || rel === ".." || rel.startsWith(".." + sep))
                throw new Error("package path escapes plugin root: " + path);
            // Containment is checked before inspecting or reading every discovered entry.
            const containment = resolveContainedPath(root, path, { expectedKind: "any" });
            const stat = lstatSync(path);
            // Packaging is intentionally stricter than validation: links are never release artifacts.
            if (stat.isSymbolicLink())
                throw new Error("symbolic links are not allowed in packages: " + rel);
            if (!containment.contained || containment.kindOutcome !== "match")
                throw containmentError(path, root, containment, "any");
            if (containment.kind === "directory") {
                walk(path);
            }
            else if (containment.kind === "file") {
                const fileCheck = requireContained(root, path, "file");
                files.push({
                    absolute: fileCheck.resolvedPath,
                    relative: rel.split(sep).join("/"),
                    sha256: createHash("sha256").update(readFileSync(fileCheck.resolvedPath)).digest("hex"),
                    mode: stat.mode & 0o777,
                });
            }
            else {
                throw new Error("unsupported filesystem entry in package: " + rel);
            }
        }
    }
    walk(root);
    return files.sort((a, b) => a.relative.localeCompare(b.relative));
}
export function sourceHash(root, omitted = []) {
    const hash = createHash("sha256");
    for (const file of collectPackageFiles(root, omitted)) {
        hash.update(file.relative);
        hash.update("\0");
        hash.update(file.sha256);
        hash.update("\n");
    }
    return hash.digest("hex");
}
