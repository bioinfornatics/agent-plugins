import test from "node:test";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,existsSync,statSync,readdirSync,cpSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync} from "node:child_process";
import {captureEvaluationConfig,stageEvaluationConfig} from "../dist/scripts/evaluation_config.js";
import yaml from "js-yaml";
import {prepareGradingRequest,validateGradingResponse,bindSemanticJudgments} from "../dist/scripts/evaluation_grading.js";
import {projectActionTrace,runIsolatedEvaluation} from "../dist/scripts/evaluation_isolated.js";
import {executableIdentity} from "../dist/scripts/evaluation_replay.js";
import {preserveTaskEvidence,snapshotTaskFiles,validateTaskEvidence,renderTaskEvidence} from "../dist/scripts/task_evidence.js";
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
  const count=readFileSync(f.log,"utf8");const grades=report.grading_requests.map((entry:any)=>{const packet=JSON.parse(readFileSync(entry.request_path,"utf8"));assert(!JSON.stringify(packet).includes(f.home));assert(!JSON.stringify(packet).includes("with_targets"));assert(packet.outputs.some((source:any)=>source.content.includes("mutated")));assert(packet.outputs.every((source:any)=>!source.content.includes("before_sha256")));return{request_id:packet.request_id,judgments:[{text:packet.expectations[0],verdict:"pass",evidence_quote:"original",rationale:"The output preserves the original input in its response."}]};});
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

// Deterministic packet-contract test. No simulated result is a Skill-quality verdict.
test("decoded grading sources accept original text and reject metadata or escaped transport quotes",()=>{
 const root=mkdtempSync(join(tmpdir(),"decoded-grading-")),cwd=join(root,"cwd"),run=join(root,"run");
 try{
  mkdirSync(cwd);mkdirSync(run);const before=snapshotTaskFiles(cwd);mkdirSync(join(cwd,"outputs"));
  const original="Line one"+String.fromCharCode(10)+"Line two";
  writeFileSync(join(cwd,"outputs","answer.txt"),original);
  const context=preserveTaskEvidence(cwd,run,before,"Final response",0);
  writeFileSync(join(run,"outputs","result.txt"),renderTaskEvidence(context));
  const packet=prepareGradingRequest(root,run,["result.txt"],["Explain the answer"],true);
  assert.deepEqual(packet.request.outputs.map(o=>o.content),["Final response",original]);
  const response=(quote:string)=>({request_id:packet.request_id,judgments:[{text:"Explain the answer",verdict:"pass",evidence_quote:quote,rationale:"The quote is displayed original task text."}]});
  assert.equal(validateGradingResponse(response(original),packet).summary.passed,1);
  for(const quote of ["after_sha256",JSON.stringify(original).slice(1,-1),"An invented quotation"])
   assert.throws(()=>validateGradingResponse(response(quote),packet),/quote/);
  assert.throws(()=>prepareGradingRequest(root,run,["result.txt"],["Explain the answer"],false),/unsupported/);
  writeFileSync(join(run,"outputs","artifacts","outputs","answer.txt"),"changed");
  assert.throws(()=>prepareGradingRequest(root,run,["result.txt"],["Explain the answer"],true),/drift/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test("host maps semantic criteria without generated request identifiers",()=>{
 const packet:any={request_id:"host-owned",request:{outputs:[{content:"Exact output"}],expectations:["Criterion"]}};
 const semantic=[{criterion_index:0,verdict:"pass",evidence_quote:"Exact output",rationale:"The displayed output provides the evidence."}];
 assert.equal(bindSemanticJudgments(packet,semantic).request_id,"host-owned");
 assert.throws(()=>bindSemanticJudgments(packet,[{...semantic[0],request_id:"wrong"}]),/unsolicited/);
 assert.throws(()=>bindSemanticJudgments(packet,[{...semantic[0],evidence_quote:"invented"}]),/quote/);
 assert.throws(()=>bindSemanticJudgments(packet,[{...semantic[0],criterion_index:1}]),/index/);
});
test("observer trace keeps correlations and missingness, never secret bodies or claimed exits",()=>{
 const secret="synthetic-sensitive-canary-123456789";
 const request={type:"toolRequest",id:"x",toolCall:{Ok:{name:"developer__shell",arguments:{command:secret}}}};
 const trace=projectActionTrace([{message:{content:[request]}}]);
 assert.equal(trace.actions[0].state,"incomplete");assert.ok(!JSON.stringify(trace).includes(secret));
 const answered=projectActionTrace([{message:{content:[request,{type:"toolResponse",id:"x",toolResult:{Ok:{content:[{text:secret,exit_code:0}]}}}]}}]);
 assert.equal(answered.actions[0].state,"responded");assert.ok(!JSON.stringify(answered).includes(secret));assert.ok(!JSON.stringify(answered).includes("exit_code"));
 assert.equal(projectActionTrace([{message:{content:[request,request]}}]).ambiguous,true);
});

// A permitted six-MiB capture exceeds eight MiB only after base64 transport.
// It must remain gradeable, without making omitted artifact bytes semantic proof.
test("allowed three two-MiB artifacts prepare a bound grading request despite base64 expansion",()=>{
 const root=mkdtempSync(join(tmpdir(),"large-grading-context-")),cwd=join(root,"cwd"),run=join(root,"run");
 try{
  mkdirSync(cwd);mkdirSync(run);mkdirSync(join(cwd,"outputs"));
  for(let i=0;i<3;i++)writeFileSync(join(cwd,"outputs",`large-${i}.txt`),Buffer.alloc(2*1024*1024,65+i));
  const stdout="Large artifact capture complete",context=preserveTaskEvidence(cwd,run,{},stdout,0);
  assert.equal(Object.keys(context.files).length,3);
  const contextPath=join(run,"outputs/task-evidence.json");assert.ok(statSync(contextPath).size>8*1024*1024);
  writeFileSync(join(run,"outputs/result.txt"),renderTaskEvidence(context));
  const packet=prepareGradingRequest(root,run,["result.txt"],["The task reports a complete capture"],true);
  assert.deepEqual(packet.request.outputs.map(source=>source.content),[stdout]);
  assert.deepEqual((packet.request as any).visibility,{complete:false,omitted_sources:3});
  const response=(quote:string)=>({request_id:packet.request_id,judgments:[{text:packet.request.expectations[0],verdict:"pass",evidence_quote:quote,rationale:"The displayed final response reports the capture."}]});
  assert.equal(validateGradingResponse(response(stdout),packet).summary.passed,1);
  assert.throws(()=>validateGradingResponse(response("A".repeat(100)),packet),/quote/);
  writeFileSync(join(run,"outputs/artifacts/outputs/large-2.txt"),Buffer.alloc(2*1024*1024,88));
  assert.throws(()=>prepareGradingRequest(root,run,["result.txt"],packet.request.expectations,true),/drift/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

// Public recovery guarantee: a later unavailable judge cannot erase an earlier
// validated response, or make retrying an already attempted judge implicit.
test("partial grader failure retains prior grade and resume imports only the pending slot",()=>{
 const f=retainedProtocolFixture("behavioral"),judgeLog=join(f.root,"judge-calls");
 try{
  writeFileSync(f.host,'import {readFileSync,appendFileSync,existsSync} from "node:fs";const log='+JSON.stringify(judgeLog)+';const count=existsSync(log)?readFileSync(log,"utf8").trim().split("\\n").length:0;appendFileSync(log,"judge\\n");readFileSync(0,"utf8");console.log(JSON.stringify(count===0?{type:"complete",output:JSON.stringify([{criterion_index:0,verdict:"pass",evidence_quote:"original",rationale:"The displayed response preserves the original input."}])}:{type:"complete",success:false,error:"unavailable"}));');
  const candidateLog=readFileSync(f.log),command=process.execPath+" "+f.host;
  const failed=protocolCall(f,["--resume","--output",f.options.output,"--grade","--goose-command",command]);
  assert.equal(failed.status,2,failed.stdout+failed.stderr);
  const first=join(f.options.output,"case-0/baseline/run-1"),pending=join(f.options.output,"case-0/with_targets/run-1");
  assert.equal(JSON.parse(readFileSync(join(first,"grader-invocation.json"),"utf8")).grade_status,"validated","first judge must actually produce validated evidence");
  assert.equal(existsSync(join(first,"grading.json")),true,"earlier valid grade was lost after later judge failure");
  assert.equal(existsSync(join(first,"grading-response.json")),true);
  const gradeBytes=readFileSync(join(first,"grading.json")),responseBytes=readFileSync(join(first,"grading-response.json"));
  assert.equal(JSON.parse(gradeBytes.toString()).summary.passed,1);
  assert.equal(existsSync(join(pending,"grading.json")),false);
  assert.equal(JSON.parse(readFileSync(join(pending,"grader-invocation.json"),"utf8")).grade_status,"unavailable");
  const calls=readFileSync(judgeLog);assert.equal(calls.toString().trim().split("\n").length,2);
  const retry=protocolCall(f,["--resume","--output",f.options.output,"--grade","--goose-command",command]);assert.equal(retry.status,2,retry.stdout);assert.deepEqual(readFileSync(judgeLog),calls);
  const projected=protocolCall(f,["--resume","--output",f.options.output]);assert.equal(projected.status,0,projected.stdout);
  const report=JSON.parse(projected.stdout).output;assert.equal(report.status,"awaiting-grading");assert.equal(report.grading_requests.length,1);
  const packet=JSON.parse(readFileSync(report.grading_requests[0].request_path,"utf8")),grades=join(f.root,"pending-grade.json");
  writeFileSync(grades,JSON.stringify([{request_id:packet.request_id,judgments:[{text:packet.expectations[0],verdict:"pass",evidence_quote:"original",rationale:"The displayed response preserves the original input."}]}]));
  const completed=protocolCall(f,["--resume","--output",f.options.output,"--grading-results",grades]);assert.equal(completed.status,0,completed.stdout);assert.equal(JSON.parse(completed.stdout).output.status,"complete");
  assert.deepEqual(readFileSync(join(first,"grading.json")),gradeBytes);assert.deepEqual(readFileSync(join(first,"grading-response.json")),responseBytes);assert.deepEqual(readFileSync(judgeLog),calls);assert.deepEqual(readFileSync(f.log),candidateLog);
 }finally{f.cleanup();}
});

// A structurally valid answer does not override failed transport or forbidden tool use.
test("automatic judge rejects failed completion fields and all supported tool requests",async()=>{
 const {executeGradingPackets}=await import("../dist/scripts/evaluation_grading.js");
 const invalid=[{exit_code:1},{status:"failed"},{exit_reason:"failed"},{error:"failure"},{success:false},...['toolRequest','tool_request','tool_call'].map(type=>({tool:type})),{errorEvent:true}];
 for(const fields of invalid){
  const f=retainedProtocolFixture("behavioral");try{
   const packet=prepareGradingRequest(f.options.output,join(f.options.output,"case-0/baseline/run-1"),["result.txt"],f.state.cases[0].expectations,true);
   const output=JSON.stringify([{criterion_index:0,verdict:"pass",evidence_quote:"original",rationale:"The displayed original output supports the criterion."}]);
   writeFileSync(f.host,'const fields='+JSON.stringify(fields)+';if(fields.tool)console.log(JSON.stringify({type:"message",message:{content:[{type:fields.tool}]}}));if(fields.errorEvent)console.log(JSON.stringify({type:"error"}));console.log(JSON.stringify({type:"complete",output:'+JSON.stringify(output)+',...fields}));');
   await assert.rejects(executeGradingPackets([packet],{command:process.execPath+" "+f.host,sourceHome:f.home,timeout:5}),/failure|tool|unavailable/i,JSON.stringify(fields));
   assert.equal(existsSync(join(packet.run_directory,"grading.json")),false);
  }finally{f.cleanup();}
 }
});

// A failed slot is not a retry licence and cannot block never-attempted siblings.
test("automatic grading continues untouched siblings and recovers bound retained responses",async()=>{
 const {executeGradingPackets}=await import("../dist/scripts/evaluation_grading.js");
 const f=retainedProtocolFixture("behavioral",2),log=join(f.root,"judge-log");try{
  const packets=f.state.runs.map((run:any)=>prepareGradingRequest(f.options.output,join(f.options.output,run.directory),["result.txt"],f.state.cases.find((c:any)=>c.id===run.case_id)!.expectations,true));
  writeFileSync(f.host,'import fs from "node:fs";const log='+JSON.stringify(log)+';const n=fs.existsSync(log)?fs.readFileSync(log,"utf8").trim().split("\\n").length:0;fs.appendFileSync(log,"attempt\\n");console.log(JSON.stringify(n===1?{type:"complete",success:false}:{type:"complete",output:JSON.stringify([{criterion_index:0,verdict:"pass",evidence_quote:"original",rationale:"The displayed original output supports the criterion."}])}));');
  const options={command:process.execPath+" "+f.host,sourceHome:f.home,timeout:5};
  await assert.rejects(executeGradingPackets(packets,options),/failure/);
  assert.equal(readFileSync(log,"utf8").trim().split("\n").length,4);
  assert.deepEqual(packets.map((p:any)=>existsSync(join(p.run_directory,"grading.json"))),[true,false,true,true]);
  // Simulate interrupted final grade publication, preserving the validated bound host record.
  rmSync(join(packets[0].run_directory,"grading.json"));rmSync(join(packets[0].run_directory,"grading-response.json"));
  const before=readFileSync(log);await assert.rejects(executeGradingPackets(packets,options),/already attempted/);
  assert.equal(existsSync(join(packets[0].run_directory,"grading.json")),true);assert.deepEqual(readFileSync(log),before);
  const receipt=JSON.parse(readFileSync(join(packets[0].run_directory,"grader-invocation.json"),"utf8"));
  receipt.request_sha256="0".repeat(64);writeFileSync(join(packets[0].run_directory,"grader-invocation.json"),JSON.stringify(receipt));
  await assert.rejects(executeGradingPackets([packets[0]],options),/binding drift/);assert.deepEqual(readFileSync(log),before);
 }finally{f.cleanup();}
});

// Adding coverage information must not rewrite an already bound decoded packet.
test("retained incomplete decoded grading packet keeps its original binding",()=>{
 const f=retainedProtocolFixture("behavioral");try{
  const dir=join(f.options.output,"case-0/baseline/run-1"),context=validateTaskEvidence(JSON.parse(readFileSync(join(dir,"outputs/task-evidence.json"),"utf8")));
  const bytes=Buffer.alloc(300*1024,65);context.files["outputs/large.txt"]={sha256:createHash("sha256").update(bytes).digest("hex"),bytes_base64:bytes.toString("base64")};
  mkdirSync(join(dir,"outputs/artifacts/outputs"));writeFileSync(join(dir,"outputs/artifacts/outputs/large.txt"),bytes);
  writeFileSync(join(dir,"outputs/task-evidence.json"),JSON.stringify(context));writeFileSync(join(dir,"outputs/result.txt"),renderTaskEvidence(context));
  const expectations=f.state.cases[0].expectations,output=[{label:"source-1",content:"original"}];
  const originalId=createHash("sha256").update(JSON.stringify({runDir:dir,output,expectations,protocol:"decoded-task-sources-v1"})).digest("hex");
  const packet=prepareGradingRequest(f.options.output,dir,["result.txt"],expectations,true);
  assert.equal(packet.request_id,originalId);
  const oldRequest={...packet.request};delete (oldRequest as any).visibility;
  writeFileSync(packet.request_path,JSON.stringify(oldRequest));
  const recovered=prepareGradingRequest(f.options.output,dir,["result.txt"],expectations,true);
  assert.deepEqual(recovered.request,oldRequest);assert.deepEqual((recovered as any).visibility,{complete:false,omitted_sources:1});
 }finally{f.cleanup();}
});
