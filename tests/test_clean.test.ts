import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, lstatSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { CLEAN_PATHS, cleanGenerated } from "../scripts/clean.mjs";

const work = mkdtempSync(path.join(tmpdir(), "agent-plugins-clean-test-"));
after(() => rmSync(work, { recursive: true, force: true }));
const exists = (target: string) => lstatSync(target, { throwIfNoEntry: false }) !== undefined;
function fixture(name: string) {
  const root = path.join(work, name);
  mkdirSync(root, { recursive: true });
  return root;
}
function put(root: string, relative: string, content = relative) {
  const target = path.join(root, ...relative.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
  return target;
}

test("cleanup command refuses arbitrary path arguments", () => {
  const result = spawnSync(process.execPath, [path.join(import.meta.dirname, "..", "scripts", "clean.mjs"), work], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not accept paths or arguments/);
});

test("cleanup removes exactly the fixed generated-output allowlist and is idempotent", () => {
  const root = fixture("allowlist");
  for (const relative of CLEAN_PATHS) put(root, `${relative}/generated.txt`);
  const preserved = new Map([
    [".agents/skills/example/SKILL.md", "tracked skill bytes\n"],
    ["skills/skill-creator/runtime/runtime-manifest.json", "committed runtime\n"],
    ["evaluations/receipt.json", "evaluation evidence\n"],
    [".agents/marker.txt", "agent marker\n"],
    ["src/marker.txt", "source marker\n"],
    ["binary/marker.txt", "near-match marker\n"],
    ["release-assets-kept/marker.txt", "other marker\n"],
  ]);
  for (const [relative, content] of preserved) put(root, relative, content);

  assert.deepEqual(cleanGenerated(root), CLEAN_PATHS);
  for (const relative of CLEAN_PATHS) assert.equal(exists(path.join(root, ...relative.split("/"))), false, relative);
  for (const [relative, content] of preserved) assert.equal(readFileSync(path.join(root, ...relative.split("/")), "utf8"), content, relative);
  assert.deepEqual(cleanGenerated(root), []);
});

test("cleanup unlinks allowlisted and nested symlinks without touching their targets", { skip: process.platform === "win32" }, () => {
  const root = fixture("symlinks");
  const outside = fixture("outside");
  const outsideMarker = put(outside, "marker.txt", "outside bytes\n");
  symlinkSync(outside, path.join(root, "bin"), "dir");
  mkdirSync(path.join(root, "dist"), { recursive: true });
  symlinkSync(outsideMarker, path.join(root, "dist", "outside-marker"), "file");

  assert.deepEqual(cleanGenerated(root), ["bin", "dist"]);
  assert.equal(readFileSync(outsideMarker, "utf8"), "outside bytes\n");
  assert.equal(exists(path.join(root, "bin")), false);
  assert.equal(exists(path.join(root, "dist")), false);
});

test("cleanup refuses a symlink ancestor before removing anything", { skip: process.platform === "win32" }, () => {
  const root = fixture("ancestor");
  const outside = fixture("ancestor-outside");
  const marker = put(outside, "plugins/marker.txt", "outside bytes\n");
  put(root, "bin/generated.txt");
  symlinkSync(outside, path.join(root, ".artifacts"), "dir");

  assert.deepEqual(cleanGenerated(root), ["bin", ".artifacts"]);
  assert.equal(readFileSync(marker, "utf8"), "outside bytes\n");
  assert.equal(exists(path.join(root, "bin", "generated.txt")), false);
});

test("cleanup refuses a symlink root", { skip: process.platform === "win32" }, () => {
  const actual = fixture("actual-root");
  const linked = path.join(work, "linked-root");
  put(actual, "bin/generated.txt");
  symlinkSync(actual, linked, "dir");
  assert.throws(() => cleanGenerated(linked), /root ancestry must not contain a symbolic link/);
  assert.equal(exists(path.join(actual, "bin", "generated.txt")), true);
});

test("cleanup refuses a root below a linked parent and preserves the outside bin sentinel", { skip: process.platform === "win32" }, () => {
  const outside = fixture("linked-parent-outside");
  const repository = path.join(outside, "repo");
  const sentinel = put(repository, "bin/sentinel.txt", "outside bin sentinel\n");
  const linkedParent = path.join(work, "linked-parent");
  symlinkSync(outside, linkedParent, "dir");
  const overrideRoot = path.join(linkedParent, "repo");

  assert.throws(() => cleanGenerated(overrideRoot), /root ancestry must not contain a symbolic link/);
  assert.equal(readFileSync(sentinel, "utf8"), "outside bin sentinel\n");
  assert.equal(exists(path.join(repository, "bin")), true);
});
