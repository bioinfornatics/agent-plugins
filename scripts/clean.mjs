import { lstatSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Product runtimes and evaluation evidence are never routine cleanup targets.
export const CLEAN_PATHS = Object.freeze([
  "bin", "dist", "release-staging", "release-assets", ".artifacts",
]);

function existingStat(target) {
  try {
    return lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function assertSafeRoot(root) {
  const filesystemRoot = path.parse(root).root;
  const segments = root.slice(filesystemRoot.length).split(path.sep).filter(Boolean);
  let ancestor = filesystemRoot;
  for (const segment of [undefined, ...segments]) {
    if (segment !== undefined) ancestor = path.join(ancestor, segment);
    const stat = existingStat(ancestor);
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      throw new Error(`cleanup root ancestry must not contain a symbolic link: ${ancestor}`);
    }
  }
  const stat = existingStat(root);
  if (!stat?.isDirectory()) {
    throw new Error("cleanup root must be an existing directory");
  }
}

function targetFor(root, relative) {
  const target = path.resolve(root, ...relative.split("/"));
  if (target !== path.join(root, ...relative.split("/"))) {
    throw new Error(`refusing path outside cleanup root: ${relative}`);
  }
  let ancestor = root;
  for (const segment of relative.split("/").slice(0, -1)) {
    ancestor = path.join(ancestor, segment);
    const stat = existingStat(ancestor);
    if (!stat) break;
    if (stat.isSymbolicLink()) {
      throw new Error(`refusing symlink ancestor: ${path.relative(root, ancestor)}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`refusing non-directory ancestor: ${path.relative(root, ancestor)}`);
    }
  }
  return target;
}

export function cleanGenerated(root) {
  const resolvedRoot = path.resolve(root);
  assertSafeRoot(resolvedRoot);
  const targets = CLEAN_PATHS.map((relative) => ({
    relative,
    absolute: targetFor(resolvedRoot, relative),
  }));
  const removed = [];
  for (const target of targets) {
    if (!existingStat(target.absolute)) continue;
    // rm removes a symlink itself rather than traversing to its target.
    rmSync(target.absolute, { recursive: true, force: true });
    removed.push(target.relative);
  }
  return removed;
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  try {
    if (process.argv.length > 2) throw new Error("cleanup does not accept paths or arguments");
    const removed = cleanGenerated(repositoryRoot);
    console.log(removed.length ? `Cleaned: ${removed.join(", ")}` : "Clean: nothing to remove.");
  } catch (error) {
    console.error(`Clean refused: ${error.message}`);
    process.exitCode = 1;
  }
}
