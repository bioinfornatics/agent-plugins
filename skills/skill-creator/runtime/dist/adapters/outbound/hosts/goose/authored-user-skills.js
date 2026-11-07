import { createHash } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { FILE_LIMIT, TREE_LIMIT, missing, noLinks, regularFile, walk } from "./private-files.js";
const ENTRY_LIMIT = 20000;
const changedMessage = "Existing user Skill changed during execution";
function countEntry(budget) {
    if (++budget.entries > ENTRY_LIMIT)
        throw new Error("User Skill tree entry limit exceeded");
}
async function readBounded(path, budget) {
    const bytes = await regularFile(path, FILE_LIMIT);
    budget.bytes += bytes.length;
    if (budget.bytes > TREE_LIMIT)
        throw new Error("User Skill evidence aggregate limit exceeded");
    return bytes;
}
/** Missing roots are valid only after checking every existing private ancestor for links. */
async function skillRoots(home, budget) {
    const root = join(home, ".agents", "skills");
    try {
        await noLinks(root);
    }
    catch (error) {
        if (missing(error))
            return [];
        throw error;
    }
    if (!(await lstat(root)).isDirectory())
        throw new Error("Expected a user Skills directory");
    const names = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
        countEntry(budget);
        const path = join(root, entry.name);
        await noLinks(path);
        if (!(await lstat(path)).isDirectory())
            throw new Error("Expected an immediate user Skill directory");
        names.push(entry.name);
    }
    return names.sort();
}
async function hashes(root, budget) {
    const files = new Map();
    await walk(root, async (path, name) => {
        files.set(name, createHash("sha256").update(await readBounded(path, budget)).digest("hex"));
    }, () => { countEntry(budget); return false; });
    return files;
}
/** Snapshot the caller's private trial HOME after treatment installation; no source/live HOME lookup. */
export async function snapshotUserSkills(home) {
    const budget = { entries: 0, bytes: 0 };
    const snapshot = new Map();
    for (const name of await skillRoots(home, budget))
        snapshot.set(name, await hashes(join(home, ".agents", "skills", name), budget));
    return snapshot;
}
function privateEntry(name) {
    return [".git", ".agents", ".config", "node_modules", "config.yaml", "secrets.yaml", "permission.yaml", "tool_permissions.json"].includes(name) || /^\.env(?:\.|$)/.test(name);
}
/** Validate every installed root before visiting only newly authored immediate Skill directories.
 * Baseline trees are unfiltered, so adding files (even private config) cannot export treatment.
 * Shared budgets include roots, excluded entries and validation reads across all Skills.
 * Like private-files, link checks are observational, not an OS sandbox or race-free snapshot.
 */
export async function collectAuthoredUserSkills(home, baseline, visit) {
    const budget = { entries: 0, bytes: 0 };
    let names;
    try {
        names = await skillRoots(home, budget);
    }
    catch (error) {
        if (baseline.size)
            throw new Error(changedMessage);
        throw error;
    }
    const root = join(home, ".agents", "skills");
    for (const [name, before] of baseline) {
        try {
            if (!names.includes(name))
                throw new Error(changedMessage);
            const after = await hashes(join(root, name), budget);
            if (after.size !== before.size || [...before].some(([path, hash]) => after.get(path) !== hash))
                throw new Error(changedMessage);
        }
        catch {
            throw new Error(changedMessage);
        }
    }
    for (const name of names) {
        if (baseline.has(name) || privateEntry(name))
            continue;
        await walk(join(root, name), async (path, relative) => {
            await readBounded(path, budget);
            await visit(path, `${name}/${relative.split(sep).join("/")}`);
        }, (entry) => { countEntry(budget); return privateEntry(entry); });
    }
}
