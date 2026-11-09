import { publishCampaignDirectory } from "../../src/adapters/outbound/storage/campaign-layout.ts";
import { createApplication } from "../../src/composition-root.ts";
import { GooseHost } from "../../src/adapters/outbound/hosts/goose/goose-host.ts";
import { startNodeProcess } from "../helpers/subprocess.ts";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { Database } from "../../src/adapters/outbound/storage/sqlite-database.ts";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile, lstat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteEvaluationHistory } from "../../src/adapters/outbound/storage/sqlite-evaluation-history.ts";
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
 const first=await executeEvaluation(plan,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"first"),registry),randomUUID);
 const second=await executeEvaluation({...plan,profile:{...plan.profile,name:"renamed"}},new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"second"),registry),randomUUID);
 assert.notStrictEqual(first.id, second.id);assert.strictEqual(first.registry, second.registry);
 assert.deepStrictEqual(await readdir(first.output), ["artifacts"]);
 const db=new Database(registry,{readonly:true});
 assert.deepStrictEqual(db.query("SELECT count(*) AS n FROM profiles").get(), {n:1});
 assert.deepStrictEqual(db.query("SELECT count(*) AS n FROM profile_revisions").get(), {n:1});
 assert.deepStrictEqual(db.query("SELECT name FROM profiles").get(), {name:"renamed"});
 assert.deepStrictEqual(db.query("SELECT status FROM experiments").all(), [{status:"completed"},{status:"completed"}]);
 assert.deepStrictEqual(db.query("SELECT count(*) AS n FROM trials").get(), {n:4});
 assert.deepStrictEqual(db.query("SELECT count(DISTINCT campaign_id) AS n FROM artifacts").get(), {n:2});
 assert.deepStrictEqual(db.query("PRAGMA foreign_key_check").all(), []);db.close();
 const firstTrial=(await readdir(join(first.output,"artifacts")))[0];
 if (!firstTrial) throw new Error("Missing attempt proof");
 assert.strictEqual(await readFile(join(first.output,"artifacts",firstTrial,"logs/output.txt"),"utf8"), "result");
});

test("storage failure stops admission and records interruption rather than completed campaign",async()=>{
 const {root,plan,registry}=await setup();let runs=0;
 const unsafe:CandidateHost={...host,run:async r=>{runs++;return {...await host.run(r),artifacts:[{path:"../escape",content:Buffer.from("bad")}]};}};
 await assert.rejects(executeEvaluation(plan,new Map([["goose",unsafe]]),new SqliteEvaluationStore(join(root,"proofs"),registry),randomUUID), /Unsafe artifact path/);
 assert.strictEqual(runs, 2);
 const db=new Database(registry,{readonly:true});
 assert.deepStrictEqual(db.query("SELECT status FROM experiments").get(), {status:"interrupted"});
 assert.deepStrictEqual(db.query("SELECT status FROM trials").all(), [{status:"running"},{status:"running"}]);
 assert.deepStrictEqual(db.query("SELECT count(*) AS n FROM artifacts").get(), {n:0});db.close();
});

test("XDG resolution ignores relative values, honors overrides and dry-run never writes registry",async()=>{
 assert.deepStrictEqual(resolveEvaluationLocations(undefined,undefined,{HOME:"/home/example",XDG_DATA_HOME:"relative"}), {registry:"/home/example/.local/share/agent-plugin/evaluations.sqlite",output:"/home/example/.local/share/agent-plugin/campaigns"});
 assert.deepStrictEqual(resolveEvaluationLocations(undefined,undefined,{XDG_DATA_HOME:"/data"}), {registry:"/data/agent-plugin/evaluations.sqlite",output:"/data/agent-plugin/campaigns"});
 const {root,target,registry}=await setup();
 assert.strictEqual(resolveEvaluationLocations(registry,undefined,{HOME:"/unused"}).output, join(root,"registry","campaigns"));
 let out="",err="";
 assert.strictEqual(await main(["evaluation","--skills",target,"--registry",registry,"--dry-run"],{writeOut:s=>{out+=s;},writeErr:s=>{err+=s;}}), 0);
 assert.strictEqual((JSON.parse(out).profile.components).length, 1);assert.strictEqual(err, "");
 assert.deepStrictEqual(await readdir(root), ["skill"]);
});

test("unversioned historic registry is rejected without changing its bytes",async()=>{
 const {root,plan,registry}=await setup();await mkdir(join(root,"registry"),{mode:0o700});
 const legacy=new Database(registry);legacy.exec("CREATE TABLE experiments(id TEXT)");legacy.close();await chmod(registry,0o600);
 const before=await readFile(registry);
 await assert.rejects(new SqliteEvaluationStore(join(root,"proofs"),registry).begin(plan), /explicit migration/);
 assert.deepStrictEqual(await readFile(registry), before);
});

test("independent CLI processes append campaigns to the same registry without collisions",async()=>{
 const {root,target,registry}=await setup();
 const child=join(root,"append.ts");
 const sourceUrl=new URL("../../src/adapters/outbound/filesystem/filesystem-evaluation-source.ts",import.meta.url).href;
 const prepareUrl=new URL("../../src/application/use-cases/prepare-evaluation.ts",import.meta.url).href;
 const storeUrl=new URL("../../src/adapters/outbound/storage/sqlite-evaluation-store.ts",import.meta.url).href;
 await writeFile(child,`import {FilesystemEvaluationSource} from ${JSON.stringify(sourceUrl)};import {prepareEvaluation} from ${JSON.stringify(prepareUrl)};import {SqliteEvaluationStore} from ${JSON.stringify(storeUrl)};
const p=await prepareEvaluation({skills:[process.argv[2]],plugins:[],agents:["goose"],repetitions:1,maxTurns:5,timeout:0,parallelism:3},new FilesystemEvaluationSource());const s=new SqliteEvaluationStore(process.argv[3],process.argv[4]);await s.begin(p);await s.close();`);
 const children=[1,2].map(i=>startNodeProcess([child,target,join(root,`proofs-${i}`),registry]));
 for(const childProcess of children){const {exitCode,signal,stderr}=await childProcess.completed;assert.strictEqual(signal,null,stderr);assert.strictEqual(exitCode, 0, stderr);}
 const db=new Database(registry,{readonly:true});
 assert.deepStrictEqual(db.query("SELECT count(*) AS n FROM experiments").get(), {n:2});
 assert.deepStrictEqual(db.query("PRAGMA integrity_check").get(), {integrity_check:"ok"});db.close();
});


test("relocating identical fixture bytes preserves content revision without rejecting later campaign provenance",async()=>{
 const {root,target,registry}=await setup();
 for(const name of ["fixtures-a","fixtures-b"]) {await mkdir(join(root,name));await writeFile(join(root,name,"input.txt"),"same bytes");}
 const input={skills:[target],plugins:[],agents:["goose"],repetitions:1,maxTurns:5,timeout:0,parallelism:3};
 const plans=[];
 for(const name of ["fixtures-a","fixtures-b"]) {
  await writeFile(join(target,"evals","evals.json"),JSON.stringify({evals:[{id:1,prompt:"task",expectations:["criterion"],fixtures:join(root,name)}]}));
  const plan=await prepareEvaluation(input,new FilesystemEvaluationSource());plans.push(plan);
  await executeEvaluation(plan,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"proofs"),registry),randomUUID);
 }
 assert.strictEqual(plans[0]?.profile.id, plans[1]?.profile.id);assert.strictEqual(plans[0]?.profile.revision, plans[1]?.profile.revision);
 const db=new Database(registry,{readonly:true});
 assert.deepStrictEqual(db.query("SELECT count(*) AS n FROM profile_revisions").get(), {n:1});
 const rows=db.query("SELECT plan_json FROM experiments ORDER BY created_at").all() as {plan_json:string}[];
 assert.deepStrictEqual(rows.map(r=>JSON.parse(r.plan_json).profile.scenarios[0].fixtures), [join(root,"fixtures-a"),join(root,"fixtures-b")]);db.close();
});

// Detects silently retaining flat paths, conflating default/requested models, or unsafe raw model segments.
test("Hive campaigns group by profile and exact requested model while publishing private immutable metadata",async()=>{
 const {root,plan,registry}=await setup();const destination=join(root,"registry","campaigns");
 const models=[undefined,undefined,"default","../模型/é\\model","../模型/e\u0301\\model",""];
 // Fixed independent vectors bind UTF-8 bytes, field order/version and full SHA-256 (no normalization).
 const modelKeys=["default","default","requested-02235921a822ff444892f20b066eb6a06c7bbca6626c8afee0941af2022c9175","requested-7eddd7d81d6bb558d713c4eb5fe957836e61a2171696a79ef26236d96297b947","requested-5bb0624adcfbb302ed875b3149cd5fd7d5cb1ffdfec14e3d231a5d691d7b3b59","requested-31b44d1a7aea924f813aacc4350e6601ccb968dbdf65b968ec06a7f51004023d"];
 const campaigns=[];
 for(const [index,model] of models.entries()){
  const requested={...plan,profile:{...plan.profile,name:index===1?"renamed":plan.profile.name},options:{...plan.options,model}};
  const store=new SqliteEvaluationStore(destination,registry,"hive");
  const campaign=await store.begin(requested);campaigns.push(campaign);await store.close();
  const modelKey=modelKeys[index];
  assert.strictEqual(campaign.output,join(destination,`profile=${plan.profile.id}`,`model=${modelKey}`,`campaign=${campaign.id}`));
  const metadata=join(campaign.output,"campaign.json");
  assert.deepStrictEqual(JSON.parse(await readFile(metadata,"utf8")),{version:1,campaignId:campaign.id,profileId:plan.profile.id,revision:plan.profile.revision,requestedModel:model===undefined?{kind:"default"}:{kind:"requested",model},agents:plan.options.agents});
  assert.strictEqual((await lstat(metadata)).mode&0o777,0o600);
  for(const dir of [destination,join(destination,`profile=${plan.profile.id}`),join(destination,`profile=${plan.profile.id}`,`model=${modelKey}`),campaign.output])assert.strictEqual((await lstat(dir)).mode&0o777,0o700);
 }
 assert.notStrictEqual(campaigns[0]?.id,campaigns[1]?.id);
 assert.strictEqual((await readdir(join(destination,`profile=${plan.profile.id}`))).length,5);
 const history=await new SqliteEvaluationHistory(registry).list();
 assert.deepStrictEqual(history.map(c=>c.output).sort(),campaigns.map(c=>c.output).sort());
 const db=new Database(registry,{readonly:true});assert.deepStrictEqual(db.query("PRAGMA user_version").get(),{user_version:2});db.close();
});

// Detects --output incorrectly switching layout instead of changing only the evidence root.
test("CLI composition always uses Hive and output overrides only the evidence root",async()=>{
 const {root,target,registry}=await setup();
 const preflight=GooseHost.prototype.preflight,run=GooseHost.prototype.run,resolveModel=GooseHost.prototype.resolveModel;
 GooseHost.prototype.preflight=host.preflight;
 GooseHost.prototype.resolveModel=async()=>({source:"configuration-default",provider:"fake",model:"t1"});
 GooseHost.prototype.run=async r=>{const configured=r.options.candidateModels?.goose;assert.ok(configured);return {...await host.run(r),model:{configured,observed:{provider:"fake",model:"t1"}}};};
 try {
  for(const explicit of [false,true]){
   let out="";const cli=createApplication({writeOut:s=>{out+=s;},writeErr:()=>{}});
   const args=["evaluation","--skills",target,"--registry",registry,"--quiet","--repetitions","1"];
   if(explicit)args.push("--output",join(root,"explicit"));
   await cli.parseAsync(args,{from:"user"});const campaign=JSON.parse(out);
   const base=explicit?join(root,"explicit"):join(root,"registry","campaigns");
   assert.strictEqual(campaign.registry,registry);
   assert.match(campaign.output.slice(base.length),/^\/profile=[0-9a-f]{64}\/model=configured-[0-9a-f]{64}\/campaign=[0-9a-f-]{36}$/);
   assert.deepStrictEqual(await readdir(campaign.output),["artifacts","campaign.json"]);
  }
 }finally{GooseHost.prototype.preflight=preflight;GooseHost.prototype.run=run;GooseHost.prototype.resolveModel=resolveModel;}
});

test("Hive rejects unsafe existing levels without repairing modes or inserting a campaign",async()=>{
 for(const level of [0,1,2])for(const unsafe of ["mode","link"]){
  const {root,plan,registry}=await setup();const destination=join(root,"campaigns");
  await chmod(root,0o755); // Shared non-Hive ancestor must never be chmodded by publication.
  const levels=[destination,join(destination,`profile=${plan.profile.id}`),join(destination,`profile=${plan.profile.id}`,"model=default")];
  for(const directory of levels.slice(0,level))await mkdir(directory,{mode:0o700});
  const bad=levels[level];if(!bad)throw new Error("Missing level");
  if(unsafe==="mode"){await mkdir(bad,{mode:0o700});await chmod(bad,0o755);}
  else{const outside=join(root,"outside");await mkdir(outside,{mode:0o700});await symlink(outside,bad);}
  await assert.rejects(new SqliteEvaluationStore(destination,registry,"hive").begin(plan),/mode 700|links or special files/);
  assert.strictEqual((await lstat(root)).mode&0o777,0o755);
  const info=await lstat(bad);if(unsafe==="mode")assert.strictEqual(info.mode&0o777,0o755);else{assert.strictEqual(info.isSymbolicLink(),true);assert.deepStrictEqual(await readdir(join(root,"outside")),[]);}
  const db=new Database(registry,{readonly:true});assert.deepStrictEqual(db.query("SELECT count(*) AS n FROM experiments").get(),{n:0});db.close();
 }
});

test("Hive publication validates segments and never replaces existing metadata",async()=>{
 const {root,plan}=await setup();const id=randomUUID(),destination=join(root,"campaigns");
 for(const bad of ["../escape","a".repeat(63),"A".repeat(64)])await assert.rejects(publishCampaignDirectory(destination,id,{...plan,profile:{...plan.profile,id:bad}},"hive"),/profile id/);
 await assert.rejects(publishCampaignDirectory(destination,"../escape",plan,"hive"),/campaign id/);
 assert.deepStrictEqual(await readdir(root),["skill"]);
 const output=await publishCampaignDirectory(destination,id,plan,"hive"),metadata=join(output,"campaign.json"),before=await readFile(metadata);
 await assert.rejects(publishCampaignDirectory(destination,id,{...plan,options:{...plan.options,agents:["claude"]}},"hive"),{code:"EEXIST"});assert.deepStrictEqual(await readFile(metadata),before);
});

test("resume and inspect use frozen DB locations for legacy and Hive evidence, never metadata authority",async()=>{
 const {root,plan,registry,target}=await setup();const destination=join(root,"campaigns");
 const legacy=await executeEvaluation(plan,new Map([["goose",host]]),new SqliteEvaluationStore(destination,registry),randomUUID);
 const hive=await executeEvaluation(plan,new Map([["goose",host]]),new SqliteEvaluationStore(destination,registry,"hive"),randomUUID);
 await rm(target,{recursive:true,force:true});
 await writeFile(join(hive.output,"campaign.json"),JSON.stringify({output:"/untrusted",requestedModel:{kind:"requested",model:"wrong"}}));
 const paths=await readdir(destination);const history=new SqliteEvaluationHistory(registry);
 for(const campaign of [legacy,hive]){
  const store=new SqliteEvaluationStore(join(root,"must-not-create"),registry,"hive");const resumed=await store.resume(campaign.id,false);await store.close();
  assert.strictEqual(resumed.campaign.output,campaign.output);assert.deepStrictEqual(resumed.plan,plan);assert.deepStrictEqual(resumed.pending,[]);
  const inspection=await history.inspect(campaign.id);assert.strictEqual(inspection.output,campaign.output);assert.strictEqual(inspection.attempts.every(a=>a.evidence.every(e=>e.available)),true);
 }
 await rm(join(hive.output,"campaign.json"));
 const restored=new SqliteEvaluationStore(destination,registry);assert.strictEqual((await restored.resume(hive.id,false)).campaign.output,hive.output);await restored.close();
 assert.deepStrictEqual(await readdir(hive.output),["artifacts"]);assert.deepStrictEqual(await readdir(destination),paths);
 assert.deepStrictEqual((await readdir(root)).sort(),["campaigns","registry"]);
});

// Detects grouping by a revision/name instead of the existing identity, or conflating different profiles.
test("Hive keeps changed content revisions under one identity and separates a different profile",async()=>{
 const {root,target,plan,registry}=await setup();const destination=join(root,"campaigns");
 const first=new SqliteEvaluationStore(destination,registry,"hive"),a=await first.begin(plan);await first.close();
 await writeFile(join(target,"SKILL.md"),"changed capability");
 const input={skills:[target],plugins:[],agents:["goose","claude"],profileName:"renamed",repetitions:1,maxTurns:5,timeout:0,parallelism:3};
 const revision=await prepareEvaluation(input,new FilesystemEvaluationSource());
 assert.strictEqual(revision.profile.id,plan.profile.id);assert.notStrictEqual(revision.profile.revision,plan.profile.revision);
 const second=new SqliteEvaluationStore(destination,registry,"hive"),b=await second.begin(revision);await second.close();
 assert.strictEqual(b.output,join(destination,`profile=${plan.profile.id}`,"model=default",`campaign=${b.id}`));assert.notStrictEqual(a.output,b.output);
 const metadata=JSON.parse(await readFile(join(b.output,"campaign.json"),"utf8"));assert.strictEqual(metadata.revision,revision.profile.revision);assert.deepStrictEqual(metadata.agents,["goose","claude"]);
 const other=join(root,"other");await mkdir(join(other,"evals"),{recursive:true});await writeFile(join(other,"SKILL.md"),"other capability");await writeFile(join(other,"evals","evals.json"),await readFile(join(target,"evals","evals.json")));
 const different=await prepareEvaluation({...input,skills:[other]},new FilesystemEvaluationSource());assert.notStrictEqual(different.profile.id,plan.profile.id);
 const third=new SqliteEvaluationStore(destination,registry,"hive"),c=await third.begin(different);await third.close();
 assert.strictEqual(c.output,join(destination,`profile=${different.profile.id}`,"model=default",`campaign=${c.id}`));assert.deepStrictEqual((await readdir(destination)).sort(),[`profile=${plan.profile.id}`,`profile=${different.profile.id}`].sort());
});
