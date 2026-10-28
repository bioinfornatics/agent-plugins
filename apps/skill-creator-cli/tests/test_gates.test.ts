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
      decision_evidence: {mode:"fixed",method_version:"2.0",decision:"winner"},
      run_summary: {
        with_skill: { pass_rate: { mean: current } },
        old_skill: { pass_rate: { mean: baseline } },
        delta: { sampling:{unit:"complete-fixed-suite-repetition",complete:true},stable_improvement:true,paired:{pass_rate:{count:3,statistically_valid:true,confidence_interval_95:{lower:0.1,upper:0.3}}} },
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

test("unverified positive delta cannot bypass the independent evidence boundary", () => {
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
    assert.equal(receipt.gates.behavior.status, "blocked");
    assert.equal(receipt.status, "blocked");
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
    rmSync(join(workspace, "review.html"));
    writeFileSync(join(workspace, "feedback.json"), JSON.stringify({status:"complete",reviews:[]}));
    assert.deepEqual(validateEvaluationReceipt(workspace).missing, ["review.html"], "manual feedback cannot substitute for the report");
    writeFileSync(join(workspace, "review.html"), "legacy review without optional metadata");
    writeFileSync(join(workspace, "feedback.json"), JSON.stringify({status:"provisional",reviews:[]}));
    assert.equal(validateEvaluationReceipt(workspace).status, "complete", "obsolete manual feedback cannot invalidate report evidence");
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
    assert.equal(receipt.gates.behavior.status,"fail");assert.match(receipt.gates.behavior.reason,/adaptive verification failed|policy artifact/i);
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
      data.run_summary.delta={sampling:{unit:"complete-fixed-suite-repetition",complete:true},stable_improvement:true,paired:{pass_rate:paired}}; writeFileSync(path,JSON.stringify(data));
      const receipt=verifySkill({skillPath:root,profile:"release",evaluation:workspace,testsStatus:"pass",triggeringStatus:"pass",humanReview:"pass"});
      assert.equal(receipt.gates.behavior.status,"blocked");
      assert.match(receipt.gates.behavior.reason??"",/complete sampling and stable improvement/);
    }
  } finally { rmSync(tmp,{recursive:true,force:true}); }
});

test("editable stable fixed-suite claims without planned evidence remain archival and blocked",()=>{
 const {tmp,root,workspace}=fixture();try{
  benchmark(workspace,sourceHash(root));const options={skillPath:root,profile:"evaluation" as const,evaluation:workspace,testsStatus:"pass" as const,humanReview:"pass" as const};assert.equal(verifySkill(options).gates.behavior.status,"blocked");
  const path=join(workspace,"benchmark.json"),original=JSON.parse(readFileSync(path,"utf8"));
  for(const delta of [{...original.run_summary.delta,stable_improvement:false},{...original.run_summary.delta,sampling:{...original.run_summary.delta.sampling,complete:false}},{...original.run_summary.delta,paired:{pass_rate:{count:1,statistically_valid:true,confidence_interval_95:{lower:.1,upper:.3}}}}]){writeFileSync(path,JSON.stringify({...original,run_summary:{...original.run_summary,delta}}));assert.equal(verifySkill(options).gates.behavior.status,"blocked");}
 }finally{rmSync(tmp,{recursive:true,force:true});}
});


import { spawnSync } from "node:child_process";
import { cpSync } from "node:fs";
import { fullEval } from "../dist/scripts/full_eval.js";
import { verifyFixedWorkspace } from "../dist/scripts/aggregate_benchmark.js";
import { artifactHash, listRunDirs, validateExecutionEvidence } from "../dist/scripts/evaluation_provenance.js";

test("public verify and receipt rederive every fixed projection, with authentic n=1 counterexample and stable nondegenerate control",async()=>{
 const f=fixture(),host=join(f.tmp,"host.mjs"),counter=join(f.tmp,"counter.json"),prior=Object.fromEntries(["SKILL_CREATOR_GOOSE_COMMAND","GOOSE_PROVIDER","GOOSE_MODEL"].map(k=>[k,process.env[k]]));
 try {
  mkdirSync(join(f.root,"evals"));
  writeFileSync(join(f.root,"evals/evals.json"),JSON.stringify({skill_name:"demo",aggregate_budget:{max_runs:6,max_turns:18,timeout_seconds:30},evals:[{id:1,target:{kind:"existing-skill",execution:"execute",path:"."},prompt:"Return the ten report tokens.",assertions:Array.from({length:10},(_,i)=>"contains: token"+i),capabilities:{filesystem:true,agent_runner:true,browser:false,network:false,tools:[]},budget:{max_turns:3,timeout_seconds:5},aggregate_budget:{max_runs:6,max_turns:18,timeout_seconds:30}}]}));
  writeFileSync(host,'import {existsSync,readFileSync,writeFileSync} from "node:fs";if(process.argv.includes("--version")){console.log("mock 1");process.exit(0);}readFileSync(0,"utf8");const candidate=existsSync(".agents/skills"),path='+JSON.stringify(counter)+';const counts=existsSync(path)?JSON.parse(readFileSync(path,"utf8")):{candidate:0,baseline:0},key=candidate?"candidate":"baseline",index=++counts[key];writeFileSync(path,JSON.stringify(counts));console.log(JSON.stringify({type:"complete",output:candidate?"token0 token1 token2 token3 token4 token5 token6 token7 token8 token9":!counts.stable?"token0 token1 token2 token3 token4 token5 token6 token7 token8 token9":index===1?"token0":"no report",usage:{total_tokens:10}}));');
  Object.assign(process.env,{SKILL_CREATOR_GOOSE_COMMAND:process.execPath+" "+host,GOOSE_PROVIDER:"ollama",GOOSE_MODEL:"no-provider-fixture"});
  const options={skillPath:f.root,evaluation:f.workspace,profile:"release" as const,testsStatus:"pass" as const,triggeringStatus:"pass" as const,humanReview:"pass" as const};
  await fullEval({skillPath:f.root,workspace:f.workspace,execute:true,progress:"none",cacheDir:null});
  assert.equal(validateExecutionEvidence(f.workspace).status,"complete");
  const path=join(f.workspace,"benchmark.json"),original=readFileSync(path,"utf8"),b=JSON.parse(original),evidenceHash=validateExecutionEvidence(f.workspace).evidence_sha256;assert.equal(b.run_summary.with_skill.pass_rate.mean,1);assert.equal(b.run_summary.without_skill.pass_rate.mean,1);assert.equal(b.decision_evidence.sample_count,1);
  // Original F1: edit derived benchmark fields only, preserve every authentic run.
  b.run_summary.with_skill.pass_rate.mean=1;b.run_summary.without_skill.pass_rate.mean=0;
  Object.assign(b.run_summary.delta,{pass_rate:"+1.00",stable_improvement:true,stable_improvement_reason:"forged independent proof"});
  Object.assign(b.run_summary.delta.sampling,{planned_rounds:3,complete_rounds:3,missing_quality:[],complete:true});
  Object.assign(b.run_summary.delta.paired.pass_rate,{count:3,sample_count:3,mean:1,statistically_valid:true,confidence_interval_95:{lower:.8,upper:1}});
  writeFileSync(path,JSON.stringify(b));
  for(const base of [new URL("../dist/scripts/",import.meta.url),new URL("file://"+join(f.tmp,"copied-runtime/dist/scripts/"))]){
   if(base.pathname.includes("copied-runtime")) {cpSync(new URL("../dist/",import.meta.url),join(f.tmp,"copied-runtime/dist"),{recursive:true});cpSync(new URL("../node_modules/",import.meta.url),join(f.tmp,"copied-runtime/node_modules"),{recursive:true});writeFileSync(join(f.tmp,"copied-runtime/package.json"),'{"type":"module"}');}
   const verify=await import(new URL("verify_skill_gates.js",base).href),validate=await import(new URL("validate_evaluation_receipt.js",base).href);
   const r=verify.verifySkill(options);assert.equal(r.gates.behavior.status,"fail");assert.equal(r.decision_evidence.sample_count,1);writeFileSync(join(f.workspace,"receipt.json"),JSON.stringify(r));assert.equal(validate.validateEvaluationReceipt(f.workspace).release_eligible,false);
  }
  assert.equal(validateExecutionEvidence(f.workspace).evidence_sha256,evidenceHash);assert.equal(JSON.parse(readFileSync(path,"utf8")).run_summary.delta.stable_improvement,true,"verification must not rewrite forged evidence");
  writeFileSync(path,original);
  const stable=join(f.tmp,"stable");writeFileSync(counter,'{"candidate":0,"baseline":0,"stable":true}');
  const stableResult=await fullEval({skillPath:f.root,workspace:stable,runProfile:"standard",execute:true,progress:"none",cacheDir:null});assert.ok(stableResult.receipt,JSON.stringify(stableResult));
  const stableOptions={...options,evaluation:stable},stablePath=join(stable,"benchmark.json"),clean=readFileSync(stablePath,"utf8"),cleanData=JSON.parse(clean);
  assert.equal(validateExecutionEvidence(stable).status,"complete");
  const independently=verifyFixedWorkspace(stable,cleanData);assert.deepEqual(independently.errors,[]);assert.equal(independently.decision.decision,"winner");
  const good=verifySkill(stableOptions);assert.equal(good.status,"pass",JSON.stringify(good.gates));writeFileSync(join(stable,"receipt.json"),JSON.stringify(good));assert.equal(validateEvaluationReceipt(stable).release_eligible,true);
  const copiedVerify=await import(new URL("file://"+join(f.tmp,"copied-runtime/dist/scripts/verify_skill_gates.js")).href),copiedValidate=await import(new URL("file://"+join(f.tmp,"copied-runtime/dist/scripts/validate_evaluation_receipt.js")).href);
  assert.equal(copiedVerify.verifySkill(stableOptions).status,"pass");assert.equal(copiedValidate.validateEvaluationReceipt(stable).release_eligible,true);
  const mutations:Array<(x:any)=>void>=[x=>x.run_summary.with_skill.pass_rate.p95=.1,x=>x.run_summary.delta.paired.pass_rate.confidence_interval_95.lower=.99,x=>x.run_summary.delta.sampling.scenario_weights[0].weight=.5,x=>x.decision_evidence.sample_count=30,x=>x.decision_evidence.counted_membership=["invented"],x=>x.runs.pop(),x=>x.metadata.initial_policy_hash="forged",x=>x.metadata.evals_run.push(99),x=>x.metadata.runs_per_configuration.with_skill=300,x=>x.campaign.aggregate_membership.push({artifact_root:"invented"}),x=>x.run_summary.delta.stable_improvement=false,x=>x.run_summary.delta.resource_missingness.tokens.complete_rounds=100,x=>x.run_summary.delta.paired.tokens.mean=999];
  for(const change of mutations){const x=JSON.parse(clean);change(x);writeFileSync(stablePath,JSON.stringify(x));const before=artifactHash(stablePath);assert.equal(verifySkill(stableOptions).gates.behavior.status,"fail");assert.equal(validateEvaluationReceipt(stable).release_eligible,false);assert.equal(artifactHash(stablePath),before);}
  writeFileSync(stablePath,clean);
  // A forged passing receipt cannot replace independent source/behavior checks.
  writeFileSync(join(f.root,"extra.txt"),"changed source");assert.equal(validateEvaluationReceipt(stable).release_eligible,false);rmSync(join(f.root,"extra.txt"));
  writeFileSync(join(stable,".full-eval-migration-receipt.json"),"{}");assert.equal(verifyFixedWorkspace(stable,cleanData).historical,true);assert.equal(validateEvaluationReceipt(stable).release_eligible,false);assert.equal(readFileSync(stablePath,"utf8"),clean);rmSync(join(stable,".full-eval-migration-receipt.json"));
  // Authentic evidence must be verified before aggregate values are read.
  const grade=join(listRunDirs(stable)[0],"grading.json"),gradeBytes=readFileSync(grade,"utf8");writeFileSync(grade,gradeBytes+" ");assert.equal(verifyFixedWorkspace(stable,cleanData).independently_recomputed,false);assert.equal(validateEvaluationReceipt(stable).release_eligible,false);
 }finally{for(const [k,v] of Object.entries(prior))v===undefined?delete process.env[k]:process.env[k]=v;rmSync(f.tmp,{recursive:true,force:true});}
});
