import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync } from "node:fs";
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
