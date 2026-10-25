import { isolateMockTransport } from "./fixtures/mock-host.ts";
isolateMockTransport();
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { buildGradingJudgment } from "../dist/scripts/delegated_grading_contracts.js";
import { loadGradingManifest } from "../dist/scripts/prepare_grading.js";
import { artifactHash, validateExecutionEvidence } from "../dist/scripts/evaluation_provenance.js";

/**
 * End-to-end coverage for ap-8di.6: full-eval's optional delegated grading
 * mode, exercised entirely through the real built CLI (not internal
 * function calls), using the fake-goose fixture as the candidate/baseline
 * executor (delegated grading never spawns a grader subprocess, so no fake
 * grader process is needed at all).
 */

const cli = resolve("dist/scripts/cli.js");
const fake = resolve("tests/fixtures/fake-goose.mjs");

function assertDescriptiveComplete(result: any, workspace: string): void {
  assert.equal(result.status, "blocked", JSON.stringify(result));
  assert.equal(result.exit_code, 3);
  assert.equal(validateExecutionEvidence(workspace).status, "complete", "grading and bindings remain complete");
  for (const name of ["paired-runs-and-grading", "aggregate", "static-review", "receipt"]) {
    assert.equal(result.phases.find((p: any) => p.name === name).status, "complete", name);
  }
  assert.equal(result.phases.find((p: any) => p.name === "verify").status, "blocked", "n=1 must not establish a statistical winner");
}

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
  const host=join(skill,"..","fake-host.mjs");writeFileSync(host,`import {appendFileSync} from "node:fs";if(!process.argv.includes("--version"))appendFileSync(${JSON.stringify(join(skill,"..","candidate-calls"))},"call\\n");process.env.FAKE_GOOSE_VARIANT_OUTPUTS="1";process.env.FAKE_GOOSE_CANDIDATE_OUTPUT="The report cites verified sources thoroughly.";process.env.FAKE_GOOSE_BASELINE_OUTPUT=process.env.FAKE_GOOSE_CANDIDATE_OUTPUT;await import(${JSON.stringify(fake)});`);
  const run = spawnSync(process.execPath, [cli, "full-eval", skill, "--workspace", workspace, "--run-profile", "fast", "--execute", "--grading-mode", "delegated", "--grader", "grader-a=gpt-5.6-sol", "--grader", "grader-b=claude-sonnet-5", ...extra, "--format", "json", "--progress", "none"], { encoding: "utf8", env: {...fakeEnv(),GOOSE_PROVIDER:"openai",OPENAI_API_KEY:"test-only-no-network",SKILL_CREATOR_GOOSE_COMMAND:process.execPath+" "+host} });
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

    assert.ok(readFileSync(join(f.workspace,"eval-1","with_skill","run-1","outputs","result.txt"),"utf8").includes("cites verified sources thoroughly"));
    delegateAllPending(f.workspace);
    const imported = importGradingCli(f.workspace);
    assert.ok(imported.imported.length > 0);
    assert.equal(imported.rejected.length, 0);
    assert.equal(imported.ready_to_resume, true);

    const resumed = fullEval(f.skill, f.workspace, ["--resume", "--human-review", "pass", "--tests-status", "pass"]);
    assertDescriptiveComplete(resumed, f.workspace);
    for (const name of ["validate", "authoring-audit", "evaluation-design", "scaffold", "paired-runs-and-grading", "aggregate", "static-review", "receipt", "post-evaluation-pattern-review"]) {
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
    const candidate=join(f.workspace,"eval-1","with_skill","run-1"),outputHash=artifactHash(join(candidate,"outputs")),callLog=join(f.root,"candidate-calls"),beforeCalls=readFileSync(callLog,"utf8");
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
    // resumes to complete descriptive evidence without re-executing already-completed candidates.
    delegateAllPending(f.workspace);
    assert.equal(artifactHash(join(candidate,"outputs")),outputHash);
    assert.equal(readFileSync(callLog,"utf8"),beforeCalls,"partial delegated recovery must never rerun candidates");
    const finalImport = importGradingCli(f.workspace);
    assert.equal(finalImport.ready_to_resume, true);
    const finalResume = fullEval(f.skill, f.workspace, ["--resume", "--human-review", "pass", "--tests-status", "pass"]);
    assertDescriptiveComplete(finalResume, f.workspace);
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

test("delegated grading mode: an uncontained inconclusive quote is unavailable, not honest uncertainty", () => {
  // Regression test for a real bug found during ap-8di.11 dogfooding: a
  // grader answering honestly with a technically-contained but
  // non-substantive quote (e.g. quoting an unrelated file-tree line for a
  // criterion about a completely different property) produces
  // valid_evidence:false / verdict:"inconclusive" in import-grading — a
  // legitimate outcome, not tampering. verifyDelegatedGrade previously
  // re-ran the containment/substantive-overlap check unconditionally and
  // rejected this run's evidence as "invalid bound/blinded/substantive
  // Uncontained text is invalid grading, even when the claimed verdict is
  // inconclusive; only honest empty-quote uncertainty is review-ready.
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
      // The quote repeats the task prompt, not the captured candidate output.
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
    assert.equal(imported.ready_to_resume, false);

    const resumed = fullEval(f.skill, f.workspace, ["--resume", "--human-review", "pass", "--tests-status", "pass"]);
    // The invalid slot stays pending and cannot become review-ready uncertainty.
    const binding = validateExecutionEvidence(f.workspace);
    assert.equal(binding.status, "blocked");
    const phase = resumed.phases.find((p: any) => p.name === "paired-runs-and-grading");
    assert.equal(phase.status, "blocked");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("delegated grading mode: default (subprocess) full-eval behavior is completely unaffected by the presence of --grading-mode support", () => {
  const f = fixture();
  try {
    const run = spawnSync(process.execPath, [cli, "full-eval", f.skill, "--workspace", f.workspace, "--run-profile", "fast", "--execute", "--grader", "grader-a=gpt-5.6-sol", "--grader", "grader-b=claude-sonnet-5", "--human-review", "pass", "--tests-status", "pass", "--format", "json", "--progress", "none"], { encoding: "utf8", env: fakeEnv() });
    const result = JSON.parse(run.stdout);
    assertDescriptiveComplete(result, f.workspace);
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
    assertDescriptiveComplete(result, f.workspace);
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

test('delegated deterministic grades are independently rederived, not preserved from claims',()=>{
 const f=fixture();try{const evalPath=join(f.skill,'evals','evals.json'),doc=JSON.parse(readFileSync(evalPath,'utf8'));doc.evals[0].assertions.push({id:'exact',version:1,classification:'deterministic',criterion:'Contains sources',checker:{kind:'contains',value:'verified sources'}});writeFileSync(evalPath,JSON.stringify(doc));fullEval(f.skill,f.workspace,[]);prepareGradingCli(f.workspace);delegateAllPending(f.workspace);assert.equal(importGradingCli(f.workspace).errors.length,0);const run=join(f.workspace,'eval-1','with_skill','run-1'),path=join(run,'grading.json'),grade=JSON.parse(readFileSync(path,'utf8')),item=grade.expectations.find((e:any)=>e.id==='exact');assert.equal(item.verdict,'pass');item.verdict='fail';item.passed=false;grade.summary.passed--;grade.summary.failed++;grade.summary.pass_rate=grade.summary.passed/grade.summary.total;writeFileSync(path,JSON.stringify(grade));const manifestPath=join(run,'execution-evidence.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));manifest.artifact_sha256['grading.json']=artifactHash(path);writeFileSync(manifestPath,JSON.stringify(manifest));const result=validateExecutionEvidence(f.workspace);assert.equal(result.status,'blocked');assert.match(result.errors.join(' '),/deterministic expectation exact.*independently derived/);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});


test("retained delegated evidence is never rehashed into authority", () => {
  const f = fixture();
  try {
    fullEval(f.skill, f.workspace, []); prepareGradingCli(f.workspace); delegateAllPending(f.workspace);
    assert.equal(importGradingCli(f.workspace).ready_to_resume, true);
    const run = join(f.workspace, "eval-1", "with_skill", "run-1"), dir = join(run, "grader-evidence");
    const path = join(dir, readdirSync(dir)[0]), evidence = JSON.parse(readFileSync(path, "utf8"));
    evidence.verdict = "fail"; evidence.rationale = "tampered retained decision";
    writeFileSync(path, JSON.stringify(evidence));
    const before = readFileSync(join(run, "execution-evidence.json"), "utf8");
    assert.equal(validateExecutionEvidence(f.workspace).status, "blocked");
    const imported = importGradingCli(f.workspace);
    assert.equal(imported.ready_to_resume, false);
    assert.ok(imported.rejected.length + imported.errors.length > 0);
    assert.equal(readFileSync(join(run, "execution-evidence.json"), "utf8"), before);
    assert.equal(validateExecutionEvidence(f.workspace).status, "blocked");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("invalid delegated decisive quote stays unavailable and retries grading only", () => {
  const f = fixture();
  try {
    fullEval(f.skill, f.workspace, []); prepareGradingCli(f.workspace); delegateAllPending(f.workspace);
    const dir = join(f.workspace, "grading-judgments");
    for (const name of readdirSync(dir)) {
      const j = JSON.parse(readFileSync(join(dir, name), "utf8"));
      if (j.grader.id !== "grader-a") continue;
      writeFileSync(join(dir, name), JSON.stringify(buildGradingJudgment({invocationId:j.invocation_id, requestSha256:j.request_sha256, bindings:j.bindings, grader:j.grader, verdict:"pass", evidenceQuote:"fabricated quote", rationale:"unsupported"})));
    }
    const before = readFileSync(join(f.root, "candidate-calls"), "utf8");
    const imported = importGradingCli(f.workspace);
    assert.equal(imported.ready_to_resume, false);
    const grade = JSON.parse(readFileSync(join(f.workspace,"eval-1","with_skill","run-1","grading.json"), "utf8"));
    assert.equal(grade.summary.unavailable, 1); assert.equal(grade.summary.pass_rate, null);
    const evidenceDir=join(f.workspace,"eval-1","with_skill","run-1","grader-evidence");
    const retainedName=readdirSync(evidenceDir).find(name=>JSON.parse(readFileSync(join(evidenceDir,name),"utf8")).grader_id==="grader-b")!;
    const retainedBytes=readFileSync(join(evidenceDir,retainedName),"utf8");
    assert.equal(fullEval(f.skill, f.workspace, ["--resume"]).status, "awaiting-grading");
    delegateAllPending(f.workspace);
    const retry=importGradingCli(f.workspace);
    assert.equal(retry.ready_to_resume, true);assert.equal(retry.imported.length,2);assert.equal(retry.already_imported.length,2);
    assert.equal(readFileSync(join(evidenceDir,retainedName),"utf8"),retainedBytes);
    assert.equal(validateExecutionEvidence(f.workspace).status, "complete");
    fullEval(f.skill,f.workspace,["--resume","--human-review","pass","--tests-status","pass"]);
    assert.equal(readFileSync(join(f.root, "candidate-calls"), "utf8"), before);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("subprocess mixed semantic-first assertions verify by immutable identity", () => {
  const f = fixture();
  try {
    const path = join(f.skill,"evals","evals.json"), doc = JSON.parse(readFileSync(path,"utf8"));
    doc.evals[0].assertions.push("contains: verified sources"); writeFileSync(path,JSON.stringify(doc));
    const run = spawnSync(process.execPath,[cli,"full-eval",f.skill,"--workspace",f.workspace,"--run-profile","fast","--execute","--grader","grader-a=fixture-model","--human-review","pass","--tests-status","pass","--format","json","--progress","none"],{encoding:"utf8",env:fakeEnv()});
    const result=JSON.parse(run.stdout);
    assert.equal(result.phases.find((p:any)=>p.name==="paired-runs-and-grading").status,"complete",JSON.stringify(result));
    assert.equal(result.phases.find((p:any)=>p.name==="static-review").status,"complete");
    assert.equal(validateExecutionEvidence(f.workspace).status,"complete");
  } finally { rmSync(f.root,{recursive:true,force:true}); }
});


test("valid historical delegated evidence remains reusable without migration", () => {
  const f=fixture();
  try {
    fullEval(f.skill,f.workspace,[]);prepareGradingCli(f.workspace);delegateAllPending(f.workspace);importGradingCli(f.workspace);
    for(const config of ["with_skill","without_skill"]){
      const run=join(f.workspace,"eval-1",config,"run-1"),dir=join(run,"grader-evidence");
      for(const name of readdirSync(dir)){
        const path=join(dir,name),j=JSON.parse(readFileSync(path,"utf8"));
        delete j.source_request;delete j.source_judgment;delete j.availability;writeFileSync(path,JSON.stringify(j));
      }
      const path=join(run,"execution-evidence.json"),manifest=JSON.parse(readFileSync(path,"utf8"));
      manifest.artifact_sha256["grader-evidence"]=artifactHash(dir);writeFileSync(path,JSON.stringify(manifest));
    }
    assert.equal(validateExecutionEvidence(f.workspace).status,"complete");
    const before=artifactHash(join(f.workspace,"eval-1","with_skill","run-1"));
    const result=importGradingCli(f.workspace);assert.equal(result.ready_to_resume,true);assert.equal(result.imported.length,0);
    assert.equal(artifactHash(join(f.workspace,"eval-1","with_skill","run-1")),before);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});

test("public full-eval JSON-pointer contains cannot pass using a sibling field", () => {
  const f=fixture();
  try {
    const path=join(f.skill,"evals","evals.json"),doc=JSON.parse(readFileSync(path,"utf8"));
    doc.evals[0].assertions=["contains: done",{id:"selected",version:1,criterion:"Selected member contains expected result",locator:{kind:"json-pointer",path:"result.json",pointer:"/selected"},operator:"contains",expected:"EXPECTED"}];writeFileSync(path,JSON.stringify(doc));
    const host=join(f.root,"pointer-host.mjs");
    writeFileSync(host,'import {writeFileSync} from "node:fs";if(!process.argv.includes("--version"))writeFileSync("result.json",JSON.stringify({selected:"WRONG",other:"EXPECTED"}));process.env.FAKE_GOOSE_VARIANT_OUTPUTS="1";process.env.FAKE_GOOSE_CANDIDATE_OUTPUT="done";process.env.FAKE_GOOSE_BASELINE_OUTPUT="done";await import('+JSON.stringify(fake)+');');
    const run=spawnSync(process.execPath,[cli,"full-eval",f.skill,"--workspace",f.workspace,"--run-profile","fast","--execute","--human-review","pass","--tests-status","pass","--format","json","--progress","none"],{encoding:"utf8",env:{...fakeEnv(),SKILL_CREATOR_GOOSE_COMMAND:process.execPath+" "+host}});
    const result=JSON.parse(run.stdout);assert.equal(result.phases.find((p:any)=>p.name==="paired-runs-and-grading").status,"complete",JSON.stringify(result));
    const grade=JSON.parse(readFileSync(join(f.workspace,"eval-1","with_skill","run-1","grading.json"),"utf8"));
    assert.equal(grade.expectations.find((e:any)=>e.id==="selected").verdict,"fail");
    assert.equal(validateExecutionEvidence(f.workspace).status,"complete");
  }finally{rmSync(f.root,{recursive:true,force:true});}
});


test("retained imports reject changed original envelopes and stored grading hashes", () => {
  for(const target of ["request","judgment","grading"]) {
    const f=fixture();try {
      fullEval(f.skill,f.workspace,[]);prepareGradingCli(f.workspace);delegateAllPending(f.workspace);assert.equal(importGradingCli(f.workspace).ready_to_resume,true);
      const run=join(f.workspace,"eval-1","with_skill","run-1"),dir=join(run,"grader-evidence"),id=readdirSync(dir)[0];
      const path=target==="grading"?join(run,"grading.json"):join(f.workspace,target==="request"?"grading-requests":"grading-judgments",id);
      const doc=JSON.parse(readFileSync(path,"utf8"));
      if(target==="request")doc.instructions+=" changed";else if(target==="judgment")doc.rationale+=" changed";else doc.expectations[0].verdict="fail";
      writeFileSync(path,JSON.stringify(doc));
      const before=readFileSync(join(run,"execution-evidence.json"),"utf8");
      const result=importGradingCli(f.workspace);assert.equal(result.ready_to_resume,false);assert.ok(result.errors.length+result.rejected.length>0);
      assert.equal(readFileSync(join(run,"execution-evidence.json"),"utf8"),before);
    }finally{rmSync(f.root,{recursive:true,force:true});}
  }
});
