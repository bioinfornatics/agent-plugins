/** Bounded regular-file inputs; reject symbolic links along existing ancestors. */
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve, parse, join } from "node:path";
export function regularPath(path: string, directory = false): void {
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
export function readBounded(path: string, maxBytes: number): Buffer {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
        throw new TypeError("Input bound must be a positive safe integer");
    regularPath(path);
    const oversized = () => new Error("Input exceeds " + (maxBytes / (1024 * 1024)) + " MiB: " + path);
    if (lstatSync(path).size > maxBytes) throw oversized();
    const bytes = readFileSync(path);
    if (bytes.length > maxBytes) throw oversized();
    return bytes;
}
/** General inputs retain their eight-MiB limit. */
export function read(path: string): Buffer { return readBounded(path, 8 * 1024 * 1024); }
