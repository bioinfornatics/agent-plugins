import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { counterbalancedPairSeed, pairedOrderFromSeed, sha256 } from "../dist/scripts/evaluation_provenance.js";
import { prepareGrading } from "../dist/scripts/prepare_grading.js";
import { groupPendingBatches, applyBatchResults } from "../dist/scripts/batch_grading.js";
import { importGrading } from "../dist/scripts/import_grading.js";

const GRADERS = [
  { id: "grader-a", model: "gpt-5.6-sol", provider: "azure-foundry" },
  { id: "grader-b", model: "claude-sonnet-5", provider: "azure-foundry" },
];

function fixtureWorkspace(assertionCount = 3) {
  const root = mkdtempSync(join(tmpdir(), "batch-grading-"));
  const evalDir = join(root, "eval-one");
  const binding = { skill_source_sha256: "a".repeat(64), eval_plan_sha256: "b".repeat(64), scenario_sha256: "c".repeat(64) };
  const seed = counterbalancedPairSeed(binding, 1);
  const assertions = Array.from({ length: assertionCount }, (_, i) => ({ id: `a${i + 1}`, version: 1, classification: "semantic", criterion: `Criterion number ${i + 1}` }));
  const metadata = {
    eval_id: "one", run_profile: "fast", requested_pairs: 1, decision_policy: "fixed",
    execution_schedule: [{ pair_index: 1, seed, order: pairedOrderFromSeed(seed) }],
    execution_binding: binding, baseline_configuration: "without_skill",
    prompt: "Prepare a report", model: "test-model", assertions,
    grading_plan: { schema_version: 1, evidence: "grader-evidence", graders: GRADERS },
  };
  mkdirSync(evalDir, { recursive: true });
  writeFileSync(join(evalDir, "eval_metadata.json"), JSON.stringify(metadata));
  const output = "Criterion number 1 text. Criterion number 2 text. Criterion number 3 text.";
  for (const config of ["with_skill", "without_skill"]) {
    const runDir = join(evalDir, config, "run-1");
    mkdirSync(join(runDir, "outputs"), { recursive: true });
    writeFileSync(join(runDir, "outputs", "result.txt"), output);
    writeFileSync(join(runDir, "deterministic-evidence.json"), JSON.stringify({
      schema_version: 1, variant_sha256: sha256(config), output_sha256: sha256(output), assertions: [],
    }));
  }
  return { root, evalDir, output };
}

test("groupPendingBatches groups every pending (run, grader) pair into one batch carrying the shared candidate output once", () => {
  const { root } = fixtureWorkspace(3);
  try {
    prepareGrading(root);
    const result = groupPendingBatches(root);
    // 2 runs (with_skill, without_skill) * 2 graders = 4 batches, each with 3 requests.
    assert.equal(result.batches_written, 4);
    assert.equal(result.requests_batched, 12);
    assert.equal(result.errors.length, 0);
    for (const summary of result.batches) assert.equal(summary.request_count, 3);
    const batchFile = readFileSync(join(root, "grading-batches", result.batches[0].batch_id + ".json"), "utf8");
    const batch = JSON.parse(batchFile);
    assert.equal(batch.requests.length, 3);
    assert.ok(batch.candidate_output.length > 0);
    assert.ok(["gpt-5.6-sol", "claude-sonnet-5"].includes(batch.grader_model));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("groupPendingBatches never re-batches an already-judged request", () => {
  const { root } = fixtureWorkspace(2);
  try {
    prepareGrading(root);
    const first = groupPendingBatches(root);
    assert.equal(first.requests_batched, 8); // 2 runs * 2 assertions * 2 graders

    // Apply results for one full batch.
    const batchId = first.batches[0].batch_id;
    const batchFile = JSON.parse(readFileSync(join(root, "grading-batches", batchId + ".json"), "utf8"));
    const results = batchFile.requests.map((r: any) => ({ invocation_id: r.invocation_id, verdict: "pass", evidence_quote: "Criterion", rationale: "ok" }));
    const applied = applyBatchResults(root, batchId, results);
    assert.equal(applied.judgments_written, batchFile.requests.length);
    assert.equal(applied.errors.length, 0);

    const second = groupPendingBatches(root);
    assert.equal(second.requests_batched, first.requests_batched - batchFile.requests.length);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyBatchResults writes judgments that import-grading accepts identically to single-request judgments", () => {
  const { root } = fixtureWorkspace(2);
  try {
    prepareGrading(root);
    const grouped = groupPendingBatches(root);
    for (const summary of grouped.batches) {
      const batchFile = JSON.parse(readFileSync(join(root, "grading-batches", summary.batch_id + ".json"), "utf8"));
      const results = batchFile.requests.map((r: any) => ({ invocation_id: r.invocation_id, verdict: "pass", evidence_quote: "Criterion", rationale: "ok" }));
      const applied = applyBatchResults(root, summary.batch_id, results);
      assert.equal(applied.errors.length, 0);
    }
    const imported = importGrading(root);
    assert.equal(imported.imported.length, 8);
    assert.equal(imported.rejected.length, 0);
    assert.equal(imported.ready_to_resume, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyBatchResults rejects a result entry whose invocation_id is not part of the named batch, without writing a judgment for it", () => {
  const { root } = fixtureWorkspace(1);
  try {
    prepareGrading(root);
    const grouped = groupPendingBatches(root);
    const batchId = grouped.batches[0].batch_id;
    const applied = applyBatchResults(root, batchId, [
      { invocation_id: "req-does-not-exist-in-this-batch", verdict: "pass", evidence_quote: "x", rationale: "y" },
    ]);
    assert.equal(applied.judgments_written, 0);
    assert.equal(applied.errors.length, 1);
    assert.match(applied.errors[0].message, /not part of batch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyBatchResults rejects an invalid verdict without throwing, leaving the request pending", () => {
  const { root } = fixtureWorkspace(1);
  try {
    prepareGrading(root);
    const grouped = groupPendingBatches(root);
    const batchId = grouped.batches[0].batch_id;
    const batchFile = JSON.parse(readFileSync(join(root, "grading-batches", batchId + ".json"), "utf8"));
    const invocationId = batchFile.requests[0].invocation_id;
    const applied = applyBatchResults(root, batchId, [
      { invocation_id: invocationId, verdict: "maybe", evidence_quote: "x", rationale: "y" },
    ]);
    assert.equal(applied.judgments_written, 0);
    assert.match(applied.errors[0].message, /verdict/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("groupPendingBatches reports a missing batch directory gracefully when there is nothing to prepare yet", () => {
  const { root } = fixtureWorkspace(1);
  try {
    const result = groupPendingBatches(root);
    assert.equal(result.batches_written, 0);
    assert.equal(result.requests_batched, 0);
    assert.deepEqual(result.errors, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
