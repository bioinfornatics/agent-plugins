import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const cli=resolve("dist/scripts/cli.js");
function fixture(){
 const root=mkdtempSync(join(tmpdir(),"prepare-execution-")),skill=join(root,"demo"),workspace=join(root,"campaign"),destination=join(root,"packets");
 mkdirSync(join(skill,"evals","files"),{recursive:true});
 writeFileSync(join(skill,"SKILL.md"),"---\nname: demo\ndescription: Reviews synthetic records. Use when a record review is requested.\n---\n# Demo\nReview the supplied records.\n");
 writeFileSync(join(skill,"evals","files","input.txt"),"same immutable fixture");
 writeFileSync(join(skill,"evals","evals.json"),JSON.stringify({skill_name:"demo",evals:[{id:1,name:"record-review",subject:"behavior",language:"en",prompt:"Review evals/files/input.txt and return a Markdown report.",expected_output:"HIDDEN_EXPECTED_ANSWER",assertions:[{id:"secret",version:1,classification:"semantic",criterion:"HIDDEN_CRITERION"}],target:{kind:"file",execution:"execute",path:"evals/files/input.txt"},files:["evals/files/input.txt"],budget:{max_turns:12,timeout_seconds:60},capabilities:{filesystem:true,agent_runner:true,browser:false,network:false,tools:["developer"]},coverage_tags:["language:en"]}]}));
 const scaffold=spawnSync(process.execPath,[cli,"full-eval",skill,"--workspace",workspace,"--format","json"],{encoding:"utf8"});
 assert.equal(scaffold.status,3,scaffold.stdout+scaffold.stderr);
 return{root,skill,workspace,destination};
}
function invoke(f:ReturnType<typeof fixture>,extra:string[]=[]){return spawnSync(process.execPath,[cli,"prepare-execution",f.workspace,"--output",f.destination,...extra,"--format","json"],{encoding:"utf8",env:{...process.env,SKILL_CREATOR_GOOSE_COMMAND:"/nonexistent-host-must-not-launch"}});}
function direct(f:ReturnType<typeof fixture>,args:string[]=[]){return spawnSync(process.execPath,[cli,"prepare-execution","--skill-path",f.skill,...args,"--format","json"],{encoding:"utf8",env:{...process.env,SKILL_CREATOR_GOOSE_COMMAND:"/nonexistent-no-model"}});}
function defaultEval(f:ReturnType<typeof fixture>){writeFileSync(join(f.skill,"eval.json"),readFileSync(join(f.skill,"evals/evals.json")));}
test("PD-1/3/5 defaults, prior-result exclusion and unique runs",()=>{const f=fixture();try{
 defaultEval(f);mkdirSync(join(f.skill,"eval_result","old"),{recursive:true});writeFileSync(join(f.skill,"eval_result/old/private.txt"),"PRIOR_RUN_SECRET");
 const first=direct(f);assert.equal(first.status,0,first.stdout+first.stderr);const a=JSON.parse(first.stdout).output;
 assert.equal(a.skill,f.skill);assert.equal(a.eval_set,join(f.skill,"eval.json"));assert.equal(resolve(a.destination,".."),join(f.skill,"eval_result"));const now=new Date();const prefix=[now.getDate(),now.getMonth()+1,now.getFullYear()%100].map(x=>String(x).padStart(2,"0")).join("-");assert.ok(a.destination.endsWith(prefix+"-"+a.run_id));assert.match(a.destination.split("/").at(-1),/^[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9a-f-]{36}$/);assert.equal(a.requests.length,2);
 for(const r of a.requests)for(const p of files(r.working_directory)){assert.ok(!p.endsWith("/eval.json"));assert.ok(!readFileSync(p,"utf8").includes("PRIOR_RUN_SECRET"));}
 const second=direct(f);assert.equal(second.status,0,second.stdout+second.stderr);const b=JSON.parse(second.stdout).output;assert.notEqual(a.run_id,b.run_id);assert.notEqual(a.destination,b.destination);assert.equal(readFileSync(join(f.skill,"eval_result/old/private.txt"),"utf8"),"PRIOR_RUN_SECRET");
}finally{rmSync(f.root,{recursive:true,force:true});}});
test("PD-2 explicit paths override defaults and preserve prior output",()=>{const f=fixture();try{
 defaultEval(f);const args=["--eval-set",join(f.skill,"evals/evals.json"),"--output",f.destination];const run=direct(f,args);assert.equal(run.status,0,run.stdout+run.stderr);assert.equal(JSON.parse(run.stdout).output.destination,f.destination);
 const before=files(f.destination).map(p=>[p,readFileSync(p)] as const);assert.notEqual(direct(f,args).status,0);for(const [p,b] of before)assert.deepEqual(readFileSync(p),b);
}finally{rmSync(f.root,{recursive:true,force:true});}});
test("PD-4 missing default eval.json fails before result creation",()=>{const f=fixture();try{const run=direct(f);assert.notEqual(run.status,0);assert.match(run.stdout,/eval.json/);assert.equal(existsSync(join(f.skill,"eval_result")),false);}finally{rmSync(f.root,{recursive:true,force:true});}});
test("PD-4 rejects a symbolic-link result root and unsafe explicit output",()=>{const f=fixture();try{
 defaultEval(f);const outside=join(f.root,"outside");mkdirSync(outside);symlinkSync(outside,join(f.skill,"eval_result"));
 const a=direct(f);assert.notEqual(a.status,0);assert.match(a.stdout,/regular directories/);assert.deepEqual(readdirSync(outside),[]);
 const b=direct(f,["--output",join(f.skill,"SKILL.md")]);assert.notEqual(b.status,0);assert.match(b.stdout,/eval_result/);
}finally{rmSync(f.root,{recursive:true,force:true});}});
test("PD-2 external eval-set uses Skill-relative fixtures without leaking the selected eval",()=>{const f=fixture();try{
 const evalPath=join(f.root,"external-eval.json");writeFileSync(evalPath,readFileSync(join(f.skill,"evals/evals.json")));
 const run=direct(f,["--eval-set",evalPath]);assert.equal(run.status,0,run.stdout+run.stderr);const result=JSON.parse(run.stdout).output;assert.equal(result.eval_set,evalPath);
 for(const r of result.requests){assert.equal(readFileSync(join(r.working_directory,"evals/files/input.txt"),"utf8"),"same immutable fixture");for(const p of files(r.working_directory))assert.ok(!readFileSync(p,"utf8").includes("HIDDEN_CRITERION"));}
}finally{rmSync(f.root,{recursive:true,force:true});}});
function files(root:string):string[]{return readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(root,e.name)):[join(root,e.name)]);}
test("PE-1/2/5 CLI exports both candidates without host calls or hidden grading inputs",()=>{const f=fixture();try{
 const run=invoke(f);assert.equal(run.status,0,run.stdout+run.stderr);
 const result=JSON.parse(run.stdout).output;assert.equal(result.status,"prepared");assert.equal(result.execution_status,"not-run");assert.equal(result.requests.length,2);
 const packets=result.requests.map((p:any)=>JSON.parse(readFileSync(p.request_path,"utf8")));
 for(const p of packets){assert.equal(p.protocol,"host-candidate-request-v1");assert.equal(p.model,null);assert.equal(p.budget.max_turns,12);assert.ok(!JSON.stringify(p).includes("HIDDEN_"));assert.equal(readFileSync(join(p.working_directory,"evals/files/input.txt"),"utf8"),"same immutable fixture");assert.equal(existsSync(join(p.working_directory,"evals/evals.json")),false);assert.equal(existsSync(join(p.working_directory,"eval_metadata.json")),false);}
 assert.equal(packets.filter((p:any)=>p.instructions.includes("Review the supplied records.")).length,1);
 assert.equal(packets.filter((p:any)=>existsSync(join(p.working_directory,".agents/skills/demo/SKILL.md"))).length,1);
 assert.equal(existsSync(join(f.workspace,"eval-1/with_skill/run-1/execution-evidence.json")),false);
}finally{rmSync(f.root,{recursive:true,force:true});}});
test("PE-4 preparation never overwrites an existing destination",()=>{const f=fixture();try{assert.equal(invoke(f).status,0);const before=files(f.destination).map(p=>[p,readFileSync(p)] as const);assert.notEqual(invoke(f).status,0);for(const [p,bytes] of before)assert.deepEqual(readFileSync(p),bytes);}finally{rmSync(f.root,{recursive:true,force:true});}});
for(const mutation of ["skill","fixture","metadata","adaptive","symlink"] as const)test("PE-3 rejects "+mutation+" before publishing",()=>{const f=fixture();try{
 if(mutation==="skill")writeFileSync(join(f.skill,"SKILL.md"),"changed");
 if(mutation==="fixture")writeFileSync(join(f.skill,"evals/files/input.txt"),"changed");
 if(mutation==="symlink"){rmSync(join(f.skill,"evals/files/input.txt"));symlinkSync(join(f.skill,"SKILL.md"),join(f.skill,"evals/files/input.txt"));}
 if(mutation==="metadata"||mutation==="adaptive"){const path=join(f.workspace,"eval-1/eval_metadata.json"),m=JSON.parse(readFileSync(path,"utf8"));if(mutation==="adaptive")m.decision_policy="adaptive";else m.prompt="tampered";writeFileSync(path,JSON.stringify(m));}
 const run=invoke(f);assert.notEqual(run.status,0);assert.match(JSON.parse(run.stdout).output.reason,/drift|fixed|symbolic/i);assert.equal(existsSync(f.destination),false);
}finally{rmSync(f.root,{recursive:true,force:true});}});
test("PE-3 rejects output inside a source tree",()=>{const f=fixture();try{
 f.destination=join(f.skill,"inside");const run=invoke(f);assert.notEqual(run.status,0);assert.match(JSON.parse(run.stdout).output.reason,/outside source/);assert.equal(existsSync(f.destination),false);
}finally{rmSync(f.root,{recursive:true,force:true});}});
