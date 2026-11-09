import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { validateCandidateModels, validateConfiguredCandidateModel, type ConfiguredCandidateModel } from "../../src/domain/candidate-model.ts";
import { prepareEvaluation } from "../../src/application/use-cases/prepare-evaluation.ts";
import { executeEvaluation } from "../../src/application/use-cases/execute-evaluation.ts";
import type { CandidateHost } from "../../src/application/ports/candidate-host.ts";
import type { TrialRequest } from "../../src/domain/execution.ts";
import { FilesystemEvaluationSource } from "../../src/adapters/outbound/filesystem/filesystem-evaluation-source.ts";
import { SqliteEvaluationStore } from "../../src/adapters/outbound/storage/sqlite-evaluation-store.ts";
import { Database } from "../../src/adapters/outbound/storage/sqlite-database.ts";
import { readStoredPlan } from "../../src/adapters/outbound/storage/registry-schema.ts";
import { requestMetadata } from "../../src/adapters/outbound/storage/campaign-checkpoint.ts";
const roots: string[] = [];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const configured: ConfiguredCandidateModel = {source:"configuration-default",provider:"fake",model:"t1"};
const host: CandidateHost = {preflight:async()=>{},run:async request=>{
 const model=request.options.candidateModels?.[request.agent];
 return {status:"completed",collection:"complete",exitCode:0,sessionName:request.id,startedAt:"start",finishedAt:"end",host:{id:request.agent,version:"fixture"},artifacts:[],limitations:[],...(model ? {model:{configured:model,observed:{provider:"fake",model:model.model}}}: {})};
}};
async function setup(){
 const root=await mkdtemp(join(tmpdir(),"candidate-model-"));roots.push(root);
 const target=join(root,"skill");await mkdir(join(target,"evals"),{recursive:true});
 await writeFile(join(target,"SKILL.md"),"capability");await writeFile(join(target,"evals/evals.json"),JSON.stringify({evals:[{id:1,prompt:"task",expectations:["criterion"]}]}));
 const plan=await prepareEvaluation({skills:[target],plugins:[],agents:["goose"],repetitions:1,maxTurns:5,timeout:0,parallelism:1},new FilesystemEvaluationSource());
 return {root,plan,registry:join(root,"registry/evaluations.sqlite")};
}
function request(plan: Awaited<ReturnType<typeof prepareEvaluation>>): TrialRequest {
 const trial=plan.trials[0],scenario=plan.profile.scenarios[0];
 assert.ok(trial);assert.ok(scenario);
 return {id:randomUUID(),trialId:trial.id,pairId:trial.pairId,agent:trial.agent,condition:trial.condition,profile:plan.profile,scenario,options:plan.options};
}
// Rejects unsafe attribution and extra fields instead of silently normalizing identities.
test("bounded exact candidate identities and maps reject unsafe or inconsistent metadata",()=>{
 for(const model of ["", " ", "x".repeat(513), "t\n1", "t\u00851"]){assert.throws(()=>validateConfiguredCandidateModel({...configured,model}),/candidate model/);}
 validateConfiguredCandidateModel({...configured,model:"x".repeat(512)});
 for(const models of [null,{},[],{claude:configured},{goose:{...configured,source:"requested"}},{goose:{...configured,extra:true}}]) assert.throws(()=>validateCandidateModels({agents:["goose"],candidateModels:models}));
 assert.throws(()=>validateCandidateModels({agents:["goose"],model:"t1",candidateModels:{goose:configured}}),/selection mismatch/);
 assert.throws(()=>validateCandidateModels({agents:["goose"],model:"t2",candidateModels:{goose:{...configured,source:"override"}}}),/selection mismatch/);
});
// Detects current defaults being read per trial or on resume and caller plan mutation.
test("new campaigns capture once, source-independent identities partition, resume stays frozen",async()=>{
 const {root,plan,registry}=await setup();let resolves=0,model="t1";
 const resolving:CandidateHost={...host,resolveModel:async options=>{resolves++;return {source:options.model===undefined?"configuration-default":"override",provider:"fake",model:options.model??model};}};
 const run=(input=plan)=>executeEvaluation(input,new Map([["goose",resolving]]),new SqliteEvaluationStore(join(root,"proofs"),registry,"hive"),randomUUID);
 const first=await run();model="t2";const second=await run();const override=await run({...plan,options:{...plan.options,model:"t1"}});
 assert.equal(resolves,3);assert.equal(plan.options.candidateModels,undefined);assert.equal(Object.hasOwn(plan.options,"model"),false);
 const key=`configured-${createHash("sha256").update('{"version":1,"models":[{"agent":"goose","provider":"fake","model":"t1"}]}').digest("hex")}`;
 assert.equal(dirname(first.output),join(root,"proofs",`profile=${plan.profile.id}`,`model=${key}`));
 assert.notEqual(dirname(first.output),dirname(second.output));assert.equal(dirname(first.output),dirname(override.output));
 const metadata=JSON.parse(await readFile(join(first.output,"campaign.json"),"utf8"));assert.equal(metadata.version,2);assert.equal(metadata.partitionKey,key);assert.deepEqual(metadata.candidateModels,{goose:configured});
 const db=new Database(registry,{readonly:true});const row=db.query<{plan_json:string},[string]>("SELECT plan_json FROM experiments WHERE id=?").get(first.id);assert.ok(row);const stored=readStoredPlan(row.plan_json);db.close();
 assert.deepEqual(stored.options.candidateModels,{goose:configured});assert.equal(Object.hasOwn(stored.options,"model"),false);
 const resumed=await executeEvaluation(undefined,new Map([["goose",{...resolving,resolveModel:async()=>{throw new Error("must not resolve");}}]]),new SqliteEvaluationStore("/unused",registry),randomUUID,{id:first.id,retryUncertain:false});
 assert.equal(resumed.completed,2);assert.equal(resolves,3);
 // A pending frozen trial also receives the captured identity, not the new default.
 const pendingStore=new SqliteEvaluationStore(join(root,"pending"),registry);const pending=await pendingStore.begin(stored);await pendingStore.close();
 const seen:string[]=[];await executeEvaluation(undefined,new Map([["goose",{...resolving,resolveModel:async()=>{throw new Error("must not resolve");},run:async r=>{const captured=r.options.candidateModels?.goose;assert.ok(captured);seen.push(captured.model);return host.run(r);}}]]),new SqliteEvaluationStore("/unused",registry),randomUUID,{id:pending.id,retryUncertain:false});
 assert.deepEqual(seen,["t1","t1"]);
});
// Legacy absence is unknown even when today's adapter can resolve a model.
test("historical plans retain unknown model without resolution or receipt invention",async()=>{
 const {root,plan,registry}=await setup();const store=new SqliteEvaluationStore(join(root,"legacy"),registry);const campaign=await store.begin(plan);await store.close();
 const result=await executeEvaluation(undefined,new Map([["goose",{...host,resolveModel:async()=>{throw new Error("legacy must not resolve");}}]]),new SqliteEvaluationStore("/unused",registry),randomUUID,{id:campaign.id,retryUncertain:false});
 assert.equal(result.completed,2);const db=new Database(registry,{readonly:true});
 for(const row of db.query<{receipt_json:string},[]>("SELECT receipt_json FROM trials").all())assert.equal(Object.hasOwn(JSON.parse(row.receipt_json),"model"),false);db.close();
});
// Prevents mismatched/unsafe observations reaching complete-comparison scoring.
test("model drift is partial while configured attribution mismatch fails candidate",async()=>{
 const {root,plan,registry}=await setup();
 const drift:CandidateHost={...host,resolveModel:async()=>configured,run:async r=>({...await host.run(r),model:{configured,observed:{provider:"other",model:"t2"}}})};
 const result=await executeEvaluation(plan,new Map([["goose",drift]]),new SqliteEvaluationStore(join(root,"drift"),registry),randomUUID);assert.equal(result.completed,0);assert.equal(result.failed,2);
 const wrong:CandidateHost={...drift,run:async r=>({...await host.run(r),model:{configured:{...configured,model:"invented"},observed:null}})};
 await assert.rejects(executeEvaluation(plan,new Map([["goose",wrong]]),new SqliteEvaluationStore(join(root,"wrong"),registry),randomUUID),/not all finalized/);
 const db=new Database(registry,{readonly:true});assert.deepEqual(db.query("SELECT collection FROM trials WHERE campaign_id=?").all(result.id),[{collection:"partial"},{collection:"partial"}]);db.close();
});
// Validates JSON extension at read/start/finish and recovery, not merely at resolution.
test("tampered configured and observed records fail stored reads, finish and resume",async()=>{
 const {root,plan,registry}=await setup();const frozen={...plan,options:{...plan.options,candidateModels:{goose:configured}}};
 assert.throws(()=>readStoredPlan(JSON.stringify({...frozen,options:{...frozen.options,candidateModels:{goose:{...configured,provider:""}}}})),/candidate model/);
 const r=request(frozen);assert.throws(()=>requestMetadata({...r,options:{...r.options,candidateModels:{codex:configured}}}),/agent mismatch/);
 const invalid=new SqliteEvaluationStore(join(root,"invalid"),registry);await invalid.begin(frozen);await invalid.start(r);
 await assert.rejects(invalid.finish(r,{...await host.run(r),model:{configured:{...configured,model:"wrong"},observed:null}}),/attribution mismatch/);await invalid.close();
 const completed=await executeEvaluation(frozen,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"valid"),registry),randomUUID);
 const attempt=(await readdir(join(completed.output,"artifacts")))[0];assert.ok(attempt);const path=join(completed.output,"artifacts",attempt,"checkpoint.json");const checkpoint=JSON.parse(await readFile(path,"utf8"));
 checkpoint.receipt.model.observed.provider="unsafe\nprovider";await writeFile(path,JSON.stringify(checkpoint));
 await assert.rejects(executeEvaluation(undefined,new Map([["goose",host]]),new SqliteEvaluationStore("/unused",registry),randomUUID,{id:completed.id,retryUncertain:true}),/candidate model|checkpoint/i);
});

// Host identity and exact text are hash input; key order and selection source are not.
test("configured Hive keys sort hosts and safely distinguish exact provider and model identities",async()=>{
 const {root,plan,registry}=await setup();
 const publish=async(models:Record<string,ConfiguredCandidateModel>)=>{
  const store=new SqliteEvaluationStore(join(root,"partitions"),registry,"hive");
  const campaign=await store.begin({...plan,options:{...plan.options,agents:["goose","claude"],candidateModels:models}});await store.close();return campaign.output;
 };
 const a=await publish({goose:configured,claude:{...configured,model:"../../résumé/模型"}});
 const b=await publish({claude:{...configured,model:"../../résumé/模型"},goose:configured});
 assert.equal(dirname(a),dirname(b));assert.match(a,/\/model=configured-[0-9a-f]{64}\/campaign=/);
 const c=await publish({claude:configured,goose:{...configured,model:"../../résumé/模型"}});assert.notEqual(dirname(a),dirname(c));
 const d=await publish({goose:{...configured,provider:"other"},claude:{...configured,model:"../../résumé/模型"}});assert.notEqual(dirname(a),dirname(d));
});
// Resolution failures must leave no campaign or registry, even though transport preflight passed.
test("invalid resolver output refuses campaign creation after preflight without mutating input",async()=>{
 const {root,plan,registry}=await setup();let preflights=0;
 const invalid:CandidateHost={...host,preflight:async()=>{preflights++;},resolveModel:async options=>{options.agents.push("codex");return {...configured,provider:""};}};
 await assert.rejects(executeEvaluation(plan,new Map([["goose",invalid]]),new SqliteEvaluationStore(join(root,"proofs"),registry),randomUUID),/candidate model/);
 assert.equal(preflights,1);assert.deepEqual(plan.options.agents,["goose"]);assert.deepEqual(await readdir(root),["skill"]);
});
// Indexed plan corruption cannot be bypassed by explicit retry-uncertain recovery.
test("tampered stored model selection blocks resume before resolver or launch",async()=>{
 const {root,plan,registry}=await setup();const store=new SqliteEvaluationStore(join(root,"proofs"),registry);
 const frozen={...plan,options:{...plan.options,candidateModels:{goose:configured}}};const campaign=await store.begin(frozen);await store.close();
 const db=new Database(registry,{readwrite:true});db.query("UPDATE experiments SET plan_json=? WHERE id=?").run(JSON.stringify({...frozen,options:{...frozen.options,candidateModels:{goose:{...configured,source:"override"}}}}),campaign.id);db.close();
 await assert.rejects(executeEvaluation(undefined,new Map([["goose",{...host,resolveModel:async()=>{throw new Error("must not resolve");},run:async()=>{throw new Error("must not launch");}}]]),new SqliteEvaluationStore("/unused",registry),randomUUID,{id:campaign.id,retryUncertain:true}),/selection mismatch/);
});
