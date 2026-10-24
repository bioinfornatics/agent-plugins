#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, copyFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mappingPath = path.join(root, "config", "skill-runtimes", "skill-runtime-map.json");
const mapping = JSON.parse(readFileSync(mappingPath, "utf8"));
const posix = (value) => value.split(path.sep).join("/");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => { throw new Error(message); };

function plain(relative, kind = "file") {
  if (path.isAbsolute(relative) || relative.split("/").some((part) => !part || part === "." || part === "..")) fail(`non-canonical contained path: ${relative}`);
  const absolute = path.join(root, ...relative.split("/"));
  const stat = lstatSync(absolute, { throwIfNoEntry: false });
  if (!stat || stat.isSymbolicLink() || (kind === "file" ? !stat.isFile() : !stat.isDirectory())) fail(`${relative} must be a plain ${kind}`);
  return absolute;
}

function validateMapping() {
  if (mapping.$schema !== "./skill-runtime-map.schema.json" || mapping.schemaVersion !== 1 || mapping.node !== ">=22.0.0" || !Array.isArray(mapping.skills) || mapping.skills.length !== 4) fail("unsupported runtime mapping contract");
  if (Object.keys(mapping).sort().join() !== ["$schema", "schemaVersion", "node", "skills"].sort().join()) fail("unknown runtime mapping field");
  const expected = ["agent-creator", "hook-creator", "plugin-creator", "skill-creator"];
  const names = mapping.skills.map((item) => item.logicalName);
  if (JSON.stringify(names) !== JSON.stringify(expected)) fail("runtime mappings must contain the four logical names in canonical order");
  for (const item of mapping.skills) {
    const exact = ["logicalName", "skill", "app", "sourceEntry", "emittedEntry", "resources", "relatedCommands"];
    if (Object.keys(item).sort().join() !== exact.sort().join()) fail(`${item.logicalName}: unknown or missing mapping field`);
    if (item.skill !== `skills/${item.logicalName}` || item.app !== `apps/${item.logicalName}-cli`) fail(`${item.logicalName}: logical, Skill, and app names disagree`);
    if (!item.sourceEntry.endsWith(".ts") || !item.emittedEntry.endsWith(".js") || !Array.isArray(item.resources) || !item.relatedCommands || Array.isArray(item.relatedCommands)) fail(`${item.logicalName}: invalid entries, resources, or related commands`);
    for (const [command, target] of Object.entries(item.relatedCommands)) if (command !== target || !mapping.skills.some((candidate) => candidate.logicalName === target) || target === item.logicalName) fail(`${item.logicalName}: invalid related command ${command}`);
    plain(item.skill, "directory"); plain(item.app, "directory");
    plain(`${item.app}/${item.sourceEntry}`); plain(`${item.app}/package.json`); plain(`${item.app}/package-lock.json`);
  }
}

function walk(source, base = source) {
  const files = [];
  for (const entry of readdirSync(source, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name,"en"))) {
    const absolute = path.join(source, entry.name);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) fail(`symlink rejected: ${posix(path.relative(root, absolute))}`);
    if (entry.isDirectory()) files.push(...walk(absolute, base));
    else if (entry.isFile()) files.push({ absolute, relative: posix(path.relative(base, absolute)), mode: stat.mode & 0o777 });
    else fail(`unsupported filesystem entry: ${posix(path.relative(root, absolute))}`);
  }
  return files;
}

function productionClosure(pkg, lock, name) {
  if (lock.lockfileVersion !== 3 || !lock.packages?.[""]) fail(`${name}: npm lockfile v3 is required`);
  const declared = pkg.dependencies ?? {};
  const sortedEntries = (value) => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b,"en")));
  if (JSON.stringify(sortedEntries(lock.packages[""].dependencies ?? {})) !== JSON.stringify(sortedEntries(declared))) fail(`${name}: package and lock production dependencies differ`);
  const selected = new Set();
  const visit = (dependency) => {
    const key = `node_modules/${dependency}`;
    if (selected.has(key)) return;
    const record = lock.packages[key];
    if (!record || record.dev || record.optional) fail(`${name}: production dependency missing from lock: ${dependency}`);
    if (record.hasInstallScript || record.scripts?.preinstall || record.scripts?.install || record.scripts?.postinstall) fail(`${name}: install-script package rejected: ${dependency}`);
    selected.add(key);
    for (const child of Object.keys(record.dependencies ?? {}).sort()) visit(child);
  };
  for (const dependency of Object.keys(declared).sort()) visit(dependency);
  return [...selected].sort();
}

function copyPlainTree(source, destination) {
  for (const file of walk(source)) {
    if (file.relative === ".bin" || file.relative.startsWith(".bin/") || file.relative === ".package-lock.json" || file.relative.endsWith(".ts")) continue;
    if (file.relative.endsWith(".node") || path.basename(file.relative) === "binding.gyp") fail(`native addon rejected: ${posix(path.relative(root, source))}/${file.relative}`);
    const output = path.join(destination, ...file.relative.split("/"));
    mkdirSync(path.dirname(output), { recursive: true });
    copyFileSync(file.absolute, output);
    chmodSync(output, file.mode & 0o111 ? 0o755 : 0o644);
  }
}

function launcherSource(name) {
  return `#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const name=${JSON.stringify(name)};
const major=Number(process.versions.node.split(".")[0]);
if(!Number.isInteger(major)||major<22){console.error(name+": Node.js 22 or newer is required; found "+process.version+" at "+process.execPath);process.exitCode=1;}else{
 const skillRoot=resolve(dirname(fileURLToPath(import.meta.url)),"..");
 const manifestPath=resolve(skillRoot,"runtime/runtime-manifest.json");
 let manifest;
 try{manifest=JSON.parse(readFileSync(manifestPath,"utf8"));}catch(error){console.error(name+": runtime manifest is missing or invalid at "+manifestPath+". Regenerate or reinstall this Skill. "+error.message);process.exitCode=1;}
 if(manifest){const mapped=manifest.runtimeEntry;if(manifest.schemaVersion!==1||manifest.logicalName!==name||typeof mapped!=="string"||isAbsolute(mapped)||mapped.split(/[\\\\/]/).some(part=>!part||part==="."||part==="..")){console.error(name+": runtime manifest has an invalid or unsupported entry mapping at "+manifestPath+". Regenerate or reinstall this Skill.");process.exitCode=1;}else{const entry=resolve(skillRoot,"runtime",...mapped.split("/")),stat=lstatSync(entry,{throwIfNoEntry:false});if(!stat?.isFile()||stat.isSymbolicLink()){console.error(name+": runtime is incomplete; expected a plain emitted CLI at "+entry+". Regenerate or reinstall this Skill.");process.exitCode=1;}else{const child=spawn(process.execPath,[entry,...process.argv.slice(2)],{stdio:"inherit",env:process.env});child.once("error",error=>{console.error(name+": failed to launch contained runtime with "+process.execPath+": "+error.message);process.exitCode=1;});child.once("exit",(code,signal)=>{if(signal){try{process.kill(process.pid,signal);}catch{process.exitCode=1;}}else process.exitCode=code??1;});}}
 }
}
`;
}

function generate(item) {
  const appRoot = plain(item.app, "directory");
  const skillRoot = plain(item.skill, "directory");
  const pkg = JSON.parse(readFileSync(path.join(appRoot, "package.json"), "utf8"));
  const lockBytes = readFileSync(path.join(appRoot, "package-lock.json"));
  const lock = JSON.parse(lockBytes);
  const closure = productionClosure(pkg, lock, item.logicalName);
  const vendorRoot = plain(`${item.app}/vendor`, "directory");
  const vendorManifest = JSON.parse(readFileSync(path.join(vendorRoot, "manifest.json"), "utf8"));
  const expectedPackages = closure.map((key) => key.slice("node_modules/".length));
  if (!Array.isArray(vendorManifest.packages)) fail(`${item.logicalName}: vendor manifest packages must be an array`);
  const manifested = vendorManifest.packages.map((entry) => entry.name).sort();
  if (JSON.stringify(manifested) !== JSON.stringify(expectedPackages)) fail(`${item.logicalName}: vendor manifest is not the exact production lock closure`);
  for (const key of closure) {
    const dependency = key.slice("node_modules/".length);
    const record = lock.packages[key];
    if (typeof record.integrity !== "string" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(record.integrity)) fail(`${item.logicalName}: ${dependency} has no exact sha512 lock integrity`);
    if (typeof record.license !== "string" || !record.license.trim()) fail(`${item.logicalName}: ${dependency} has no lock license`);
    const manifestEntries = vendorManifest.packages.filter((entry) => entry.name === dependency);
    if (manifestEntries.length !== 1 || manifestEntries[0].version !== record.version || manifestEntries[0].license !== record.license) fail(`${item.logicalName}: vendor manifest metadata differs from lock for ${dependency}`);
    const source = path.join(vendorRoot, key);
    const packageJson = path.join(source, "package.json");
    const stat = lstatSync(packageJson, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.isSymbolicLink()) fail(`${item.logicalName}: missing plain vendored package ${dependency}`);
    const vendored = JSON.parse(readFileSync(packageJson, "utf8"));
    if (vendored.name !== dependency || vendored.version !== record.version || vendored.license !== record.license) fail(`${item.logicalName}: vendored ${dependency} metadata differs from lock`);
    for (const lifecycle of ["preinstall", "install", "postinstall"]) if (vendored.scripts?.[lifecycle]) fail(`${item.logicalName}: vendored ${dependency} contains a ${lifecycle} script`);
  }

  const runtime = path.join(skillRoot, "runtime");
  const temporary = path.join(skillRoot, `.runtime-${process.pid}.tmp`);
  rmSync(temporary, { recursive: true, force: true });
  mkdirSync(temporary);
  try {
  copyPlainTree(plain(`${item.app}/dist`, "directory"), path.join(temporary, "dist"));
  plain(`${item.app}/${item.emittedEntry}`);
  for (const resource of item.resources) plain(`${item.app}/${resource}`);
  for (const key of closure) copyPlainTree(path.join(vendorRoot, key), path.join(temporary, key));
  copyFileSync(path.join(skillRoot, "THIRD_PARTY_NOTICES.md"), path.join(temporary, "THIRD_PARTY_NOTICES.md"));
  writeFileSync(path.join(temporary, "package.json"), `${JSON.stringify({ name: `${item.logicalName}-skill-runtime`, private: true, type: "module", engines: { node: mapping.node } }, null, 2)}\n`);
  const relatedCommandMap = { schemaVersion: 1, commands: {} };
  for (const [command, target] of Object.entries(item.relatedCommands)) {
    const targetItem = mapping.skills.find((candidate) => candidate.logicalName === target);
    if (!targetItem) fail(`${item.logicalName}: missing related command target ${target}`);
    const sourceRuntime = plain(`${targetItem.skill}/runtime`, "directory");
    copyPlainTree(sourceRuntime, path.join(temporary, "related", target));
    rmSync(path.join(temporary, "related", target, "runtime-manifest.json"), { force: true });
    relatedCommandMap.commands[command] = `related/${target}/${targetItem.emittedEntry}`;
  }
  if (Object.keys(relatedCommandMap.commands).length) writeFileSync(path.join(temporary, "related-command-map.json"), `${JSON.stringify(relatedCommandMap, null, 2)}\n`);

  const files = walk(temporary).map((file) => ({ path: file.relative, sha256: digest(readFileSync(file.absolute)), size: lstatSync(file.absolute).size }));
  const manifest = {
    schemaVersion: 1,
    runtimeMode: "node-bundled",
    logicalName: item.logicalName,
    skill: item.skill,
    app: item.app,
    sourceEntry: item.sourceEntry,
    emittedEntry: item.emittedEntry,
    runtimeEntry: item.emittedEntry,
    node: mapping.node,
    sourceLock: { path: `${item.app}/package-lock.json`, sha256: digest(lockBytes), lockfileVersion: lock.lockfileVersion },
    productionDependencies: closure.map((key) => ({ name: key.slice("node_modules/".length), version: lock.packages[key].version, integrity: lock.packages[key].integrity ?? null })),
    resources: [...item.resources].sort(),
    relatedCommands: relatedCommandMap.commands,
    notices: "THIRD_PARTY_NOTICES.md",
    files,
  };
  writeFileSync(path.join(temporary, "runtime-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  rmSync(runtime, { recursive: true, force: true });
  renameSync(temporary, runtime);
  const scriptsDirectory = path.join(skillRoot, "scripts");
  mkdirSync(scriptsDirectory, { recursive: true });
  const launcher = path.join(scriptsDirectory, `${item.logicalName}.mjs`);
  writeFileSync(launcher, launcherSource(item.logicalName));
  chmodSync(launcher, 0o755);
  return { skill: item.logicalName, files: files.length + 2, dependencies: closure.length };
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

validateMapping();
const generatedByName = new Map();
for (const item of mapping.skills.filter((candidate) => candidate.logicalName !== "plugin-creator")) generatedByName.set(item.logicalName, generate(item));
const plugin = mapping.skills.find((candidate) => candidate.logicalName === "plugin-creator");
if (plugin) generatedByName.set(plugin.logicalName, generate(plugin));
const generated = mapping.skills.map((item) => generatedByName.get(item.logicalName));
console.log(JSON.stringify({ status: "generated", generated }));
