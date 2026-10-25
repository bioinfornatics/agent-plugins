import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAP = JSON.parse(readFileSync(join(ROOT, "config", "skill-runtimes", "skill-runtime-map.json"), "utf8"));
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

const MAX_RUNTIME_BYTES = 8 * 1024 * 1024;
const MAX_RUNTIME_FILES = 750;
const MAX_RUNTIME_FILE_BYTES = 512 * 1024;

function files(root: string): Array<{ path: string; sha256: string; size: number }> {
  const result: Array<{ path: string; sha256: string; size: number }> = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(directory, entry.name), stat = lstatSync(absolute);
      assert.equal(stat.isSymbolicLink(), false, `runtime symlink: ${absolute}`);
      if (entry.isDirectory()) walk(absolute);
      else {
        assert.equal(entry.isFile(), true, `unsupported runtime entry: ${absolute}`);
        assert.notEqual(entry.name.endsWith(".ts"), true, `raw TypeScript: ${absolute}`);
        assert.notEqual(entry.name.endsWith(".node"), true, `native addon: ${absolute}`);
        assert.notEqual(entry.name, "binding.gyp", `native build input: ${absolute}`);
        assert.ok(stat.size <= MAX_RUNTIME_FILE_BYTES, `oversized runtime file: ${absolute} (${stat.size} bytes)`);
        assert.ok(stat.mode & 0o111 ? (stat.mode & 0o777) === 0o755 : (stat.mode & 0o777) === 0o644, `unsafe runtime mode: ${absolute}`);
        result.push({ path: relative(root, absolute).split(sep).join("/"), sha256: sha(readFileSync(absolute)), size: stat.size });
      }
    }
  };
  walk(root);
  return result;
}

function runGenerator() {
  const result = spawnSync(process.execPath, [join(ROOT, "scripts", "generate-skill-runtimes.mjs")], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("canonical mapping explicitly links Skill, app, TS source, and JS output", () => {
  assert.equal(MAP.schemaVersion, 1);
  assert.equal(MAP.node, ">=22.0.0");
  assert.deepEqual(MAP.skills.map((x: any) => x.logicalName), ["agent-creator", "hook-creator", "plugin-creator", "skill-creator"]);
  for (const item of MAP.skills) {
    assert.equal(item.skill, `skills/${item.logicalName}`);
    assert.equal(item.app, `apps/${item.logicalName}-cli`);
    assert.match(item.sourceEntry, /^scripts\/.+\.ts$/);
    assert.match(item.emittedEntry, /^dist\/.+\.js$/);
  }
});

test("generation is byte-deterministic and runtimes are closed, hashed distributions", () => {
  runGenerator();
  const first = new Map<string, Array<{ path: string; sha256: string; size: number }>>();
  for (const item of MAP.skills) first.set(item.logicalName, files(join(ROOT, item.skill, "runtime")));
  runGenerator();
  for (const item of MAP.skills) {
    const runtime = join(ROOT, item.skill, "runtime");
    const runtimeFiles = files(runtime);
    assert.deepEqual(runtimeFiles, first.get(item.logicalName), item.logicalName);
    assert.ok(runtimeFiles.length <= MAX_RUNTIME_FILES, `${item.logicalName}: runtime file budget exceeded`);
    assert.ok(runtimeFiles.reduce((total, file) => total + file.size, 0) <= MAX_RUNTIME_BYTES, `${item.logicalName}: runtime byte budget exceeded`);
    const manifest = JSON.parse(readFileSync(join(runtime, "runtime-manifest.json"), "utf8"));
    const appLock = JSON.parse(readFileSync(join(ROOT, item.app, "package-lock.json"), "utf8"));
    assert.equal(manifest.runtimeMode, "node-bundled");
    assert.equal(manifest.sourceEntry, item.sourceEntry);
    assert.equal(manifest.emittedEntry, item.emittedEntry);
    assert.equal(manifest.runtimeEntry, item.emittedEntry);
    assert.equal(lstatSync(join(runtime, ...item.emittedEntry.split("/"))).isFile(), true);
    assert.equal(manifest.sourceLock.sha256, sha(readFileSync(join(ROOT, item.app, "package-lock.json"))));
    const expected = new Set<string>();
    const visit = (name: string) => { const key = `node_modules/${name}`; if (expected.has(name)) return; const record = appLock.packages[key]; assert.ok(record && !record.dev && !record.optional); expected.add(name); for (const child of Object.keys(record.dependencies ?? {})) visit(child); };
    for (const dependency of Object.keys(appLock.packages[""].dependencies ?? {})) visit(dependency);
    assert.deepEqual(manifest.productionDependencies.map((x: any) => x.name).sort(), [...expected].sort());
    const vendorManifest = JSON.parse(readFileSync(join(ROOT, item.app, "vendor", "manifest.json"), "utf8"));
    for (const dependency of manifest.productionDependencies) {
      assert.match(dependency.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/, `${item.logicalName}/${dependency.name}: lock integrity`);
      const lockRecord = appLock.packages[`node_modules/${dependency.name}`];
      const vendored = JSON.parse(readFileSync(join(runtime, "node_modules", ...dependency.name.split("/"), "package.json"), "utf8"));
      const declared = vendorManifest.packages.filter((entry: any) => entry.name === dependency.name);
      assert.equal(dependency.version, lockRecord.version);
      assert.equal(dependency.integrity, lockRecord.integrity);
      assert.equal(declared.length, 1, `${item.logicalName}/${dependency.name}: unique vendor declaration`);
      assert.deepEqual(declared[0], { name: dependency.name, version: lockRecord.version, license: lockRecord.license });
      assert.equal(vendored.license, lockRecord.license);
      for (const lifecycle of ["preinstall", "install", "postinstall"]) assert.equal(vendored.scripts?.[lifecycle], undefined, `${item.logicalName}/${dependency.name}: ${lifecycle}`);
    }
    for (const file of manifest.files) assert.equal(sha(readFileSync(join(runtime, ...file.path.split("/")))), file.sha256, `${item.logicalName}/${file.path}`);
    assert.equal(readFileSync(join(runtime, "package.json"), "utf8").includes('"type": "module"'), true);
    for (const dependency of manifest.productionDependencies) assert.equal(lstatSync(join(runtime, "node_modules", ...dependency.name.split("/"), "package.json")).isFile(), true);
    const loaders = manifest.files.filter((file: any) => file.path.endsWith("runtime-deps.js"));
    for (const loader of loaders) {
      const source = readFileSync(join(runtime, ...loader.path.split("/")), "utf8");
      assert.doesNotMatch(source, /requireFromHere\(name\)/, `${item.logicalName}: ambient package lookup`);
    }
    assert.equal(lstatSync(join(runtime, "THIRD_PARTY_NOTICES.md")).isFile(), true);
  }
});

test("generation succeeds twice from an archive of the current candidate index", { timeout: 120_000 }, () => {
  const temp = mkdtempSync(join(tmpdir(), "skill-runtime-git-archive-"));
  try {
    const archive = join(temp, "repository.tar"), extracted = join(temp, "extracted"), index = join(temp, "candidate.index");
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", HOME: temp, GIT_INDEX_FILE: index };
    const git = (args: string[]) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8", env });
    let result = git(["read-tree", "HEAD"]); assert.equal(result.status, 0, result.stderr || result.stdout);
    result = git(["add", "-A"]); assert.equal(result.status, 0, result.stderr || result.stdout);
    const tree = git(["write-tree"]); assert.equal(tree.status, 0, tree.stderr || tree.stdout);
    result = git(["archive", "--format=tar", "-o", archive, tree.stdout.trim()]); assert.equal(result.status, 0, result.stderr || result.stdout);
    mkdirSync(extracted);
    const unpack = spawnSync("tar", ["-xf", archive, "-C", extracted], { encoding: "utf8" });
    assert.equal(unpack.status, 0, unpack.stderr);
    assert.equal(existsSync(join(extracted, "apps", "skill-creator-cli", "node_modules")), false);
    for (const item of MAP.skills) {
      assert.equal(existsSync(join(extracted, item.skill, "runtime", "runtime-manifest.json")), true, item.logicalName + " runtime absent from candidate index");
      assert.equal(existsSync(join(extracted, item.skill, "scripts", item.logicalName + ".mjs")), true, item.logicalName + " launcher absent from candidate index");
    }
    const generate = () => spawnSync(process.execPath, [join(extracted, "scripts", "generate-skill-runtimes.mjs")], { cwd: temp, encoding: "utf8" });
    const firstRun = generate(); assert.equal(firstRun.status, 0, firstRun.stderr || firstRun.stdout);
    const first = new Map(MAP.skills.map((item: any) => [item.logicalName, files(join(extracted, item.skill, "runtime"))]));
    const secondRun = generate(); assert.equal(secondRun.status, 0, secondRun.stderr || secondRun.stdout);
    for (const item of MAP.skills) assert.deepEqual(files(join(extracted, item.skill, "runtime")), first.get(item.logicalName), item.logicalName);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("generated launchers run copied Skills from hostile unrelated environments", { timeout: 120_000 }, () => {
  runGenerator();
  const temp = mkdtempSync(join(tmpdir(), "portable Skill launchers "));
  try {
    const cwd = join(temp, "unrelated cwd with spaces"), hostile = join(temp, "hostile node modules");
    mkdirSync(cwd); mkdirSync(hostile);
    for (const item of MAP.skills) {
      const copied = join(temp, `copied ${item.logicalName} Skill`);
      cpSync(join(ROOT, item.skill), copied, { recursive: true });
      const launcher = join(copied, "scripts", `${item.logicalName}.mjs`);
      const result = spawnSync(process.execPath, [launcher, "--help"], { cwd, env: { ...process.env, PATH: "", NODE_PATH: hostile }, encoding: "utf8", input: "preserved stdin\n" });
      assert.equal(result.status, 0, `${item.logicalName}: ${result.stderr || result.stdout}`);
      assert.match(result.stdout, /Usage:/);
      assert.equal(result.stderr, "");
      const source = readFileSync(launcher, "utf8");
      assert.doesNotMatch(source, /apps\//);
      assert.match(source, /process\.execPath/);
      assert.match(source, /stdio:"inherit"/);
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("launchers and related dispatch fail actionably for incomplete copied runtimes", () => {
  runGenerator();
  const temp = mkdtempSync(join(tmpdir(), "portable-errors-"));
  try {
    const copied = join(temp, "plugin Skill");
    cpSync(join(ROOT, "skills", "plugin-creator"), copied, { recursive: true });
    const launcher = join(copied, "scripts", "plugin-creator.mjs"), manifest = join(copied, "runtime", "runtime-manifest.json");
    rmSync(manifest);
    let result = spawnSync(process.execPath, [launcher, "--help"], { cwd: temp, encoding: "utf8", env: { ...process.env, PATH: "", NODE_PATH: join(temp, "hostile") } });
    assert.equal(result.status, 1); assert.equal(result.stdout, ""); assert.match(result.stderr, /runtime manifest is missing or invalid.*Regenerate or reinstall/s);
    cpSync(join(ROOT, "skills", "plugin-creator", "runtime", "runtime-manifest.json"), manifest);
    rmSync(join(copied, "runtime", "related-command-map.json"));
    const plugin = join(temp, "demo"); mkdirSync(join(plugin, "skills", "alpha"), { recursive: true });
    readFileSync(join(ROOT, "skills", "plugin-creator", "runtime", "dist", "scripts", "cli.js"));
    // A syntactically invalid plugin is enough to reach full-eval context and mapped command resolution.
    const sourcePlugin = join(ROOT, "apps", "plugin-creator-cli", "tests", "fixtures", "minimal-plugin");
    if (existsSync(sourcePlugin)) cpSync(sourcePlugin, plugin, { recursive: true });
    else { writeFileSync(join(plugin, "plugin.json"), JSON.stringify({ $schema:"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name:"demo", version:"1.0.0", description:"Demo" })); writeFileSync(join(plugin, "skills", "alpha", "SKILL.md"), "---\nname: alpha\ndescription: Alpha skill for testing.\n---\n"); }
    result = spawnSync(process.execPath, [launcher, "full-eval", plugin, "--workspace", join(plugin, "evaluations", "work"), "--dry-run", "--format", "json"], { cwd: temp, encoding: "utf8", env: { ...process.env, PATH: "", NODE_PATH: join(temp, "hostile") } });
    assert.equal(result.status, 1); assert.match(result.stderr, /Related-command map is missing.*Regenerate or reinstall/s);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("copied plugin Skill dispatches full-eval and golden journeys through contained runtimes", { timeout: 120_000 }, () => {
  runGenerator();
  const temp = mkdtempSync(join(tmpdir(), "cross app Skill "));
  try {
    const copied = join(temp, "plugin creator copied"), cwd = join(temp, "foreign cwd"), plugin = join(temp, "demo plugin");
    cpSync(join(ROOT, "skills", "plugin-creator"), copied, { recursive: true }); mkdirSync(cwd); mkdirSync(join(plugin, "skills", "alpha"), { recursive: true });
    writeFileSync(join(plugin, "plugin.json"), JSON.stringify({ $schema:"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name:"demo-plugin", version:"1.0.0", description:"Demo plugin" }));
    writeFileSync(join(plugin, "skills", "alpha", "SKILL.md"), "---\nname: alpha\ndescription: Handles alpha review tasks when requested.\n---\n");
    const launcher = join(copied, "scripts", "plugin-creator.mjs"), env = { ...process.env, PATH: "", NODE_PATH: join(temp, "hostile") };
    let result = spawnSync(process.execPath, [launcher, "full-eval", plugin, "--workspace", join(plugin, "evaluations", "work"), "--dry-run", "--format", "json"], { cwd, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr); const planned = JSON.parse(result.stdout), action = planned.components.find((x: any) => x.name === "alpha")?.command;
    assert.ok(action); assert.match(action, /related[/\\]skill-creator[/\\]dist[/\\]scripts[/\\]cli\.js/); assert.doesNotMatch(action, /apps[/\\]skill-creator-cli/);
    result = spawnSync(process.execPath, [launcher, "golden-e2e", "--journey", "idea-api-review-skill", "--workspace", join(temp, "golden workspace"), "--profile", "novice"], { cwd, env, encoding: "utf8", timeout: 60_000 });
    assert.equal(result.status, 4, result.stderr); assert.match(result.stdout, /pending-production-approval/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
