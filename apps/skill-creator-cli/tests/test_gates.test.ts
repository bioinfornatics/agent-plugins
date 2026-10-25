import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateEvaluationReceipt } from "../dist/scripts/validate_evaluation_receipt.js";
import { sourceHash, verifySkill } from "../dist/scripts/verify_skill_gates.js";

function fixture() {
  const tmp = mkdtempSync(join(tmpdir(), "skill-gates-"));
  const root = join(tmp, "demo");
  mkdirSync(root);
  writeFileSync(
    join(root, "SKILL.md"),
    "---\nname: demo\ndescription: Handles demo workflows. Use when testing release gates\n---\n\n# Demo\n",
  );
  return { tmp, root, workspace: join(tmp, "evaluation") };
}

function benchmark(workspace: string, hash: string, current = 0.9, baseline = 0.7): void {
  mkdirSync(workspace, { recursive: true });
  writeFileSync(
    join(workspace, "benchmark.json"),
    JSON.stringify({
      metadata: { source_sha256: hash },
      run_summary: {
        with_skill: { pass_rate: { mean: current } },
        old_skill: { pass_rate: { mean: baseline } },
      },
    }),
  );
  writeFileSync(join(workspace, "review.html"), "ok");
}


test("source hash excludes evaluation plans but includes implementation sources", () => {
  const { tmp, root } = fixture();
  try {
    mkdirSync(join(root, "evals"), { recursive: true });
    mkdirSync(join(root, "evaluation"), { recursive: true });
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "evals", "evals.json"), JSON.stringify({ evals: [{ id: 1 }] }));
    writeFileSync(join(root, "evaluation", "notes.json"), JSON.stringify({ note: "first" }));
    const customEval = join(root, "custom-plan.json");
    writeFileSync(customEval, JSON.stringify({ evals: [{ id: 1 }] }));
    writeFileSync(join(root, "scripts", "implement.ts"), "export const value = 1;\n");
    const initial = sourceHash(root, [customEval]);
    writeFileSync(join(root, "evals", "evals.json"), JSON.stringify({ evals: [{ id: 2 }] }));
    writeFileSync(join(root, "evaluation", "notes.json"), JSON.stringify({ note: "second" }));
    writeFileSync(customEval, JSON.stringify({ evals: [{ id: 2 }] }));
    assert.equal(sourceHash(root, [customEval]), initial);
    writeFileSync(join(root, "scripts", "implement.ts"), "export const value = 2;\n");
    assert.notEqual(sourceHash(root, [customEval]), initial);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("static skill gates pass", () => {
  const { tmp, root } = fixture();
  try {
    const receipt = verifySkill({ skillPath: root, profile: "static" });
    assert.equal(receipt.status, "pass");
    assert.equal(receipt.gates.authoring.status, "pass");
    assert.equal(receipt.gates.behavior.status, "na");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("positive delta cannot bypass absolute threshold", () => {
  const { tmp, root, workspace } = fixture();
  try {
    benchmark(workspace, sourceHash(root), 0.42, 0.29);
    const receipt = verifySkill({
      skillPath: root,
      profile: "evaluation",
      evaluation: workspace,
      testsStatus: "pass",
      humanReview: "pass",
    });
    assert.equal(receipt.gates.behavior.status, "fail");
    assert.equal(receipt.status, "fail");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("evaluation evidence is bound to current source hash", () => {
  const { tmp, root, workspace } = fixture();
  try {
    benchmark(workspace, "a".repeat(64));
    let receipt = verifySkill({
      skillPath: root,
      profile: "evaluation",
      evaluation: workspace,
      testsStatus: "pass",
      humanReview: "pass",
    });
    assert.equal(receipt.gates.behavior.status, "fail");

    const data = JSON.parse(requireText(join(workspace, "benchmark.json")));
    delete data.metadata.source_sha256;
    writeFileSync(join(workspace, "benchmark.json"), JSON.stringify(data));
    receipt = verifySkill({
      skillPath: root,
      profile: "release",
      evaluation: workspace,
      testsStatus: "pass",
      triggeringStatus: "pass",
      humanReview: "pass",
    });
    assert.equal(receipt.gates.behavior.status, "blocked");
    assert.equal(receipt.status, "blocked");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

function requireText(path: string): string {
  return readFileSync(path, "utf8");
}

test("invalid runtime choices and numeric values are rejected", () => {
  const { tmp, root } = fixture();
  try {
    assert.throws(() => verifySkill({ skillPath: root, profile: "typo" }), /profile must be/);
    assert.throws(
      () => verifySkill({ skillPath: root, profile: "static", testsStatus: "yes" }),
      /tests status must be/,
    );
    assert.throws(
      () => verifySkill({ skillPath: root, profile: "static", humanReview: "yes" }),
      /human review must be/,
    );
    assert.throws(
      () => verifySkill({ skillPath: root, profile: "static", minPassRate: Number.NaN }),
      /finite number/,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("non-finite and out-of-range benchmark pass rates fail closed", () => {
  const { tmp, root, workspace } = fixture();
  try {
    benchmark(workspace, sourceHash(root), 1.1, 0.7);
    const receipt = verifySkill({
      skillPath: root,
      profile: "evaluation",
      evaluation: workspace,
      testsStatus: "pass",
      humanReview: "pass",
    });
    assert.equal(receipt.gates.behavior.status, "fail");
    assert.match(receipt.gates.behavior.reason ?? "", /finite/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

function createRun(runDir: string, passRate = 1): void {
  mkdirSync(join(runDir, "outputs"), { recursive: true });
  writeFileSync(join(runDir, "outputs", "result.txt"), "ok");
  writeFileSync(
    join(runDir, "grading.json"),
    JSON.stringify({
      summary: { pass_rate: passRate },
      expectations: [{ text: "works", passed: true, evidence: "result" }],
    }),
  );
  writeFileSync(join(runDir, "timing.json"), "{}");
}

for (const legacy of [false, true]) {
  test(`evaluation receipt accepts ${legacy ? "legacy runs/" : "run-N"} layout`, () => {
    const { tmp, workspace } = fixture();
    try {
      const evalRoot = legacy ? join(workspace, "runs", "eval-1") : join(workspace, "eval-1");
      mkdirSync(evalRoot, { recursive: true });
      writeFileSync(join(evalRoot, "eval_metadata.json"), "{}");
      for (const config of ["with_skill", "without_skill"]) {
        const configDir = join(evalRoot, config);
        createRun(legacy ? configDir : join(configDir, "run-1"));
        if (!legacy) createRun(join(configDir, "run-2"));
      }
      writeFileSync(
        join(workspace, "benchmark.json"),
        JSON.stringify({
          run_summary: {
            with_skill: { pass_rate: { mean: 1 } },
            without_skill: { pass_rate: { mean: 0.5 } },
          },
        }),
      );
      writeFileSync(join(workspace, "benchmark.md"), "summary");
      writeFileSync(join(workspace, "review.html"), "review");
      assert.equal(validateEvaluationReceipt(workspace).status, "complete");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
}


test("evaluation receipt fails closed on explicit non-final canonical metadata", () => {
  const { tmp, workspace } = fixture();
  try {
    const evalRoot = join(workspace, "eval-1");
    mkdirSync(evalRoot, { recursive: true });
    writeFileSync(join(evalRoot, "eval_metadata.json"), "{}");
    for (const config of ["with_skill", "without_skill"]) createRun(join(evalRoot, config, "run-1"));
    const valid = { run_summary: { with_skill: { pass_rate: { mean: 1 } }, without_skill: { pass_rate: { mean: 0.5 } } } };
    writeFileSync(join(workspace, "benchmark.md"), "summary");
    writeFileSync(join(workspace, "review.html"), "legacy review without optional metadata");
    writeFileSync(join(workspace, "benchmark.json"), JSON.stringify(valid));
    assert.equal(validateEvaluationReceipt(workspace).status, "complete");
    const attacks = [
      ["benchmark.json", { provisional: true }], ["benchmark.json", { final_receipt: false }],
      ["benchmark.json", { canonical: false }], ["benchmark.json", { historical: true }],
      ["benchmark.json", { status: "running" }], ["progress.json", { status: "blocked" }],
    ] as const;
    for (const [name, metadata] of attacks) {
      writeFileSync(join(workspace, "benchmark.json"), JSON.stringify(valid));
      rmSync(join(workspace, "progress.json"), { force: true });
      writeFileSync(join(evalRoot, "eval_metadata.json"), "{}");
      writeFileSync(join(workspace, name), JSON.stringify(name === "benchmark.json" ? { ...valid, ...metadata } : metadata));
      const receipt = validateEvaluationReceipt(workspace);
      assert.equal(receipt.status, "blocked", name + " " + JSON.stringify(metadata));
      assert.match(receipt.missing.join("\n"), /provisional|final_receipt|noncanonical|historical|status must be final/);
    }
    writeFileSync(join(workspace, "benchmark.json"), JSON.stringify(valid));
    writeFileSync(join(evalRoot, "eval_metadata.json"), "{}");
    for (const metadata of [{ provisional: true }, { final_receipt: false }, { canonical: false }, { historical: true }, { status: "provisional" }]) {
      writeFileSync(join(workspace, "review.html"), `<script>const REVIEW_IR=${JSON.stringify(metadata)};\n</script>`);
      assert.equal(validateEvaluationReceipt(workspace).status, "blocked");
    }
    writeFileSync(join(workspace, "review.html"), `<script>const REVIEW_IR=${JSON.stringify({status:"complete",provisional:false,final_receipt:true,canonical:true,historical:false})};\n</script>`);
    writeFileSync(join(workspace, "benchmark.json"), JSON.stringify({...valid,status:"complete",provisional:false,final_receipt:true,canonical:true,historical:false}));
    writeFileSync(join(workspace, "progress.json"), JSON.stringify({status:"complete",provisional:false,final_receipt:true}));
    assert.equal(validateEvaluationReceipt(workspace).status, "complete");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("release rejects a fixed t interval relabeled as an adaptive claim", () => {
  const { tmp, root, workspace } = fixture();
  try {
    benchmark(workspace, sourceHash(root));
    const path=join(workspace,"benchmark.json"),data=JSON.parse(readFileSync(path,"utf8"));
    data.decision_evidence={mode:"adaptive",method:"student-t-95-fixed-sample",decision:"winner"};writeFileSync(path,JSON.stringify(data));
    const receipt=verifySkill({skillPath:root,profile:"release",evaluation:workspace,testsStatus:"pass",triggeringStatus:"pass",humanReview:"pass"});
    assert.equal(receipt.gates.behavior.status,"fail");assert.match(receipt.gates.behavior.reason,/adaptive release verification failed|policy artifact/i);
  } finally { rmSync(tmp,{recursive:true,force:true}); }
});

test("release statistics fail closed when count, validity, or confidence interval is malformed", () => {
  const { tmp, root, workspace } = fixture();
  try {
    const cases = [
      { count: 1, statistically_valid: true, confidence_interval_95: { lower: 0.1, upper: 0.3 } },
      { count: 2.5, statistically_valid: true, confidence_interval_95: { lower: 0.1, upper: 0.3 } },
      { count: 2, statistically_valid: false, confidence_interval_95: { lower: 0.1, upper: 0.3 } },
      { count: 2, statistically_valid: true, confidence_interval_95: { lower: 0.3, upper: 0.1 } },
      { count: 2, statistically_valid: true, confidence_interval_95: null },
    ];
    for (const paired of cases) {
      benchmark(workspace, sourceHash(root));
      const path=join(workspace,"benchmark.json"), data=JSON.parse(readFileSync(path,"utf8"));
      data.run_summary.delta={paired:{pass_rate:paired}}; writeFileSync(path,JSON.stringify(data));
      const receipt=verifySkill({skillPath:root,profile:"release",evaluation:workspace,testsStatus:"pass",triggeringStatus:"pass",humanReview:"pass"});
      assert.equal(receipt.gates.behavior.status,"fail");
      assert.match(receipt.gates.behavior.reason??"",/finite integer paired sample count/);
    }
  } finally { rmSync(tmp,{recursive:true,force:true}); }
});
