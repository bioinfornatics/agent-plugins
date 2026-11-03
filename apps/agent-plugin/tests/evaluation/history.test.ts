import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
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
 expect(await cli(["history","--registry",registry,"--json"])).toEqual({code:0,out:"[]\n",err:""});
 expect((await cli(["history","--registry",registry])).out).toBe("No evaluation campaigns found.\n");
 expect(await readdir(root)).toEqual([]);
 const unknown=await cli(["inspect","missing-id","--registry",registry]);expect(unknown.code).toBe(1);expect(unknown.err).toContain("Unknown campaign: missing-id");
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
 const all=await history.list();expect(all).toHaveLength(3);expect(new Set(all.map(c=>c.profileName))).toEqual(new Set(["Same name"]));expect(new Set(all.map(c=>c.profileId)).size).toBe(2);
 const filtered=await history.list(firstPlan.profile.id);expect(filtered).toHaveLength(2);expect(new Set(filtered.map(c=>c.revision)).size).toBe(2);
 const detail=await history.inspect(first.id);expect(detail.trials.map(t=>t.id)).toEqual(["trial-1","trial-2"]);expect(detail.attempts).toHaveLength(2);expect(detail.score).toBeNull();expect(detail.options).toEqual(firstPlan.options);
 const proof=detail.attempts[0]?.evidence[0];if(!proof)throw Error("Missing proof fixture");expect(proof.available).toBe(true);await rm(proof.path);
 const absent=await cli(["inspect",first.id,"--registry",registry]);expect(absent.code).toBe(0);expect(absent.out).toContain(`MISSING: ${proof.path}`);
 expect(JSON.parse((await cli(["history","--profile",firstPlan.profile.id,"--registry",registry,"--json"])).out)).toHaveLength(2);
 expect(await readFile(registry)).toEqual(before);expect(await readdir(join(root,"registry"))).toEqual(filesBefore);
});
async function fixtureRevision(root:string,name:string){return prepareEvaluation({skills:[join(root,name)],plugins:[],profileName:"Same name",agents:["goose"],repetitions:1,maxTurns:5,timeout:0,parallelism:2},new FilesystemEvaluationSource());}

test("inspection preserves prior uncertain attempts after authorized retry",async()=>{
 const root=await workspace(),registry=join(root,"registry","db.sqlite"),plan=await fixture(root,"sample");
 const initial=new SqliteEvaluationStore(join(root,"proofs"),registry),campaign=await initial.begin(plan);
 const trial=plan.trials[0],scenario=plan.profile.scenarios[0];if(!trial||!scenario)throw Error("Missing plan");
 await initial.start({id:randomUUID(),trialId:trial.id,pairId:trial.pairId,agent:trial.agent,condition:trial.condition,profile:plan.profile,scenario,options:plan.options});await initial.close();
 await executeEvaluation(undefined,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"proofs"),registry),randomUUID,{id:campaign.id,retryUncertain:true});
 const detail=await new SqliteEvaluationHistory(registry).inspect(campaign.id);expect(detail.trials).toHaveLength(2);expect(detail.attempts).toHaveLength(3);expect(detail.attempts.filter(a=>a.status==="interrupted")).toHaveLength(1);
});

test("consultation refuses unsupported schema without migrating or leaking raw database errors",async()=>{
 const root=await workspace(),registry=join(root,"legacy.sqlite");const db=new Database(registry);db.exec("CREATE TABLE old_data(value TEXT); PRAGMA user_version=1;");db.close();const before=await readFile(registry);
 const result=await cli(["history","--registry",registry]);expect(result.code).toBe(1);expect(result.err).toContain("consultation does not migrate");expect(await readFile(registry)).toEqual(before);
 let out="";const handler=createHistoryCommandHandler({writeOut:s=>{out+=s;},writeErr:()=>{}},()=>({list:async()=>{throw Error("secret-db-diagnostic");},inspect:async()=>{throw Error("Unexpected inspect");}}));
 await expect(handler({json:true})).rejects.toThrow("no raw database diagnostics");expect(out).toBe("");
});
