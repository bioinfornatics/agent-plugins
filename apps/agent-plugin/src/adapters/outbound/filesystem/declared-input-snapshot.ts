import { lstat, opendir } from "node:fs/promises";
import { join, parse, resolve, sep } from "node:path";
import { EvaluationError, type SnapshotFile } from "../../../domain/evaluation.ts";
import { safeInputPath } from "../../../domain/scenario-import.ts";
import { readSnapshotFile, type SnapshotBudget } from "./evaluation-snapshot.ts";

/** Explicit declarations bypass the installation's evals exclusion, not its bounds or link policy.
 * Checking every observed parent and O_NOFOLLOW on the leaf rejects links, but is not an OS
 * sandbox or a race-free openat traversal against a concurrently hostile filesystem.
 */
export async function captureDeclaredInputs(root: string, declarations: unknown, budget: SnapshotBudget): Promise<{ inputs: { source: string; workspace: string }[]; files: SnapshotFile[] }> {
  if (!Array.isArray(declarations) || declarations.length > 20_000 || declarations.some(path => typeof path !== "string" || !safeInputPath(path))) throw new EvaluationError("files: expected safe Skill-root-relative input paths");
  const paths = [...new Set(declarations as string[])].sort();
  const files = new Map<string, SnapshotFile>();
  // Also inspect absolute root ancestors; realpath must not hide a declared input's parents.
  const absolute = resolve(root);
  let parent = parse(absolute).root;
  for (const part of absolute.slice(parent.length).split(sep).filter(Boolean)) {
    parent = join(parent, part);
    if (!(await lstat(parent)).isDirectory()) throw new EvaluationError(`${parent}: input parent must be a directory without symlinks`);
  }
  async function visit(relative: string): Promise<void> {
    if (!safeInputPath(relative)) throw new EvaluationError(`${relative}: reserved or unsafe input path`);
    if (++budget.entries > 20_000) throw new EvaluationError(`${relative}: snapshot traversal exceeds 20000 entries`);
    const path = join(root, relative);
    const metadata = await lstat(path);
    if (metadata.isDirectory()) {
      const names: string[] = [];
      const entries = await opendir(path);
      for await (const entry of entries) {
        if (budget.entries + names.length + 1 > 20_000) throw new EvaluationError(`${relative}: snapshot traversal exceeds 20000 entries`);
        names.push(entry.name);
      }
      for (const name of names.sort()) await visit(`${relative}/${name}`);
    } else if (metadata.isFile()) {
      if (files.has(relative)) return;
      const captured = await readSnapshotFile(path, budget);
      files.set(relative, { path: relative, content: captured.bytes.toString("base64"), executable: captured.executable });
    } else throw new EvaluationError(`${path}: declared inputs reject symlinks and special files`);
  }
  for (const path of paths) {
    let parent = root;
    for (const part of path.split("/").slice(0, -1)) {
      parent = join(parent, part);
      if (!(await lstat(parent)).isDirectory()) throw new EvaluationError(`${parent}: input parent must be a directory without symlinks`);
    }
    await visit(path);
  }
  return { inputs: paths.map(path => ({ source: path, workspace: path })), files: [...files.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) };
}
