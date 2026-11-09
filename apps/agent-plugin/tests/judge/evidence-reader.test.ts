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

test("source trusted runtime entry implements real MCP stdio initialize/list/call, no shell tools, auditable bounded trace", async () => {
  const f = await fixture("exact quote");
  try {
    assert.ok(trustedReaderCommand(f.evidence, f.hash).includes("judge-evidence-reader.ts"));
    const child = spawn(process.execPath, ["src/judge-evidence-reader.ts", f.evidence, f.hash], { stdio: ["pipe", "pipe", "pipe"] });
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
    assert.deepEqual(replies[1].result.tools.map((t: { name: string }) => t.name), ["list_manifest", "read_artifact", "list_tool_events"]);
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

async function toolPage(reader: EvidenceReader, cursor = 0, limit = 20, exactTool?: string) {
  return JSON.parse((await reader.call("list_tool_events", { path: "artifact-1", cursor, limit, ...(exactTool === undefined ? {} : { exactTool }) })).content[0]?.text ?? "");
}

test("tool index scans full supported envelopes, matches exact IDs out of order, and never promotes prose or wrapper code to calls", async () => {
  const messages = [
    { role: "assistant", content: [{ type: "text", text: "load_skill mentioned" }, { type: "toolRequest", id: "wrapper", toolCall: { status: "success", value: { name: "execute_javascript", arguments: { code: "tools.call('load_skill', {name:'example'})" } } } }] },
    { role: "user", content: [{ type: "toolResponse", id: "skill", toolResult: { status: "success", value: { content: [{ type: "text", text: "Skill loaded é" }], isError: false } } }] },
    { role: "assistant", content: [{ type: "toolRequest", id: "skill", toolCall: { status: "success", value: { name: "load_skill", arguments: { name: "example" } } } }] },
  ];
  for (const envelope of [{ messages }, { conversation: messages }, { conversation: { messages } }]) {
    const f = await fixture(JSON.stringify(envelope));
    try {
      const first = await toolPage(f.reader, 0, 1);
      assert.equal(first.scan, "complete"); assert.equal(first.pagination, "more"); assert.equal(first.totalEvents, 3);
      assert.deepEqual(first.events[0].locator, { message: 0, block: 1 });
      assert.equal(first.events[0].match, "missing-response");
      const page = await toolPage(f.reader, 0, 20, "load_skill");
      assert.equal(page.pagination, "end"); assert.equal(page.events.length, 2);
      assert.deepEqual(page.events.map((e: { match: string }) => e.match), ["matched", "matched"]);
      assert.deepEqual(page.events[0].matchedLocator, { message: 2, block: 0 });
      assert.deepEqual(JSON.parse(page.events[0].responseContent.json), { content: [{ type: "text", text: "Skill loaded é" }], isError: false });
      assert.deepEqual(JSON.parse(page.events[1].arguments.json), { name: "example" });
      assert.equal(Object.hasOwn(page.events[1], "offset"), false);
      assert.ok(!f.events.join("\n").includes("example"));
      assert.equal((await toolPage(f.reader, 0, 20, "LOAD_SKILL")).events.length, 0);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test("tool IDs refuse duplicate or missing associations, preserve errors, and bound large payloads without hiding truncation", async () => {
  const request = (id: unknown) => ({ type: "toolRequest", id, toolCall: { status: "success", value: { name: "load_skill", arguments: { text: "é".repeat(10000) } } } });
  const response = (id: unknown) => ({ type: "toolResponse", id, toolResult: { status: "error", error: "not loaded" } });
  const f = await fixture(JSON.stringify({ messages: [{ role: "assistant", content: [request("dup"), request("dup"), response("dup"), response("orphan"), request(null), request("responses"), response("responses"), response("responses")] }] }));
  try {
    const page = await toolPage(f.reader);
    assert.deepEqual(page.events.map((e: { match: string }) => e.match), ["ambiguous", "ambiguous", "ambiguous", "orphan-response", "missing-id", "ambiguous", "ambiguous", "ambiguous"]);
    assert.ok(page.events[0].arguments.truncated); assert.equal(page.events[2].responseStatus.json, '"error"');
    assert.ok(page.events.every((e: object) => !Object.hasOwn(e, "matchedLocator")));
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= READER_LIMITS.sliceBytes);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("unsupported, malformed and capped scans cannot provide absence proof; byte paging and cumulative budgets are explicit", async () => {
  for (const text of ["not json", JSON.stringify({ unrelated: [] }), JSON.stringify({ messages: [null] })]) {
    const f = await fixture(text);
    try { const page = await toolPage(f.reader); assert.notEqual(page.scan, "complete"); assert.equal(page.pagination, "end"); }
    finally { await rm(f.root, { recursive: true, force: true }); }
  }
  const f = await fixture(JSON.stringify({ messages: [{ role: "assistant", content: Array.from({ length: 200001 }, () => ({ type: "text", text: "load_skill" })) }] }));
  try { assert.equal((await toolPage(f.reader)).scan, "capped"); }
  finally { await rm(f.root, { recursive: true, force: true }); }
  const large = await fixture(JSON.stringify({ messages: [{ role: "assistant", content: Array.from({ length: 100 }, (_, id) => ({ type: "toolRequest", id: String(id), toolCall: { status: "success", value: { name: "load_skill", arguments: { text: "x".repeat(2000) } } } })) }] }));
  try {
    const page = await toolPage(large.reader, 0, 100);
    assert.equal(page.pagination, "byte-limited"); assert.ok(page.nextCursor > 0);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= READER_LIMITS.sliceBytes);
    const next = await toolPage(large.reader, page.nextCursor, 1); assert.equal(next.events[0].id.json, JSON.stringify(String(page.nextCursor)));
    for (const args of [{ path: "../secret", cursor: 0, limit: 1 }, { path: "artifact-1", cursor: -1, limit: 1 }, { path: "artifact-1", cursor: 0, limit: 101 }, { path: "artifact-1", cursor: 0, limit: 1, exactTool: "" }, { path: "artifact-1", cursor: 0, limit: 1, shell: "execute" }]) await assert.rejects(large.reader.call("list_tool_events", args));
    const bounded = new EvidenceReader(large.evidence, large.hash, async () => {});
    let count = 0;
    await assert.rejects(async () => { for (; count < READER_LIMITS.calls; count++) await toolPage(bounded, 0, 100); }, /byte limit/);
    assert.ok(count < READER_LIMITS.calls);
  } finally { await rm(large.root, { recursive: true, force: true }); }
});

test("structural scans authenticate full original bytes and refuse substituted or unsafe artifacts", async () => {
  const text = JSON.stringify({ messages: [] }), f = await fixture(text);
  try {
    await writeFile(join(f.evidence, "artifact-1"), text.replace("messages", "changed!"));
    await assert.rejects(toolPage(f.reader), /binding|size/);
    await rm(join(f.evidence, "artifact-1")); await symlink(join(f.evidence, "artifact-2"), join(f.evidence, "artifact-1"));
    await assert.rejects(toolPage(f.reader));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});


test("late direct consultation beyond delivered context is indexed once, with complete filtered absence and immutable snapshot", async () => {
  const text = JSON.stringify({ conversation: { messages: [
    { role: "assistant", content: [{ type: "text", text: "prose ".repeat(100000) }] },
    { role: "assistant", content: [{ type: "toolRequest", id: "late", toolCall: { status: "success", value: { name: "load_skill", arguments: { name: "actual" } } } }] },
    { role: "user", content: [{ type: "toolResponse", id: "late", toolResult: { status: "success", value: { content: [{ type: "text", text: "loaded" }] } } }] },
  ] } });
  const f = await fixture(text);
  try {
    const page = await toolPage(f.reader, 0, 20, "load_skill");
    assert.equal(page.scan, "complete"); assert.equal(page.pagination, "end"); assert.equal(page.events.length, 2);
    assert.deepEqual(page.events[0].locator, { message: 1, block: 0 });
    await writeFile(join(f.evidence, "artifact-1"), "substituted");
    assert.deepEqual(await toolPage(f.reader, 0, 20, "load_skill"), page);
    const absent = await toolPage(f.reader, 0, 20, "other_tool");
    assert.equal(absent.scan, "complete"); assert.equal(absent.pagination, "end"); assert.equal(absent.matchingEvents, 0);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});


test("malformed tool payloads cannot manufacture successful access or negative proof; failed requests expose only bounded actual JSON", async () => {
  const f = await fixture(JSON.stringify({ messages: [{ role: "assistant", content: [
    { type: "toolRequest", id: "bad", toolCall: { status: "success", value: { arguments: {} } } },
    { type: "toolRequest", id: "failed", toolCall: { status: "error", error: "unknown tool" } },
    { type: "toolResponse", id: "bad", toolResult: { status: "success", value: { content: [] } } },
  ] }] }));
  try {
    const page = await toolPage(f.reader);
    assert.equal(page.scan, "unsupported"); assert.equal(page.events[0].match, "unverified");
    assert.equal(page.events[1].requestStatus.json, '"error"'); assert.equal(page.events[1].requestError.json, '"unknown tool"');
    assert.equal((await toolPage(f.reader, 0, 20, "load_skill")).scan, "unsupported");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
