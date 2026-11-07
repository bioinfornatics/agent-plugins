import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { runEvidenceReader } from "../../src/judge-evidence-reader.ts";
import { EvidenceReader, READER_LIMITS } from "../../src/adapters/outbound/judge/evidence-reader.ts";
import { judgmentPacket } from "../../src/adapters/outbound/judge/judgment-packet.ts";
import { trustedReaderCommand } from "../../src/adapters/outbound/judge/reader-launch.ts";
import { FilesystemJudgeInstructionWriter, instructionLocation } from "../../src/adapters/outbound/storage/judge-instruction-files.ts";

async function fixture(text = "évidence\nexact quote") {
  const root = await mkdtemp(join(tmpdir(), "closed-evidence-"));
  const sha256 = createHash("sha256").update(text).digest("hex");
  const packet = judgmentPacket({ task: "Inspect", expectedOutput: "", criteria: [{ id: "private", text: "Exact" }], artifacts: [{ path: "goose/conversation.json", sha256, kind: "text", text }, { path: "goose/logs/native.log", sha256, kind: "text", text }] });
  const location = instructionLocation(root, randomUUID(), "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222");
  await new FilesystemJudgeInstructionWriter().write(location, packet.instructions, packet.bundle);
  const evidence = join(dirname(location.path), "evidence"), hash = createHash("sha256").update(packet.bundle.manifest).digest("hex"), events: string[] = [];
  return { root, packet, evidence, hash, events, reader: new EvidenceReader(evidence, hash, async event => { events.push(event); }) };
}

test("short packet excludes multi-MB evidence; manifest prioritizes conversation, logs secondary; exact persisted bytes", async () => {
  const f = await fixture("x".repeat(3 * 1024 * 1024));
  try {
    assert.ok(Buffer.byteLength(f.packet.instructions) < 2048);
    const packet = JSON.parse(f.packet.instructions.split("JUDGMENT PACKET:\n")[1] ?? "");
    assert.equal(Object.hasOwn(packet, "expectedOutput"), false);
    assert.equal(packet.conversation, "artifact-1");
    assert.equal(packet.manifest, "evidence/manifest.json");
    const manifest = JSON.parse((await f.reader.call("list_manifest", {})).content[0]?.text ?? "");
    assert.deepEqual(manifest.artifacts.map((a: { priority: string }) => a.priority), ["primary", "secondary"]);
    assert.ok(!JSON.stringify(manifest).includes("logs"));
    const bytes = await readFile(join(f.evidence, "artifact-1"));
    assert.equal(bytes.length, 3 * 1024 * 1024);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.artifacts[0].sha256);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("public read seam returns exact byte slice and rejects traversal, symlinks, unknown commands, malformed bounds and non-UTF8 slices", async () => {
  const f = await fixture();
  try {
    const slice = JSON.parse((await f.reader.call("read_artifact", { path: "artifact-1", offset: 10, length: 11 })).content[0]?.text ?? "");
    assert.equal(slice.text, "exact quote"); assert.equal(slice.offset, 10); assert.equal(slice.bytes, 11);
    for (const args of [{ path: "../instructions.txt", offset: 0, length: 1 }, { path: "/etc/passwd", offset: 0, length: 1 }, { path: "artifact-3", offset: 0, length: 1 }, { path: "artifact-1", offset: -1, length: 1 }, { path: "artifact-1", offset: 0, length: 8193 }, { path: "artifact-1", offset: 100, length: 1 }, { path: "artifact-1", offset: 0, length: 1 }, { path: "artifact-1", offset: 0, length: 1, command: "cat" }]) {
      await assert.rejects(f.reader.call("read_artifact", args));
    }
    await assert.rejects(f.reader.call("shell", { command: "cat" }));
    await rm(join(f.evidence, "artifact-1")); await symlink(join(f.evidence, "artifact-2"), join(f.evidence, "artifact-1"));
    await assert.rejects(f.reader.call("read_artifact", { path: "artifact-1", offset: 0, length: 20 }));
    assert.equal(f.events.filter(event => JSON.parse(event).deliveredBytes !== undefined).length, 1);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("count and total delivered JSON byte ceilings stop cumulative repeated reads; manifest binding cannot be substituted", async () => {
  const f = await fixture("x".repeat(8192));
  try {
    for (let i = 0; i < READER_LIMITS.calls; i++) await f.reader.call("list_manifest", {});
    await assert.rejects(f.reader.call("list_manifest", {}), /count exceeded/);
    const bounded = new EvidenceReader(f.evidence, f.hash, async () => {});
    for (let i = 0; i < 31; i++) await bounded.call("read_artifact", { path: "artifact-1", offset: 0, length: 8192 });
    await assert.rejects(bounded.call("read_artifact", { path: "artifact-1", offset: 0, length: 8192 }), /byte limit/);
    await writeFile(join(f.evidence, "manifest.json"), "{}");
    await assert.rejects(new EvidenceReader(f.evidence, f.hash, async () => {}).call("list_manifest", {}), /binding mismatch/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("compiled trusted runtime entry implements real MCP stdio initialize/list/call, no shell tools, auditable bounded trace", async () => {
  const f = await fixture("exact quote");
  try {
    assert.ok(trustedReaderCommand(f.evidence, f.hash).includes("judge-evidence-reader.ts"));
    const child = spawn(process.execPath, ["dist/judge-evidence-reader.js", f.evidence, f.hash], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", b => { stdout += b; }); child.stderr.on("data", b => { stderr += b; });
    const done = new Promise(resolve => child.on("close", resolve));
    child.stdin.end(`${[
      { id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
      { method: "notifications/initialized" },
      { id: 2, method: "tools/list" },
      { id: 3, method: "tools/call", params: { name: "read_artifact", arguments: { path: "artifact-1", offset: 0, length: 11 } } },
      { id: 4, method: "tools/call", params: { name: "shell", arguments: { command: "cat" } } },
    ].map(value => JSON.stringify({ jsonrpc: "2.0", ...value })).join("\n")}\n`);
    assert.equal(await done, 0); assert.equal(stderr, "");
    const replies = stdout.trim().split("\n").map(line => JSON.parse(line));
    assert.equal(replies[0].result.protocolVersion, "2024-11-05");
    assert.deepEqual(replies[1].result.tools.map((t: { name: string }) => t.name), ["list_manifest", "read_artifact"]);
    assert.equal(JSON.parse(replies[2].result.content[0].text).text, "exact quote");
    assert.equal(replies[3].result.isError, true);
    const trace = await readFile(join(dirname(f.evidence), "reader-trace.jsonl"), "utf8");
    assert.ok(trace.includes('"offset":0')); assert.ok(!trace.includes("exact quote"));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("invalid relative and symlink reader roots are refused before trace allocation", async () => {
  const f = await fixture();
  try {
    const parent = dirname(f.evidence), before = await readdir(parent);
    await assert.rejects(runEvidenceReader([relative(process.cwd(), f.evidence), f.hash]));
    assert.deepEqual(await readdir(parent), before);
    await chmod(parent, 0o755);
    await assert.rejects(runEvidenceReader([f.evidence, f.hash]));
    assert.deepEqual(await readdir(parent), before);
    await chmod(parent, 0o700);
    const link = join(f.root, "linked"); await symlink(f.evidence, link);
    const top = await readdir(f.root);
    await assert.rejects(runEvidenceReader([link, f.hash]));
    assert.deepEqual(await readdir(f.root), top);
    assert.deepEqual(await readdir(parent), before);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
