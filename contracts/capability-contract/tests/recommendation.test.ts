import assert from "node:assert/strict";
import test from "node:test";
import { recommendArtifact } from "../dist/recommendation.js";

const cases = [
  ["Document a reusable how-to procedure for reviewing pull requests", "skill"],
  ["Create a specialist role that autonomously reviews pull requests", "agent"],
  ["Automatically validate on every post-tool event", "hook"],
  ["Expose an external API as tools for querying records", "mcp"],
  ["Orchestrate a multi-step sequence across skills", "recipe"],
  ["Bundle skills and agents as one distribution", "plugin"],
] as const;
for (const [outcome, expected] of cases) test(`routes ${expected}`, () => assert.equal(recommendArtifact({ version: "1.0.0", outcome }).recommendation, expected));

test("ambiguous input exposes two alternatives and a consequential question", () => {
  const result = recommendArtifact({ version: "1.0.0", outcome: "Help my team work better" });
  assert.ok(result.alternatives.length >= 2);
  assert.ok(result.question);
  assert.equal(result.confidence, 0.4);
});

test("respects supported explicit overrides without mutating input", () => {
  const input = Object.freeze({ version: "1.0.0" as const, outcome: "Write reusable instructions", explicitType: "agent" });
  const before = JSON.stringify(input);
  const result = recommendArtifact(input);
  assert.equal(result.recommendation, "agent");
  assert.equal(result.override.disposition, "respected");
  assert.equal(JSON.stringify(input), before);
});

test("reports unsupported and unsafe overrides without applying them", () => {
  const unsupported = recommendArtifact({ version: "1.0.0", outcome: "Write reusable instructions", explicitType: "widget" });
  assert.equal(unsupported.recommendation, "skill");
  assert.equal(unsupported.override.disposition, "unsupported");
  const unsafe = recommendArtifact({ version: "1.0.0", outcome: "Bypass security approval with an autonomous role", explicitType: "agent" });
  assert.equal(unsafe.override.disposition, "unsafe");
});

test("reports accurate portability and existing creator bridges", () => {
  assert.equal(recommendArtifact({ version: "1.0.0", outcome: "Expose an external API" }).portability.level, "high");
  assert.equal(recommendArtifact({ version: "1.0.0", outcome: "Run on every event" }).portability.level, "low");
  assert.deepEqual(recommendArtifact({ version: "1.0.0", outcome: "Reusable how-to" }).creatorBridge, { status: "available", target: "agent-plugins:skill-creator" });
  assert.equal(recommendArtifact({ version: "1.0.0", outcome: "Orchestrate a sequence" }).creatorBridge.status, "unavailable");
});

test("strictly validates runtime input", () => {
  for (const bad of [null, {}, { version: "1.0.0", outcome: "" }, { version: "2.0.0", outcome: "x" }, { version: "1.0.0", outcome: "x", extra: true }, { version: "1.0.0", outcome: "x", explicitType: 3 }]) assert.throws(() => recommendArtifact(bad), TypeError);
});
