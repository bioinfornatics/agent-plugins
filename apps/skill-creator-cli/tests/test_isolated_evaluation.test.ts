import test from "node:test";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,existsSync,statSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync} from "node:child_process";
import {captureEvaluationConfig,stageEvaluationConfig} from "../dist/scripts/evaluation_config.js";
import yaml from "js-yaml";
import {runIsolatedEvaluation} from "../dist/scripts/evaluation_isolated.js";
async function fakeHost(){
 const fs=await import("node:fs"),path=await import("node:path"),mode=process.argv[2],home=process.env.HOME!,cwd=process.cwd();
 fs.appendFileSync(log,JSON.stringify({mode,home,cwd,argv:process.argv.slice(2),env:process.env})+"\n");
 if(process.env.AMBIENT_PRIVATE_CONTEXT||process.env.GOOSE_MOIM_MESSAGE_TEXT||process.env.NODE_OPTIONS)process.exit(9);
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
