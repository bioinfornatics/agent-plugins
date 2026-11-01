import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeEvaluation } from "../dist/scripts/analyze_evaluation.js";

function fixedBenchmark(current:number, baseline:number, rounds=1) {
 return {run_summary:{with_skill:{pass_rate:{mean:current}},without_skill:{pass_rate:{mean:baseline}},delta:{sampling:{complete:true,scenario_weights:[{scenario_id:"1",weight:1}],planned_rounds:rounds,complete_rounds:rounds,missing_quality:[]}}},decision_evidence:{mode:"fixed",method_version:"2.0",terminal:true}};
}
function writeGrade(ws:string, configuration:string, passed:boolean, round=1) {
 const run=join(ws,"eval-1",configuration,"run-"+round);mkdirSync(run,{recursive:true});
 writeFileSync(join(run,"grading.json"),JSON.stringify({expectations:[{text:"Task completed",passed,evidence:passed?"Result present":"Result absent"}],summary:{pass_rate:passed?1:0,passed:passed?1:0,failed:passed?0:1,total:1}}));
}


test("evaluation analysis maps rule-space gaps to domain coverage",()=>{const root=mkdtempSync(join(tmpdir(),"eval-coverage-")),skill=join(root,"demo"),ws=join(root,"workspace"),evalDir=join(ws,"eval-1"),run=join(evalDir,"with_skill","run-1");try{mkdirSync(join(run,"outputs"),{recursive:true});mkdirSync(skill);writeFileSync(join(skill,"SKILL.md"),"---\nname: demo\ndescription: Checks API schemas. Use when compatibility must be reviewed.\n---\n# Demo\nCompare schema versions.\n");writeFileSync(join(evalDir,"eval_metadata.json"),"{}");writeFileSync(join(run,"grading.json"),JSON.stringify({expectations:[{text:"Covers request and response directions across supported versions",passed:false,evidence:"The script implements only one illustrative request case"}],summary:{pass_rate:0}}));writeFileSync(join(ws,"benchmark.json"),JSON.stringify({run_summary:{with_skill:{pass_rate:{mean:0}},without_skill:{pass_rate:{mean:0}}}}));writeFileSync(join(ws,"review.html"),"ok");const r=analyzeEvaluation(ws,skill);assert.equal(r.failures[0].category,"domain-coverage");assert.ok(r.pattern_review.recommended.some(x=>x.pattern==="rule-rich-domain-coverage"));}finally{rmSync(root,{recursive:true,force:true});}});

test("evaluation analysis maps failures and navigation evidence to patterns",()=>{const root=mkdtempSync(join(tmpdir(),"eval-analysis-")),skill=join(root,"demo"),ws=join(root,"workspace"),evalDir=join(ws,"eval-1"),run=join(evalDir,"with_skill","run-1");try{mkdirSync(join(run,"outputs"),{recursive:true});mkdirSync(skill);writeFileSync(join(skill,"SKILL.md"),"---\nname: demo\ndescription: Processes demos. Use when demo processing is requested.\n---\n# Demo\nValidate the result.\n");writeFileSync(join(evalDir,"eval_metadata.json"),JSON.stringify({navigation_expectations:{must_read:["SKILL.md"],read_when_relevant:[],must_not_read:["references/unused.md"]}}));writeFileSync(join(run,"grading.json"),JSON.stringify({expectations:[{text:"Loads the required reference before choosing the provider",passed:false,evidence:"No reference read was recorded"}],summary:{pass_rate:0}}));writeFileSync(join(run,"navigation.json"),JSON.stringify({read:["references/unused.md"]}));writeGrade(ws,"with_skill",true,2);writeGrade(ws,"without_skill",true);writeGrade(ws,"without_skill",false,2);writeFileSync(join(ws,"benchmark.json"),JSON.stringify(fixedBenchmark(0.5,0.5,2)));writeFileSync(join(ws,"review.html"),"ok");const r=analyzeEvaluation(ws,skill);assert.equal(r.status,"complete");assert.equal(r.decision,"revise");assert.equal(r.failures[0].category,"navigation");assert.ok(r.pattern_review.recommended.some(x=>x.pattern==="progressive-disclosure"));assert.equal(r.navigation[0].status,"warning");}finally{rmSync(root,{recursive:true,force:true});}});


test("schema-v2 uncertainty is not task failure advice, with legacy and explicit-fail controls",()=>{
 const root=mkdtempSync(join(tmpdir(),"eval-uncertainty-")),skill=join(root,"demo"),ws=join(root,"workspace"),run=join(ws,"eval-1","with_skill","run-1");
 try{mkdirSync(run,{recursive:true});mkdirSync(skill);writeFileSync(join(skill,"SKILL.md"),"---\nname: demo\ndescription: Handles report requests.\n---\n# Demo\nReturn report.\n");writeFileSync(join(ws,"review.html"),"ok");writeFileSync(join(ws,"benchmark.json"),JSON.stringify({run_summary:{with_skill:{pass_rate:{mean:null}},without_skill:{pass_rate:{mean:1}},delta:{sampling:{complete:false}}}}));
  writeFileSync(join(run,"grading.json"),JSON.stringify({schema_version:2,expectations:[{text:"Fact established",passed:false,verdict:"inconclusive",evidence:[]},{text:"Evidence available",passed:false,verdict:"unavailable",evidence:[]}]}));
  const uncertain=analyzeEvaluation(ws,skill);assert.equal(uncertain.failures.length,0);assert.equal(uncertain.uncertainty.length,2);assert.equal(uncertain.pattern_review.recommended.length,0);assert.equal(uncertain.decision,"inconclusive");assert.equal(uncertain.benchmark.current,null);assert.equal(uncertain.benchmark.delta,null);assert.doesNotMatch(JSON.stringify(uncertain.uncertainty),/apply the smallest correction|cited failures/);
  writeFileSync(join(run,"grading.json"),JSON.stringify({schema_version:2,expectations:[{text:"Task completed",passed:false,verdict:"fail",evidence:[]}]}));assert.equal(analyzeEvaluation(ws,skill).failures.length,1);
  writeFileSync(join(run,"grading.json"),JSON.stringify({expectations:[{text:"Legacy task failed",passed:false,evidence:"No output"}]}));assert.equal(analyzeEvaluation(ws,skill).failures.length,1);
 }finally{rmSync(root,{recursive:true,force:true});}
});

// Absence is not a passing quality observation, even without explicit uncertainty.
test("analysis cannot accept absent, null, or incomplete quality", () => {
 const root=mkdtempSync(join(tmpdir(),"analysis-missing-")),skill=join(root,"demo"),ws=join(root,"workspace");
 try {
  mkdirSync(skill);mkdirSync(ws);writeFileSync(join(skill,"SKILL.md"),"# Demo");writeFileSync(join(ws,"review.html"),"ok");
  for(const benchmark of [undefined,{}, {run_summary:{with_skill:{pass_rate:{mean:null}},without_skill:{pass_rate:{mean:1}}}}, {run_summary:{with_skill:{pass_rate:{mean:1}}}}, {run_summary:{with_skill:{pass_rate:{mean:1}},without_skill:{pass_rate:{mean:0}},delta:{sampling:{complete:false}}}}]) {
   if(benchmark!==undefined)writeFileSync(join(ws,"benchmark.json"),JSON.stringify(benchmark));
   const result=analyzeEvaluation(ws,skill);
   assert.equal(result.decision,"inconclusive",JSON.stringify(benchmark));assert.equal(result.status,"blocked");assert.equal(result.benchmark.delta,null);
  }
  writeGrade(ws,"with_skill",true);writeGrade(ws,"without_skill",true);
  writeFileSync(join(ws,"benchmark.json"),JSON.stringify(fixedBenchmark(1,1)));
  const complete=analyzeEvaluation(ws,skill);assert.equal(complete.decision,"accept");assert.equal(complete.status,"complete");assert.equal(complete.benchmark.delta,0);
  const adaptive={...fixedBenchmark(1,1),decision_evidence:{mode:"adaptive",terminal:true,scenario_weights:[{id:"1",weight:1}],sample_count:1,counted_membership:[{scenario_id:"1",pair_index:1,candidate_run:"eval-1/with_skill/run-1",baseline_run:"eval-1/without_skill/run-1"}]}};
  writeFileSync(join(ws,"benchmark.json"),JSON.stringify(adaptive));assert.equal(analyzeEvaluation(ws,skill).decision,"accept");
  const mixed={...adaptive,decision_evidence:{...adaptive.decision_evidence,scenario_weights:[{id:"1",weight:.5},{id:"2",weight:.5}],counted_membership:[...adaptive.decision_evidence.counted_membership,{scenario_id:"2",pair_index:1,candidate_run:"eval-2/with_skill/run-1",baseline_run:"eval-2/without_skill/run-1"}]}};
  for(const arm of ["with_skill","without_skill"]){const path=join(ws,"eval-2",arm,"run-1");mkdirSync(path,{recursive:true});writeFileSync(join(path,"grading.json"),JSON.stringify({expectations:[{text:"Task complete",passed:true}],summary:{pass_rate:1}}));}
  writeFileSync(join(ws,"benchmark.json"),JSON.stringify(mixed));assert.equal(analyzeEvaluation(ws,skill).decision,"accept","one round includes every declared scenario, not one pair total");
  mixed.decision_evidence.counted_membership.pop();writeFileSync(join(ws,"benchmark.json"),JSON.stringify(mixed));assert.equal(analyzeEvaluation(ws,skill).decision,"inconclusive");
  writeFileSync(join(ws,"benchmark.json"),JSON.stringify(fixedBenchmark(1,1,2)));const missingRound=analyzeEvaluation(ws,skill);assert.equal(missingRound.decision,"inconclusive");assert.equal(missingRound.benchmark.delta,null);
 } finally {rmSync(root,{recursive:true,force:true});}
});

// Numeric aggregates cannot substitute for membership or the underlying grading.
test("numeric quality requires affirmative membership and usable both-arm grading", () => {
 const root=mkdtempSync(join(tmpdir(),"analysis-coverage-")),skill=join(root,"demo"),ws=join(root,"workspace");
 const summary={with_skill:{pass_rate:{mean:1}},without_skill:{pass_rate:{mean:0}}};
 const complete={run_summary:{...summary,delta:{sampling:{complete:true,scenario_weights:[{scenario_id:"1",weight:1}],planned_rounds:1,complete_rounds:1,missing_quality:[]}}},decision_evidence:{mode:"fixed",method_version:"2.0",terminal:true}};
 try {
  mkdirSync(skill);mkdirSync(ws);writeFileSync(join(skill,"SKILL.md"),"# Demo");writeFileSync(join(ws,"review.html"),"ok");
  for(const benchmark of [{run_summary:summary},{...complete,decision_evidence:undefined},complete]) {
   writeFileSync(join(ws,"benchmark.json"),JSON.stringify(benchmark));
   const result=analyzeEvaluation(ws,skill);assert.equal(result.decision,"inconclusive","numeric means without membership or runs");assert.equal(result.status,"blocked");assert.equal(result.benchmark.delta,null);
  }
  const candidate=join(ws,"eval-1","with_skill","run-1"),baseline=join(ws,"eval-1","without_skill","run-1");
  mkdirSync(candidate,{recursive:true});mkdirSync(baseline,{recursive:true});
  const pass={schema_version:2,expectations:[{text:"Task completed",verdict:"pass",passed:true,evidence:["result"]}],summary:{pass_rate:1}};
  writeFileSync(join(candidate,"grading.json"),JSON.stringify(pass));
  for(const grade of [undefined,{}, {summary:{pass_rate:0},expectations:[]}, {...pass,summary:{pass_rate:null}}, {...pass,expectations:[{text:"Task completed",passed:false}]}]) {
   if(grade!==undefined)writeFileSync(join(baseline,"grading.json"),JSON.stringify(grade));
   const result=analyzeEvaluation(ws,skill);assert.equal(result.decision,"inconclusive","missing or unusable baseline grading");assert.equal(result.benchmark.delta,null);
  }
  writeFileSync(join(baseline,"grading.json"),JSON.stringify({...pass,expectations:[{text:"Task completed",verdict:"fail",passed:false,evidence:["missing result"]}],summary:{pass_rate:0}}));
  const completeResult=analyzeEvaluation(ws,skill);assert.equal(completeResult.status,"complete");assert.equal(completeResult.decision,"revise");assert.equal(completeResult.benchmark.delta,1);
  rmSync(join(candidate,"grading.json"));const missing=analyzeEvaluation(ws,skill);assert.equal(missing.decision,"revise");assert.equal(missing.benchmark.delta,null);
 } finally {rmSync(root,{recursive:true,force:true});}
});
