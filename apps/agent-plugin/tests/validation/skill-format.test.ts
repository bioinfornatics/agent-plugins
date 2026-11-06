import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../src/main.ts";

// Public CLI seam: a standalone Skill needs no suite and validation must not write.
test("valid standalone Skill succeeds with explicit format scope and unchanged files", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-format-"));
  try {
    const skill = join(root, "pdf-processing");
    await mkdir(skill);
    const text = '---\nname: pdf-processing\ndescription: "I process <PDF> files."\ncustom-extension: {enabled: true}\n---\n# Instructions\n';
    await writeFile(join(skill, "SKILL.md"), text);
    let out = "", err = "";
    assert.equal(await main(["validate", skill, "--json"], { writeOut: s => { out += s; }, writeErr: s => { err += s; } }), 0);
    assert.deepEqual(JSON.parse(out), { valid: true, scope: "skill-format", diagnostics: [], unvalidatedExtensions: ["custom-extension"] });
    assert.equal(err, "");
    assert.equal(await readFile(join(skill, "SKILL.md"), "utf8"), text);
    assert.deepEqual(await readdir(skill), ["SKILL.md"]);
    assert.deepEqual(await readdir(root), ["pdf-processing"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

import { validateSkillFrontmatter } from "../../src/domain/skill-format.ts";
import { FilesystemSkillFormatSource } from "../../src/adapters/outbound/filesystem/filesystem-skill-format-source.ts";
import { validateSkill } from "../../src/application/use-cases/validate-skill.ts";
import { chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { startNodeProcess } from "../helpers/subprocess.ts";

// Independent normative boundary examples, not a copied validation algorithm.
test("inclusive field boundaries and Unicode description character counts", () => {
  for (const [name, description, compatibility] of [
    ["a", "x", "x"], ["a".repeat(64), "x".repeat(1024), "x".repeat(500)],
    ["a", "😀".repeat(1024), "é".repeat(500)],
  ] as const) {
    const frontmatter = new Map<string, unknown>([["name", name], ["description", description], ["compatibility", compatibility]]);
    assert.deepEqual(validateSkillFrontmatter(frontmatter, name), { valid: true, scope: "skill-format", diagnostics: [], unvalidatedExtensions: [] });
  }
  for (const [field, value, message] of [
    ["name", "a".repeat(65), "name must contain 1-64 characters and not be whitespace-only"],
    ["description", "x".repeat(1025), "description must contain 1-1024 characters and not be whitespace-only"],
    ["compatibility", "x".repeat(501), "compatibility must contain 1-500 characters and not be whitespace-only"],
  ] as const) {
    const frontmatter = new Map<string, unknown>([["name", "a"], ["description", "x"], [field, value]]);
    assert.deepEqual(validateSkillFrontmatter(frontmatter, field === "name" ? value : "a").diagnostics, [{ field, message }]);
  }
});

test("required, optional, empty, naming and typed-map violations are diagnosed without coercion", () => {
  const cases: { field: string; value: unknown; message: string }[] = [
    { field: "name", value: false, message: "name must be a string (required)" },
    { field: "description", value: null, message: "description must be a string (required)" },
    ...["description", "compatibility"].flatMap(field => ["", " \t "].map(value => ({ field, value, message: `${field} must contain 1-${field === "description" ? 1024 : 500} characters and not be whitespace-only` }))),
    ...["compatibility", "license", "allowed-tools"].map(field => ({ field, value: false, message: `${field} must be a string` })),
    ...[{}, [], new Map([["version", 1]]), new Map([[1, "value"]])].map(value => ({ field: "metadata", value, message: "metadata must be a map from string keys to string values" })),
  ];
  for (const { field, value, message } of cases) {
    const frontmatter = new Map<string, unknown>([["name", "a"], ["description", "x"], [field, value]]);
    assert.deepEqual(validateSkillFrontmatter(frontmatter, "a").diagnostics, [{ field, message }]);
  }
  for (const field of ["name", "description"]) {
    const frontmatter = new Map<string, unknown>([["name", "a"], ["description", "x"]]);
    frontmatter.delete(field);
    assert.deepEqual(validateSkillFrontmatter(frontmatter, "a").diagnostics, [{ field, message: `${field} must be a string (required)` }]);
  }
  for (const name of ["A", "é", "-a", "a-", "a--b", "plugin:a", " a ", "", "   "]) {
    const result = validateSkillFrontmatter(new Map([["name", name], ["description", "x"]]), name);
    assert.equal(result.valid, false, name);
    assert.ok(result.diagnostics.some(item => item.message === "name must use ASCII lowercase letters, digits and single internal hyphens"));
  }
  assert.deepEqual(validateSkillFrontmatter(new Map([["name", "a"], ["description", "x"]]), "b").diagnostics, [{ field: "name", message: "name must match the Skill directory name" }]);
});

test("optional fields are checked through actual YAML; extension contracts and editorial prose are not enforced", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-yaml-"));
  try {
    const skill = join(root, "a"); await mkdir(skill);
    const file = join(skill, "SKILL.md");
    const source = new FilesystemSkillFormatSource();
    await writeFile(file, '---\r\nname: a\r\ndescription: "I use <x> > y"\r\nlicense: ""\r\nallowed-tools: Bash(git:*) Read\r\nmetadata: {version: "1.0", author: example}\r\nx-host: [1, false]\r\n---\r\n');
    assert.deepEqual(await validateSkill(skill, source), { valid: true, scope: "skill-format", diagnostics: [], unvalidatedExtensions: ["x-host"] });
    for (const metadata of ['{1: "version"}', '{version: 1}', 'null', '[]']) {
      await writeFile(file, `---\nname: a\ndescription: x\nmetadata: ${metadata}\n---\n`);
      assert.deepEqual((await validateSkill(skill, source)).diagnostics, [{ field: "metadata", message: "metadata must be a map from string keys to string values" }]);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("missing, unreadable, malformed and nonmapping input gives precise nonzero diagnostics and stays unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-errors-"));
  try {
    const skill = join(root, "a"); await mkdir(skill);
    const file = join(skill, "SKILL.md");
    const cases: [string, string][] = [
      ["# no frontmatter", "SKILL.md must start with YAML frontmatter delimiter ---"],
      ["---\nname: a", "YAML frontmatter must end with delimiter ---"],
      ["---\nname: [\n---\n", "Malformed YAML frontmatter"],
      ["---\nname: a\nname: b\n---\n", "Malformed YAML frontmatter"],
      ["---\n[a, b]\n---\n", "Frontmatter must be a YAML mapping"],
      ["---\nx\n---\n", "Frontmatter must be a YAML mapping"],
      ["---\n1: x\nname: a\ndescription: x\n---\n", "Frontmatter keys must be strings"],
      ["---\n---\n", "Frontmatter must be a YAML mapping"],
    ];
    for (const [content, message] of cases) {
      await writeFile(file, content);
      let out = "", err = "";
      assert.equal(await main(["validate", skill, "--json"], { writeOut: s => { out += s; }, writeErr: s => { err += s; } }), 1);
      assert.deepEqual(JSON.parse(out), { valid: false, scope: "skill-format", diagnostics: [{ field: "frontmatter", message }], unvalidatedExtensions: [] });
      assert.equal(err, "error: Skill format validation failed\n");
      assert.equal(await readFile(file, "utf8"), content);
    }
    const source = new FilesystemSkillFormatSource();
    await rm(file);
    assert.deepEqual((await validateSkill(skill, source)).diagnostics, [{ field: "SKILL.md", message: "Skill directory or SKILL.md is missing" }]);
    await mkdir(file);
    assert.deepEqual((await validateSkill(skill, source)).diagnostics, [{ field: "SKILL.md", message: "SKILL.md must be a file" }]);
    await rm(file, { recursive: true });
    await writeFile(file, "unchanged");
    assert.deepEqual((await validateSkill(file, source)).diagnostics, [{ field: "skill-path", message: "Skill path must be a directory" }]);
    await chmod(file, 0);
    try {
      assert.deepEqual((await validateSkill(skill, source)).diagnostics, [{ field: "SKILL.md", message: "Unable to read Skill directory or SKILL.md" }]);
      let diagnostic = "";
      assert.equal(await main(["validate", skill], { writeOut: () => { assert.fail("Unreadable input cannot succeed"); }, writeErr: s => { diagnostic += s; } }), 1);
      assert.equal(diagnostic, "error: SKILL.md: Unable to read Skill directory or SKILL.md\n");
    }
    finally { await chmod(file, 0o600); }
    assert.equal(await readFile(file, "utf8"), "unchanged");
    assert.deepEqual(await readdir(root), ["a"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("actual source subprocess validates without SQLite, HOME changes or host startup; imports are silent", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-"));
  try {
    const skill = join(root, "a"); await mkdir(skill);
    await writeFile(join(skill, "SKILL.md"), "---\nname: a\ndescription: x\n---\n");
    const home = join(root, "home"); await mkdir(home);
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home, XDG_STATE_HOME: home, PATH: "" };
    delete env.NODE_TEST_CONTEXT;
    const run = async (args: string[]) => (await startNodeProcess(args, { cwd: fileURLToPath(new URL("../../", import.meta.url)), env }).completed);
    assert.deepEqual(await run(["src/index.ts", "validate", skill]), { exitCode: 0, signal: null, stdout: "Skill format valid; extensions not validated: none\n", stderr: "" });
    await writeFile(join(skill, "SKILL.md"), "---\nname: b\ndescription: x\n---\n");
    assert.deepEqual(await run(["src/index.ts", "validate", skill]), { exitCode: 1, signal: null, stdout: "", stderr: "error: name: name must match the Skill directory name\n" });
    const help = await run(["src/index.ts", "validate", "--help"]);
    assert.equal(help.exitCode, 0); assert.equal(help.stderr, ""); assert.match(help.stdout, /<skill-path>/); assert.match(help.stdout, /--json/);
    assert.deepEqual(await run(["--eval", "await import('./src/adapters/inbound/cli/handle-validate-command.ts'); await import('./src/adapters/outbound/filesystem/filesystem-skill-format-source.ts'); await import('./src/main.ts')", "--", "--unknown"]), { exitCode: 0, signal: null, stdout: "", stderr: "" });
    assert.deepEqual(await readdir(home), []);
    assert.deepEqual(await readdir(root), ["a", "home"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
