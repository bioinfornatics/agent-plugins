import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { buildGradingJudgment } from "../dist/scripts/delegated_grading_contracts.js";
import { loadGradingManifest } from "../dist/scripts/prepare_grading.js";
import { validateExecutionEvidence } from "../dist/scripts/evaluation_provenance.js";

/**
 * End-to-end coverage for ap-8di.6: full-eval's optional delegated grading
 * mode, exercised entirely through the real built CLI (not internal
 * function calls), using the fake-goose fixture as the candidate/baseline
 * executor (delegated grading never spawns a grader subprocess, so no fake
 * grader process is needed at all).
 */

const cli = resolve("dist/scripts/cli.js");
const fake = resolve("tests/fixtures/fake-goose.mjs");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "delegated-e2e-"));
  const skill = join(root, "demo");
  const workspace = join(root, "workspace");
  mkdirSync(join(skill, "evals"), { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "---\nname: demo\ndescription: Evaluates demo workflows. Use when testing delegated grading end to end.\n---\n# Demo\n");
  writeFileSync(join(skill, "evals", "evals.json"), JSON.stringify({
    skill_name: "demo", aggregate_budget: { max_runs: 6, max_turns: 72, timeout_seconds: 3600 },
    evals: [{
      id: 1, name: "delegated-demo", subject: "behavioral-evaluation", language: "en",
      target: { kind: "existing-skill", execution: "execute", path: "." },
      preconditions: ["Use isolated staging"], budget: { max_turns: 12, timeout_seconds: 600 },
      prompt: "Complete the task.", expected_output: "A deterministic output.", files: [],
      capabilities: { filesystem: true, agent_runner: true, browser: false, network: false, tools: [] },
      assertions: ["The output cites verified sources"], coverage_tags: ["language:en"],
      navigation_expectations: { must_read: ["SKILL.md"], read_when_relevant: [], must_not_read: [] },
    }],
  }));
  return { root, skill, workspace };
}

function fakeEnv() {
  return {
    ...process.env,
    SKILL_CREATOR_GOOSE_COMMAND: process.execPath + " " + fake,
    FAKE_GOOSE_CANDIDATE_OUTPUT: "The report cites verified sources thoroughly.",
    FAKE_GOOSE_BASELINE_OUTPUT: "The report cites verified sources thoroughly.",
    FAKE_GOOSE_VARIANT_OUTPUTS: "1",
  };
}

function fullEval(skill: string, workspace: string, extra: string[]) {
  const run = spawnSync(process.execPath, [cli, "full-eval", skill, "--workspace", workspace, "--run-profile", "fast", "--execute", "--grading-mode", "delegated", "--grader", "grader-a=gpt-5.6-sol", "--grader", "grader-b=claude-sonnet-5", ...extra, "--format", "json", "--progress", "none"], { encoding: "utf8", env: fakeEnv() });
  return JSON.parse(run.stdout);
}

function prepareGradingCli(workspace: string) {
  const run = spawnSync(process.execPath, [cli, "prepare-grading", workspace], { encoding: "utf8" });
  return JSON.parse(run.stdout);
}

function importGradingCli(workspace: string) {
  const run = spawnSync(process.execPath, [cli, "import-grading", workspace], { encoding: "utf8" });
  return JSON.parse(run.stdout);
}

function delegateAllPending(workspace: string, inconclusive = false) {
  const dir = join(workspace, "grading-requests");
  const manifest = loadGradingManifest(workspace) as Record<string, { grader_id: string; grader_model: string; grader_provider: string }>;
  mkdirSync(join(workspace, "grading-judgments"), { recursive: true });
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".json") && n !== "manifest.json")) {
    const request = JSON.parse(readFileSync(join(dir, name), "utf8"));
    const entry = manifest[request.invocation_id];
    const judgment = buildGradingJudgment({
      invocationId: request.invocation_id, requestSha256: request.request_sha256, bindings: request.bindings,
      grader: { id: entry.grader_id, model: entry.grader_model, provider: entry.grader_provider },
      verdict: inconclusive ? "inconclusive" : "pass", evidenceQuote: inconclusive ? "" : "cites verified sources thoroughly", rationale: inconclusive ? "Available artifacts cannot establish source authenticity" : "supported",
    });
    writeFileSync(join(workspace, "grading-judgments", name), JSON.stringify(judgment));
  }
}

test("delegated grading mode: full-eval reports awaiting-grading, never spawns a grader subprocess, and --resume completes after prepare/delegate/import", () => {
  const f = fixture();
  try {
    const first = fullEval(f.skill, f.workspace, []);
    assert.equal(first.status, "awaiting-grading");
    assert.equal(first.exit_code, 3);
    const phase = first.phases.find((p: any) => p.name === "paired-runs-and-grading");
    assert.equal(phase.status, "blocked");
    assert.match(phase.detail, /awaiting delegated semantic grading/);
    assert.ok(first.next_actions.some((a: string) => a.includes("prepare-grading")));
    assert.ok(first.next_actions.some((a: string) => a.includes("import-grading")));
    assert.ok(first.next_actions.some((a: string) => a.includes("--resume")));

    const prepared = prepareGradingCli(f.workspace);
    assert.ok(prepared.prepared > 0);
    // Every request must carry the exact declared grader model, never a
    // subprocess/CommandGraderAdapter identity or the candidate's model.
    const requestDir = join(f.workspace, "grading-requests");
    for (const name of readdirsyncFiles(requestDir)) {
      const request = JSON.parse(readFileSync(join(requestDir, name), "utf8"));
      assert.ok(["gpt-5.6-sol", "claude-sonnet-5"].includes(request.grader.model));
    }

    delegateAllPending(f.workspace);
    const imported = importGradingCli(f.workspace);
    assert.ok(imported.imported.length > 0);
    assert.equal(imported.rejected.length, 0);
    assert.equal(imported.ready_to_resume, true);

    const resumed = fullEval(f.skill, f.workspace, ["--resume", "--human-review", "pass", "--tests-status", "pass"]);
    assert.equal(resumed.status, "success");
    assert.equal(resumed.exit_code, 0);
    for (const name of ["validate", "authoring-audit", "evaluation-design", "scaffold", "paired-runs-and-grading", "aggregate", "static-review", "receipt", "post-evaluation-pattern-review", "verify"]) {
      const p = resumed.phases.find((x: any) => x.name === name);
      assert.equal(p.status, "complete", `phase ${name} expected complete, got ${p.status}`);
    }
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("delegated grading mode: a partial import (one grader still pending) keeps full-eval in awaiting-grading and is safely re-resumable", () => {
  const f = fixture();
  try {
    fullEval(f.skill, f.workspace, []);
    prepareGradingCli(f.workspace);
    const dir = join(f.workspace, "grading-requests");
    const manifest = loadGradingManifest(f.workspace) as Record<string, { grader_id: string; grader_model: string; grader_provider: string }>;
    const files = readdirsyncFiles(dir);
    mkdirSync(join(f.workspace, "grading-judgments"), { recursive: true });
    // Only judge the first pending request; leave the rest unanswered.
    const name = files[0];
    const request = JSON.parse(readFileSync(join(dir, name), "utf8"));
    const entry = manifest[request.invocation_id];
    const judgment = buildGradingJudgment({
      invocationId: request.invocation_id, requestSha256: request.request_sha256, bindings: request.bindings,
      grader: { id: entry.grader_id, model: entry.grader_model, provider: entry.grader_provider },
      verdict: "pass", evidenceQuote: "cites verified sources thoroughly", rationale: "supported",
    });
    writeFileSync(join(f.workspace, "grading-judgments", name), JSON.stringify(judgment));

    const partialImport = importGradingCli(f.workspace);
    assert.equal(partialImport.imported.length, 1);
    assert.equal(partialImport.ready_to_resume, true); // no rejections/errors yet, just incomplete

    const resumeAttempt = fullEval(f.skill, f.workspace, ["--resume", "--human-review", "pass", "--tests-status", "pass"]);
    assert.equal(resumeAttempt.status, "awaiting-grading", "full-eval must not advance past a run whose grading is not yet fully finalized");
    const phase = resumeAttempt.phases.find((p: any) => p.name === "paired-runs-and-grading");
    assert.equal(phase.status, "blocked");

    // Now complete the remaining judgments and confirm the same workspace
    // resumes to success without re-executing already-completed candidates.
    delegateAllPending(f.workspace);
    const finalImport = importGradingCli(f.workspace);
    assert.equal(finalImport.ready_to_resume, true);
    const finalResume = fullEval(f.skill, f.workspace, ["--resume", "--human-review", "pass", "--tests-status", "pass"]);
    assert.equal(finalResume.status, "success");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("delegated grading mode: resuming with a different --grading-mode than the scaffold used is rejected as drift, not silently mixed", () => {
  const f = fixture();
  try {
    const first = fullEval(f.skill, f.workspace, []);
    assert.equal(first.status, "awaiting-grading");
    // Resume attempt with subprocess mode (no --grading-mode) instead of the
    // delegated mode the scaffold/paired-runs phase actually used.
    const run = spawnSync(process.execPath, [cli, "full-eval", f.skill, "--workspace", f.workspace, "--run-profile", "fast", "--execute", "--grader", "grader-a=gpt-5.6-sol", "--grader", "grader-b=claude-sonnet-5", "--resume", "--format", "json", "--progress", "none"], { encoding: "utf8", env: fakeEnv() });
    const result = JSON.parse(run.stdout);
    // Either explicitly rejected, or the phase is invalidated and restarted
    // (never silently resumed as if nothing changed) — assert it is not a
    // bare "success" that skipped grading-mode verification.
    assert.notEqual(result.status, "success");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("delegated grading mode: a legitimate low-confidence judgment (valid_evidence:false, verdict:inconclusive because the quote is not substantive) is accepted by validateExecutionEvidence, not treated as invalid provenance", () => {
  // Regression test for a real bug found during ap-8di.11 dogfooding: a
  // grader answering honestly with a technically-contained but
  // non-substantive quote (e.g. quoting an unrelated file-tree line for a
  // criterion about a completely different property) produces
  // valid_evidence:false / verdict:"inconclusive" in import-grading — a
  // legitimate outcome, not tampering. verifyDelegatedGrade previously
  // re-ran the containment/substantive-overlap check unconditionally and
  // rejected this run's evidence as "invalid bound/blinded/substantive
  // delegated judgment", blocking --resume even after 100% of requests
  // were validly imported.
  const f = fixture();
  try {
    fullEval(f.skill, f.workspace, []);
    prepareGradingCli(f.workspace);
    const dir = join(f.workspace, "grading-requests");
    const manifest = loadGradingManifest(f.workspace) as Record<string, { grader_id: string; grader_model: string; grader_provider: string }>;
    mkdirSync(join(f.workspace, "grading-judgments"), { recursive: true });
    for (const name of readdirsyncFiles(dir)) {
      const request = JSON.parse(readFileSync(join(dir, name), "utf8"));
      const entry = manifest[request.invocation_id];
      // A quote that is verbatim-contained in the candidate output but has
      // no lexical relationship to the assertion criterion at all.
      const judgment = buildGradingJudgment({
        invocationId: request.invocation_id, requestSha256: request.request_sha256, bindings: request.bindings,
        grader: { id: entry.grader_id, model: entry.grader_model, provider: entry.grader_provider },
        verdict: "inconclusive", evidenceQuote: "Complete the task.", rationale: "Evidence quote does not substantively overlap the criterion",
      });
      writeFileSync(join(f.workspace, "grading-judgments", name), JSON.stringify(judgment));
    }
    const imported = importGradingCli(f.workspace);
    assert.equal(imported.rejected.length, 0);
    assert.ok(imported.imported.every((i: any) => i.valid_evidence === false));
    assert.equal(imported.ready_to_resume, true);

    const resumed = fullEval(f.skill, f.workspace, ["--resume", "--human-review", "pass", "--tests-status", "pass"]);
    // The scenario's semantic assertion legitimately resolves to
    // inconclusive (no valid pass/fail evidence), but the pipeline itself
    // must advance past paired-runs-and-grading rather than reporting
    // invalid provenance — assert directly against validateExecutionEvidence.
    const binding = validateExecutionEvidence(f.workspace);
    assert.equal(binding.status, "complete", `validateExecutionEvidence must accept a legitimate valid_evidence:false judgment; errors: ${JSON.stringify(binding.errors)}`);
    const phase = resumed.phases.find((p: any) => p.name === "paired-runs-and-grading");
    assert.equal(phase.status, "complete");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("delegated grading mode: default (subprocess) full-eval behavior is completely unaffected by the presence of --grading-mode support", () => {
  const f = fixture();
  try {
    const run = spawnSync(process.execPath, [cli, "full-eval", f.skill, "--workspace", f.workspace, "--run-profile", "fast", "--execute", "--grader", "grader-a=gpt-5.6-sol", "--grader", "grader-b=claude-sonnet-5", "--human-review", "pass", "--tests-status", "pass", "--format", "json", "--progress", "none"], { encoding: "utf8", env: fakeEnv() });
    const result = JSON.parse(run.stdout);
    assert.equal(result.status, "success");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("honest delegated inconclusive keeps its rationale and reaches bound review",()=>{const f=fixture();try{fullEval(f.skill,f.workspace,[]);prepareGradingCli(f.workspace);delegateAllPending(f.workspace,true);const imported=importGradingCli(f.workspace);assert.equal(imported.rejected.length,0);assert.equal(imported.ready_to_resume,true);const run=join(f.workspace,"eval-1","with_skill","run-1"),grading=JSON.parse(readFileSync(join(run,"grading.json"),"utf8"));const semantic=grading.expectations.find((e:any)=>e.classification==="semantic");assert.equal(semantic.verdict,"inconclusive");assert.equal(semantic.judgments[0].rationale,"Available artifacts cannot establish source authenticity");const validated=validateExecutionEvidence(f.workspace);assert.equal(validated.status,"complete",validated.errors.join(";"));const resumed=fullEval(f.skill,f.workspace,["--resume"]);assert.notEqual(resumed.status,"awaiting-grading");assert.ok(resumed.phases.find((p:any)=>p.name==="static-review").status==="complete");}finally{rmSync(f.root,{recursive:true,force:true});}});

function readdirsyncFiles(dir: string): string[] {
  return readdirSync(dir).filter((n) => n.endsWith(".json") && n !== "manifest.json");
}

test("delegated grading mode: a malformed judgment response leaves its invocation pending with an actionable reason, without blocking sibling judgments", () => {
  const f = fixture();
  try {
    fullEval(f.skill, f.workspace, []);
    prepareGradingCli(f.workspace);
    const dir = join(f.workspace, "grading-requests");
    const files = readdirsyncFiles(dir);
    mkdirSync(join(f.workspace, "grading-judgments"), { recursive: true });
    // First request: a malformed (non-JSON) response, simulating a subagent
    // that failed to return the requested JSON-only verdict.
    writeFileSync(join(f.workspace, "grading-judgments", files[0]), "not valid json at all");
    // Remaining requests: delegate normally.
    const manifest = loadGradingManifest(f.workspace) as Record<string, { grader_id: string; grader_model: string; grader_provider: string }>;
    for (const name of files.slice(1)) {
      const request = JSON.parse(readFileSync(join(dir, name), "utf8"));
      const entry = manifest[request.invocation_id];
      const judgment = buildGradingJudgment({
        invocationId: request.invocation_id, requestSha256: request.request_sha256, bindings: request.bindings,
        grader: { id: entry.grader_id, model: entry.grader_model, provider: entry.grader_provider },
        verdict: "pass", evidenceQuote: "cites verified sources thoroughly", rationale: "supported",
      });
      writeFileSync(join(f.workspace, "grading-judgments", name), JSON.stringify(judgment));
    }
    const result = importGradingCli(f.workspace);
    assert.equal(result.rejected.length, 1, "the malformed judgment must be rejected, not silently dropped or treated as valid evidence");
    assert.ok(result.rejected[0].reason.length > 0, "the rejection must carry an actionable reason");
    assert.equal(result.imported.length, files.length - 1, "sibling judgments must still import despite one malformed response");

    // Repair: write a valid judgment for the previously malformed request.
    const badRequest = JSON.parse(readFileSync(join(dir, files[0]), "utf8"));
    const badEntry = manifest[badRequest.invocation_id];
    const repaired = buildGradingJudgment({
      invocationId: badRequest.invocation_id, requestSha256: badRequest.request_sha256, bindings: badRequest.bindings,
      grader: { id: badEntry.grader_id, model: badEntry.grader_model, provider: badEntry.grader_provider },
      verdict: "pass", evidenceQuote: "cites verified sources thoroughly", rationale: "supported",
    });
    writeFileSync(join(f.workspace, "grading-judgments", files[0]), JSON.stringify(repaired));
    const repairedResult = importGradingCli(f.workspace);
    assert.equal(repairedResult.imported.length, 1);
    assert.equal(repairedResult.ready_to_resume, true);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("delegated grading mode: concurrent import-grading invocations over the same pending set complete without corrupting or double-counting evidence", () => {
  const f = fixture();
  try {
    fullEval(f.skill, f.workspace, []);
    prepareGradingCli(f.workspace);
    delegateAllPending(f.workspace);
    const [first, second] = [
      spawnSync(process.execPath, [cli, "import-grading", f.workspace], { encoding: "utf8" }),
      spawnSync(process.execPath, [cli, "import-grading", f.workspace], { encoding: "utf8" }),
    ].map((run) => JSON.parse(run.stdout));
    // Between both concurrent-ish invocations, every request must be
    // accounted for exactly once as imported or already_imported — never
    // duplicated, never lost, never double-counted against the budget.
    const totalDir = readdirsyncFiles(join(f.workspace, "grading-requests")).length;
    const accountedFirst = first.imported.length + first.already_imported.length;
    const accountedSecond = second.imported.length + second.already_imported.length;
    assert.equal(accountedSecond, totalDir, "the second pass must see every request as imported or already_imported");
    assert.ok(accountedFirst <= totalDir);
    assert.equal(first.rejected.length, 0);
    assert.equal(second.rejected.length, 0);
    const evidenceCount = readdirSync(join(f.workspace, "eval-1", "with_skill", "run-1", "grader-evidence")).length
      + readdirSync(join(f.workspace, "eval-1", "without_skill", "run-1", "grader-evidence")).length;
    assert.equal(evidenceCount, totalDir, "each invocation must produce exactly one canonical evidence file, never duplicated");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("one subprocess grader batches an output and provenance rejects tampered output and judgment bindings", () => {
  const f = fixture();
  try {
    const evalsPath = join(f.skill, "evals", "evals.json");
    const evals = JSON.parse(readFileSync(evalsPath, "utf8"));
    evals.evals[0].assertions = ["Demonstrates traceable attribution", "Documents accountable sourcing", "Provides auditable references"];
    writeFileSync(evalsPath, JSON.stringify(evals));
    const run = spawnSync(process.execPath, [cli, "full-eval", f.skill, "--workspace", f.workspace, "--run-profile", "fast", "--execute", "--grader", "grader-a=fixture-model", "--max-grader-calls", "6", "--human-review", "pass", "--tests-status", "pass", "--format", "json", "--progress", "none"], { encoding: "utf8", env: fakeEnv() });
    const result = JSON.parse(run.stdout);
    assert.equal(result.status, "success", JSON.stringify(result));
    assert.equal(validateExecutionEvidence(f.workspace).status, "complete");
    const evalDir = readdirSync(f.workspace).find(name => name.startsWith("eval-"))!;
    const runDir = join(f.workspace, evalDir, "with_skill", "run-1");
    const grading = JSON.parse(readFileSync(join(runDir, "grading.json"), "utf8"));
    assert.deepEqual(grading.expectations.map(e => e.verdict), ["pass", "pass", "pass"]);
    assert.equal(new Set(grading.expectations.flatMap(e => e.judgments.map(j => j.invocation_id))).size, 1);
    const outputPath = join(runDir, "outputs", "result.txt"), originalOutput = readFileSync(outputPath, "utf8");
    writeFileSync(outputPath, "stale replacement output");
    assert.equal(validateExecutionEvidence(f.workspace).status, "blocked");
    writeFileSync(outputPath, originalOutput);
    assert.equal(validateExecutionEvidence(f.workspace).status, "complete");
    const evidencePath = join(runDir, "grader-evidence", readdirSync(join(runDir, "grader-evidence"))[0]);
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    evidence.assertion_sha256 = "f".repeat(64);
    writeFileSync(evidencePath, JSON.stringify(evidence));
    assert.equal(validateExecutionEvidence(f.workspace).status, "blocked");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
