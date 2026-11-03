import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemEvaluationSource } from "../../src/adapters/outbound/filesystem/filesystem-evaluation-source.ts";
import { SqliteEvaluationStore } from "../../src/adapters/outbound/storage/sqlite-evaluation-store.ts";
import { prepareEvaluation } from "../../src/application/use-cases/prepare-evaluation.ts";
import { executeEvaluation } from "../../src/application/use-cases/execute-evaluation.ts";
import type { TrialRequest, TrialResult } from "../../src/domain/execution.ts";
import type { CandidateHost } from "../../src/application/ports/candidate-host.ts";
import { createCli } from "../../src/adapters/inbound/cli/create-cli.ts";

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function setup(repetitions=1) {
 const root=await mkdtemp(join(tmpdir(),"resume-test-"));roots.push(root);
 const target=join(root,"skill");await mkdir(join(target,"evals"),{recursive:true});
 await writeFile(join(target,"SKILL.md"),"captured capability");
 await writeFile(join(target,"evals","evals.json"),JSON.stringify({evals:[{id:1,prompt:"task",expectations:["criterion"]}]}));
 const plan=await prepareEvaluation({skills:[target],plugins:[],agents:["goose"],repetitions,maxTurns:5,timeout:0,parallelism:2},new FilesystemEvaluationSource());
 const registry=join(root,"registry","evaluation.sqlite");
 const store=()=>new SqliteEvaluationStore(join(root,"proofs"),registry);
 return {root,target,plan,registry,store};
}
function request(plan:Awaited<ReturnType<typeof prepareEvaluation>>,index:number):TrialRequest {
 const trial=plan.trials[index],scenario=plan.profile.scenarios[0];if(!trial||!scenario)throw Error("Missing fixture");
 return {id:randomUUID(),trialId:trial.id,pairId:trial.pairId,agent:trial.agent,condition:trial.condition,profile:plan.profile,scenario,options:plan.options};
}
function result(r:TrialRequest):TrialResult {return {status:"completed",collection:"complete",exitCode:0,sessionName:r.id,host:{id:"goose",version:"fake"},startedAt:"start",finishedAt:"end",limitations:[],artifacts:[{path:"output.txt",content:Buffer.from("proof")} ]};}

test("resume skips finalized trials and requires explicit authorization to replace uncertain attempts",async()=>{
 const {plan,registry,store,target}=await setup();const first=store(),campaign=await first.begin(plan);
 const finalized=request(plan,0);await first.start(finalized);await first.finish(finalized,result(finalized));
 const uncertain=request(plan,1);await first.start(uncertain);await first.close();
 await rm(target,{recursive:true,force:true});
 await expect(store().resume(campaign.id,false)).rejects.toThrow("--retry-uncertain");
 let calls=0;
 const host:CandidateHost={preflight:async()=>{},run:async r=>{calls++;expect(r.trialId).toBe("trial-2");expect(r.id).not.toBe(uncertain.id);return result(r);}};
 const completed=await executeEvaluation(plan,new Map([["goose",host]]),store(),randomUUID,{id:campaign.id,retryUncertain:true});
 expect(calls).toBe(1);expect(completed.completed).toBe(2);
 const db=new Database(registry,{readonly:true});expect(db.query("SELECT count(*) AS n FROM trials").get()).toEqual({n:3});
 expect(db.query("SELECT status FROM trials WHERE id=?").get(uncertain.id)).toEqual({status:"interrupted"});db.close();
 await executeEvaluation(plan,new Map([["goose",host]]),store(),randomUUID,{id:campaign.id,retryUncertain:false});expect(calls).toBe(1);
});

test("published proof repairs missing index without host execution and refuses finalized corruption",async()=>{
 const {plan,registry,store}=await setup();const first=store(),campaign=await first.begin(plan),r=request(plan,0);
 await first.start(r);await first.finish(r,result(r));await first.close();
 const db=new Database(registry);db.exec("PRAGMA foreign_keys=ON");
 db.query("DELETE FROM artifacts WHERE trial_id=?").run(r.id);
 db.query("UPDATE trials SET status='running',collection='unavailable',receipt_json=NULL WHERE id=?").run(r.id);
 db.query("UPDATE planned_trials SET status='running' WHERE trial_id=?").run(r.trialId);db.close();
 const recovered=store();const restored=await recovered.resume(campaign.id,false);
 expect(restored.completed).toBe(1);expect(restored.pending).toEqual(["trial-2"]);await recovered.close();
 expect(JSON.parse(await readFile(join(campaign.output,"artifacts",r.id,"checkpoint.json"),"utf8")).trialId).toBe("trial-1");
 await writeFile(join(campaign.output,"artifacts",r.id,"output.txt"),"corruption");
 await expect(store().resume(campaign.id,false)).rejects.toThrow("integrity mismatch");
});

test("campaign ownership refuses a second live owner and is released on orderly close",async()=>{
 const {plan,store}=await setup();const first=store(),campaign=await first.begin(plan);
 await expect(store().resume(campaign.id,true)).rejects.toThrow("live process");
 await first.close();const recovered=store();expect((await recovered.resume(campaign.id,false)).pending).toEqual(["trial-1","trial-2"]);await recovered.close();
});

test("bounded candidates overlap but storage writes never overlap",async()=>{
 const {plan,store}=await setup(3);const underlying=store();let writers=0,maxWriters=0,active=0,maxActive=0;
 const delay=()=>new Promise<void>(resolve=>setTimeout(resolve,3));
 async function writing(operation:()=>Promise<void>){writers++;maxWriters=Math.max(maxWriters,writers);try{await delay();await operation();}finally{writers--;}}
 const wrapped={begin:underlying.begin.bind(underlying),resume:underlying.resume.bind(underlying),close:underlying.close.bind(underlying),complete:underlying.complete.bind(underlying),
 start:(r:TrialRequest)=>writing(()=>underlying.start(r)),finish:(r:TrialRequest,s:TrialResult)=>writing(()=>underlying.finish(r,s)),fail:(r:TrialRequest)=>writing(()=>underlying.fail(r))};
 const host:CandidateHost={preflight:async()=>{},run:async r=>{active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,12));active--;return result(r);}};
 const campaign=await executeEvaluation(plan,new Map([["goose",host]]),wrapped,randomUUID);
 expect(campaign.completed).toBe(6);expect(maxActive).toBe(2);expect(maxWriters).toBe(1);expect(active).toBe(0);
});

test("resume CLI cannot override frozen selectors or execution parameters",async()=>{
 const calls:unknown[]=[];const cli=()=>createCli({writeOut:()=>{},writeErr:()=>{}},async(_input,_dry,resume)=>{calls.push(resume);});
 await cli().parseAsync(["evaluation","--resume","campaign","--retry-uncertain","--registry","/private/db"],{from:"user"});
 expect(calls).toEqual([{id:"campaign",retryUncertain:true}]);
 for(const args of [["--resume","campaign","--skills","new"],["--resume","campaign","--parallelism","9"],["--resume","campaign","--dry-run"],["--retry-uncertain","--skills","new"]]) {
  await expect(cli().parseAsync(["evaluation",...args],{from:"user"})).rejects.toMatchObject({code:"commander.error"});
 }
 expect(calls).toHaveLength(1);
});


test("killed owner is recoverable but its unfinished attempt is never silently rerun",async()=>{
 const {root,target,registry,store}=await setup();
 const child=join(root,"crash.ts"),signal=join(root,"ready.json");
 const sourceUrl=new URL("../../src/adapters/outbound/filesystem/filesystem-evaluation-source.ts",import.meta.url).href;
 const prepareUrl=new URL("../../src/application/use-cases/prepare-evaluation.ts",import.meta.url).href;
 const storeUrl=new URL("../../src/adapters/outbound/storage/sqlite-evaluation-store.ts",import.meta.url).href;
 await writeFile(child,`import {FilesystemEvaluationSource} from ${JSON.stringify(sourceUrl)};import {prepareEvaluation} from ${JSON.stringify(prepareUrl)};import {SqliteEvaluationStore} from ${JSON.stringify(storeUrl)};import {randomUUID} from 'node:crypto';import {writeFile} from 'node:fs/promises';
const p=await prepareEvaluation({skills:[process.argv[2]],plugins:[],agents:['goose'],repetitions:1,maxTurns:5,timeout:0,parallelism:2},new FilesystemEvaluationSource());const s=new SqliteEvaluationStore(process.argv[3],process.argv[4]);const c=await s.begin(p);const t=p.trials[0];await s.start({id:randomUUID(),trialId:t.id,pairId:t.pairId,agent:t.agent,condition:t.condition,profile:p.profile,scenario:p.profile.scenarios[0],options:p.options});await writeFile(process.argv[5],JSON.stringify(c));await new Promise(()=>{});`);
 const processChild=Bun.spawn([process.execPath,child,target,join(root,"proofs"),registry,signal],{stdout:"pipe",stderr:"pipe"});
 let campaign:{id:string}|undefined;
 try {
  for(let i=0;i<100;i++){try{campaign=JSON.parse(await readFile(signal,"utf8"));break;}catch{await new Promise(resolve=>setTimeout(resolve,10));}}
  if(!campaign)throw Error("Child failed to publish checkpoint identity");
  processChild.kill("SIGKILL");await processChild.exited;
  await expect(store().resume(campaign.id,false)).rejects.toThrow("--retry-uncertain");
  const recovery=store();const restored=await recovery.resume(campaign.id,true);
  expect(restored.pending).toEqual(["trial-1","trial-2"]);await recovery.close();
 } finally {if(processChild.exitCode===null){processChild.kill("SIGKILL");await processChild.exited;}}
});


test("retry consent cannot bypass corruption of a published but not indexed attempt",async()=>{
 const {plan,registry,store}=await setup();const first=store(),campaign=await first.begin(plan),r=request(plan,0);
 await first.start(r);await first.finish(r,result(r));await first.close();
 const db=new Database(registry);db.query("DELETE FROM artifacts WHERE trial_id=?").run(r.id);
 db.query("UPDATE trials SET status='running',receipt_json=NULL WHERE id=?").run(r.id);
 db.query("UPDATE planned_trials SET status='running' WHERE trial_id=?").run(r.trialId);db.close();
 await writeFile(join(campaign.output,"artifacts",r.id,"output.txt"),"bad bytes");
 await expect(store().resume(campaign.id,true)).rejects.toThrow("integrity mismatch");
});

test("persistence failure stops admission and waits for active hosts before closing storage",async()=>{
 const {plan}=await setup(3);const events:string[]=[];let release:()=>void=()=>{};
 const barrier=new Promise<void>(resolve=>{release=resolve;});
 let secondStarted:()=>void=()=>{};const bothActive=new Promise<void>(resolve=>{secondStarted=resolve;});
 let runs=0;let failureObserved:()=>void=()=>{};const failure=new Promise<void>(resolve=>{failureObserved=resolve;});
 const host:CandidateHost={preflight:async()=>{},run:async r=>{runs++;events.push(`run:${r.trialId}`);if(r.trialId==="trial-2"){secondStarted();await barrier;}else await bothActive;events.push(`end:${r.trialId}`);return result(r);}};
 const store={resume:async()=>{throw Error("Unexpected resume");},begin:async()=>({id:randomUUID(),output:"/unused"}),start:async()=>{},
 finish:async(r:TrialRequest)=>{if(r.trialId==="trial-1"){failureObserved();throw Error("index failure");}},fail:async()=>{},complete:async()=>{},close:async()=>{events.push("close");}};
 const execution=executeEvaluation(plan,new Map([["goose",host]]),store,randomUUID);
 const outcome=execution.then(()=>null,error=>error);
 await failure;await new Promise(resolve=>setTimeout(resolve,0));expect(runs).toBe(2);expect(events).not.toContain("close");
 release();expect((await outcome).message).toBe("index failure");expect(events.at(-1)).toBe("close");expect(events.indexOf("end:trial-2")).toBeLessThan(events.indexOf("close"));expect(runs).toBe(2);
});
