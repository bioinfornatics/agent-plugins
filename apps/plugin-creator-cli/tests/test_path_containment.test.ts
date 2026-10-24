import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isPathWithin, resolveContainedPath } from "../dist/scripts/path_containment.js";

function fixture(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "path-containment-"));
  try { run(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("uses boundary-safe lexical containment", () => fixture(tmp => {
  const root = join(tmp, "plugin");
  mkdirSync(root);
  assert.equal(isPathWithin(root, root), true);
  assert.equal(isPathWithin(root, join(root, "child")), true);
  assert.equal(isPathWithin(root, join(tmp, "plugin-evil")), false);

  const traversal = resolveContainedPath(root, join(root, "..", "outside"));
  assert.equal(traversal.contained, false);
  assert.equal(traversal.status, "lexical-outside");
}));

test("reports existing kinds and expected-kind outcomes", () => fixture(tmp => {
  const root = join(tmp, "plugin");
  const directory = join(root, "assets");
  const file = join(directory, "icon.svg");
  mkdirSync(directory, { recursive: true });
  writeFileSync(file, "icon");

  const fileResult = resolveContainedPath(root, file, { expectedKind: "file" });
  assert.equal(fileResult.contained, true);
  assert.equal(fileResult.status, "contained");
  assert.equal(fileResult.exists, true);
  assert.equal(fileResult.kind, "file");
  assert.equal(fileResult.kindOutcome, "match");

  const mismatch = resolveContainedPath(root, "assets", { expectedKind: "file" });
  assert.equal(mismatch.contained, true);
  assert.equal(mismatch.kind, "directory");
  assert.equal(mismatch.kindOutcome, "mismatch");
}));

test("resolves a missing final path through its existing parent", () => fixture(tmp => {
  const root = join(tmp, "plugin");
  mkdirSync(join(root, "output"), { recursive: true });

  const result = resolveContainedPath(root, "output/archive.zip", { expectedKind: "file" });
  assert.equal(result.contained, true);
  assert.equal(result.exists, false);
  assert.equal(result.kind, "missing");
  assert.equal(result.kindOutcome, "missing");
  assert.equal(result.resolvedPath, join(root, "output", "archive.zip"));

  const absentExpected = resolveContainedPath(root, "output/archive.zip", { expectedKind: "missing" });
  assert.equal(absentExpected.kindOutcome, "match");

  const noParent = resolveContainedPath(root, "absent/archive.zip", { expectedKind: "missing" });
  assert.equal(noParent.contained, true);
  assert.equal(noParent.status, "contained");
  assert.equal(noParent.kindOutcome, "match");
}));

test("follows in-root links and rejects resolved escapes", { skip: process.platform === "win32" }, () => fixture(tmp => {
  const root = join(tmp, "plugin");
  const inside = join(root, "inside");
  const outside = join(tmp, "outside");
  mkdirSync(inside, { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(inside, "safe.txt"), "safe");
  writeFileSync(join(outside, "secret.txt"), "secret");
  symlinkSync(inside, join(root, "inside-link"), "dir");
  symlinkSync(outside, join(root, "outside-link"), "dir");

  const safe = resolveContainedPath(root, "inside-link/safe.txt", { expectedKind: "file" });
  assert.equal(safe.contained, true);
  assert.equal(safe.kindOutcome, "match");

  const escaped = resolveContainedPath(root, "outside-link/secret.txt");
  assert.equal(escaped.contained, false);
  assert.equal(escaped.status, "resolved-outside");

  const missingEscaped = resolveContainedPath(root, "outside-link/new.txt", { expectedKind: "missing" });
  assert.equal(missingEscaped.contained, false);
  assert.equal(missingEscaped.status, "resolved-outside");
}));

test("resolves platform directory links or records the Windows-junction matrix exclusion", () => fixture(tmp => {
  if (process.platform !== "win32") {
    const root = join(tmp, "plugin"), outside = join(tmp, "outside"); mkdirSync(root); mkdirSync(outside);
    symlinkSync(outside, join(root, "directory-link"), "dir");
    const escaped = resolveContainedPath(root, "directory-link/new.txt");
    assert.equal(escaped.contained, false); assert.equal(escaped.status, "resolved-outside");
    return;
  }
  const root = join(tmp, "plugin");
  const outside = join(tmp, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  symlinkSync(outside, join(root, "junction"), "junction");
  const escaped = resolveContainedPath(root, "junction/new.txt");
  assert.equal(escaped.contained, false);
  assert.equal(escaped.status, "resolved-outside");
}));

test("rejects a missing or non-directory root", () => fixture(tmp => {
  const missing = resolveContainedPath(join(tmp, "missing"), "child");
  assert.equal(missing.status, "invalid-root");
  writeFileSync(join(tmp, "file"), "x");
  const fileRoot = resolveContainedPath(join(tmp, "file"), join(tmp, "file"));
  assert.equal(fileRoot.status, "invalid-root");
}));
