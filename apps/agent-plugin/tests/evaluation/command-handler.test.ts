import { expect, test } from "bun:test";
import { createEvaluationCommandHandler } from "../../src/adapters/inbound/cli/handle-evaluation-command.ts";
import type { EvaluationInput } from "../../src/domain/evaluation.ts";
import type { EvaluationStore } from "../../src/application/ports/evaluation-store.ts";

const input: EvaluationInput = {skills:["/skill"],plugins:[],agents:["example"],repetitions:1,maxTurns:5,timeout:0,parallelism:3};
const source = {load: async () => ({kind:"skill" as const,root:"/skill",scenarios:[{id:"skill/1",sourceId:1,skill:"/skill",suite:"/skill/evals/evals.json",prompt:"task",expectations:["criterion"]}]})};
// Current CLI validation selects known hosts; an injected adapter may implement any supported identity.
const validInput = {...input, agents:["goose"]};

test("named dry-run handler prints the plan without constructing execution dependencies",async()=>{
 let out="";
 const handler=createEvaluationCommandHandler({writeOut:s=>{out+=s;},writeErr:()=>{throw Error("Unexpected diagnostic");}}, {
  source,
  createHosts:()=>{throw Error("Dry-run constructed hosts");},
  createStore:()=>{throw Error("Dry-run constructed storage");},
 });
 expect(handler.name).toBe("handleEvaluationCommand");
 await handler(validInput,true);
 expect(JSON.parse(out).candidateRuns).toBe(2);
});

test("named handler wires output destination and renders an execution summary",async()=>{
 let out="",destination="",closed=false;
 const store:EvaluationStore={begin:async()=>({id:"campaign",output:"/stored"}),start:async()=>{},finish:async()=>{},fail:async()=>{throw Error("Unexpected failure");},close:async()=>{closed=true;}};
 const handler=createEvaluationCommandHandler({writeOut:s=>{out+=s;},writeErr:()=>{}},{source,
 createHosts:()=>new Map([["goose",{preflight:async()=>{},run:async r=>({host:{id:"goose",version:"test"},status:"completed" as const,exitCode:0,sessionName:r.id,collection:"complete" as const,startedAt:"start",finishedAt:"end",artifacts:[],limitations:[]})}]]),
 createStore:path=>{destination=path;return store;}});
 await handler({...validInput,output:"/chosen"},false);
 expect(destination).toBe("/chosen");expect(closed).toBe(true);
 expect(JSON.parse(out)).toEqual({id:"campaign",output:"/stored",completed:2,failed:0,total:2});
});

test("named handler does not expose raw errors from execution factories",async()=>{
 let out="";
 const handler=createEvaluationCommandHandler({writeOut:s=>{out+=s;},writeErr:()=>{}},{source,
 createHosts:()=>{throw Error("private-token");},createStore:()=>{throw Error("Unexpected store construction");}});
 await expect(handler(validInput,false)).rejects.toThrow("Campaign preflight or storage failed; no raw configuration diagnostics are exposed");
 expect(out).toBe("");
});
