import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync} from "node:child_process";
import {runLoop} from "../dist/scripts/run_loop.js";
import {runEval,runSingleQuery} from "../dist/scripts/run_eval.js";
import {summarizeTriggerClassifications,aggregateTriggerOutcomes,initialTelemetry,makeTriggerOutcome} from "../dist/scripts/trigger_evaluation.js";
function skill(){const root=mkdtempSync(join(tmpdir(),"trigger-outcome-test-"));mkdirSync(root,{recursive:true});writeFileSync(join(root,"SKILL.md"),"---\nname: example-skill\ndescription: Evaluates examples. Use when an example is requested.\n---\n# Example\n");return root}
const command=process.execPath+" "+new URL("fixtures/fake-trigger-host.mjs",import.meta.url).pathname;
test("trigger runs emit versioned outcomes and bounded optional telemetry",async()=>{const root=skill(),previous=process.env.SKILL_CREATOR_GOOSE_COMMAND;process.env.SKILL_CREATOR_GOOSE_COMMAND=command;try{const triggered=await runSingleQuery("trigger",root,1000),negative=await runSingleQuery("negative",root,1000);assert.equal(triggered.schema_version,"1.0");assert.equal(triggered.outcome,"triggered");assert.equal(triggered.classification,true);assert.equal(triggered.usage.categories.value?.input_tokens,11);assert.equal(triggered.usage.cost_usd.value,0.02);assert.equal(triggered.actual_turns.value,2);assert.ok((triggered.time_to_trigger_ms.value??-1)>=0);assert.equal(negative.outcome,"not-triggered");assert.equal(negative.classification,false);assert.equal(negative.time_to_trigger_ms.value,null);assert.match(negative.time_to_trigger_ms.unavailable_reason!,/not triggered/)}finally{previous===undefined?delete process.env.SKILL_CREATOR_GOOSE_COMMAND:process.env.SKILL_CREATOR_GOOSE_COMMAND=previous;rmSync(root,{recursive:true,force:true})}});
test("first-choice routing rejects sibling-first loads and failed terminal is infrastructure",async()=>{const root=skill(),previous=process.env.SKILL_CREATOR_GOOSE_COMMAND;process.env.SKILL_CREATOR_GOOSE_COMMAND=command;try{assert.equal((await runSingleQuery("sibling-target",root,1000)).classification,false);const failed=await runSingleQuery("failed-terminal",root,1000);assert.equal(failed.classification,null);assert.equal(failed.outcome,"host-failure");}finally{previous===undefined?delete process.env.SKILL_CREATOR_GOOSE_COMMAND:process.env.SKILL_CREATOR_GOOSE_COMMAND=previous;rmSync(root,{recursive:true,force:true});}});
test("host, timeout, malformed, and unsupported streams are infrastructure outcomes without leaks",async()=>{const root=skill(),previous=process.env.SKILL_CREATOR_GOOSE_COMMAND;process.env.SKILL_CREATOR_GOOSE_COMMAND=command;try{for(const[q,kind,timeout]of [["failure","host-failure",1000],["hang","timeout",30],["malformed","malformed-stream",1000],["unsupported","unsupported-telemetry",1000]] as const){const result=await runSingleQuery(q,root,timeout);assert.equal(result.outcome,kind);assert.equal(result.classification,null);assert.equal(result.infrastructure_failure,true);assert.doesNotMatch(JSON.stringify(result),/SECRET_SHOULD_NOT_LEAK/)}}finally{previous===undefined?delete process.env.SKILL_CREATOR_GOOSE_COMMAND:process.env.SKILL_CREATOR_GOOSE_COMMAND=previous;rmSync(root,{recursive:true,force:true})}});
test("usage telemetry accepts only explicit aliases and never persists hostile names or values",async()=>{const root=skill(),previous=process.env.SKILL_CREATOR_GOOSE_COMMAND;process.env.SKILL_CREATOR_GOOSE_COMMAND=command;try{const result=await runSingleQuery("hostile-usage",root,1000),serialized=JSON.stringify(result);assert.deepEqual(result.usage.categories.value,{input_tokens:5,total_tokens:9});assert.equal(result.usage.cost_usd.value,null);for(const hostile of ["secret_token","api_token","unknown_tokens","8675309001","4242424002","313373003","999999004"])assert.doesNotMatch(serialized,new RegExp(hostile));}finally{previous===undefined?delete process.env.SKILL_CREATOR_GOOSE_COMMAND:process.env.SKILL_CREATOR_GOOSE_COMMAND=previous;rmSync(root,{recursive:true,force:true})}});
test("message count is not inferred as actual turns",async()=>{const root=skill(),previous=process.env.SKILL_CREATOR_GOOSE_COMMAND;process.env.SKILL_CREATOR_GOOSE_COMMAND=command;try{const result=await runSingleQuery("multi-message-no-turn",root,1000);assert.equal(result.outcome,"not-triggered");assert.equal(result.actual_turns.value,null);assert.match(result.actual_turns.unavailable_reason!,/host stream did not provide/)}finally{previous===undefined?delete process.env.SKILL_CREATOR_GOOSE_COMMAND:process.env.SKILL_CREATOR_GOOSE_COMMAND=previous;rmSync(root,{recursive:true,force:true})}});
test("aggregate excludes infrastructure failures from accuracy and reports confusion, latency, and coverage",()=>{const started=performance.now()-10,state=initialTelemetry();const records=[{should_trigger:true,run:makeTriggerOutcome("triggered",started,state,performance.now()-5)},{should_trigger:false,run:makeTriggerOutcome("triggered",started,state,performance.now()-4)},{should_trigger:true,run:makeTriggerOutcome("not-triggered",started,state)},{should_trigger:false,run:makeTriggerOutcome("not-triggered",started,state)},{should_trigger:true,run:makeTriggerOutcome("timeout",started,state)}],m=aggregateTriggerOutcomes(records);assert.deepEqual(m.classification.confusion_matrix,{true_positive:1,true_negative:1,false_positive:1,false_negative:1});assert.equal(m.classification.eligible_runs,4);assert.equal(m.classification.excluded_infrastructure_runs,1);assert.equal(m.classification.accuracy,.5);assert.equal(m.infrastructure_failures.by_outcome.timeout,1);assert.equal(m.latency_ms.time_to_trigger.count,2);assert.equal(m.telemetry_coverage.cost_usd.available,0)});
test("runEval preserves legacy fields while adding typed metrics",async()=>{const root=skill(),previous=process.env.SKILL_CREATOR_GOOSE_COMMAND;process.env.SKILL_CREATOR_GOOSE_COMMAND=command;try{const output=await runEval([{query:"trigger",should_trigger:true},{query:"failure",should_trigger:false}],root,1,1000,{runsPerQuery:1});assert.equal(output.summary.total,2);assert.equal(output.results[0].triggers,1);assert.equal(output.results[0].runs,1);assert.equal(output.results[0].pass,true);assert.equal(output.results[1].infrastructure_failures,1);assert.equal(output.results[1].pass,null);assert.equal(output.results[1].trigger_rate,null);assert.equal(output.summary.failed,0);assert.equal(output.summary.unavailable,1);assert.equal(output.metrics.classification.eligible_runs,1);assert.equal(output.metrics.infrastructure_failures.total,1)}finally{previous===undefined?delete process.env.SKILL_CREATOR_GOOSE_COMMAND:process.env.SKILL_CREATOR_GOOSE_COMMAND=previous;rmSync(root,{recursive:true,force:true})}});

test('trigger waits for close: failed exits after terminal stay infrastructure',async()=>{
 const root=skill(),host=join(root,'probe.mjs'),previous=process.env.SKILL_CREATOR_GOOSE_COMMAND;
 writeFileSync(host,"console.log(JSON.stringify({type:'complete'}));process.exitCode=9;");process.env.SKILL_CREATOR_GOOSE_COMMAND=process.execPath+' '+host;
 try{const result=await runSingleQuery('probe',root,2000);assert.equal(result.classification,null);assert.equal(result.outcome,'host-failure');}finally{previous===undefined?delete process.env.SKILL_CREATOR_GOOSE_COMMAND:process.env.SKILL_CREATOR_GOOSE_COMMAND=previous;rmSync(root,{recursive:true,force:true});}
});
test('trigger timeout reaps SIGTERM-resistant host before returning',{timeout:5000},async()=>{
 const root=skill(),host=join(root,'probe.mjs'),pidFile=join(root,'pid'),previous=process.env.SKILL_CREATOR_GOOSE_COMMAND;
 writeFileSync(host,"import {writeFileSync} from 'node:fs';writeFileSync("+JSON.stringify(pidFile)+",String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},50);");process.env.SKILL_CREATOR_GOOSE_COMMAND=process.execPath+' '+host;let pid:number|undefined;
 try{const started=Date.now(),result=await runSingleQuery('probe',root,400);pid=Number((await import('node:fs')).readFileSync(pidFile,'utf8'));assert.equal(result.outcome,'timeout');assert.ok(Date.now()-started<2500);assert.throws(()=>process.kill(pid!,0),/ESRCH/);}finally{if(pid)try{process.kill(pid,'SIGKILL');}catch{}previous===undefined?delete process.env.SKILL_CREATOR_GOOSE_COMMAND:process.env.SKILL_CREATOR_GOOSE_COMMAND=previous;rmSync(root,{recursive:true,force:true});}
});

test('trigger transport inherits ambient context and normal profile',async()=>{
 const root=skill(),host=join(root,'probe.mjs'),previous=process.env.SKILL_CREATOR_GOOSE_COMMAND,old=process.env.AMBIENT_TRIGGER_CONTEXT;
 writeFileSync(host,"const fs=await import('node:fs'),path=await import('node:path'),d=path.join(process.cwd(),'.agents/skills'),folder=fs.readdirSync(d)[0],target=/^name: (.+)$/m.exec(fs.readFileSync(path.join(d,folder,'SKILL.md'),'utf8'))[1];const inherited=process.env.HOME!==process.cwd()&&process.env.AMBIENT_TRIGGER_CONTEXT==='sentinel'&&!process.argv.includes('--no-profile');console.log(JSON.stringify({type:'message',message:{content:[{type:'toolRequest',toolCall:{value:{name:'load_skill',arguments:{name:inherited?target:'sibling'}}}}]}}));console.log(JSON.stringify({type:'complete'}));");
 process.env.SKILL_CREATOR_GOOSE_COMMAND=process.execPath+' '+host;process.env.AMBIENT_TRIGGER_CONTEXT='sentinel';
 try{assert.equal((await runSingleQuery('probe',root,2000)).classification,true);}finally{previous===undefined?delete process.env.SKILL_CREATOR_GOOSE_COMMAND:process.env.SKILL_CREATOR_GOOSE_COMMAND=previous;old===undefined?delete process.env.AMBIENT_TRIGGER_CONTEXT:process.env.AMBIENT_TRIGGER_CONTEXT=old;rmSync(root,{recursive:true,force:true});}
});
test('trigger timeout reaps descendants that hold stdout open',{timeout:5000,skip:process.platform!=='linux'},async()=>{
 const root=skill(),host=join(root,'probe.mjs'),pidFile=join(root,'pid'),previous=process.env.SKILL_CREATOR_GOOSE_COMMAND;
 writeFileSync(host,`import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},50)"],{stdio:['ignore',process.stdout,process.stderr]});writeFileSync(${JSON.stringify(pidFile)},String(child.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},50);`);process.env.SKILL_CREATOR_GOOSE_COMMAND=process.execPath+' '+host;let pid:number|undefined;
 try{const result=await runSingleQuery('probe',root,400);pid=Number((await import('node:fs')).readFileSync(pidFile,'utf8'));assert.equal(result.outcome,'timeout');try{process.kill(pid,0);const stat=(await import('node:fs')).readFileSync('/proc/'+pid+'/stat','utf8');assert.match(stat,/\) Z /,'descendant may be zombie but must not be running');}catch(error){assert.equal((error as NodeJS.ErrnoException).code,'ESRCH');}}finally{if(pid)try{process.kill(pid,'SIGKILL');}catch{}previous===undefined?delete process.env.SKILL_CREATOR_GOOSE_COMMAND:process.env.SKILL_CREATOR_GOOSE_COMMAND=previous;rmSync(root,{recursive:true,force:true});}
});

// Mock hosts do not use the operator's ambient provider/keyring selection.
const priorProvider=process.env.GOOSE_PROVIDER,priorModel=process.env.GOOSE_MODEL;
test.before(()=>{process.env.GOOSE_PROVIDER="ollama";process.env.GOOSE_MODEL="no-provider-fixture";});
test.after(()=>{priorProvider===undefined?delete process.env.GOOSE_PROVIDER:process.env.GOOSE_PROVIDER=priorProvider;priorModel===undefined?delete process.env.GOOSE_MODEL:process.env.GOOSE_MODEL=priorModel;});

// One classified repetition cannot stand in for a missing required repetition.
test("runEval keeps mixed repetition evidence incomplete",async()=>{
 const root=skill(),host=join(root,"alternating.mjs"),counter=join(root,"count"),previous=process.env.SKILL_CREATOR_GOOSE_COMMAND;
 writeFileSync(host,`import {existsSync,readFileSync,writeFileSync} from 'node:fs';const file=${JSON.stringify(counter)},n=existsSync(file)?Number(readFileSync(file,'utf8')):0;writeFileSync(file,String(n+1));if(n===0)console.log(JSON.stringify({type:'complete'}));else process.exitCode=9;`);
 process.env.SKILL_CREATOR_GOOSE_COMMAND=process.execPath+" "+host;
 try{const result=await runEval([{query:"probe",should_trigger:false}],root,1,2000,{runsPerQuery:2});assert.equal(result.results[0].classification_runs,1);assert.equal(result.results[0].trigger_rate,0);assert.equal(result.results[0].pass,null);assert.equal(result.summary.passed,0);assert.equal(result.summary.failed,0);assert.equal(result.summary.unavailable,1);assert.deepEqual(result.metrics.classification.confusion_matrix,{true_positive:0,true_negative:1,false_positive:0,false_negative:0});}
 finally{previous===undefined?delete process.env.SKILL_CREATOR_GOOSE_COMMAND:process.env.SKILL_CREATOR_GOOSE_COMMAND=previous;rmSync(root,{recursive:true,force:true});}
});

test("optimizer stops on unavailable evidence without inventing FN or TN",async()=>{
 const root=skill(),previous=process.env.SKILL_CREATOR_GOOSE_COMMAND,logs:string[]=[],original=console.error;
 process.env.SKILL_CREATOR_GOOSE_COMMAND=command;console.error=(...args:unknown[])=>{logs.push(args.join(" "));};
 try{const result=await runLoop([{query:"failure",should_trigger:true},{query:"unsupported",should_trigger:false}],root,undefined,1,1000,2,1,.5,0,"fixture-model",true);assert.match(result.exit_reason,/incomplete_evidence/);assert.equal(result.iterations_run,1);assert.equal(result.final_description,result.original_description);assert.equal(result.history[0].train_failed,0);assert.equal(result.history[0].train_unavailable,2);assert.match(logs.join("\n"),/0\/0 correct, precision=unavailable recall=unavailable accuracy=unavailable/);assert.doesNotMatch(logs.join("\n"),/Improving description/);assert.equal(result.best_score,null);}
 finally{console.error=original;previous===undefined?delete process.env.SKILL_CREATOR_GOOSE_COMMAND:process.env.SKILL_CREATOR_GOOSE_COMMAND=previous;rmSync(root,{recursive:true,force:true});}
});

// Complete negative/positive observations still allow the ordinary all-passed exit.
test("optimizer retains complete activation evidence as a scored candidate",async()=>{
 const root=skill(),previous=process.env.SKILL_CREATOR_GOOSE_COMMAND;process.env.SKILL_CREATOR_GOOSE_COMMAND=command;
 try{const result=await runLoop([{query:"trigger",should_trigger:true},{query:"negative",should_trigger:false}],root,undefined,1,1000,2,1,.5,0,"fixture-model",false);assert.equal(result.exit_reason,"all_passed (iteration 1)");assert.equal(result.best_score,"2/2");assert.equal(result.history[0].train_unavailable,0);assert.equal(result.history[0].train_failed,0);assert.equal(result.iterations_run,1);}
 finally{previous===undefined?delete process.env.SKILL_CREATOR_GOOSE_COMMAND:process.env.SKILL_CREATOR_GOOSE_COMMAND=previous;rmSync(root,{recursive:true,force:true});}
});

// Anthropic measures initial routing, not eventual activation after another tool.
test('description routing uses first tool, exact randomized stub identity and no Skill body',async()=>{
 const root=skill(),host=join(root,'routing-probe.mjs'),previous=process.env.SKILL_CREATOR_GOOSE_COMMAND;
 writeFileSync(join(root,'private-body.txt'),'PRIVATE_BODY_MUST_NOT_BE_DISCOVERED');
 writeFileSync(host,`import fs from 'node:fs';import path from 'node:path';
 const dirs=fs.readdirSync('.agents/skills'),dir=path.join('.agents/skills',dirs[0]),md=fs.readFileSync(path.join(dir,'SKILL.md'),'utf8'),name=/^name: (.+)$/m.exec(md)[1],q=process.argv[process.argv.indexOf('--text')+1];
 if(!/-skill-[a-f0-9]{8}$/.test(name)||fs.readdirSync(dir).length!==1||md.includes('# Example'))process.exit(9);
 const tool=(n,args)=>({type:'toolRequest',toolCall:{value:{name:n,arguments:args}}});
 const items=q==='target'?[tool('load_skill',{name})]:q==='other-first'?[tool('developer__shell',{}),tool('load_skill',{name})]:q==='sibling-first'?[tool('load_skill',{name:'other'}),tool('load_skill',{name})]:[tool('load_skill',{name:'plugin:'+name})];
 console.log(JSON.stringify({type:'message',message:{content:items}}));console.log(JSON.stringify({type:'complete'}));`);
 process.env.SKILL_CREATOR_GOOSE_COMMAND=process.execPath+' '+host;
 try{assert.equal((await runSingleQuery('target',root,2000)).classification,true);for(const q of ['other-first','sibling-first','collision'])assert.equal((await runSingleQuery(q,root,2000)).classification,false,q);}
 finally{previous===undefined?delete process.env.SKILL_CREATOR_GOOSE_COMMAND:process.env.SKILL_CREATOR_GOOSE_COMMAND=previous;rmSync(root,{recursive:true,force:true});}
});

test('randomized description stub respects valid original name boundaries',async()=>{
 const root=skill(),host=join(root,'name-probe.mjs'),previous=process.env.SKILL_CREATOR_GOOSE_COMMAND;
 writeFileSync(host,`import fs from 'node:fs';import path from 'node:path';const d=fs.readdirSync('.agents/skills')[0],md=fs.readFileSync(path.join('.agents/skills',d,'SKILL.md'),'utf8'),name=/^name: (.+)$/m.exec(md)[1];if(name.length>64||name.endsWith('-')||!/-skill-[a-f0-9]{8}$/.test(name))process.exit(9);console.log(JSON.stringify({type:'message',message:{content:[{type:'toolRequest',toolCall:{value:{name:'load_skill',arguments:{name}}}}]}}));console.log(JSON.stringify({type:'complete'}));`);
 process.env.SKILL_CREATOR_GOOSE_COMMAND=process.execPath+' '+host;
 try{for(const length of [49,50,64]){writeFileSync(join(root,'SKILL.md'),`---\nname: ${'a'.repeat(length)}\ndescription: Handles examples. Use for example requests.\n---\n`);assert.equal((await runSingleQuery('probe',root,2000)).classification,true,String(length));}}
 finally{previous===undefined?delete process.env.SKILL_CREATOR_GOOSE_COMMAND:process.env.SKILL_CREATOR_GOOSE_COMMAND=previous;rmSync(root,{recursive:true,force:true});}
});

// Execute upstream control flow with deterministic trial futures, never a model.
test('actual Anthropic run_eval uses matching complete-trial threshold decisions',{skip:!process.env.ANTHROPIC_SKILL_CREATOR_ROOT},()=>{
 const cases=[{query:"positive-boundary",should_trigger:true,values:[true,false]},{query:"negative-boundary",should_trigger:false,values:[true,false]},{query:"negative-pass",should_trigger:false,values:[false,false]},{query:"positive-fail",should_trigger:true,values:[false,false]}];
 const code=`import json,runpy,sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
m=runpy.run_path(str(Path(sys.argv[1])/"scripts/run_eval.py"))
cases=json.loads(sys.argv[2]); values={c["query"]:iter(c["values"]) for c in cases}
class Future:
 def __init__(self,value): self.value=value
 def result(self): return self.value
class Executor:
 def __init__(self,**kwargs): pass
 def __enter__(self): return self
 def __exit__(self,*args): pass
 def submit(self,fn,query,*args): return Future(next(values[query]))
g=m["run_eval"].__globals__;g["ProcessPoolExecutor"]=Executor;g["as_completed"]=lambda futures:list(futures)
print(json.dumps(m["run_eval"]([{k:c[k] for k in ("query","should_trigger")} for c in cases],"stub","Description",1,1,Path("."),runs_per_query=2,trigger_threshold=.5)))`;
 const result=spawnSync('python3',['-B','-c',code,process.env.ANTHROPIC_SKILL_CREATOR_ROOT!,JSON.stringify(cases)],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 const upstream=JSON.parse(result.stdout);for(const c of cases){const expected=upstream.results.find((r:any)=>r.query===c.query),local=summarizeTriggerClassifications(c.values,c.should_trigger,.5,2);assert.deepEqual({rate:local.trigger_rate,triggers:local.triggers,runs:local.runs,pass:local.pass},{rate:expected.trigger_rate,triggers:expected.triggers,runs:expected.runs,pass:expected.pass});}
});
