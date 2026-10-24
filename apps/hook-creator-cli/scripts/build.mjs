import { chmodSync, cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
if (path.dirname(dist) !== root || path.basename(dist) !== "dist") {
  throw new Error("refusing to clean an unsafe dist path");
}

const retired = path.join(root, `.dist-retired-${process.pid}`);
rmSync(retired, { recursive: true, force: true });
if (existsSync(dist)) renameSync(dist, retired);
rmSync(retired, { recursive: true, force: true });

const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
const result = spawnSync(process.execPath, [tsc, "-p", path.join(root, "tsconfig.json")], {
  cwd: root,
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);

// TypeScript does not preserve source executable bits. These files are declared
// public CLI entry points (and retain their shebangs), so restore their modes
// deterministically after every clean compilation.
for (const name of ["cli.js", "init_hook.js", "validate_hook.js"]) {
  const entry = path.join(dist, name);
  if (!existsSync(entry)) throw new Error(`missing compiled CLI entry point: ${name}`);
  chmodSync(entry, 0o755);
}

const viewer = path.join(root, "eval-viewer", "viewer.html");
if (existsSync(viewer)) {
  mkdirSync(path.join(dist, "eval-viewer"), { recursive: true });
  cpSync(viewer, path.join(dist, "eval-viewer", "viewer.html"));
}
