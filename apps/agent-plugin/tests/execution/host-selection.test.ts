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
