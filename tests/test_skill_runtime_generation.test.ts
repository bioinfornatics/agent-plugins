import { after, test } from "node:test";
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

function files(root: string): Array<{ path: string; sha256: string; size: number; mode: number }> {
  const result: Array<{ path: string; sha256: string; size: number; mode: number }> = [];
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
        result.push({ path: relative(root, absolute).split(sep).join("/"), sha256: sha(readFileSync(absolute)), size: stat.size, mode: stat.mode & 0o777 });
      }
    }
  };
  walk(root);
  return result;
}

function runGenerator(root: string) {
  const result = spawnSync(process.execPath, [join(root, "scripts", "generate-skill-runtimes.mjs")], { cwd: tmpdir(), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

// Generated twice from the current candidate; consumers only mutate per-case copies.
let fixture: { root: string; first: Map<string, ReturnType<typeof files>> } | undefined;
let fixtureTemp: string | undefined;
const committed = new Map(MAP.skills.map((item: any) => [item.logicalName, {
  files: files(join(ROOT, item.skill, "runtime")),
  launcher: sha(readFileSync(join(ROOT, item.skill, "scripts", item.logicalName + ".mjs")))
}]));
function generatedFixture() {
  if (fixture) return fixture;
  const temp = fixtureTemp = mkdtempSync(join(tmpdir(), "skill-runtime-isolated-source-"));
  try {
    const extracted = join(temp, "extracted");
    // Copy the candidate without Git/index writes or ambient development modules.
    cpSync(ROOT, extracted, { recursive: true, filter: (path) => {
      const parts = relative(ROOT, path).split(sep);
      return !parts.some(part => [".git", ".artifacts", ".beads"].includes(part)) && !(parts.includes("node_modules") && parts[0] !== "vendor" && !parts.includes("runtime"));
    } });
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const prepare = spawnSync(process.execPath, [join(extracted, "scripts/prepare-development.mjs")], { cwd: extracted, env, encoding: "utf8" });
    assert.equal(prepare.status, 0, "clean dependency preparation failed: " + prepare.stderr + prepare.stdout);
    const build = spawnSync(process.execPath, [join(extracted, "apps/agent-plugin/scripts/build.mjs")], { cwd: extracted, env, encoding: "utf8" });
    assert.equal(build.status, 0, "isolated agent-plugin build failed after prepare-development.mjs: " + build.stderr + build.stdout);
    runGenerator(extracted);
    const first = new Map<string, ReturnType<typeof files>>(MAP.skills.map((item: any) => [item.logicalName, files(join(extracted, item.skill, "runtime"))]));
    const firstLauncher = sha(readFileSync(join(extracted, "skills/skill-creator/scripts/skill-creator.mjs")));
    runGenerator(extracted);
    assert.equal(sha(readFileSync(join(extracted, "skills/skill-creator/scripts/skill-creator.mjs"))), firstLauncher);
    for (const item of MAP.skills) assert.deepEqual(files(join(extracted, item.skill, "runtime")), first.get(item.logicalName), item.logicalName);
    fixture = { root: extracted, first };
    return fixture;
  } catch (error) {
    rmSync(temp, { recursive: true, force: true }); fixtureTemp = undefined;
    throw error;
  }
}
after(() => {
  try {
    for (const item of MAP.skills) {
      assert.deepEqual(files(join(ROOT, item.skill, "runtime")), committed.get(item.logicalName).files, item.logicalName + " committed runtime changed");
      assert.equal(sha(readFileSync(join(ROOT, item.skill, "scripts", item.logicalName + ".mjs"))), committed.get(item.logicalName).launcher);
      if (fixture) assert.deepEqual(files(join(fixture.root, item.skill, "runtime")), fixture.first.get(item.logicalName), item.logicalName + " shared fixture changed");
    }
  } finally { if (fixtureTemp) rmSync(fixtureTemp, { recursive: true, force: true }); }
});

test("canonical mapping explicitly links Skill, app, TS source, and JS output", () => {
  assert.equal(MAP.schemaVersion, 1);
  assert.equal(MAP.node, ">=22.22.2");
  assert.deepEqual(MAP.skills.map((x: any) => x.logicalName), ["skill-creator"]);
  for (const item of MAP.skills) {
    assert.equal(item.skill, `skills/${item.logicalName}`);
    assert.equal(item.app, "apps/agent-plugin");
    assert.match(item.sourceEntry, /^src\/index\.ts$/);
    assert.match(item.emittedEntry, /^dist\/index\.js$/);
  }
});

test("generation is byte-deterministic and runtimes are closed, hashed distributions", () => {
  const { root, first } = generatedFixture();
  for (const item of MAP.skills) {
    const runtime = join(root, item.skill, "runtime");
    const runtimeFiles = files(runtime);
    assert.deepEqual(runtimeFiles, first.get(item.logicalName), item.logicalName);
    assert.ok(runtimeFiles.length <= MAX_RUNTIME_FILES, `${item.logicalName}: runtime file budget exceeded`);
    assert.ok(runtimeFiles.reduce((total, file) => total + file.size, 0) <= MAX_RUNTIME_BYTES, `${item.logicalName}: runtime byte budget exceeded`);
    const manifest = JSON.parse(readFileSync(join(runtime, "runtime-manifest.json"), "utf8"));
    const appLock = JSON.parse(readFileSync(join(root, item.app, "package-lock.json"), "utf8"));
    assert.equal(manifest.runtimeMode, "node-bundled");
    assert.equal(manifest.sourceEntry, item.sourceEntry);
    assert.equal(manifest.emittedEntry, item.emittedEntry);
    assert.equal(manifest.runtimeEntry, item.emittedEntry);
    assert.equal(lstatSync(join(runtime, ...item.emittedEntry.split("/"))).isFile(), true);
    assert.equal(manifest.sourceLock.sha256, sha(readFileSync(join(root, item.app, "package-lock.json"))));
    const expected = new Set<string>();
    const visit = (name: string) => { const key = `node_modules/${name}`; if (expected.has(name)) return; const record = appLock.packages[key]; assert.ok(record && !record.dev && !record.optional); expected.add(name); for (const child of Object.keys(record.dependencies ?? {})) visit(child); };
    for (const dependency of Object.keys(appLock.packages[""].dependencies ?? {})) visit(dependency);
    assert.deepEqual(manifest.productionDependencies.map((x: any) => x.name).sort(), [...expected].sort());
    for (const dependency of manifest.productionDependencies) {
      const record = appLock.packages[`node_modules/${dependency.name}`];
      const packaged = JSON.parse(readFileSync(join(runtime, "node_modules", ...dependency.name.split("/"), "package.json"), "utf8"));
      assert.equal(dependency.version, record.version);
      assert.equal(dependency.integrity, record.integrity);
      assert.match(dependency.integrity, /^sha512-/);
      assert.equal(packaged.license, record.license);
      for (const lifecycle of ["preinstall", "install", "postinstall"]) assert.equal(packaged.scripts?.[lifecycle], undefined);
    }
    assert.equal(manifest.node, ">=22.22.2");
    assert.deepEqual(manifest.resources, []);
    assert.deepEqual(manifest.relatedCommands, {});
    assert.deepEqual(manifest.files.map((file: any) => file.path).sort(), runtimeFiles.filter(file => file.path !== "runtime-manifest.json").map(file => file.path).sort());
    for (const file of manifest.files) assert.equal(sha(readFileSync(join(runtime, ...file.path.split("/")))), file.sha256, `${item.logicalName}/${file.path}`);
    assert.equal(JSON.parse(readFileSync(join(runtime, "package.json"), "utf8")).type, "module");
    for (const dependency of manifest.productionDependencies) assert.equal(lstatSync(join(runtime, "node_modules", ...dependency.name.split("/"), "package.json")).isFile(), true);
    const loaders = manifest.files.filter((file: any) => file.path.endsWith("runtime-deps.js"));
    for (const loader of loaders) {
      const source = readFileSync(join(runtime, ...loader.path.split("/")), "utf8");
      assert.doesNotMatch(source, /requireFromHere\(name\)/, `${item.logicalName}: ambient package lookup`);
    }
    assert.equal(lstatSync(join(runtime, "THIRD_PARTY_NOTICES.md")).isFile(), true);
  }
});

test("generation builds the current Node app in a clean isolated copy before two stable generations", { timeout: 120_000 }, () => {
  const { root, first } = generatedFixture();
  assert.equal(existsSync(join(root, "apps", "agent-plugin", "dist", "index.js")), true);
  for (const item of MAP.skills) assert.deepEqual(files(join(root, item.skill, "runtime")), first.get(item.logicalName), item.logicalName);
});

test("generated launchers run copied Skills from hostile unrelated environments", { timeout: 120_000 }, () => {
  const { root } = generatedFixture();
  const temp = mkdtempSync(join(tmpdir(), "portable Skill launchers "));
  try {
    const cwd = join(temp, "unrelated cwd with spaces"), hostile = join(temp, "hostile node modules");
    mkdirSync(cwd); mkdirSync(hostile);
    for (const item of MAP.skills) {
      const copied = join(temp, `copied ${item.logicalName} Skill`);
      cpSync(join(root, item.skill), copied, { recursive: true });
      const launcher = join(copied, "scripts", `${item.logicalName}.mjs`);
      const result = spawnSync(process.execPath, [launcher, "--help"], { cwd, env: { ...process.env, PATH: "", NODE_PATH: hostile }, encoding: "utf8", input: "preserved stdin\n" });
      assert.equal(result.status, 0, `${item.logicalName}: ${result.stderr || result.stdout}`);
      assert.match(result.stdout, /Usage:/);
      assert.equal(result.stderr, "");
      const source = readFileSync(launcher, "utf8");
      assert.doesNotMatch(source, /(?:resolve|join)\([^\n]*apps\//);
      assert.match(source, /process\.execPath/);
      assert.match(source, /stdio:\s*"inherit"/);
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("copied runtime rejects missing entry, changed bytes and unsafe mapping before imports", () => {
  const { root } = generatedFixture();
  const temp = mkdtempSync(join(tmpdir(), "runtime-tamper-"));
  try {
    for (const mutation of ["missing-manifest", "missing-entry", "missing-dependency", "hash", "escape", "inventory-escape"]) {
      const copied = join(temp, mutation); cpSync(join(root, "skills/skill-creator"), copied, { recursive: true });
      const manifestPath = join(copied, "runtime/runtime-manifest.json");
      const entry = join(copied, "runtime/dist/index.js");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (mutation === "missing-manifest") rmSync(manifestPath);
      if (mutation === "missing-entry") rmSync(entry);
      if (mutation === "missing-dependency") rmSync(join(copied, "runtime/node_modules/commander"), { recursive: true });
      if (mutation === "hash") writeFileSync(entry, "throw new Error('UNSAFE_IMPORT');");
      if (mutation === "escape") { manifest.runtimeEntry = "../outside.js"; writeFileSync(manifestPath, JSON.stringify(manifest)); }
      if (mutation === "inventory-escape") { manifest.files[0].path = "../outside.js"; writeFileSync(manifestPath, JSON.stringify(manifest)); }
      const result = spawnSync(process.execPath, [join(copied, "scripts/skill-creator.mjs"), "--help"], {
        cwd: temp, encoding: "utf8", env: { HOME: temp, PATH: "", NODE_PATH: join(ROOT, "apps/agent-plugin/node_modules") },
      });
      assert.equal(result.status, 1, mutation); assert.equal(result.stdout, "");
      assert.match(result.stderr, /skill-creator:/); assert.doesNotMatch(result.stderr, /UNSAFE_IMPORT/);
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("unsupported Node is rejected before opening a missing runtime", () => {
  const temp = mkdtempSync(join(tmpdir(), "node-floor-"));
  try {
    const source = readFileSync(join(ROOT, "skills/skill-creator/scripts/skill-creator.mjs"), "utf8");
    const path = join(temp, "launcher.mjs"); writeFileSync(path, source);
    for (const version of ["20.19.0", "22.21.0", "22.22.1"]) {
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", `Object.defineProperty(process.versions, 'node', {value:${JSON.stringify(version)}}); await import(${JSON.stringify('file://' + path)});`], { encoding: "utf8" });
      assert.equal(result.status, 1); assert.match(result.stderr, /Node.js >=22\.22\.2 is required/); assert.doesNotMatch(result.stderr, /ENOENT/);
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("invalid mapping fails without changing existing generated bytes", () => {
  const temp = mkdtempSync(join(tmpdir(), "invalid-mapping-"));
  try {
    mkdirSync(join(temp, "scripts"));
    cpSync(join(ROOT, "scripts/generate-skill-runtimes.mjs"), join(temp, "scripts/generate-skill-runtimes.mjs"));
    cpSync(join(ROOT, "config/skill-runtimes"), join(temp, "config/skill-runtimes"), { recursive: true });
    cpSync(join(ROOT, "skills/skill-creator"), join(temp, "skills/skill-creator"), { recursive: true });
    const before = files(join(temp, "skills/skill-creator/runtime"));
    for (const field of ["node", "app", "emittedEntry", "relatedCommands"]) {
      const invalid = structuredClone(MAP);
      if (field === "node") invalid.node = ">=999.0.0";
      else invalid.skills[0][field] = field === "relatedCommands" ? { legacy: "../outside.js" } : "../outside";
      writeFileSync(join(temp, "config/skill-runtimes/skill-runtime-map.json"), JSON.stringify(invalid));
      const result = spawnSync(process.execPath, [join(temp, "scripts/generate-skill-runtimes.mjs")], { encoding: "utf8" });
      assert.equal(result.status, 1, field); assert.equal(result.stdout, "");
      assert.match(result.stderr, /runtime mapping|canonical agent-plugin mapping/);
      assert.deepEqual(files(join(temp, "skills/skill-creator/runtime")), before);
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
