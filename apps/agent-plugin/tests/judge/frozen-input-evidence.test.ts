import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { SnapshotFile } from "../../src/domain/evaluation.ts";
import { frozenInputEvidence } from "../../src/adapters/outbound/storage/frozen-input-evidence.ts";

const file = (path: string, bytes: Uint8Array | string = ""): SnapshotFile => ({ path, content: Buffer.from(bytes).toString("base64"), executable: false });

test("projection sorts exact frozen bytes, preserving BOM/empty text and classifying binary", () => {
  const files = [file("z.bin", new Uint8Array([0xff])), file("empty"), file("bom.txt", "\ufefforiginal\r\n"), file("control", "\0"), file("del", "\x7f")];
  const projected = frozenInputEvidence(files, [{ path: "logs/answer.txt" }]);
  assert.deepEqual(projected, [
    { path: "inputs/bom.txt", sha256: createHash("sha256").update("\ufefforiginal\r\n").digest("hex"), kind: "text", text: "\ufefforiginal\r\n" },
    { path: "inputs/control", sha256: createHash("sha256").update(new Uint8Array([0])).digest("hex"), kind: "nontext" },
    { path: "inputs/del", sha256: createHash("sha256").update(new Uint8Array([127])).digest("hex"), kind: "nontext" },
    { path: "inputs/empty", sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", kind: "text", text: "" },
    { path: "inputs/z.bin", sha256: createHash("sha256").update(new Uint8Array([255])).digest("hex"), kind: "nontext" },
  ]);
  assert.deepEqual(files.map(f => f.path), ["z.bin", "empty", "bom.txt", "control", "del"]);
  assert.deepEqual(frozenInputEvidence(undefined, []), []);
});

test("unsafe paths, duplicates, ancestor collisions and archive inputs namespace refuse", () => {
  for (const path of ["../x", "/x", "a//b", "a\\b", "a:b", "a\0b", ".env", "x/SKILL.md", ".agents/a"]) assert.throws(() => frozenInputEvidence([file(path)], []), /path/);
  for (const files of [[file("a"), file("a")], [file("a"), file("a/b")], [file("a/b/c"), file("a")]]) assert.throws(() => frozenInputEvidence(files, []), /duplicate|ancestor/);
  for (const path of ["inputs", "inputs/a"]) for (const files of [undefined, [], [file("a")]]) assert.throws(() => frozenInputEvidence(files, [{ path }]), /namespace/);
  assert.equal(frozenInputEvidence([file("a")], [{ path: "inputs-other/a" }]).length, 1);
});

test("canonical base64 rejects padding aliases, whitespace, garbage and malformed records", () => {
  for (const content of ["YQ", "YQ=", "YQ===", "YQ==\n", "Y!==", "YR==", "YWJ=", "===="]) assert.throws(() => frozenInputEvidence([{ ...file("a"), content }], []), /base64/);
  for (const content of ["", "YQ==", "YWI=", "YWJj"]) assert.equal(frozenInputEvidence([{ ...file("a"), content }], []).length, 1);
  assert.throws(() => frozenInputEvidence([{ ...file("a"), executable: undefined } as unknown as SnapshotFile], []), /base64/);
});

test("entry and per-file bounds are inclusive; aggregate overflow preflights without decoding a giant campaign", () => {
  const entries = Array.from({ length: 20_000 }, (_, i) => file(`f${i}`));
  assert.equal(frozenInputEvidence(entries, []).length, 20_000);
  assert.throws(() => frozenInputEvidence([...entries, file("overflow")], []), /entry bound/);
  const atLimit = Buffer.alloc(4 * 1024 * 1024, 0xff).toString("base64");
  assert.equal(frozenInputEvidence([{ ...file("a"), content: atLimit }], [])[0]?.kind, "nontext");
  const overflow = Buffer.alloc(4 * 1024 * 1024 + 1, 0xff).toString("base64");
  assert.throws(() => frozenInputEvidence([{ ...file("a"), content: overflow }], []), /byte bound/);
  // Sixteen files at the aggregate ceiling must reach canonical decoding. A padding
  // alias in the first entry proves admission without allocating 64 MiB of buffers.
  const aggregateLimit = Array.from({ length: 16 }, (_, i) => ({ ...file(`f${i}`), content: i === 0 ? `${atLimit.slice(0, -4)}/x==` : atLimit }));
  assert.throws(() => frozenInputEvidence(aggregateLimit, []), /Noncanonical/);
  // Reuse one encoded string. Rejection must precede allocations of 68 MiB decoded data.
  assert.throws(() => frozenInputEvidence(Array.from({ length: 17 }, (_, i) => ({ ...file(`f${i}`), content: atLimit })), []), /byte bound/);
});
