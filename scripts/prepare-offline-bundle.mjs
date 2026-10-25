#!/usr/bin/env node
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = path.join(root, "skills");
const node = process.execPath;

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" } });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
}

function packageDirectories(nodeModules) {
  const dirs = [];
  if (!existsSync(nodeModules)) return dirs;
  for (const name of readdirSync(nodeModules).sort()) {
    if (name === ".bin" || name === ".package-lock.json") continue;
    const full = path.join(nodeModules, name);
    if (!statSync(full).isDirectory()) continue;
    if (name.startsWith("@")) {
      for (const child of readdirSync(full).sort()) {
        const scoped = path.join(full, child);
        if (statSync(scoped).isDirectory()) dirs.push(scoped);
      }
    } else dirs.push(full);
  }
  return dirs;
}

function licenseText(packageDir) {
  const candidate = readdirSync(packageDir).find((name) => /^(license|licence)(\.|$)/i.test(name));
  return candidate ? readFileSync(path.join(packageDir, candidate), "utf8").trim() : "License text not included by package.";
}

for (const skillName of readdirSync(skillsRoot).sort()) {
  const skillRoot = path.join(skillsRoot, skillName);
  const packagePath = path.join(skillRoot, "package.json");
  if (!existsSync(packagePath)) continue;
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));

  if (pkg.scripts?.build) {
    const buildScript = path.join(skillRoot, "scripts", "build.mjs");
    if (existsSync(buildScript)) run(node, [buildScript], skillRoot);
    else {
      const tsc = path.join(skillRoot, "node_modules", "typescript", "bin", "tsc");
      run(node, [tsc, "-p", path.join(skillRoot, "tsconfig.json")], skillRoot);
      const viewer = path.join(skillRoot, "eval-viewer", "viewer.html");
      if (existsSync(viewer)) {
        mkdirSync(path.join(skillRoot, "dist", "eval-viewer"), { recursive: true });
        cpSync(viewer, path.join(skillRoot, "dist", "eval-viewer", "viewer.html"));
      }
    }
  }

  const dependencies = pkg.dependencies ?? {};
  const vendorRoot = path.join(skillRoot, "vendor");
  const previousLock = path.join(vendorRoot, "package-lock.json");
  const savedLock = existsSync(previousLock) ? readFileSync(previousLock) : null;
  rmSync(vendorRoot, { recursive: true, force: true });
  mkdirSync(vendorRoot, { recursive: true });

  if (!Object.keys(dependencies).length) {
    writeFileSync(path.join(vendorRoot, "package.json"), `${JSON.stringify({ private: true, dependencies: {} }, null, 2)}\n`);
    writeFileSync(path.join(vendorRoot, "manifest.json"), `${JSON.stringify({ packages: [] }, null, 2)}\n`);
    writeFileSync(path.join(skillRoot, "THIRD_PARTY_NOTICES.md"), "# Third-party notices\n\nNo bundled third-party runtime dependencies.\n");
    continue;
  }

  const staging = mkdtempSync(path.join(tmpdir(), `${skillName}-vendor-`));
  try {
    const vendorPackage = { name: `${skillName}-offline-runtime`, private: true, version: pkg.version ?? "0.0.0", dependencies };
    writeFileSync(path.join(staging, "package.json"), `${JSON.stringify(vendorPackage, null, 2)}\n`);
    if (savedLock) writeFileSync(path.join(staging, "package-lock.json"), savedLock);
    else run("npm", ["install", "--package-lock-only", "--ignore-scripts", "--omit=dev"], staging);
    run("npm", ["ci", "--ignore-scripts", "--omit=dev"], staging);
    cpSync(path.join(staging, "package.json"), path.join(vendorRoot, "package.json"));
    cpSync(path.join(staging, "package-lock.json"), path.join(vendorRoot, "package-lock.json"));
    cpSync(path.join(staging, "node_modules"), path.join(vendorRoot, "node_modules"), { recursive: true });
    rmSync(path.join(vendorRoot, "node_modules", ".bin"), { recursive: true, force: true });
    rmSync(path.join(vendorRoot, "node_modules", ".package-lock.json"), { force: true });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  const packages = packageDirectories(path.join(vendorRoot, "node_modules"));
  const notices = ["# Third-party notices", "", "Runtime dependencies are vendored for offline use. No install scripts were executed while preparing the bundle.", ""];
  for (const packageDir of packages) {
    const dependency = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));
    notices.push(`## ${dependency.name}@${dependency.version}`, "", `License: ${dependency.license ?? "unspecified"}`, "", "```text", licenseText(packageDir), "```", "");
  }
  writeFileSync(path.join(skillRoot, "THIRD_PARTY_NOTICES.md"), `${notices.join("\n")}\n`);
  writeFileSync(
    path.join(vendorRoot, "manifest.json"),
    `${JSON.stringify({ packages: packages.map((packageDir) => { const item = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8")); return { name: item.name, version: item.version, license: item.license ?? null }; }) }, null, 2)}\n`
  );
}

console.log(JSON.stringify({ status: "prepared", root }, null, 2));
