import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync, symlinkSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { packageSkill } from "../dist/scripts/package_skill.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");
const CREATOR = resolve(process.env.SKILL_CREATOR_SKILL_ROOT ?? join(APP, "..", "..", "skills", "skill-creator"));
const EXECUTABLE = join(APP, "..", "..", "bin", "skill-creator" + (process.platform === "win32" ? ".exe" : ""));

test("skill packaging rejects symbolic links", () => {
  const tmp = mkdtempSync(join(tmpdir(), "package-skill-"));
  try {
    const root = join(tmp, "demo");
    mkdirSync(root);
    writeFileSync(join(root, "SKILL.md"), "---\nname: demo\ndescription: Packages demo workflows. Use when testing Skill packaging\n---\n\n# Demo\n");
    writeFileSync(join(tmp, "secret.txt"), "secret");
    symlinkSync(join(tmp, "secret.txt"), join(root, "secret-link"));
    const oldLog = console.log;
    console.log = () => {};
    try { assert.equal(packageSkill(root, join(tmp, "out")), null); }
    finally { console.log = oldLog; }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("release .skill runs its documented native executable without Node, Bun, install, or source", { skip: !existsSync(EXECUTABLE) }, () => {
  const tmp = mkdtempSync(join(tmpdir(), "package-skill-release-"));
  const oldLog = console.log; console.log = () => {};
  try {
    const archive = packageSkill(CREATOR, tmp, "release", EXECUTABLE);
    assert.ok(archive);
    const unpacked = join(tmp, "unpacked");
    mkdirSync(unpacked);
    execFileSync("unzip", ["-q", archive!, "-d", unpacked]);
    const packaged = join(unpacked, "skill-creator");
    const native = join(packaged, "bin", "skill-creator" + (process.platform === "win32" ? ".exe" : ""));
    assert.ok(existsSync(native));
    if (process.platform !== "win32") assert.notEqual(statSync(native).mode & 0o111, 0);

    const relative: string[] = [];
    const walk = (directory: string) => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) walk(path);
        else relative.push(path.slice(packaged.length + 1).replaceAll("\\", "/"));
      }
    };
    walk(packaged);
    for (const required of ["SKILL.md", "assets/evaluation-fixtures/frontmatter-invalid/SKILL.md.fixture", "references/skill-authoring-best-practices.md"]) assert.ok(relative.includes(required), required);
    assert.ok(!relative.some((path) => path.startsWith("scripts/") || path.startsWith("tests/") || path.includes("node_modules/") || (path.endsWith(".ts") && !path.endsWith(".d.ts"))));

    const env: NodeJS.ProcessEnv = { HOME: tmp, PATH: "", NODE_PATH: "", BUN_INSTALL: "", npm_config_offline: "true", LANG: "C", LC_ALL: "C" };
    const probe = spawnSync(native, ["validate", packaged, "--format", "json"], { encoding: "utf8", cwd: unpacked, env });
    assert.ifError(probe.error);
    assert.equal(probe.status, 0, probe.stderr || probe.stdout);
    assert.equal(JSON.parse(probe.stdout).status, "success");
  } finally { console.log = oldLog; rmSync(tmp, { recursive: true, force: true }); }
});

test("release .skill requires the matching native executable", () => {
  const tmp = mkdtempSync(join(tmpdir(), "package-skill-native-"));
  try {
    const root = join(tmp, "demo");
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "SKILL.md"), "---\nname: demo\ndescription: Packages demo workflows. Use when testing Skill packaging\n---\n\n# Demo\n");
    writeFileSync(join(root, "package.json"), JSON.stringify({ offlineBundle: true }));
    const wrong = join(tmp, "other");
    writeFileSync(wrong, "not the demo executable");
    const oldLog = console.log; console.log = () => {};
    try {
      assert.equal(packageSkill(root, join(tmp, "out"), "release"), null);
      assert.equal(packageSkill(root, join(tmp, "out"), "release", wrong), null);
    } finally { console.log = oldLog; }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("skill packaging blocks error-level authoring audit findings", () => {
  const tmp = mkdtempSync(join(tmpdir(), "package-skill-audit-"));
  try {
    const root = join(tmp, "demo"); mkdirSync(root);
    writeFileSync(join(root, "SKILL.md"), "---\nname: demo\ndescription: Traite les fichiers. Utilisez quand nécessaire.\n---\n\n# Demo\n");
    const oldLog = console.log; console.log = () => {};
    try { assert.equal(packageSkill(root, join(tmp, "out")), null); }
    finally { console.log = oldLog; }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
