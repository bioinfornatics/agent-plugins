import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {hostEnvironment} from "../dist/scripts/isolated_host.js";
import {GooseRunner} from "../dist/scripts/runners/goose.js";
import {CommandGraderAdapter} from "../dist/scripts/evaluator_grading.js";
const event=(name:string)=>({type:"message",message:{content:[{type:"toolRequest",toolCall:{value:{name:"skills__load_skill",arguments:{name}}}}]}});
test("qualified target references cannot match sibling resource names",()=>{const r=new GooseRunner();for(const name of ["plugin:other/references/:target/a.md","plugin:target-other","plugin:other","plugin:target/../other","plugin:target//a","a:b:target"]){assert.equal(r.eventLoadedSkill(event(name),"target"),null,name);}for(const name of ["target","target/references/a.md","plugin:target","plugin:target/references/a.md"]){assert.equal(r.eventLoadedSkill(event(name),"target"),true,name);}});
test("host preserves the operator environment without creating discovery state",()=>{
 const root=mkdtempSync(join(tmpdir(),"host-env-"));
 const values={HOME:"/operator/home",USERPROFILE:"/operator/home",APPDATA:"/operator/config",XDG_CONFIG_HOME:"/operator/xdg",GOOSE_PATH_ROOT:"/operator/goose",DBUS_SESSION_BUS_ADDRESS:"unix:path=/operator/keyring",GOOSE_DISABLE_KEYRING:"0",TMPDIR:"/operator/tmp",AMBIENT_PRIVATE_CONTEXT:"synthetic-sentinel",GOOSE_PROVIDER:"azure_foundry"};
 const old=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));
 try{Object.assign(process.env,values);const env=hostEnvironment();for(const [key,value] of Object.entries(values))assert.equal(env[key],value,key);assert.equal(existsSync(join(root,".host")),false);env.HOME="changed";assert.equal(process.env.HOME,values.HOME);}finally{for(const key of Object.keys(values))old[key]===undefined?delete process.env[key]:process.env[key]=old[key];rmSync(root,{recursive:true,force:true});}
});
test("host does not force keyring disable when unset",()=>{const old=process.env.GOOSE_DISABLE_KEYRING;try{delete process.env.GOOSE_DISABLE_KEYRING;assert.equal(hostEnvironment().GOOSE_DISABLE_KEYRING,undefined);}finally{old===undefined?delete process.env.GOOSE_DISABLE_KEYRING:process.env.GOOSE_DISABLE_KEYRING=old;}});
test("candidate and grader use normal authentication context and distinct cwd",async()=>{
 const root=mkdtempSync(join(tmpdir(),"normal-host-")),host=join(root,"host.mjs"),old=process.env.DBUS_SESSION_BUS_ADDRESS;
 const home=process.env.HOME;
 try{process.env.DBUS_SESSION_BUS_ADDRESS="unix:path=/synthetic/keyring";
 writeFileSync(host,
 'if(process.argv.includes("--version")){console.log("fake-host");}else{let text="";for await(const chunk of process.stdin)text+=chunk;const ok=process.env.HOME==='+JSON.stringify(home)+'&&process.env.DBUS_SESSION_BUS_ADDRESS==="unix:path=/synthetic/keyring"&&!process.argv.includes("--no-profile");if(!ok)process.exit(7);const output=text.includes("Published criterion")?JSON.stringify({verdict:"pass",evidence_quote:"output",rationale:"Observed output"}):"output";console.log(JSON.stringify({type:"message",message:{role:"assistant",content:[{type:"text",text:output}]}}));console.log(JSON.stringify({type:"complete"}));}');
 const runner=new GooseRunner(process.execPath+" "+host);
 const result=await runner.executePaired({prompt:"Return output",assertions:[],cwd:root,model:"fixture-model",tools:[],capabilities:{filesystem:true,agent_runner:true,browser:false,network:false,tools:[]},timeoutSeconds:5,configuration:"without_skill"});assert.equal(result.output,"output");
 const grader=new CommandGraderAdapter([process.execPath,host],5);const grade=await grader.grade({prompt:"p",output:"output",variantAlias:"anonymous",assertion:{id:"a",version:1,criterion:"Return output",classification:"semantic"},variantSha256:"synthetic-variant",outputSha256:"synthetic-output",assertionSha256:"synthetic-assertion",identity:{id:"review",model:"fixture-model"}});assert.equal(JSON.parse(grade.raw).verdict,"pass");
 }finally{old===undefined?delete process.env.DBUS_SESSION_BUS_ADDRESS:process.env.DBUS_SESSION_BUS_ADDRESS=old;rmSync(root,{recursive:true,force:true});}
});
test("all tool requests in an event are scanned for eventual activation",()=>{const r=new GooseRunner(),sibling=event("plugin:other"),target=event("plugin:target/references/a.md");sibling.message.content.push(...target.message.content);assert.equal(r.eventLoadedSkill(sibling,"target"),true);});
