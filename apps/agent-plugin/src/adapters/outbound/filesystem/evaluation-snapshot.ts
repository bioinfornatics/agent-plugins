import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { join } from "node:path";
import { EvaluationError, type SnapshotFile } from "../../../domain/evaluation.ts";

const maxFileBytes = 4 * 1024 * 1024;
const maxTotalBytes = 64 * 1024 * 1024;
const maxEntries = 20_000;
const maxDepth = 64;

/** One load shares its bounds across installation, suites and fixture snapshots. */
export interface SnapshotBudget { bytes: number; entries: number }

/** Open without following links and read at most the limit plus one byte, even if a file grows. */
export async function readSnapshotFile(path: string, budget: SnapshotBudget): Promise<{ bytes: Buffer; executable: boolean }> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new EvaluationError(`${path}: expected a regular file; symlinks and special files are unsupported`);
    if (metadata.size > maxFileBytes) throw new EvaluationError(`${path}: snapshot file exceeds 4 MiB`);
    const buffer = Buffer.alloc(maxFileBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > maxFileBytes) throw new EvaluationError(`${path}: snapshot file exceeds 4 MiB`);
    budget.bytes += length;
    if (budget.bytes > maxTotalBytes) throw new EvaluationError(`${path}: snapshot total exceeds 64 MiB`);
    return { bytes: buffer.subarray(0, length), executable: (metadata.mode & 0o111) !== 0 };
  } finally { await handle.close(); }
}

function excluded(name: string, fixtures: boolean): boolean {
  if (name === ".git" || name === "evals") return true;
  // Matches the current workspace collection policy; this is not a comprehensive secret detector.
  return fixtures && ([".agents", "node_modules", "config.yaml", "secrets.yaml", "permission.yaml", "tool_permissions.json"].includes(name) || /^\.env(?:\.|$)/.test(name));
}

/** Sorted relative POSIX paths contain only captured regular-file bytes, never live references. */
export async function captureSnapshot(root: string, fixtures: boolean, budget: SnapshotBudget): Promise<SnapshotFile[]> {
  const files: SnapshotFile[] = [];
  async function visit(directory: string, prefix: string, depth: number): Promise<void> {
    if (depth > maxDepth) throw new EvaluationError(`${directory}: snapshot depth exceeds 64`);
    const metadata = await lstat(directory);
    if (!metadata.isDirectory()) throw new EvaluationError(`${directory}: expected a directory; symlinks are unsupported`);
    const entries: string[] = [];
    const stream = await opendir(directory);
    for await (const entry of stream) {
      budget.entries++;
      if (budget.entries > maxEntries) throw new EvaluationError(`${directory}: snapshot traversal exceeds 20000 entries`);
      entries.push(entry.name);
    }
    for (const name of entries.sort()) {
      if (excluded(name, fixtures)) continue;
      const path = join(directory, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const entry = await lstat(path);
      if (entry.isDirectory()) await visit(path, relative, depth + 1);
      else if (entry.isFile()) {
        const captured = await readSnapshotFile(path, budget);
        files.push({ path: relative, content: captured.bytes.toString("base64"), executable: captured.executable });
      } else throw new EvaluationError(`${path}: snapshot rejects symlinks and special files`);
    }
  }
  await visit(root, "", 0);
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
