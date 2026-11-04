import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const app = fileURLToPath(new URL("../", import.meta.url));
const dependencySource = fileURLToPath(new URL("../../../vendor/agent-plugin-tarballs/", import.meta.url));
const expected = ["@commander-js/extra-typings", "commander", "yaml"];
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const stable = value => JSON.stringify(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b)));

async function plainAncestors(path) {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error(`Symlink is forbidden: ${current}`);
  }
}

async function collectFiles(root, relative = "") {
  await plainAncestors(root);
  const result = [];
  for (const name of (await readdir(join(root, relative))).sort()) {
    const path = relative ? `${relative}/${name}` : name;
    const stat = await lstat(join(root, path));
    if (stat.isSymbolicLink()) throw new Error(`Symlink is forbidden: ${path}`);
    if (stat.isDirectory()) result.push(...await collectFiles(root, path));
    else if (stat.isFile()) {
      if (/\.(node|so|dll|dylib|exe)$/i.test(name) || name === "binding.gyp") throw new Error(`Native addon is forbidden: ${path}`);
      result.push(path);
    } else throw new Error(`Non-regular file is forbidden: ${path}`);
  }
  return result;
}

// Parse only plain npm ustar archives. Reject extensions, links and path aliases before
// exposing bytes; unsupported archive shapes must never gain filesystem authority.
// Extraction stays in memory: no tar executable, lifecycle, network or temporary links.
function archiveFiles(compressed) {
  const tar = gunzipSync(compressed);
  const files = new Map();
  const entries = new Set();
  const text = bytes => {
    const end = bytes.indexOf(0);
    const value = bytes.subarray(0, end < 0 ? bytes.length : end).toString("utf8");
    if (end >= 0 && bytes.subarray(end).some(byte => byte !== 0)) throw new Error("Unsupported tar string");
    return value;
  };
  const octal = bytes => {
    const value = text(bytes).trim();
    if (!/^[0-7]+$/.test(value)) throw new Error("Unsupported tar number");
    const number = Number.parseInt(value, 8);
    if (!Number.isSafeInteger(number)) throw new Error("Unsupported tar size");
    return number;
  };
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      if (tar.length - offset < 1024 || tar.subarray(offset).some(byte => byte !== 0)) throw new Error("Invalid tar terminator");
      return files;
    }
    const sum = header.reduce((total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (octal(header.subarray(148, 156)) !== sum || text(header.subarray(257, 263)) !== "ustar") throw new Error("Unsupported tar header");
    const prefix = text(header.subarray(345, 500));
    const name = (prefix ? prefix + "/" : "") + text(header.subarray(0, 100));
    const type = header[156];
    const size = octal(header.subarray(124, 136));
    const path = type === 53 ? name.replace(/\/$/, "") : name;
    if (!path.startsWith("package/") || !path.split("/").every(part => part && part !== "." && part !== "..") ||
        /[\\:]/.test(path) || entries.has(path) || ![0, 48, 53].includes(type) ||
        text(header.subarray(157, 257)) || (type === 53 && size !== 0)) throw new Error("Unsafe or unsupported tar entry: " + name);
    entries.add(path);
    offset += 512;
    const end = offset + size;
    const next = offset + Math.ceil(size / 512) * 512;
    if (next > tar.length) throw new Error("Truncated tar entry");
    if (type !== 53) files.set(path.slice(8), Buffer.from(tar.subarray(offset, end)));
    offset = next;
  }
  throw new Error("Missing tar terminator");
}

async function authenticatedPackage(source, vendor, name, record, installedPaths) {
  const matches = vendor.packages.filter(entry => entry.name === name);
  const entry = matches[0];
  if (matches.length !== 1 || entry.version !== record.version || entry.integrity !== record.integrity ||
      entry.dev !== false || entry.optional !== false || !/^[a-zA-Z0-9._-]+\.tgz$/.test(entry.file)) throw new Error("Vendor package mismatch: " + name);
  const tarball = join(source, entry.file);
  await plainAncestors(tarball);
  if (!(await lstat(tarball)).isFile()) throw new Error("Expected regular tarball");
  const bytes = await readFile(tarball);
  if ("sha512-" + createHash("sha512").update(bytes).digest("base64") !== record.integrity) throw new Error("Vendor tarball integrity mismatch: " + name);
  const authenticated = archiveFiles(bytes);
  if (JSON.stringify([...authenticated.keys()].sort()) !== JSON.stringify([...installedPaths].sort())) throw new Error("Installed package inventory mismatch: " + name);
  for (const path of installedPaths) {
    if (!(await readFile(join(app, "node_modules", name, path))).equals(authenticated.get(path))) throw new Error("Installed package bytes mismatch: " + name + "/" + path);
  }
  return authenticated;
}

// Generated launcher is deliberately independent of the authoring tree and npm.
const launcher = String.raw`#!/usr/bin/env node
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
`;

async function packageRuntime(destination, source) {
  await plainAncestors(join(app, "package.json"));
  await plainAncestors(join(app, "package-lock.json"));
  const packageBytes = await readFile(join(app, "package.json"));
  const lockBytes = await readFile(join(app, "package-lock.json"));
  const pkg = JSON.parse(packageBytes);
  const lock = JSON.parse(lockBytes);
  const root = lock.packages?.[""];
  if (pkg.name !== "agent-plugin" || lock.name !== pkg.name || root?.name !== pkg.name || lock.lockfileVersion !== 3 ||
      pkg.type !== "module" || pkg.engines?.node !== ">=22.22.2" || stable(pkg.engines) !== stable(root.engines) ||
      stable(pkg.dependencies) !== stable(root.dependencies) || stable(pkg.devDependencies) !== stable(root.devDependencies) ||
      JSON.stringify(Object.keys(pkg.dependencies).sort()) !== JSON.stringify(expected)) throw new Error("Package/lock identity mismatch");
  const productionKeys = Object.entries(lock.packages).filter(([path, record]) => path && !record.dev).map(([path]) => path).sort();
  if (JSON.stringify(productionKeys) !== JSON.stringify(expected.map(name => `node_modules/${name}`).sort())) throw new Error("Lock production closure mismatch");
  await plainAncestors(join(source, "manifest.json"));
  const vendor = JSON.parse(await readFile(join(source, "manifest.json"), "utf8"));
  if (vendor.schemaVersion !== 1 || !Array.isArray(vendor.packages)) throw new Error("Invalid vendor manifest");
  const dependencies = [];
  const copies = [];
  for (const name of expected) {
    const record = lock.packages[`node_modules/${name}`];
    const directory = join(app, "node_modules", name);
    await plainAncestors(directory);
    await plainAncestors(join(directory, "package.json"));
    const installed = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    if (!record || record.dev || record.link || record.hasInstallScript || record.optional ||
        !/^sha512-/.test(record.integrity ?? "") || installed.name !== name || installed.version !== record.version ||
        pkg.dependencies[name] !== record.version || installed.license !== record.license || !installed.license ||
        stable(installed.dependencies) !== stable(record.dependencies) || stable(installed.peerDependencies) !== stable(record.peerDependencies) ||
        Object.keys(installed.optionalDependencies ?? {}).length || installed.gypfile ||
        ["preinstall", "install", "postinstall", "prepare"].some(hook => installed.scripts?.[hook])) throw new Error(`Unsafe or mismatched locked production package: ${name}`);
    for (const target of Object.keys({ ...installed.dependencies, ...installed.peerDependencies })) {
      if (!expected.includes(target)) throw new Error(`Unclosed production dependency: ${name} -> ${target}`);
    }
    const paths = await collectFiles(directory);
    const authenticated = await authenticatedPackage(source, vendor, name, record, paths);
    const licenses = paths.filter(path => /(^|\/)(licen[cs]e|copying|notice)(\.|$)/i.test(path));
    if (!licenses.length) throw new Error(`Missing license/notice: ${name}`);
    // Registry distributions include declarations/maps; these are not runtime inputs.
    for (const path of paths.filter(path => !/\.(ts|map)$/.test(path) && !/(^|\/)(tests?|node_modules|\.git)(\/|$)/.test(path))) {
      copies.push({ bytes: authenticated.get(path), path: `node_modules/${name}/${path}` });
    }
    dependencies.push({ name, version: record.version, integrity: record.integrity });
  }
  const distFiles = await collectFiles(join(app, "dist"));
  if (!distFiles.includes("index.js") || distFiles.some(path => !path.endsWith(".js") && path !== "package.json") ||
      JSON.parse(await readFile(join(app, "dist/package.json"), "utf8")).type !== "module") throw new Error("Invalid emitted dist; build first");
  for (const path of distFiles) copies.push({ source: join(app, "dist", path), path: `dist/${path}` });
  await plainAncestors(dirname(destination));
  // Exclusive creation: never overwrite a previous package or follow a destination link.
  await mkdir(destination);
  try {
    const runtime = join(destination, "runtime");
    await mkdir(runtime);
    for (const copy of copies) {
      if (copy.source) await plainAncestors(copy.source);
      await mkdir(dirname(join(runtime, copy.path)), { recursive: true });
      await writeFile(join(runtime, copy.path), copy.bytes ?? await readFile(copy.source));
    }
    await writeFile(join(runtime, "package.json"), '{"type":"module"}\n');
    await writeFile(join(runtime, "THIRD_PARTY_NOTICES.md"), "# Third-party notices\n\n" + dependencies.map(dep => `${dep.name} ${dep.version}: license and notices retained in node_modules/${dep.name}/\n`).join("\n"));
    const files = [];
    for (const path of await collectFiles(runtime)) {
      const bytes = await readFile(join(runtime, path));
      files.push({ path, sha256: sha256(bytes), size: bytes.length });
    }
    await writeFile(join(runtime, "runtime-manifest.json"), JSON.stringify({
      schemaVersion: 1, runtimeMode: "node-bundled", logicalName: "skill-creator", skill: "skills/skill-creator",
      app: "apps/agent-plugin", sourceEntry: "src/index.ts", emittedEntry: "dist/index.js", runtimeEntry: "dist/index.js", node: ">=22.22.2",
      sourceLock: { path: "apps/agent-plugin/package-lock.json", sha256: sha256(lockBytes), lockfileVersion: 3 },
      productionDependencies: dependencies, resources: [], relatedCommands: {}, notices: "THIRD_PARTY_NOTICES.md", files,
    }, null, 2) + "\n");
    await mkdir(join(destination, "scripts"));
    await writeFile(join(destination, "scripts/skill-creator.mjs"), launcher, { mode: 0o755 });
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

try {
  const args = process.argv.slice(2);
  if (!(args.length === 1 || (args.length === 3 && args[1] === "--dependency-source" && args[2]))) throw new Error("Usage: node scripts/package-runtime.mjs <new destination> [--dependency-source <vendor directory>]");
  await packageRuntime(resolve(args[0]), args.length === 3 ? resolve(args[2]) : dependencySource);
} catch (error) {
  console.error(`agent-plugin packaging: ${error.message}`);
  process.exitCode = 1;
}
