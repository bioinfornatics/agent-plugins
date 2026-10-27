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
async function fakeHost(){
 const fs=await import("node:fs"),path=await import("node:path"),mode=process.argv[2],home=process.env.HOME!,cwd=process.cwd();
 fs.appendFileSync(log,JSON.stringify({mode,home,cwd,argv:process.argv.slice(2),env:process.env})+"\n");
 if(process.env.GOOSE_MOIM_MESSAGE_TEXT||process.env.NODE_OPTIONS)process.exit(9);
 if(mode==="skills"){
  console.log("Name | Description | Location");console.log("goose-doc-guide | built in | builtin://skills/goose-doc-guide");
  function walk(dir:string,plugin?:string){if(!fs.existsSync(dir))return;for(const name of fs.readdirSync(dir)){const p=path.join(dir,name);if(fs.statSync(p).isDirectory())walk(p,plugin);else if(name==="SKILL.md"){const n=fs.readFileSync(p,"utf8").match(/name: ([^\n]+)/)![1];console.log((plugin&&!n.startsWith(plugin+":")?plugin+":":"")+n+" | test | "+path.dirname(p));}}}
  walk(path.join(home,".agents/skills"));const plugins=path.join(home,".agents/plugins");if(fs.existsSync(plugins))for(const p of fs.readdirSync(plugins))walk(path.join(plugins,p,"skills"),p);
 }else{
  let input="";for await(const chunk of process.stdin)input+=chunk;
  const output=JSON.stringify({prompt:input,initial:fs.readFileSync(path.join(cwd,"input.txt"),"utf8"),hooks:fs.existsSync(path.join(home,".agents/plugins/bundle/hooks/hooks.json"))});
  fs.writeFileSync(path.join(cwd,"input.txt"),"mutated");console.log(JSON.stringify({type:"message",message:{role:"assistant",content:[{type:"text",text:output}]}}));console.log(JSON.stringify({type:"complete"}));
 }
}
declare const log:string;
function fixture(){
 const root=mkdtempSync(join(tmpdir(),"isolation-test-")),home=join(root,"source"),files=join(root,"fixtures"),host=join(root,"host.mjs"),log=join(root,"calls.jsonl");
 mkdirSync(home);mkdirSync(files);writeFileSync(join(files,"input.txt"),"original");
 const put=(path:string,text:string)=>{mkdirSync(join(path,".."),{recursive:true});writeFileSync(path,text);};
 const skill=(path:string,name:string)=>{put(join(path,"SKILL.md"),'---\nname: '+name+'\ndescription: Test task\n---\nTest instructions.');put(join(path,"references/a.txt"),"resource");};
 skill(join(home,".agents/skills/nested/one"),"one");skill(join(home,".agents/skills/foreign"),"foreign");
 const plugin=join(home,".agents/plugins/bundle");put(join(plugin,"plugin.json"),JSON.stringify({name:"bundle"}));skill(join(plugin,"skills/two"),"two");skill(join(plugin,"skills/three"),"three");put(join(plugin,"hooks/hooks.json"),"{}");
 writeFileSync(host,'const log='+JSON.stringify(log)+';('+fakeHost.toString()+')();');
 const options={sourceHome:home,fixtures:files,prompt:"Same task",output:join(root,"report"),command:process.execPath+" "+host,timeoutSeconds:5,dryRun:true};
 return{root,home,files,host,log,plugin,put,skill,options,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
test("prepare selected standalone and qualified skills without any host calls",async()=>{
 const f=fixture();try{const r:any=await runIsolatedEvaluation({...f.options,withSkills:["one","bundle:two"]});assert.equal(r.status,"prepared");assert.deepEqual(r.expected_targets,["bundle:two","one"]);assert.equal(existsSync(f.log),false);assert.equal(r.runs.length,2);assert.deepEqual(r.runs[0].installed_targets,[]);const paths=r.runs[1].installed_home_files.map((x:any)=>x.path);assert(paths.includes(".agents/plugins/bundle/plugin.json"));assert(paths.includes(".agents/plugins/bundle/skills/two/references/a.txt"));assert(!paths.some((p:string)=>p.includes("three")||p.includes("hooks")||p.includes("foreign")));assert.equal(statSync(join(f.options.output,"report.json")).mode&0o777,0o600);}finally{f.cleanup();}
});
test("paired runs use distinct private HOME/cwd, identical prompt/files and filtered config",async()=>{
 const f=fixture(),old=process.env.AMBIENT_PRIVATE_CONTEXT;try{process.env.AMBIENT_PRIVATE_CONTEXT="sentinel";const config=join(f.root,"config.yaml");writeFileSync(config,'active_provider: anthropic\nproviders:\n  anthropic:\n    enabled: true\n    configured: true\n    model: fixture\nextensions:\n  contamination: bad\nGOOSE_MOIM_MESSAGE_TEXT: contaminated\n');const r:any=await runIsolatedEvaluation({...f.options,withSkills:["one","bundle:two"],dryRun:false,runsPerQuery:2,config,model:"fixture"});assert.equal(r.status,"succeeded",JSON.stringify(r));assert.equal(r.runs.length,4);for(const run of r.runs){assert.equal(run.status,"succeeded");assert.deepEqual(JSON.parse(run.output),{prompt:"Same task",initial:"original",hooks:false});assert.equal(run.tokens,null);}const calls=readFileSync(f.log,"utf8").trim().split("\n").map(s=>JSON.parse(s));const execution=calls.filter(c=>c.mode==="run");assert.equal(new Set(execution.map(c=>c.home)).size,4);assert.equal(new Set(execution.map(c=>c.cwd)).size,4);for(const c of calls){assert.notEqual(c.home,f.home);assert.equal(existsSync(c.home),false);assert.equal(c.env.GOOSE_PATH_ROOT,c.home);assert.equal(c.env.CONTEXT_FILE_NAMES,"[]");assert.equal(c.env.GOOSE_DISABLE_KEYRING,process.env.GOOSE_DISABLE_KEYRING);assert(c.env.XDG_CONFIG_HOME.startsWith(c.home));}assert.equal(readFileSync(join(f.files,"input.txt"),"utf8"),"original");assert.equal(existsSync(join(f.plugin,"skills/three/SKILL.md")),true);}finally{old===undefined?delete process.env.AMBIENT_PRIVATE_CONTEXT:process.env.AMBIENT_PRIVATE_CONTEXT=old;f.cleanup();}
});
test("whole plugin includes all skills and hooks only in A",async()=>{const f=fixture();try{const r:any=await runIsolatedEvaluation({...f.options,withPlugins:["bundle"],dryRun:false});assert.equal(r.status,"succeeded");assert.deepEqual(r.expected_targets,["bundle:three","bundle:two"]);assert.deepEqual(r.runs.map((x:any)=>JSON.parse(x.output).hooks),[false,true]);}finally{f.cleanup();}});
test("invalid selectors fail without altering original installation",async()=>{
 for(const selection of ["../one","missing","bundle:missing","a:b:c","one,foreign"]){const f=fixture();try{const before=readFileSync(join(f.plugin,"plugin.json"));const r:any=await runIsolatedEvaluation({...f.options,withSkills:[selection]});assert.equal(r.exit_code,2,selection);assert.equal(existsSync(f.log),false);assert.deepEqual(readFileSync(join(f.plugin,"plugin.json")),before);}finally{f.cleanup();}}
});
test("ambiguous and overlapping selections fail",async()=>{for(const mode of ["ambiguous","overlap","duplicate"]){const f=fixture();try{if(mode==="ambiguous")f.skill(join(f.home,".agents/skills/collision"),"one");const r:any=await runIsolatedEvaluation({...f.options,withSkills:mode==="overlap"?["bundle:two"]:mode==="duplicate"?["one","one"]:["one"],withPlugins:mode==="overlap"?["bundle"]:[]});assert.equal(r.exit_code,2);}finally{f.cleanup();}}});
test("symlink resources and fixture discovery instructions are rejected",async()=>{for(const mode of ["symlink","hints","nested"]){const f=fixture();try{if(mode==="symlink")symlinkSync(join(f.files,"input.txt"),join(f.home,".agents/skills/nested/one/leak"));if(mode==="hints")writeFileSync(join(f.files,"AGENTS.md"),"contamination");if(mode==="nested")f.skill(join(f.home,".agents/skills/nested/one/other"),"hidden");const r:any=await runIsolatedEvaluation({...f.options,withSkills:["one"]});assert.equal(r.exit_code,2);assert.equal(existsSync(f.log),false);}finally{f.cleanup();}}});
test("unexpected inventory prevents both model runs",async()=>{const f=fixture();try{writeFileSync(f.host,'console.log("Name | Description | Location");console.log("foreign | bad | /outside");');const r:any=await runIsolatedEvaluation({...f.options,withSkills:["one"],dryRun:false});assert.equal(r.exit_code,1);assert.equal(r.failure.code,"discovery-target-mismatch");assert.equal(r.runs.some((x:any)=>x.output),false);}finally{f.cleanup();}});
test("child timeout and invalid stream are explicit retained failures",async()=>{for(const mode of ["timeout","invalid"]){const f=fixture();try{writeFileSync(f.host,'if(process.argv[2]==="skills"){console.log("Name | Description | Location");console.log("goose-doc-guide | builtin | builtin://skills/goose-doc-guide");}else{'+(mode==="timeout"?'setInterval(()=>{},1000);':'console.log("not-json");')+'}');const r:any=await runIsolatedEvaluation({...f.options,dryRun:false,timeoutSeconds:mode==="timeout"?.2:5});assert.equal(r.exit_code,1);assert(r.runs.every((x:any)=>x.exit_reason===(mode==="timeout"?"timeout":"invalid-response")));assert.equal(JSON.parse(readFileSync(join(f.options.output,"report.json"),"utf8")).status,"failure");}finally{f.cleanup();}}});
test("existing report and installation-overlapping outputs are preserved",async()=>{const f=fixture();try{mkdirSync(f.options.output);writeFileSync(join(f.options.output,"report.json"),"original report");const r:any=await runIsolatedEvaluation(f.options);assert.equal(r.exit_code,2);assert.equal(readFileSync(join(f.options.output,"report.json"),"utf8"),"original report");const bad:any=await runIsolatedEvaluation({...f.options,output:join(f.home,".agents/report")});assert.equal(bad.exit_code,2);assert.equal(existsSync(join(f.home,".agents/report")),false);}finally{f.cleanup();}});
test("unified CLI accepts repeated/comma selections and preserves other mode contracts",()=>{const f=fixture();try{const cli=join(import.meta.dirname,"../dist/scripts/cli.js");const result=spawnSync(process.execPath,[cli,"run-evaluation","--prompt","Same task","--output",f.options.output,"--source-home",f.home,"--with-skills","one,bundle:two","--dry-run","--format","json"],{encoding:"utf8"});assert.equal(result.status,0,result.stderr+result.stdout);assert.equal(JSON.parse(result.stdout).output.status,"prepared");const invalid=spawnSync(process.execPath,[cli,"run-evaluation","--mode","activation","--skill-path",join(f.home,".agents/skills/nested/one"),"--execute","--format","json"],{encoding:"utf8"});assert.equal(invalid.status,2);}finally{f.cleanup();}});

test("installed plugin-qualified frontmatter is resolved without double prefix",async()=>{const f=fixture();try{f.skill(join(f.plugin,"skills/two"),"bundle:two");const r:any=await runIsolatedEvaluation({...f.options,withSkills:["bundle:two"]});assert.equal(r.status,"prepared",JSON.stringify(r));assert.deepEqual(r.expected_targets,["bundle:two"]);}finally{f.cleanup();}});


test("skill-creator launcher forwards the selected model to both Goose arms on identical inputs",()=>{
 const f=fixture();try{
  const launcher=join(import.meta.dirname,"../../../skills/skill-creator/scripts/skill-creator.mjs"),reports:any[]=[];
  for(const [index,model] of ["fixture-model-a","fixture-model-b"].entries()){
   const result=spawnSync(process.execPath,[launcher,"run-evaluation","--prompt",f.options.prompt,"--output",join(f.root,"model-"+index),"--source-home",f.home,"--fixtures",f.files,"--with-skills","one","--with-plugin","bundle","--model",model,"--goose-command",f.options.command,"--format","json"],{encoding:"utf8",timeout:15000});
   assert.equal(result.status,0,result.stderr+result.stdout);
   const report=JSON.parse(result.stdout).output;assert.equal(report.status,"awaiting-grading");assert.equal(report.model,model);reports.push(report);
  }
  const calls=readFileSync(f.log,"utf8").trim().split("\n").map(s=>JSON.parse(s)).filter(c=>c.mode==="run");assert.equal(calls.length,4);
  for(const [index,call] of calls.entries()){
   const expected=index<2?"fixture-model-a":"fixture-model-b",flag=call.argv.indexOf("--model");assert(flag>=0);assert.equal(call.argv[flag+1],expected);assert.equal(call.env.GOOSE_MODEL,expected);
  }
  assert.deepEqual(reports[0].selected_targets,reports[1].selected_targets);assert.deepEqual(reports[0].campaigns[0].manifests,reports[1].campaigns[0].manifests);assert.equal(reports[0].cases[0].prompt,reports[1].cases[0].prompt);assert.deepEqual(reports[0].campaigns[0].fixtures,reports[1].campaigns[0].fixtures);
 }finally{f.cleanup();}
});

test("removed execution alias is rejected and isolation cannot be selected as mode",()=>{const f=fixture();try{const cli=join(import.meta.dirname,"../dist/scripts/cli.js");const r=spawnSync(process.execPath,[cli,"run-evaluation","--prompt","Test","--output",f.options.output,"--source-home",f.home,"--dry-run","--execute","--format","json"],{encoding:"utf8"});assert.equal(r.status,2);assert.equal(existsSync(f.log),false);const legacy=spawnSync(process.execPath,[cli,"run-evaluation","--skill-path",join(f.home,".agents/skills/nested/one"),"--format","json"],{encoding:"utf8"});assert.equal(legacy.status,2);assert.match(legacy.stderr+legacy.stdout,/output|Unknown option/);}finally{f.cleanup();}});

test("isolated is not an evaluation objective",()=>{const f=fixture();try{const r=spawnSync(process.execPath,[join(import.meta.dirname,"../dist/scripts/cli.js"),"run-evaluation","--mode","isolated","--prompt","Task","--output",f.options.output,"--dry-run"],{encoding:"utf8"});assert.equal(r.status,2);assert.match(r.stdout,/isolation is mandatory/);assert.equal(existsSync(f.options.output),false);}finally{f.cleanup();}});

function protocolCall(f:ReturnType<typeof fixture>,args:string[]){return spawnSync(process.execPath,[join(import.meta.dirname,"../dist/scripts/cli.js"),"run-evaluation",...args,"--format","json"],{encoding:"utf8",timeout:15000});}
test("activation and behavioral use the same mandatory isolated discovery engine",()=>{
 const f=fixture();try{
  const original=readFileSync(f.host,"utf8");writeFileSync(f.host,original.replace('const output=JSON.stringify', 'if(fs.existsSync(path.join(home,".agents/skills/one")))console.log(JSON.stringify({type:"message",message:{content:[{type:"toolRequest",toolCall:{value:{name:"skills__load_skill",arguments:{name:"one/references/a.txt"}}}}]}}));const output=JSON.stringify'));
  const evalset=join(f.root,"activation.json");writeFileSync(evalset,JSON.stringify([{query:"Same task",should_trigger:true}]));
  const r=protocolCall(f,["--mode","activation","--eval-set",evalset,"--with-skills","one","--source-home",f.home,"--fixtures",f.files,"--output",f.options.output,"--goose-command",f.options.command]);assert.equal(r.status,0,r.stdout+r.stderr);const report=JSON.parse(r.stdout).output;assert.equal(report.mode,"activation");assert.equal(report.status,"complete");assert.deepEqual(report.activation_results.map((x:any)=>x.pass),[true,true]);assert.deepEqual(report.activation_results[1].requested_skills,["one"]);assert.equal(report.activation_results[0].role,"contamination-control");assert(existsSync(report.review));
  const calls=readFileSync(f.log,"utf8").trim().split("\n").map(x=>JSON.parse(x));for(const call of calls){assert.notEqual(call.home,f.home);assert.equal(call.env.GOOSE_PATH_ROOT,call.home);assert.equal(existsSync(call.home),false);}
 }finally{f.cleanup();}
});
test("multiple activation targets require exact declared sets, not loose suffix matches",()=>{
 const f=fixture();try{const r=protocolCall(f,["--mode","activation","--prompt","Task","--expected-skills","bundle:missing","--with-plugin","bundle","--source-home",f.home,"--output",f.options.output,"--dry-run"]);assert.equal(r.status,2);assert.equal(existsSync(f.options.output),false);assert.equal(existsSync(f.log),false);
 const missing=protocolCall(f,["--mode","activation","--prompt","Task","--with-plugin","bundle","--source-home",f.home,"--output",f.options.output,"--dry-run"]);assert.equal(missing.status,2);assert.match(missing.stdout,/expected_skills/);
 }finally{f.cleanup();}
});
test("behavioral retains artifacts and imports blinded judgments without rerunning candidates",()=>{
 const f=fixture();try{
  const r=protocolCall(f,["--mode","behavioral","--prompt","Same task","--expectations",JSON.stringify(["Outputs original input"]),"--with-skills","one","--source-home",f.home,"--fixtures",f.files,"--output",f.options.output,"--goose-command",f.options.command]);assert.equal(r.status,0,r.stdout+r.stderr);const report=JSON.parse(r.stdout).output;assert.equal(report.status,"awaiting-grading");assert.equal(report.grading_requests.length,2);
  const count=readFileSync(f.log,"utf8");const grades=report.grading_requests.map((entry:any)=>{const packet=JSON.parse(readFileSync(entry.request_path,"utf8"));assert(!JSON.stringify(packet).includes(f.home));assert(!JSON.stringify(packet).includes("with_targets"));assert(packet.outputs[0].content.includes("mutated"));return{request_id:packet.request_id,judgments:[{text:packet.expectations[0],verdict:"pass",evidence_quote:"original",rationale:"The output preserves the original input in its response."}]};});
  const imported=join(f.root,"grades.json");writeFileSync(imported,JSON.stringify(grades));const resumed=protocolCall(f,["--resume","--output",f.options.output,"--grading-results",imported]);assert.equal(resumed.status,0,resumed.stdout);const final=JSON.parse(resumed.stdout).output;assert.equal(final.status,"complete");assert.equal(final.comparison.complete_pairs,1);assert.equal(final.comparison.criteria.both_pass,1);assert.equal(readFileSync(f.log,"utf8"),count);assert(existsSync(join(f.options.output,"case-0/baseline/run-1/outputs/artifacts/input.txt")));
  const grade=join(f.options.output,"case-0/baseline/run-1/grading.json");writeFileSync(grade,'{"expectations":[],"summary":{"pass_rate":1}}');assert.equal(protocolCall(f,["--resume","--output",f.options.output]).status,2);
 }finally{f.cleanup();}
});
test("public protocol rejects installation-overlapping output before mutation",()=>{
 const f=fixture();try{const output=join(f.home,".agents/should-not-exist"),r=protocolCall(f,["--prompt","Task","--with-skills","one","--source-home",f.home,"--output",output,"--dry-run"]);assert.equal(r.status,2);assert.equal(existsSync(output),false);assert.equal(existsSync(f.log),false);}finally{f.cleanup();}
});
test("activation blocks loads absent from the arm inventory",()=>{
 const f=fixture();try{const original=readFileSync(f.host,"utf8");writeFileSync(f.host,original.replace('const output=JSON.stringify','console.log(JSON.stringify({type:"message",message:{content:[{type:"toolRequest",toolCall:{value:{name:"skills__load_skill",arguments:{name:"foreign"}}}}]}}));const output=JSON.stringify'));const r=protocolCall(f,["--mode","activation","--prompt","Same task","--expected-skills","one","--with-skills","one","--source-home",f.home,"--fixtures",f.files,"--output",f.options.output,"--goose-command",f.options.command]);assert.equal(r.status,1,r.stdout);assert.equal(JSON.parse(r.stdout).output.status,"failure");}finally{f.cleanup();}
});

test("activation distinguishes plugin-qualified sibling names and counts expected-set mismatch",()=>{
 const f=fixture();try{
  const original=readFileSync(f.host,"utf8");writeFileSync(f.host,original.replace('const output=JSON.stringify','if(fs.existsSync(path.join(home,".agents/plugins/bundle")))console.log(JSON.stringify({type:"message",message:{content:[{type:"toolRequest",toolCall:{value:{name:"skills__load_skill",arguments:{name:"bundle:three/references/a.txt"}}}}]}}));const output=JSON.stringify'));
  const r=protocolCall(f,["--mode","activation","--prompt","Same task","--expected-skills","bundle:two","--with-plugin","bundle","--source-home",f.home,"--fixtures",f.files,"--output",f.options.output,"--goose-command",f.options.command]);assert.equal(r.status,0,r.stdout);const report=JSON.parse(r.stdout).output;assert.equal(report.status,"complete");assert.equal(report.activation_results[1].pass,false);assert.deepEqual(report.activation_results[1].requested_skills,["bundle:three"]);const html=readFileSync(report.review,"utf8");assert(html.includes("bundle:three"));assert(html.includes("contamination-control"));
 }finally{f.cleanup();}
});
test("behavioral resume rejects retained artifact mutation without rerunning",()=>{
 const f=fixture();try{const r=protocolCall(f,["--prompt","Same task","--expectations",JSON.stringify(["Outputs input"]),"--with-skills","one","--source-home",f.home,"--fixtures",f.files,"--output",f.options.output,"--goose-command",f.options.command]);assert.equal(r.status,0,r.stdout);const before=readFileSync(f.log,"utf8");writeFileSync(join(f.options.output,"case-0/baseline/run-1/outputs/artifacts/input.txt"),"changed");const resumed=protocolCall(f,["--resume","--output",f.options.output]);assert.equal(resumed.status,2);assert.match(resumed.stdout,/artifact drift/);assert.equal(readFileSync(f.log,"utf8"),before);}finally{f.cleanup();}
});
test("dirty later fixtures are rejected before any earlier task executes",()=>{
 const f=fixture();try{const dirty=join(f.root,"dirty");mkdirSync(dirty);writeFileSync(join(dirty,"AGENTS.md"),"contamination");const evalset=join(f.root,"eval.json");writeFileSync(evalset,JSON.stringify({evals:[{id:1,prompt:"Same task",fixtures:"fixtures"},{id:2,prompt:"Task",fixtures:"dirty"}]}));const r=protocolCall(f,["--eval-set",evalset,"--with-skills","one","--source-home",f.home,"--output",f.options.output,"--goose-command",f.options.command]);assert.equal(r.status,2);assert.equal(existsSync(f.log),false);assert.equal(existsSync(f.options.output),false);}finally{f.cleanup();}
});

test("removed legacy session command is unavailable",()=>{const f=fixture();try{const r=spawnSync(process.execPath,[join(import.meta.dirname,"../dist/scripts/cli.js"),"session-evaluation","--help"],{encoding:"utf8"});assert.equal(r.status,2);assert.match(r.stderr,/Unknown command/);}finally{f.cleanup();}});

test("activation requires an observed assistant turn, not completion alone",()=>{
 const f=fixture();try{writeFileSync(f.host,'if(process.argv[2]==="skills"){console.log("Name | Description | Location");console.log("goose-doc-guide | builtin | builtin://skills/goose-doc-guide");const fs=await import("node:fs"),p=process.env.HOME+"/.agents/skills/one";if(fs.existsSync(p))console.log("one | test | "+p);}else{console.log(JSON.stringify({type:"complete"}));}');const r=protocolCall(f,["--mode","activation","--prompt","Same task","--expected-skills","none","--with-skills","one","--source-home",f.home,"--output",f.options.output,"--goose-command",f.options.command]);assert.equal(r.status,1,r.stdout+r.stderr);const report=JSON.parse(r.stdout).output;assert(report.runs.every((x:any)=>x.exit_reason==="unsupported-activation-telemetry"));assert(report.activation_results.every((x:any)=>x.pass===null));}finally{f.cleanup();}
});
test("discovery context additions during preflight block both model calls",()=>{
 const f=fixture();try{const original=readFileSync(f.host,"utf8");writeFileSync(f.host,original.replace('console.log("Name | Description | Location");','const extra=path.join(home,".agents/skills/extra");fs.mkdirSync(extra,{recursive:true});fs.writeFileSync(path.join(extra,"SKILL.md"),"---\\nname: extra\\ndescription: contamination\\n---\\n");console.log("Name | Description | Location");').replace('walk(path.join(home,".agents/skills"));',''));
 const r=protocolCall(f,["--mode","activation","--prompt","Task","--expected-skills","none","--with-skills","one","--source-home",f.home,"--output",f.options.output,"--goose-command",f.options.command]);assert.equal(r.status,1,r.stdout);const calls=readFileSync(f.log,"utf8").trim().split("\n").map(x=>JSON.parse(x));assert.equal(calls.some(x=>x.mode==="run"),false);assert.match(r.stdout,/preflight-discovery-drift/);
 }finally{f.cleanup();}
});
test("resume identifies missing frozen case slots instead of completing a partial campaign",()=>{
 const f=fixture();try{const evalset=join(f.root,"two.json");writeFileSync(evalset,JSON.stringify([{query:"Same task",expected_skills:[]},{query:"Same task",expected_skills:[]}]));const r=protocolCall(f,["--mode","activation","--eval-set",evalset,"--with-skills","one","--source-home",f.home,"--fixtures",f.files,"--output",f.options.output,"--goose-command",f.options.command]);assert.equal(r.status,0,r.stdout);const stateFile=join(f.options.output,"run.json"),state=JSON.parse(readFileSync(stateFile,"utf8")).state;state.runs=state.runs.filter((x:any)=>x.case_id===0);state.campaigns=state.campaigns.filter((x:any)=>x.case_id===0);writeFileSync(stateFile,JSON.stringify({state,sha256:createHash("sha256").update(JSON.stringify(state)).digest("hex")}));const before=readFileSync(f.log,"utf8"),resumed=protocolCall(f,["--resume","--output",f.options.output]);assert.equal(resumed.status,0,resumed.stdout);const report=JSON.parse(resumed.stdout).output;assert.equal(report.status,"incomplete");assert.deepEqual(report.missing_runs,[{case_id:1,arm:"baseline",repeat:1},{case_id:1,arm:"with_targets",repeat:1}]);assert.equal(readFileSync(f.log,"utf8"),before);
 }finally{f.cleanup();}
});

test("resume recovers summary after independent response was persisted",()=>{
 const f=fixture();try{const r=protocolCall(f,["--prompt","Same task","--expectations",JSON.stringify(["Outputs input"]),"--with-skills","one","--source-home",f.home,"--fixtures",f.files,"--output",f.options.output,"--goose-command",f.options.command]);assert.equal(r.status,0,r.stdout);const report=JSON.parse(r.stdout).output;
 for(const entry of report.grading_requests){const request=JSON.parse(readFileSync(entry.request_path,"utf8"));const state=JSON.parse(readFileSync(join(f.options.output,"run.json"),"utf8")).state;const run=state.runs.find((x:any)=>request.request_id===createHash("sha256").update(JSON.stringify({runDir:join(f.options.output,x.directory),output:[{label:"artifact-1",content:readFileSync(join(f.options.output,x.directory,"outputs/result.txt"),"utf8")}],expectations:["Outputs input"]})).digest("hex"));assert(run);writeFileSync(join(f.options.output,run.directory,"grading-response.json"),JSON.stringify({request_id:request.request_id,judgments:[{text:"Outputs input",verdict:"pass",evidence_quote:"original",rationale:"The displayed response contains the original input."}]}));}
 const before=readFileSync(f.log,"utf8"),resumed=protocolCall(f,["--resume","--output",f.options.output]);assert.equal(resumed.status,0,resumed.stdout);assert.equal(JSON.parse(resumed.stdout).output.status,"complete");assert.equal(readFileSync(f.log,"utf8"),before);
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

test("TRACE task plan precedes spawn; child success is separate from artifact rejection",async()=>{
 const f=fixture();try{
  const original=readFileSync(f.host,'utf8');
  f.put(join(f.home,'.config/goose/secrets.yaml'),'API_KEY: PRIVATE_ARTIFACT_SENTINEL');
  writeFileSync(f.host,original.replace('const output=JSON.stringify',`const receipt=JSON.parse(fs.readFileSync(path.join(${JSON.stringify(f.options.output)},fs.existsSync(path.join(home,'.agents/skills/one'))?'with_targets':'baseline','run-1/task-invocation.json'),'utf8'));if(receipt.state!=='planned')process.exit(19);fs.writeFileSync(path.join(cwd,'secret.txt'),'PRIVATE_ARTIFACT_SENTINEL');const output=JSON.stringify`));
  const r:any=await runIsolatedEvaluation({...f.options,withSkills:['one'],dryRun:false});assert.equal(r.exit_code,1);assert.equal(r.runs[0].process_result.exit_code,0);assert.equal(r.runs[0].exit_reason,'task-evidence-capture-rejected');
  const trace=JSON.parse(readFileSync(join(f.options.output,'baseline/run-1/task-invocation.json'),'utf8'));assert.equal(trace.result.exit_code,0);assert(trace.result.stdout_bytes>0);assert.deepEqual(trace.stdin,{bytes:9,sha256:createHash('sha256').update('Same task').digest('hex')});
 }finally{f.cleanup();}
});
test("REPLAY rejects snapshot bytes, symlinks and launcher-resource drift before spawn",async()=>{
 for(const scenario of ['bytes','symlink','host']){const f=fixture();try{
  const r:any=await runIsolatedEvaluation({...f.options,withSkills:['one'],dryRun:false});assert.equal(r.replay.available,true);const calls=readFileSync(f.log,'utf8');
  const target=join(f.options.output,'replay-inputs/fixtures/input.txt');
  if(scenario==='bytes')writeFileSync(target,'tampered');if(scenario==='symlink'){rmSync(target);symlinkSync(join(f.files,'input.txt'),target);}if(scenario==='host')writeFileSync(f.host,'process.exit(0)');
  const replay=replayCli(f.options.output,{encoding:'utf8',timeout:15000});assert.equal(replay.status,2,replay.stdout+replay.stderr);assert.match(replay.stderr,/Replay unavailable/);assert.equal(readFileSync(f.log,'utf8'),calls);
 }finally{f.cleanup();}}
});
test("REPLAY selects frozen local plugins and qualified individual skills",async()=>{
 for(const selection of [{pluginPaths:true},{qualified:true}]){const f=fixture();try{
  const r:any=await runIsolatedEvaluation({...f.options,pluginPaths:selection.pluginPaths?[f.plugin]:undefined,withSkills:selection.qualified?['bundle:two']:undefined,dryRun:false});assert.equal(r.status,'succeeded');
  const replay=replayCli(f.options.output,{encoding:'utf8',timeout:15000});assert.equal(replay.status,0,replay.stdout+replay.stderr);assert.deepEqual(JSON.parse(replay.stdout).expected_targets,r.expected_targets);
 }finally{f.cleanup();}}
});
test("sensitive recipe still traces without raw prompt, secret hashes, config or auth argv",async()=>{
 const f=fixture(),key='TRACE_PRIVATE_SECRET_abcdef12345';try{
  f.put(join(f.home,'.config/goose/secrets.yaml'),'API_KEY: '+key);
  writeFileSync(f.host,readFileSync(f.host,'utf8').replace('const log=',"process.argv.splice(2,2);const log="));
  const r:any=await runIsolatedEvaluation({...f.options,prompt:key,command:f.options.command+' --token '+key,dryRun:false});assert.equal(r.replay.available,false);assert.equal(existsSync(join(f.options.output,'replay.sh')),false);assert.equal(r.prompt_sha256,null);
  const trace=readFileSync(join(f.options.output,'baseline/run-1/task-invocation.json'),'utf8');assert(!trace.includes(key));assert(!trace.includes(createHash('sha256').update(key).digest('hex')));assert.equal(JSON.parse(trace).stdin.unavailable_reason,'sensitive-stdin');assert.equal(JSON.parse(trace).argv.unavailable_reason,'sensitive-launcher-arguments');
 }finally{f.cleanup();}
});
test("REPLAY re-resolves current source config and fails on public config drift",async()=>{
 const f=fixture();try{
  f.put(join(f.home,'.config/goose/config.yaml'),'GOOSE_PROVIDER: fixture\nGOOSE_MODEL: original\n');const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.replay.available,true);
  f.put(join(f.home,'.config/goose/config.yaml'),'GOOSE_PROVIDER: fixture\nGOOSE_MODEL: changed\n');const calls=readFileSync(f.log,'utf8');
  const replay=replayCli(f.options.output,{encoding:'utf8',timeout:15000});assert.equal(replay.status,2,replay.stdout+replay.stderr);assert.equal(JSON.parse(replay.stdout).failure.code,'replay-current-configuration-drift');assert.equal(readFileSync(f.log,'utf8'),calls);
 }finally{f.cleanup();}
});
test("TRACE first lifecycle failure wins over the later timeout",async()=>{
 const f=fixture();try{writeFileSync(f.host,`process.on('SIGTERM',()=>{});process.stdout.write(Buffer.from([255]));setInterval(()=>process.stdout.write(Buffer.alloc(2000000)),10);`);const r:any=await runIsolatedEvaluation({...f.options,dryRun:false,timeoutSeconds:.15});assert.equal(r.failure.code,'inventory-invalid-utf8');const receipt=JSON.parse(readFileSync(join(f.options.output,'baseline/run-1/discovery-invocation.json'),'utf8'));assert.equal(receipt.result.exit_reason,'invalid-utf8');assert(receipt.result.stdout_bytes>0);}finally{f.cleanup();}
});
test("TRACE result capture failure cannot turn child success into evaluation success",async()=>{
 const f=fixture();try{
  const original=readFileSync(f.host,'utf8');writeFileSync(f.host,original.replace('const output=JSON.stringify',`const receipt=path.join(${JSON.stringify(f.options.output)},'baseline/run-1/task-invocation.json');fs.rmSync(receipt);fs.symlinkSync(${JSON.stringify(join(f.root,'protected.txt'))},receipt);const output=JSON.stringify`));writeFileSync(join(f.root,'protected.txt'),'preserve');
  const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.failure.code,'invocation-result-capture-failed');assert.equal(r.runs[0].capture_status,'failed');assert.equal(r.runs[0].process_result.exit_code,0);assert.equal(r.exit_code,1);assert.equal(readFileSync(join(f.root,'protected.txt'),'utf8'),'preserve');
 }finally{f.cleanup();}
});
test("sensitive initial target is rejected before discovery or retaining bytes and hashes",async()=>{
 const f=fixture();try{
  const secret='PRIVATE_TARGET_SENTINEL_abcdef12345';f.put(join(f.home,'.config/goose/secrets.yaml'),'API_KEY: '+secret);f.put(join(f.home,'.agents/skills/nested/one/references/a.txt'),secret);
  const r:any=await runIsolatedEvaluation({...f.options,withSkills:['one'],dryRun:false});assert.equal(r.exit_code,2);assert.equal(r.failure.code,'sensitive-input-target');assert.equal(existsSync(f.log),false);assert.equal(existsSync(join(f.options.output,'replay-inputs')),false);assert.equal(existsSync(join(f.options.output,'replay-recipe.json')),false);assertNoRetainedSecret(f.options.output,secret);
 }finally{f.cleanup();}
});

// Round-2 independent symptoms: inspect every retained byte, not only recipe artifacts.
function assertNoRetainedSecret(root:string,secret:string){
 const digest=createHash('sha256').update(secret).digest('hex');
 function walk(p:string){if(!existsSync(p))return;for(const n of readdirSync(p)){const f=join(p,n);assert(!n.includes(secret));if(statSync(f).isDirectory())walk(f);else{const b=readFileSync(f);assert(!b.includes(Buffer.from(secret)),f+' raw secret');assert(!b.includes(Buffer.from(digest)),f+' secret digest');}}}walk(root);
}
test("R2 F1 rejects sensitive target contents and metadata before any public hash",async()=>{
 for(const kind of ['content','metadata']){const f=fixture(),secret='opaque-target-private-value-987654321';try{
  f.put(join(f.home,'.config/goose/secrets.yaml'),'API_KEY: '+secret);
  f.put(join(f.home,'.agents/skills/nested/one/references',kind==='metadata'?secret+'.txt':'a.txt'),kind==='content'?secret:'ordinary');
  const r:any=await runIsolatedEvaluation({...f.options,withSkills:['one']});assertNoRetainedSecret(f.options.output,secret);assert.equal(r.exit_code,2);assert.equal(r.failure.code,'sensitive-input-target');assert.equal(existsSync(f.log),false);
 }finally{f.cleanup();}}
});
test("R2 F2 opaque auth argv taints prompt, fixture and output before retention",async()=>{
 for(const form of ['--token VALUE','--token=VALUE','--api-key VALUE','--password=VALUE','--authorization VALUE']){for(const seam of ['prompt','fixture','output','target']){const f=fixture(),secret='opaque-auth-value-987654321';try{
  const flag=form.replace('VALUE',secret);writeFileSync(f.host,readFileSync(f.host,'utf8').replace('const log=',`process.argv.splice(2,${form.includes(' ')?2:1});const log=`));
  if(seam==='fixture')writeFileSync(join(f.files,'input.txt'),secret);
  if(seam==='target')f.put(join(f.home,'.agents/skills/nested/one/references/a.txt'),secret);
  if(seam==='output')writeFileSync(f.host,readFileSync(f.host,'utf8').replace('const output=JSON.stringify',`fs.writeFileSync(path.join(cwd,'private.txt'),${JSON.stringify(secret)});const output=JSON.stringify`));
  const r:any=await runIsolatedEvaluation({...f.options,prompt:seam==='prompt'?secret:'Same task',withSkills:seam==='target'?['one']:undefined,command:f.options.command+' '+flag,dryRun:false});assertNoRetainedSecret(f.options.output,secret);
  if(seam==='fixture'||seam==='target'){assert.equal(r.exit_code,2);assert.equal(existsSync(f.log),false);}else{assert.equal(r.replay.available,false);if(seam==='prompt')assert.equal(r.prompt_sha256,null);else assert.equal(r.exit_code,1);}
 }finally{f.cleanup();}}}
});
test("R2 F2 ambiguous auth arguments fail closed without execution",async()=>{for(const flag of ['--token','--token=','--token --other','--client-secret-file opaque']){const f=fixture();try{const r:any=await runIsolatedEvaluation({...f.options,command:f.options.command+' '+flag});assert.equal(r.exit_code,2);assert.equal(r.failure.code,'uncertain-auth-arguments');assert.equal(existsSync(f.log),false);}finally{f.cleanup();}}});
function copyRuntime(f:ReturnType<typeof fixture>,source=false){const app=join(f.root,'app');mkdirSync(app);const original=join(import.meta.dirname,'..');cpSync(join(original,'dist'),join(app,'dist'),{recursive:true});cpSync(join(original,'package.json'),join(app,'package.json'));for(const name of ['js-yaml','argparse','adm-zip'])cpSync(join(original,'node_modules',name),join(app,'node_modules',name),{recursive:true});if(source)cpSync(join(original,'scripts'),join(app,'scripts'),{recursive:true});return app;}
async function copiedEvaluation(app:string,options:unknown){const code=`import {runIsolatedEvaluation} from ${JSON.stringify('file://'+join(app,'dist/scripts/evaluation_isolated.js'))};console.log(JSON.stringify(await runIsolatedEvaluation(${JSON.stringify(options)})));`;const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:15000});assert.equal(child.status,0,child.stderr);return JSON.parse(child.stdout);}
test("R2 F3 full closure drift is rejected before mutable imports execute",async()=>{
 for(const file of ['dist/scripts/durable_file.js','node_modules/js-yaml/dist/js-yaml.mjs','node_modules/js-yaml/package.json','package.json','scripts/evaluation_isolated.ts','node_modules/argparse/argparse.js','node_modules/js-yaml/node_modules/argparse/index.js']){const f=fixture();try{
  const app=copyRuntime(f,true),r:any=await copiedEvaluation(app,{...f.options,dryRun:false});assert.equal(r.replay.available,true);const marker=join(f.root,'executed-marker'),target=join(app,file),calls=readFileSync(f.log,'utf8');
  if(file.endsWith('.json')){const data=JSON.parse(readFileSync(target,'utf8'));data.type='commonjs';writeFileSync(target,JSON.stringify(data));}
  else {
   const original=existsSync(target)?readFileSync(target,'utf8'):'';
   const esm=file.endsWith('.mjs')||file==='dist/scripts/durable_file.js';
   f.put(target,(esm?`import * as r2fs from 'node:fs';r2fs.writeFileSync(${JSON.stringify(marker)},'executed');\n`:`require('node:fs').writeFileSync(${JSON.stringify(marker)},'executed');\n`)+original);
   if(!file.startsWith('scripts/')){
    // Prove the injected marker is executable independently; then replay must never execute it.
    const control=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify('file://'+target)})`],{encoding:'utf8'});
    assert.equal(control.status,0,control.stderr);assert.equal(existsSync(marker),true,'red-capable marker');rmSync(marker);
   }
  }
  const replay=replayCli(f.options.output,{cwd:f.root,encoding:'utf8',timeout:15000});assert.equal(existsSync(marker),false,file);assert.equal(replay.status,2,replay.stdout+replay.stderr);assert.match(replay.stderr,/Replay unavailable: replay-/);assert(!replay.stderr.includes(' at '));assert.equal(readFileSync(f.log,'utf8'),calls);
 }finally{f.cleanup();}}
});
test("R2 F4 installed runtime without authoring scripts replays from foreign cwd",async()=>{const f=fixture();try{const app=copyRuntime(f);writeFileSync(join(app,"package.json"),JSON.stringify({name:"installed-runtime",type:"module",private:true}));const r:any=await copiedEvaluation(app,{...f.options,dryRun:false});assert.equal(r.replay.available,true);const replay=replayCli(f.options.output,{cwd:'/',encoding:'utf8',timeout:15000});assert.equal(replay.status,0,replay.stdout+replay.stderr);assert.equal(JSON.parse(replay.stdout).attempt_kind,'replay');}finally{f.cleanup();}});
test("R2 F5 PATH symlink launcher binds requested and resolved paths",async()=>{const f=fixture(),old=process.env.PATH;try{const bin=join(f.root,'bin');mkdirSync(bin);symlinkSync(process.execPath,join(bin,'fixture-node'));process.env.PATH=bin+':'+old;const r:any=await runIsolatedEvaluation({...f.options,command:'fixture-node '+f.host,dryRun:false});assert.equal(r.replay.available,true);const recipe=JSON.parse(readFileSync(join(f.options.output,'replay-recipe.json'),'utf8'));assert.equal(recipe.executable.requested,join(bin,'fixture-node'));assert.equal(recipe.executable.resolved,process.execPath);const replay=replayCli(f.options.output,{cwd:'/',encoding:'utf8',timeout:15000});assert.equal(replay.status,0,replay.stdout+replay.stderr);}finally{process.env.PATH=old;f.cleanup();}});
test("R2 F6 synchronous bootstrap failures use closed exit2 diagnostics",async()=>{for(const kind of ['recipe','module']){const f=fixture();try{const app=copyRuntime(f,true),r:any=await copiedEvaluation(app,{...f.options,dryRun:false});assert.equal(r.replay.available,true);if(kind==='recipe')writeFileSync(join(f.options.output,'replay-recipe.json'),'private malformed data');else rmSync(join(app,'dist/scripts/evaluation_replay.js'));const replay=replayCli(f.options.output,{encoding:'utf8',timeout:15000});assert.equal(replay.status,2);assert.match(replay.stderr,/^Replay unavailable: replay-[a-z-]+\n$/);assert.equal(replay.stdout,'');}finally{f.cleanup();}}});

test("R2 F5 relative and empty PATH entries resolve against the actual spawn cwd",()=>{const f=fixture();try{const bin=join(f.root,'bin');mkdirSync(bin);symlinkSync(process.execPath,join(bin,'fixture-node'));for(const [cwd,path] of [[f.root,'bin'],[bin,'']]){const identity:any=executableIdentity('fixture-node',{PATH:path},cwd);const child=spawnSync('fixture-node',['-e','process.stdout.write("executed")'],{cwd,env:{PATH:path},encoding:'utf8'});assert.equal(child.status,0,JSON.stringify(child.error));assert.equal(identity.available,true);assert.equal(identity.requested,join(bin,'fixture-node'));assert.equal(child.stdout,'executed');}}finally{f.cleanup();}});

test("R2 F1 recognized sensitive target needs no config to reject content or metadata",async()=>{for(const kind of ['content','metadata']){const f=fixture(),secret='sk-sensitiveTargetValue123456789';try{f.put(join(f.home,'.agents/skills/nested/one/references',kind==='content'?'a.txt':secret+'.txt'),kind==='content'?secret:'ordinary');const r:any=await runIsolatedEvaluation({...f.options,withSkills:['one'],dryRun:false});assert.equal(r.exit_code,2);assert.equal(r.failure.code,'sensitive-input-target');assertNoRetainedSecret(f.options.output,secret);assert.equal(existsSync(f.log),false);}finally{f.cleanup();}}});
test("R2 F3 dependency symlink substitution rejects without importing external code",async()=>{const f=fixture();try{const app=copyRuntime(f),r:any=await copiedEvaluation(app,{...f.options,dryRun:false});assert.equal(r.replay.available,true);const module=join(app,'node_modules/js-yaml/dist/js-yaml.mjs'),external=join(f.root,'external.mjs'),marker=join(f.root,'marker');writeFileSync(external,`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'executed');`);rmSync(module);symlinkSync(external,module);const child=replayCli(f.options.output,{encoding:'utf8',timeout:15000});assert.equal(child.status,2);assert.equal(child.stderr,'Replay unavailable: replay-unsafe-symlink\n');assert.equal(existsSync(marker),false);}finally{f.cleanup();}});
test("R2 F3 installed production closure includes all contained modules",async()=>{const f=fixture();try{const app=copyRuntime(f);writeFileSync(join(app,'package.json'),JSON.stringify({type:'module'}));f.put(join(app,'node_modules/extra/package.json'),JSON.stringify({name:'extra',main:'index.js'}));f.put(join(app,'node_modules/extra/index.js'),'module.exports={};');const r:any=await copiedEvaluation(app,{...f.options,dryRun:false});assert.equal(r.replay.available,true);const recipe=JSON.parse(readFileSync(join(f.options.output,'replay-recipe.json'),'utf8'));assert(recipe.runtime.closure.modules.some((x:any)=>x.root===join(app,'node_modules/extra')));writeFileSync(join(app,'node_modules/extra/index.js'),'module.exports={changed:true};');const child=replayCli(f.options.output,{encoding:'utf8',timeout:15000});assert.equal(child.status,2);assert.equal(child.stderr,'Replay unavailable: replay-runtime-drift\n');}finally{f.cleanup();}});

// Final bounded correction: review9 privacy and replay counterexamples.
test("R9-1 argv taint screens every public option and scalar config before hashes",async()=>{
 for(const seam of ['model','provider','parent','output','config-path','source-home','fixtures-path','target-home','config-string','config-number','config-boolean']){const f=fixture(),secret=seam==='config-number'?'987654321':seam==='config-boolean'?'true':'opaque-auth-value-987654321';try{
  const options:any={...f.options,command:f.options.command+' --token '+secret,dryRun:false};
  if(seam==='model'||seam==='provider')options[seam]=secret;
  if(seam==='parent')options.parent={output:join(f.root,secret),recipe_sha256:'ordinary'};
  if(seam==='output')options.output=join(f.root,secret);
  if(seam==='config-path'){options.config=join(f.root,secret+'.yaml');writeFileSync(options.config,'GOOSE_MODEL: ordinary\n');}
  if(seam==='source-home'||seam==='target-home'){const home=join(f.root,secret);cpSync(f.home,home,{recursive:true});options[seam==='source-home'?'sourceHome':'targetHome']=home;}
  if(seam==='fixtures-path'){options.fixtures=join(f.root,secret);cpSync(f.files,options.fixtures,{recursive:true});}
  if(seam.startsWith('config-')&&seam!=='config-path')f.put(join(f.home,'.config/goose/config.yaml'),'GOOSE_MODEL: '+secret+'\n');
  const binding=captureEvaluationConfig(options.sourceHome,options.config).binding;
  const r:any=await runIsolatedEvaluation(options);assert.equal(r.exit_code,2,seam);assert.equal(existsSync(f.log),false,seam);assert.equal(r.config_sha256,undefined,seam);assert(!JSON.stringify(r).includes(secret),seam);assertNoRetainedSecret(options.output,secret);
  if(existsSync(join(options.output,'report.json')))assert(!readFileSync(join(options.output,'report.json'),'utf8').includes(binding),seam+' tainted config binding');
 }finally{f.cleanup();}}
});
test("R9-2 static local import, reexport, require and package closure drift stops before host spawn",async()=>{
 for(const seam of ['import','reexport','require','package','package-manifest','resolution-shadow']){const f=fixture();try{
  const helper=join(f.root,seam==='require'?'helper.cjs':'helper.mjs');writeFileSync(helper,seam==='require'?'exports.value="original-helper";':'export const value="original-helper";');
  let prefix='import {value} from "./helper.mjs";';
  if(seam==='reexport'){writeFileSync(join(f.root,'bridge.mjs'),'export {value} from "./helper.mjs";');prefix='import {value} from "./bridge.mjs";';}
  if(seam==='require'){const host=join(f.root,'host.cjs');writeFileSync(host,'const {value}=require("./helper.cjs");'+readFileSync(f.host,'utf8'));f.options.command=process.execPath+' '+host;}
  else if(seam.startsWith('package')||seam==='resolution-shadow'){
   f.put(join(f.root,'node_modules/helper-package/package.json'),JSON.stringify({name:'helper-package',type:'module',exports:'./index.mjs',dependencies:{'nested-helper':'1'}}));
   f.put(join(f.root,'node_modules/helper-package/index.mjs'),'export {value} from "nested-helper";');
   f.put(join(f.root,'node_modules/nested-helper/package.json'),JSON.stringify({name:'nested-helper',type:'module',exports:'./index.mjs'}));f.put(join(f.root,'node_modules/nested-helper/index.mjs'),'export const value="original-helper";');prefix='import {value} from "helper-package";';
  }
  if(seam!=='require')writeFileSync(f.host,prefix+readFileSync(f.host,'utf8'));
  const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.status,'succeeded',seam);assert.equal(r.replay.available,true,seam+JSON.stringify(r.replay));const calls=readFileSync(f.log,'utf8');
  if(seam==='package')writeFileSync(join(f.root,'node_modules/nested-helper/index.mjs'),'export const value="CHANGED-helper";');
  else if(seam==='package-manifest')writeFileSync(join(f.root,'node_modules/helper-package/package.json'),JSON.stringify({type:'module',exports:'./other.mjs'}));
  else if(seam==='resolution-shadow'){f.put(join(f.root,'node_modules/helper-package/node_modules/nested-helper/package.json'),JSON.stringify({type:'module',exports:'./index.mjs'}));f.put(join(f.root,'node_modules/helper-package/node_modules/nested-helper/index.mjs'),'export const value="SHADOW-helper";');}
  else writeFileSync(helper,seam==='require'?'exports.value="CHANGED-helper";':'export const value="CHANGED-helper";');
  const replay=replayCli(f.options.output,{encoding:'utf8',timeout:15000});assert.equal(replay.status,2,seam+replay.stdout+replay.stderr);assert.equal(readFileSync(f.log,'utf8'),calls,seam);
 }finally{f.cleanup();}}
});
test("R9-2 computed modules and shell wrappers explicitly cannot replay",async()=>{for(const seam of ['import','require','shell']){const f=fixture();try{
 if(seam==='import')writeFileSync(f.host,'const helper="node:fs";await import(helper);'+readFileSync(f.host,'utf8'));
 if(seam==='require'){const host=join(f.root,'host.cjs');writeFileSync(host,'const helper="node:fs";require(helper);'+readFileSync(f.host,'utf8'));f.options.command=process.execPath+' '+host;}
 if(seam==='shell'){const wrapper=join(f.root,'bash');writeFileSync(wrapper,Buffer.concat([readFileSync(process.execPath),Buffer.from('fake-shell-fixture')]),{mode:0o700});f.options.command=wrapper+' '+f.host;}
 const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.status,'succeeded');assert.equal(r.replay.available,false);assert.equal(existsSync(join(f.options.output,'replay.sh')),false);
 }finally{f.cleanup();}}});
test("R9-3 safe effective environment drift fails closed, credentials re-resolve without retention",async()=>{
 for(const key of ['GOOSE_MODEL','GOOSE_PROVIDER','LANG','OPENAI_API_KEY']){const f=fixture(),old=process.env[key];try{
  process.env[key]=key==='OPENAI_API_KEY'?'opaque-original-credential-987654321':'original-safe-value';const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.replay.available,true);const calls=readFileSync(f.log,'utf8');
  assertNoRetainedSecret(f.options.output,'opaque-original-credential-987654321');process.env[key]=key==='OPENAI_API_KEY'?'opaque-replacement-credential-123456789':'changed-safe-value';
  const replay=replayCli(f.options.output,{encoding:'utf8',timeout:15000});assert.equal(replay.status,key==='OPENAI_API_KEY'?0:2,key+replay.stdout+replay.stderr);
  if(key!=='OPENAI_API_KEY'){assert.equal(JSON.parse(replay.stdout).failure.code,'replay-current-environment-drift');assert.equal(readFileSync(f.log,'utf8'),calls);}else assert(!replay.stdout.includes(process.env[key]!));
 }finally{old===undefined?delete process.env[key]:process.env[key]=old;f.cleanup();}}
});
test("R9-3 CLI model override binds effective rather than shadowed ambient environment",async()=>{const f=fixture(),old=process.env.GOOSE_MODEL;try{process.env.GOOSE_MODEL='shadowed-original';const r:any=await runIsolatedEvaluation({...f.options,model:'effective-model',dryRun:false});assert.equal(r.replay.available,true);process.env.GOOSE_MODEL='shadowed-changed';const replay=replayCli(f.options.output,{encoding:'utf8',timeout:15000});assert.equal(replay.status,0,replay.stdout+replay.stderr);}finally{old===undefined?delete process.env.GOOSE_MODEL:process.env.GOOSE_MODEL=old;f.cleanup();}});

test("public auth command reused in locator does not taint execution",async()=>{const f=fixture();try{f.put(join(f.home,'.config/goose/custom_providers/provider.json'),JSON.stringify({auth:{command:'fixture'}}));const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.exit_code,0);assert.equal(r.status,'succeeded');assert.equal(existsSync(f.log),true);}finally{f.cleanup();}});
test("R9-2 interpolated module templates and aliased require are unavailable",async()=>{for(const seam of ['template','alias']){const f=fixture();try{if(seam==='template')writeFileSync(f.host,'const text=`${await import("node:fs").then(()=>"loaded")}`;'+readFileSync(f.host,'utf8'));else{const host=join(f.root,'host.cjs');writeFileSync(host,'const load=require;load("node:fs");'+readFileSync(f.host,'utf8'));f.options.command=process.execPath+' '+host;}const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.status,'succeeded');assert.equal(r.replay.available,false);assert.equal(existsSync(join(f.options.output,'replay.sh')),false);}finally{f.cleanup();}}});

test("R9-2 sensitive helper bytes and native package addons do not produce closure hashes",async()=>{for(const seam of ['secret','native']){const f=fixture(),secret='opaque-helper-credential-987654321';try{if(seam==='secret'){f.put(join(f.home,'.config/goose/secrets.yaml'),'API_KEY: '+secret);writeFileSync(join(f.root,'helper.mjs'),'export const value='+JSON.stringify(secret)+';');writeFileSync(f.host,'import {value} from "./helper.mjs";'+readFileSync(f.host,'utf8'));}else{f.put(join(f.root,'node_modules/native-helper/package.json'),JSON.stringify({type:'module',exports:'./index.mjs'}));f.put(join(f.root,'node_modules/native-helper/index.mjs'),'export const value="ordinary";');f.put(join(f.root,'node_modules/native-helper/addon.node'),'native-binary-placeholder');writeFileSync(f.host,'import {value} from "native-helper";'+readFileSync(f.host,'utf8'));}const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.status,'succeeded');assert.equal(r.replay.available,false);assert.equal(existsSync(join(f.options.output,'replay-recipe.json')),false);assert.equal(existsSync(join(f.options.output,'replay.sh')),false);assertNoRetainedSecret(f.options.output,secret);}finally{f.cleanup();}}});

// NEW budget round 1: approved invocation-level native replay and privacy gates.
const fidelityExpected={level:'invocation+frozen-inputs',unbound:['filesystem','network','auth','native libraries'],guarantees_identical_result:false,benchmark_acceptance:false};
function assertFidelity(value:any){assert.deepEqual(value,fidelityExpected);}
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
test('NEW-F2 evaluator production runtime taint disables retention without a dependency hash',async()=>{const f=fixture(),secret='opaque-runtime-private-987654321';try{f.put(join(f.home,'.config/goose/secrets.yaml'),'API_KEY: '+secret);const app=copyRuntime(f),file=join(app,'node_modules/js-yaml/index.js');writeFileSync(file,readFileSync(file,'utf8')+'\n// '+secret+'\n');const sensitive=readFileSync(file,'utf8');const r:any=await copiedEvaluation(app,{...f.options,dryRun:false});assert.equal(r.status,'succeeded');assert.equal(r.replay.available,false);assert.equal(r.replay.reason,'replay-sensitive-runtime-bytes');assert.equal(existsSync(join(f.options.output,'replay-recipe.json')),false);assert.equal(existsSync(join(f.options.output,'replay.sh')),false);assertNoRetainedSecret(f.options.output,secret);assertNoRetainedSecret(f.options.output,sensitive);}finally{f.cleanup();}});
test('NEW-F3 Node runtime external IO is allowed but explicitly unbound with parent provenance',async()=>{const f=fixture();try{const external=join(f.root,'external.txt');writeFileSync(external,'external-original');writeFileSync(f.host,readFileSync(f.host,'utf8').replace('const output=JSON.stringify','const output=JSON.stringify').replace('prompt:input,initial:','external:fs.readFileSync('+JSON.stringify(external)+',"utf8"),prompt:input,initial:'));const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.replay.available,true);assertFidelity(r.replay.fidelity);const recipe=JSON.parse(readFileSync(join(f.options.output,'replay-recipe.json'),'utf8'));assertFidelity(recipe.fidelity);assert(!recipe.launcher_closure.policy.includes('runtime IO and computed loaders unsupported'));assert.equal(JSON.parse(r.runs[0].output).external,'external-original');writeFileSync(external,'external-changed');const child=replayCli(f.options.output,{encoding:'utf8',timeout:15000});assert.equal(child.status,0,child.stdout+child.stderr);const fresh=JSON.parse(child.stdout);assert.equal(JSON.parse(fresh.runs[0].output).external,'external-changed');assert.equal(fresh.parent.output,f.options.output);assertFidelity(fresh.replay.fidelity);}finally{f.cleanup();}});
test('NEW-F2 intermediate symlink target bytes are screened even with a clean final path',()=>{const f=fixture(),secret='opaque-link-private-987654321';try{mkdirSync(join(f.root,secret));const wrapper=join(f.root,'wrapper');writeFileSync(wrapper,'#!/bin/sh\nexit 0\n',{mode:0o700});const link=join(f.root,'launcher');symlinkSync(secret+'/../wrapper',link);const identity:any=executableIdentity(link,process.env,f.root,v=>!v.includes(secret));assert.equal(identity.available,false);assert.equal(identity.reason,'sensitive-executable-symlink');assert.equal(identity.sha256,undefined);}finally{f.cleanup();}});
test('NEW-F1 unknown executable formats and shebang wrappers remain explicitly unavailable',async()=>{for(const kind of ['unknown','shebang']){const f=fixture();try{const host=join(f.root,'unsupported');writeFileSync(host,kind==='unknown'?Buffer.from([255,0,1,2]):'#!/bin/sh\nexit 0\n',{mode:0o700});const r:any=await runIsolatedEvaluation({...f.options,command:host});assert.equal(r.status,'prepared');assert.equal(r.replay.available,false);assert.equal(r.replay.reason,'replay-unsupported-launcher');assertFidelity(r.replay.fidelity);assert.equal(existsSync(join(f.options.output,'replay.sh')),false);}finally{f.cleanup();}}});

// NEW budget round 2: native protocol literals are not confirmed credentials.
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
 const f=fixture();try{
  const app=copyRuntime(f),file=join(app,'node_modules/js-yaml/index.js');
  writeFileSync(file,readFileSync(file,'utf8')+'\n// Bearer %s\n');
  const r:any=await copiedEvaluation(app,{...f.options,dryRun:false});assert.equal(r.status,'succeeded');assert.equal(r.replay.available,false);assert.equal(r.replay.reason,'replay-sensitive-runtime-bytes');assert.equal(existsSync(join(f.options.output,'replay-recipe.json')),false);assert.equal(existsSync(join(f.options.output,'replay.sh')),false);
  assertNoRetainedSecret(f.options.output,createHash('sha256').update(readFileSync(file)).digest('hex'));
 }finally{f.cleanup();}
});

// NEW budget round 3: exact native provider diagnostic, without retaining child payload.
for (const channel of ['stdout', 'stderr']) test('NEW-R3 exact provider-not-configured is safe on '+channel, async()=>{
 for (const suffix of ['', 'credential suffix: opaque-provider-private-987654321']) {
  const f=fixture(),secret='opaque-provider-private-987654321';
  const message="\n  error: No provider configured. Run 'goose configure' first.\n\n";
  try {
   const original=readFileSync(f.host,'utf8');
   writeFileSync(f.host,original.replace('const output=JSON.stringify', 'process.'+channel+'.write('+JSON.stringify(message+suffix)+');process.exit(1);const output=JSON.stringify'));
   const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});
   assert.equal(r.exit_code,1);assert.equal(r.runs.length,2);
   for (const run of r.runs) {
    assert.deepEqual(run.diagnostic,{category:'configuration',code:'provider-not-configured',source:channel});
    assert.equal(run.exit_code,1);assert.equal(run.exit_reason,'host-exit');assert.equal(run.output,null);
    const trace=JSON.parse(readFileSync(join(f.options.output,r.runs.indexOf(run)===0?'baseline':'with_targets','run-1/task-invocation.json'),'utf8'));
    assert.deepEqual(trace.result.diagnostic,run.diagnostic);
    assert.equal(trace.result[channel+'_bytes'],Buffer.byteLength(message+suffix));
    assert.equal(trace.result[(channel==='stdout'?'stderr':'stdout')+'_bytes'],0);
   }
   assert(!JSON.stringify(r).includes(secret));assert(!JSON.stringify(r).includes(createHash('sha256').update(secret).digest('hex')));
   assertNoRetainedSecret(f.options.output,secret);assertNoRetainedSecret(f.options.output,message+suffix);
   assert.equal(readFileSync(f.log,'utf8').trim().split('\n').length,4); // Only discovery and task runs; no configure action.
  } finally {f.cleanup();}
 }
});
test('NEW-R3 provider diagnostic does not classify arbitrary tool instructions',async()=>{
 const exact="\n  error: No provider configured. Run 'goose configure' first.\n\n";
 for(const text of ['tool says: '+exact,exact.replace("'goose configure'","'tools__execute --configure'"),'No provider configured. Run arbitrary tool first.']) {
  const f=fixture();try {
   writeFileSync(f.host,readFileSync(f.host,'utf8').replace('const output=JSON.stringify','process.stderr.write('+JSON.stringify(text)+');process.exit(1);const output=JSON.stringify'));
   const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.exit_code,1);
   for(const run of r.runs)assert.deepEqual(run.diagnostic,{category:'execution',code:'unknown-host-failure',source:'process'});
  }finally{f.cleanup();}
 }
});

// ap-drp redesign: requirement-derived red tests before implementation.
function replayCli(output:string, options:Record<string,unknown>={}) {
 const metadata=JSON.parse(readFileSync(join(output,"report.json"),"utf8")).replay;
 const env={...process.env};delete env.NODE_OPTIONS;delete env.NODE_PATH;
 return spawnSync(process.execPath,[join(import.meta.dirname,"../dist/scripts/cli.js"),"replay","--recipe",join(output,"replay-recipe.json"),"--recipe-sha256",metadata.recipe_sha256 ?? "missing","--format","json"],{encoding:"utf8",timeout:15000,env,...options});
}
test("DRP CLI replay replaces shell generation and runs one fresh pair",async()=>{const f=fixture();try{
 const r:any=await runIsolatedEvaluation({...f.options,dryRun:false,runsPerQuery:2});assert.equal(r.replay.available,true);assert.equal(r.runs.length,4);
 assert.equal(existsSync(join(f.options.output,"replay.sh")),false);assert.match(r.replay.command,/skill-creator replay --recipe/);assert.match(r.replay.recipe_sha256,/^[a-f0-9]{64}$/);
 const child=replayCli(f.options.output);assert.equal(child.status,0,child.stdout+child.stderr);const result=JSON.parse(child.stdout);assert.equal(result.attempt_kind,"replay");assert.equal(result.runs.length,2);
}finally{f.cleanup();}});
test("DRP real success streams retain benign stderr but withhold provider payload",async()=>{const f=fixture();try{
 writeFileSync(f.host,readFileSync(f.host,"utf8").replace("const output=JSON.stringify","process.stderr.write('benign diagnostic\\n');const output=JSON.stringify"));
 const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.exit_code,0);
 const receipt=JSON.parse(readFileSync(join(f.options.output,"baseline/run-1/task-invocation.json"),"utf8"));
 assert.equal(receipt.result.channels.stderr.text,"benign diagnostic\n");assert.equal(receipt.result.channels.stderr.observed_bytes,18);
 assert.equal(receipt.result.channels.stdout.withheld,true);assert.equal(receipt.result.channels.stdout.text,null);assert.equal(receipt.result.channels.stdout.withheld_reason,"provider-event-stream");
}finally{f.cleanup();}});

for(const seam of ["chunk-secret","invalid-utf8","timeout","output-limit","cap","structured","prefixed-structured","credential"]) test("DRP diagnostic channel boundary "+seam,async()=>{const f=fixture();try{
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
test("DRP candidate replay module drift cannot execute while current CLI remains trusted",async()=>{const f=fixture();try{
 const app=copyRuntime(f),r:any=await copiedEvaluation(app,{...f.options,dryRun:false});assert.equal(r.replay.available,true);
 const marker=join(f.root,"candidate-module-marker"),module=join(app,"dist/scripts/evaluation_replay.js");
 writeFileSync(module,"import fs from 'node:fs';fs.writeFileSync("+JSON.stringify(marker)+",'executed');\n"+readFileSync(module,"utf8"));
 const child=replayCli(f.options.output);assert.equal(child.status,2);assert.match(child.stderr,/^Replay unavailable: replay-runtime-drift\n$/);assert.equal(existsSync(marker),false);
}finally{f.cleanup();}});
for(const code of [null,0.5,"0",undefined,NaN,-1,256,0])test("DRP public CLI validates replay exit code "+String(code),async()=>{const f=fixture();try{
 const app=copyRuntime(f),module=join(app,"dist/scripts/evaluation_replay.js");
 const source=readFileSync(module,"utf8"),start=source.indexOf('export async function replay(');
 writeFileSync(module,source.slice(0,start)+'export async function replay(){return {exit_code:'+String(typeof code==="string" ? JSON.stringify(code) : code)+'};}');
 const r:any=await copiedEvaluation(app,{...f.options,dryRun:false});assert.equal(r.replay.available,true);
 const child=replayCli(f.options.output);assert.equal(child.status,code===0 ? 0 : 2,child.stdout+child.stderr);
 if(code!==0){assert.equal(child.stdout,"");assert.equal(child.stderr,"Replay unavailable: replay-invalid-exit-code\n");}
}finally{f.cleanup();}});
test("DRP public CLI rejects unbound recipe digest and unsupported campaign options",async()=>{for(const args of [["--recipe","private-path","--recipe-sha256","bad","--format","json"],["--resume"],["--help"]]){
 const child=spawnSync(process.execPath,[join(import.meta.dirname,"../dist/scripts/cli.js"),"replay",...args],{encoding:"utf8"});assert.equal(child.status,args[0]==="--help" ? 0 : 2);assert(!child.stderr.includes("private-path"));assert(!child.stderr.includes(" at "));
}});

test("DRP benign failing stdout and stderr keep distinct channel provenance",async()=>{const f=fixture();try{
 writeFileSync(f.host,readFileSync(f.host,"utf8").replace("const output=JSON.stringify","process.stdout.write('ordinary stdout diagnostic\\n');process.stderr.write('ordinary stderr diagnostic\\n');process.exit(7);const output=JSON.stringify"));
 const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.exit_code,1);
 for(const arm of ["baseline","with_targets"]){const receipt=JSON.parse(readFileSync(join(f.options.output,arm,"run-1/task-invocation.json"),"utf8"));assert.equal(receipt.result.exit_code,7);assert.equal(receipt.result.exit_reason,"host-exit");
  for(const channel of ["stdout","stderr"]){const c=receipt.result.channels[channel];assert.equal(c.text,"ordinary "+channel+" diagnostic\n");assert.equal(c.complete,true);assert.equal(c.decode_status,"complete");assert.equal(c.retained_bytes,c.observed_bytes);assert.equal(c.withheld,false);assert.equal(c.redacted,false);}
 }
}finally{f.cleanup();}});
test("DRP diagnostic byte cap never retains an incomplete UTF8 character",async()=>{const f=fixture();try{
 writeFileSync(f.host,readFileSync(f.host,"utf8").replace("const output=JSON.stringify","process.stderr.write(('€').repeat(30000));const output=JSON.stringify"));
 const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.exit_code,0);
 const c=JSON.parse(readFileSync(join(f.options.output,"baseline/run-1/task-invocation.json"),"utf8")).result.channels.stderr;
 assert.equal(c.observed_bytes,90000);assert.equal(c.retained_bytes,65535);assert.equal(c.truncated,true);assert.equal(c.text.includes('�'),false);assert.equal(c.text.length,21845);
}finally{f.cleanup();}});

test("opaque short auth arguments do not taint public paths but exact token artifacts remain private",async()=>{
 const f=fixture();try{f.put(join(f.home,'.config/goose/custom_providers/provider.json'),JSON.stringify({auth:{command:'public-command',args:['--scope','xx']},unknown:1,boolean:true}));const r:any=await runIsolatedEvaluation({...f.options,dryRun:false,withSkills:['one']});assert.equal(r.status,'succeeded',JSON.stringify(r));assert.equal(captureEvaluationConfig(f.home).secrets.includes('1'),false);}finally{f.cleanup();}
});

test("external provider references do not block private execution",async()=>{
 const f=fixture();try{f.put(join(f.home,'.config/goose/config.yaml'),yaml.dump({TLS_FILE:join(f.home,'.azure/cert')}));const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.status,'succeeded',JSON.stringify(r));assert.equal(existsSync(f.log),true);}finally{f.cleanup();}
});
test("failure recovery is persisted alongside observed process without relaunch",async()=>{
 const f=fixture();try{const original=readFileSync(f.host,'utf8');writeFileSync(f.host,original.replace('const output=JSON.stringify','process.stderr.write("authentication failed");process.exit(1);const output=JSON.stringify'));const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});const saved=JSON.parse(readFileSync(join(f.options.output,'report.json'),'utf8'));for(const run of saved.runs){assert.equal(run.recovery.retryable,false);assert.equal(run.recovery.action,'user-prerequisite');assert.equal(run.process_result.exit_code,1);}assert.equal(readFileSync(f.log,'utf8').trim().split('\n').map(x=>JSON.parse(x)).filter(x=>x.mode==='run').length,2);}finally{f.cleanup();}
});

test("inherited custom environment reaches both arms without public value dumps",async()=>{
 const f=fixture(),keys=['UNLISTED_PROVIDER_URL','AMBIENT_PRIVATE_CONTEXT','GOOSE_ADDITIONAL_CONFIG_FILES','GOOSE_MOIM_MESSAGE_TEXT'],old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));try{process.env.UNLISTED_PROVIDER_URL='https://synthetic-provider.example';process.env.AMBIENT_PRIVATE_CONTEXT='private-runtime-context';process.env.GOOSE_ADDITIONAL_CONFIG_FILES='/ambient/config.yaml';process.env.GOOSE_MOIM_MESSAGE_TEXT='ambient-prompt';const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.status,'succeeded',JSON.stringify(r));for(const c of readFileSync(f.log,'utf8').trim().split('\n').map(x=>JSON.parse(x))){assert.equal(c.env.UNLISTED_PROVIDER_URL,process.env.UNLISTED_PROVIDER_URL);assert.equal(c.env.AMBIENT_PRIVATE_CONTEXT,process.env.AMBIENT_PRIVATE_CONTEXT);assert.equal(c.env.GOOSE_ADDITIONAL_CONFIG_FILES,undefined);assert.equal(c.env.GOOSE_MOIM_MESSAGE_TEXT,undefined);assert.notEqual(c.home,f.home);}assert(!JSON.stringify(r).includes('https://synthetic-provider.example'));for(const run of r.runs){const receipt=JSON.parse(readFileSync(join(f.options.output,run.task_invocation),'utf8'));assert(!JSON.stringify(receipt).includes('private-runtime-context'));assert(!JSON.stringify(receipt).includes('https://synthetic-provider.example'));}}finally{for(const k of keys)old[k]===undefined?delete process.env[k]:process.env[k]=old[k];f.cleanup();}
});

test("shell startup loaders do not restore external HOME in descendant tools",async()=>{
 const f=fixture(),old=process.env.BASH_ENV;try{const startup=join(f.root,'startup.sh');writeFileSync(startup,'export HOME=/synthetic/external-home\n');process.env.BASH_ENV=startup;const original=readFileSync(f.host,'utf8');writeFileSync(f.host,original.replace('const output=JSON.stringify','const cp=await import("node:child_process");const descendant=cp.spawnSync("/bin/bash",["-c","env"],{encoding:"utf8"});if(process.env.BASH_ENV||!descendant.stdout.split("\\n").includes("HOME="+home))process.exit(8);const output=JSON.stringify'));const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.status,'succeeded',JSON.stringify(r));}finally{old===undefined?delete process.env.BASH_ENV:process.env.BASH_ENV=old;f.cleanup();}
});
