import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { dirname, join, parse, resolve, sep } from "node:path";
function missing(error) {
    return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
/** Inspect each component; never chmod an existing shared ancestor. These checks are not an OS sandbox
 * and cannot eliminate a malicious concurrent path replacement between inspection and SQLite open.
 */
export async function registryDirectory(path, privateLeaf) {
    const absolute = resolve(path);
    let current = parse(absolute).root;
    for (const part of absolute.slice(current.length).split(sep).filter(Boolean)) {
        current = join(current, part);
        try {
            await mkdir(current, { mode: 0o700 });
        }
        catch (error) {
            if (!(error !== null && typeof error === "object" && "code" in error && error.code === "EEXIST"))
                throw error;
        }
        const info = await lstat(current);
        if (!info.isDirectory() || info.isSymbolicLink())
            throw new Error("Registry/evidence directories must not contain links or special files");
        if (privateLeaf && current === absolute && ((info.mode & 0o777) !== 0o700 || (process.getuid && info.uid !== process.getuid()))) {
            throw new Error("Registry/evidence directory must be owned by the current user with mode 700");
        }
    }
}
async function inspectPrivateFile(path) {
    try {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600 || (process.getuid && info.uid !== process.getuid())) {
            throw new Error("Registry files must be private owned regular files with mode 600 and no links");
        }
        return true;
    }
    catch (error) {
        if (missing(error))
            return false;
        throw error;
    }
}
/** Create the DB exclusively and set 600 before SQLite can write bytes. DELETE journaling is deliberate:
 * existing WAL/SHM files are unsupported, while an observed rollback journal must also be private.
 */
export async function prepareRegistryFile(path) {
    const absolute = resolve(path);
    await registryDirectory(dirname(absolute), true);
    if (!await inspectPrivateFile(absolute)) {
        try {
            const handle = await open(absolute, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
            try {
                await handle.chmod(0o600);
            }
            finally {
                await handle.close();
            }
        }
        catch (error) {
            if (!(error !== null && typeof error === "object" && "code" in error && error.code === "EEXIST"))
                throw error;
        }
    }
    await inspectPrivateFile(absolute);
    await inspectPrivateFile(`${absolute}-journal`);
    for (const suffix of ["-wal", "-shm"]) {
        if (await inspectPrivateFile(`${absolute}${suffix}`))
            throw new Error("WAL registries are unsupported; expected DELETE journal mode");
    }
    return absolute;
}
export function safeArtifactPath(path) {
    if (!path || path.includes("\\") || path.includes("\0") || path.startsWith("/") || /^[a-z]:/i.test(path) || path.split("/").some((part) => !part || part === "." || part === "..")) {
        throw new Error("Unsafe artifact path");
    }
}
