import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_RUN_PROFILE_COUNTS, pairedMetricStatistics, parseAgentRunProfile, scheduleAgentPairs, summarizePairedAgentRuns } from "../dist/scripts/repeated_agent_runs.js";

test("agent profiles derive exact evidence counts and deterministic counterbalanced order", () => {
  assert.deepEqual(AGENT_RUN_PROFILE_COUNTS, { fast: 1, standard: 3, release: 5 });
  const binding = { eval_id: "manual/eval:α", assertion_hash: "a".repeat(64), equivalence: { model: "m", tools: ["shell"], fixture_sha256: "b".repeat(64), timeout_seconds: 60, max_turns: 10 } };
  const first = scheduleAgentPairs(binding, "old_agent", "release"), second = scheduleAgentPairs(binding, "old_agent", "release");
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map(pair => pair.seed)).size, 5);
  assert.ok(Math.abs(first.filter(pair => pair.order[0] === "with_agent").length - first.filter(pair => pair.order[0] === "old_agent").length) <= 1);
  for (let index = 1; index < first.length; index++) assert.notEqual(first[index].order[0], first[index - 1].order[0]);
  assert.equal(parseAgentRunProfile(undefined), "fast");
  assert.throws(() => parseAgentRunProfile("fast1"), /fast, standard, or release/);
});

test("paired statistics cover quality latency actual turns tokens and cost without inventing missing evidence", () => {
  const current = [
    { eval_id: "manual-01", pair_index: 1, configuration: "with_agent", quality: 1, latency_seconds: 3, actual_turns: 2, tokens: 100, cost_usd: null },
    { eval_id: "manual-01", pair_index: 2, configuration: "with_agent", quality: .8, latency_seconds: 4, actual_turns: 3, tokens: 120, cost_usd: .02 },
  ];
  const baseline = [
    { eval_id: "manual-01", pair_index: 1, configuration: "old_agent", quality: .5, latency_seconds: 2, actual_turns: 4, tokens: 80, cost_usd: .01 },
    { eval_id: "manual-01", pair_index: 2, configuration: "old_agent", quality: .4, latency_seconds: 3, actual_turns: 4, tokens: 90, cost_usd: .01 },
  ];
  const result = summarizePairedAgentRuns(current, baseline, 2);
  assert.equal(result.incomplete, false);
  assert.equal(result.paired.quality.covered_pairs, 2);
  assert.equal(result.paired.quality.statistically_valid, true);
  assert.ok(result.paired.quality.confidence_interval_95);
  assert.equal(result.paired.cost_usd.covered_pairs, 1);
  assert.equal(result.paired.cost_usd.confidence_interval_95, null);
  assert.equal(result.paired.cost_usd.coverage, .5);
  assert.deepEqual(Object.keys(result.paired), ["quality", "latency_seconds", "actual_turns", "tokens", "cost_usd"]);
});

test("one pair is explicitly non-inferential and cannot claim stable improvement", () => {
  const one = pairedMetricStatistics([1], 1);
  assert.equal(one.statistically_valid, false);
  assert.equal(one.confidence_interval_95, null);
  const result = summarizePairedAgentRuns([{ eval_id: 7, pair_index: 1, configuration: "with_agent", quality: 1 }], [{ eval_id: 7, pair_index: 1, configuration: "baseline", quality: 0 }], 1);
  assert.equal(result.stable_improvement, false);
  assert.match(result.stable_improvement_reason, /one pair cannot/);
});

test("standard integration executes three equivalent paired runs in scheduled order", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-repeat-e2e-"));
  try {
    const agent = join(root, "reviewer.md"), baseline = join(root, "baseline.md"), evalSet = join(root, "evals.json"), workspace = join(root, "workspace"), fake = join(root, "fake.mjs");
    writeFileSync(agent, "---\nname: reviewer\ndescription: Reviews evidence\nmodel: same-model\n---\n\nReview with evidence.\n");
    writeFileSync(baseline, "---\nname: baseline\ndescription: Reviews generally\nmodel: same-model\n---\n\nReview generally.\n");
    writeFileSync(evalSet, JSON.stringify({ evals: [{ id: "manual/group:α", subject: "test", language: "en", prompt: "Review.", target: { kind: "task" }, preconditions: [], files: [], capabilities: { tools: ["shell", "read"] }, assertions: ["contains: result"] }] }));
    writeFileSync(fake, "#!/usr/bin/env node\nconsole.log(JSON.stringify({messages:[{role:'assistant',content:[{type:'text',text:'result'}]}],metadata:{total_tokens:9,total_turns:2,cost_usd:.001,model:'same-model'}}))\n"); chmodSync(fake, 0o755);
    const runner = fileURLToPath(new URL("../dist/scripts/run_agent_eval.js", import.meta.url));
    execFileSync(process.execPath, [runner, "--agent", agent, "--baseline-agent", baseline, "--eval-set", evalSet, "--workspace", workspace, "--goose-cli", `${process.execPath} ${fake}`, "--run-profile", "standard", "--model", "same-model", "--timeout", "10", "--max-turns", "7", "--workers", "1", "--no-heartbeat"], { stdio: "pipe" });
    const metadata = JSON.parse(readFileSync(join(workspace, "eval-manual%2Fgroup%3A%CE%B1", "eval_metadata.json"), "utf8"));
    assert.equal(metadata.requested_pairs, 3); assert.equal(metadata.execution_schedule.length, 3);
    for (const configuration of ["with_agent", "old_agent"]) {
      assert.deepEqual(readdirSync(join(workspace, "eval-manual%2Fgroup%3A%CE%B1", configuration)).sort(), ["run-1", "run-2", "run-3"]);
      for (let pair = 1; pair <= 3; pair++) {
        const evidence = JSON.parse(readFileSync(join(workspace, "eval-manual%2Fgroup%3A%CE%B1", configuration, `run-${pair}`, "execution_evidence.json"), "utf8"));
        assert.equal(evidence.eval_id, "manual/group:α");
        assert.equal(evidence.seed, metadata.execution_schedule[pair - 1].seed); assert.deepEqual(evidence.order, metadata.execution_schedule[pair - 1].order);
        assert.deepEqual(evidence.pair_equivalence, metadata.pair_equivalence);
      }
    }
    execFileSync(process.execPath, [fileURLToPath(new URL("../dist/scripts/grade_agent_eval.js", import.meta.url)), workspace], { stdio: "pipe" });
    execFileSync(process.execPath, [fileURLToPath(new URL("../dist/scripts/aggregate_benchmark.js", import.meta.url)), workspace], { stdio: "pipe" });
    const benchmark = JSON.parse(readFileSync(join(workspace, "benchmark.json"), "utf8"));
    assert.deepEqual(benchmark.metadata.evals_run, ["manual/group:α"]);
    assert.equal(benchmark.run_summary.paired.expected_pairs, 3);
    assert.equal(benchmark.run_summary.paired.complete_pairs, 3);
    for (const metric of ["quality", "latency_seconds", "actual_turns", "tokens", "cost_usd"]) {
      assert.equal(benchmark.run_summary.paired.paired[metric].covered_pairs, 3);
      assert.equal(benchmark.run_summary.paired.paired[metric].statistically_valid, true);
      assert.ok(benchmark.run_summary.paired.paired[metric].confidence_interval_95);
    }
    assert.equal(benchmark.run_summary.paired.stable_improvement, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("missing counterpart is explicitly incomplete", () => {
  const result = summarizePairedAgentRuns([{ eval_id: "kept-as-string", pair_index: 1, configuration: "with_agent", quality: 1 }], [], 3);
  assert.equal(result.incomplete, true);
  assert.equal(result.complete_pairs, 0);
  assert.equal(result.paired.quality.expected_pairs, 3);
  assert.equal(result.paired.quality.missing_pairs, 3);
});
