import { test } from "node:test";
import assert from "node:assert/strict";
import { createEtaEstimatorState, estimateExecutionEta, updateEtaEstimator, type CompletedEtaJob } from "../dist/scripts/execution_eta.js";

const base = Date.parse("2026-09-17T20:00:00Z");
const history = (n: number, kind = "review"): CompletedEtaJob[] => Array.from({ length: n }, (_, i) => ({
  id: "done-" + i, kind, startedAt: base - 1_000_000 - i * 1_000_000, completedAt: base - 880_000 - i * 1_000_000,
  concurrency: 2, retries: i % 2,
  phases: [
    { name: "prepare", startedAt: base - 1_000_000 - i * 1_000_000, completedAt: base - 960_000 - i * 1_000_000, retries: 0 },
    { name: "run", startedAt: base - 960_000 - i * 1_000_000, completedAt: base - 880_000 - i * 1_000_000, retries: i % 2 },
  ],
}));
const running = (overrides: any = {}) => ({ id: "live", kind: "review", startedAt: base, currentPhase: "run", phasePlan: ["prepare", "run"], concurrency: 2, retries: 0, phases: [{ name: "prepare", status: "completed", startedAt: base, completedAt: base + 40_000 }, { name: "run", status: "running", startedAt: base + 40_000 }], ...overrides });
const invalid = (job: any, at = base + 50_000) => {
  const estimate = estimateExecutionEta(createEtaEstimatorState({ completedJobs: history(8) }), job, at);
  assert.equal(estimate.current_phase.status, "unavailable"); assert.equal(estimate.current_phase.reason, "invalid_input");
  assert.equal(estimate.total.status, "unavailable"); assert.equal(estimate.total.reason, "invalid_input");
  assert.equal(estimate.current_phase.range, undefined); assert.equal(estimate.total.range, undefined);
};

test("withholds numeric ETA below the minimum and explains why", () => {
  const empty = estimateExecutionEta(createEtaEstimatorState(), running(), base + 50_000);
  assert.deepEqual(empty.total, { status: "unavailable", reason: "no_comparable_jobs", sample_count: 0 }); assert.equal(empty.current_phase.range, undefined);
  const sparse = estimateExecutionEta(createEtaEstimatorState({ completedJobs: history(4) }), running(), base + 50_000);
  assert.equal(sparse.total.status, "calculating"); assert.equal(sparse.total.reason, "insufficient_samples"); assert.equal(sparse.total.range, undefined);
});

test("separates current phase and total with honest rounded ranges and basis", () => {
  const estimate = estimateExecutionEta(createEtaEstimatorState({ completedJobs: history(12) }), running({ updatedAt: base + 49_000 }), base + 50_000);
  assert.equal(estimate.current_phase.status, "available"); assert.equal(estimate.total.status, "available");
  assert.equal(estimate.timestamp, "2026-09-17T20:00:50.000Z"); assert.equal(estimate.last_update, "2026-09-17T20:00:49.000Z"); assert.equal(estimate.basis.comparable_jobs, 12);
  assert.ok(estimate.total.range!.remaining_ms.low <= estimate.total.range!.remaining_ms.likely); assert.ok(estimate.total.range!.remaining_ms.likely <= estimate.total.range!.remaining_ms.high);
  assert.equal(estimate.total.range!.remaining_ms.likely % 1000, 0); assert.notEqual(estimate.total.range!.confidence, "high");
});

test("recalibrates on concurrency and phase transitions", () => {
  const state = createEtaEstimatorState({ completedJobs: history(8) }), slow = estimateExecutionEta(state, running({ concurrency: 1 }), base + 50_000), fast = estimateExecutionEta(state, running({ concurrency: 4 }), base + 50_000);
  assert.ok(slow.total.range!.remaining_ms.likely > fast.total.range!.remaining_ms.likely);
  const retried = estimateExecutionEta(state, running({ retries: 3, phases: [{ name: "prepare", status: "completed", startedAt: base, completedAt: base + 40_000 }, { name: "run", status: "running", startedAt: base + 40_000, retries: 3 }] }), base + 50_000);
  assert.ok(retried.total.range!.remaining_ms.likely > fast.total.range!.remaining_ms.likely);
  const phase = estimateExecutionEta(state, running({ currentPhase: "prepare", phases: [{ name: "prepare", status: "running", startedAt: base }] }), base + 10_000);
  assert.equal(phase.current_phase.name, "prepare"); assert.ok(phase.total.range!.remaining_ms.likely > phase.current_phase.range!.remaining_ms.likely);
});

test("pure reducer records actual-versus-estimated error without mutating input", () => {
  const initial = createEtaEstimatorState({ completedJobs: history(6) }), snap = updateEtaEstimator(initial, { type: "snapshot", timestamp: base + 50_000, job: running() });
  assert.equal(initial.latest_estimates.live, undefined);
  const done: CompletedEtaJob = { id: "live", kind: "review", startedAt: base, completedAt: base + 130_000, concurrency: 2, phases: [{ name: "prepare", startedAt: base, completedAt: base + 40_000 }, { name: "run", startedAt: base + 40_000, completedAt: base + 130_000 }] };
  const completed = updateEtaEstimator(snap.state, { type: "completed", job: done });
  assert.equal(completed.error!.total.actual_remaining_ms, 80_000); assert.equal(completed.state.errors.length, 1); assert.equal(completed.state.latest_estimates.live, undefined);
});

test("rejects completed evidence outside job bounds, overlap, disorder, and duplicate names", () => {
  const original = history(1)[0], phase = original.phases[0];
  for (const phases of [
    [{ ...phase, startedAt: original.startedAt as number - 1 }],
    [{ ...phase, completedAt: original.completedAt as number + 1 }],
    [{ name: "a", startedAt: original.startedAt, completedAt: (original.startedAt as number) + 20 }, { name: "b", startedAt: (original.startedAt as number) + 10, completedAt: (original.startedAt as number) + 30 }],
    [{ ...phase }, { ...phase }],
  ]) assert.throws(() => createEtaEstimatorState({ completedJobs: [{ ...original, phases }] }));
});

test("returns stable invalid_input for future or contradictory running chronology", () => {
  invalid(running({ startedAt: base + 50_001 }));
  invalid(running({ updatedAt: base + 50_001 }));
  invalid(running({ updatedAt: base - 1 }));
  invalid(running({ phases: [{ name: "prepare", status: "completed", startedAt: base, completedAt: base + 60_000 }, { name: "run", status: "running", startedAt: base + 40_000 }] }));
  invalid(running({ phases: [{ name: "prepare", status: "completed", startedAt: base, completedAt: base + 40_000 }, { name: "run", status: "running", startedAt: base + 50_001 }] }));
  invalid(running({ phases: [{ name: "prepare", status: "running", startedAt: base }, { name: "run", status: "completed", startedAt: base + 1, completedAt: base + 2 }] }));
  invalid(running({ phases: [{ name: "prepare", status: "completed", startedAt: base, completedAt: base + 40_000 }, { name: "run", status: "pending" }] }));
  invalid(running({ phases: [{ name: "prepare", status: "completed", startedAt: base, completedAt: base + 40_000 }, { name: "run", status: "completed", startedAt: base + 40_000, completedAt: base + 49_000 }] }));
});

test("returns stable invalid_input for ambiguous plans, identities, and phase fields", () => {
  invalid(running({ phasePlan: ["prepare", "run", "run"] }));
  invalid(running({ phases: [{ name: "run", status: "completed", startedAt: base, completedAt: base + 1 }, { name: "run", status: "running", startedAt: base + 1 }] }));
  invalid(running({ phasePlan: ["prepare"], currentPhase: "run" }));
  invalid(running({ phases: [{ name: "run", status: "running", startedAt: base }, { name: "prepare", status: "pending" }] }));
  invalid(running({ phases: [{ name: "prepare", status: "mystery", startedAt: base }, { name: "run", status: "running", startedAt: base + 1 }] }));
  invalid(running({ currentPhase: "prepare" }));
  invalid(running({ phases: [{ name: "prepare", status: "completed", startedAt: base }, { name: "run", status: "running", startedAt: base + 40_000 }] }));
  invalid(running({ phases: [{ name: "prepare", status: "pending", startedAt: base }, { name: "run", status: "running", startedAt: base + 40_000 }] }));
  invalid(running({ concurrency: 0 })); invalid(running({ retries: -1 }));
});

test("keeps malformed snapshot reducer output unavailable rather than throwing or caching an ETA", () => {
  const state = createEtaEstimatorState({ completedJobs: history(8) });
  const update = updateEtaEstimator(state, { type: "snapshot", timestamp: base + 50_000, job: running({ updatedAt: base + 60_000 }) });
  assert.equal(update.estimate!.total.reason, "invalid_input"); assert.equal(update.state.latest_estimates.live.total.range, undefined);
  assert.throws(() => updateEtaEstimator(createEtaEstimatorState({ completedJobs: history(1) }), { type: "completed", job: history(1)[0] }));
});
