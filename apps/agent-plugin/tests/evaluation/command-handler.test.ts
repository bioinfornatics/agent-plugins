import { randomUUID } from "node:crypto";
import { expect, test } from "bun:test";
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
 expect(handler.name).toBe("handleEvaluationCommand");
 await handler(validInput,true);
 expect(JSON.parse(out).candidateRuns).toBe(2);
});

test("named handler wires output destination and renders an execution summary",async()=>{
 let out="",destination="",closed=false;
 const store:EvaluationStore={resume:async()=>{throw Error("Unexpected resume");},begin:async()=>({id:"campaign",output:"/stored"}),start:async()=>{},finish:async()=>{},fail:async()=>{throw Error("Unexpected failure");},complete:async()=>{},close:async()=>{closed=true;}};
 const handler=createEvaluationCommandHandler({writeOut:s=>{out+=s;},writeErr:()=>{}},{source,newAttemptId:randomUUID,
 createHosts:()=>new Map([["goose",{preflight:async()=>{},run:async r=>({host:{id:"goose",version:"test"},status:"completed" as const,exitCode:0,sessionName:r.id,collection:"complete" as const,startedAt:"start",finishedAt:"end",artifacts:[],limitations:[]})}]]),
 createStore:path=>{if(path===undefined) throw Error("Missing chosen destination");destination=path;return store;}});
 await handler({...validInput,output:"/chosen"},false);
 expect(destination).toBe("/chosen");expect(closed).toBe(true);
 expect(JSON.parse(out)).toEqual({id:"campaign",output:"/stored",completed:2,failed:0,total:2});
});

test("named handler does not expose raw errors from execution factories",async()=>{
 let out="";
 const handler=createEvaluationCommandHandler({writeOut:s=>{out+=s;},writeErr:()=>{}},{source,newAttemptId:randomUUID,
 createHosts:()=>{throw Error("private-token");},createStore:()=>{throw Error("Unexpected store construction");}});
 await expect(handler(validInput,false)).rejects.toThrow("Campaign execution, recovery or storage failed; inspect receipts; uncertain attempts require explicit --retry-uncertain");
 expect(out).toBe("");
});

for(const failure of ["snapshot","output"] as const) test(`preparation ${failure} failure rejects without constructing execution resources`,async()=>{
 let hosts=0,stores=0,writes=0;
 const handler=createEvaluationCommandHandler({writeOut:()=>{writes++;throw Error("writer unavailable");},writeErr:()=>{}},{
  source:failure==="snapshot"?{...source,load:async()=>{throw Error("snapshot unavailable");}}:source,newAttemptId:randomUUID,
  createHosts:()=>{hosts++;throw Error("Unexpected host");},createStore:()=>{stores++;throw Error("Unexpected store");}
 });
 await expect(handler(validInput,true)).rejects.toThrow(failure==="snapshot"?"snapshot unavailable":"writer unavailable");
 expect(hosts).toBe(0);expect(stores).toBe(0);expect(writes).toBe(failure==="snapshot"?0:1);
});
