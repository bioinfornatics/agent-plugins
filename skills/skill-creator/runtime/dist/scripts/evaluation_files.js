/** Bounded regular-file inputs; reject symbolic links along existing ancestors. */
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve, parse, join } from "node:path";
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
export function read(path) {
    regularPath(path);
    const bytes = readFileSync(path);
    if (bytes.length > 8 * 1024 * 1024)
        throw new Error("Input exceeds 8 MiB: " + path);
    return bytes;
}
