import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, rm, rmdir, unlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { exportLimits } from "../../../application/ports/export-writer.js";
import { inspectExistingPath } from "../storage/sqlite-verified-attempt.js";
import { safeArtifactPath } from "../storage/registry-files.js";
const missing = (error) => error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
const within = (path, root) => path === root || path.startsWith(`${root}${sep}`);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** Destination cleanup never adopts replacement inodes or reads a replacement directory.
 * rmdir itself checks emptiness; component races are not a hostile-ancestor sandbox.
 */
async function removeOwned(files, dirs) {
    for (const [entries, directory] of [[files, false], [dirs, true]]) {
        for (const entry of [...entries].reverse()) {
            try {
                const info = await lstat(entry.path);
                if (info.dev !== entry.dev || info.ino !== entry.ino || info.isSymbolicLink())
                    continue;
                if (directory && info.isDirectory())
                    await rmdir(entry.path);
                else if (!directory && info.isFile())
                    await unlink(entry.path);
            }
            catch { /* preserve nonempty, foreign or unavailable paths */ }
        }
    }
}
/** Read a regular file through one no-follow handle and reject path/inode replacement.
 * Component checks bound ordinary races; they are not an attacker filesystem sandbox.
 */
async function readExportBytes(path, expected) {
    await inspectExistingPath(dirname(path));
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const info = await handle.stat();
        if (!info.isFile() || info.nlink !== 1 || (info.dev !== expected.dev || info.ino !== expected.ino))
            throw new Error("Export file identity changed");
        const bytes = await handle.readFile();
        const current = await lstat(path);
        if (!current.isFile() || current.isSymbolicLink() || current.dev !== info.dev || current.ino !== info.ino)
            throw new Error("Export file identity changed");
        return bytes;
    }
    finally {
        await handle.close();
    }
}
export class FilesystemExportWriter {
    registry;
    beforeStagingWrite;
    beforePublicationWrite;
    constructor(registry, beforeStagingWrite = async () => { }, beforePublicationWrite = async () => { }) {
        this.registry = resolve(registry);
        this.beforeStagingWrite = beforeStagingWrite;
        this.beforePublicationWrite = beforePublicationWrite;
    }
    async publish(output, files, protectedRoots) {
        // Capture caller-owned paths and bytes before filesystem awaits allow mutation.
        files = files.map(file => ({ path: file.path, content: Buffer.from(file.content) }));
        protectedRoots = protectedRoots.map(root => resolve(root));
        output = resolve(output);
        const parent = dirname(output);
        // Like the evidence reader, component inspection is not a sandbox against
        // malicious concurrent ancestor replacement. Exclusive creation covers the
        // ordinary destination-creation race, not an attacker-controlled filesystem.
        await inspectExistingPath(parent);
        if (!(await lstat(parent)).isDirectory())
            throw new Error("Export parent must be an existing plain directory");
        for (const root of [dirname(this.registry), ...protectedRoots].map(root => resolve(root))) {
            if (within(output, root) || within(root, output))
                throw new Error("Export destination overlaps source/evidence/registry ancestry");
        }
        try {
            await lstat(output);
            throw new Error("Export destination already exists");
        }
        catch (error) {
            if (!missing(error))
                throw error;
        }
        const seen = new Set();
        for (const file of files) {
            safeArtifactPath(file.path);
            if (file.path === ".export-pending" || seen.has(file.path))
                throw new Error("Export file collision");
            seen.add(file.path);
        }
        const manifest = files.find(file => file.path === "export-manifest.json");
        if (!manifest)
            throw new Error("Missing export manifest");
        const payload = files.filter(file => file !== manifest).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
        const expectedFiles = payload.map(file => ({ path: file.path, bytes: file.content.length, sha256: digest(file.content) }));
        const complete = Buffer.from(`${JSON.stringify({ ...JSON.parse(Buffer.from(manifest.content).toString()), status: "complete",
            files: expectedFiles }, null, 2)}\n`);
        if (complete.length > exportLimits.jsonBytes || payload.reduce((total, file) => total + file.content.length, complete.length) > exportLimits.totalBytes)
            throw new Error("Final export manifest/total byte bound exceeded");
        const stage = await mkdtemp(join(parent, ".agent-plugin-export-"));
        const ownedFiles = [], ownedDirs = [];
        async function makeDirectories(root, relative) {
            let current = root;
            for (const part of relative.split("/").slice(0, -1)) {
                current = join(current, part);
                if (ownedDirs.some(dir => dir.path === current))
                    continue;
                await mkdir(current, { mode: 0o700 });
                const info = await lstat(current);
                ownedDirs.push({ path: current, dev: info.dev, ino: info.ino });
            }
        }
        try {
            for (const file of payload) {
                const path = join(stage, file.path);
                await mkdir(dirname(path), { recursive: true, mode: 0o700 });
                const handle = await open(path, "wx", 0o600);
                try {
                    await this.beforeStagingWrite(path);
                    await handle.writeFile(file.content);
                }
                finally {
                    await handle.close();
                }
            }
            // mkdir is the exclusive no-overwrite operation, even if a competing empty
            // directory appeared after preflight. POSIX rename would clobber that directory.
            await mkdir(output, { mode: 0o700 });
            const rootInfo = await lstat(output);
            ownedDirs.push({ path: output, dev: rootInfo.dev, ino: rootInfo.ino });
            const writeOwned = async (relative, bytes) => {
                await makeDirectories(output, relative);
                const path = join(output, relative);
                // Acquire exclusive ownership before any bytes or injected failure; foreign
                // files are never adopted as owned cleanup data.
                const handle = await open(path, "wx", 0o600);
                try {
                    const info = await handle.stat();
                    ownedFiles.push({ path, dev: info.dev, ino: info.ino });
                    await this.beforePublicationWrite(path);
                    await handle.writeFile(bytes);
                }
                finally {
                    await handle.close();
                }
            };
            await writeOwned(".export-pending", Buffer.from("Incomplete until export-manifest.json is parseable with status complete AND this marker is absent. No automatic crash cleanup.\n"));
            for (const file of payload) {
                const path = join(stage, file.path);
                const staged = await readFile(path);
                const expected = expectedFiles.find(entry => entry.path === file.path);
                if (!expected || staged.length !== expected.bytes || digest(staged) !== expected.sha256)
                    throw new Error("Staged export bytes changed");
                await writeOwned(file.path, staged);
            }
            // Manifest last is the readiness contract, not a multi-file transaction.
            await writeOwned("export-manifest.json", complete);
            // Verify delivered content against frozen expectations before declaring readiness.
            // This is a delivery-time check, not permanent authenticity of mutable output.
            for (const expected of [...expectedFiles, { path: "export-manifest.json", bytes: complete.length, sha256: digest(complete) }]) {
                const path = join(output, expected.path);
                const identity = ownedFiles.find(file => file.path === path);
                if (!identity)
                    throw new Error("Export file identity changed");
                const actual = await readExportBytes(path, identity);
                if (actual.length !== expected.bytes || digest(actual) !== expected.sha256)
                    throw new Error("Published export bytes changed");
            }
            const pending = ownedFiles.find(file => file.path === join(output, ".export-pending"));
            if (!pending)
                throw new Error("Export pending marker identity changed");
            await readExportBytes(pending.path, pending);
            await unlink(pending.path);
        }
        catch (error) {
            // Never recursive-remove a published directory: a concurrent foreign sentinel
            // must survive. Remove only same-inode owned files and empty owned directories.
            await removeOwned(ownedFiles, ownedDirs);
            throw error;
        }
        finally {
            // Only this dedicated mkdtemp root is disposable; never remove output or parent.
            await rm(stage, { recursive: true, force: true });
        }
    }
}
