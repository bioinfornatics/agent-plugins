#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
function plain(path) {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error("symlink is forbidden: " + current);
  }
  if (!lstatSync(absolute).isFile()) throw new Error("expected plain file: " + absolute);
  return absolute;
}
function canonical(path) {
  return typeof path === "string" && !path.includes("\\") && !path.includes(":") &&
    path.split("/").every(part => part && part !== "." && part !== "..");
}
try {
  const version = process.versions.node.split(".").map(Number);
  if (!(version[0] > 22 || (version[0] === 22 && (version[1] > 22 || (version[1] === 22 && version[2] >= 2))))) {
    throw new Error("Node.js >=22.22.2 is required; found " + process.version);
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../runtime");
  plain(fileURLToPath(import.meta.url));
  const manifest = JSON.parse(readFileSync(plain(join(root, "runtime-manifest.json")), "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.runtimeMode !== "node-bundled" ||
      manifest.logicalName !== "skill-creator" || manifest.app !== "apps/agent-plugin" ||
      manifest.node !== ">=22.22.2" || !canonical(manifest.runtimeEntry) ||
      manifest.runtimeEntry !== "dist/index.js" || !Array.isArray(manifest.files)) {
    throw new Error("invalid runtime manifest entry mapping");
  }
  const seen = new Set();
  for (const file of manifest.files) {
    if (!canonical(file.path) || file.path === "runtime-manifest.json" || seen.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("invalid manifest file inventory");
    seen.add(file.path);
    const bytes = readFileSync(plain(join(root, file.path)));
    if (bytes.length !== file.size || createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error("runtime integrity mismatch: " + file.path);
  }
  // Files absent from the manifest can shadow dependencies during Node resolution.
  // Permit only directories implied by authenticated files, not empty resolution roots.
  const directories = new Set();
  for (const path of seen) {
    const parts = path.split("/");
    for (let length = 1; length < parts.length; length++) directories.add(parts.slice(0, length).join("/"));
  }
  function inventory(relative = "") {
    for (const name of readdirSync(join(root, relative))) {
      const path = relative ? relative + "/" + name : name;
      const stat = lstatSync(join(root, path));
      if (stat.isSymbolicLink()) throw new Error("symlink is forbidden: " + path);
      if (stat.isDirectory()) {
        if (!directories.has(path)) throw new Error("unlisted runtime directory: " + path);
        inventory(path);
      } else if (!stat.isFile() || (path !== "runtime-manifest.json" && !seen.has(path))) {
        throw new Error("unlisted runtime file: " + path);
      }
    }
  }
  inventory();
  if (!seen.has(manifest.runtimeEntry)) throw new Error("runtime entry is absent from manifest inventory");
  // Explicit executable/argv and inherited streams; never use PATH or global loaders.
  const env = { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" };
  const child = spawn(process.execPath, [plain(join(root, manifest.runtimeEntry)), ...process.argv.slice(2)], { stdio: "inherit", env });
  const forward = signal => { if (!child.killed) child.kill(signal); };
  const handlers = new Map(["SIGINT", "SIGTERM", "SIGHUP"].map(signal => [signal, () => forward(signal)]));
  for (const [signal, handler] of handlers) process.on(signal, handler);
  child.once("error", error => { console.error("skill-creator: " + error.message); process.exitCode = 1; });
  child.once("close", (code, signal) => {
    for (const [name, handler] of handlers) process.removeListener(name, handler);
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
} catch (error) {
  console.error("skill-creator: " + error.message);
  process.exitCode = 1;
}
