import test from "node:test";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,existsSync,statSync,readdirSync,cpSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync} from "node:child_process";
import {captureEvaluationConfig,stageEvaluationConfig} from "../dist/scripts/evaluation_config.js";
import yaml from "js-yaml";
import {runIsolatedEvaluation} from "../dist/scripts/evaluation_isolated.js";
import {replayExitCode} from "../dist/scripts/replay_evaluation.js";
import {executableIdentity} from "../dist/scripts/evaluation_replay.js";
import {validateTaskEvidence,renderTaskEvidence} from "../dist/scripts/task_evidence.js";
import {nativeFixture,fixture,protocolCall,retainedProtocolFixture,assertNoRetainedSecret,copyRuntime,copiedEvaluation,assertFidelity,replayCli} from "./fixtures/isolated-evaluation.ts";

test("R9-2 sensitive helper bytes and native package addons do not produce closure hashes",async()=>{for(const seam of ['secret','native']){const f=fixture(),secret='opaque-helper-credential-987654321';try{if(seam==='secret'){f.put(join(f.home,'.config/goose/secrets.yaml'),'API_KEY: '+secret);writeFileSync(join(f.root,'helper.mjs'),'export const value='+JSON.stringify(secret)+';');writeFileSync(f.host,'import {value} from "./helper.mjs";'+readFileSync(f.host,'utf8'));}else{f.put(join(f.root,'node_modules/native-helper/package.json'),JSON.stringify({type:'module',exports:'./index.mjs'}));f.put(join(f.root,'node_modules/native-helper/index.mjs'),'export const value="ordinary";');f.put(join(f.root,'node_modules/native-helper/addon.node'),'native-binary-placeholder');writeFileSync(f.host,'import {value} from "native-helper";'+readFileSync(f.host,'utf8'));}const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.status,'succeeded');assert.equal(r.replay.available,false);assert.equal(existsSync(join(f.options.output,'replay-recipe.json')),false);assert.equal(existsSync(join(f.options.output,'replay.sh')),false);assertNoRetainedSecret(f.options.output,secret);}finally{f.cleanup();}}});

test('NEW-F1 native ELF supports preparation and practical fresh replay with binary drift rejection',async()=>{
 const f=fixture();try{
  const prepared:any=await runIsolatedEvaluation({...f.options,command:'/bin/true'});assert.equal(prepared.replay.available,true);assertFidelity(prepared.replay.fidelity);assertFidelity(prepared.replay_fidelity);
  const identity:any=executableIdentity('/bin/true',process.env);assert.equal(identity.format,'elf');
  const source=join(f.root,'native.c'),host=join(f.root,'native-goose');
  writeFileSync(source,`#include <stdio.h>\n#include <string.h>\nint main(int argc,char**argv){FILE*f=fopen(${JSON.stringify(f.log)},"a");if(!f)return 8;fputs("invoked\\n",f);fclose(f);fprintf(stderr,"native diagnostic\\n");if(argc>1&&!strcmp(argv[1],"skills")){puts("Name | Description | Location");puts("goose-doc-guide | builtin | builtin://skills/goose-doc-guide");}else{puts("{\\"type\\":\\"message\\",\\"message\\":{\\"role\\":\\"assistant\\",\\"content\\":[{\\"type\\":\\"text\\",\\"text\\":\\"native deterministic output\\"}]}}");puts("{\\"type\\":\\"complete\\"}");}return 0;}\n`);
  const compile=spawnSync('cc',[source,'-o',host],{encoding:'utf8',env:{...process.env,CCACHE_DISABLE:'1'}});assert.equal(compile.status,0,compile.stderr);
  const output=join(f.root,'native-report'),r:any=await runIsolatedEvaluation({...f.options,output,command:host,dryRun:false});assert.equal(r.status,'succeeded',JSON.stringify(r));assert.equal(r.replay.available,true);assertFidelity(r.replay.fidelity);
  const recipe=JSON.parse(readFileSync(join(output,'replay-recipe.json'),'utf8'));assertFidelity(recipe.fidelity);assert.equal(recipe.executable.format,'elf');assert.equal(recipe.launcher_closure.kind,'native-executable');
  const receipt=JSON.parse(readFileSync(join(output,'baseline/run-1/discovery-invocation.json'),'utf8'));assert.equal(receipt.result.exit_code,0);assert(receipt.result.stderr_bytes>0);
  const child=replayCli(output,{encoding:'utf8',timeout:15000});assert.equal(child.status,0,child.stdout+child.stderr);const fresh=JSON.parse(child.stdout);assertFidelity(fresh.replay.fidelity);assertFidelity(fresh.replay_fidelity);assert.equal(fresh.parent.output,output);assert.equal(fresh.runs[0].output,'native deterministic output');
  const calls=readFileSync(f.log,'utf8');writeFileSync(host,Buffer.concat([readFileSync(host),Buffer.from('changed-binary')]));const drift=replayCli(output,{encoding:'utf8',timeout:15000});assert.equal(drift.status,2);assert.match(drift.stderr,/replay-executable-drift/);assert.equal(readFileSync(f.log,'utf8'),calls);
 }finally{f.cleanup();}
});

test('NEW-F2 secret-bearing wrapper and resolved paths never retain executable hashes',async()=>{
 for(const seam of ['bytes','resolved-path']){const f=fixture(),secret='opaque-executable-private-987654321';try{
  f.put(join(f.home,'.config/goose/secrets.yaml'),'API_KEY: '+secret);const wrapper=join(f.root,seam==='resolved-path'?secret:'wrapper.sh'),link=join(f.root,'launcher');
  const bytes=Buffer.from('#!/bin/sh\n'+(seam==='bytes'?'# '+secret+'\n':'')+'exec '+process.execPath+' '+f.host+' "$@"\n');writeFileSync(wrapper,bytes,{mode:0o700});symlinkSync(wrapper,link);
  const r:any=await runIsolatedEvaluation({...f.options,command:link,dryRun:false});assert.equal(r.status,'succeeded');assert.equal(r.replay.available,false);const receipt=JSON.parse(readFileSync(join(f.options.output,'baseline/run-1/discovery-invocation.json'),'utf8'));assert.equal(receipt.executable.available,false);assert.match(receipt.executable.reason,/sensitive-executable/);assertNoRetainedSecret(f.options.output,secret);assertNoRetainedSecret(f.options.output,bytes.toString('utf8'));
 }finally{f.cleanup();}}
});

test('NEW-F2 opaque native bytes are screened before identity hashing',()=>{const f=fixture(),secret='opaque-binary-private-987654321';try{const host=join(f.root,'opaque');writeFileSync(host,Buffer.concat([Buffer.from([127,69,76,70,255,0]),Buffer.from(secret),Buffer.from([255])]),{mode:0o700});const identity:any=executableIdentity(host,process.env,f.root,v=>!v.includes(secret));assert.equal(identity.available,false);assert.equal(identity.sha256,undefined);assert.equal(identity.reason,'sensitive-executable-bytes');}finally{f.cleanup();}});

test('NEW-F2 evaluator production runtime taint disables retention without a dependency hash',async()=>{const f=nativeFixture(),secret='opaque-runtime-private-987654321';try{f.put(join(f.home,'.config/goose/secrets.yaml'),'API_KEY: '+secret);const app=copyRuntime(f),file=join(app,'node_modules/js-yaml/index.js');writeFileSync(file,readFileSync(file,'utf8')+'\n// '+secret+'\n');const sensitive=readFileSync(file,'utf8');const r:any=await copiedEvaluation(app,{...f.options,dryRun:false});assert.equal(r.status,'succeeded');assert.equal(r.replay.available,false);assert.equal(r.replay.reason,'replay-sensitive-runtime-bytes');assert.equal(existsSync(join(f.options.output,'replay-recipe.json')),false);assert.equal(existsSync(join(f.options.output,'replay.sh')),false);assertNoRetainedSecret(f.options.output,secret);assertNoRetainedSecret(f.options.output,sensitive);}finally{f.cleanup();}});

test('NEW-F3 Node runtime external IO is allowed but explicitly unbound with parent provenance',async()=>{const f=fixture();try{const external=join(f.root,'external.txt');writeFileSync(external,'external-original');writeFileSync(f.host,readFileSync(f.host,'utf8').replace('const output=JSON.stringify','const output=JSON.stringify').replace('prompt:input,initial:','external:fs.readFileSync('+JSON.stringify(external)+',"utf8"),prompt:input,initial:'));const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.replay.available,true);assertFidelity(r.replay.fidelity);const recipe=JSON.parse(readFileSync(join(f.options.output,'replay-recipe.json'),'utf8'));assertFidelity(recipe.fidelity);assert(!recipe.launcher_closure.policy.includes('runtime IO and computed loaders unsupported'));assert.equal(JSON.parse(r.runs[0].output).external,'external-original');writeFileSync(external,'external-changed');const child=replayCli(f.options.output,{encoding:'utf8',timeout:15000});assert.equal(child.status,0,child.stdout+child.stderr);const fresh=JSON.parse(child.stdout);assert.equal(JSON.parse(fresh.runs[0].output).external,'external-changed');assert.equal(fresh.parent.output,f.options.output);assertFidelity(fresh.replay.fidelity);}finally{f.cleanup();}});

test('NEW-F2 intermediate symlink target bytes are screened even with a clean final path',()=>{const f=fixture(),secret='opaque-link-private-987654321';try{mkdirSync(join(f.root,secret));const wrapper=join(f.root,'wrapper');writeFileSync(wrapper,'#!/bin/sh\nexit 0\n',{mode:0o700});const link=join(f.root,'launcher');symlinkSync(secret+'/../wrapper',link);const identity:any=executableIdentity(link,process.env,f.root,v=>!v.includes(secret));assert.equal(identity.available,false);assert.equal(identity.reason,'sensitive-executable-symlink');assert.equal(identity.sha256,undefined);}finally{f.cleanup();}});

test('NEW-F1 unknown executable formats and shebang wrappers remain explicitly unavailable',async()=>{for(const kind of ['unknown','shebang']){const f=fixture();try{const host=join(f.root,'unsupported');writeFileSync(host,kind==='unknown'?Buffer.from([255,0,1,2]):'#!/bin/sh\nexit 0\n',{mode:0o700});const r:any=await runIsolatedEvaluation({...f.options,command:host});assert.equal(r.status,'prepared');assert.equal(r.replay.available,false);assert.equal(r.replay.reason,'replay-unsupported-launcher');assertFidelity(r.replay.fidelity);assert.equal(existsSync(join(f.options.output,'replay.sh')),false);}finally{f.cleanup();}}});

test('NEW-F4 compiled native protocol templates replay while known byte taint never hashes',async()=>{
 for(const seam of ['public','opaque-config','bearer-env','strong-token']){const f=fixture();const previous=process.env.GOOSE_API_KEY;try{
  const secret=seam==='bearer-env'?'Bearer known-native-auth-987654321':seam==='strong-token'?'sk-nativeActualCredential987654321':'opaque-native-credential-987654321';
  if(seam==='opaque-config')f.put(join(f.home,'.config/goose/secrets.yaml'),'API_KEY: '+secret);
  if(seam==='bearer-env')process.env.GOOSE_API_KEY=secret;
  const source=join(f.root,'protocol.c'),host=join(f.root,'protocol-native');
  writeFileSync(source,'#include <stdio.h>\nconst char *protocol[]={"Bearer %s","Bearer {}",'+JSON.stringify(seam==='public'?'public template':secret)+'};\nint main(){return protocol[0][0]==0;}\n');
  const compile=spawnSync('cc',[source,'-o',host],{encoding:'utf8',env:{...process.env,CCACHE_DISABLE:'1'}});assert.equal(compile.status,0,'native fixture compilation failed');
  const r:any=await runIsolatedEvaluation({...f.options,command:host});assert.equal(r.status,'prepared');
  assert.equal(r.replay.available,seam==='public',seam+': '+r.replay.reason);
  if(seam==='public'){
   const recipe=JSON.parse(readFileSync(join(f.options.output,'replay-recipe.json'),'utf8'));assert.equal(recipe.executable.format,'elf');assert.match(recipe.executable.byte_screening,/known-private-bytes/);assert.match(recipe.runtime.node.byte_screening,/known-private-bytes/);
   const child=replayCli(f.options.output,{encoding:'utf8',timeout:15000});assert.equal(child.status,0,'native public-template replay failed');
   assertNoRetainedSecret(f.options.output,readFileSync(host).toString('utf8'));
  }else{
   assert.equal(r.replay.reason,'sensitive-executable-bytes');assert.equal(existsSync(join(f.options.output,'replay-recipe.json')),false);assert.equal(existsSync(join(f.options.output,'replay.sh')),false);assertNoRetainedSecret(f.options.output,secret);assertNoRetainedSecret(f.options.output,readFileSync(host).toString('utf8'));assertNoRetainedSecret(f.options.output,createHash('sha256').update(readFileSync(host)).digest('hex'));
  }
 }finally{if(previous===undefined)delete process.env.GOOSE_API_KEY;else process.env.GOOSE_API_KEY=previous;f.cleanup();}}
});

test('NEW-F4 native-only screening does not relax runtime JavaScript protocol heuristics',async()=>{
 const f=nativeFixture();try{
  const app=copyRuntime(f),file=join(app,'node_modules/js-yaml/index.js');
  writeFileSync(file,readFileSync(file,'utf8')+'\n// Bearer %s\n');
  const r:any=await copiedEvaluation(app,{...f.options,dryRun:false});assert.equal(r.status,'succeeded');assert.equal(r.replay.available,false);assert.equal(r.replay.reason,'replay-sensitive-runtime-bytes');assert.equal(existsSync(join(f.options.output,'replay-recipe.json')),false);assert.equal(existsSync(join(f.options.output,'replay.sh')),false);
  assertNoRetainedSecret(f.options.output,createHash('sha256').update(readFileSync(file)).digest('hex'));
 }finally{f.cleanup();}
});





test("DRP CLI replay replaces shell generation and runs one fresh pair",async()=>{const f=nativeFixture();try{
 const r:any=await runIsolatedEvaluation({...f.options,dryRun:false,runsPerQuery:2});assert.equal(r.replay.available,true);assert.equal(r.runs.length,4);
 assert.equal(existsSync(join(f.options.output,"replay.sh")),false);assert.match(r.replay.command,/skill-creator replay --recipe/);assert.match(r.replay.recipe_sha256,/^[a-f0-9]{64}$/);
 const child=replayCli(f.options.output);assert.equal(child.status,0,child.stdout+child.stderr);const result=JSON.parse(child.stdout);assert.equal(result.attempt_kind,"replay");assert.equal(result.runs.length,2);
}finally{f.cleanup();}});

test("DRP real success streams retain benign stderr but withhold provider payload",async()=>{const f=nativeFixture();try{
 writeFileSync(f.host,readFileSync(f.host,"utf8").replace("const output=JSON.stringify","process.stderr.write('benign diagnostic\\n');const output=JSON.stringify"));
 const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.exit_code,0);
 const receipt=JSON.parse(readFileSync(join(f.options.output,"baseline/run-1/task-invocation.json"),"utf8"));
 assert.equal(receipt.result.channels.stderr.text,"benign diagnostic\n");assert.equal(receipt.result.channels.stderr.observed_bytes,18);
 assert.equal(receipt.result.channels.stdout.withheld,true);assert.equal(receipt.result.channels.stdout.text,null);assert.equal(receipt.result.channels.stdout.withheld_reason,"provider-event-stream");
}finally{f.cleanup();}});

// One stream integration proves redaction is wired to retained receipts; pure process tests cover other channel boundaries.
for(const seam of ["chunk-secret"]) test("A split credential is redacted before a diagnostic receipt is persisted: "+seam,async()=>{const f=nativeFixture();try{
 const secret="opaque-split-private-987654321";
 f.put(join(f.home,".config/goose/secrets.yaml"),"API_KEY: "+secret);
 let injected="";
 if(seam==="chunk-secret")injected="process.stderr.write("+JSON.stringify(secret.slice(0,14))+ ");await new Promise(r=>setTimeout(r,20));process.stderr.write("+JSON.stringify(secret.slice(14))+ ");";
 if(seam==="invalid-utf8")injected="process.stderr.write(Buffer.from([0xff,0xfe]));";
 if(seam==="timeout")injected="process.stderr.write("+JSON.stringify(secret.slice(0,14))+ ");await new Promise(r=>setTimeout(r,2000));";
 if(seam==="output-limit")injected="process.stderr.write(('a').repeat(17*1024*1024));";
 if(seam==="cap")injected="process.stderr.write(('ordinary diagnostic line\\n').repeat(4000));";
 if(seam==="structured")injected="process.stderr.write(JSON.stringify({type:'message',reasoning:'do not retain reasoning',message:{unknown:'private payload'}})+'\\n');";
 if(seam==="prefixed-structured")injected="process.stderr.write('event: '+JSON.stringify({type:'message',reasoning:'do not retain reasoning'})+'\\n');";
 if(seam==="credential")injected="process.stderr.write('API_KEY: arbitrary-unconfigured-private-value');";
 writeFileSync(f.host,readFileSync(f.host,"utf8").replace("const output=JSON.stringify",injected+"const output=JSON.stringify"));
 const r:any=await runIsolatedEvaluation({...f.options,dryRun:false,timeoutSeconds:seam==="timeout" ? 0.2 : 10});
 const trace=JSON.parse(readFileSync(join(f.options.output,"baseline/run-1/task-invocation.json"),"utf8"));const c=trace.result.channels.stderr;
 assert(c.observed_bytes>0);assert.equal(c.path_bytes,0);assert.equal(c.path,null);
 if(seam==="chunk-secret"){assert.equal(r.exit_code,0);assert.equal(c.text,"[REDACTED]");assert.equal(c.retained_bytes,10);}
 else if(seam==="cap"){assert.equal(c.truncated,true);assert.equal(c.retained_bytes,65536);assert.equal(c.withheld,false);}
 else {assert.equal(c.withheld,true);assert.equal(c.text,null);assert.equal(c.retained_bytes,0);}
 if(seam==="invalid-utf8")assert.equal(c.decode_status,"invalid");
 if(seam==="timeout")assert.equal(c.complete,false);
 assertNoRetainedSecret(f.options.output,secret);assertNoRetainedSecret(f.options.output,"do not retain reasoning");assertNoRetainedSecret(f.options.output,"arbitrary-unconfigured-private-value");
}finally{f.cleanup();}});

test("DRP candidate replay module drift cannot execute while current CLI remains trusted",async()=>{const f=nativeFixture();try{
 const app=copyRuntime(f),r:any=await copiedEvaluation(app,{...f.options,dryRun:false});assert.equal(r.replay.available,true);
 const marker=join(f.root,"candidate-module-marker"),module=join(app,"dist/scripts/evaluation_replay.js");
 writeFileSync(module,"import fs from 'node:fs';fs.writeFileSync("+JSON.stringify(marker)+",'executed');\n"+readFileSync(module,"utf8"));
 const child=replayCli(f.options.output);assert.equal(child.status,2);assert.match(child.stderr,/^Replay unavailable: replay-runtime-drift\n$/);assert.equal(existsSync(marker),false);
}finally{f.cleanup();}});

// A campaign is not needed to validate an integer; actual replay CLI success and
// pre-import drift rejection are exercised by the adjacent integration journeys.
test("Replay accepts only integer process exit codes from 0 through 255",()=>{
 for(const value of [0,1,2,127,255])assert.equal(replayExitCode(value),value);
 for(const value of [null,undefined,NaN,Infinity,-Infinity,.5,"0",-1,256,{},true])
  assert.throws(()=>replayExitCode(value),/^Error: replay-invalid-exit-code$/);
});

test("DRP public CLI rejects unbound recipe digest and unsupported campaign options",async()=>{for(const args of [["--recipe","private-path","--recipe-sha256","bad","--format","json"],["--resume"],["--help"]]){
 const child=spawnSync(process.execPath,[join(import.meta.dirname,"../dist/scripts/cli.js"),"replay",...args],{encoding:"utf8"});assert.equal(child.status,args[0]==="--help" ? 0 : 2);assert(!child.stderr.includes("private-path"));assert(!child.stderr.includes(" at "));
}});

test("DRP benign failing stdout and stderr keep distinct channel provenance",async()=>{const f=nativeFixture();try{
 writeFileSync(f.host,readFileSync(f.host,"utf8").replace("const output=JSON.stringify","process.stdout.write('ordinary stdout diagnostic\\n');process.stderr.write('ordinary stderr diagnostic\\n');process.exit(7);const output=JSON.stringify"));
 const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.exit_code,1);
 for(const arm of ["baseline","with_targets"]){const receipt=JSON.parse(readFileSync(join(f.options.output,arm,"run-1/task-invocation.json"),"utf8"));assert.equal(receipt.result.exit_code,7);assert.equal(receipt.result.exit_reason,"host-exit");
  for(const channel of ["stdout","stderr"]){const c=receipt.result.channels[channel];assert.equal(c.text,"ordinary "+channel+" diagnostic\n");assert.equal(c.complete,true);assert.equal(c.decode_status,"complete");assert.equal(c.retained_bytes,c.observed_bytes);assert.equal(c.withheld,false);assert.equal(c.redacted,false);}
 }
}finally{f.cleanup();}});



test("opaque short auth arguments do not taint public paths but exact token artifacts remain private",async()=>{
 const f=nativeFixture();try{f.put(join(f.home,'.config/goose/custom_providers/provider.json'),JSON.stringify({auth:{command:'public-command',args:['--scope','xx']},unknown:1,boolean:true}));const r:any=await runIsolatedEvaluation({...f.options,dryRun:false,withSkills:['one']});assert.equal(r.status,'succeeded',JSON.stringify(r));assert.equal(captureEvaluationConfig(f.home).secrets.includes('1'),false);}finally{f.cleanup();}
});

test("external provider references do not block private execution",async()=>{
 const f=nativeFixture();try{f.put(join(f.home,'.config/goose/config.yaml'),yaml.dump({TLS_FILE:join(f.home,'.azure/cert')}));const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.status,'succeeded',JSON.stringify(r));assert.equal(existsSync(f.log),true);}finally{f.cleanup();}
});

test("failure recovery is persisted alongside observed process without relaunch",async()=>{
 const f=nativeFixture();try{const original=readFileSync(f.host,'utf8');writeFileSync(f.host,original.replace('const output=JSON.stringify','process.stderr.write("authentication failed");process.exit(1);const output=JSON.stringify'));const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});const saved=JSON.parse(readFileSync(join(f.options.output,'report.json'),'utf8'));for(const run of saved.runs){assert.equal(run.recovery.retryable,false);assert.equal(run.recovery.action,'user-prerequisite');assert.equal(run.process_result.exit_code,1);}assert.equal(readFileSync(f.log,'utf8').trim().split('\n').map(x=>JSON.parse(x)).filter(x=>x.mode==='run').length,2);}finally{f.cleanup();}
});

test("inherited custom environment reaches both arms without public value dumps",async()=>{
 const f=nativeFixture(),keys=['UNLISTED_PROVIDER_URL','AMBIENT_PRIVATE_CONTEXT','GOOSE_ADDITIONAL_CONFIG_FILES','GOOSE_MOIM_MESSAGE_TEXT'],old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));try{process.env.UNLISTED_PROVIDER_URL='https://synthetic-provider.example';process.env.AMBIENT_PRIVATE_CONTEXT='private-runtime-context';process.env.GOOSE_ADDITIONAL_CONFIG_FILES='/ambient/config.yaml';process.env.GOOSE_MOIM_MESSAGE_TEXT='ambient-prompt';const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.status,'succeeded',JSON.stringify(r));for(const c of readFileSync(f.log,'utf8').trim().split('\n').map(x=>JSON.parse(x))){assert.equal(c.env.UNLISTED_PROVIDER_URL,process.env.UNLISTED_PROVIDER_URL);assert.equal(c.env.AMBIENT_PRIVATE_CONTEXT,process.env.AMBIENT_PRIVATE_CONTEXT);assert.equal(c.env.GOOSE_ADDITIONAL_CONFIG_FILES,undefined);assert.equal(c.env.GOOSE_MOIM_MESSAGE_TEXT,undefined);assert.notEqual(c.home,f.home);}assert(!JSON.stringify(r).includes('https://synthetic-provider.example'));for(const run of r.runs){const receipt=JSON.parse(readFileSync(join(f.options.output,run.task_invocation),'utf8'));assert(!JSON.stringify(receipt).includes('private-runtime-context'));assert(!JSON.stringify(receipt).includes('https://synthetic-provider.example'));}}finally{for(const k of keys)old[k]===undefined?delete process.env[k]:process.env[k]=old[k];f.cleanup();}
});

test("shell startup loaders do not restore external HOME in descendant tools",async()=>{
 const f=fixture(),old=process.env.BASH_ENV;try{const startup=join(f.root,'startup.sh');writeFileSync(startup,'export HOME=/synthetic/external-home\n');process.env.BASH_ENV=startup;const original=readFileSync(f.host,'utf8');writeFileSync(f.host,original.replace('const output=JSON.stringify','const cp=await import("node:child_process");const descendant=cp.spawnSync("/bin/bash",["-c","env"],{encoding:"utf8"});if(process.env.BASH_ENV||!descendant.stdout.split("\\n").includes("HOME="+home))process.exit(8);const output=JSON.stringify'));const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.status,'succeeded',JSON.stringify(r));}finally{old===undefined?delete process.env.BASH_ENV:process.env.BASH_ENV=old;f.cleanup();}
});

test("protocol JSON and HTML include a completely missing planned pair",()=>{
 const f=retainedProtocolFixture("behavioral",2);try{f.state.runs=f.state.runs.filter(r=>r.case_id===0);f.state.campaigns=f.state.campaigns.filter(c=>c.case_id===0);f.saveState();const before=readFileSync(f.log,"utf8");const result=protocolCall(f,["--resume","--output",f.options.output]);assert.equal(result.status,0,result.stdout);const r=JSON.parse(result.stdout).output;assert.equal(r.comparison.coverage.total_groups,2);assert.equal(r.comparison.coverage.missing_or_ungraded,2);assert.match(readFileSync(r.review,"utf8"),/2 total groups/);assert.equal(readFileSync(f.log,"utf8"),before);}finally{f.cleanup();}
});
