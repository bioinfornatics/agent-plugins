import { test } from "node:test";
import assert from "node:assert/strict";
import { GooseRunner } from "../dist/scripts/runners/goose.js";
import {CommandGraderAdapter} from "../dist/scripts/evaluator_grading.js";
const fake=new URL("fixtures/adversarial-runner.mjs",import.meta.url).pathname;
const plan={prompt:"task",assertions:[],cwd:process.cwd(),model:null,tools:[],capabilities:{filesystem:true,agent_runner:true,browser:false,network:false,tools:[]},timeoutSeconds:.15};
for(const [mode,code] of [["partial","incomplete"],["error-complete","host-exit"],["failed-terminal","incomplete"],["clean-timeout","timeout"],["ignore-term","timeout"],["descendant","timeout"]]) {
 test("execution cannot complete: "+mode,{timeout:5000},async()=>{
  const start=Date.now();
  await assert.rejects(new GooseRunner(process.execPath+" "+fake+" "+mode).executePaired(plan),(e:any)=>e.code===code&&e.evidence.exitReason!=="completed");
  assert.ok(Date.now()-start<3000,"termination must be bounded");
 });
}
test("grader rejects stream error, failed terminal and terminal-less semantic JSON",async()=>{const input:any={prompt:"task",output:"valid result",assertion:{id:"a",version:1,criterion:"result"},variantAlias:"variant-a",identity:{id:"g",model:"m"}};for(const mode of ["partial","failed-terminal","error-complete"]){const adapter=new CommandGraderAdapter([process.execPath,new URL("fixtures/adversarial-grader.mjs",import.meta.url).pathname,mode],2);await assert.rejects(adapter.grade(input),/grader.*completion|grader.*error/i,mode);}});
test("grader timeout kills a SIGTERM-resistant process within a bounded interval",{timeout:5000},async()=>{const adapter=new CommandGraderAdapter([process.execPath,new URL("fixtures/adversarial-grader.mjs",import.meta.url).pathname,"ignore-term"],.15),start=Date.now();await assert.rejects(adapter.grade({prompt:"task",output:"valid result",assertion:{id:"a",version:1,classification:"semantic",criterion:"result"},variantAlias:"variant-a",identity:{id:"g",model:"m"},assertionSha256:"a",variantSha256:"b",outputSha256:"c"}),/timeout/);assert.ok(Date.now()-start<3000);});
test("valid terminal remains successful",async()=>{
 const result=await new GooseRunner(process.execPath+" "+fake+" valid").executePaired({...plan,timeoutSeconds:2});assert.equal(result.output,"valid result");assert.equal(result.exitReason,"completed");
});
