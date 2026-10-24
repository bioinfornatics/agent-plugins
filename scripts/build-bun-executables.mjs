import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { commandOutput } from "./command-output.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(path.join(root, "bun-release.json"), "utf8"));
const nativeProfile = config.runtimeProfiles?.native;
if (nativeProfile?.mode !== "native-bun" || !Array.isArray(nativeProfile.excludedSkillEntries) || !nativeProfile.excludedSkillEntries.includes("runtime") || !nativeProfile.excludedSkillEntries.includes("node_modules") || !Array.isArray(nativeProfile.excludedScriptSuffixes) || !nativeProfile.excludedScriptSuffixes.includes(".mjs")) throw new Error("bun-release.json must define the native-bun exclusion profile");
let cli;
try { cli = commandOutput(process.argv.slice(2), root); }
catch (error) { console.error(`Failed: ${error.message}`); process.exit(1); }

function fail(message) { cli.fail(message); }
function option(name) {
  const args = process.argv.slice(2), prefix = `${name}=`;
  const inline = args.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
const buildArgsInput = process.argv.slice(2);
const known = new Set(["--target", "--output", "--format", "--progress", "--verbose", "--log", "--log-file"]);
for (let i = 0; i < buildArgsInput.length; i++) {
  const key = buildArgsInput[i].split("=")[0];
  if (!known.has(key)) fail(`unknown option: ${buildArgsInput[i]}`);
  if (["--target", "--output", "--format", "--progress", "--log", "--log-file"].includes(key) && !buildArgsInput[i].includes("=")) i += 1;
}

function walk(directory, base = directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) fail(`symbolic links are not portable: ${path.relative(root, absolute)}`);
    if (entry.isDirectory()) files.push(...walk(absolute, base));
    else if (entry.isFile()) files.push({ absolute, relative: path.relative(base, absolute).split(path.sep).join("/") });
    else fail(`unsupported portable entry: ${path.relative(root, absolute)}`);
  }
  return files;
}
function inventory(directory) {
  const entries = [];
  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(directory, absolute).split(path.sep).join("/");
      const stat = lstatSync(absolute);
      if (entry.isSymbolicLink()) fail(`symbolic links are not portable: ${path.relative(root, absolute)}`);
      if (entry.isDirectory()) {
        entries.push({ path: `${relative}/`, mode: (stat.mode & 0o777).toString(8).padStart(3, "0") });
        visit(absolute);
      } else if (entry.isFile()) {
        entries.push({ path: relative, mode: (stat.mode & 0o777).toString(8).padStart(3, "0"), size: stat.size, sha256: createHash("sha256").update(readFileSync(absolute)).digest("hex") });
      } else fail(`unsupported portable entry: ${path.relative(root, absolute)}`);
    }
  }
  visit(directory);
  return entries;
}
function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function copyTree(source, destination) {
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) fail(`symbolic links are not portable: ${path.relative(root, source)}`);
  if (stat.isDirectory()) {
    mkdirSync(destination, { recursive: true, mode: stat.mode & 0o777 });
    chmodSync(destination, stat.mode & 0o777);
    for (const entry of readdirSync(source, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      copyTree(path.join(source, entry.name), path.join(destination, entry.name));
    }
  } else if (stat.isFile()) {
    // Fixture materializers are source-test helpers, not native runtime assets.
    if (nativeProfile.excludedScriptSuffixes.some(suffix => source.endsWith(suffix))) return;
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    chmodSync(destination, stat.mode & 0o777);
  } else fail(`unsupported portable entry: ${path.relative(root, source)}`);
}
function copyPortable(source, destination) {
  for (const entry of config.portableSkillEntries) if (nativeProfile.excludedSkillEntries.includes(entry) || entry === "scripts") fail("native-bun profile cannot copy source runtime entry: " + entry);
  mkdirSync(destination, { recursive: true, mode: 0o755 });
  chmodSync(destination, 0o755);
  for (const entry of config.portableSkillEntries) {
    const from = path.join(source, entry);
    let stat;
    try { stat = lstatSync(from); } catch (error) { if (error?.code === "ENOENT") continue; throw error; }
    copyTree(from, path.join(destination, entry));
  }
}

const bun = process.env.BUN_EXECUTABLE || "bun";
const version = spawnSync(bun, ["--version"], { encoding: "utf8" });
if (version.error) fail(`cannot execute Bun at ${bun}: ${version.error.message}`);
if (version.status !== 0) fail(`Bun version check failed: ${(version.stderr || version.stdout).trim()}`);
if (version.stdout.trim() !== config.bunVersion) fail(`Bun ${config.bunVersion} is required; found ${version.stdout.trim() || "unknown"}`);

const platformKey = `${process.platform}-${process.arch}`;
const target = option("--target") || config.targets[platformKey];
if (!target) fail(`no pinned Bun target for ${platformKey}; pass --target=<pinned target>`);
const releaseKey = Object.entries(config.targets).find(([, value]) => value === target)?.[0];
if (!releaseKey) fail(`target ${target} is not pinned in bun-release.json`);
const outputRoot = path.resolve(option("--output") || path.join(root, config.stagingRoot));
const skillNames = config.skills;
if (!Array.isArray(skillNames) || !skillNames.length || skillNames.some((name) => typeof name !== "string") || new Set(skillNames).size !== skillNames.length || Object.keys(config.executables).some((name) => !skillNames.includes(name))) fail("bun-release.json must declare every unique packaged Skill and every executable Skill");
const sourceSkills = skillNames.map((name) => path.join(root, "skills", name));
if (sourceSkills.some((directory) => outputRoot === directory || outputRoot.startsWith(directory + path.sep))) {
  fail("release staging must be outside source skill directories");
}
const finalStage = path.join(outputRoot, releaseKey);
const temporaryStage = path.join(outputRoot, `.${releaseKey}.tmp-${process.pid}`);
try { cli.prepareLog([{ path: outputRoot, label: "staging output" }, ...sourceSkills.map((source) => ({ path: source, label: "source" }))]); }
catch (error) { console.error(`Failed: ${error.message}`); process.exit(1); }
const sourceBefore = sourceSkills.map((directory) => ({ skill: path.basename(directory), inventory: inventory(directory) }));

rmSync(temporaryStage, { recursive: true, force: true });
mkdirSync(path.join(temporaryStage, "skills"), { recursive: true, mode: 0o755 });
for (const entry of config.portablePluginEntries) copyTree(path.join(root, entry), path.join(temporaryStage, entry));
const stagedPluginPath = path.join(temporaryStage, "plugin.json");
const stagedPlugin = JSON.parse(readFileSync(stagedPluginPath, "utf8"));
stagedPlugin.extensions ??= {};
stagedPlugin.extensions["io.github.bioinfornatics.agent-plugins.runtime"] = { schemaVersion: 1, mode: nativeProfile.mode, executables: "skills/<creator>/scripts/<creator>[.exe]", commands: Object.keys(config.executables) };
writeFileSync(stagedPluginPath, JSON.stringify(stagedPlugin, null, 2) + "\n", { mode: 0o644 });
chmodSync(temporaryStage, 0o755);
chmodSync(path.join(temporaryStage, "skills"), 0o755);
try {
  for (const name of skillNames) copyPortable(path.join(root, "skills", name), path.join(temporaryStage, "skills", name));
  let creatorIndex = 0;
  for (const [name, relativeEntry] of Object.entries(config.executables)) {
    creatorIndex += 1;
    const progress = `  [${creatorIndex}/${Object.keys(config.executables).length}] ${name}`;
    cli.write(progress);
    if (cli.progress === "creators" || cli.progress === "auto") console.log(progress);
    const skillStage = path.join(temporaryStage, "skills", name);
    const scripts = path.join(skillStage, "scripts"); mkdirSync(scripts, { recursive: true, mode: 0o755 }); chmodSync(scripts, 0o755);
    const output = path.join(scripts, name + (target.startsWith("bun-windows-") ? ".exe" : ""));
    const buildArgs = ["build", "--compile", `--target=${target}`, `--outfile=${output}`, path.join(root, relativeEntry)];
    cli.write(`$ ${bun} ${buildArgs.join(" ")}`);
    const result = spawnSync(bun, buildArgs, { cwd: root, encoding: "utf8" });
    if (result.stdout) cli.detail(result.stdout, "stdout");
    if (result.stderr) cli.detail(result.stderr, "stderr");
    if (result.error) fail(`failed to build ${name}: ${result.error.message}`);
    if (result.status !== 0) cli.fail(`failed to build ${name}`, result.status ?? 1);
    chmodSync(output, 0o755);
  }
  const sourceAfter = sourceSkills.map((directory) => ({ skill: path.basename(directory), inventory: inventory(directory) }));
  if (digest(sourceAfter) !== digest(sourceBefore)) fail("source skills changed while assembling release staging");
  const stageInventory = inventory(temporaryStage);
  const manifest = { schemaVersion: 1, runtimeMode: nativeProfile.mode, releaseKey, bunTarget: target, bunVersion: config.bunVersion, files: stageInventory.filter((entry) => !entry.path.endsWith("/")) };
  writeFileSync(path.join(temporaryStage, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  const validatedInventory = inventory(temporaryStage);
  rmSync(finalStage, { recursive: true, force: true });
  renameSync(temporaryStage, finalStage);
  const result = { status: "staged", target, releaseKey, staging: finalStage, sourceSkillsSha256: digest(sourceBefore), inventorySha256: digest(validatedInventory), files: validatedInventory.length };
  cli.write(JSON.stringify(result));
  cli.emit({ ...result, human: `Staged: ${cli.relative(finalStage)}` });
} finally { rmSync(temporaryStage, { recursive: true, force: true }); }
