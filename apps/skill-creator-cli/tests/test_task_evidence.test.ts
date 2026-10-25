import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotTaskFiles,preserveTaskEvidence,renderTaskEvidence } from "../dist/scripts/task_evidence.js";
import { normalizeAssertion,deterministicCheck } from "../dist/scripts/evaluator_grading.js";
test("actual artifacts remain bound after workspace deletion, and missing file cannot pass against JSON root",()=>{
 const root=mkdtempSync(join(tmpdir(),"task-files-")),run=mkdtempSync(join(tmpdir(),"task-run-"));
 try {mkdirSync(join(run,"outputs"));writeFileSync(join(root,"input.txt"),"original");const before=snapshotTaskFiles(root);mkdirSync(join(root,"outputs"));writeFileSync(join(root,"outputs","data.csv"),"name,total\nAlice,42\n");writeFileSync(join(root,"outputs","binary.bin"),Buffer.from([0,255,1]));
 const context=preserveTaskEvidence(root,run,before,"Created outputs/data.csv",0);const output=renderTaskEvidence(context);rmSync(root,{recursive:true,force:true});assert.deepEqual(readFileSync(join(run,"outputs","artifacts","outputs","binary.bin")),Buffer.from([0,255,1]));assert.match(output,/Alice/);
 const check=(operator:string,locator:any,expected:any)=>deterministicCheck(normalizeAssertion({id:"a",subject:"property",operator,locator,expected},0),"{}",context).verdict;
 assert.equal(check("exists",{kind:"file",path:"missing.csv"},true),"fail");assert.equal(check("exists",{kind:"file",path:"outputs/data.csv"},true),"pass");assert.equal(check("contains",{kind:"file",path:"outputs/data.csv"},"Alice,42"),"pass");assert.equal(check("preserves",{kind:"file",path:"input.txt"},true),"pass");assert.equal(check("equals",{kind:"exit-code"},0),"pass");assert.equal(check("contains",{kind:"stdout"},"Created"),"pass");
 assert.throws(()=>normalizeAssertion({subject:"stderr",operator:"contains",locator:{kind:"stderr"},expected:"bad"},0),/Unsupported/);
 }finally{rmSync(root,{recursive:true,force:true});rmSync(run,{recursive:true,force:true});}
});
test("unsafe task artifact symlinks are rejected",()=>{const root=mkdtempSync(join(tmpdir(),"task-escape-"));try{symlinkSync("/etc/passwd",join(root,"escape"));assert.throws(()=>snapshotTaskFiles(root),/symlink/);}finally{rmSync(root,{recursive:true,force:true});}});

test("oversized final response is capture rejection with retained bounded result and file manifest",()=>{
 const root=mkdtempSync(join(tmpdir(),"task-response-")),run=mkdtempSync(join(tmpdir(),"task-rejected-"));try{
  writeFileSync(join(root,"report.txt"),"report");assert.throws(()=>preserveTaskEvidence(root,run,{},"x".repeat(300*1024),0),(error:any)=>error.code==="evidence-capture-rejected");
  const rejected=JSON.parse(readFileSync(join(run,"outputs","capture-rejection.json"),"utf8"));assert.equal(rejected.response_truncated,true);assert.equal(rejected.semantic_evidence_complete,false);assert.ok(readFileSync(join(run,"outputs","result.txt")).length<=256*1024);assert.deepEqual(rejected.captured_before_rejection.map(x=>x.path),["report.txt"]);assert.equal(readFileSync(join(run,"outputs/artifacts/report.txt"),"utf8"),"report");
 }finally{rmSync(root,{recursive:true,force:true});rmSync(run,{recursive:true,force:true});}
});

import { fullEval } from "../dist/scripts/full_eval.js";
import { gradeOutput,sha256,reusableJudgment } from "../dist/scripts/evaluator_grading.js";
import { TASK_EVIDENCE_PROTOCOL,matchTaskQuote,taskContextFromOutputs } from "../dist/scripts/task_evidence.js";
import { prepareGrading,loadGradingManifest } from "../dist/scripts/prepare_grading.js";
import { importGrading } from "../dist/scripts/import_grading.js";
import { buildGradingJudgment } from "../dist/scripts/delegated_grading_contracts.js";
import { validateExecutionEvidence,artifactHash } from "../dist/scripts/evaluation_provenance.js";
import { readdirSync } from "node:fs";
import { isolateMockTransport } from "./fixtures/mock-host.ts";
isolateMockTransport();
const authentic='# Report\nStatus: "approved"';
function textContext(bytes:Buffer){return {protocol:TASK_EVIDENCE_PROTOCOL,stdout:"done",exit_code:0,before:{},files:{"outputs/report.md":{sha256:sha256(bytes),bytes_base64:bytes.toString("base64")}}};}
test("file equality preserves bytes and all text interpreters reject lossy UTF-8",()=>{
 for(const bytes of [Buffer.from([255]),Buffer.from("�")]){
  const context=textContext(bytes),output=renderTaskEvidence(context);
  const check=(kind:string,locatorKind="file")=>deterministicCheck(normalizeAssertion({criterion:"Exact report",locator:{kind:locatorKind,path:"outputs/report.md",pointer:""},operator:kind,expected:"�"},0),output,context);
  assert.equal(check("equals").verdict,bytes.length===1?"fail":"pass");assert.equal(check("not-equals").verdict,bytes.length===1?"pass":"fail");
  for(const kind of ["contains","not-contains","regex"])assert.equal(check(kind).verdict,bytes.length===1?"inconclusive":kind==="not-contains"?"fail":"pass");
  if(bytes.length===1)assert.equal(check("equals","json-pointer").verdict,"inconclusive");
 }
 const context=textContext(Buffer.from('{"answer":"approved"}'));assert.equal(deterministicCheck(normalizeAssertion({criterion:"JSON answer",locator:{kind:"json-pointer",path:"outputs/report.md",pointer:"/answer"},operator:"equals",expected:"approved"},0),renderTaskEvidence(context),context).verdict,"pass");
});
test("decoded quote retains source on grade-only reuse; tampered source and context rejected",async()=>{
 const context=textContext(Buffer.from(authentic)),output=renderTaskEvidence(context),grader={id:"g",model:"mock"},assertion={id:"a",criterion:"Report status is approved"};
 const input={prompt:"Write report",output,assertions:[assertion],variantSha256:"a".repeat(64),graders:[grader],evidenceContext:context};
 const graded=await gradeOutput({...input,adapter:{async grade(){return {raw:JSON.stringify({verdict:"pass",evidence_quote:authentic,rationale:"The report states approval"}),usage:null};}},budget:{used:0,limit:1}});
 const j=graded.graderEvidence[0];assert.equal(j.verdict,"pass");assert.deepEqual(j.evidence_source,{path:"outputs/artifacts/outputs/report.md",sha256:sha256(Buffer.from(authentic))});
 const reused=await gradeOutput({...input,priorJudgments:[j],adapter:{async grade(){throw new Error("must reuse");}},budget:{used:0,limit:0}});assert.equal(reused.grading.expectations[0].verdict,"pass");assert.deepEqual(reused.graderEvidence[0].evidence_source,j.evidence_source);
 assert.equal(reusableJudgment({...j,evidence_source:{path:j.evidence_source!.path,sha256:"f".repeat(64)}},normalizeAssertion(assertion,0),output,input.variantSha256,grader,context),false);
 assert.throws(()=>matchTaskQuote(output,authentic,{...context,stdout:"forged"}),/projection/);
 const raw=new Map([["task-evidence.json",{bytes:Buffer.from(JSON.stringify(context))}],["artifacts/outputs/report.md",{bytes:Buffer.from("forged")}]]);assert.throws(()=>taskContextFromOutputs(raw,output),/raw artifact/);
 assert.equal(matchTaskQuote(renderTaskEvidence(textContext(Buffer.from([255]))),"�",textContext(Buffer.from([255]))),undefined);
 assert.equal(matchTaskQuote(output,JSON.stringify(authentic).slice(1,-1),context),undefined);
});
function sourceFixture(quote=authentic){
 const root=mkdtempSync(join(tmpdir(),"source-fidelity-")),skill=join(root,"demo"),workspace=join(root,"workspace"),host=join(root,"host.mjs"),calls=join(root,"calls");
 mkdirSync(join(skill,"evals"),{recursive:true});writeFileSync(join(skill,"SKILL.md"),'---\nname: demo\ndescription: Writes reports. Use for report requests.\n---\n# Demo\nWrite outputs/report.md.'.replaceAll("\\n","\n"));
 const assertions:any[]=[];
 for(const critical of [true,false,undefined])for(const classification of ["deterministic","semantic"]){const id=classification+String(critical);assertions.push({id,criterion:"The report states approved",...(critical===undefined?{}:{critical}),...(classification==="deterministic"?{locator:{kind:"file",path:"outputs/report.md"},operator:"equals",expected:authentic}:{})});}
 assertions.push({id:"invalid-equals",criterion:"Binary is replacement",locator:{kind:"file",path:"outputs/binary.bin"},operator:"equals",expected:"�"},{id:"invalid-contains",criterion:"Binary contains replacement",locator:{kind:"file",path:"outputs/binary.bin"},operator:"contains",expected:"�"});
 assertions.push({id:"invalid-regex",criterion:"Binary matches replacement",locator:{kind:"file",path:"outputs/binary.bin"},operator:"regex",expected:"�"},{id:"invalid-json",criterion:"Binary JSON root matches",locator:{kind:"json-pointer",path:"outputs/binary.bin",pointer:""},operator:"equals",expected:"�"});

 writeFileSync(join(skill,"evals/evals.json"),JSON.stringify({skill_name:"demo",evals:[{id:1,target:{kind:"existing-skill",execution:"execute",path:"."},prompt:"Produce the approved report",assertions,capabilities:{filesystem:true,agent_runner:true,browser:false,network:false,tools:["developer"]},budget:{max_turns:3,timeout_seconds:20}}]}));
 const script='import {readFileSync,appendFileSync,mkdirSync,writeFileSync} from "node:fs";if(process.argv.includes("--version")){console.log("mock");process.exit(0);}const input=readFileSync(0,"utf8"),grader=input.includes("Published criteria");appendFileSync('+JSON.stringify(calls)+',JSON.stringify({grader})+"\\n");let output="done";if(grader){const criteria=JSON.parse(/Published criteria:\\n([^\\n]+)/.exec(input)[1]);output=JSON.stringify({judgments:criteria.map(a=>({id:a.id,version:a.version,verdict:"pass",evidence_quote:'+JSON.stringify(quote)+',rationale:"Report states approved status"}))});}else{mkdirSync("outputs",{recursive:true});writeFileSync("outputs/report.md",'+JSON.stringify(authentic)+');writeFileSync("outputs/binary.bin",Buffer.from([255]));}console.log(JSON.stringify({type:"complete",output,usage:{total_tokens:5}}));';
 writeFileSync(host,script);return {root,skill,workspace,host,calls};
}
function submitSourceQuotes(workspace:string,quote=authentic){prepareGrading(workspace);const manifest=loadGradingManifest(workspace);mkdirSync(join(workspace,"grading-judgments"),{recursive:true});for(const name of readdirSync(join(workspace,"grading-requests")).filter(n=>n.endsWith(".json")&&n!=="manifest.json")){const request=JSON.parse(readFileSync(join(workspace,"grading-requests",name),"utf8")),entry=manifest[request.invocation_id];writeFileSync(join(workspace,"grading-judgments",name),JSON.stringify(buildGradingJudgment({invocationId:request.invocation_id,requestSha256:request.request_sha256,bindings:request.bindings,grader:{id:entry.grader_id,model:entry.grader_model,provider:entry.grader_provider},verdict:"pass",evidenceQuote:quote,rationale:"Report states approved status"})));}return importGrading(workspace);}
for(const mode of ["subprocess","delegated"] as const)test(mode+" public critical/bytes/decoded-source workflow",async()=>{
 const f=sourceFixture(),old=process.env.SKILL_CREATOR_GOOSE_COMMAND;process.env.SKILL_CREATOR_GOOSE_COMMAND=process.execPath+" "+f.host;
 try{const opts={skillPath:f.skill,workspace:f.workspace,execute:true,cacheDir:null,progress:"none" as const,gradingMode:mode,graders:[{id:"g",model:"mock"}]};let result=await fullEval(opts);
  if(mode==="delegated"){assert.equal(result.status,"awaiting-grading");const invalid=submitSourceQuotes(f.workspace,"forged raw artifact quote");assert.equal(invalid.ready_to_resume,false);assert.ok(invalid.imported.every(e=>!e.valid_evidence));assert.equal(submitSourceQuotes(f.workspace).ready_to_resume,true);result=await fullEval({...opts,resume:true});}
  assert.equal(result.checkpoint?.kind,"human-review",JSON.stringify(result));assert.equal(validateExecutionEvidence(f.workspace).status,"complete");
  for(const variant of ["with_skill","without_skill"]){const run=join(f.workspace,"eval-1",variant,"run-1"),grading=JSON.parse(readFileSync(join(run,"grading.json"),"utf8"));for(const critical of [true,false,undefined])for(const classification of ["deterministic","semantic"]){const e=grading.expectations.find(e=>e.id===classification+String(critical));assert.equal(e.verdict,"pass");assert.equal(e.critical,critical);assert.equal(Object.hasOwn(e,"critical"),critical!==undefined);}
   assert.equal(grading.expectations.find(e=>e.id==="invalid-equals").verdict,"fail");for(const id of ["invalid-contains","invalid-regex","invalid-json"])assert.equal(grading.expectations.find(e=>e.id===id).verdict,"inconclusive");
   const evidence=JSON.parse(readFileSync(join(run,"grader-evidence",readdirSync(join(run,"grader-evidence"))[0]),"utf8"));assert.deepEqual(evidence.evidence_source,{path:"outputs/artifacts/outputs/report.md",sha256:sha256(Buffer.from(authentic))});
  }
  const before=readFileSync(f.calls,"utf8");await fullEval({...opts,resume:true});assert.equal(readFileSync(f.calls,"utf8"),before);
  {
   const run=join(f.workspace,"eval-1/with_skill/run-1"),gradingPath=join(run,"grading.json"),original=readFileSync(gradingPath),grading=JSON.parse(original.toString()),executionPath=join(run,"execution-evidence.json"),executionOriginal=readFileSync(executionPath),execution=JSON.parse(executionOriginal.toString());
   for(const classification of ["deterministic","semantic"]){grading.expectations.find(e=>e.id===classification+"false").critical=true;writeFileSync(gradingPath,JSON.stringify(grading));execution.artifact_sha256["grading.json"]=artifactHash(gradingPath);writeFileSync(executionPath,JSON.stringify(execution));assert.equal(validateExecutionEvidence(f.workspace).status,"blocked");grading.expectations.find(e=>e.id===classification+"false").critical=false;}
   writeFileSync(gradingPath,original);writeFileSync(executionPath,executionOriginal);
  }
  const run=join(f.workspace,"eval-1/with_skill/run-1"),rawPath=join(run,"outputs/artifacts/outputs/report.md"),original=readFileSync(rawPath);writeFileSync(rawPath,"tampered");assert.equal(validateExecutionEvidence(f.workspace).status,"blocked");writeFileSync(rawPath,original);
  const contextPath=join(run,"outputs/task-evidence.json"),contextBytes=readFileSync(contextPath),context=JSON.parse(contextBytes.toString());context.files["outputs/report.md"].bytes_base64=Buffer.from("tampered").toString("base64");writeFileSync(contextPath,JSON.stringify(context));assert.equal(validateExecutionEvidence(f.workspace).status,"blocked");writeFileSync(contextPath,contextBytes);
  const evidencePath=join(run,"grader-evidence",readdirSync(join(run,"grader-evidence"))[0]),evidenceBytes=readFileSync(evidencePath),evidence=JSON.parse(evidenceBytes.toString());evidence.evidence_source.sha256="f".repeat(64);writeFileSync(evidencePath,JSON.stringify(evidence));const executionPath=join(run,"execution-evidence.json"),executionBytes=readFileSync(executionPath),execution=JSON.parse(executionBytes.toString());execution.artifact_sha256["grader-evidence"]=artifactHash(join(run,"grader-evidence"));writeFileSync(executionPath,JSON.stringify(execution));assert.equal(validateExecutionEvidence(f.workspace).status,"blocked");writeFileSync(evidencePath,evidenceBytes);writeFileSync(executionPath,executionBytes);assert.equal(validateExecutionEvidence(f.workspace).status,"complete");
 }finally{old===undefined?delete process.env.SKILL_CREATOR_GOOSE_COMMAND:process.env.SKILL_CREATOR_GOOSE_COMMAND=old;rmSync(f.root,{recursive:true,force:true});}
});

test("subprocess unavailable quote recovery reruns only graders with unchanged task source",async()=>{
 const bad="forged raw artifact quote",f=sourceFixture(bad),old=process.env.SKILL_CREATOR_GOOSE_COMMAND;process.env.SKILL_CREATOR_GOOSE_COMMAND=process.execPath+" "+f.host;
 try{const opts={skillPath:f.skill,workspace:f.workspace,execute:true,cacheDir:null,progress:"none" as const,graders:[{id:"g",model:"mock"}]},initial=await fullEval(opts);assert.equal(initial.status,"awaiting-grading",JSON.stringify(initial));
  const contexts=["with_skill","without_skill"].map(v=>readFileSync(join(f.workspace,"eval-1",v,"run-1/outputs/task-evidence.json"))),before=readFileSync(f.calls,"utf8").trim().split("\n").map(line=>JSON.parse(line));
  writeFileSync(f.host,readFileSync(f.host,"utf8").replace(JSON.stringify(bad),JSON.stringify(authentic)));const resumed=await fullEval({...opts,resume:true});assert.equal(resumed.checkpoint?.kind,"human-review",JSON.stringify(resumed));const after=readFileSync(f.calls,"utf8").trim().split("\n").map(line=>JSON.parse(line));assert.equal(after.filter(c=>!c.grader).length,before.filter(c=>!c.grader).length);assert.equal(after.filter(c=>c.grader).length,before.filter(c=>c.grader).length+2);
  for(const [i,v] of ["with_skill","without_skill"].entries()){const run=join(f.workspace,"eval-1",v,"run-1"),dir=join(run,"grader-evidence");assert.deepEqual(readFileSync(join(run,"outputs/task-evidence.json")),contexts[i]);for(const name of readdirSync(dir)){const j=JSON.parse(readFileSync(join(dir,name),"utf8"));assert.equal(j.verdict,"pass");assert.deepEqual(j.evidence_source,{path:"outputs/artifacts/outputs/report.md",sha256:sha256(Buffer.from(authentic))});}}
  assert.equal(validateExecutionEvidence(f.workspace).status,"complete");
 }finally{old===undefined?delete process.env.SKILL_CREATOR_GOOSE_COMMAND:process.env.SKILL_CREATOR_GOOSE_COMMAND=old;rmSync(f.root,{recursive:true,force:true});}
});

test("visible source boundary excludes unchanged, omitted, binary and transport-only quote text",async()=>{
 for(const [path,bytes,unchanged] of [["input.txt",Buffer.from("SECRET-PASS-TOKEN"),true],["outputs/big.txt",Buffer.from("x".repeat(300000)+"SECRET-PASS-TOKEN"),false],["outputs/nul.txt",Buffer.from("SECRET-PASS-TOKEN\0"),false]] as const){
  const file={sha256:sha256(bytes),bytes_base64:bytes.toString("base64")},context={protocol:TASK_EVIDENCE_PROTOCOL,stdout:"done",exit_code:0,files:{[path]:file},before:unchanged?{[path]:file.sha256}:{}};
  const output=renderTaskEvidence(context);assert.equal(matchTaskQuote(output,"SECRET-PASS-TOKEN",context),undefined);
  const assertion={id:"a",criterion:"The report is complete"},grader={id:"g",model:"mock"},input={prompt:"Write report",assertions:[assertion],variantSha256:"a".repeat(64),graders:[grader]};
  const prior=await gradeOutput({...input,output:"SECRET-PASS-TOKEN",adapter:{async grade(){return {raw:JSON.stringify({verdict:"pass",evidence_quote:"SECRET-PASS-TOKEN",rationale:"Token shown"}),usage:null};}},budget:{used:0,limit:1}});
  const slot={...prior.graderEvidence[0],output_sha256:sha256(output)};
  assert.equal(reusableJudgment(slot,normalizeAssertion(assertion,0),output,input.variantSha256,grader,context),false);
  if(!unchanged)for(const kind of ["contains","not-contains","regex"])assert.equal(deterministicCheck(normalizeAssertion({criterion:"Token present",checker:{kind,value:"SECRET-PASS-TOKEN"}},0),output,context).verdict,"inconclusive");
 }
 const context=textContext(Buffer.from("tail"));context.stdout="x".repeat(256*1024-10)+"HIDDEN";const output=renderTaskEvidence(context);assert.equal(output.includes("HIDDEN"),false);assert.equal(matchTaskQuote(output,"HIDDEN",context),undefined);
 const invalidStdout={...textContext(Buffer.from("tail")),stdout:"\ud800"};assert.equal(matchTaskQuote(renderTaskEvidence(invalidStdout),invalidStdout.stdout,invalidStdout),undefined);
 const separate=textContext(Buffer.from("tail"));separate.stdout="head";assert.equal(deterministicCheck(normalizeAssertion("regex: head[\\s\\S]*tail",0),renderTaskEvidence(separate),separate).verdict,"fail");
});

function fidelityFixture(assertions:any[],candidateCode:string,quote="done",transport="complete"){
 const f=sourceFixture(quote),evalPath=join(f.skill,"evals/evals.json"),suite=JSON.parse(readFileSync(evalPath,"utf8"));suite.evals[0].assertions=assertions;writeFileSync(evalPath,JSON.stringify(suite));
 const script=readFileSync(f.host,"utf8"),start=script.indexOf('}else{mkdirSync("outputs"'),end=script.indexOf('console.log(JSON.stringify({type:"complete",output',start);
 writeFileSync(f.host,script.slice(0,start)+'}else{mkdirSync("outputs",{recursive:true});'+candidateCode+'}'+(transport==="message"?'console.log(JSON.stringify({type:"message",message:{role:"assistant",content:[{type:"text",text:output}]}}));console.log(JSON.stringify({type:"complete"}));':script.slice(end)));
 return f;
}
for(const mode of ["subprocess","delegated"] as const)for(const transport of ["complete","message"])test(mode+" "+transport+" public exact JSON response, scalar operands, decoded source parity and provenance",async()=>{
 const payload=' {"output":"task done","status":"REJECTED","nested":{"output":"inner"}}\n',assertions:any[]=[
  {id:"exact",criterion:"Exact response",locator:{kind:"stdout"},operator:"equals",expected:payload},
  {id:"no-rejection",criterion:"No rejection",locator:{kind:"stdout"},operator:"not-contains",expected:"REJECTED"},
  {id:"different",criterion:"Different response",locator:{kind:"stdout"},operator:"not-equals",expected:"task done"},
  ...[null,false,0,""].flatMap((expected,i)=>["equals","not-equals"].map(operator=>({id:operator+i,criterion:"Scalar comparison",locator:{kind:"json-pointer",path:"outputs/data.json",pointer:"/v"+i},operator,expected}))),
  {id:"missing",criterion:"Missing is not null",locator:{kind:"json-pointer",path:"outputs/data.json",pointer:"/missing"},operator:"not-equals",expected:null},
  'contains: import "fmt"','regex: ^import','not-contains: \\n','regex: [0-9a-f]{64}','contains: utf8','not-contains: report','contains: "status": "ok"','not-contains: forbidden',
  {id:"semantic",criterion:"Task is complete"},
 ];
 const f=fidelityFixture(assertions,'writeFileSync("outputs/data.json",JSON.stringify({v0:null,v1:false,v2:0,v3:""}));writeFileSync("outputs/report.go",'+JSON.stringify('package main\nimport "fmt"\nforbidden\n{"status": "ok"}')+');output='+JSON.stringify(payload)+';',"task done",transport),old=process.env.SKILL_CREATOR_GOOSE_COMMAND;process.env.SKILL_CREATOR_GOOSE_COMMAND=process.execPath+" "+f.host;
 try{const opts={skillPath:f.skill,workspace:f.workspace,execute:true,cacheDir:null,progress:"none" as const,gradingMode:mode,graders:[{id:"g",model:"mock"}]};let result=await fullEval(opts);if(mode==="delegated"){assert.equal(result.status,"awaiting-grading",JSON.stringify(result));assert.equal(submitSourceQuotes(f.workspace,"task done").ready_to_resume,true);result=await fullEval({...opts,resume:true});}assert.equal(result.checkpoint?.kind,"human-review",JSON.stringify(result));assert.equal(validateExecutionEvidence(f.workspace).status,"complete");
  for(const variant of ["with_skill","without_skill"]){const run=join(f.workspace,"eval-1",variant,"run-1"),context=JSON.parse(readFileSync(join(run,"outputs/task-evidence.json"),"utf8")),g=JSON.parse(readFileSync(join(run,"grading.json"),"utf8"));assert.equal(context.stdout,payload);
   const verdict=(id:string)=>g.expectations.find(e=>e.id===id)?.verdict;assert.equal(verdict("exact"),"pass");assert.equal(verdict("different"),"pass");assert.equal(verdict("no-rejection"),"fail");assert.equal(verdict("missing"),"fail");
   for(let i=0;i<4;i++){assert.equal(verdict("equals"+i),"pass");assert.equal(verdict("not-equals"+i),"fail");}
   const textChecks=g.expectations.filter(e=>e.classification==="deterministic").slice(12);assert.deepEqual(textChecks.map(e=>e.verdict),["pass","pass","pass","fail","fail","pass","pass","fail"]);
   assert.equal(textChecks[0].evidence.evidence_source.path,"outputs/artifacts/outputs/report.go");assert.equal(textChecks[0].evidence.quote,'import "fmt"');
  }
  const calls=readFileSync(f.calls,"utf8");await fullEval({...opts,resume:true});assert.equal(readFileSync(f.calls,"utf8"),calls);
 }finally{old===undefined?delete process.env.SKILL_CREATOR_GOOSE_COMMAND:process.env.SKILL_CREATOR_GOOSE_COMMAND=old;rmSync(f.root,{recursive:true,force:true});}
});
for(const mode of ["subprocess","delegated"] as const)test(mode+" public equivalent file/stdout outcomes have zero quality delta",async()=>{
 const f=fidelityFixture(['contains: "status": "ok"',{id:"semantic",criterion:"Status is ok"}],'if(input.includes("Supplied Skill instructions")){writeFileSync("outputs/result.json",\'{"status": "ok"}\');output="done";}else output=\'{"status": "ok"}\';','"status": "ok"'),old=process.env.SKILL_CREATOR_GOOSE_COMMAND;process.env.SKILL_CREATOR_GOOSE_COMMAND=process.execPath+" "+f.host;
 try{const opts={skillPath:f.skill,workspace:f.workspace,execute:true,cacheDir:null,progress:"none" as const,gradingMode:mode,graders:[{id:"g",model:"mock"}]};let r=await fullEval(opts);if(mode==="delegated"){assert.equal(r.status,"awaiting-grading",JSON.stringify(r));assert.equal(submitSourceQuotes(f.workspace,'"status": "ok"').ready_to_resume,true);r=await fullEval({...opts,resume:true});}assert.equal(r.checkpoint?.kind,"human-review",JSON.stringify(r));const benchmark=JSON.parse(readFileSync(join(f.workspace,"benchmark.json"),"utf8"));assert.equal(Number(benchmark.run_summary.delta.pass_rate),0);assert.equal(benchmark.run_summary.with_skill.pass_rate.mean,1);assert.equal(benchmark.run_summary.without_skill.pass_rate.mean,1);assert.equal(validateExecutionEvidence(f.workspace).status,"complete");}finally{old===undefined?delete process.env.SKILL_CREATOR_GOOSE_COMMAND:process.env.SKILL_CREATOR_GOOSE_COMMAND=old;rmSync(f.root,{recursive:true,force:true});}
});
for(const mode of ["subprocess","delegated"] as const)for(const unreadable of [false,true])test(mode+" public "+(unreadable?"unreadable":"omitted")+" sources cannot establish absence or semantic evidence",async()=>{
 const bad="SECRET-PASS-TOKEN",f=fidelityFixture(['not-contains: SECRET-PASS-TOKEN','contains: SECRET-PASS-TOKEN','not-contains: done',{id:"semantic",criterion:"The report is complete"}],'writeFileSync("outputs/hidden.txt",'+(unreadable?'Buffer.from("SECRET-PASS-TOKEN\\0")':'"x".repeat(300000)+"SECRET-PASS-TOKEN"')+');',bad),old=process.env.SKILL_CREATOR_GOOSE_COMMAND;process.env.SKILL_CREATOR_GOOSE_COMMAND=process.execPath+" "+f.host;
 try{const opts={skillPath:f.skill,workspace:f.workspace,execute:true,cacheDir:null,progress:"none" as const,gradingMode:mode,graders:[{id:"g",model:"mock"}]};let r=await fullEval(opts);assert.equal(r.status,"awaiting-grading",JSON.stringify(r));
  if(mode==="delegated"){const imported=submitSourceQuotes(f.workspace,bad);assert.equal(imported.ready_to_resume,false);assert.ok(imported.imported.every(e=>!e.valid_evidence));}
  for(const variant of ["with_skill","without_skill"]){const run=join(f.workspace,"eval-1",variant,"run-1"),g=JSON.parse(readFileSync(join(run,"grading.json"),"utf8"));assert.deepEqual(g.expectations.filter(e=>e.classification==="deterministic").map(e=>e.verdict),["inconclusive","inconclusive","fail"]);assert.equal(g.expectations.find(e=>e.id==="semantic").availability,"unavailable");}
  const before=readFileSync(f.calls,"utf8").trim().split("\n").map(JSON.parse).filter(c=>!c.grader).length;
  if(mode==="delegated")assert.equal(submitSourceQuotes(f.workspace,"done").ready_to_resume,true);else writeFileSync(f.host,readFileSync(f.host,"utf8").replace('evidence_quote:'+JSON.stringify(bad),'evidence_quote:"done"'));
  r=await fullEval({...opts,resume:true});assert.equal(r.checkpoint?.kind,"human-review",JSON.stringify(r));assert.equal(validateExecutionEvidence(f.workspace).status,"complete");assert.equal(readFileSync(f.calls,"utf8").trim().split("\n").map(JSON.parse).filter(c=>!c.grader).length,before);
  const calls=readFileSync(f.calls,"utf8");await fullEval({...opts,resume:true});assert.equal(readFileSync(f.calls,"utf8"),calls);
 }finally{old===undefined?delete process.env.SKILL_CREATOR_GOOSE_COMMAND:process.env.SKILL_CREATOR_GOOSE_COMMAND=old;rmSync(f.root,{recursive:true,force:true});}
});
for(const mode of ["subprocess","delegated"] as const)test(mode+" public missing operands reject before candidate or grader calls",async()=>{
 const f=fidelityFixture([{criterion:"Must equal",checker:{kind:"equals"}},{criterion:"Semantic check"}],'output="done";'),old=process.env.SKILL_CREATOR_GOOSE_COMMAND;process.env.SKILL_CREATOR_GOOSE_COMMAND=process.execPath+" "+f.host;
 try{const r=await fullEval({skillPath:f.skill,workspace:f.workspace,execute:true,cacheDir:null,progress:"none",gradingMode:mode,graders:[{id:"g",model:"mock"}]});assert.equal(r.status,"failure",JSON.stringify(r));assert.match(readFileSync(join(f.workspace,"evaluation-design.json"),"utf8"),/operand/);assert.equal(readdirSync(f.root).includes("calls"),false);}finally{old===undefined?delete process.env.SKILL_CREATOR_GOOSE_COMMAND:process.env.SKILL_CREATOR_GOOSE_COMMAND=old;rmSync(f.root,{recursive:true,force:true});}
});
