import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync, rmSync, symlinkSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeFixtures } from "../skills/skill-creator/assets/materialize-fixtures.mjs";

const creators = ["skill-creator", "plugin-creator"];
test("packaged fixture trees have no discoverable SKILL.md entrypoints", () => {
  function walk(path: string): void {
    for (const item of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, item.name);
      if (item.isDirectory()) walk(child);
      else assert.notEqual(item.name, "SKILL.md", child);
    }
  }
  for (const name of creators) walk(new URL("../skills/" + name + "/assets", import.meta.url).pathname);
  assert.equal(readFileSync(new URL("../skills/skill-creator/assets/materialize-fixtures.mjs", import.meta.url), "utf8"),
    readFileSync(new URL("../skills/plugin-creator/assets/materialize-fixtures.mjs", import.meta.url), "utf8"));
});

test("materializer preserves template bytes/modes and refuses overwrites or discovery roots", () => {
  const temp = mkdtempSync(join(tmpdir(), "inert-fixtures-test-"));
  try {
    const source = join(temp, "source"); mkdirSync(source);
    writeFileSync(join(source, "SKILL.md.fixture"), "invalid metadata is intentionally preserved");
    chmodSync(join(source, "SKILL.md.fixture"), 0o640);
    const dest = join(temp, "dest"); materializeFixtures(source, dest);
    assert.equal(readFileSync(join(dest, "SKILL.md"), "utf8"), readFileSync(join(source, "SKILL.md.fixture"), "utf8"));
    assert.equal(lstatSync(join(dest, "SKILL.md")).mode & 0o777, 0o640);
    assert.throws(() => materializeFixtures(source, dest), /already exists/);
    assert.throws(() => materializeFixtures(source, join(temp, ".agents", "skills", "demo")), /discovery root/);
    assert.throws(() => materializeFixtures(source, "/not-a-temp-destination"), /temporary directory/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("materializer refuses fixture symlinks and active source entrypoints", () => {
  const temp = mkdtempSync(join(tmpdir(), "inert-fixtures-safety-"));
  try {
    const source = join(temp, "source"); mkdirSync(source);
    writeFileSync(join(source, "SKILL.md"), "active");
    assert.throws(() => materializeFixtures(source, join(temp, "dest")), /inert/);
    rmSync(join(source, "SKILL.md"));
    symlinkSync(source, join(temp, "source-link"));
    assert.throws(() => materializeFixtures(join(temp, "source-link"), join(temp, "dest")), /symlinks/);
    writeFileSync(join(source, "SKILL.md.fixture"), "template");
    symlinkSync(join(source, "SKILL.md.fixture"), join(source, "escape"));
    assert.throws(() => materializeFixtures(source, join(temp, "dest")), /symlinks/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
