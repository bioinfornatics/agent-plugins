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
  // Match Goose's native entrypoint without repeatedly capturing an interpreted
  // host's Node module closure; execv preserves argv, environment, stdin and status.
  const source=join(f.root,"forward.c"),forward=join(f.root,"forward-host");
  writeFileSync(source,'#include <unistd.h>'+String.fromCharCode(10)+'#include <stdlib.h>'+String.fromCharCode(10)+'int main(int argc,char **argv){char **args=calloc(argc+2,sizeof(char*));if(!args)return 9;args[0]='+JSON.stringify(process.execPath)+';args[1]='+JSON.stringify(f.host)+';for(int i=1;i<argc;i++)args[i+1]=argv[i];execv(args[0],args);return 9;}');
  const compiled=spawnSync("cc",[source,"-o",forward],{encoding:"utf8",env:{...process.env,CCACHE_DISABLE:"1"}});assert.equal(compiled.status,0,compiled.stderr);
  f.options.command=forward;
  const launcher=join(import.meta.dirname,"../../../skills/skill-creator/scripts/skill-creator.mjs"),reports:any[]=[];
  for(const [index,model] of ["fixture-model-a","fixture-model-b"].entries()){
   const result=spawnSync(process.execPath,[launcher,"run-evaluation","--prompt",f.options.prompt,"--output",join(f.root,"model-"+index),"--source-home",f.home,"--fixtures",f.files,"--with-skills","one","--with-plugin","bundle","--model",model,"--goose-command",f.options.command,"--format","json"],{encoding:"utf8",timeout:15000});
   assert.equal(result.status,0,result.stderr+result.stdout);
   const report=JSON.parse(result.stdout).output;assert.equal(report.status,"awaiting-grading");assert.equal(report.model,model);reports.push(report);
   const recipe=JSON.parse(readFileSync(join(f.root,"model-"+index,"case-0/replay-recipe.json"),"utf8"));assert.equal(recipe.launcher_closure.kind,"native-executable");
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
  const imported=join(f.root,"grades.json");writeFileSync(imported,JSON.stringify(grades));const resumed=protocolCall(f,["--resume","--output",f.options.output,"--grading-results",imported]);assert.equal(resumed.status,0,resumed.stdout);const final=JSON.parse(resumed.stdout).output;assert.equal(final.status,"complete");assert.equal(final.comparison.complete_pairs,1);assert.equal(final.comparison.criteria.both_pass,1);const html=readFileSync(final.review,"utf8");assert.match(html,/1 fully graded pairs/);assert.match(html,/with_skill/);assert.match(html,/without_skill/);assert.match(html,/Outputs original input/);assert.match(html,/The output preserves the original input/);assert.equal(readFileSync(f.log,"utf8"),count);assert(existsSync(join(f.options.output,"case-0/baseline/run-1/outputs/artifacts/input.txt")));
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
 const f=retainedProtocolFixture("behavioral");try{const before=readFileSync(f.log,"utf8");writeFileSync(join(f.options.output,"case-0/baseline/run-1/outputs/artifacts/input.txt"),"changed");const resumed=protocolCall(f,["--resume","--output",f.options.output]);assert.equal(resumed.status,2);assert.match(resumed.stdout,/artifact drift/);assert.equal(readFileSync(f.log,"utf8"),before);}finally{f.cleanup();}
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
 const f=retainedProtocolFixture("activation",2);try{f.state.runs=f.state.runs.filter(x=>x.case_id===0);f.state.campaigns=f.state.campaigns.filter(x=>x.case_id===0);f.saveState();rmSync(join(f.options.output,"case-1"),{recursive:true});const before=readFileSync(f.log,"utf8"),resumed=protocolCall(f,["--resume","--output",f.options.output]);assert.equal(resumed.status,0,resumed.stdout);const report=JSON.parse(resumed.stdout).output;assert.equal(report.status,"incomplete");assert.deepEqual(report.missing_runs,[{case_id:1,arm:"baseline",repeat:1},{case_id:1,arm:"with_targets",repeat:1}]);assert.equal(report.runs.length,2);assert.deepEqual(report.activation_results.map((x:any)=>x.pass),[true,true]);assert.equal(existsSync(join(f.options.output,"case-1")),false);assert.equal(readFileSync(f.log,"utf8"),before);
 }finally{f.cleanup();}
});
