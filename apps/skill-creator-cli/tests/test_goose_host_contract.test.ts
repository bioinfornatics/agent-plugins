import test from 'node:test';
import assert from 'node:assert/strict';
import {accessSync, constants, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {join, isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {runIsolatedEvaluation} from '../dist/scripts/evaluation_isolated.js';
import {captureEvaluationConfig, stageEvaluationConfig} from '../dist/scripts/evaluation_config.js';
// Verified local sources: goose/src/config/paths.rs uses root/config;
// goose-providers/src/openai.rs + goose/src/providers/openai_def.rs support
// OPENAI_BASE_URL and OPENAI_CUSTOM_HEADERS. No Secret Service proof: no verified
// disposable canary service available. Never use live HOME, bus, or keyring.
const binary=process.env.GOOSE_TEST_BINARY ?? '/home/jmercier/Codes/third-parties/goose/target/release/goose';
function unavailable():string|false {
 if(!isAbsolute(binary)) return 'GOOSE_TEST_BINARY requires exact absolute path';
 try{accessSync(binary,constants.X_OK);return false;}catch{return 'Real Goose unavailable at '+binary+'; CI may set GOOSE_TEST_BINARY';}
}
const prerequisite=unavailable();
if(process.env.CI_REQUIRE_GOOSE_HOST==='1'&&prerequisite)throw new Error(prerequisite);
const options={timeout:30000,concurrency:false,skip:prerequisite};
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'goose-host-contract-')),home=join(root,'original-home'),fixtures=join(root,'fixtures');
 mkdirSync(home);mkdirSync(fixtures);
 const put=(path:string,text:string)=>{mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,text,{mode:0o600});};
 const plugin=join(home,'.agents/plugins/contract-canary');
 put(join(plugin,'plugin.json'),JSON.stringify({name:'contract-canary',version:'1.0.0',description:'Local canary'}));
 put(join(plugin,'skills/canary/SKILL.md'),'---\nname: canary\ndescription: Synthetic discovery canary.\n---\nNo tools, hooks, external resources or side effects.\n');
 const saved={...process.env}; // Saved solely for restoration, never inspected/logged.
 for(const key of Object.keys(process.env)) if(!['PATH','SystemRoot','WINDIR'].includes(key)) delete process.env[key];
 process.env.GOOSE_DISABLE_KEYRING='1';process.env.NO_PROXY='127.0.0.1,localhost';
 const base={sourceHome:home,fixtures,command:binary,prompt:'Return plain text without tools.',timeoutSeconds:4};
 return{root,home,put,base,cleanup:()=>{for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,saved);rmSync(root,{recursive:true,force:true});}};
}
function inventory(r:any){
 assert.equal(r.runs.length,2);
 for(const run of r.runs){assert.equal(run.preflight.exit_code,0);assert.equal(run.preflight.exit_reason,'completed');}
 const builtins=(run:any)=>run.inventory.filter((x:any)=>x.builtin);
 assert(builtins(r.runs[0]).length>0);assert.deepEqual(builtins(r.runs[0]),builtins(r.runs[1]));
 assert.deepEqual(r.runs[0].inventory.filter((x:any)=>!x.builtin),[]);
 assert.deepEqual(r.runs[1].inventory.filter((x:any)=>!x.builtin).map((x:any)=>x.name),['contract-canary:canary']);
}
test('real Goose root/config, paired discovery and loopback OpenAI request',options,async()=>{
 const f=fixture(),token='synthetic-host-contract-api-canary-20261027',model='host-contract-model',answer='LOCAL_HOST_CONTRACT_OK';
 const requests:any[]=[];
 const server=createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;
  let body:any={};try{body=raw?JSON.parse(raw):{};}catch{res.writeHead(400);res.end();return;}
  requests.push({method:req.method,path:req.url,auth:req.headers.authorization,header:req.headers['x-host-contract'],body});
  if(req.method!=='POST'||req.url!=='/v1/chat/completions'){
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({object:'list',data:[{id:model,object:'model',owned_by:'local'}]}));return;
  }
  const completion={id:'chatcmpl-local',object:'chat.completion',created:1,model,choices:[{index:0,message:{role:'assistant',content:answer},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}};
  if(body.stream){
   res.setHeader('Content-Type','text/event-stream');
   const chunk={id:completion.id,object:'chat.completion.chunk',created:1,model,choices:[{index:0,delta:{role:'assistant',content:answer},finish_reason:null}]};
   res.end('data: '+JSON.stringify(chunk)+'\n\ndata: '+JSON.stringify({...chunk,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:completion.usage})+'\n\ndata: [DONE]\n\n');
  }else{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(completion));}
 });
 try{
  server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert(address&&typeof address!=='string');
  const endpoint='http://127.0.0.1:'+address.port+'/v1',config=join(f.home,'.config/goose/config.yaml');
  const text=['GOOSE_PROVIDER: openai','GOOSE_MODEL: '+model,'OPENAI_BASE_URL: '+endpoint,'OPENAI_CUSTOM_HEADERS: '+'X-Host-Contract=copied-root-config',''].join('\n');
  f.put(config,text);f.put(join(f.home,'.config/goose/secrets.yaml'),'OPENAI_API_KEY: '+token+'\nOPENAI_CUSTOM_HEADERS: '+'X-Host-Contract=copied-root-config'+'\n');
  const staged=join(f.root,'staged');stageEvaluationConfig(captureEvaluationConfig(f.home),staged,[]);
  assert(readFileSync(join(staged,'config/config.yaml'),'utf8').includes(endpoint));
  const r:any=await runIsolatedEvaluation({...f.base,withPlugins:['contract-canary'],output:join(f.root,'success'),provider:'openai'});
  assert.equal(r.status,'succeeded',JSON.stringify(r));inventory(r);
  for(const run of r.runs){assert.equal(run.exit_code,0);assert.equal(run.status,'succeeded');assert.equal(run.output,answer);}
  const hasPrompt=(m:any)=>typeof m.content==='string' ? m.content.includes(f.base.prompt) : Array.isArray(m.content) && m.content.some((c:any)=>typeof c.text==='string' && c.text.includes(f.base.prompt));
  const chats=requests.filter(x=>x.method==='POST' && x.body.messages?.some(hasPrompt));
  assert(chats.length>=2 && chats.length<=8,'Bounded host requests: '+JSON.stringify(chats.map(r=>({model:r.body.model,stream:r.body.stream,roles:r.body.messages.map((m:any)=>m.role)}))));
  for(const req of requests){assert.equal(req.auth,'Bearer '+token);assert(req.path.startsWith('/v1/'));}
  for(const req of chats)assert.equal(req.header,'copied-root-config');
  for(const req of chats){assert.equal(req.path,'/v1/chat/completions');assert.equal(req.body.model,model);assert(req.body.messages.some(hasPrompt));}
  assert(!JSON.stringify(r).includes(token));assert.equal(readFileSync(config,'utf8'),text);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));f.cleanup();}
});
test('real discovery without model/provider and safe missing-provider failure',options,async()=>{
 const f=fixture();try{
  f.put(join(f.home,'.config/goose/config.yaml'),'{}\n');
  const r:any=await runIsolatedEvaluation({...f.base,withPlugins:['contract-canary'],output:join(f.root,'missing-provider')});
  inventory(r);assert.equal(r.status,'failure');assert.equal(r.exit_code,1);
  for(const run of r.runs){assert.notEqual(run.exit_code,0);assert.equal(run.exit_reason,'host-exit');assert.equal(run.diagnostic.category,'configuration');assert.equal(run.diagnostic.code,'provider-not-configured');assert(['stdout','stderr'].includes(run.diagnostic.source));assert.equal(run.output,null);}
  assert.equal(readFileSync(join(f.home,'.config/goose/config.yaml'),'utf8'),'{}\n');
 }finally{f.cleanup();}
});
