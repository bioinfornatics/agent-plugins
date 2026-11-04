#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => { throw new Error(message); };
const canonical = (value) => typeof value === "string" && !value.includes("\\") && !value.includes(":") && !path.isAbsolute(value) && value.split("/").every((part) => part && part !== "." && part !== "..");
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function plain(absolute, kind = "file", optional = false) {
  let current = path.parse(absolute).root;
  const parts = absolute.slice(current.length).split(path.sep).filter(Boolean);
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (!stat && optional && index === parts.length - 1) return false;
    if (!stat || stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory())) fail(`non-plain path: ${current}`);
    if (index === parts.length - 1 && !(kind === "file" ? stat.isFile() : stat.isDirectory())) fail(`${absolute} must be a plain ${kind}`);
  }
  return true;
}

// Dependency-free validation for the keywords used by the checked-in schema.
// Unknown keywords fail closed rather than silently weakening the contract.
function validate(value, schema, label) {
  const supported = new Set(["$schema", "$id", "title", "type", "const", "required", "properties", "additionalProperties", "minItems", "maxItems", "maxProperties"]);
  for (const key of Object.keys(schema)) if (key !== "items" && !supported.has(key)) fail(`${label}: unsupported schema keyword ${key}`);
  if ("const" in schema && !equal(value, schema.const)) fail(`${label}: unexpected value`);
  if (schema.type === "string" && typeof value !== "string") fail(`${label}: expected string`);
  if (schema.type === "array") {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) fail(`${label}: invalid array`);
    if (schema.items) value.forEach((item, index) => validate(item, schema.items, `${label}[${index}]`));
  } else if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label}: expected object`);
    if (Object.keys(value).length > (schema.maxProperties ?? Infinity)) fail(`${label}: too many fields`);
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) fail(`${label}: missing ${key}`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) validate(item, schema.properties[key], `${label}.${key}`);
      else if (schema.additionalProperties === false) fail(`${label}: unknown field ${key}`);
    }
  } else if (schema.type !== undefined && schema.type !== "string") fail(`${label}: unsupported schema type`);
}

function validateMapping() {
  const directory = path.join(root, "config/skill-runtimes");
  const mappingPath = path.join(directory, "skill-runtime-map.json");
  const schemaPath = path.join(directory, "skill-runtime-map.schema.json");
  plain(mappingPath); plain(schemaPath);
  const mapping = JSON.parse(readFileSync(mappingPath, "utf8"));
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema" || schema.properties?.skills?.minItems !== 1 || schema.properties?.skills?.maxItems !== 1 || schema.properties?.node?.const !== ">=22.22.2") fail("unsupported runtime mapping schema");
  validate(mapping, schema, "runtime mapping");
  const expected = { logicalName: "skill-creator", skill: "skills/skill-creator", app: "apps/agent-plugin", sourceEntry: "src/index.ts", emittedEntry: "dist/index.js", resources: [], relatedCommands: {} };
  if (mapping.schemaVersion !== 1 || mapping.$schema !== "./skill-runtime-map.schema.json" || mapping.node !== ">=22.22.2" || !Array.isArray(mapping.skills) || mapping.skills.length !== 1) fail("unsupported runtime mapping contract");
  const item = mapping.skills[0];
  if (!equal(Object.keys(item).sort(), Object.keys(expected).sort()) || Object.entries(expected).some(([key, value]) => !equal(item[key], value))) fail("only the canonical agent-plugin mapping is supported; legacy runtimes remain frozen");
  for (const relative of [item.skill, item.app]) plain(path.join(root, relative), "directory");
  for (const relative of [item.sourceEntry, item.emittedEntry, "package.json", "package-lock.json", "scripts/package-runtime.mjs"]) plain(path.join(root, item.app, relative));
  return { mapping, item };
}

function inventory(directory, relative = "") {
  plain(path.join(directory, relative), "directory");
  const files = [];
  for (const name of readdirSync(path.join(directory, relative)).sort()) {
    const entry = relative ? `${relative}/${name}` : name;
    if (!canonical(entry)) fail(`invalid packaged path: ${entry}`);
    const absolute = path.join(directory, entry);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) fail(`symlink rejected: ${entry}`);
    if (stat.isDirectory()) files.push(...inventory(directory, entry));
    else if (stat.isFile()) files.push({ path: entry, sha256: digest(readFileSync(absolute)), size: stat.size });
    else fail(`unsupported filesystem entry: ${entry}`);
  }
  return files;
}

function validatePackage(destination, mapping, item) {
  const runtime = path.join(destination, "runtime");
  const launcher = path.join(destination, "scripts", `${item.logicalName}.mjs`);
  plain(runtime, "directory"); plain(launcher);
  const manifestPath = path.join(runtime, "runtime-manifest.json");
  plain(manifestPath);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const key of ["logicalName", "skill", "app", "sourceEntry", "emittedEntry", "resources", "relatedCommands"]) if (!equal(manifest[key], item[key])) fail(`packaged mapping differs: ${key}`);
  if (manifest.schemaVersion !== 1 || manifest.runtimeMode !== "node-bundled" || manifest.runtimeEntry !== item.emittedEntry || manifest.node !== mapping.node || manifest.notices !== "THIRD_PARTY_NOTICES.md") fail("unsupported packaged runtime manifest");
  const lockBytes = readFileSync(path.join(root, item.app, "package-lock.json"));
  const lock = JSON.parse(lockBytes);
  if (!equal(manifest.sourceLock, { path: `${item.app}/package-lock.json`, sha256: digest(lockBytes), lockfileVersion: 3 }) || lock.lockfileVersion !== 3) fail("packaged source lock differs");
  // The app packager verifies exact locked production closure, package metadata,
  // lifecycle/native exclusions and retained licenses before emitting this inventory.
  const dependencies = Object.entries(lock.packages).filter(([key, record]) => key && !record.dev).map(([key, record]) => ({ name: key.slice("node_modules/".length), version: record.version, integrity: record.integrity })).sort((a, b) => a.name.localeCompare(b.name));
  if (!Array.isArray(manifest.productionDependencies) || !equal([...manifest.productionDependencies].sort((a, b) => a.name.localeCompare(b.name)), dependencies)) fail("packaged production closure differs from lock");
  const actual = inventory(runtime).filter((file) => file.path !== "runtime-manifest.json");
  if (!Array.isArray(manifest.files) || manifest.files.some((file) => !canonical(file.path)) || !equal([...manifest.files].sort((a, b) => a.path.localeCompare(b.path)), [...actual].sort((a, b) => a.path.localeCompare(b.path)))) fail("packaged file inventory or hashes differ");
  if (!actual.some((file) => file.path === item.emittedEntry) || !actual.some((file) => file.path === manifest.notices)) fail("packaged entry or notices missing");
  return { skill: item.logicalName, files: actual.length + 2, dependencies: dependencies.length };
}

function generate(mapping, item) {
  const skillRoot = path.join(root, item.skill);
  const scripts = path.join(skillRoot, "scripts");
  plain(scripts, "directory");
  const runtime = path.join(skillRoot, "runtime");
  const launcher = path.join(scripts, `${item.logicalName}.mjs`);
  const hadRuntime = plain(runtime, "directory", true);
  const hadLauncher = plain(launcher, "file", true);
  // Same-filesystem unique staging; the packager requires a fresh destination.
  const workspace = mkdtempSync(path.join(skillRoot, ".runtime-"));
  const stage = path.join(workspace, "package");
  const runtimeBackup = path.join(workspace, "previous-runtime");
  const launcherBackup = path.join(workspace, "previous-launcher.mjs");
  let runtimeBackedUp = false, launcherBackedUp = false;
  let runtimeInstalled = false, launcherInstalled = false, preserveBackup = false;
  try {
    // Never build here: consumers must use already verified emitted output.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const packaged = spawnSync(process.execPath, [path.join(root, item.app, "scripts/package-runtime.mjs"), stage], { cwd: path.join(root, item.app), env, stdio: "inherit" });
    if (packaged.error) throw packaged.error;
    if (packaged.signal || packaged.status !== 0) fail(`app packaging failed: ${packaged.signal ?? packaged.status}`);
    const result = validatePackage(stage, mapping, item);
    chmodSync(path.join(stage, "scripts", `${item.logicalName}.mjs`), 0o755);
    // Each replacement is an atomic rename, not a crash-atomic two-path exchange.
    // Keep both previous artifacts until the pair is installed; ordinary failures
    // restore both. A failed rollback retains the workspace for manual recovery.
    if (hadRuntime) { renameSync(runtime, runtimeBackup); runtimeBackedUp = true; }
    if (hadLauncher) { renameSync(launcher, launcherBackup); launcherBackedUp = true; }
    renameSync(path.join(stage, "runtime"), runtime); runtimeInstalled = true;
    renameSync(path.join(stage, "scripts", `${item.logicalName}.mjs`), launcher); launcherInstalled = true;
    return result;
  } catch (error) {
    try {
      if (launcherInstalled) rmSync(launcher);
      if (runtimeInstalled) rmSync(runtime, { recursive: true });
      if (launcherBackedUp) renameSync(launcherBackup, launcher);
      if (runtimeBackedUp) renameSync(runtimeBackup, runtime);
    } catch (rollbackError) {
      preserveBackup = true;
      throw new AggregateError([error, rollbackError], `runtime rollback failed; recover retained artifacts from ${workspace}`);
    }
    throw error;
  } finally {
    if (!preserveBackup) rmSync(workspace, { recursive: true, force: true });
  }
}

const { mapping, item } = validateMapping();
console.log(JSON.stringify({ status: "generated", generated: [generate(mapping, item)] }));
