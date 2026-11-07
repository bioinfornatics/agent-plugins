import assert from "node:assert/strict";
import { test } from "node:test";
import { judgmentPacket } from "../../src/adapters/outbound/judge/judgment-packet.ts";
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
