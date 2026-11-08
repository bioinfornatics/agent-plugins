import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { Database } from "../../src/adapters/outbound/storage/sqlite-database.ts";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareEvaluation } from "../../src/application/use-cases/prepare-evaluation.ts";
import { executeEvaluation } from "../../src/application/use-cases/execute-evaluation.ts";
import { FilesystemEvaluationSource } from "../../src/adapters/outbound/filesystem/filesystem-evaluation-source.ts";
import { SqliteEvaluationStore } from "../../src/adapters/outbound/storage/sqlite-evaluation-store.ts";
import { SqliteEvaluationHistory } from "../../src/adapters/outbound/storage/sqlite-evaluation-history.ts";
import { main } from "../../src/main.ts";
import type { CandidateHost } from "../../src/application/ports/candidate-host.ts";
import { createHistoryCommandHandler } from "../../src/adapters/inbound/cli/handle-history-command.ts";

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function workspace(){const root=await mkdtemp(join(tmpdir(),"history-test-"));roots.push(root);return root;}
async function fixture(root:string,name:string){const target=join(root,name);await mkdir(join(target,"evals"),{recursive:true});await writeFile(join(target,"SKILL.md"),"capability");await writeFile(join(target,"evals","evals.json"),JSON.stringify({evals:[{id:1,prompt:"task",expectations:["criterion"]}]}));return prepareEvaluation({skills:[target],plugins:[],profileName:"Same name",agents:["goose"],repetitions:1,maxTurns:5,timeout:0,parallelism:2},new FilesystemEvaluationSource());}
const host:CandidateHost={preflight:async()=>{},run:async r=>({status:"completed",collection:"complete",exitCode:0,sessionName:r.id,host:{id:"goose",version:"fake"},startedAt:"start",finishedAt:"end",limitations:[],artifacts:[{path:"answer.txt",content:Buffer.from("proof")} ]})};
async function cli(args:string[]){let out="",err="";const code=await main(args,{writeOut:s=>{out+=s;},writeErr:s=>{err+=s;}});return {code,out,err};}

test("absent registry lists empty without creating files; inspect unknown is explicit",async()=>{
 const root=await workspace(),registry=join(root,"never-created","db.sqlite");
 assert.deepStrictEqual(await cli(["history","--registry",registry,"--json"]), {code:0,out:"[]\n",err:""});
 assert.strictEqual((await cli(["history","--registry",registry])).out, "No evaluation campaigns found.\n");
 assert.deepStrictEqual(await readdir(root), []);
 await assert.rejects(new SqliteEvaluationHistory(registry).overview(randomUUID()));assert.deepStrictEqual(await readdir(root), []);
 const unknown=await cli(["inspect","missing-id","--registry",registry]);assert.strictEqual(unknown.code, 1);assert.ok((unknown.err).includes("Unknown campaign: missing-id"));
});

test("history distinguishes homonymous profiles, revisions and attempts; missing evidence visible and DB unchanged",async()=>{
 const root=await workspace(),registry=join(root,"registry","db.sqlite");
 const firstPlan=await fixture(root,"first"),secondPlan=await fixture(root,"second");
 const first=await executeEvaluation(firstPlan,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"proofs"),registry),randomUUID);
 await executeEvaluation(secondPlan,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"proofs"),registry),randomUUID);
 await writeFile(join(root,"first","SKILL.md"),"revised capability");
 const revised=await fixtureRevision(root,"first");
 await executeEvaluation(revised,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"proofs"),registry),randomUUID);
 const before=await readFile(registry),filesBefore=await readdir(join(root,"registry"));
 const history=new SqliteEvaluationHistory(registry);
 const all=await history.list();assert.strictEqual((all).length, 3);assert.deepStrictEqual(new Set(all.map(c=>c.profileName)), new Set(["Same name"]));assert.strictEqual(new Set(all.map(c=>c.profileId)).size, 2);
 const filtered=await history.list(firstPlan.profile.id);assert.strictEqual((filtered).length, 2);assert.strictEqual(new Set(filtered.map(c=>c.revision)).size, 2);
 const detail=await history.inspect(first.id);assert.deepStrictEqual(detail.trials.map(t=>t.id), ["trial-1","trial-2"]);assert.strictEqual((detail.attempts).length, 2);assert.strictEqual(detail.score, null);assert.deepStrictEqual(detail.options, firstPlan.options);
 const proof=detail.attempts[0]?.evidence[0];if(!proof)throw Error("Missing proof fixture");assert.strictEqual(proof.available, true);await rm(proof.path);
 const absent=await cli(["inspect",first.id,"--registry",registry]);assert.strictEqual(absent.code, 0);assert.ok((absent.out).includes(`MISSING: ${proof.path}`));
 assert.strictEqual((JSON.parse((await cli(["history","--profile",firstPlan.profile.id,"--registry",registry,"--json"])).out)).length, 2);
 assert.deepStrictEqual(await readFile(registry), before);assert.deepStrictEqual(await readdir(join(root,"registry")), filesBefore);
});
async function fixtureRevision(root:string,name:string){return prepareEvaluation({skills:[join(root,name)],plugins:[],profileName:"Same name",agents:["goose"],repetitions:1,maxTurns:5,timeout:0,parallelism:2},new FilesystemEvaluationSource());}

test("inspection preserves prior uncertain attempts after authorized retry",async()=>{
 const root=await workspace(),registry=join(root,"registry","db.sqlite"),plan=await fixture(root,"sample");
 const initial=new SqliteEvaluationStore(join(root,"proofs"),registry),campaign=await initial.begin(plan);
 const trial=plan.trials[0],scenario=plan.profile.scenarios[0];if(!trial||!scenario)throw Error("Missing plan");
 await initial.start({id:randomUUID(),trialId:trial.id,pairId:trial.pairId,agent:trial.agent,condition:trial.condition,profile:plan.profile,scenario,options:plan.options});await initial.close();
 await executeEvaluation(undefined,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"proofs"),registry),randomUUID,{id:campaign.id,retryUncertain:true});
 const detail=await new SqliteEvaluationHistory(registry).inspect(campaign.id);assert.strictEqual((detail.trials).length, 2);assert.strictEqual((detail.attempts).length, 3);assert.strictEqual((detail.attempts.filter(a=>a.status==="interrupted")).length, 1);
});

test("consultation refuses unsupported schema without migrating or leaking raw database errors",async()=>{
 const root=await workspace(),registry=join(root,"legacy.sqlite");const db=new Database(registry);db.exec("CREATE TABLE old_data(value TEXT); PRAGMA user_version=1;");db.close();const before=await readFile(registry);
 const result=await cli(["history","--registry",registry]);assert.strictEqual(result.code, 1);assert.ok((result.err).includes("consultation does not migrate"));assert.deepStrictEqual(await readFile(registry), before);
 let out="";const handler=createHistoryCommandHandler({writeOut:s=>{out+=s;},writeErr:()=>{}},()=>({list:async()=>{throw Error("secret-db-diagnostic");},inspect:async()=>{throw Error("Unexpected inspect");}}));
 await assert.rejects(handler({json:true}), /no raw database diagnostics/);assert.strictEqual(out, "");
});


test("narrow overview reads all frozen planned trials and process statuses, no archives or live sources", async () => {
 const root=await workspace(),registry=join(root,"registry","db.sqlite"),plan=await fixture(root,"all-statuses");
 plan.options.repetitions=3;
 const { buildMatrix } = await import("../../src/domain/evaluation.ts");
 const matrix=buildMatrix(plan.profile,plan.options),store=new SqliteEvaluationStore(join(root,"proofs"),registry),campaign=await store.begin(matrix);
 for (let i=0;i<5;i++) {
   const trial=matrix.trials[i],scenario=matrix.profile.scenarios[0];if(!trial||!scenario)throw Error("fixture");
   const request={id:randomUUID(),trialId:trial.id,pairId:trial.pairId,agent:trial.agent,condition:trial.condition,profile:matrix.profile,scenario,options:matrix.options};
   await store.start(request);
   if(i<3) { const result=await host.run(request);await store.finish(request,{...result,status:(["completed","nonzero","timeout"] as const)[i] ?? "completed"}); }
   else if(i===3) await store.fail(request);
 }
 await store.close();
 await rm(join(root,"all-statuses"),{recursive:true,force:true});await rm(join(root,"proofs"),{recursive:true,force:true});
 const before=await readFile(registry),history=new SqliteEvaluationHistory(registry),overview=await history.overview(campaign.id);
 assert.deepEqual(overview.trials.map(t=>[t.sequence,t.trialId,t.status,t.attemptStatus]),[[0,"trial-1","finalized","completed"],[1,"trial-2","finalized","nonzero"],[2,"trial-3","finalized","timeout"],[3,"trial-4","uncertain","interrupted"],[4,"trial-5","running","running"],[5,"trial-6","pending",null]]);
 assert.equal(overview.trials[5]?.attemptId,null);assert.deepEqual(overview.trials.map(t=>t.source),Array.from({length:6},()=>({skillName:"all-statuses"})));
 assert.deepEqual(overview.profile,{id:plan.profile.id,name:plan.profile.name,revision:plan.profile.revision});
 assert.deepEqual(await readFile(registry),before);
 for(const [sql,restore] of [["UPDATE planned_trials SET sequence=99 WHERE sequence=5", "UPDATE planned_trials SET sequence=5 WHERE sequence=99"], ["UPDATE planned_trials SET attempt_id='missing' WHERE sequence=0", ""], ["UPDATE experiments SET plan_json='{}'", ""]] as const) {
   const db=new Database(registry);const saved=db.query<{attempt_id:string},[]>("SELECT attempt_id FROM planned_trials WHERE sequence=0").get()?.attempt_id;
   db.exec(sql);db.close();const invalid=await readFile(registry);
   await assert.rejects(history.overview(campaign.id),/invalid frozen plan or logical bindings/);assert.deepEqual(await readFile(registry),invalid);
   const reset=new Database(registry);if(restore)reset.exec(restore);else if(sql.includes("attempt_id"))reset.query("UPDATE planned_trials SET attempt_id=? WHERE sequence=0").run(saved ?? "");reset.close();
 }
});
