/** Bounded regular-file inputs; reject symbolic links along existing ancestors. */
import { existsSync, lstatSync, readFileSync, openSync, closeSync, fstatSync, readSync, constants } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, parse, join, relative } from "node:path";
export function regularPath(path, directory = false) {
    const absolute = resolve(path), root = parse(absolute).root;
    let current = root;
    for (const part of absolute.slice(root.length).split(/[\\/]/).filter(Boolean)) {
        current = join(current, part);
        if (!existsSync(current)) {
            try {
                lstatSync(current);
            }
            catch {
                continue;
            }
        }
        const stat = lstatSync(current);
        if (stat.isSymbolicLink())
            throw new Error("Symbolic links are not supported: " + current);
        if (current !== absolute && !stat.isDirectory())
            throw new Error("Parent must be a regular directory: " + current);
        if (current === absolute && (directory ? !stat.isDirectory() : !stat.isFile()))
            throw new Error("Expected regular " + (directory ? "directory: " : "file: ") + current);
    }
}
/** Explicit caller-owned bounds; check size before allocating and again after reading. */
export function readBounded(path, maxBytes) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
        throw new TypeError("Input bound must be a positive safe integer");
    regularPath(path);
    const oversized = () => new Error("Input exceeds " + (maxBytes / (1024 * 1024)) + " MiB: " + path);
    if (lstatSync(path).size > maxBytes)
        throw oversized();
    const bytes = readFileSync(path);
    if (bytes.length > maxBytes)
        throw oversized();
    return bytes;
}
/** General inputs retain their eight-MiB limit. */
export function read(path) { return readBounded(path, 8 * 1024 * 1024); }
/** Local evidence integrity, not atomic ancestor containment or an OS sandbox.
 * Reads bind to one opened descriptor. Concurrent same-user path replacement is
 * outside this portable contract; hashes authenticate neither report nor source.
 */
export function readVerifiedFile(path, options = {}) {
    const expectedSize = options.bytes, max = options.maxBytes;
    if (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize < 0))
        throw Error("invalid-evidence-size");
    if (max !== undefined && (!Number.isSafeInteger(max) || max < 0))
        throw Error("invalid-evidence-limit");
    if (options.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(options.sha256))
        throw Error("invalid-evidence-hash");
    const absolute = resolve(path), root = parse(absolute).root;
    let current = root;
    for (const part of relative(root, absolute).split(/[\\/]/).filter(Boolean)) {
        current = join(current, part);
        const stat = lstatSync(current);
        if (stat.isSymbolicLink() || (current === absolute ? !stat.isFile() || stat.nlink !== 1 : !stat.isDirectory()))
            throw Error("unsafe-evidence-file");
    }
    const leaf = lstatSync(absolute);
    let fd;
    try {
        fd = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
        const before = fstatSync(fd);
        if (!before.isFile() || before.nlink !== 1 || before.dev !== leaf.dev || before.ino !== leaf.ino || before.size !== leaf.size || before.mtimeMs !== leaf.mtimeMs || before.ctimeMs !== leaf.ctimeMs ||
            (expectedSize !== undefined && before.size !== expectedSize) || (max !== undefined && before.size > max))
            throw Error("evidence-binding-mismatch");
        const limit = expectedSize ?? before.size, hash = createHash("sha256"), chunks = [];
        const buffer = Buffer.allocUnsafe(64 * 1024);
        let total = 0;
        while (true) {
            const n = readSync(fd, buffer, 0, Math.min(buffer.length, limit - total + 1), null);
            if (!n)
                break;
            total += n;
            if (total > limit || (max !== undefined && total > max))
                throw Error("evidence-size-changed");
            hash.update(buffer.subarray(0, n));
            if (options.collect !== false)
                chunks.push(Buffer.from(buffer.subarray(0, n)));
        }
        const after = fstatSync(fd);
        if (!after.isFile() || after.nlink !== 1 || total !== limit || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || (options.sha256 !== undefined && hash.digest("hex") !== options.sha256))
            throw Error("evidence-drift");
        return Buffer.concat(chunks);
    }
    finally {
        if (fd !== undefined)
            closeSync(fd);
    }
}
