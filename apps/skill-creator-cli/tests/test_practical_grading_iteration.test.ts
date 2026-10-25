import { isolateMockTransport } from "./fixtures/mock-host.ts";
isolateMockTransport();
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { EvaluationArtifactCache } from "../dist/scripts/evaluation_artifact_cache.js";
import { executePairedRuns } from "../dist/scripts/paired_execution.js";
import { executionSamplingProtocol, executionSamplingProtocolHash } from "../dist/scripts/execution_sampling_protocol.js";
import { listRunDirs, artifactHash } from "../dist/scripts/evaluation_provenance.js";

const graders = [{ id: "documented-grader", model: "test-model", invocation_id: "documented-id" }];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "practical-iteration-")), skill = join(root, "demo"), workspace = join(root, "workspace");
  mkdirSync(join(skill, "evals"), { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), `---
name: demo
description: Tests grading compatibility. Use when checking evidence.
---
# Demo
`);
  writeFileSync(join(skill, "evals", "evals.json"), JSON.stringify({ skill_name: "demo", evals: [{ id: 1, name: "compatibility", subject: "behavioral-evaluation", language: "en", target: { kind: "existing-skill", execution: "execute", path: "." }, preconditions: [], budget: { max_turns: 12, timeout_seconds: 600 }, prompt: "Produce a report.", expected_output: "Report", files: [], capabilities: { filesystem: true, agent_runner: true, browser: false, network: false, tools: [] }, assertions: ["Explains recovery", "Explains safeguards"], coverage_tags: ["language:en"], navigation_expectations: { must_read: ["SKILL.md"], read_when_relevant: [], must_not_read: [] } }] }));
  const scaffold = spawnSync(process.execPath, [resolve("dist/scripts/cli.js"), "full-eval", skill, "--workspace", workspace, "--format", "json"], { encoding: "utf8" });
  assert.ok([0, 3].includes(scaffold.status!), scaffold.stderr);
  return { root, skill, workspace };
}
async function execute(f: ReturnType<typeof fixture>, batch: boolean) {
  let calls = 0;
  const response = (output: string) => ({ verdict: "pass", evidence_quote: output, rationale: "Observed behavior." });
  const adapter = { async grade(input: any) { calls++; return { raw: JSON.stringify(response(input.output)), usage: { total_tokens: 7 } }; }, ...(batch ? { async gradeBatch(input: any) { calls++; return { raw: JSON.stringify({ judgments: input.assertions.map((a: any) => ({ id: a.id, version: a.version, ...response(input.output) })) }), usage: { total_tokens: 7 } }; } } : {}) };
  const result = await executePairedRuns({ skillPath: f.skill, workspace: f.workspace, baseline: "without_skill", graders, graderAdapter: adapter, cacheDir: join(f.root, "cache") });
  return { result, calls };
}
for (const batch of [false, true]) test("R3 actual invocation accounting: " + (batch ? "one batch is 7 tokens" : "two legacy calls are 14 tokens"), async () => {
  const f = fixture(), previous = process.env.SKILL_CREATOR_GOOSE_COMMAND;
  process.env.SKILL_CREATOR_GOOSE_COMMAND = process.execPath + " " + resolve("tests/fixtures/fake-goose.mjs");
  try {
    const { result, calls } = await execute(f, batch);
    assert.equal(result.status, "complete", JSON.stringify(result.failures));
    assert.equal(calls, result.completed.length * (batch ? 1 : 2));
    for (const run of result.completed) {
      const timing = JSON.parse(readFileSync(join(run, "timing.json"), "utf8"));
      assert.equal(timing.grader_usage.reduce((n: number, row: any) => n + row.usage.total_tokens, 0), batch ? 7 : 14);
      const grade = JSON.parse(readFileSync(join(run, "grading.json"), "utf8"));
      assert.equal(grade.grading_budget.used >= (batch ? 1 : 2), true);
      assert.equal(new Set(grade.expectations.flatMap((e: any) => e.judgments.map((j: any) => j.invocation_id))).size, batch ? 1 : 2);
    }
  } finally { if (previous === undefined) delete process.env.SKILL_CREATOR_GOOSE_COMMAND; else process.env.SKILL_CREATOR_GOOSE_COMMAND = previous; rmSync(f.root, { recursive: true, force: true }); }
});

test("R4 explicit grader protocol differs from legacy and binds batch capability", () => {
  const current = executionSamplingProtocol({ graders });
  const legacy = structuredClone(current);
  legacy.grader.protocol_version = "semantic-evidence-v2";
  assert.notEqual(executionSamplingProtocolHash(current), executionSamplingProtocolHash(legacy));
  const perAssertion = executionSamplingProtocol({ graders, graderCapability: "per-assertion" } as any);
  assert.notEqual(executionSamplingProtocolHash(current), executionSamplingProtocolHash(perAssertion));
});

test("R4 legacy frozen sampling rejects without changing receipts; current cache reuses", async () => {
  const f = fixture(), previous = process.env.SKILL_CREATOR_GOOSE_COMMAND;
  process.env.SKILL_CREATOR_GOOSE_COMMAND = process.execPath + " " + resolve("tests/fixtures/fake-goose.mjs");
  try {
    const first = await execute(f, true);
    assert.equal(first.result.status, "complete");
    const hashes = first.result.completed.map(run => artifactHash(run));
    const run = first.result.completed[0];
    const identity = JSON.parse(readFileSync(join(run, "run-identity.json"), "utf8"));
    const cacheTarget = join(f.root, "materialized-current");
    mkdirSync(cacheTarget);
    assert.ok(new EvaluationArtifactCache(join(f.root, "cache")).materialize(identity.sha256, cacheTarget, run, identity), "same-current cache identity hits");
    const same = await execute(f, true);
    assert.equal(same.result.status, "complete");
    assert.equal(same.calls, 0, "same-current completed evidence is reusable");
    const metadataPath = join(f.workspace, "eval-1", "eval_metadata.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    const legacy = executionSamplingProtocol({ graders });
    legacy.grader.protocol_version = "semantic-evidence-v2";
    metadata.execution_binding.sampling_protocol = legacy;
    metadata.execution_binding.sampling_protocol_hash = executionSamplingProtocolHash(legacy);
    writeFileSync(metadataPath, JSON.stringify(metadata));
    const incompatible = await execute(f, true);
    assert.notEqual(incompatible.result.status, "complete");
    assert.equal(incompatible.calls, 0);
    assert.match(JSON.stringify(incompatible.result.failures), /protocol.*incompatible|protocol.*drift/i);
    assert.deepEqual(listRunDirs(f.workspace).map(run => artifactHash(run)).sort(), hashes.sort());
  } finally { if (previous === undefined) delete process.env.SKILL_CREATOR_GOOSE_COMMAND; else process.env.SKILL_CREATOR_GOOSE_COMMAND = previous; rmSync(f.root, { recursive: true, force: true }); }
});
