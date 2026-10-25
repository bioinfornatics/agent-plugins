import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {isolatedHostEnvironment} from "../dist/scripts/isolated_host.js";
import {GooseRunner} from "../dist/scripts/runners/goose.js";
const event=(name:string)=>({type:"message",message:{content:[{type:"toolRequest",toolCall:{value:{name:"skills__load_skill",arguments:{name}}}}]}});
test("qualified target references cannot match sibling resource names",()=>{const r=new GooseRunner();for(const name of ["plugin:other/references/:target/a.md","plugin:target-other","plugin:other","plugin:target/../other","plugin:target//a","a:b:target"]){assert.equal(r.eventLoadedSkill(event(name),"target"),null,name);}for(const name of ["target","target/references/a.md","plugin:target","plugin:target/references/a.md"]){assert.equal(r.eventLoadedSkill(event(name),"target"),true,name);}});
test("isolated modern provider config keeps selected model without importing ambient profile",()=>{const root=mkdtempSync(join(tmpdir(),"selector-"));const keys=["GOOSE_PATH_ROOT","GOOSE_PROVIDER","GOOSE_MODEL"] as const;const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));try{const source=join(root,"ambient");mkdirSync(join(source,"config"),{recursive:true});writeFileSync(join(source,"config","config.yaml"),"active_provider: anthropic\nproviders:\n  anthropic:\n    enabled: true\n    model: configured-model\nextensions:\n  private: secret\n".replaceAll("\\n","\n"));process.env.GOOSE_PATH_ROOT=source;delete process.env.GOOSE_PROVIDER;delete process.env.GOOSE_MODEL;const env=isolatedHostEnvironment(join(root,"candidate"));assert.equal(env.GOOSE_PROVIDER,"anthropic");assert.equal(env.GOOSE_MODEL,"configured-model");assert.notEqual(env.GOOSE_PATH_ROOT,source);process.env.GOOSE_PROVIDER="other";const override=isolatedHostEnvironment(join(root,"override"));assert.equal(override.GOOSE_PROVIDER,"other");assert.notEqual(override.GOOSE_MODEL,"configured-model");}finally{for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}rmSync(root,{recursive:true,force:true});}});

test('host excludes ambient execution/discovery and keeps documented transport',()=>{
 const root=mkdtempSync(join(tmpdir(),'transport-boundary-'));
 const values:Record<string,string>={NODE_OPTIONS:'--import /ambient/injection.mjs',NODE_PATH:'/ambient/modules',GOOSE_RECIPE_PATH:'/ambient/recipes',GOOSE_SEARCH_PATHS:'/ambient/bin',GOOSE_PROVIDER:'openai',GOOSE_MODEL:'test-model',OPENAI_API_KEY:'fake-key',AZURE_OPENAI_AD_TOKEN:'fake-ad-token',AWS_SESSION_TOKEN:'fake-session',HTTPS_PROXY:'http://127.0.0.1:2',DBUS_SESSION_BUS_ADDRESS:'unix:path=/ambient/keyring',AMBIENT_PRIVATE_CONTEXT:'private-context'};
 const old=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));
 try{Object.assign(process.env,values);const env=isolatedHostEnvironment(root);
  for(const key of ['NODE_OPTIONS','NODE_PATH','GOOSE_RECIPE_PATH','GOOSE_SEARCH_PATHS','DBUS_SESSION_BUS_ADDRESS','AMBIENT_PRIVATE_CONTEXT'])assert.equal(env[key],undefined,key);
  for(const key of ['OPENAI_API_KEY','AZURE_OPENAI_AD_TOKEN','AWS_SESSION_TOKEN','HTTPS_PROXY'])assert.equal(env[key],values[key],key);
  assert.equal(env.GOOSE_DISABLE_KEYRING,'1');assert.ok(env.APPDATA?.startsWith(root));assert.ok(env.TMPDIR?.startsWith(root));
 }finally{for(const key of Object.keys(values)){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}rmSync(root,{recursive:true,force:true});}
});

test('all tool requests in an event are scanned for eventual activation',()=>{
 const r=new GooseRunner(),sibling=event('plugin:other'),target=event('plugin:target/references/a.md');
 sibling.message.content.push(...target.message.content);assert.equal(r.eventLoadedSkill(sibling,'target'),true);
 assert.equal(r.eventLoadedSkill(event('plugin:target-other'),'target'),null);
});
test('profile-only provider transport fails explicitly',async()=>{
 const {assertIsolatedTransport}=await import('../dist/scripts/isolated_host.js');
 for(const provider of ['azure-openai','aws-bedrock','claude-code','custom_corp'])assert.throws(()=>assertIsolatedTransport({GOOSE_PROVIDER:provider}),/Unsupported isolated/);
 assert.doesNotThrow(()=>assertIsolatedTransport({GOOSE_PROVIDER:'azure-openai',AZURE_OPENAI_AD_TOKEN:'fake-token'}));assert.doesNotThrow(()=>assertIsolatedTransport({GOOSE_PROVIDER:'openai',GOOSE_PROVIDER__API_KEY:'fake-key'}));assert.throws(()=>assertIsolatedTransport({GOOSE_PROVIDER:'openai'}),/keyring.*not imported/);
});

// Mock hosts do not use the operator's ambient provider/keyring selection.
const priorProvider=process.env.GOOSE_PROVIDER,priorModel=process.env.GOOSE_MODEL;
test.before(()=>{process.env.GOOSE_PROVIDER="ollama";process.env.GOOSE_MODEL="no-provider-fixture";});
test.after(()=>{priorProvider===undefined?delete process.env.GOOSE_PROVIDER:process.env.GOOSE_PROVIDER=priorProvider;priorModel===undefined?delete process.env.GOOSE_MODEL:process.env.GOOSE_MODEL=priorModel;});
