import { isolateMockTransport } from "./fixtures/mock-host.ts";
isolateMockTransport();
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync,existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GooseRunner } from "../dist/scripts/runners/goose.js";
import { isolatedHostEnvironment } from "../dist/scripts/isolated_host.js";
import { fullEval } from "../dist/scripts/full_eval.js";
import { gradeOutput } from "../dist/scripts/evaluator_grading.js";
import { calculateStats } from "../dist/scripts/aggregate_benchmark.js";
const event=(names:string[])=>({type:"message",message:{content:names.map(name=>({type:"toolRequest",toolCall:{value:{name:"skills__load_skill",arguments:{name}}}}))}});
test("eventual activation scans sibling requests and qualified names",()=>{const r=new GooseRunner();assert.equal(r.eventLoadedSkill(event(["other"]),"target"),null);assert.equal(r.eventLoadedSkill(event(["other","plugin:target"]),"target"),true);assert.equal(r.eventLoadedSkill(event(["plugin:other"]),"target"),null);});
test("isolated host excludes ambient discovery roots",()=>{const root=mkdtempSync(join(tmpdir(),"isolated-test-"));try{const env=isolatedHostEnvironment(root);assert.equal(env.HOME,join(root,".host"));assert.equal(env.GOOSE_PATH_ROOT,env.HOME);assert.notEqual(env.HOME,process.env.HOME);}finally{rmSync(root,{recursive:true,force:true});}});
test("honest inconclusive rationale is preserved",async()=>{const g=await gradeOutput({prompt:"p",output:"cannot establish fact",assertions:["fact established"],variantSha256:"a",graders:[{id:"a",model:"m"}],adapter:{async grade(){return {raw:JSON.stringify({verdict:"inconclusive",evidence_quote:"",rationale:"Artifacts cannot establish this fact"}),usage:null};}},budget:{used:0,limit:1}});assert.equal(g.grading.expectations[0].verdict,"inconclusive");assert.equal(g.graderEvidence[0].rationale,"Artifacts cannot establish this fact");});
test("multi-scenario single-round result cannot claim stable improvement",async()=>{
 const root=mkdtempSync(join(tmpdir(),"fixed-suite-")),skill=join(root,"demo"),workspace=join(root,"workspace");const old=process.env.SKILL_CREATOR_GOOSE_COMMAND;
 try{mkdirSync(join(skill,"evals"),{recursive:true});writeFileSync(join(skill,"SKILL.md"),"---\nname: demo\ndescription: Handles reports. Use for report requests.\n---\n# Demo\nReturn report.\n");writeFileSync(join(skill,"evals","evals.json"),JSON.stringify({skill_name:"demo",evals:[1,2].map(id=>({id,target:{kind:"existing-skill",execution:"execute",path:"."},prompt:"Return a report",assertions:["contains: output"],capabilities:{filesystem:true,agent_runner:true,browser:false,network:false,tools:[]},budget:{max_turns:3,timeout_seconds:2}}))}));process.env.SKILL_CREATOR_GOOSE_COMMAND=process.execPath+" "+new URL("fixtures/fake-goose.mjs",import.meta.url).pathname;const result=await fullEval({skillPath:skill,workspace,execute:true,progress:"none",graders:[{id:"a",model:"fake"}]});assert.ok(result.status==="blocked"||result.status==="success",JSON.stringify(result));const b=JSON.parse(readFileSync(join(workspace,"benchmark.json"),"utf8"));assert.equal(b.run_summary.delta.paired.pass_rate.sample_count,1);assert.equal(b.run_summary.delta.stable_improvement,false);assert.equal(b.run_summary.delta.paired.pass_rate.confidence_interval_95,null);
 }finally{if(old===undefined)delete process.env.SKILL_CREATOR_GOOSE_COMMAND;else process.env.SKILL_CREATOR_GOOSE_COMMAND=old;rmSync(root,{recursive:true,force:true});}
});

import { readdirSync } from "node:fs";
import { buildGradingJudgment } from "../dist/scripts/delegated_grading_contracts.js";
import { prepareGrading, loadGradingManifest } from "../dist/scripts/prepare_grading.js";
import { importGrading } from "../dist/scripts/import_grading.js";
import { validateEvaluationReceipt } from "../dist/scripts/validate_evaluation_receipt.js";
import { designEvals } from "../dist/scripts/design_evals.js";
import { defaultAdaptivePolicy, readAdaptiveState } from "../dist/scripts/adaptive_scheduling.js";
import { readAndVerifyAnytimeQualityArtifact } from "../dist/scripts/anytime_quality.js";
import { createHash } from "node:crypto";
import { canonicalJson } from "../dist/scripts/anytime_quality.js";
import { expectedRunDirs } from "../dist/scripts/evaluation_provenance.js";
import { buildReviewIR } from "../dist/eval-viewer/generate_review.js";

// Reuses the independently reviewed rv81 host without relying on external fixture lifetime.
function correctiveFixture(options:{typed?:boolean;verdict?:string;symlink?:boolean}={}){
 const root=mkdtempSync(join(tmpdir(),"workflow-correction-")),skill=join(root,"demo"),workspace=join(root,"workspace"),host=join(root,"host.mjs"),log=join(root,"calls");
 mkdirSync(join(skill,"evals"),{recursive:true});writeFileSync(join(skill,"SKILL.md"),`---
name: demo
description: Writes reports. Use for report requests.
---
# Demo
TREATMENT_MARKER Write out/report.txt with GOOD.
`);
 const typed={id:"file-report",criterion:"The report contains GOOD",locator:{kind:"file",path:"out/report.txt"},operator:"contains",expected:"GOOD"};
 writeFileSync(join(skill,"evals/evals.json"),JSON.stringify({skill_name:"demo",evals:[{id:1,target:{kind:"existing-skill",execution:"execute",path:"."},prompt:"Please produce the quarterly report",assertions:options.typed?[typed]:["The final response reports completion","contains: done"],capabilities:{filesystem:true,agent_runner:true,browser:false,network:false,tools:["developer"]},budget:{max_turns:3,timeout_seconds:20}}]}));
 writeFileSync(host,String.raw`import {readFileSync,writeFileSync,mkdirSync,symlinkSync,existsSync,appendFileSync} from "node:fs";
 if(process.argv.includes("--version")){console.log("fake 1");process.exit(0);}const input=readFileSync(0,"utf8"),grader=input.includes("Published criteria"),withSkill=existsSync(".agents/skills");appendFileSync(${JSON.stringify(log)},JSON.stringify({grader,withSkill,injected:input.includes("TREATMENT_MARKER")})+"\n");
 if(grader){const b=JSON.parse(/Published criteria:\n([^\n]+)/.exec(input)[1]);console.log(JSON.stringify({type:"complete",output:JSON.stringify({judgments:b.map(a=>({id:a.id,version:a.version,verdict:${JSON.stringify(options.verdict??"inconclusive")},evidence_quote:${JSON.stringify(options.verdict==="pass"?"done":"")},rationale:"Artifacts cannot establish completion"}))})}));process.exit(0);}
 mkdirSync("out",{recursive:true});writeFileSync("out/report.txt",withSkill?"GOOD":"BAD");writeFileSync("out/binary.bin",Buffer.from([0,255,1,128]));if(${Boolean(options.symlink)}&&withSkill){mkdirSync("node_modules/.bin",{recursive:true});symlinkSync("../x","node_modules/.bin/x");}console.log(JSON.stringify({type:"complete",output:"done; my script exited with code 1"}));`);
 return {root,skill,workspace,host,log};
}
async function inCorrectiveHost(f:ReturnType<typeof correctiveFixture>,fn:()=>Promise<void>){const old=process.env.SKILL_CREATOR_GOOSE_COMMAND;process.env.SKILL_CREATOR_GOOSE_COMMAND=process.execPath+" "+f.host;try{await fn();}finally{if(old===undefined)delete process.env.SKILL_CREATOR_GOOSE_COMMAND;else process.env.SKILL_CREATOR_GOOSE_COMMAND=old;rmSync(f.root,{recursive:true,force:true});}}
for(const mode of ["subprocess","delegated"] as const)test(mode+" honest uncertain full-eval reaches human review, with complete evidence not release eligibility",async()=>{const f=correctiveFixture();await inCorrectiveHost(f,async()=>{
 const opts={skillPath:f.skill,workspace:f.workspace,execute:true,gradingMode:mode,progress:"none" as const,cacheDir:null,graders:[{id:"g",model:"fake"}]};let result=await fullEval(opts);
 if(mode==="delegated"){
  assert.equal(result.status,"awaiting-grading");assert.ok(result.executable_actions.some(a=>a.argv.includes("--grading-mode")&&a.argv.includes("delegated")),"grading retry preserves delegated mode");assert.ok(!result.executable_actions.some(a=>a.id==="preflight"));prepareGrading(f.workspace);const manifest=loadGradingManifest(f.workspace);mkdirSync(join(f.workspace,"grading-judgments"),{recursive:true});
  for(const name of readdirSync(join(f.workspace,"grading-requests")).filter(n=>n.endsWith(".json")&&n!=="manifest.json")){const request=JSON.parse(readFileSync(join(f.workspace,"grading-requests",name),"utf8")),entry=manifest[request.invocation_id];const judgment=buildGradingJudgment({invocationId:request.invocation_id,requestSha256:request.request_sha256,bindings:request.bindings,grader:{id:entry.grader_id,model:entry.grader_model,provider:entry.grader_provider},verdict:"inconclusive",evidenceQuote:"",rationale:"Artifacts cannot establish completion"});writeFileSync(join(f.workspace,"grading-judgments",name),JSON.stringify(judgment));}
  assert.equal(importGrading(f.workspace).ready_to_resume,true);result=await fullEval({...opts,resume:true});
 }
 assert.equal(result.checkpoint?.kind,"human-review",JSON.stringify(result));assert.equal(result.status,"blocked");assert.equal(result.receipt.status,"complete");assert.equal(result.receipt.release_eligible,false);assert.ok(result.receipt.uncertainty.length>0);assert.equal(result.verification.gates.behavior.status,"blocked");assert.equal(buildReviewIR(f.workspace,"demo",JSON.parse(readFileSync(join(f.workspace,"benchmark.json"),"utf8"))).decision.verdict,"inconclusive");assert.equal(validateEvaluationReceipt(f.workspace).status,"complete");const beforeCalls=readFileSync(f.log,"utf8");const reviewed=await fullEval({...opts,resume:true,humanReview:"pass",testsStatus:"pass"});assert.equal(reviewed.status,"blocked");assert.equal(reviewed.verification.gates.behavior.status,"blocked");assert.equal(readFileSync(f.log,"utf8"),beforeCalls,"human decision cannot impute quality or invoke paid regeneration");
 });});
test("typed-only public plan retains checks, injects treatment with developer and never passes n=1 behavior",async()=>{const f=correctiveFixture({typed:true});await inCorrectiveHost(f,async()=>{assert.notEqual(designEvals(join(f.skill,"evals/evals.json"),f.skill).status,"fail");const r=await fullEval({skillPath:f.skill,workspace:f.workspace,execute:true,cacheDir:null,progress:"none"});assert.equal(r.checkpoint?.kind,"human-review",JSON.stringify(r));assert.equal(r.verification.gates.behavior.status,"blocked");const calls=readFileSync(f.log,"utf8").trim().split("\n").map(line=>JSON.parse(line));assert.equal(calls.find(c=>c.withSkill&&!c.grader).injected,true);assert.equal(calls.find(c=>!c.withSkill&&!c.grader).injected,false);const grading=JSON.parse(readFileSync(join(f.workspace,"eval-1/with_skill/run-1/grading.json"),"utf8"));assert.equal(grading.expectations[0].verdict,"pass");});});
test("capture rejection is distinct and retains final response and bounded execution evidence",async()=>{const f=correctiveFixture({typed:true,symlink:true});await inCorrectiveHost(f,async()=>{const r=await fullEval({skillPath:f.skill,workspace:f.workspace,execute:true,cacheDir:null,progress:"none"});assert.match(JSON.stringify(r),/evidence-capture-rejected/);const run=join(f.workspace,"eval-1/with_skill/run-1");assert.match(readFileSync(join(run,"outputs/result.txt"),"utf8"),/script exited with code 1/);assert.ok(JSON.parse(readFileSync(join(run,"outputs/capture-rejection.json"),"utf8")).rejected_entries.some(e=>e.path==="node_modules/.bin/x"));assert.ok(readFileSync(join(run,"transcript.json"),"utf8"));});});

for(const mode of ["subprocess","delegated"] as const)for(const uncertainRound of [1,2])test(mode+" adaptive honest uncertainty in admitted round "+uncertainRound+" is reviewable, immutable and call-free on resume",async()=>{
 const f=correctiveFixture();
 // One selected semantic assertion is honestly undecidable after a prefix of complete rounds.
 const stateFile=join(f.root,"grader-rounds");
 const host=readFileSync(f.host,"utf8").replace('if(grader){const b=', 'if(grader){const n=existsSync('+JSON.stringify(stateFile)+')?Number(readFileSync('+JSON.stringify(stateFile)+',"utf8")):0;writeFileSync('+JSON.stringify(stateFile)+',String(n+1));const b=').replace('verdict:"inconclusive"','verdict:n<'+((uncertainRound-1)*2)+'?"pass":"inconclusive"').replace('evidence_quote:""','evidence_quote:n<'+((uncertainRound-1)*2)+'?"done":""');
 writeFileSync(f.host,host);
 await inCorrectiveHost(f,async()=>{
  const policy=defaultAdaptivePolicy([{id:"1"}],3);policy.min_pairs=1;policy.futility.minimum_pairs=1;
  const plan=JSON.parse(readFileSync(join(f.skill,"evals/evals.json"),"utf8"));plan.aggregate_budget={max_runs:6,max_turns:18,timeout_seconds:120};writeFileSync(join(f.skill,"evals/evals.json"),JSON.stringify(plan));
  const opts={skillPath:f.skill,workspace:f.workspace,execute:true,gradingMode:mode,progress:"none" as const,cacheDir:null,graders:[{id:"g",model:"fake"}],decisionPolicy:"adaptive" as const,adaptivePolicy:policy};
  let result=await fullEval(opts);
  if(mode==="delegated")for(let round=1;round<=uncertainRound;round++){
   assert.equal(result.status,"awaiting-grading",JSON.stringify(result));prepareGrading(f.workspace);const manifest=loadGradingManifest(f.workspace);mkdirSync(join(f.workspace,"grading-judgments"),{recursive:true});
   for(const name of readdirSync(join(f.workspace,"grading-requests")).filter(n=>n.endsWith(".json")&&n!=="manifest.json")){
    const request=JSON.parse(readFileSync(join(f.workspace,"grading-requests",name),"utf8")),entry=manifest[request.invocation_id];
    if(!entry.run_directory.endsWith("run-"+round))continue;const judgment=buildGradingJudgment({invocationId:request.invocation_id,requestSha256:request.request_sha256,bindings:request.bindings,grader:{id:entry.grader_id,model:entry.grader_model,provider:entry.grader_provider},verdict:round===uncertainRound?"inconclusive":"pass",evidenceQuote:round===uncertainRound?"":"done",rationale:"Artifacts cannot establish completion"});writeFileSync(join(f.workspace,"grading-judgments",name),JSON.stringify(judgment));
   }
   const imported=importGrading(f.workspace);assert.equal(imported.ready_to_resume,true,JSON.stringify(imported));result=await fullEval({...opts,resume:true});
  }
  assert.equal(result.status,"blocked",JSON.stringify(result));assert.equal(result.checkpoint?.kind,"human-review",JSON.stringify(result));assert.equal(result.receipt.status,"complete");assert.equal(result.receipt.release_eligible,false);assert.ok(result.receipt.uncertainty.length>0);
  const statePath=join(f.workspace,".adaptive-scheduling.json"),before=readFileSync(statePath,"utf8"),state=readAdaptiveState(statePath,policy,f.workspace,expectedRunDirs(f.workspace,true)),artifact=readAndVerifyAnytimeQualityArtifact(join(f.workspace,"anytime-quality-decision.json")),benchmark=JSON.parse(readFileSync(join(f.workspace,"benchmark.json"),"utf8"));
  assert.equal(state.campaign_stop?.reason,"inconclusive-grading");assert.equal(state.campaign_stop?.round,uncertainRound);assert.equal(state.campaign_stop?.uncertain_runs.length,2);assert.equal(state.stop_reason,"inconclusive");assert.deepEqual(state.admitted_rounds,Array.from({length:uncertainRound},(_,i)=>i+1));assert.equal(state.counted_pairs.length,uncertainRound-1);assert.equal(state.observations.length,uncertainRound-1);assert.equal(state.looks.length,uncertainRound-1);assert.equal(state.superseded_unstarted_tasks.length,(3-uncertainRound)*2);
  assert.equal(artifact.result.decision,"inconclusive");assert.equal(artifact.result.terminal,true);assert.equal(artifact.result.complete_pairs,uncertainRound-1);assert.equal(artifact.result.pending_observations,0);assert.deepEqual(artifact.result.looks,state.looks);assert.deepEqual(artifact.campaign_stop,state.campaign_stop);assert.equal(benchmark.decision_evidence.decision,"inconclusive");assert.equal(benchmark.decision_evidence.sample_count,uncertainRound-1);assert.equal(benchmark.run_summary.delta.pass_rate,null);assert.equal(buildReviewIR(f.workspace,"demo",benchmark).decision.verdict,"inconclusive");assert.match(readFileSync(join(f.workspace,"review.html"),"utf8"),/inconclusive/);
  // Hashes alone cannot authorize an invented uncertainty stop: membership is independently derived.
  const tampered={...JSON.parse(before),campaign_stop:{...state.campaign_stop,round:uncertainRound+1}};delete tampered.state_hash;tampered.state_hash=createHash("sha256").update(canonicalJson(tampered)).digest("hex");writeFileSync(statePath,JSON.stringify(tampered));assert.equal(validateEvaluationReceipt(f.workspace).status,"blocked");writeFileSync(statePath,before);
  const calls=readFileSync(f.log,"utf8"),artifactBytes=readFileSync(join(f.workspace,"anytime-quality-decision.json"),"utf8");for(const retry of [false,true]){
   const resumed=await fullEval({...opts,resume:true,retry});assert.equal(resumed.checkpoint?.kind,"human-review",JSON.stringify(resumed));assert.equal(readFileSync(f.log,"utf8"),calls);assert.equal(readFileSync(statePath,"utf8"),before);assert.equal(readFileSync(join(f.workspace,"anytime-quality-decision.json"),"utf8"),artifactBytes);
  }
  const approved=await fullEval({...opts,resume:true,humanReview:"pass",testsStatus:"pass"});assert.equal(approved.verification.gates.behavior.status,"blocked");assert.equal(readFileSync(f.log,"utf8"),calls);assert.equal(validateEvaluationReceipt(f.workspace).status,"complete");
 });
});

for(const unavailableRound of [1,2])test("adaptive unavailable round "+unavailableRound+" retries graders only and retains counted prefix",async()=>{
 const f=correctiveFixture({verdict:"pass"}),counter=join(f.root,"grader-counter"),ready=join(f.root,"grading-ready");
 writeFileSync(f.host,readFileSync(f.host,"utf8").replace('if(grader){const b=', 'if(grader){const n=existsSync('+JSON.stringify(counter)+')?Number(readFileSync('+JSON.stringify(counter)+',"utf8")):0;writeFileSync('+JSON.stringify(counter)+',String(n+1));if(n>='+((unavailableRound-1)*2)+'&&!existsSync('+JSON.stringify(ready)+')){console.log(JSON.stringify({type:"complete",output:"unavailable invalid judgment"}));process.exit(0);}const b='));
 await inCorrectiveHost(f,async()=>{
  const policy=defaultAdaptivePolicy([{id:"1"}],3);policy.min_pairs=1;policy.futility.minimum_pairs=1;const plan=JSON.parse(readFileSync(join(f.skill,"evals/evals.json"),"utf8"));plan.aggregate_budget={max_runs:6,max_turns:18,timeout_seconds:120};writeFileSync(join(f.skill,"evals/evals.json"),JSON.stringify(plan));
  const opts={skillPath:f.skill,workspace:f.workspace,execute:true,progress:"none" as const,cacheDir:null,graders:[{id:"g",model:"fake"}],decisionPolicy:"adaptive" as const,adaptivePolicy:policy};
  const result=await fullEval(opts);assert.equal(result.status,"awaiting-grading",JSON.stringify(result));assert.equal(result.execution.failures[0].code,"grading-unavailable");
  const statePath=join(f.workspace,".adaptive-scheduling.json"),before=JSON.parse(readFileSync(statePath,"utf8"));assert.equal(before.looks.length,unavailableRound-1);assert.equal(before.campaign_stop,undefined);
  const calls=readFileSync(f.log,"utf8").trim().split("\n").map(line=>JSON.parse(line)),candidates=calls.filter(c=>!c.grader).length;assert.equal(candidates,unavailableRound*2);
  const frozen=Array.from({length:unavailableRound-1},(_,i)=>["with_skill","without_skill"].map(role=>{const run=join(f.workspace,"eval-1",role,"run-"+(i+1));return {run,evidence:readFileSync(join(run,"execution-evidence.json"),"utf8")}})).flat();
  writeFileSync(ready,"ready");const resumed=await fullEval({...opts,resume:true});assert.equal(resumed.checkpoint?.kind,"human-review",JSON.stringify(resumed));
  const after=JSON.parse(readFileSync(statePath,"utf8"));assert.equal(after.looks.length,3);assert.deepEqual(after.observations.slice(0,before.observations.length),before.observations);assert.deepEqual(after.looks.slice(0,before.looks.length),before.looks);
  const allCalls=readFileSync(f.log,"utf8").trim().split("\n").map(line=>JSON.parse(line));assert.equal(allCalls.filter(c=>!c.grader).length,6);assert.equal(allCalls.filter(c=>c.grader).length,8,"only two unavailable slots were retried");for(const item of frozen)assert.equal(readFileSync(join(item.run,"execution-evidence.json"),"utf8"),item.evidence);
 });
});

import { normalizeAssertion, deterministicCheck } from '../dist/scripts/evaluator_grading.js';
import { validateExecutionEvidence } from '../dist/scripts/evaluation_provenance.js';
import { gradingStatus } from '../dist/scripts/prepare_grading.js';
import { TASK_EVIDENCE_PROTOCOL, renderTaskEvidence } from '../dist/scripts/task_evidence.js';
for(const decisionPolicy of ['fixed','adaptive'] as const)for(const explicitGrader of [false,true])test('delegated deterministic-only '+decisionPolicy+' explicit grader '+explicitGrader+' completes with zero grading and idempotent resume',async()=>{
 const f=correctiveFixture({typed:true});await inCorrectiveHost(f,async()=>{
  const policy=defaultAdaptivePolicy([{id:'1'}],3);policy.min_pairs=1;policy.futility.minimum_pairs=1;
  const p=JSON.parse(readFileSync(join(f.skill,'evals/evals.json'),'utf8'));p.aggregate_budget={max_runs:6,max_turns:18,timeout_seconds:120};writeFileSync(join(f.skill,'evals/evals.json'),JSON.stringify(p));
  const opts={skillPath:f.skill,workspace:f.workspace,execute:true,cacheDir:null,progress:'none' as const,gradingMode:'delegated' as const,decisionPolicy,...(decisionPolicy==='adaptive'?{adaptivePolicy:policy}:{}),...(explicitGrader?{graders:[{id:'g',model:'fake'}]}:{})};
  const result=await fullEval(opts);assert.equal(result.checkpoint?.kind,'human-review',JSON.stringify(result));assert.equal(validateExecutionEvidence(f.workspace).status,'complete');
  const calls=readFileSync(f.log,'utf8');assert.ok(calls.trim().split(String.fromCharCode(10)).every(line=>!JSON.parse(line).grader));
  const before=expectedRunDirs(f.workspace).map(dir=>readFileSync(join(dir,'grading.json'),'utf8'));
  const prepared=prepareGrading(f.workspace);assert.equal(prepared.prepared,0);assert.equal(prepared.skipped_no_semantic_assertions,before.length);assert.equal(importGrading(f.workspace).ready_to_resume,true);assert.equal(gradingStatus(f.workspace).ready_to_resume,true);mkdirSync(join(f.workspace,'grading-judgments'),{recursive:true});assert.equal(importGrading(f.workspace).ready_to_resume,true);
  const resumed=await fullEval({...opts,resume:true});assert.equal(resumed.checkpoint?.kind,'human-review',JSON.stringify(resumed));assert.equal(readFileSync(f.log,'utf8'),calls);assert.deepEqual(expectedRunDirs(f.workspace).map(dir=>readFileSync(join(dir,'grading.json'),'utf8')),before);
 });
});
test('text operands reject coercion while JSON scalar equality and Unicode original spans remain valid',()=>{
 for(const expected of [null,false,0,{},[]])for(const kind of ['file','stdout'])for(const operator of ['equals','not-equals','contains','not-contains','regex'])assert.throws(()=>normalizeAssertion({criterion:'text',locator:{kind,path:'out/data'},operator,expected},0),/string operand/);
 for(const expected of [null,false,0,'']){const a=normalizeAssertion({criterion:'value',checker:{kind:'equals',pointer:'/value',expected}},0);assert.equal(deterministicCheck(a,JSON.stringify({value:expected})).verdict,'pass');}
 for(const input of ['contains: ok','not-contains: ok',{criterion:'text',locator:{kind:'stdout'},operator:'contains',expected:'ok'}]){const a=normalizeAssertion(input,0),text='İstanbul OK',context={protocol:TASK_EVIDENCE_PROTOCOL,stdout:text,files:{},before:{},exit_code:0},result=deterministicCheck(a,renderTaskEvidence(context),context);assert.deepEqual(result.evidence.span,{start:9,end:11,quote:'OK'});}
 for(const input of ['regex: (unclosed',{criterion:'regex',checker:{kind:'regex',value:'a',flags:'zz'}},{criterion:'regex',locator:{kind:'stdout'},operator:'regex',expected:'a',flags:'ii'}])assert.throws(()=>normalizeAssertion(input,0),/invalid regex/);
});
for(const mode of ['subprocess','delegated'] as const)test(mode+' invalid regex and nonstring text operands reject before task or grader spend',async()=>{
 const f=correctiveFixture();await inCorrectiveHost(f,async()=>{
  for(const assertion of ['regex: (unclosed',{criterion:'regex',checker:{kind:'regex',value:'a',flags:'zz'}},{criterion:'text',locator:{kind:'file',path:'out/report.txt'},operator:'not-equals',expected:{value:1}},{criterion:'text',locator:{kind:'stdout'},operator:'equals',expected:null}]){
   const p=JSON.parse(readFileSync(join(f.skill,'evals/evals.json'),'utf8'));p.evals[0].assertions=[assertion];writeFileSync(join(f.skill,'evals/evals.json'),JSON.stringify(p));
   const opts={skillPath:f.skill,workspace:f.workspace,execute:true,cacheDir:null,progress:'none' as const,gradingMode:mode,graders:[{id:'g',model:'fake'}]};
   const r=await fullEval(opts);assert.notEqual(r.status,'success');assert.equal(existsSync(f.log),false,JSON.stringify(r));assert.match(JSON.stringify(r),/invalid regex|string operand/);
   const resumed=await fullEval({...opts,resume:true});assert.notEqual(resumed.status,'success');assert.equal(existsSync(f.log),false);rmSync(f.workspace,{recursive:true,force:true});
  }
 });
});

for(const decisionPolicy of ['fixed','adaptive'] as const)for(const mode of ['subprocess','delegated'] as const)test(mode+' '+decisionPolicy+' mixed scenarios grade only semantic runs and resume without calls',async()=>{
 const f=correctiveFixture({typed:true,verdict:'pass'});await inCorrectiveHost(f,async()=>{
  const p=JSON.parse(readFileSync(join(f.skill,'evals/evals.json'),'utf8'));p.evals.push({...p.evals[0],id:2,assertions:['The final response reports completion']});p.aggregate_budget={max_runs:12,max_turns:36,timeout_seconds:240};writeFileSync(join(f.skill,'evals/evals.json'),JSON.stringify(p));
  const policy=defaultAdaptivePolicy([{id:'1'},{id:'2'}],3);policy.min_pairs=1;policy.futility.minimum_pairs=1;
  const opts={skillPath:f.skill,workspace:f.workspace,execute:true,cacheDir:null,progress:'none' as const,gradingMode:mode,graders:[{id:'g',model:'fake'}],decisionPolicy,...(decisionPolicy==='adaptive'?{adaptivePolicy:policy}:{})};
  let result=await fullEval(opts);
  if(mode==='delegated')for(let round=0;round<3&&result.status==='awaiting-grading';round++){
   prepareGrading(f.workspace);const manifest=loadGradingManifest(f.workspace);mkdirSync(join(f.workspace,'grading-judgments'),{recursive:true});
   for(const [id,entry] of Object.entries(manifest)){
    assert.match(entry.run_directory,/eval-2/,'deterministic-only scenario must not request a grader');const name=id+'.json';if(existsSync(join(f.workspace,'grading-judgments',name)))continue;
    const q=JSON.parse(readFileSync(join(f.workspace,'grading-requests',name),'utf8'));writeFileSync(join(f.workspace,'grading-judgments',name),JSON.stringify(buildGradingJudgment({invocationId:id,requestSha256:q.request_sha256,bindings:q.bindings,grader:{id:entry.grader_id,model:entry.grader_model,provider:entry.grader_provider},verdict:'pass',evidenceQuote:'done',rationale:'The response states completion'})));
   }
   assert.equal(importGrading(f.workspace).ready_to_resume,true);result=await fullEval({...opts,resume:true});
  }
  assert.equal(result.checkpoint?.kind,'human-review',JSON.stringify(result));assert.equal(validateExecutionEvidence(f.workspace).status,'complete');
  const runs=expectedRunDirs(f.workspace),semanticRuns=runs.filter(dir=>dir.includes('eval-2')),calls=readFileSync(f.log,'utf8'),graders=calls.trim().split(String.fromCharCode(10)).map(line=>JSON.parse(line)).filter(c=>c.grader);assert.equal(graders.length,mode==='delegated'?0:semanticRuns.length);
  for(const run of runs.filter(dir=>dir.includes('eval-1'))){assert.equal(JSON.parse(readFileSync(join(run,'grading.json'),'utf8')).authority,'evaluator');assert.equal(readdirSync(join(run,'grader-evidence')).length,0);}
  const resumed=await fullEval({...opts,resume:true});assert.equal(resumed.checkpoint?.kind,'human-review');assert.equal(readFileSync(f.log,'utf8'),calls);
 });
});
for(const mode of ['subprocess','delegated'] as const)for(const transport of ['message','terminal'])test(mode+' '+transport+' split UTF-8 never manufactures a fixed-release winner',async()=>{
 const f=correctiveFixture({typed:true});await inCorrectiveHost(f,async()=>{
  const p=JSON.parse(readFileSync(join(f.skill,'evals/evals.json'),'utf8'));p.evals[0].assertions=['not-contains: café'];p.aggregate_budget={max_runs:20,max_turns:60,timeout_seconds:240};writeFileSync(join(f.skill,'evals/evals.json'),JSON.stringify(p));
  const code=["import {readFileSync,appendFileSync,existsSync} from 'node:fs';if(process.argv.includes('--version')){console.log('fake');process.exit(0);}readFileSync(0,'utf8');",'const log='+JSON.stringify(f.log)+';const n=existsSync(log)?readFileSync(log,"utf8").length:0;appendFileSync(log,"x");', 'const stream='+JSON.stringify(transport==='terminal'?JSON.stringify({type:'complete',output:'café'})+String.fromCharCode(10):JSON.stringify({type:'message',message:{role:'assistant',content:[{type:'text',text:'café'}]}})+String.fromCharCode(10)+JSON.stringify({type:'complete'})+String.fromCharCode(10))+';',"const bytes=Buffer.from(stream),cut=bytes.indexOf(Buffer.from('é'))+1;if(existsSync('.agents/skills')&&n<8){process.stdout.write(bytes.subarray(0,cut));setTimeout(()=>process.stdout.write(bytes.subarray(cut)),50);}else process.stdout.write(bytes);"];
  writeFileSync(f.host,code.join(''));
  const r=await fullEval({skillPath:f.skill,workspace:f.workspace,execute:true,gradingMode:mode,runProfile:'release',cacheDir:null,progress:'none',humanReview:'pass',testsStatus:'pass',triggeringStatus:'pass'});assert.equal(r.status,'blocked',JSON.stringify(r));assert.equal(validateExecutionEvidence(f.workspace).status,'complete');
  const b=JSON.parse(readFileSync(join(f.workspace,'benchmark.json'),'utf8'));assert.equal(Number(b.run_summary.delta.pass_rate),0);assert.equal(b.run_summary.delta.stable_improvement,false);assert.equal(validateEvaluationReceipt(f.workspace).release_eligible,false);
  for(const run of expectedRunDirs(f.workspace)){assert.equal(JSON.parse(readFileSync(join(run,'outputs/task-evidence.json'),'utf8')).stdout,'café');assert.equal(JSON.parse(readFileSync(join(run,'grading.json'),'utf8')).expectations[0].verdict,'fail');}
 });
});

import { executePairedRuns } from '../dist/scripts/paired_execution.js';
import { artifactHash } from '../dist/scripts/evaluation_provenance.js';
for(const mode of ['subprocess','delegated'] as const)test(mode+' direct paired executor preflights all scenarios before launching any task',async()=>{
 const f=correctiveFixture({typed:true});await inCorrectiveHost(f,async()=>{
  const plan=JSON.parse(readFileSync(join(f.skill,'evals/evals.json'),'utf8'));plan.evals.push({...plan.evals[0],id:2});writeFileSync(join(f.skill,'evals/evals.json'),JSON.stringify(plan));
  await fullEval({skillPath:f.skill,workspace:f.workspace,execute:false,cacheDir:null,progress:'none'});
  const file=join(f.workspace,'eval-2/eval_metadata.json'),metadata=JSON.parse(readFileSync(file,'utf8'));metadata.assertions=['regex: (unclosed'];writeFileSync(file,JSON.stringify(metadata));
  const result=await executePairedRuns({skillPath:f.skill,workspace:f.workspace,baseline:'without_skill',cacheDir:null,...(mode==='delegated'?{graderAdapter:null}:{})});assert.equal(result.status,'failed');assert.equal(result.failures[0].code,'invalid-plan');assert.match(result.failures[0].message,/invalid regex/);assert.equal(existsSync(f.log),false);
 });
});
test('delegated deterministic authority and quotes cannot be forged by refreshing content hashes',async()=>{
 const f=correctiveFixture({typed:true});await inCorrectiveHost(f,async()=>{
  await fullEval({skillPath:f.skill,workspace:f.workspace,execute:true,gradingMode:'delegated',cacheDir:null,progress:'none'});
  const run=expectedRunDirs(f.workspace)[0],gradePath=join(run,'grading.json'),manifestPath=join(run,'execution-evidence.json'),original=readFileSync(gradePath,'utf8'),manifestOriginal=readFileSync(manifestPath,'utf8');
  for(const mutate of [(g:any,m:any)=>{g.authority='delegated-evaluator';m.grading_binding.authority='delegated-evaluator';},(g:any)=>{g.expectations[0].evidence.span={start:0,end:4,quote:'FAKE'};}]){
   const g=JSON.parse(original),m=JSON.parse(manifestOriginal);mutate(g,m);writeFileSync(gradePath,JSON.stringify(g));m.artifact_sha256['grading.json']=artifactHash(gradePath);writeFileSync(manifestPath,JSON.stringify(m));assert.equal(validateExecutionEvidence(f.workspace).status,'blocked');assert.equal(importGrading(f.workspace).ready_to_resume,false);
   writeFileSync(gradePath,original);writeFileSync(manifestPath,manifestOriginal);
  }
  assert.equal(validateExecutionEvidence(f.workspace).status,'complete');
 });
});

for(const mode of ['subprocess','delegated'] as const)test(mode+' final-response commentary cannot manufacture a fixed-release winner',async()=>{
 const f=correctiveFixture({typed:true});await inCorrectiveHost(f,async()=>{
  const p=JSON.parse(readFileSync(join(f.skill,'evals/evals.json'),'utf8'));p.evals[0].assertions=[{id:'final-alpha',criterion:'The final report includes alpha',locator:{kind:'stdout'},operator:'contains',expected:'alpha'}];p.aggregate_budget={max_runs:20,max_turns:60,timeout_seconds:240};writeFileSync(join(f.skill,'evals/evals.json'),JSON.stringify(p));
  const final=' \n{"output":"done café 😀","status":"REJECTED"}\n ';
  const code=["import {readFileSync,appendFileSync,existsSync} from 'node:fs';if(process.argv.includes('--version')){console.log('fake');process.exit(0);}readFileSync(0,'utf8');",'const log='+JSON.stringify(f.log)+';const skill=existsSync(".agents/skills"),calls=existsSync(log)?readFileSync(log,"utf8"):"",n=calls.split("\\n").filter(x=>x===String(skill)).length;appendFileSync(log,String(skill)+"\\n");', 'const final='+JSON.stringify(final)+';const msg=(id,text,content)=>({type:"message",message:{id,role:"assistant",created:1,metadata:{userVisible:true,agentVisible:true},content:content??[{type:"text",text}]}});const events=[msg("commentary",skill&&n<4?"alpha":"Working on the task."),msg("tool","",[{type:"toolRequest",id:"call",toolCall:{status:"success",value:{name:"developer__shell",arguments:{command:"printf done"}}}}]),{type:"message",message:{id:"tool-result",role:"user",content:[{type:"toolResponse",id:"call",toolResult:{status:"success",value:{content:[{type:"text",text:"alpha"}]}}}]}},msg("final",final.slice(0,15)),msg("final",final.slice(15)),{type:"complete",total_tokens:5}];for(const event of events)console.log(JSON.stringify(event));'];
  writeFileSync(f.host,code.join(''));
  const r=await fullEval({skillPath:f.skill,workspace:f.workspace,execute:true,gradingMode:mode,runProfile:'release',cacheDir:null,progress:'none',humanReview:'pass',testsStatus:'pass',triggeringStatus:'pass'});assert.equal(r.status,'blocked',JSON.stringify(r));assert.equal(validateExecutionEvidence(f.workspace).status,'complete');
  const b=JSON.parse(readFileSync(join(f.workspace,'benchmark.json'),'utf8'));assert.equal(Number(b.run_summary.delta.pass_rate),0);assert.equal(b.run_summary.delta.stable_improvement,false);assert.notEqual(b.decision_evidence.decision,'winner');assert.equal(validateEvaluationReceipt(f.workspace).release_eligible,false);
  for(const run of expectedRunDirs(f.workspace)){assert.equal(JSON.parse(readFileSync(join(run,'outputs/task-evidence.json'),'utf8')).stdout,final);assert.equal(JSON.parse(readFileSync(join(run,'grading.json'),'utf8')).expectations[0].verdict,'fail');}
 });
});
