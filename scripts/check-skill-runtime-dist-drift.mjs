#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mapping = JSON.parse(readFileSync(path.join(root, "config", "skill-runtimes", "skill-runtime-map.json"), "utf8"));
// Only mapped app output is rebuilt. Legacy Skill runtime trees remain frozen.
if (mapping.node !== ">=22.22.2" || mapping.skills?.length !== 1 || mapping.skills[0].logicalName !== "skill-creator" || mapping.skills[0].app !== "apps/agent-plugin" || mapping.skills[0].sourceEntry !== "src/index.ts" || mapping.skills[0].emittedEntry !== "dist/index.js") throw new Error("unsupported runtime mapping for dist drift verification");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function snapshot(directory) {
  const result = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name), stat = lstatSync(absolute);
      if (stat.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error("unsupported dist entry: " + absolute);
      if (entry.isDirectory()) walk(absolute);
      else result.push({ path: path.relative(directory, absolute).split(path.sep).join("/"), sha256: digest(readFileSync(absolute)), mode: stat.mode & 0o777 });
    }
  }
  walk(directory); return result;
}
const unavailable = mapping.skills.filter((item) => !existsSync(path.join(root, item.app, "node_modules", "typescript", "bin", "tsc")));
if (unavailable.length) throw new Error(`development prerequisites are missing for dist drift verification: ${unavailable.map((item) => item.app).join(", ")}; prepare apps/agent-plugin development dependencies with the locked npm ci step before verification (Node.js >=22.22.2)`);
for (const item of mapping.skills) {
  const appRoot = path.join(root, item.app), dist = path.join(appRoot, "dist"), before = snapshot(dist);
  const build = spawnSync(process.execPath, [path.join(appRoot, "scripts", "build.mjs")], { cwd: appRoot, stdio: "inherit" });
  if (build.error) throw build.error;
  if (build.signal || build.status !== 0) throw new Error(item.logicalName + ": app build failed: " + (build.signal ?? build.status));
  if (JSON.stringify(snapshot(dist)) !== JSON.stringify(before)) throw new Error(item.logicalName + ": existing dist drifted from the mapped app TypeScript build (build before consumers)");
}
console.log(JSON.stringify({ status: "passed", apps: mapping.skills.map((item) => item.app) }));
