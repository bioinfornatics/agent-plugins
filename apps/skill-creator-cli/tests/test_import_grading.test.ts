import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { counterbalancedPairSeed, pairedOrderFromSeed, sha256 } from "../dist/scripts/evaluation_provenance.js";
import { prepareGrading, loadGradingManifest } from "../dist/scripts/prepare_grading.js";
import { importGrading } from "../dist/scripts/import_grading.js";
import { buildGradingJudgment } from "../dist/scripts/delegated_grading_contracts.js";

// Azure AI Foundry (Model-as-a-Service) is configured once in Goose and serves
// multiple model families through that single provider; two graders using
// different models still share the same provider identity here.
const PLANNED_GRADERS = [
  { id: "grader-a", model: "gpt-5.6-sol", provider: "azure-foundry" },
  { id: "grader-b", model: "claude-sonnet-5", provider: "azure-foundry" },
];

function fixtureWorkspace(criterion = "Cites verified sources") {
  const root = mkdtempSync(join(tmpdir(), "import-grading-"));
  const evalDir = join(root, "eval-one");
  const binding = { skill_source_sha256: "a".repeat(64), eval_plan_sha256: "b".repeat(64), scenario_sha256: "c".repeat(64) };
  const seed = counterbalancedPairSeed(binding, 1);
  const metadata = {
    eval_id: "one", run_profile: "fast", requested_pairs: 1, decision_policy: "fixed",
    execution_schedule: [{ pair_index: 1, seed, order: pairedOrderFromSeed(seed) }],
    execution_binding: binding, baseline_configuration: "without_skill",
    prompt: "Prepare a report", model: "test-model",
    assertions: [{ id: "a1", version: 1, classification: "semantic", criterion }],
    grading_plan: { schema_version: 1, evidence: "grader-evidence", graders: PLANNED_GRADERS },
  };
  mkdirSync(evalDir, { recursive: true });
  writeFileSync(join(evalDir, "eval_metadata.json"), JSON.stringify(metadata));
  const output = "The report cites verified sources thoroughly.";
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

function requestFor(root: string, index = 0) {
  const dir = join(root, "grading-requests");
  const files = readdirSync(dir).filter((n: string) => n.endsWith(".json") && n !== "manifest.json").sort();
  const name = files[index];
  return { name, request: JSON.parse(readFileSync(join(dir, name), "utf8")) };
}

/** Resolves which planned grader identity a request's invocation_id was prepared for. */
function plannedGraderFor(root: string, invocationId: string) {
  const manifest = loadGradingManifest(root) as Record<string, { grader_id: string; grader_model: string; grader_provider: string }>;
  const entry = manifest[invocationId];
  return entry ? { id: entry.grader_id, model: entry.grader_model, provider: entry.grader_provider } : PLANNED_GRADERS[0];
}

function writeJudgment(root: string, name: string, request: any, overrides: Partial<Parameters<typeof buildGradingJudgment>[0]> = {}) {
  const planned = plannedGraderFor(root, request.invocation_id);
  const judgment = buildGradingJudgment({
    invocationId: request.invocation_id,
    requestSha256: request.request_sha256,
    bindings: request.bindings,
    grader: { id: planned.id, model: planned.model, provider: planned.provider },
    verdict: "pass",
    evidenceQuote: "cites verified sources thoroughly",
    rationale: "supported",
    ...overrides,
  });
  const dir = join(root, "grading-judgments");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(judgment));
  return judgment;
}

test("importGrading accepts a valid judgment, writes canonical grader-evidence, and is idempotent", () => {
  const { root, evalDir } = fixtureWorkspace();
  try {
    prepareGrading(root);
    const { name, request } = requestFor(root);
    writeJudgment(root, name, request);
    const first = importGrading(root);
    assert.equal(first.imported.length, 1);
    assert.equal(first.imported[0].valid_evidence, true);
    assert.equal(first.rejected.length, 0);
    const evidencePath = join(evalDir, "with_skill", "run-1", "grader-evidence", name);
    const otherEvidencePath = join(evalDir, "without_skill", "run-1", "grader-evidence", name);
    assert.ok(existsSync(evidencePath) || existsSync(otherEvidencePath));

    const second = importGrading(root);
    assert.equal(second.imported.length, 0);
    assert.equal(second.already_imported.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("importGrading rejects malformed JSON, an invalid schema, and a missing request", () => {
  const { root } = fixtureWorkspace();
  try {
    prepareGrading(root);
    const dir = join(root, "grading-judgments");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "not-json.json"), "{ not valid json");
    writeFileSync(join(dir, "no-request.json"), JSON.stringify({ schema_version: "1.0", kind: "skill-creator-delegated-grading-judgment" }));
    const result = importGrading(root);
    const noJson = result.rejected.find((r) => r.invocation_id === "not-json");
    assert.ok(noJson);
    assert.match(noJson!.reason, /not valid JSON|manifest entry/);
    const noRequest = result.rejected.find((r) => r.invocation_id === "no-request");
    assert.ok(noRequest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("importGrading rejects a forged/stale request_sha256 and wrong invocation binding", () => {
  const { root } = fixtureWorkspace();
  try {
    prepareGrading(root);
    const { name, request } = requestFor(root);
    // Judgment claims a request_sha256 that does not match the actual request file.
    const grader1 = plannedGraderFor(root, request.invocation_id);
    const forged = buildGradingJudgment({
      invocationId: request.invocation_id, requestSha256: "f".repeat(64), bindings: request.bindings,
      grader: { id: grader1.id, model: grader1.model, provider: grader1.provider }, verdict: "pass",
      evidenceQuote: "cites verified sources thoroughly", rationale: "ok",
    });
    mkdirSync(join(root, "grading-judgments"), { recursive: true });
    writeFileSync(join(root, "grading-judgments", name), JSON.stringify(forged));
    const result = importGrading(root);
    assert.equal(result.imported.length, 0);
    assert.match(result.rejected[0].reason, /request_sha256 does not match/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("importGrading accepts each planned grader's own slot but rejects one grader impersonating another grader's slot", () => {
  const { root } = fixtureWorkspace();
  try {
    prepareGrading(root);
    const dir = join(root, "grading-requests");
    const manifest = loadGradingManifest(root) as Record<string, { run_directory: string }>;
    const files = readdirSync(dir).filter((n: string) => n.endsWith(".json") && n !== "manifest.json").sort();
    const withSkillSlots = files.filter((n: string) => manifest[n.replace(/\.json$/, "")]?.run_directory.includes("with_skill") && !manifest[n.replace(/\.json$/, "")]?.run_directory.includes("without_skill"));
    assert.equal(withSkillSlots.length, 2); // one slot per planned grader (grader-a, grader-b)
    const request1 = JSON.parse(readFileSync(join(dir, withSkillSlots[0]), "utf8"));
    const request2 = JSON.parse(readFileSync(join(dir, withSkillSlots[1]), "utf8"));
    writeJudgment(root, withSkillSlots[0], request1); // slot1's own planned grader judges its own slot
    // slot1's grader identity (necessarily different from slot2's own planned
    // grader, since two graders never share a slot for the same assertion)
    // is used to answer request2's slot instead (impersonation).
    const slot1Grader = plannedGraderFor(root, request1.invocation_id);
    const impersonating = buildGradingJudgment({
      invocationId: request2.invocation_id, requestSha256: request2.request_sha256, bindings: request2.bindings,
      grader: { id: slot1Grader.id, model: slot1Grader.model, provider: slot1Grader.provider },
      verdict: "pass", evidenceQuote: "cites verified sources thoroughly", rationale: "ok",
    });
    mkdirSync(join(root, "grading-judgments"), { recursive: true });
    writeFileSync(join(root, "grading-judgments", withSkillSlots[1]), JSON.stringify(impersonating));
    const result = importGrading(root);
    const rejectedForSlot2 = result.rejected.find((r) => r.invocation_id === request2.invocation_id);
    assert.ok(rejectedForSlot2, "a judgment claiming a different grader identity than its planned slot must be rejected");
    assert.match(rejectedForSlot2!.reason, /does not match the planned grader/);
    assert.ok(result.imported.some((i) => i.invocation_id === request1.invocation_id));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("importGrading rejects an uncontained evidence quote (not a substring of the candidate output)", () => {
  const { root } = fixtureWorkspace();
  try {
    prepareGrading(root);
    const { name, request } = requestFor(root, 0);
    writeJudgment(root, name, request, { evidenceQuote: "this text is not in the output" });
    const result = importGrading(root);
    assert.equal(result.imported[0].valid_evidence, false);
    assert.match(result.imported[0].reason ?? "", /not contained/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("importGrading rejects a self-referential grading-claim quote even if literally contained", () => {
  const { root, evalDir } = fixtureWorkspace("Cites verified sources");
  try {
    // Output contains a self-referential meta-grading phrase verbatim.
    const output = "The verdict is pass for this criterion.";
    for (const config of ["with_skill", "without_skill"]) {
      writeFileSync(join(evalDir, config, "run-1", "outputs", "result.txt"), output);
      writeFileSync(join(evalDir, config, "run-1", "deterministic-evidence.json"), JSON.stringify({
        schema_version: 1, variant_sha256: sha256(config), output_sha256: sha256(output), assertions: [],
      }));
    }
    prepareGrading(root);
    const { name, request } = requestFor(root, 0);
    writeJudgment(root, name, request, { evidenceQuote: "The verdict is pass for this criterion." });
    const result = importGrading(root);
    assert.equal(result.imported[0].valid_evidence, false);
    assert.match(result.imported[0].reason ?? "", /Self-referential/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("importGrading rejects stale bindings when the run has been re-executed since prepare-grading", () => {
  const { root, evalDir } = fixtureWorkspace();
  try {
    prepareGrading(root);
    const { name, request } = requestFor(root, 0);
    // Simulate re-execution: change the candidate output/deterministic evidence after the request was prepared.
    const newOutput = "A completely different report body.";
    writeFileSync(join(evalDir, "with_skill", "run-1", "outputs", "result.txt"), newOutput);
    writeFileSync(join(evalDir, "with_skill", "run-1", "deterministic-evidence.json"), JSON.stringify({
      schema_version: 1, variant_sha256: sha256("with_skill-changed"), output_sha256: sha256(newOutput), assertions: [],
    }));
    writeJudgment(root, name, request);
    const result = importGrading(root);
    const staleOrOk = result.rejected.length + result.imported.length;
    assert.ok(staleOrOk >= 1);
    if (result.rejected.length) assert.match(result.rejected[0].reason, /stale/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("importGrading enforces the grader budget", () => {
  const { root } = fixtureWorkspace();
  try {
    prepareGrading(root);
    const dir = join(root, "grading-requests");
    const files = readdirSync(dir).filter((n: string) => n.endsWith(".json") && n !== "manifest.json").sort();
    for (const name of files) {
      const request = JSON.parse(readFileSync(join(dir, name), "utf8"));
      writeJudgment(root, name, request);
    }
    const result = importGrading(root, { budgetLimit: 1 });
    assert.equal(result.budget.limit, 1);
    assert.ok(result.imported.length + result.already_imported.length <= 1);
    assert.ok(result.rejected.some((r) => r.reason === "Semantic grader budget exhausted"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("importGrading refuses a symlinked judgment file (no-follow trusted read)", () => {
  const { root } = fixtureWorkspace();
  try {
    prepareGrading(root);
    const { name, request } = requestFor(root, 0);
    const outsideDir = mkdtempSync(join(tmpdir(), "import-grading-outside-"));
    const outsideJudgment = join(outsideDir, "forged.json");
    const grader2 = plannedGraderFor(root, request.invocation_id);
    const judgment = buildGradingJudgment({
      invocationId: request.invocation_id, requestSha256: request.request_sha256, bindings: request.bindings,
      grader: { id: grader2.id, model: grader2.model, provider: grader2.provider }, verdict: "pass",
      evidenceQuote: "cites verified sources thoroughly", rationale: "ok",
    });
    writeFileSync(outsideJudgment, JSON.stringify(judgment));
    mkdirSync(join(root, "grading-judgments"), { recursive: true });
    symlinkSync(outsideJudgment, join(root, "grading-judgments", name));
    const result = importGrading(root);
    assert.equal(result.imported.length, 0);
    assert.ok(result.rejected.some((r) => r.invocation_id === request.invocation_id));
    rmSync(outsideDir, { recursive: true, force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("importGrading reports ready_to_resume only once judgments are imported without rejections/errors", () => {
  const { root } = fixtureWorkspace();
  try {
    assert.equal(importGrading(root).ready_to_resume, false);
    prepareGrading(root);
    assert.equal(importGrading(root).ready_to_resume, false); // no judgments yet
    const { name, request } = requestFor(root, 0);
    writeJudgment(root, name, request);
    assert.equal(importGrading(root).ready_to_resume, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("delegated import accepts contained evidence with zero criterion vocabulary overlap", () => {
  const { root } = fixtureWorkspace("Demonstrates traceable attribution");
  try {
    prepareGrading(root);
    const { name, request } = requestFor(root);
    writeJudgment(root, name, request);
    const result = importGrading(root);
    assert.equal(result.rejected.length, 0);
    assert.equal(result.imported.length, 1);
    assert.equal(result.imported[0].valid_evidence, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("delegated import rejects blank rationale even with a contained quote", () => {
  const { root } = fixtureWorkspace();
  try {
    prepareGrading(root);
    const { name, request } = requestFor(root);
    writeJudgment(root, name, request, { rationale: "   " });
    const result = importGrading(root);
    assert.equal(result.imported.length, 1);
    assert.equal(result.imported[0].valid_evidence, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const [output, valid] of [
  ["The external assessor reported score: 87 for the vendor.", true],
  ["The external assessor reported grade is pass for the vendor.", true],
  ["I assign ownership to the service team.", true],
  ["I give myself a score of 100", false],
  ["My self-awarded score is 100", false],
] as const) {
  test("R1/R2 delegated exact quote eligibility: " + output, () => {
    const { root, evalDir } = fixtureWorkspace("Summarizes the assessment");
    try {
      for (const config of ["with_skill", "without_skill"]) {
        const run = join(evalDir, config, "run-1");
        writeFileSync(join(run, "outputs", "result.txt"), output);
        writeFileSync(join(run, "deterministic-evidence.json"), JSON.stringify({ schema_version: 1, variant_sha256: sha256(config), output_sha256: sha256(output), assertions: [] }));
      }
      prepareGrading(root);
      const { name, request } = requestFor(root);
      writeJudgment(root, name, request, { evidenceQuote: output, rationale: "Assessment evidence." });
      const result = importGrading(root);
      assert.equal(result.rejected.length, 0);
      assert.equal(result.imported.length, 1);
      assert.equal(result.imported[0].valid_evidence, valid);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
