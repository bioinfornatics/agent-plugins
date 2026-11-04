import { randomUUID } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createEvaluationCommandHandler } from "../../src/adapters/inbound/cli/handle-evaluation-command.ts";
import type { EvaluationInput } from "../../src/domain/evaluation.ts";
import type { EvaluationStore } from "../../src/application/ports/evaluation-store.ts";

const input: EvaluationInput = {skills:["/skill"],plugins:[],agents:["example"],repetitions:1,maxTurns:5,timeout:0,parallelism:3};
const source = {fingerprint: (s: string) => s, load: async () => ({kind:"skill" as const,root:"/skill",installationName:"skill",skillRoots:["/skill"],fingerprint:"revision",files:[],scenarios:[{id:"skill/1",sourceId:1,skill:"/skill",suite:"/skill/evals/evals.json",prompt:"task",expectations:["criterion"]}]})};
// Current CLI validation selects known hosts; an injected adapter may implement any supported identity.
const validInput = {...input, agents:["goose"]};

test("named dry-run handler prints the plan without constructing execution dependencies",async()=>{
 let out="";
 const handler=createEvaluationCommandHandler({writeOut:s=>{out+=s;},writeErr:()=>{throw Error("Unexpected diagnostic");}}, {
  source, newAttemptId:randomUUID,
  createHosts:()=>{throw Error("Dry-run constructed hosts");},
  createStore:()=>{throw Error("Dry-run constructed storage");},
 });
 assert.strictEqual(handler.name, "handleEvaluationCommand");
 await handler(validInput,true);
 assert.strictEqual(JSON.parse(out).candidateRuns, 2);
});

test("named handler wires output destination and renders an execution summary",async()=>{
 let out="",destination="",closed=false;
 const store:EvaluationStore={resume:async()=>{throw Error("Unexpected resume");},begin:async()=>({id:"campaign",output:"/stored"}),start:async()=>{},finish:async()=>{},fail:async()=>{throw Error("Unexpected failure");},complete:async()=>{},close:async()=>{closed=true;}};
 const handler=createEvaluationCommandHandler({writeOut:s=>{out+=s;},writeErr:()=>{}},{source,newAttemptId:randomUUID,
 createHosts:()=>new Map([["goose",{preflight:async()=>{},run:async r=>({host:{id:"goose",version:"test"},status:"completed" as const,exitCode:0,sessionName:r.id,collection:"complete" as const,startedAt:"start",finishedAt:"end",artifacts:[],limitations:[]})}]]),
 createStore:path=>{if(path===undefined) throw Error("Missing chosen destination");destination=path;return store;}});
 await handler({...validInput,output:"/chosen"},false);
 assert.strictEqual(destination, "/chosen");assert.strictEqual(closed, true);
 assert.deepStrictEqual(JSON.parse(out), {id:"campaign",output:"/stored",completed:2,failed:0,total:2});
});

test("named handler does not expose raw errors from execution factories",async()=>{
 let out="";
 const handler=createEvaluationCommandHandler({writeOut:s=>{out+=s;},writeErr:()=>{}},{source,newAttemptId:randomUUID,
 createHosts:()=>{throw Error("private-token");},createStore:()=>{throw Error("Unexpected store construction");}});
 await assert.rejects(handler(validInput,false), /Campaign execution, recovery or storage failed; inspect receipts; uncertain attempts require explicit --retry-uncertain/);
 assert.strictEqual(out, "");
});

for(const failure of ["snapshot","output"] as const) test(`preparation ${failure} failure rejects without constructing execution resources`,async()=>{
 let hosts=0,stores=0,writes=0;
 const handler=createEvaluationCommandHandler({writeOut:()=>{writes++;throw Error("writer unavailable");},writeErr:()=>{}},{
  source:failure==="snapshot"?{...source,load:async()=>{throw Error("snapshot unavailable");}}:source,newAttemptId:randomUUID,
  createHosts:()=>{hosts++;throw Error("Unexpected host");},createStore:()=>{stores++;throw Error("Unexpected store");}
 });
 await assert.rejects(handler(validInput,true), error => { assert.ok(error instanceof Error); const expected = failure==="snapshot"?"snapshot unavailable":"writer unavailable"; assert.ok(expected === undefined || error.message.includes(expected)); return true; });
 assert.strictEqual(hosts, 0);assert.strictEqual(stores, 0);assert.strictEqual(writes, failure==="snapshot"?0:1);
});
