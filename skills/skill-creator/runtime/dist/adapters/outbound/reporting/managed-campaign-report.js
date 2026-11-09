import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, rename, rmdir, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { exportLimits } from "../../../application/ports/export-writer.js";
import { inspectExistingPath } from "../storage/sqlite-verified-attempt.js";
import { safeArtifactPath } from "../storage/registry-files.js";
const missing = (e) => !!e && typeof e === "object" && "code" in e && e.code === "ENOENT";
const within = (p, root) => p === root || p.startsWith(`${root}${sep}`);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function exists(path) {
    try {
        await lstat(path);
        return true;
    }
    catch (e) {
        if (missing(e))
            return false;
        throw e;
    }
}
const owned = (info) => process.getuid === undefined || info.uid === process.getuid();
async function plainBytes(path, maximum = exportLimits.jsonBytes) {
    await inspectExistingPath(dirname(path));
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || !owned(before) || (before.mode & 0o777) !== 0o600 || before.size > maximum)
        throw new Error("Unsafe report file mode/type/size");
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const info = await handle.stat();
        if (info.dev !== before.dev || info.ino !== before.ino || !info.isFile() || info.nlink !== 1 || !owned(info) || (info.mode & 0o777) !== 0o600 || info.size > maximum)
            throw new Error("Unsafe report file mode/type/size");
        const bytes = await handle.readFile(), current = await lstat(path);
        if (current.dev !== info.dev || current.ino !== info.ino || current.isSymbolicLink() || !owned(current) || (current.mode & 0o777) !== 0o600 || current.nlink !== 1 || bytes.length > maximum)
            throw new Error("Report file identity changed");
        return bytes;
    }
    finally {
        await handle.close();
    }
}
function exactJson(actual, expected) {
    if (!actual || typeof actual !== "object" || Array.isArray(actual))
        return false;
    return JSON.stringify(Object.entries(actual).sort()) === JSON.stringify(Object.entries(expected).sort());
}
/** Authenticate complete inventory before replacement or bounded cleanup. Unknown
 * paths, changed hashes, links and executable/public modes are never adopted. */
async function authenticateExport(root, campaignId, location) {
    await inspectExistingPath(root);
    const manifest = JSON.parse((await plainBytes(join(root, "export-manifest.json"))).toString());
    if (manifest.schemaVersion !== 1 || manifest.status !== "complete" || manifest.campaignId !== campaignId || !exactJson(manifest.reportLocation, location) || !Array.isArray(manifest.files) || manifest.files.length > 200000)
        throw new Error("Invalid managed export manifest");
    const expected = new Map();
    const directories = new Set([""]);
    let total = 0;
    for (const file of manifest.files) {
        if (!file || typeof file.path !== "string")
            throw new Error("Invalid export inventory");
        safeArtifactPath(file.path);
        if (file.path === "export-manifest.json" || file.path === ".export-pending" || expected.has(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256))
            throw new Error("Invalid export inventory");
        total += file.bytes;
        if (total > exportLimits.totalBytes)
            throw new Error("Export inventory byte bound");
        expected.set(file.path, file);
        const parts = file.path.split("/");
        parts.pop();
        while (parts.length) {
            directories.add(parts.join("/"));
            parts.pop();
        }
    }
    const identities = [];
    const seen = new Set();
    async function walk(relative) {
        const path = join(root, relative), info = await lstat(path);
        if (info.isSymbolicLink())
            throw new Error("Unsafe export inventory symlink");
        identities.push({ path, dev: info.dev, ino: info.ino, directory: info.isDirectory() });
        if (info.isDirectory()) {
            if (!owned(info) || !directories.has(relative) || (info.mode & 0o777) !== 0o700)
                throw new Error("Unknown export inventory directory/mode");
            for (const name of await readdir(path))
                await walk(relative ? `${relative}/${name}` : name);
        }
        else {
            if (relative === "export-manifest.json") {
                await plainBytes(path);
                return;
            }
            const file = expected.get(relative);
            if (!file)
                throw new Error("Unknown export inventory file");
            const bytes = await plainBytes(path, file.bytes);
            if (bytes.length !== file.bytes || sha(bytes) !== file.sha256)
                throw new Error("Tampered export inventory bytes");
            seen.add(relative);
        }
    }
    await walk("");
    if (seen.size !== expected.size)
        throw new Error("Missing export inventory file");
    return { identities, manifest };
}
async function removeAuthenticated(inventory, beforeRemoval = async () => { }) {
    for (const item of [...inventory.identities].reverse()) {
        const info = await lstat(item.path);
        if (info.dev !== item.dev || info.ino !== item.ino || info.isSymbolicLink())
            throw new Error("Report cleanup identity changed");
        await beforeRemoval(item.path);
        if (item.directory)
            await rmdir(item.path);
        else
            await unlink(item.path);
    }
}
/** Locked ordinary-failure replacement of one derived export, not a filesystem
 * sandbox or crash-atomic transaction. Old review.html remains for the separate
 * HTML helper to regenerate; stale locks/backups require operator inspection. */
export async function publishManagedCampaignReport(context, files, roots, registry, publishExclusive, beforeReplacementRename = async () => { }, beforeCleanup = async () => { }) {
    const campaign = context.campaignDirectory;
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(context.campaignId) || !isAbsolute(campaign) || resolve(campaign) !== campaign || !roots.includes(campaign))
        throw new Error("Invalid authoritative campaign report context");
    await inspectExistingPath(campaign);
    if (!(await lstat(campaign)).isDirectory())
        throw new Error("Campaign output must be an existing directory");
    const report = join(campaign, "report"), output = join(report, "export");
    // Only campaign ancestry and the private registry's containing ancestry receive
    // an exception. Descendant source/evidence/registry paths remain protected.
    for (const { root, registryAncestry } of [{ root: dirname(registry), registryAncestry: true }, ...roots.map(root => ({ root: resolve(root), registryAncestry: false }))]) {
        if (!(within(output, root) || within(root, output)))
            continue;
        if ((!registryAncestry && root === campaign) || (registryAncestry && within(campaign, root) && !within(registry, report)))
            continue;
        throw new Error("Managed report overlaps source/evidence/registry ancestry");
    }
    const marker = { version: 1, campaignId: context.campaignId, campaignDirectory: campaign };
    const markerPath = join(report, ".agent-plugin-report.json"), lock = join(report, ".agent-plugin-report.lock");
    if (!(await exists(report))) {
        await mkdir(report, { mode: 0o700 });
        const handle = await open(markerPath, "wx", 0o600);
        try {
            await handle.writeFile(`${JSON.stringify(marker)}\n`);
        }
        finally {
            await handle.close();
        }
    }
    await inspectExistingPath(report);
    if (!(await lstat(report)).isDirectory() || ((await lstat(report)).mode & 0o777) !== 0o700 || !owned(await lstat(report)) || !exactJson(JSON.parse((await plainBytes(markerPath)).toString()), marker))
        throw new Error("Unowned campaign report directory");
    await mkdir(lock, { mode: 0o700 }); // No stale-lock takeover, including after crashes.
    const lockIdentity = await lstat(lock);
    const location = { version: 1, campaignDirectory: campaign, exportDirectory: output, htmlFile: join(report, "review.html") };
    let stage;
    let stagedInventory;
    let committed = false, cleanupFailed = false;
    try {
        for (const name of await readdir(report)) {
            if (![".agent-plugin-report.json", ".agent-plugin-report.lock", ".agent-plugin-html.json", "export", "review.html"].includes(name))
                throw new Error("Unknown report inventory path");
        }
        // The marker owns the directory, not arbitrary HTML. Authenticate the same
        // private byte-bound receipt as the helper before retaining a previous view.
        const html = join(report, "review.html"), receipt = join(report, ".agent-plugin-html.json");
        const hadHtml = await exists(html);
        if (hadHtml !== await exists(receipt))
            throw new Error("Managed HTML requires matching ownership receipt");
        if (hadHtml && !exactJson(JSON.parse((await plainBytes(receipt)).toString()), {
            version: 1, campaignId: context.campaignId, htmlSha256: sha(await plainBytes(html, exportLimits.totalBytes)),
        }))
            throw new Error("Managed HTML ownership hash mismatch");
        if (await exists(output))
            await authenticateExport(output, context.campaignId, location);
        const manifest = files.find(file => file.path === "export-manifest.json");
        if (!manifest)
            throw new Error("Missing export manifest");
        manifest.content = Buffer.from(`${JSON.stringify({ ...JSON.parse(Buffer.from(manifest.content).toString()), reportLocation: location })}\n`);
        // Use the unchanged exclusive writer and its fault seams before touching old data.
        stage = await mkdtemp(join(report, ".agent-plugin-export-stage-"));
        const stagedOutput = join(stage, "export");
        await publishExclusive(stagedOutput, files, []);
        stagedInventory = await authenticateExport(stagedOutput, context.campaignId, location);
        const backup = join(report, `.agent-plugin-export-backup-${randomUUID()}`);
        const hadOld = await exists(output);
        if (hadOld) {
            await authenticateExport(output, context.campaignId, location);
            await rename(output, backup);
        }
        try {
            await beforeReplacementRename();
            if (await exists(output))
                throw new Error("Managed export destination appeared during replacement");
            await rename(stagedOutput, output);
            // This rename is the commit boundary: cleanup must never imply rollback
            // or authorize callers to retry a publication that has already succeeded.
            committed = true;
            stagedInventory = undefined;
        }
        catch (error) {
            // Restore only when the destination is absent; never clobber a foreign race.
            if (hadOld && !(await exists(output)))
                await rename(backup, output);
            throw error;
        }
        if (hadOld) {
            await beforeCleanup("backup-authentication", backup);
            await removeAuthenticated(await authenticateExport(backup, context.campaignId, location), path => beforeCleanup("backup-removal", path));
        }
    }
    catch (error) {
        if (!committed)
            throw error;
        cleanupFailed = true;
    }
    finally {
        if (stage) {
            if (stagedInventory)
                await removeAuthenticated(await authenticateExport(join(stage, "export"), context.campaignId, location));
            // rmdir cannot recursively adopt a foreign stage sentinel on failure.
            try {
                if (committed)
                    await beforeCleanup("stage-removal", stage);
                await rmdir(stage);
            }
            catch {
                // Precommit residue behavior is unchanged; after commit any residue
                // also retains the shared lock so the HTML helper cannot bypass it.
                if (committed)
                    cleanupFailed = true;
            }
        }
        if (!committed) {
            const current = await lstat(lock);
            if (current.dev === lockIdentity.dev && current.ino === lockIdentity.ino && current.isDirectory() && !current.isSymbolicLink())
                await rmdir(lock);
        }
        else if (!cleanupFailed) {
            try {
                const current = await lstat(lock);
                if (current.dev !== lockIdentity.dev || current.ino !== lockIdentity.ino || !current.isDirectory() || current.isSymbolicLink())
                    cleanupFailed = true;
                else {
                    await beforeCleanup("lock-removal", lock);
                    await rmdir(lock);
                }
            }
            catch {
                cleanupFailed = true;
            }
        }
    }
    return cleanupFailed ? { output, warnings: ["Report publication committed; cleanup residue requires operator inspection before regeneration."] } : output;
}
