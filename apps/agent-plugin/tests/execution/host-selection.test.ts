import { randomUUID } from "node:crypto";
import { expect, test } from "bun:test";
import { composeProfile } from "../../src/application/use-cases/prepare-evaluation.ts";
import { buildMatrix } from "../../src/domain/evaluation.ts";
import { executeEvaluation } from "../../src/application/use-cases/execute-evaluation.ts";
import type { CandidateHost } from "../../src/application/ports/candidate-host.ts";
import type { EvaluationStore } from "../../src/application/ports/evaluation-store.ts";
import type { TrialRequest, TrialResult } from "../../src/domain/execution.ts";

function plan(agents: string[]) {
  return buildMatrix(composeProfile([{kind:"skill",root:"/target",installationName:"target",skillRoots:["/target"],fingerprint:"revision",files:[],scenarios:[{id:"sample/1",sourceId:1,skill:"/target",suite:"/target/evals/evals.json",prompt:"task",expectations:["criterion"]}]}],{fingerprint:s=>s}),
    {agents,repetitions:1,maxTurns:5,timeout:0,parallelism:3});
}
function store(events: string[], receipts: TrialResult[]): EvaluationStore {
  return {
    resume: async () => {throw new Error("Unexpected resume");},
    begin: async () => { events.push("begin"); return {id:"campaign",output:"/output"}; },
    start: async (request) => { events.push(`start:${request.agent}`); },
    finish: async (_request,result) => { receipts.push(result); },
    fail: async () => { throw new Error("Unexpected failure"); },
    complete: async () => {},
    close: async () => { events.push("close"); },
  };
}
function host(id: string, events: string[], requests: TrialRequest[]): CandidateHost {
  return {
    preflight: async () => { events.push(`preflight:${id}`); },
    run: async request => { requests.push(request); return {host:{id,version:"test-v1"},status:"completed",exitCode:0,sessionName:request.id,collection:"complete",startedAt:"start",finishedAt:"finish",artifacts:[],limitations:[]}; },
  };
}

test("generic orchestration routes each trial to its registered host",async()=>{
  const events:string[]=[],requests:TrialRequest[]=[],receipts:TrialResult[]=[];
  const hosts=new Map([["alpha",host("alpha",events,requests)],["beta",host("beta",events,requests)]]);
  const result=await executeEvaluation(plan(["alpha","beta"]),hosts,store(events,receipts),randomUUID);
  expect(requests.map(r=>[r.agent,r.condition])).toEqual([["alpha","with"],["alpha","without"],["beta","with"],["beta","without"]]);
  expect(receipts.map(r=>r.host.id)).toEqual(["alpha","alpha","beta","beta"]);
  expect(events).toEqual(["preflight:alpha","preflight:beta","begin","start:alpha","start:alpha","start:beta","start:beta","close"]);
  expect(result.completed).toBe(4);
});

test("missing host is rejected before any preflight, storage or candidate call",async()=>{
  const events:string[]=[],requests:TrialRequest[]=[],receipts:TrialResult[]=[];
  await expect(executeEvaluation(plan(["alpha","missing"]),new Map([["alpha",host("alpha",events,requests)]]),store(events,receipts),randomUUID))
    .rejects.toThrow("No execution adapter registered for agent: missing");
  expect(events).toEqual([]);expect(requests).toEqual([]);expect(receipts).toEqual([]);
});

for (const mismatch of ["host", "empty-session", "exception"] as const) test(`invalid candidate attribution ${mismatch} never becomes a completed trial`,async()=>{
  const events:string[]=[],requests:TrialRequest[]=[],receipts:TrialResult[]=[],uncertain:TrialRequest[]=[];
  const normal=host("alpha",events,requests);
  const candidate:CandidateHost={...normal,run:async request=>{
    if(mismatch==="exception")throw Error("private-token");
    const response=await normal.run(request);
    return {...response,host:{...response.host,id:mismatch==="host"?"beta":"alpha"},sessionName:mismatch==="empty-session"?"":response.sessionName};
  }};
  const persistence={...store(events,receipts),fail:async(request:TrialRequest)=>{uncertain.push(request);}};
  const result=await executeEvaluation(plan(["alpha"]),new Map([["alpha",candidate]]),persistence,randomUUID);
  expect(result.completed).toBe(0);expect(result.failed).toBe(2);
  expect(uncertain.map(r=>r.trialId)).toEqual(["trial-1","trial-2"]);
  expect(receipts).toEqual([]);expect(events.at(-1)).toBe("close");
});

test("reference matrix has 24 unique logical trials in 12 complete ordered pairs",()=>{
 const first=plan(["alpha","beta"]);
 const scenario=first.profile.scenarios[0];
 if(!scenario)throw Error("Missing reference scenario");
 const profile={...first.profile,scenarios:[scenario,{...scenario,id:"second/2"}]};
 const prepared=buildMatrix(profile,{...first.options,repetitions:3});
 expect(prepared.candidateRuns).toBe(24);expect(new Set(prepared.trials.map(t=>t.id)).size).toBe(24);
 const pairs=new Map<string,typeof prepared.trials>();
 for(const trial of prepared.trials){const list=pairs.get(trial.pairId)??[];list.push(trial);pairs.set(trial.pairId,list);}
 expect(pairs.size).toBe(12);
 for(const pair of pairs.values()){
  expect(pair.map(t=>t.condition)).toEqual(["with","without"]);
  const [withTrial,withoutTrial]=pair;
  if(!withTrial||!withoutTrial)throw Error("Incomplete pair");
  expect(withoutTrial).toEqual({...withTrial,id:withoutTrial.id,condition:"without"});
 }
 expect(buildMatrix(profile,{...first.options,repetitions:3})).toEqual(prepared);
});
