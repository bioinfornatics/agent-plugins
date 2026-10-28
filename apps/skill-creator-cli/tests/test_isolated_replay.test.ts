import test from "node:test";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,existsSync,statSync,readdirSync,cpSync} from "node:fs";
import {join,dirname} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync} from "node:child_process";
import {captureEvaluationConfig,stageEvaluationConfig} from "../dist/scripts/evaluation_config.js";
import yaml from "js-yaml";
import {runIsolatedEvaluation} from "../dist/scripts/evaluation_isolated.js";
import {executableIdentity} from "../dist/scripts/evaluation_replay.js";
import {validateTaskEvidence,renderTaskEvidence} from "../dist/scripts/task_evidence.js";
import {nativeFixture,fixture,protocolCall,retainedProtocolFixture,assertNoRetainedSecret,copyRuntime,copiedEvaluation,assertFidelity,replayCli} from "./fixtures/isolated-evaluation.ts";

// Preparation freezes genuine product inputs; rejection needs no original model run.
// Each mutation is restored before the next check, then a pristine preparation proves input restoration.
test("Replay refuses modified inputs before starting a host, then accepts restored preparation",async()=>{
 const f=fixture();try{
  const prepared:any=await runIsolatedEvaluation({...f.options,withSkills:['one']});
  assert.equal(prepared.status,'prepared');assert.equal(prepared.replay.available,true);assert.equal(existsSync(f.log),false);
  const target=join(f.options.output,'replay-inputs/fixtures/input.txt');
  for(const scenario of ['bytes','symlink','host']){
   const changed=scenario==='host'?f.host:target,original=readFileSync(changed);
   try{
    if(scenario==='bytes')writeFileSync(target,'tampered');
    if(scenario==='symlink'){rmSync(target);symlinkSync(join(f.files,'input.txt'),target);}
    if(scenario==='host')writeFileSync(f.host,'process.exit(0)');
    const replay=replayCli(f.options.output);assert.equal(replay.status,2,scenario+replay.stdout+replay.stderr);
    assert.match(replay.stderr,/Replay unavailable/);assert.equal(existsSync(f.log),false,scenario+' must not launch a host');
   }finally{rmSync(changed);writeFileSync(changed,original);}
  }
  const replay=replayCli(f.options.output);assert.equal(replay.status,0,replay.stdout+replay.stderr);
  const result=JSON.parse(replay.stdout);assert.equal(result.status,'prepared');assert.equal(result.runs.length,2);
  assert.equal(existsSync(f.log),false,'restored dry-run remains call-free');
 }finally{f.cleanup();}
});

test("REPLAY selects frozen local plugins and qualified individual skills",async()=>{
 for(const selection of [{pluginPaths:true},{qualified:true}]){const f=nativeFixture();try{
  const r:any=await runIsolatedEvaluation({...f.options,pluginPaths:selection.pluginPaths?[f.plugin]:undefined,withSkills:selection.qualified?['bundle:two']:undefined,dryRun:false});assert.equal(r.status,'succeeded');
  const replay=replayCli(f.options.output,{encoding:'utf8',timeout:15000});assert.equal(replay.status,0,replay.stdout+replay.stderr);assert.deepEqual(JSON.parse(replay.stdout).expected_targets,r.expected_targets);
 }finally{f.cleanup();}}
});

test("sensitive recipe still traces without raw prompt, secret hashes, config or auth argv",async()=>{
 const f=nativeFixture(),key='TRACE_PRIVATE_SECRET_abcdef12345';try{
  f.put(join(f.home,'.config/goose/secrets.yaml'),'API_KEY: '+key);
  writeFileSync(f.host,readFileSync(f.host,'utf8').replace('const log=',"process.argv.splice(2,2);const log="));
  const r:any=await runIsolatedEvaluation({...f.options,prompt:key,command:f.options.command+' --token '+key,dryRun:false});assert.equal(r.replay.available,false);assert.equal(existsSync(join(f.options.output,'replay.sh')),false);assert.equal(r.prompt_sha256,null);
  const trace=readFileSync(join(f.options.output,'baseline/run-1/task-invocation.json'),'utf8');assert(!trace.includes(key));assert(!trace.includes(createHash('sha256').update(key).digest('hex')));assert.equal(JSON.parse(trace).stdin.unavailable_reason,'sensitive-stdin');assert.equal(JSON.parse(trace).argv.unavailable_reason,'sensitive-launcher-arguments');
 }finally{f.cleanup();}
});

test("REPLAY re-resolves current source config and fails on public config drift",async()=>{
 const f=nativeFixture();try{
  f.put(join(f.home,'.config/goose/config.yaml'),'GOOSE_PROVIDER: fixture\nGOOSE_MODEL: original\n');const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.replay.available,true);
  f.put(join(f.home,'.config/goose/config.yaml'),'GOOSE_PROVIDER: fixture\nGOOSE_MODEL: changed\n');const calls=readFileSync(f.log,'utf8');
  const replay=replayCli(f.options.output,{encoding:'utf8',timeout:15000});assert.equal(replay.status,2,replay.stdout+replay.stderr);assert.equal(JSON.parse(replay.stdout).failure.code,'replay-current-configuration-drift');assert.equal(readFileSync(f.log,'utf8'),calls);
 }finally{f.cleanup();}
});

test("TRACE first lifecycle failure wins over the later timeout",async()=>{
 const f=nativeFixture();try{writeFileSync(f.host,`process.on('SIGTERM',()=>{});process.stdout.write(Buffer.from([255]));setInterval(()=>process.stdout.write(Buffer.alloc(2000000)),10);`);const r:any=await runIsolatedEvaluation({...f.options,dryRun:false,timeoutSeconds:.15});assert.equal(r.failure.code,'inventory-invalid-utf8');const receipt=JSON.parse(readFileSync(join(f.options.output,'baseline/run-1/discovery-invocation.json'),'utf8'));assert.equal(receipt.result.exit_reason,'invalid-utf8');assert(receipt.result.stdout_bytes>0);}finally{f.cleanup();}
});

test("TRACE result capture failure cannot turn child success into evaluation success",async()=>{
 const f=nativeFixture();try{
  const original=readFileSync(f.host,'utf8');writeFileSync(f.host,original.replace('const output=JSON.stringify',`const receipt=path.join(${JSON.stringify(f.options.output)},'baseline/run-1/task-invocation.json');fs.rmSync(receipt);fs.symlinkSync(${JSON.stringify(join(f.root,'protected.txt'))},receipt);const output=JSON.stringify`));writeFileSync(join(f.root,'protected.txt'),'preserve');
  const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.failure.code,'invocation-result-capture-failed');assert.equal(r.runs[0].capture_status,'failed');assert.equal(r.runs[0].process_result.exit_code,0);assert.equal(r.exit_code,1);assert.equal(readFileSync(join(f.root,'protected.txt'),'utf8'),'preserve');
 }finally{f.cleanup();}
});

test("Selected Skill tutorial bytes and names are not scanned as credentials",async()=>{
 const f=fixture(),tutorial='sk-sensitiveTargetValue123456789';try{
  const resource=join(f.home,'.agents/skills/nested/one/references',tutorial+'.txt');
  f.put(resource,'Bearer example-token '+tutorial);
  f.put(join(f.home,'.config/goose/config.yaml'),'PUBLIC_LABEL: Test instructions.');
  const before=readFileSync(resource);
  const r:any=await runIsolatedEvaluation({...f.options,withSkills:['one']});
  assert.equal(r.status,'prepared');assert.equal(r.exit_code,0);
  assert.deepEqual(readFileSync(resource),before);
  const manifest=r.manifests[0];
  assert.ok(manifest.files.some((file:any)=>file.path==='references/'+tutorial+'.txt'&&file.sha256===createHash('sha256').update(before).digest('hex')));
  assert.equal(existsSync(f.log),false,'preparation does not launch a host');
 }finally{f.cleanup();}
});

test("R2 F2 ambiguous auth arguments fail closed without execution",async()=>{for(const flag of ['--token','--token=','--token --other','--client-secret-file opaque']){const f=fixture();try{const r:any=await runIsolatedEvaluation({...f.options,command:f.options.command+' '+flag});assert.equal(r.exit_code,2);assert.equal(r.failure.code,'uncertain-auth-arguments');assert.equal(existsSync(f.log),false);}finally{f.cleanup();}}});

// One prepared runtime is sufficient for independent pre-import corruption checks.
// No mutable test target is shared with another test or left changed between cases.
test("Replay rejects changed runtime files before importing candidate code",async()=>{
 const f=nativeFixture();try{
  const app=copyRuntime(f,true),prepared:any=await copiedEvaluation(app,f.options);
  assert.equal(prepared.status,'prepared');assert.equal(prepared.replay.available,true);assert.equal(existsSync(f.log),false);
  for(const file of ['dist/scripts/durable_file.js','node_modules/js-yaml/dist/js-yaml.mjs','node_modules/js-yaml/package.json','package.json','scripts/evaluation_isolated.ts','node_modules/argparse/argparse.js','node_modules/js-yaml/node_modules/argparse/index.js']){
   const marker=join(f.root,'executed-marker'),target=join(app,file),present=existsSync(target),original=present?readFileSync(target):undefined;
   let createdRoot=target;if(!present){while(!existsSync(dirname(createdRoot)))createdRoot=dirname(createdRoot);}
   try{
    if(file.endsWith('.json')){const data=JSON.parse(original!.toString());data.type='commonjs';writeFileSync(target,JSON.stringify(data));}
    else{
     const esm=file.endsWith('.mjs')||file==='dist/scripts/durable_file.js';
     f.put(target,(esm?"import * as r2fs from 'node:fs';r2fs.writeFileSync("+JSON.stringify(marker)+",'executed');"+String.fromCharCode(10):"require('node:fs').writeFileSync("+JSON.stringify(marker)+",'executed');"+String.fromCharCode(10))+(original?.toString()??''));
     if(!file.startsWith('scripts/')){
      const control=spawnSync(process.execPath,['--input-type=module','-e','await import('+JSON.stringify('file://'+target)+')'],{encoding:'utf8'});
      assert.equal(control.status,0,control.stderr);assert.equal(existsSync(marker),true,'executable marker control');rmSync(marker);
     }
    }
    const replay=replayCli(f.options.output,{cwd:f.root});assert.equal(replay.status,2,file+replay.stdout+replay.stderr);
    assert.match(replay.stderr,/Replay unavailable: replay-/);assert(!replay.stderr.includes(' at '));
    assert.equal(existsSync(marker),false,file);assert.equal(existsSync(f.log),false,file+' must not launch a host');
   }finally{if(present){writeFileSync(target,original!);}else rmSync(createdRoot,{recursive:true,force:true});rmSync(marker,{force:true});}
  }
  const restored=replayCli(f.options.output);assert.equal(restored.status,0,restored.stdout+restored.stderr);assert.equal(JSON.parse(restored.stdout).status,'prepared');assert.equal(existsSync(f.log),false);
 }finally{f.cleanup();}
});

test("R2 F4 installed runtime without authoring scripts replays from foreign cwd",async()=>{const f=nativeFixture();try{const app=copyRuntime(f);writeFileSync(join(app,"package.json"),JSON.stringify({name:"installed-runtime",type:"module",private:true}));const r:any=await copiedEvaluation(app,{...f.options,dryRun:false});assert.equal(r.replay.available,true);const replay=replayCli(f.options.output,{cwd:'/',encoding:'utf8',timeout:15000});assert.equal(replay.status,0,replay.stdout+replay.stderr);assert.equal(JSON.parse(replay.stdout).attempt_kind,'replay');}finally{f.cleanup();}});

test("R2 F5 PATH symlink launcher binds requested and resolved paths",async()=>{const f=fixture(),old=process.env.PATH;try{const bin=join(f.root,'bin');mkdirSync(bin);symlinkSync(process.execPath,join(bin,'fixture-node'));process.env.PATH=bin+':'+old;const r:any=await runIsolatedEvaluation({...f.options,command:'fixture-node '+f.host,dryRun:false});assert.equal(r.replay.available,true);const recipe=JSON.parse(readFileSync(join(f.options.output,'replay-recipe.json'),'utf8'));assert.equal(recipe.executable.requested,join(bin,'fixture-node'));assert.equal(recipe.executable.resolved,process.execPath);const replay=replayCli(f.options.output,{cwd:'/',encoding:'utf8',timeout:15000});assert.equal(replay.status,0,replay.stdout+replay.stderr);}finally{process.env.PATH=old;f.cleanup();}});

test("Replay reports malformed recipes and missing runtime modules without stack traces",async()=>{
 const f=nativeFixture();try{
  const app=copyRuntime(f,true),prepared:any=await copiedEvaluation(app,f.options);assert.equal(prepared.replay.available,true);assert.equal(existsSync(f.log),false);
  for(const kind of ['recipe','module']){
   const file=kind==='recipe'?join(f.options.output,'replay-recipe.json'):join(app,'dist/scripts/evaluation_replay.js'),original=readFileSync(file);
   try{
    if(kind==='recipe')writeFileSync(file,'private malformed data');else rmSync(file);
    const replay=replayCli(f.options.output);assert.equal(replay.status,2);assert.match(replay.stderr,/^Replay unavailable: replay-[a-z-]+\n$/);assert.equal(replay.stdout,'');assert.equal(existsSync(f.log),false);
   }finally{writeFileSync(file,original);}
  }
  const restored=replayCli(f.options.output);assert.equal(restored.status,0,restored.stdout+restored.stderr);assert.equal(JSON.parse(restored.stdout).status,'prepared');
 }finally{f.cleanup();}
});

test("R2 F5 relative and empty PATH entries resolve against the actual spawn cwd",()=>{const f=fixture();try{const bin=join(f.root,'bin');mkdirSync(bin);symlinkSync(process.execPath,join(bin,'fixture-node'));for(const [cwd,path] of [[f.root,'bin'],[bin,'']]){const identity:any=executableIdentity('fixture-node',{PATH:path},cwd);const child=spawnSync('fixture-node',['-e','process.stdout.write("executed")'],{cwd,env:{PATH:path},encoding:'utf8'});assert.equal(child.status,0,JSON.stringify(child.error));assert.equal(identity.available,true);assert.equal(identity.requested,join(bin,'fixture-node'));assert.equal(child.stdout,'executed');}}finally{f.cleanup();}});

test("R2 F3 dependency symlink substitution rejects without importing external code",async()=>{const f=nativeFixture();try{const app=copyRuntime(f),r:any=await copiedEvaluation(app,{...f.options,dryRun:false});assert.equal(r.replay.available,true);const module=join(app,'node_modules/js-yaml/dist/js-yaml.mjs'),external=join(f.root,'external.mjs'),marker=join(f.root,'marker');writeFileSync(external,`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'executed');`);rmSync(module);symlinkSync(external,module);const child=replayCli(f.options.output,{encoding:'utf8',timeout:15000});assert.equal(child.status,2);assert.equal(child.stderr,'Replay unavailable: replay-unsafe-symlink\n');assert.equal(existsSync(marker),false);}finally{f.cleanup();}});

test("R2 F3 installed production closure includes all contained modules",async()=>{const f=nativeFixture();try{const app=copyRuntime(f);writeFileSync(join(app,'package.json'),JSON.stringify({type:'module'}));f.put(join(app,'node_modules/extra/package.json'),JSON.stringify({name:'extra',main:'index.js'}));f.put(join(app,'node_modules/extra/index.js'),'module.exports={};');const r:any=await copiedEvaluation(app,{...f.options,dryRun:false});assert.equal(r.replay.available,true);const recipe=JSON.parse(readFileSync(join(f.options.output,'replay-recipe.json'),'utf8'));assert(recipe.runtime.closure.modules.some((x:any)=>x.root===join(app,'node_modules/extra')));writeFileSync(join(app,'node_modules/extra/index.js'),'module.exports={changed:true};');const child=replayCli(f.options.output,{encoding:'utf8',timeout:15000});assert.equal(child.status,2);assert.equal(child.stderr,'Replay unavailable: replay-runtime-drift\n');}finally{f.cleanup();}});

// Two loader journeys cover the distinct ESM and CommonJS resolution rules.
// ESM mutations share a prepared graph, but never a mutated filesystem state.
test("Prepared replay binds imports, reexports, CommonJS and package resolution before host execution",async()=>{
 for(const loader of ['esm','commonjs']){
  const f=fixture();try{
   const helper=join(f.root,loader==='commonjs'?'helper.cjs':'helper.mjs');
   writeFileSync(helper,loader==='commonjs'?'exports.value="original-helper";':'export const value="original-helper";');
   if(loader==='commonjs'){
    const host=join(f.root,'host.cjs');writeFileSync(host,'const {value}=require("./helper.cjs");'+readFileSync(f.host,'utf8'));f.options.command=process.execPath+' '+host;
   }else{
    f.put(join(f.root,'reexported.mjs'),'export const value="original-helper";');
    f.put(join(f.root,'bridge.mjs'),'export {value} from "./reexported.mjs";');
    f.put(join(f.root,'node_modules/helper-package/package.json'),JSON.stringify({name:'helper-package',type:'module',exports:'./index.mjs',dependencies:{'nested-helper':'1'}}));
    f.put(join(f.root,'node_modules/helper-package/index.mjs'),'export {value} from "nested-helper";');
    f.put(join(f.root,'node_modules/nested-helper/package.json'),JSON.stringify({name:'nested-helper',type:'module',exports:'./index.mjs'}));
    f.put(join(f.root,'node_modules/nested-helper/index.mjs'),'export const value="original-helper";');
    writeFileSync(f.host,'import {value} from "./helper.mjs";import {value as bridged} from "./bridge.mjs";import {value as packaged} from "helper-package";'+readFileSync(f.host,'utf8'));
   }
   const prepared:any=await runIsolatedEvaluation(f.options);assert.equal(prepared.status,'prepared');assert.equal(prepared.replay.available,true);assert.equal(existsSync(f.log),false);
   const seams=loader==='commonjs'?['require']:['import','reexport','package','package-manifest','resolution-shadow'];
   for(const seam of seams){
    const shadow=join(f.root,'node_modules/helper-package/node_modules');
    const target=seam==='reexport'?join(f.root,'reexported.mjs'):seam==='package'?join(f.root,'node_modules/nested-helper/index.mjs'):seam==='package-manifest'?join(f.root,'node_modules/helper-package/package.json'):helper;
    const original=readFileSync(target);
    try{
     if(seam==='package-manifest')writeFileSync(target,JSON.stringify({type:'module',exports:'./other.mjs'}));
     else if(seam==='resolution-shadow'){
      f.put(join(shadow,'nested-helper/package.json'),JSON.stringify({type:'module',exports:'./index.mjs'}));
      f.put(join(shadow,'nested-helper/index.mjs'),'export const value="SHADOW-helper";');
     }else writeFileSync(target,seam==='require'?'exports.value="CHANGED-helper";':'export const value="CHANGED-helper";');
     const replay=replayCli(f.options.output);assert.equal(replay.status,2,seam+replay.stdout+replay.stderr);assert.equal(existsSync(f.log),false,seam+' must not launch a host');
    }finally{writeFileSync(target,original);rmSync(shadow,{recursive:true,force:true});}
   }
   const control=replayCli(f.options.output);assert.equal(control.status,0,control.stdout+control.stderr);assert.equal(JSON.parse(control.stdout).status,'prepared');assert.equal(existsSync(f.log),false);
  }finally{f.cleanup();}
 }
});

test("R9-2 computed modules and shell wrappers explicitly cannot replay",async()=>{for(const seam of ['import','require','shell']){const f=fixture();try{
 if(seam==='import')writeFileSync(f.host,'const helper="node:fs";await import(helper);'+readFileSync(f.host,'utf8'));
 if(seam==='require'){const host=join(f.root,'host.cjs');writeFileSync(host,'const helper="node:fs";require(helper);'+readFileSync(f.host,'utf8'));f.options.command=process.execPath+' '+host;}
 if(seam==='shell'){const wrapper=join(f.root,'bash');writeFileSync(wrapper,Buffer.concat([readFileSync(process.execPath),Buffer.from('fake-shell-fixture')]),{mode:0o700});f.options.command=wrapper+' '+f.host;}
 const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.status,'succeeded');assert.equal(r.replay.available,false);assert.equal(existsSync(join(f.options.output,'replay.sh')),false);
 }finally{f.cleanup();}}});

// A single real campaign documents the boundary: public settings are bound,
// while credentials are re-resolved privately. Restore each override independently.
test("Replay binds public environment but re-resolves credentials without retaining them",async()=>{
 const f=nativeFixture(),keys=['GOOSE_MODEL','GOOSE_PROVIDER','LANG','OPENAI_API_KEY'];
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 try{
  for(const key of keys)process.env[key]=key==='OPENAI_API_KEY'?'opaque-original-credential-987654321':'original-safe-value';
  const original:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(original.status,'succeeded');assert.equal(original.replay.available,true);
  const calls=readFileSync(f.log,'utf8');assertNoRetainedSecret(f.options.output,'opaque-original-credential-987654321');
  for(const key of keys){
   try{
    process.env[key]=key==='OPENAI_API_KEY'?'opaque-replacement-credential-123456789':'changed-safe-value';
    const replay=replayCli(f.options.output);assert.equal(replay.status,key==='OPENAI_API_KEY'?0:2,key+replay.stdout+replay.stderr);
    if(key!=='OPENAI_API_KEY'){assert.equal(JSON.parse(replay.stdout).failure.code,'replay-current-environment-drift');assert.equal(readFileSync(f.log,'utf8'),calls);}
    else{
     const fresh=JSON.parse(replay.stdout);assert.equal(fresh.status,'succeeded');assert.equal(fresh.runs.length,2);
     assert(!replay.stdout.includes(process.env[key]!));assertNoRetainedSecret(fresh.output,process.env[key]!);
    }
   }finally{process.env[key]=key==='OPENAI_API_KEY'?'opaque-original-credential-987654321':'original-safe-value';}
  }
 }finally{for(const key of keys)previous[key]===undefined?delete process.env[key]:process.env[key]=previous[key];f.cleanup();}
});

test("R9-3 CLI model override binds effective rather than shadowed ambient environment",async()=>{const f=nativeFixture(),old=process.env.GOOSE_MODEL;try{process.env.GOOSE_MODEL='shadowed-original';const r:any=await runIsolatedEvaluation({...f.options,model:'effective-model',dryRun:false});assert.equal(r.replay.available,true);process.env.GOOSE_MODEL='shadowed-changed';const replay=replayCli(f.options.output,{encoding:'utf8',timeout:15000});assert.equal(replay.status,0,replay.stdout+replay.stderr);}finally{old===undefined?delete process.env.GOOSE_MODEL:process.env.GOOSE_MODEL=old;f.cleanup();}});

test("public auth command reused in locator does not taint execution",async()=>{const f=nativeFixture();try{f.put(join(f.home,'.config/goose/custom_providers/provider.json'),JSON.stringify({auth:{command:'fixture'}}));const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.exit_code,0);assert.equal(r.status,'succeeded');assert.equal(existsSync(f.log),true);}finally{f.cleanup();}});

test("R9-2 interpolated module templates and aliased require are unavailable",async()=>{for(const seam of ['template','alias']){const f=fixture();try{if(seam==='template')writeFileSync(f.host,'const text=`${await import("node:fs").then(()=>"loaded")}`;'+readFileSync(f.host,'utf8'));else{const host=join(f.root,'host.cjs');writeFileSync(host,'const load=require;load("node:fs");'+readFileSync(f.host,'utf8'));f.options.command=process.execPath+' '+host;}const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.status,'succeeded');assert.equal(r.replay.available,false);assert.equal(existsSync(join(f.options.output,'replay.sh')),false);}finally{f.cleanup();}}});
