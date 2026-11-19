import assert from "node:assert/strict";
import { test } from "node:test";
import { JUDGE_PACKET_LIMIT, judgmentPacket, storedJudgmentPacket } from "../../src/adapters/outbound/judge/judgment-packet.ts";
import type { JudgeRequest } from "../../src/application/ports/judge.ts";

const response = { status: "completed", judgments: [{ id: "criterion-1", verdict: "pass", rationale: "Observed", evidence: [{ path: "artifact-1", sha256: "a".repeat(64), quote: "original evidence" }] }] };
const expected = { status: "completed", judgments: [{ id: "original-id", text: "Original criterion", verdict: "pass", rationale: "Observed", evidence: [{ path: "original/path", sha256: "a".repeat(64), quote: "original evidence" }] }] };

test("packet decode retains original authority after nested and array mutations", () => {
  const request: JudgeRequest = { task: "Original task", criteria: [{ id: "original-id", text: "Original criterion" }], artifacts: [{ path: "original/path", sha256: "a".repeat(64), kind: "text", text: "original evidence" }] };
  const packet = judgmentPacket(request);
  const originalInstructions = packet.instructions;
  assert.ok(request.criteria[0]); assert.ok(request.artifacts[0]);
  Object.assign(request.criteria[0], { id: "mutated-id", text: "Mutated criterion" });
  Object.assign(request.artifacts[0], { path: "mutated/path", text: "mutated evidence", sha256: "b".repeat(64) });
  assert.deepEqual(packet.decode(response), expected);
  request.criteria.splice(0, 1, { id: "replacement-id", text: "Replacement criterion" });
  request.artifacts.splice(0, 1, { path: "replacement/path", sha256: "c".repeat(64), kind: "nontext" });
  request.criteria = []; request.artifacts = []; request.task = "Mutated task";
  const result = packet.decode(response);
  assert.deepEqual(result, expected);
  assert.equal(packet.instructions, originalInstructions);
  assert.ok(!JSON.stringify(result).includes("mutated"));
  // Returned data is detached too; one observer cannot alter a later decode.
  if (result.status === "completed") {
    assert.ok(result.judgments[0]);
    result.judgments[0].text = "Observer mutation";
  }
  assert.deepEqual(packet.decode(response), expected);
});

test("canonical snapshot ignores malicious extra properties and validates runtime fields", () => {
  const malicious = { toJSON() { throw new Error("Extra property executed"); }, extra: { cycle: null as unknown } };
  malicious.extra.cycle = malicious;
  const request = { task: "Task", criteria: [{ id: "original-id", text: "Original criterion", ...malicious }], artifacts: [{ path: "original/path", sha256: "a".repeat(64), kind: "text", text: "original evidence", ...malicious }] } as JudgeRequest;
  assert.deepEqual(judgmentPacket(request).decode(response), expected);
  assert.throws(() => judgmentPacket({ ...request, criteria: [{ id: 1, text: "Criterion" }] } as unknown as JudgeRequest), /criterion id/);
  assert.throws(() => judgmentPacket({ ...request, artifacts: [{ path: "path", sha256: "invalid", kind: "text", text: "text" }] }), /sha256/);
});

test("short-template task/assertion byte bound is enforced before host work; blank expected output is omitted", () => {
  const base: JudgeRequest = { task: "Task", criteria: [{ id: "original-id", text: "Original criterion" }], artifacts: [] };
  assert.throws(() => judgmentPacket({ ...base, task: "é".repeat(32768) }), /packet size limit/);
  assert.throws(() => judgmentPacket({ ...base, criteria: [{ id: "original-id", text: "x".repeat(65536) }] }), /packet size limit/);
  const packet = JSON.parse(judgmentPacket({ ...base, expectedOutput: " \n" }).instructions.split("JUDGMENT PACKET:\n")[1] ?? "");
  assert.equal(Object.hasOwn(packet, "expectedOutput"), false);
  assert.deepEqual(packet.assertions, [{ id: "criterion-1", text: "Original criterion" }]);
});

test("versioned evidence labels distinguish original inputs from outputs while tools keep neutral IDs", () => {
  const request: JudgeRequest = { evidenceVersion: 2, task: "Create from evals/brief.md", criteria: [], artifacts: [
    {path:"inputs/evals/brief.md", sha256:"a".repeat(64), kind:"text", text:"original"},
    {path:"workspace/evals/brief.md", sha256:"b".repeat(64), kind:"text", text:"modified"},
    {path:"goose/conversation.json", sha256:"c".repeat(64), kind:"text", text:"conversation"},
  ]};
  const packet = judgmentPacket(request), manifest = JSON.parse(packet.bundle.manifest);
  assert.deepEqual(manifest.artifacts.map((a: {path:string;category:string;logicalPath?:string}) => [a.path,a.category,a.logicalPath]), [
    ["artifact-1","input","evals/brief.md"], ["artifact-2","workspace","evals/brief.md"], ["artifact-3","conversation",undefined],
  ]);
  assert.ok(packet.instructions.includes("initial task data"));
  const legacy = judgmentPacket({...request, evidenceVersion:undefined});
  assert.ok(!legacy.bundle.manifest.includes("logicalPath"));
  const input = request.artifacts[0];
  assert.ok(input);
  assert.throws(() => judgmentPacket({...request, artifacts:[{...input, path:"inputs/../secret"}]}), /Unsafe evidence logical path/);
});


test("packet distinguishes actual calls and matched responses from mentions, and forbids absence proof from incomplete indexes", () => {
  const instructions = judgmentPacket({ task: "Inspect consultations", criteria: [], artifacts: [] }).instructions;
  for (const phrase of ["list_tool_events", "exactTool", "matched response", "full index", "capped", "wrapper", "direct read", "read_artifact", "exact original quote"]) assert.ok(instructions.includes(phrase), phrase);
});

// Golden hashes were cross-checked against judgmentPacket() at commits 0caca97, a89773f and
// f511676 for this exact request. Editing or dropping a released revision breaks historical
// grade readback (ap-rcqm); new prose must be appended and get a new golden entry.
test("released instruction prose revisions stay byte-identical and the current packet uses the last one", async () => {
  const { createHash } = await import("node:crypto");
  const hashes = (evidenceVersion?: 2) => {
    const packet = judgmentPacket({ ...(evidenceVersion ? { evidenceVersion } : {}), task: "Frozen task", criteria: [{ id: "c", text: "Criterion" }], artifacts: [{ path: "goose/conversation.json", sha256: "a".repeat(64), kind: "text", text: "{}" }] });
    assert.equal(packet.instructions, packet.instructionRevisions.at(-1));
    return packet.instructionRevisions.map(text => createHash("sha256").update(text).digest("hex"));
  };
  assert.deepEqual(hashes().slice(0, 3), ["b1e0d9a1abe725411755dcc9bd49d95859d995c1e00a51c507a29a2df11b16ba", "bc149769dba4d6a6930a9d18f2205ac71c65f39c63f6f45da743358eeacaca2c", "06aca09a074448ae085aab1bf834f17adf33343dff9e10a5ccf69cc962898742"]);
  assert.deepEqual(hashes(2).slice(0, 3), ["b50e88f430ca26bf8f03181b9cb4a8c78ae23b9948628a75f4680d83fd308176", "876319a150a5dcc71b35cea6c600418c28ca958db0b5c6ac12d4883db890b21e", "76f32f7634285b63699125bfcae525febe125ce6e48b8e7592793cf8ab9ca000"]);
});

test("readback keeps an older-revision packet that fit when graded even if today's longer prose exceeds the limit", () => {
  const base = { task: "", criteria: [{ id: "c", text: "Criterion" }], artifacts: [{ path: "goose/conversation.json", sha256: "a".repeat(64), kind: "text" as const, text: "{}" }] };
  const sizes = (task: string) => storedJudgmentPacket({ ...base, task }).instructionRevisions.map(text => Buffer.byteLength(text));
  const [oldest = 0, , current = 0] = sizes("x");
  assert.ok(current > oldest);
  const task = "x".repeat(JUDGE_PACKET_LIMIT - oldest + 1);
  const [fitted = 0, , grown = 0] = sizes(task);
  assert.ok(fitted <= JUDGE_PACKET_LIMIT && grown > JUDGE_PACKET_LIMIT);
  assert.throws(() => judgmentPacket({ ...base, task }), /size limit/);
  assert.equal(storedJudgmentPacket({ ...base, task }).instructionRevisions.length, 3);
});
