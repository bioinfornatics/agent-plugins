import type { SnapshotFile } from "../../../../domain/evaluation.ts";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

export const FILE_LIMIT = 4 * 1024 * 1024;
export const TREE_LIMIT = 64 * 1024 * 1024;
/** Lexical containment only: callers still need link checks; this is not an OS sandbox. */
export function contained(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}
export function missing(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
/** Reject observed symlink components; separate checks/opening do not eliminate all filesystem races. */
export async function noLinks(path: string): Promise<void> {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error("Symlink paths are unsupported");
  }
}
export async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await noLinks(path);
  await chmod(path, 0o700);
}
export async function regularFile(path: string, limit = FILE_LIMIT): Promise<Buffer> {
  await noLinks(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw new Error("Expected a bounded regular file");
    // Never allocate/read beyond the bound, including if the file grows during collection.
    const bytes = Buffer.alloc(Math.min(info.size + 1, limit + 1));
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > limit || length > info.size) throw new Error("File changed or exceeded collection bound");
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}
/** Exclusive creation (wx): never replace an existing file, including at a colliding artifact path. */
export async function privateFile(path: string, content: Uint8Array | string): Promise<void> {
  await privateDirectory(dirname(path));
  await writeFile(path, content, { mode: 0o600, flag: "wx" });
}
/** Exclusions apply to basenames at every depth; excluded entries still count toward traversal bounds.
 * Visited paths reject symlinks/special files, with depth 64 and 20,000-entry ceilings.
 */
export async function walk(root: string, visit: (path: string, name: string) => Promise<void>, exclude: (name: string) => boolean = () => false): Promise<void> {
  await noLinks(root);
  if (!(await lstat(root)).isDirectory()) throw new Error("Expected a directory");
  let entries = 0;
  const descend = async (directory: string, depth: number): Promise<void> => {
    if (depth > 64) throw new Error("Tree depth limit exceeded");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++entries > 20000) throw new Error("Tree entry limit exceeded");
      if (exclude(entry.name)) continue;
      const path = join(directory, entry.name);
      const info = await lstat(path);
      if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw new Error("Symlinks and special files are unsupported");
      if (info.isDirectory()) await descend(path, depth + 1);
      else await visit(path, relative(root, path));
    }
  };
  await descend(root, 0);
}
/** Copy privately without .git/evals at any depth; preserve executable intent, not source permissions.
 * Destination files are exclusively created; this is not a faithful archive of the source tree.
 */
export async function copyTree(source: string, destination: string, plugin: boolean): Promise<void> {
  let size = 0;
  await privateDirectory(destination);
  await walk(source, async (path, name) => {
    if (plugin && name.split(sep).at(-1) === "mcp.json") throw new Error("Plugin mcp.json mapping is not supported");
    const content = await regularFile(path);
    size += content.length;
    if (size > TREE_LIMIT) throw new Error("Tree aggregate size limit exceeded");
    await privateFile(join(destination, name), content);
    if ((await lstat(path)).mode & 0o111) await chmod(join(destination, name), 0o700);
  }, (name) => name === "evals" || name === ".git");
}

/** Restore only captured bytes; never revisit mutable operator sources after preparation. */
export async function restoreSnapshot(files: readonly SnapshotFile[], destination: string): Promise<void> {
  let size = 0;
  for (const file of files) {
    if (isAbsolute(file.path) || file.path.includes("\\") || file.path.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Unsafe snapshot path");
    const content = Buffer.from(file.content, "base64");
    size += content.length;
    if (content.length > FILE_LIMIT || size > TREE_LIMIT) throw new Error("Snapshot size limit exceeded");
    await privateFile(join(destination, file.path), content);
    if (file.executable) await chmod(join(destination, file.path), 0o700);
  }
}
