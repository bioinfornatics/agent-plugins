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
import {executableIdentity} from "../dist/scripts/evaluation_replay.js";
import {validateTaskEvidence,renderTaskEvidence} from "../dist/scripts/task_evidence.js";
import {nativeFixture as fixture,protocolCall,retainedProtocolFixture,assertNoRetainedSecret,copyRuntime,copiedEvaluation,assertFidelity,replayCli} from "./fixtures/isolated-evaluation.ts";

test("retained resume fixture validates complete coverage, envelope/output binding and duplicate slots",()=>{
 const f=retainedProtocolFixture("activation",2);try{
  const before=readFileSync(f.log,"utf8"),resume=()=>protocolCall(f,["--resume","--output",f.options.output]);
  const complete=resume();assert.equal(complete.status,0,complete.stdout+complete.stderr);assert.equal(JSON.parse(complete.stdout).output.status,"complete");assert.deepEqual(JSON.parse(complete.stdout).output.missing_runs,[]);
  const stateFile=join(f.options.output,"run.json"),envelope=JSON.parse(readFileSync(stateFile,"utf8"));envelope.state.cases[0].prompt="drift";writeFileSync(stateFile,JSON.stringify(envelope));
  const drift=resume();assert.equal(drift.status,2);assert.match(drift.stdout,/Frozen run state drift/);f.saveState();
  const result=join(f.options.output,f.state.runs[0].directory,"outputs/result.txt");writeFileSync(result,"changed");const outputDrift=resume();assert.equal(outputDrift.status,2);assert.match(outputDrift.stdout,/Retained output drift/);writeFileSync(result,"original");
  const evidence=join(f.options.output,f.state.runs[0].directory,"outputs/task-evidence.json"),originalEvidence=readFileSync(evidence,"utf8");writeFileSync(evidence,originalEvidence+" ");const evidenceDrift=resume();assert.equal(evidenceDrift.status,2);assert.match(evidenceDrift.stdout,/Task evidence drift/);writeFileSync(evidence,originalEvidence);
  f.state.runs.push({...f.state.runs[0]});f.saveState();const duplicate=resume();assert.equal(duplicate.status,2);assert.match(duplicate.stdout,/Duplicate frozen run slot/);assert.equal(readFileSync(f.log,"utf8"),before);
 }finally{f.cleanup();}
});

test("resume recovers summary after independent response was persisted",()=>{
 const f=retainedProtocolFixture("behavioral");try{const before=readFileSync(f.log,"utf8"),r=protocolCall(f,["--resume","--output",f.options.output]);assert.equal(r.status,0,r.stdout);assert.equal(readFileSync(f.log,"utf8"),before);const report=JSON.parse(r.stdout).output;assert.equal(report.status,"awaiting-grading");assert.equal(report.grading_requests.length,2);
 for(const entry of report.grading_requests){const request=JSON.parse(readFileSync(entry.request_path,"utf8"));const state=JSON.parse(readFileSync(join(f.options.output,"run.json"),"utf8")).state;const run=state.runs.find((x:any)=>request.request_id===createHash("sha256").update(JSON.stringify({runDir:join(f.options.output,x.directory),output:[{label:"artifact-1",content:readFileSync(join(f.options.output,x.directory,"outputs/result.txt"),"utf8")}],expectations:["Outputs input"]})).digest("hex"));assert(run);writeFileSync(join(f.options.output,run.directory,"grading-response.json"),JSON.stringify({request_id:request.request_id,judgments:[{text:"Outputs input",verdict:"pass",evidence_quote:"original",rationale:"The displayed response contains the original input."}]}));}
 const resumed=protocolCall(f,["--resume","--output",f.options.output]);assert.equal(resumed.status,0,resumed.stdout);const final=JSON.parse(resumed.stdout).output;assert.equal(final.status,"complete");assert.equal(final.comparison.complete_pairs,1);assert.equal(final.comparison.criteria.both_pass,1);const html=readFileSync(final.review,"utf8");assert.match(html,/1 fully graded pairs/);assert.match(html,/with_skill/);assert.match(html,/without_skill/);assert.match(html,/Outputs input/);assert.match(html,/The displayed response contains the original input/);assert.equal(final.grading_requests.length,0);assert.equal(readFileSync(f.log,"utf8"),before);
 }finally{f.cleanup();}
});

test("conflicting criterion aliases fail before provider launch",()=>{
 const f=fixture();try{const evalset=join(f.root,"bad.json");writeFileSync(evalset,JSON.stringify({evals:[{id:0,prompt:"Task",expectations:["a"],assertions:["b"]}]}));const r=protocolCall(f,["--eval-set",evalset,"--with-skills","one","--source-home",f.home,"--output",f.options.output,"--goose-command",f.options.command]);assert.equal(r.status,2);assert.equal(existsSync(f.log),false);assert.equal(existsSync(f.options.output),false);}finally{f.cleanup();}
});

test("recursive Goose configuration transport preserves providers and only selected private plugins",()=>{
 const f=fixture();try{
  const config=join(f.home,".config/goose");const secret="synthetic-sensitive-secret-123";
  f.put(join(config,"config.yaml"),'active_provider: azure_foundry\nAZURE_FOUNDRY_ENDPOINT: https://resource.services.ai.azure.com\nAZURE_FOUNDRY_MODEL: test-model\nAZURE_FOUNDRY_API_KEY: '+secret+'\nextensions:\n  ambient: bad\nplugins:\n  /original/plugin:\n    enabled: true\nGOOSE_MOIM_MESSAGE_TEXT: ambient\nproviders:\n  azure_foundry:\n    model: test-model\n');
  f.put(join(config,"custom_providers/provider.json"),'{"name":"test","url":"https://example.test"}');f.put(join(config,"secrets.yaml"),'custom-provider-key: '+secret);f.put(join(config,"tls/certificate.pem"),"certificate");f.put(join(config,"skills/ambient/SKILL.md"),"ambient");f.put(join(config,"prompts/system.txt"),"ambient");f.put(join(config,"settings.json"),'{"disabledPlugins":["bundle"]}');
  const capture=captureEvaluationConfig(f.home);assert(!capture.publicConfig.includes(secret));assert(!JSON.stringify({binding:capture.binding,publicConfig:capture.publicConfig}).includes(createHash("sha256").update(secret).digest("hex")));
  const fake=join(f.root,"fake");stageEvaluationConfig(capture,fake,["bundle"]);const v:any=yaml.load(readFileSync(join(fake,".config/goose/config.yaml"),"utf8"));assert.equal(v.AZURE_FOUNDRY_ENDPOINT,"https://resource.services.ai.azure.com");assert.equal(v.AZURE_FOUNDRY_API_KEY,secret);assert.deepEqual(Object.keys(v.plugins),[join(fake,".agents/plugins/bundle")]);assert.equal(v.extensions,undefined);assert.equal(v.GOOSE_MOIM_MESSAGE_TEXT,undefined);assert(existsSync(join(fake,".config/goose/tls/certificate.pem")));assert(existsSync(join(fake,".config/goose/custom_providers/provider.json")));assert(!existsSync(join(fake,".config/goose/skills")));assert(!existsSync(join(fake,".config/goose/prompts")));assert.equal(statSync(join(fake,".config/goose/secrets.yaml")).mode&0o777,0o600);
  const b=join(f.root,"baseline");stageEvaluationConfig(capture,b,[]);assert.deepEqual((yaml.load(readFileSync(join(b,".config/goose/config.yaml"),"utf8")) as any).plugins,{});
 }finally{f.cleanup();}
});

test("provider requirements are resolved by Goose, not evaluator preflights",async()=>{
 const f=fixture(),old=process.env.AZURE_FOUNDRY_ENDPOINT;try{delete process.env.AZURE_FOUNDRY_ENDPOINT;const r:any=await runIsolatedEvaluation({...f.options,dryRun:false,provider:"azure_foundry"});assert.equal(r.status,"succeeded",JSON.stringify(r));assert.equal(r.runs.length,2);assert(existsSync(f.log));}finally{old===undefined?delete process.env.AZURE_FOUNDRY_ENDPOINT:process.env.AZURE_FOUNDRY_ENDPOINT=old;f.cleanup();}
});

test("generic provider settings and same-session keyring access survive fake HOME",async()=>{
 const f=fixture(),keys=["DBUS_SESSION_BUS_ADDRESS","GOOSE_DISABLE_KEYRING","CUSTOM_VENDOR_REGION"],old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));try{
  process.env.DBUS_SESSION_BUS_ADDRESS="unix:path=/synthetic/session/bus";delete process.env.GOOSE_DISABLE_KEYRING;process.env.CUSTOM_VENDOR_REGION="env-region";
  f.put(join(f.home,".config/goose/config.yaml"),'active_provider: custom_vendor\nCUSTOM_VENDOR_REGION: stored-region\nCUSTOM_VENDOR_ENDPOINT: https://vendor.example.test\nproviders:\n  custom_vendor:\n    model: custom-model\n    max_tokens: 512\n    options:\n      arbitrary_parameter: preserved\nplugins:\n  /ambient/plugin:\n    enabled: true\nextensions:\n  ambient: bad\n');
  const original=readFileSync(f.host,"utf8");writeFileSync(f.host,original.replace('const output=JSON.stringify','const cfg=fs.readFileSync(path.join(home,".config/goose/config.yaml"),"utf8");if(process.env.GOOSE_DISABLE_KEYRING!==undefined||process.env.DBUS_SESSION_BUS_ADDRESS!=="unix:path=/synthetic/session/bus"||process.env.CUSTOM_VENDOR_REGION!=="env-region"||!cfg.includes("arbitrary_parameter: preserved")||!cfg.includes("CUSTOM_VENDOR_ENDPOINT: https://vendor.example.test"))process.exit(8);const output=JSON.stringify'));
  const r:any=await runIsolatedEvaluation({...f.options,dryRun:false,withSkills:["one"],model:"selected-model"});assert.equal(r.status,"succeeded",JSON.stringify(r));
  const calls=readFileSync(f.log,"utf8").trim().split("\n").map(s=>JSON.parse(s));for(const c of calls){assert.equal(c.env.DBUS_SESSION_BUS_ADDRESS,process.env.DBUS_SESSION_BUS_ADDRESS);assert.equal(c.env.GOOSE_DISABLE_KEYRING,undefined);assert.equal(c.env.CUSTOM_VENDOR_REGION,"env-region");assert.notEqual(c.home,f.home);assert.equal(c.env.GOOSE_MODEL,"selected-model");}
  assert(!JSON.stringify(r).includes("/synthetic/session/bus"));assert(!existsSync(join(f.home,".config/goose/secrets.yaml")));
 }finally{for(const k of keys)old[k]===undefined?delete process.env[k]:process.env[k]=old[k];f.cleanup();}
});

test("Foundry env and recursive stored config reach both arms without secret leakage",async()=>{
 const f=fixture();const keys=["AZURE_FOUNDRY_ENDPOINT","AZURE_FOUNDRY_API_KEY","AZURE_FOUNDRY_API_VERSION"],old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));try{
  Object.assign(process.env,{AZURE_FOUNDRY_ENDPOINT:"https://env.services.ai.azure.com",AZURE_FOUNDRY_API_KEY:"sensitive-env-key-abcdef",AZURE_FOUNDRY_API_VERSION:"v1"});f.put(join(f.home,".config/goose/config.yaml"),'active_provider: azure_foundry\nAZURE_FOUNDRY_ENDPOINT: https://stored.services.ai.azure.com\n');f.put(join(f.home,".config/goose/secrets.yaml"),'OTHER_SECRET: stored-secret-abcdef');const original=readFileSync(f.host,"utf8");writeFileSync(f.host,original.replace('const output=JSON.stringify','if(process.env.AZURE_FOUNDRY_ENDPOINT!=="https://env.services.ai.azure.com"||!fs.existsSync(path.join(home,".config/goose/secrets.yaml")))process.exit(8);const output=JSON.stringify'));
  const r:any=await runIsolatedEvaluation({...f.options,dryRun:false,withSkills:["one"],model:"fixture-model"});assert.equal(r.status,"succeeded",JSON.stringify(r));const serialized=JSON.stringify(r);assert(!serialized.includes("sensitive-env-key-abcdef"));assert(!serialized.includes("stored-secret-abcdef"));assert(!serialized.includes(createHash("sha256").update('OTHER_SECRET: stored-secret-abcdef').digest("hex")));for(const run of r.runs)assert(!run.installed_home_files.some((x:any)=>x.path.startsWith(".config/")));
 }finally{for(const k of keys)old[k]===undefined?delete process.env[k]:process.env[k]=old[k];f.cleanup();}
});

test("failed stdout and stderr retain safe structured diagnostics",async()=>{
 for(const channel of ["stdout","stderr"]){const f=fixture();try{const original=readFileSync(f.host,"utf8");writeFileSync(f.host,original.replace('const output=JSON.stringify','process.'+channel+'.write("Error Configuration value not found: AZURE_FOUNDRY_ENDPOINT. leaked sensitive-stdout-key");process.exit(1);const output=JSON.stringify'));const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.exit_code,1);for(const run of r.runs){assert.equal(run.diagnostic.parameter,"AZURE_FOUNDRY_ENDPOINT");assert.equal(run.diagnostic.source,channel);assert.equal(run.signal,null);}assert(!JSON.stringify(r).includes("sensitive-stdout-key"));}finally{f.cleanup();}}
});

test("invalid UTF8 and excessive stderr fail closed without payload retention",async()=>{
 for(const mode of ["utf8","oversize"]){const f=fixture();try{const original=readFileSync(f.host,"utf8");writeFileSync(f.host,original.replace('const output=JSON.stringify',mode==="utf8"?'process.stderr.write(Buffer.from([0xff]));process.exit(1);const output=JSON.stringify':'process.stderr.write("secret-content".repeat(2*1024*1024));setInterval(()=>{},1000);const output=JSON.stringify'));const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.exit_code,1);assert(r.runs.every((x:any)=>x.exit_reason===(mode==="utf8"?"invalid-utf8":"output-limit")));assert(!JSON.stringify(r).includes("secret-content"));}finally{f.cleanup();}}
});

test("opaque auth fragments and secret artifact names are never retained",async()=>{
 for(const scenario of ["fragment","path"]){const f=fixture();try{
  const secret="SYNTHETIC_PRIVATE_BODY_abcdefghijkl";f.put(join(f.home,".config/goose/tls/private.pem"),"-----BEGIN PRIVATE KEY-----\n"+secret+"\n-----END PRIVATE KEY-----\n");const original=readFileSync(f.host,"utf8");const code=scenario==="path"?'fs.writeFileSync(path.join(cwd,"'+secret+'"),"");const output=JSON.stringify':'console.log(JSON.stringify({type:"message",message:{role:"assistant",content:[{type:"text",text:"'+secret+'"}]}}));console.log(JSON.stringify({type:"complete"}));return;const output=JSON.stringify';writeFileSync(f.host,original.replace('const output=JSON.stringify',code));const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert(!JSON.stringify(r).includes(secret));assert(!readFileSync(join(f.options.output,"report.json"),"utf8").includes(secret));if(scenario==="path"){assert.equal(r.exit_code,1);assert(!existsSync(join(f.options.output,"baseline/run-1/outputs/artifacts",secret)));}else assert.equal(r.runs[0].output,"[REDACTED]");
 }finally{f.cleanup();}}
});

test("provider options containing prompt/context are preserved while ambient config is removed",()=>{
 const f=fixture();try{f.put(join(f.home,".config/goose/config.yaml"),'CUSTOM_PROMPT_CACHE: true\nCONTEXT_FILE_NAMES: [ambient]\nGOOSE_HINTS: contaminated\nproviders:\n  custom:\n    prompt_cache_enabled: true\n    context_window: 12345\n    options:\n      prompt_format: vendor-native\n      context: 6789\n');const c=captureEvaluationConfig(f.home);const v:any=yaml.load(c.privateConfig);assert.equal(v.CUSTOM_PROMPT_CACHE,true);assert.equal(v.CONTEXT_FILE_NAMES,undefined);assert.equal(v.GOOSE_HINTS,undefined);assert.deepEqual(v.providers.custom,{prompt_cache_enabled:true,context_window:12345,options:{prompt_format:"vendor-native",context:6789}}); }finally{f.cleanup();}
});

test("opaque JSON support scalar cannot leak as response or artifact path",async()=>{
 for(const scenario of ["response","path"]){const f=fixture();try{const secret="SYNTHETIC_OPAQUE_CREDENTIAL_abcdef12345";f.put(join(f.home,".config/goose/custom_providers/provider.json"),JSON.stringify({opaque:secret}));assert(captureEvaluationConfig(f.home).secrets.includes(secret));const original=readFileSync(f.host,"utf8");const code=scenario==="path"?'fs.writeFileSync(path.join(cwd,"'+secret+'"),"");const output=JSON.stringify':'console.log(JSON.stringify({type:"message",message:{role:"assistant",content:[{type:"text",text:"'+secret+'"}]}}));console.log(JSON.stringify({type:"complete"}));return;const output=JSON.stringify';writeFileSync(f.host,original.replace('const output=JSON.stringify',code));const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert(!JSON.stringify(r).includes(secret));assert(!readFileSync(join(f.options.output,"report.json"),"utf8").includes(secret));if(scenario==="path"){assert.equal(r.exit_code,1);assert(!existsSync(join(f.options.output,"baseline/run-1/outputs/artifacts",secret)));}else assert.equal(r.runs[0].output,"[REDACTED]");}finally{f.cleanup();}}
});

test("operator keyring disable is respected without restoring real HOME",async()=>{
 const f=fixture(),old=process.env.GOOSE_DISABLE_KEYRING;try{process.env.GOOSE_DISABLE_KEYRING="1";const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.status,"succeeded",JSON.stringify(r));for(const c of readFileSync(f.log,"utf8").trim().split("\n").map(x=>JSON.parse(x))){assert.equal(c.env.GOOSE_DISABLE_KEYRING,"1");assert.notEqual(c.home,f.home);}}finally{old===undefined?delete process.env.GOOSE_DISABLE_KEYRING:process.env.GOOSE_DISABLE_KEYRING=old;f.cleanup();}
});

test("private support scalar repeated as config mapping key never enters public binding",()=>{
 const f=fixture();try{const secret="opaque-value-abcdef12345";f.put(join(f.home,".config/goose/support.json"),JSON.stringify({opaque:secret}));f.put(join(f.home,".config/goose/config.yaml"),yaml.dump({providers:{custom:{options:{[secret]:"vendor-option"}}}}));const c=captureEvaluationConfig(f.home);assert(c.privateConfig.includes(secret));assert(!c.publicConfig.includes(secret));assert.equal(c.binding,createHash("sha256").update(c.publicConfig).digest("hex"));f.put(join(f.home,".config/goose/support.json"),JSON.stringify({opaque:"other-value-abcdef12345"}));f.put(join(f.home,".config/goose/config.yaml"),yaml.dump({providers:{custom:{options:{"other-value-abcdef12345":"vendor-option"}}}}));assert.equal(captureEvaluationConfig(f.home).binding,c.binding);}finally{f.cleanup();}
});

test("local plugin path selects source bytes without ambient catalog or installation mutation",async()=>{
 const f=fixture();try{
  const source=join(f.root,"local-plugin");f.put(join(source,"plugin.json"),JSON.stringify({name:"local"}));f.skill(join(source,"skills/worker"),"worker");f.put(join(source,"hooks/hooks.json"),"{}");
  // An unrelated broken installation must not prevent an explicit source selection.
  f.put(join(f.home,".agents/plugins/unrelated/plugin.json"),"invalid");
  const r:any=await runIsolatedEvaluation({...f.options,pluginPaths:[source],dryRun:false} as any);
  assert.equal(r.status,"succeeded",JSON.stringify(r));assert.deepEqual(r.expected_targets,["local:worker"]);
  assert.equal(r.manifests[0].source,source);assert.equal(r.manifests[0].kind,"plugin");
  assert.deepEqual(r.runs.map((x:any)=>x.inventory.filter((i:any)=>!i.builtin).map((i:any)=>i.name)),[[],["local:worker"]]);
  assert.equal(readFileSync(join(source,"skills/worker/SKILL.md"),"utf8").includes("name: worker"),true);
  assert.equal(existsSync(join(f.home,".agents/plugins/local")),false);
 }finally{f.cleanup();}
});

test("local plugin source rejects symlinks, duplicate names and source/output overlap",async()=>{
 for(const mode of ["symlink","duplicate","overlap","resource"]){const f=fixture();try{
  const source=join(f.root,"local");f.put(join(source,"plugin.json"),JSON.stringify({name:"local"}));f.skill(join(source,"skills/worker"),"worker");
  let selected=source;if(mode==="symlink"){selected=join(f.root,"link");symlinkSync(source,selected);}
  if(mode==="resource")symlinkSync(join(f.files,"input.txt"),join(source,"leak"));
  const output=mode==="overlap"?join(source,"report"):f.options.output;
  const r:any=await runIsolatedEvaluation({...f.options,output,pluginPaths:mode==="duplicate"?[source,source]:[selected]} as any);
  assert.equal(r.exit_code,2,mode);assert.equal(existsSync(f.log),false);assert.equal(existsSync(output),false,mode);
 }finally{f.cleanup();}}
});

test("public CLI accepts explicit source plugin path and freezes its origin",()=>{
 const f=fixture();try{const r=protocolCall(f,["--prompt","Same task","--plugin-path",f.plugin,"--source-home",f.home,"--output",f.options.output,"--dry-run"]);
 assert.equal(r.status,0,r.stdout+r.stderr);const report=JSON.parse(r.stdout).output;assert.deepEqual(report.selected_targets,["bundle:three","bundle:two"]);assert.deepEqual(report.requested_plugin_paths,[f.plugin]);assert.equal(report.campaigns[0].manifests[0].source,f.plugin);
 }finally{f.cleanup();}
});

test("failed CLI startup retains safe classification and stage without echoing payload",async()=>{
 const f=fixture();try{const original=readFileSync(f.host,"utf8");writeFileSync(f.host,original.replace('const output=JSON.stringify','process.stderr.write("error: unexpected argument --private-secret found; sensitive-stdout-key");process.exit(2);const output=JSON.stringify'));
 const r:any=await runIsolatedEvaluation({...f.options,withSkills:["one"],dryRun:false});assert.equal(r.exit_code,1);
 for(const run of r.runs){assert.equal(run.diagnostic.category,"cli");assert.equal(run.diagnostic.code,"invalid-cli-arguments");assert.equal(run.stage,"task-execution");assert.equal(run.exit_code,2);assert.equal(run.diagnostic.source,"stderr");}
 assert(!JSON.stringify(r).includes("private-secret"));assert(!JSON.stringify(r).includes("sensitive-stdout-key"));
 }finally{f.cleanup();}
});

test("mixed local plugin and contained standalone source reject overlap before writes",async()=>{
 for(const cli of [false,true]){const f=fixture();try{
  const source=join(f.home,".agents/skills/container");f.put(join(source,"plugin.json"),JSON.stringify({name:"mixed"}));f.skill(join(source,"skills/worker"),"worker");
  if(cli){const r=protocolCall(f,["--prompt","Same task","--plugin-path",source,"--with-skills","worker","--source-home",f.home,"--output",f.options.output,"--dry-run"]);assert.equal(r.status,2,r.stdout+r.stderr);}
  else{const r:any=await runIsolatedEvaluation({...f.options,pluginPaths:[source],withSkills:["worker"]} as any);assert.equal(r.exit_code,2);assert.equal(r.failure.code,"overlapping-selection");}
  assert.equal(existsSync(f.options.output),false);assert.equal(existsSync(f.log),false);
 }finally{f.cleanup();}}
});

test("private plugin import qualifies frontmatter and binds adapted bytes without changing source",async()=>{
 const f=fixture();try{
  // Host discovery reads frontmatter names, as real Goose does; it does not add a namespace.
  const original=readFileSync(f.host,"utf8");writeFileSync(f.host,original.replace('(plugin&&!n.startsWith(plugin+":")?plugin+":":"")+n','n'));
  const before=readFileSync(join(f.plugin,"skills/two/SKILL.md"));
  const r:any=await runIsolatedEvaluation({...f.options,withPlugins:["bundle"],dryRun:false});assert.equal(r.status,"succeeded",JSON.stringify(r.failure));
  assert.deepEqual(readFileSync(join(f.plugin,"skills/two/SKILL.md")),before);
  const target=r.runs.find((x:any)=>x.arm==="with_targets").installed_targets[0];
  assert.equal(target.adaptation,"goose-plugin-namespace-v1");
  assert.notEqual(target.files.find((x:any)=>x.path==="skills/two/SKILL.md").sha256,r.manifests[0].files.find((x:any)=>x.path==="skills/two/SKILL.md").sha256);
 }finally{f.cleanup();}
});

test("GOOSE_PATH_ROOT config directory receives private provider config and support files",()=>{
 const f=fixture();try{
  const config=join(f.root,"config.yaml");writeFileSync(config,'AZURE_FOUNDRY_ENDPOINT: https://example.invalid\nGOOSE_PROVIDER: fixture\nTLS_FILE: '+join(f.home,'.config/goose/tls.pem')+'\n');f.put(join(f.home,'.config/goose/tls.pem'),'private-fixture-tls');
  const capture=captureEvaluationConfig(f.home,config),home=join(f.root,"private");stageEvaluationConfig(capture,home,[]);
  const root=join(home,"config"),d:any=yaml.load(readFileSync(join(root,"config.yaml"),"utf8"));assert.equal(d.AZURE_FOUNDRY_ENDPOINT,'https://example.invalid');assert.equal(d.TLS_FILE,join(root,'tls.pem'));assert.equal(readFileSync(join(root,'tls.pem'),'utf8'),'private-fixture-tls');assert.equal(statSync(join(root,'tls.pem')).mode&0o777,0o600);
 }finally{f.cleanup();}
});

test("structured provider metadata is not credential taint and permission policy is not transported",async()=>{
 const f=fixture();try{
  f.put(join(f.home,'.config/goose/custom_providers/provider.json'),JSON.stringify({name:'test',engine:'openai',models:[{name:'model',reasoning:true,context_limit:1,reasoning_effort:'low',request_params:{reasoning_effort:'low',temperature:1}}],headers:{'Content-Type':'application/json','api-version':'v1'},auth:{command:'provider-auth-helper',args:['--scope','scope-value'],timeout_seconds:1},supports_streaming:true}));
  f.put(join(f.home,'.config/goose/permission.yaml'),'user:\n  always_allow: [read, true]\n');
  const c=captureEvaluationConfig(f.home);for(const v of ['test','openai','true','1','low','v1'])assert(!c.secrets.includes(v),v);assert(!c.files.some(x=>x.path==='permission.yaml'));assert(c.secrets.includes('scope-value'));assert(!c.secrets.includes('provider-auth-helper'));
  f.put(join(f.files,'input.txt'),'true 1 low v1');const r:any=await runIsolatedEvaluation({...f.options,dryRun:false,withSkills:['one']});assert.equal(r.status,'succeeded',JSON.stringify(r.failure));
 }finally{f.cleanup();}
});

test("sensitive input fixtures reject before host calls with value-free diagnostic",async()=>{
 const f=fixture();try{const secret='fixture-private-key-abcdef123456';f.put(join(f.home,'.config/goose/secrets.yaml'),'API_KEY: '+secret);f.put(join(f.files,'input.txt'),secret);const r:any=await runIsolatedEvaluation({...f.options,dryRun:false,withSkills:['one']});assert.equal(r.exit_code,2);assert.equal(r.failure.code,'sensitive-input-fixture');assert.equal(existsSync(f.log),false);assert(!JSON.stringify(r).includes(secret));}finally{f.cleanup();}
});

test("PEM credentials and body fragments remain protected under opaque and metadata fields",async()=>{
 for(const field of ['unknown','name']){const f=fixture();try{
  const body='SYNTHETIC_PEM_PRIVATE_BODY_abcdef123456';const pem='-----BEGIN PRIVATE KEY-----\n'+body+'\n-----END PRIVATE KEY-----';
  f.put(join(f.home,'.config/goose/custom_providers/provider.json'),JSON.stringify({[field]:field==='unknown'?{pem}:pem}));
  const c=captureEvaluationConfig(f.home);assert(c.secrets.includes(body),field);assert(c.secrets.includes(pem),field);
  f.put(join(f.files,'input.txt'),body);const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.failure.code,'sensitive-input-fixture');assert.equal(existsSync(f.log),false);assert(!JSON.stringify(r).includes(body));
 }finally{f.cleanup();}}
});

test("TRACE receipt is on disk before discovery spawn and records process separately",async()=>{
 const f=fixture();try{
  writeFileSync(f.host,`const fs=await import('node:fs');const p=${JSON.stringify(join(f.options.output,"baseline/run-1/discovery-invocation.json"))};const receipt=JSON.parse(fs.readFileSync(p,'utf8'));if(receipt.state!=='planned'||receipt.result!==null)process.exit(19);console.error('unexpected argument secret payload');process.exit(2);`);
  const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});
  assert.equal(r.runs[0].preflight.exit_code,2,JSON.stringify(r));
  const trace=JSON.parse(readFileSync(join(f.options.output,"baseline/run-1/discovery-invocation.json"),'utf8'));
  assert.equal(trace.state,'observed');assert.equal(trace.result.exit_code,2);assert(trace.result.stderr_bytes>0);assert.equal(trace.stdin.bytes,0);assert(!JSON.stringify(trace).includes('secret payload'));
 }finally{f.cleanup();}
});

test("REPLAY public CLI reruns frozen inputs into a fresh linked attempt",async()=>{
 const f=fixture();try{
  const r:any=await runIsolatedEvaluation({...f.options,withSkills:['one'],dryRun:false});assert.equal(r.status,'succeeded');
  const original=readFileSync(join(f.options.output,'report.json'),'utf8');
  writeFileSync(join(f.files,'input.txt'),'source changed');writeFileSync(join(f.home,'.agents/skills/nested/one/SKILL.md'),'changed');
  const replay=replayCli(f.options.output,{encoding:'utf8',timeout:15000});assert.equal(replay.status,0,replay.stdout+replay.stderr);
  const fresh=JSON.parse(replay.stdout);assert.equal(fresh.attempt_kind,'replay');assert.equal(fresh.parent.output,f.options.output);assert.notEqual(fresh.output,f.options.output);assert.equal(fresh.runs.length,2);assert.equal(JSON.parse(fresh.runs[0].output).initial,'original');assert.equal(readFileSync(join(f.options.output,'report.json'),'utf8'),original);
 }finally{f.cleanup();}
});
