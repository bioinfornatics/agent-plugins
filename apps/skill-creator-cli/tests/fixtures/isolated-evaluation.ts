import test from "node:test";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,existsSync,statSync,readdirSync,cpSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync} from "node:child_process";
import {captureEvaluationConfig,stageEvaluationConfig} from "../../dist/scripts/evaluation_config.js";
import yaml from "js-yaml";
import {runIsolatedEvaluation} from "../../dist/scripts/evaluation_isolated.js";
import {executableIdentity} from "../../dist/scripts/evaluation_replay.js";
import {validateTaskEvidence,renderTaskEvidence} from "../../dist/scripts/task_evidence.js";
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

/** Synthetic native host: the contained script is an intentionally unbound external
 * dependency, like Goose's runtime IO. Use fixture() for Node-loader claims.
 * The executable is private to this fixture; no cache or product provenance bypass.
 */
export function nativeFixture(){
 const f=fixture(),source=join(f.root,"forward.c"),host=join(f.root,"forward-host");
 const newline=String.fromCharCode(10);
 writeFileSync(source,'#include <unistd.h>'+newline+'#include <stdlib.h>'+newline+'int main(int argc,char **argv){char **args=calloc(argc+2,sizeof(char*));if(!args)return 9;args[0]='+JSON.stringify(process.execPath)+';args[1]='+JSON.stringify(f.host)+';for(int i=1;i<argc;i++)args[i+1]=argv[i];execv(args[0],args);return 9;}');
 const compiled=spawnSync("cc",[source,"-o",host],{encoding:"utf8",env:{...process.env,CCACHE_DISABLE:"1"}});
 if(compiled.status!==0){f.cleanup();throw Error("native host fixture compilation failed: "+compiled.stderr);}
 f.options.command=host;
 return f;
}

export function fixture(){
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

export function protocolCall(f:ReturnType<typeof fixture>,args:string[]){return spawnSync(process.execPath,[join(import.meta.dirname,"../../dist/scripts/cli.js"),"run-evaluation",...args,"--format","json"],{encoding:"utf8",timeout:15000});}

export function retainedProtocolFixture(mode:"activation"|"behavioral",caseCount=1){
 const f=fixture(),digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
 const output="original",artifact=Buffer.from("original"),artifactHash=createHash("sha256").update(artifact).digest("hex");
 const state={schema_version:"isolated-evaluation-v1",mode,runs_per_query:1,dry_run:false,model:null,provider:null,selected_targets:["one"],requested_skills:["one"],requested_plugins:[],requested_plugin_paths:[],
  cases:Array.from({length:caseCount},(_,id)=>({id,prompt:"Same task",expectations:mode==="behavioral"?["Outputs input"]:[],expectedSkills:[]})),
  runs:[] as any[],campaigns:[] as any[]};
 for(const c of state.cases){
  state.campaigns.push({case_id:c.id,report:"case-"+c.id+"/report.json",status:"succeeded",manifests:[],fixtures:[],failure:null,diagnostic:null,recovery:null});
  for(const arm of ["baseline","with_targets"]){
   const directory="case-"+c.id+"/"+arm+"/run-1",outputs=join(f.options.output,directory,"outputs");
   // Unchanged artifact plus final response is a valid task-artifacts-v1 context.
   const context=validateTaskEvidence({protocol:"task-artifacts-v1",files:{"input.txt":{sha256:artifactHash,bytes_base64:artifact.toString("base64")}},before:{"input.txt":artifactHash},stdout:output,exit_code:0});
   assert.equal(renderTaskEvidence(context),output);
   const evidence=JSON.stringify(context)+"\n";
   f.put(join(outputs,"result.txt"),output);f.put(join(outputs,"task-evidence.json"),evidence);f.put(join(outputs,"artifacts/input.txt"),artifact.toString());
   state.runs.push({case_id:c.id,arm,repeat:1,directory,status:"succeeded",output,output_sha256:digest(output),task_evidence_sha256:digest(evidence),activation:{requested_skills:[]},duration_seconds:0,tokens:null});
  }
 }
 const saveState=()=>f.put(join(f.options.output,"run.json"),JSON.stringify({state,sha256:digest(state)}));
 saveState();f.put(f.log,"retained fixture: no host execution\n");
 return {...f,state,saveState};
}

export function assertNoRetainedSecret(root:string,secret:string){
 const digest=createHash('sha256').update(secret).digest('hex');
 function walk(p:string){if(!existsSync(p))return;for(const n of readdirSync(p)){const f=join(p,n);assert(!n.includes(secret));if(statSync(f).isDirectory())walk(f);else{const b=readFileSync(f);assert(!b.includes(Buffer.from(secret)),f+' raw secret');assert(!b.includes(Buffer.from(digest)),f+' secret digest');}}}walk(root);
}

export function copyRuntime(f:ReturnType<typeof fixture>,source=false){const app=join(f.root,'app');mkdirSync(app);const original=join(import.meta.dirname,'../..');cpSync(join(original,'dist'),join(app,'dist'),{recursive:true});cpSync(join(original,'package.json'),join(app,'package.json'));for(const name of ['js-yaml','argparse','adm-zip'])cpSync(join(original,'node_modules',name),join(app,'node_modules',name),{recursive:true});if(source)cpSync(join(original,'scripts'),join(app,'scripts'),{recursive:true});return app;}

export async function copiedEvaluation(app:string,options:unknown){const code=`import {runIsolatedEvaluation} from ${JSON.stringify('file://'+join(app,'dist/scripts/evaluation_isolated.js'))};console.log(JSON.stringify(await runIsolatedEvaluation(${JSON.stringify(options)})));`;const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:15000});assert.equal(child.status,0,child.stderr);return JSON.parse(child.stdout);}

const fidelityExpected={level:'invocation+frozen-inputs',unbound:['filesystem','network','auth','native libraries'],guarantees_identical_result:false,benchmark_acceptance:false};

export function assertFidelity(value:any){assert.deepEqual(value,fidelityExpected);}

export function replayCli(output:string, options:Record<string,unknown>={}) {
 const metadata=JSON.parse(readFileSync(join(output,"report.json"),"utf8")).replay;
 const env={...process.env};delete env.NODE_OPTIONS;delete env.NODE_PATH;
 return spawnSync(process.execPath,[join(import.meta.dirname,"../../dist/scripts/cli.js"),"replay","--recipe",join(output,"replay-recipe.json"),"--recipe-sha256",metadata.recipe_sha256 ?? "missing","--format","json"],{encoding:"utf8",timeout:15000,env,...options});
}
