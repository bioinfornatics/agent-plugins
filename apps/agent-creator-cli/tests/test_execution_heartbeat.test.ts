import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildExecutionHeartbeat, createExecutionHeartbeat, type HeartbeatClock } from "../dist/scripts/execution_heartbeat.js";
import { createEtaEstimatorState, estimateExecutionEta } from "../dist/scripts/execution_eta.js";

class FakeClock implements HeartbeatClock {
  time = 0;
  callbacks = new Map<number, { callback: () => void; every: number; next: number }>();
  nextId = 1;
  now = () => this.time;
  setInterval(callback: () => void, every: number): unknown { const id = this.nextId++; this.callbacks.set(id, { callback, every, next: this.time + every }); return id; }
  clearInterval(handle: unknown): void { this.callbacks.delete(handle as number); }
  advance(ms: number): void {
    const target = this.time + ms;
    while (true) {
      let due = Infinity;
      for (const timer of this.callbacks.values()) due = Math.min(due, timer.next);
      if (due > target) break;
      this.time = due;
      for (const timer of [...this.callbacks.values()]) if (timer.next === due) { timer.next += timer.every; timer.callback(); }
    }
    this.time = target;
  }
}

test("heartbeat summarizes execution without protected content", () => {
  const event = buildExecutionHeartbeat({
    startedAt: 1_000, updatedAt: 2_000,
    tasks: [
      { status: "succeeded", worker: "w0", model: "m1", prompt: "private" },
      { status: "running", worker: "w2", model: "m2" },
      { status: "queued" }, { status: "error" }, { status: "retrying" },
    ],
    checkpoint: { id: "cp-7", output: "private", nested: { authorization: "Bearer secret", safe: "visible" } },
    budget: { used: 25, limit: 100, unit: "tokens", token: "secret" },
  }, 3_000, 1_500);
  assert.equal(event.type, "execution.heartbeat");
  assert.deepEqual(event.data.counts, { completed: 1, running: 1, pending: 1, failed: 1, retry: 1 });
  assert.deepEqual(event.data.workers, { active: 1, ids: ["w2"] });
  assert.deepEqual(event.data.models, ["m1", "m2"]);
  assert.equal(event.data.elapsed_ms, 2_000);
  assert.deepEqual(event.data.budget, { tokens: { consumed: 25, limit: 100, remaining: 75, fraction: .25 } });
  assert.deepEqual(event.data.checkpoint, { id: "cp-7", output: "[REDACTED]", nested: { authorization: "[REDACTED]", safe: "visible" } });
  assert.equal(JSON.stringify(event).includes("private"), false);
});

test("heartbeat includes only an explicitly supplied cautious ETA", () => {
  const startedAt = Date.parse("2026-09-17T20:00:00Z");
  const completedJobs = Array.from({ length: 5 }, (_, i) => ({ id: "h" + i, kind: "eval", startedAt, completedAt: startedAt + 10_000, concurrency: 1, phases: [{ name: "run", startedAt, completedAt: startedAt + 10_000 }] }));
  const job = { id: "live", kind: "eval", startedAt, updatedAt: startedAt + 1_000, concurrency: 1, currentPhase: "run", phasePlan: ["run"], phases: [{ name: "run", status: "running" as const, startedAt }] };
  const eta = estimateExecutionEta(createEtaEstimatorState({ completedJobs }), job, startedAt + 1_000);
  assert.equal(buildExecutionHeartbeat({ startedAt, updatedAt: startedAt + 1_000 }, startedAt + 2_000).data.eta, undefined);
  assert.deepEqual(buildExecutionHeartbeat({ startedAt, updatedAt: startedAt + 1_000, eta }, startedAt + 2_000).data.eta, eta);
});

test("fake-clock scheduler emits beyond two intervals, marks stale, and stops terminal", () => {
  const clock = new FakeClock();
  const events: any[] = [];
  let snapshot: any = { startedAt: 0, updatedAt: 0, counts: { running: 1 }, status: "running" };
  const scheduler = createExecutionHeartbeat(() => snapshot, event => events.push(event), { intervalMs: 100, clock });
  clock.advance(301);
  assert.equal(events.length, 3);
  assert.equal(events[1].data.stale, false);
  assert.equal(events[2].data.stale, true);
  snapshot = { ...snapshot, updatedAt: 301, status: "completed", terminal: true, counts: { completed: 1 } };
  clock.advance(99);
  assert.equal(events.length, 3, "terminal polling must not emit a terminal heartbeat");
  assert.equal(scheduler.isStopped, true);
  clock.advance(1_000);
  assert.equal(events.length, 3);
});

test("primitive checkpoints are never emitted raw and terminal workers are zero", () => {
  for (const checkpoint of ["private cursor", 42, true]) {
    const event = buildExecutionHeartbeat({ status: "completed", terminal: true, workers: 8, tasks: [{ status: "running", worker: "worker-1" }], checkpoint });
    assert.equal(event.data.checkpoint, "[REDACTED]");
    assert.deepEqual(event.data.workers, { active: 0, ids: [] });
  }
});

test("heartbeat construction overhead stays below agreed 0.25ms average", () => {
  const snapshot = { startedAt: 0, updatedAt: 1, tasks: Array.from({ length: 20 }, (_, i) => ({ status: i % 3 ? "completed" as const : "running" as const, worker: "w" + i % 4, model: "m" + i % 2 })), checkpoint: { cursor: 9, content: "protected" }, budget: { consumed: 5, limit: 10 } };
  const iterations = 10_000;
  for (let i = 0; i < 100; i++) buildExecutionHeartbeat(snapshot, i);
  const started = performance.now();
  for (let i = 0; i < iterations; i++) buildExecutionHeartbeat(snapshot, i);
  const averageMs = (performance.now() - started) / iterations;
  assert.ok(averageMs < 0.25, `heartbeat overhead ${averageMs.toFixed(4)}ms exceeded 0.25ms`);
});


test("evaluation runner emits progressive budgeted heartbeats for delayed Goose and none terminal", () => {
  const tmp = mkdtempSync(join(tmpdir(), "agent-heartbeat-e2e-"));
  try {
    const agent = join(tmp, "reviewer.md");
    const evalSet = join(tmp, "evals.json");
    const workspace = join(tmp, "workspace");
    const fakeGoose = join(tmp, "fake-goose.mjs");
    writeFileSync(agent, "---\nname: reviewer\ndescription: Reviews safely\nmodel: fake\n---\n\nReview the task.\n");
    writeFileSync(evalSet, JSON.stringify({ evals: [{ id: "slow", subject: "test", language: "en", prompt: "Review.", target: { kind: "task" }, preconditions: [], files: [], assertions: [] }] }));
    writeFileSync(fakeGoose, `#!/usr/bin/env node
await new Promise(resolve => setTimeout(resolve, 140));
process.stdout.write(JSON.stringify({ messages: [{ role: "assistant", content: [{ type: "text", text: "done" }] }], metadata: { total_tokens: 17, total_turns: 2 } }));
`);
    chmodSync(fakeGoose, 0o755);
    const runner = fileURLToPath(new URL("../dist/scripts/run_agent_eval.js", import.meta.url));
    execFileSync(process.execPath, [runner, "--agent", agent, "--eval-set", evalSet, "--workspace", workspace, "--goose-cli", fakeGoose, "--workers", "1", "--max-turns", "5", "--heartbeat-interval", "0.05"], { stdio: "pipe" });
    const events = readFileSync(join(workspace, "execution_heartbeats.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.ok(events.length >= 4, `expected heartbeats during delayed runs, got ${events.length}`);
    assert.ok(events.every(event => event.data.terminal === false));
    assert.ok(events.every(event => event.data.workers.active === 1));
    assert.ok(events.every(event => event.data.budget.runs.limit === 2 && event.data.budget.turns.limit === 10));
    assert.ok(events.some(event => event.data.budget.runs.consumed === 0));
    assert.ok(events.some(event => event.data.budget.runs.consumed === 1 && event.data.budget.tokens.consumed === 17 && event.data.budget.turns.consumed === 2));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
