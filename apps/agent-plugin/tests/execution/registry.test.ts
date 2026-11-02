import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteEvaluationStore } from "../../src/adapters/outbound/storage/sqlite-evaluation-store.ts";
import { resolveEvaluationLocations } from "../../src/adapters/outbound/storage/evaluation-locations.ts";
import { FilesystemEvaluationSource } from "../../src/adapters/outbound/filesystem/filesystem-evaluation-source.ts";
import { prepareEvaluation } from "../../src/application/use-cases/prepare-evaluation.ts";
import { executeEvaluation } from "../../src/application/use-cases/execute-evaluation.ts";
import type { CandidateHost } from "../../src/application/ports/candidate-host.ts";
import { main } from "../../src/main.ts";

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function setup() {
 const root=await mkdtemp(join(tmpdir(),"registry-test-"));roots.push(root);
 const target=join(root,"skill");await mkdir(join(target,"evals"),{recursive:true});
 await writeFile(join(target,"SKILL.md"),"capability");
 await writeFile(join(target,"evals","evals.json"),JSON.stringify({evals:[{id:1,prompt:"task",expectations:["criterion"]}]}));
 const plan=await prepareEvaluation({skills:[target],plugins:[],agents:["goose"],repetitions:1,maxTurns:5,timeout:0,parallelism:3},new FilesystemEvaluationSource());
 return {root,target,plan,registry:join(root,"registry","evaluations.sqlite")};
}
const host:CandidateHost={preflight:async()=>{},run:async r=>({status:"completed",exitCode:0,sessionName:r.id,collection:"complete",startedAt:"start",finishedAt:"end",host:{id:"goose",version:"fake"},artifacts:[{path:"logs/output.txt",content:Buffer.from("result")}],limitations:[]})};

test("shared registry reuses immutable revision across campaigns with separate evidence and scoped pairs",async()=>{
 const {root,plan,registry}=await setup();
 const first=await executeEvaluation(plan,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"first"),registry));
 const second=await executeEvaluation({...plan,profile:{...plan.profile,name:"renamed"}},new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"second"),registry));
 expect(first.id).not.toBe(second.id);expect(first.registry).toBe(second.registry);
 expect(await readdir(first.output)).toEqual(["artifacts"]);
 const db=new Database(registry,{readonly:true});
 expect(db.query("SELECT count(*) AS n FROM profiles").get()).toEqual({n:1});
 expect(db.query("SELECT count(*) AS n FROM profile_revisions").get()).toEqual({n:1});
 expect(db.query("SELECT name FROM profiles").get()).toEqual({name:"renamed"});
 expect(db.query("SELECT status FROM experiments").all()).toEqual([{status:"completed"},{status:"completed"}]);
 expect(db.query("SELECT count(*) AS n FROM trials").get()).toEqual({n:4});
 expect(db.query("SELECT count(DISTINCT campaign_id) AS n FROM artifacts").get()).toEqual({n:2});
 expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);db.close();
 const firstTrial=`${first.id}-1`;
 expect(await readFile(join(first.output,"artifacts",firstTrial,"logs/output.txt"),"utf8")).toBe("result");
});

test("storage failure stops admission and records interruption rather than completed campaign",async()=>{
 const {root,plan,registry}=await setup();let runs=0;
 const unsafe:CandidateHost={...host,run:async r=>{runs++;return {...await host.run(r),artifacts:[{path:"../escape",content:Buffer.from("bad")}]};}};
 await expect(executeEvaluation(plan,new Map([["goose",unsafe]]),new SqliteEvaluationStore(join(root,"proofs"),registry))).rejects.toThrow("Unsafe artifact path");
 expect(runs).toBe(1);
 const db=new Database(registry,{readonly:true});
 expect(db.query("SELECT status FROM experiments").get()).toEqual({status:"interrupted"});
 expect(db.query("SELECT status FROM trials").get()).toEqual({status:"running"});
 expect(db.query("SELECT count(*) AS n FROM artifacts").get()).toEqual({n:0});db.close();
});

test("XDG resolution ignores relative values, honors overrides and dry-run never writes registry",async()=>{
 expect(resolveEvaluationLocations(undefined,undefined,{HOME:"/home/example",XDG_DATA_HOME:"relative"})).toEqual({registry:"/home/example/.local/share/agent-plugin/evaluations.sqlite",output:"/home/example/.local/share/agent-plugin/campaigns"});
 expect(resolveEvaluationLocations(undefined,undefined,{XDG_DATA_HOME:"/data"})).toEqual({registry:"/data/agent-plugin/evaluations.sqlite",output:"/data/agent-plugin/campaigns"});
 const {root,target,registry}=await setup();
 expect(resolveEvaluationLocations(registry,undefined,{HOME:"/unused"}).output).toBe(join(root,"registry","campaigns"));
 let out="",err="";
 expect(await main(["evaluation","--skills",target,"--registry",registry,"--dry-run"],{writeOut:s=>{out+=s;},writeErr:s=>{err+=s;}})).toBe(0);
 expect(JSON.parse(out).profile.components).toHaveLength(1);expect(err).toBe("");
 expect(await readdir(root)).toEqual(["skill"]);
});

test("unversioned historic registry is rejected without changing its bytes",async()=>{
 const {root,plan,registry}=await setup();await mkdir(join(root,"registry"),{mode:0o700});
 const legacy=new Database(registry);legacy.exec("CREATE TABLE experiments(id TEXT)");legacy.close();await chmod(registry,0o600);
 const before=await readFile(registry);
 await expect(new SqliteEvaluationStore(join(root,"proofs"),registry).begin(plan)).rejects.toThrow("explicit migration");
 expect(await readFile(registry)).toEqual(before);
});

test("independent CLI processes append campaigns to the same registry without collisions",async()=>{
 const {root,target,registry}=await setup();
 const child=join(root,"append.ts");
 const sourceUrl=new URL("../../src/adapters/outbound/filesystem/filesystem-evaluation-source.ts",import.meta.url).href;
 const prepareUrl=new URL("../../src/application/use-cases/prepare-evaluation.ts",import.meta.url).href;
 const storeUrl=new URL("../../src/adapters/outbound/storage/sqlite-evaluation-store.ts",import.meta.url).href;
 await writeFile(child,`import {FilesystemEvaluationSource} from ${JSON.stringify(sourceUrl)};import {prepareEvaluation} from ${JSON.stringify(prepareUrl)};import {SqliteEvaluationStore} from ${JSON.stringify(storeUrl)};
const p=await prepareEvaluation({skills:[process.argv[2]],plugins:[],agents:["goose"],repetitions:1,maxTurns:5,timeout:0,parallelism:3},new FilesystemEvaluationSource());const s=new SqliteEvaluationStore(process.argv[3],process.argv[4]);await s.begin(p);await s.close();`);
 const children=[1,2].map(i=>Bun.spawn([process.execPath,child,target,join(root,`proofs-${i}`),registry],{stdout:"pipe",stderr:"pipe"}));
 for(const childProcess of children){const stderr=await new Response(childProcess.stderr).text();expect(await childProcess.exited,stderr).toBe(0);}
 const db=new Database(registry,{readonly:true});
 expect(db.query("SELECT count(*) AS n FROM experiments").get()).toEqual({n:2});
 expect(db.query("PRAGMA integrity_check").get()).toEqual({integrity_check:"ok"});db.close();
});


test("relocating identical fixture bytes preserves content revision without rejecting later campaign provenance",async()=>{
 const {root,target,registry}=await setup();
 for(const name of ["fixtures-a","fixtures-b"]) {await mkdir(join(root,name));await writeFile(join(root,name,"input.txt"),"same bytes");}
 const input={skills:[target],plugins:[],agents:["goose"],repetitions:1,maxTurns:5,timeout:0,parallelism:3};
 const plans=[];
 for(const name of ["fixtures-a","fixtures-b"]) {
  await writeFile(join(target,"evals","evals.json"),JSON.stringify({evals:[{id:1,prompt:"task",expectations:["criterion"],fixtures:join(root,name)}]}));
  const plan=await prepareEvaluation(input,new FilesystemEvaluationSource());plans.push(plan);
  await executeEvaluation(plan,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"proofs"),registry));
 }
 expect(plans[0]?.profile.id).toBe(plans[1]?.profile.id);expect(plans[0]?.profile.revision).toBe(plans[1]?.profile.revision);
 const db=new Database(registry,{readonly:true});
 expect(db.query("SELECT count(*) AS n FROM profile_revisions").get()).toEqual({n:1});
 const rows=db.query("SELECT plan_json FROM experiments ORDER BY created_at").all() as {plan_json:string}[];
 expect(rows.map(r=>JSON.parse(r.plan_json).profile.scenarios[0].fixtures)).toEqual([join(root,"fixtures-a"),join(root,"fixtures-b")]);db.close();
});
