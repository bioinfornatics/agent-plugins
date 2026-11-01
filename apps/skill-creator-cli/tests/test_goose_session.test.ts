import test from "node:test";
import fs from "node:fs";
import {syncBuiltinESMExports} from "node:module";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,existsSync,statSync,mkdirSync,mkdtempSync,rmSync,symlinkSync,linkSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {projectSessionLog,retainRawLogs,sessionFinalResponse} from "../dist/scripts/runners/goose_session.js";
import {runIsolatedEvaluation} from "../dist/scripts/evaluation_isolated.js";
import {fixture, nativeFixture} from "./fixtures/isolated-evaluation.ts";
// CLI preflight resolves the environment default rather than --goose-command.
// Bind both paths to this private native fixture; direct interpreted tests below
// still use fixture() and retain their existing loader/privacy coverage.
function protocolCall(f: ReturnType<typeof nativeFixture>, args: string[]) {
 return spawnSync(process.execPath,[join(import.meta.dirname,"../dist/scripts/cli.js"),"run-evaluation",...args,"--format","json"],
  {encoding:"utf8",timeout:15000,env:{...process.env,SKILL_CREATOR_GOOSE_COMMAND:f.options.command}});
}
// Distinct guarantee: hidden content and malformed tool envelopes stay excluded from hostile exports.
test("session projection excludes settings, hidden messages, thinking and malformed tool bodies",()=>{
 const s={name:"case-baseline-1",model_config:{api_key:"PRIVATE"},conversation:[
  {role:"user",metadata:{userVisible:true},content:[{type:"text",text:"query PRIVATE"}]},
  {role:"assistant",metadata:{userVisible:true},content:[{type:"text",text:"answer"},{type:"text",text:"INTERNAL",annotations:{audience:["assistant"]}},{type:"thinking",thinking:"HIDDEN"},{type:"toolRequest",toolCall:{name:"shell",arguments:{token:"PRIVATE"}}},{type:"toolResponse",toolResult:{content:[{type:"text",text:"PRIVATE"}]}}]},
  {role:"assistant",metadata:{userVisible:false},content:[{type:"text",text:"HIDDEN"}]}
 ]};
 const p=projectSessionLog(s,s.name,t=>t.replaceAll("PRIVATE","[REDACTED]"));
 assert.deepEqual(p.messages,[{role:"user",text:["query PRIVATE"]},{role:"assistant",text:["answer"]}]);
 assert.deepEqual(p.omitted,{other_content:1,thinking:1,toolRequest:1,toolResponse:1,hidden_message:1});
 assert.equal(p.redacted,false);
 for(const token of ["INTERNAL","HIDDEN","api_key","arguments"])assert(!JSON.stringify(p).includes(token));
 assert.throws(()=>projectSessionLog({...s,name:"wrong"},s.name,t=>t),/unsupported/);
 assert.throws(()=>projectSessionLog({name:s.name,conversation:[{role:"user",metadata:{userVisible:true},content:[{type:"text",text:"x".repeat(1024*1024+1)}]}]},s.name,t=>t),/too-large/);
});
// Distinct guarantee: native protocol receives names, exports use same private environment,
// export failure remains a separate evidence gap, and resume never starts another candidate.
test("CLI names each case arm and retains bounded exports before deleting homes",()=>{
 // Opaque external script host: transport/session retention, not Node-loader closure proof.
 const f=nativeFixture();try{
  writeFileSync(f.host,`import fs from 'node:fs';const a=process.argv.slice(2),home=process.env.HOME,cwd=process.cwd();fs.appendFileSync(${JSON.stringify(f.log)},JSON.stringify({a,home,cwd})+'\\n');if(a[0]==='skills'){console.log('Name | Description | Location');if(fs.existsSync(home+'/.agents/skills/one'))console.log('one | fixture | '+home+'/.agents/skills/one');console.log('goose-doc-guide | builtin | builtin://skills/goose-doc-guide');}else if(a[0]==='run'){let text='';for await(const c of process.stdin)text+=c;console.log(JSON.stringify({type:'message',message:{role:'assistant',content:[{type:'text',text:'answer'}]}}));console.log(JSON.stringify({type:'complete'}));}else{const name=a[a.indexOf('--name')+1];console.log(JSON.stringify({name,conversation:[{role:'assistant',metadata:{userVisible:true},content:[{type:'text',text:'answer'},{type:'thinking',thinking:'hidden'}]}],model_config:{token:'private'}}));}`);
  const r=protocolCall(f,["--with-skills","one","--source-home",f.home,"--goose-command",f.options.command,"--session-name","report-review","--prompt","same","--output",f.options.output]);
  assert.equal(r.status,0,r.stdout+r.stderr);
  const report=JSON.parse(r.stdout).output;
  assert.deepEqual(report.runs.map((r:any)=>r.session_name),["report-review-case-0-baseline-1","report-review-case-0-with_targets-1"]);
  for(const run of report.runs){assert.equal(run.session_log.status,"retained");const path=join(f.options.output,run.directory,"session-log.json");const p=JSON.parse(readFileSync(path,'utf8'));assert.deepEqual(p.messages,[{role:'assistant',text:['answer']}]);assert(!JSON.stringify(p).includes('hidden'));assert.equal(statSync(path).mode&0o777,0o600);}
  const calls=readFileSync(f.log,'utf8').trim().split('\n').map(l=>JSON.parse(l)),tasks=calls.filter(c=>c.a[0]==='run'),exports=calls.filter(c=>c.a[0]==='session');assert.equal(tasks.length,2);assert.equal(exports.length,2);
  for(let i=0;i<2;i++){assert(!tasks[i].a.includes('--no-session'));assert.equal(exports[i].home,tasks[i].home);assert.equal(exports[i].cwd,tasks[i].cwd);assert(!existsSync(tasks[i].home));}
  const before=readFileSync(f.log,'utf8');assert.equal(protocolCall(f,["--resume","--output",f.options.output]).status,0);assert.equal(readFileSync(f.log,'utf8'),before);
 }finally{f.cleanup();}
});
test("missing session export does not turn successful task into failure or retry",async()=>{
 const f=fixture();try{
  writeFileSync(f.host,`if(process.argv[2]==='skills'){console.log('Name | Description | Location');console.log('goose-doc-guide | builtin | builtin://skills/goose-doc-guide');}else if(process.argv[2]==='session'){process.stderr.write('PRIVATE');process.exit(7);}else{console.log(JSON.stringify({type:'message',message:{role:'assistant',content:[{type:'text',text:'ok'}]}}));console.log(JSON.stringify({type:'complete'}));}`);
  const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.status,'succeeded');
  for(const run of r.runs){assert.equal(run.session_log.status,'unavailable');assert.equal(run.session_log.observation.exit_code,7);assert(!existsSync(join(f.options.output,run.arm,'run-1','session-log.json')));}
  assert(!JSON.stringify(r).includes('PRIVATE'));
 }finally{f.cleanup();}
});

// Optional display names must not invalidate otherwise valid scenarios; unsafe explicit prefixes reject.
test("scenario display names normalize punctuation without changing case identity",()=>{
 const f=nativeFixture();try{
  const path=join(f.root,"cases.json");writeFileSync(path,JSON.stringify({evals:[{id:1,name:"_scenario",prompt:"same"},{id:2,name:"---_scenario",prompt:"same"},{id:3,name:"!!!",prompt:"same"}]}));
  const r=protocolCall(f,["--with-skills","one","--source-home",f.home,"--eval-set",path,"--goose-command",f.options.command,"--output",f.options.output,"--dry-run"]);assert.equal(r.status,0,r.stdout+r.stderr);
  const d=JSON.parse(r.stdout).output;assert.deepEqual(d.cases.map((c:any)=>c.sessionName),["scenario-case-1","scenario-case-2","evaluation-case-3"]);
  const bad=protocolCall(f,["--with-skills","one","--source-home",f.home,"--prompt","same","--goose-command",f.options.command,"--output",join(f.root,"bad"),"--session-name","_unsafe","--dry-run"]);assert.equal(bad.status,2);assert(!existsSync(join(f.root,"bad")));
 }finally{f.cleanup();}
});

// Independent byte/hash oracle; includes invalid UTF-8, empty, nested, rotated and > chunk size.
test("raw log snapshot preserves literal binary bytes and excludes auth/database files",()=>{
 const root=mkdtempSync(join(tmpdir(),"raw-logs-")),home=join(root,"home"),out=join(root,"out");
 try {
  mkdirSync(join(home,"state/logs/cli/day"),{recursive:true});mkdirSync(join(home,".local/state/goose/logs"),{recursive:true});mkdirSync(out,{mode:0o700});
  const canary=Buffer.concat([Buffer.from("Bearer EXACT_SYNTHETIC_CANARY\n"),Buffer.from([0,255,254,128]),Buffer.alloc(200000,137)]);
  const inputs:[[string,Buffer],[string,Buffer],[string,Buffer]]=[["state/logs/cli/day/session.log.1",canary],["state/logs/empty.log",Buffer.alloc(0)],[".local/state/goose/logs/request.log",Buffer.from("RAW_SETTINGS_IN_LOG_UNMASKED")]];
  for(const [path,bytes] of inputs)writeFileSync(join(home,path),bytes);
  for(const path of ["config/secrets.yaml","data/sessions/sessions.db",".local/share/keyrings/login.keyring"]){mkdirSync(join(home,path,".."),{recursive:true});writeFileSync(join(home,path),"AUTH_EXCLUDED");}
  const m=retainRawLogs(home,out,"case-baseline-1");assert.equal(m.status,"complete");assert.equal(m.files.length,3);
  for(const [path,bytes] of inputs){const f=m.files.find(f=>f.source_path===path);assert(f);assert.deepEqual(readFileSync(join(out,f.path)),bytes);assert.equal(f.sha256,createHash("sha256").update(bytes).digest("hex"));assert.equal(f.bytes,bytes.length);assert.equal(statSync(join(out,f.path)).mode&0o777,0o600);}
  assert.equal(statSync(join(out,"raw-logs")).mode&0o777,0o700);assert(m.path);const manifest=readFileSync(join(out,m.path));assert.equal(m.sha256,createHash("sha256").update(manifest).digest("hex"));assert(!manifest.includes(Buffer.from("AUTH_EXCLUDED")));
  const old=readFileSync(join(out,m.path));assert.equal(retainRawLogs(home,out,"case-baseline-1").status,"unavailable");assert.deepEqual(readFileSync(join(out,m.path)),old);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("raw log snapshot rejects links, special files and non-log stores without traversal",()=>{
 const root=mkdtempSync(join(tmpdir(),"raw-hostile-")),home=join(root,"home"),out=join(root,"out"),logs=join(home,"state/logs");
 try {
  mkdirSync(logs,{recursive:true});mkdirSync(out,{mode:0o700});writeFileSync(join(root,"protected"),"AUTH_EXCLUDED");
  writeFileSync(join(logs,"good.log"),"ok");symlinkSync(join(root,"protected"),join(logs,"linked.log"));symlinkSync(root,join(logs,"escape"));linkSync(join(root,"protected"),join(logs,"hard.log"));
  writeFileSync(join(logs,"secrets.yaml"),"AUTH_EXCLUDED");writeFileSync(join(logs,"sessions.db-wal"),"AUTH_EXCLUDED");
  if(process.platform!=="win32")assert.equal(spawnSync("mkfifo",[join(logs,"fifo")]).status,0);
  const m=retainRawLogs(home,out,"case-baseline-1");assert.equal(m.status,"partial");assert.deepEqual(m.files.map(f=>f.source_path),["state/logs/good.log"]);assert(m.issues.some(i=>i.reason==="unsafe-archive-entry"));assert(m.issues.some(i=>i.reason==="excluded-non-log-entry"));assert.equal(readFileSync(join(root,"protected"),"utf8"),"AUTH_EXCLUDED");
  const bad=join(root,"bad");mkdirSync(bad,{mode:0o700});symlinkSync(logs,join(home,".local"));const linked=retainRawLogs(home,bad,"case-baseline-1");assert.equal(linked.status,"partial");assert(linked.issues.some(i=>i.reason==="unsafe-archive-path"));
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("missing roots and archive destination failures are explicit evidence gaps",()=>{
 const root=mkdtempSync(join(tmpdir(),"raw-missing-")),home=join(root,"home"),out=join(root,"out");try{
  mkdirSync(home);mkdirSync(out,{mode:0o700});const missing=retainRawLogs(home,out,"case-baseline-1");assert.equal(missing.status,"unavailable");assert.equal(missing.origins.length,2);assert(missing.path);
  const target=join(root,"target");mkdirSync(target);writeFileSync(join(target,"sentinel"),"unchanged");const linked=join(root,"linked");symlinkSync(target,linked);assert.equal(retainRawLogs(home,linked,"case-baseline-1").status,"unavailable");assert.equal(readFileSync(join(target,"sentinel"),"utf8"),"unchanged");
 }finally{rmSync(root,{recursive:true,force:true});}
});
// The host writes export-generated logs: archiving must run after export, before HOME cleanup.
test("failed export still retains child and export logs exactly before cleanup with no rerun",async()=>{
 const f=fixture();try {
  writeFileSync(f.host,`import fs from 'node:fs';const a=process.argv.slice(2),home=process.env.HOME;fs.appendFileSync(${JSON.stringify(f.log)},JSON.stringify({a,home})+'\\n');if(a[0]==='skills'){console.log('Name | Description | Location');console.log('goose-doc-guide | builtin | builtin://skills/goose-doc-guide');}else{fs.mkdirSync(home+'/state/logs',{recursive:true});fs.writeFileSync(home+'/state/logs/'+a[0]+'.log',Buffer.from([65,255,0,66]));if(a[0]==='session')process.exit(7);console.log(JSON.stringify({type:'message',message:{role:'assistant',content:[{type:'text',text:'ok'}]}}));console.log(JSON.stringify({type:'complete'}));}`);
  const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});assert.equal(r.status,"succeeded");
  for(const run of r.runs){assert.equal(run.session_log.status,"unavailable");const raw=run.session_log.raw_files;assert.equal(raw.status,"complete");assert.deepEqual(raw.files.map((x:any)=>x.source_path),["state/logs/run.log","state/logs/session.log"]);for(const file of raw.files)assert.deepEqual(readFileSync(join(f.options.output,run.arm,"run-1",file.path)),Buffer.from([65,255,0,66]));}
  const calls=readFileSync(f.log,"utf8").trim().split("\n").map(l=>JSON.parse(l));assert.equal(calls.filter(c=>c.a[0]==="run").length,2);for(const c of calls)assert(!existsSync(c.home));
 }finally{f.cleanup();}
});

// Both failures occur after a real child writes bytes, without self-reported archive proof.
test("timeout and observed receipt failure preserve raw bytes and original failure without retries",async()=>{
 for(const mode of ["timeout","receipt"]){const f=fixture();try{
  writeFileSync(f.host,`import fs from 'node:fs';const a=process.argv.slice(2),home=process.env.HOME;fs.appendFileSync(${JSON.stringify(f.log)},JSON.stringify({a,home})+'\\n');if(a[0]==='skills'){console.log('Name | Description | Location');console.log('goose-doc-guide | builtin | builtin://skills/goose-doc-guide');}else if(a[0]==='session'){process.exit(7);}else{fs.mkdirSync(home+'/state/logs',{recursive:true});fs.writeFileSync(home+'/state/logs/child.log',Buffer.from([255,65,0]));${mode==='timeout'?"setInterval(()=>{},1000);":`fs.rmSync(${JSON.stringify(join(f.options.output,'baseline/run-1/task-invocation.json'))});fs.symlinkSync(${JSON.stringify(join(f.root,'protected'))},${JSON.stringify(join(f.options.output,'baseline/run-1/task-invocation.json'))});console.log(JSON.stringify({type:'complete'}));`}}`);
  writeFileSync(join(f.root,"protected"),"unchanged");const r:any=await runIsolatedEvaluation({...f.options,dryRun:false,timeoutSeconds:mode==="timeout"?.3:5});assert.equal(r.status,"failure");
  if(mode==="receipt")assert.equal(r.failure.code,"invocation-result-capture-failed");else assert.equal(r.runs[0].exit_reason,"timeout");
  const calls=readFileSync(f.log,"utf8").trim().split("\n").map(l=>JSON.parse(l));assert.equal(calls.filter(c=>c.a[0]==="run").length,mode==="receipt"?1:2);
  const captured=r.runs.filter((run:any)=>run.session_log.raw_files.files.length);assert.equal(captured.length,mode==="receipt"?1:2);
  for(const run of captured){const file=run.session_log.raw_files.files[0];assert.deepEqual(readFileSync(join(f.options.output,run.arm,"run-1",file.path)),Buffer.from([255,65,0]));}
  assert.equal(readFileSync(join(f.root,"protected"),"utf8"),"unchanged");for(const c of calls)assert(!existsSync(c.home));
 }finally{f.cleanup();}}
});

// Inject the OS error at actual write seam, not an echo of candidate archive status.
test("disk write failure preserves useful partial evidence without a truncated admitted file",()=>{
 const root=mkdtempSync(join(tmpdir(),"raw-disk-")),home=join(root,"home"),out=join(root,"out"),original=fs.writeSync;
 try {
  mkdirSync(join(home,"state/logs"),{recursive:true});mkdirSync(out,{mode:0o700});writeFileSync(join(home,"state/logs/a.log"),"first");writeFileSync(join(home,"state/logs/b.log"),Buffer.alloc(140000,255));
  let writes=0;fs.writeSync=((...args:any[])=>{writes++;if(writes===3){const e=new Error("simulated disk full") as NodeJS.ErrnoException;e.code="ENOSPC";throw e;}return (original as any)(...args);}) as typeof fs.writeSync;syncBuiltinESMExports();
  const m=retainRawLogs(home,out,"case-baseline-1");assert.equal(m.status,"partial");assert.deepEqual(m.files.map(f=>f.source_path),["state/logs/a.log"]);assert(m.issues.some(i=>i.reason==="ENOSPC"));assert.deepEqual(readFileSync(join(out,m.files[0].path)),Buffer.from("first"));assert(!existsSync(join(out,"raw-logs/path-root-state/b.log")));assert(m.path);
 }finally{fs.writeSync=original;syncBuiltinESMExports();rmSync(root,{recursive:true,force:true});}
});

// Input prevalidation does not need replay artifacts; real execution still captures them.
test('input-only validation freezes sources without optional replay runtime hashing',async()=>{
 const f=fixture();try{
  const report:any=await runIsolatedEvaluation({...f.options,withSkills:['one'],captureReplay:false});
  assert.equal(report.status,'prepared');assert.equal(report.replay.reason,'input-validation-only');
  assert.equal(existsSync(join(f.options.output,'replay-inputs')),false);assert.equal(existsSync(f.log),false);
  assert(report.manifests.length===1&&report.fixtures.files.length===1);
 }finally{f.cleanup();}
});

// Observable tool bodies are allowlisted; internal audiences and arbitrary export fields never cross.
test('v2 projection preserves ordered tool envelopes and excludes nested internal content',()=>{
 const s={name:'trace',settings:{secret:'SETTINGS_HIDDEN'},conversation:[{role:'assistant',metadata:{userVisible:true},content:[
  {type:'text',text:'Plan explicitly emitted'},
  {type:'toolRequest',id:'call-1',toolCall:{status:'success',value:{name:'shell',arguments:{command:'echo <literal>'},extra:'VALUE_HIDDEN'}},_meta:{summary:'META_HIDDEN'}},
  {type:'toolResponse',id:'call-1',toolResult:{status:'success',value:{content:[{type:'text',text:'visible result'},{type:'text',text:'NESTED_HIDDEN',annotations:{audience:['assistant']}},{type:'image',data:'IMAGE_HIDDEN'}],structuredContent:{private:'STRUCTURED_HIDDEN'}}}},
  {type:'toolResponse',id:'call-2',toolResult:{status:'error',error:'observable error'}},
  {type:'toolRequest',id:'call-3',toolCall:{status:'error',error:'request rejected'}},
  {type:'toolResponse',id:'call-empty',toolResult:{status:'success',value:{content:[]}}},
  {type:'toolResponse',id:'hidden',toolResult:{status:'error',error:'AUDIENCE_HIDDEN'},annotations:{audience:null}},
  {type:'thinking',thinking:'THINKING_HIDDEN'},{type:'redactedThinking',text:'REDACTED_HIDDEN'},
  {type:'text',text:'final'}]}]};
 const p=projectSessionLog(s,'trace');
 assert.equal(p.protocol,'goose-session-log-v2');assert.equal(p.completeness,'complete-visible-text-and-tools');
 assert.deepEqual(p.messages,[{role:'assistant',text:['Plan explicitly emitted']},
  {role:'assistant',kind:'toolRequest',tool_id:'call-1',status:'success',tool_name:'shell',text:['{"command":"echo <literal>"}']},
  {role:'assistant',kind:'toolResponse',tool_id:'call-1',status:'success',text:['visible result']},
  {role:'assistant',kind:'toolResponse',tool_id:'call-2',status:'error',text:['observable error']},
  {role:'assistant',kind:'toolRequest',tool_id:'call-3',status:'error',text:['request rejected']},
  {role:'assistant',kind:'toolResponse',tool_id:'call-empty',status:'success',text:[]},
  {role:'assistant',text:['final']}]);
 assert.doesNotMatch(JSON.stringify(p),/_HIDDEN/);assert.equal(p.omitted.toolResponse,1);assert.equal(p.omitted.thinking,1);assert.equal(p.omitted.redactedThinking,1);
});

// Independent expected values: original boundaries prevent pre-tool commentary promotion.
test('session final selector excludes hidden, pre-tool and non-final text with exact identity',()=>{
 const message=(role:string,content:any[],visible=true)=>({role,metadata:{userVisible:visible},content});
 const text=(text:string)=>({type:'text',text});
 const select=(conversation:any[])=>sessionFinalResponse({name:'expected',conversation},'expected');
 assert.deepEqual(select([message('user',[text('query')]),message('assistant',[text('final literal')])]),{status:'available',output:'final literal'});
 for(const conversation of [
  [message('assistant',[text('stale')]),message('user',[text('new query')])],
  [message('assistant',[text('before'),{type:'toolRequest'},text('after in same tool message')])],
  [message('assistant',[text('stale')]),message('user',[{type:'toolResponse'}])],
  [message('assistant',[{type:'thinking',thinking:'hidden'}])],
  [message('assistant',[{...text('internal'),annotations:{audience:['assistant']}}])],
  [message('assistant',[text('hidden')],false)]
 ])assert.equal(select(conversation).status,'unavailable');
 assert.deepEqual(select([message('assistant',[{type:'toolRequest'}]),message('user',[{type:'toolResponse'}]),message('assistant',[text('after tool')])]),{status:'available',output:'after tool'});
 for(const flag of ['turnContext','outputTokenLimitReached'])assert.equal(select([message('assistant',[text('stale')]),{...message('assistant',[text('partial')]),metadata:{userVisible:true,[flag]:true}}]).status,'unavailable');
 assert.throws(()=>sessionFinalResponse({name:'wrong',conversation:[]},'expected'),/unsupported/);
 assert.equal(select([message('assistant',[text('x'.repeat(256*1024+1))])]).status,'unavailable');
});

test('native export is primary, missing export falls back, empty export is ungraded and failed host stays failed',async()=>{
 for(const kind of ['primary','fallback','wrong-name','empty','exit','terminal-error']){
 const f=nativeFixture();try{
 writeFileSync(f.host,`import fs from 'node:fs';const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(f.log)},a[0]+'\\n');if(a[0]==='skills'){console.log('Name | Description | Location');console.log('goose-doc-guide | builtin | builtin://skills/goose-doc-guide');}else if(a[0]==='run'){fs.writeFileSync('input.txt','TASK_FROZEN');console.log(JSON.stringify({type:'message',message:{role:'assistant',content:[{type:'text',text:'STREAM_TEXT'}]}}));console.log(JSON.stringify({type:'complete',success:${kind==='terminal-error'?'false':'true'}}));${kind==='exit'?'process.exitCode=7;':''}}else{fs.writeFileSync('input.txt','EXPORT_MUTATION');${kind==='fallback'?'process.exit(7);':`console.log(JSON.stringify({name:${kind==='wrong-name'?"'wrong'":"a[a.indexOf('--name')+1]"},conversation:${kind==='empty'?'[]':"[{role:'assistant',metadata:{userVisible:true},content:[{type:'text',text:'EXPORT_TEXT'}]}]"}}));`}}`);
 const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});
 for(const run of r.runs){
  assert.equal(run.output,kind==='empty'?null:kind==='fallback'||kind==='wrong-name'?'STREAM_TEXT':'EXPORT_TEXT');
  assert.equal(run.status,kind==='exit'||kind==='terminal-error'?'failure':kind==='empty'?'unavailable':'succeeded');
  assert.equal(run.response_capture.source,kind==='fallback'||kind==='wrong-name'?'execution-stream':'session-export');
  const context=JSON.parse(readFileSync(join(f.options.output,run.arm,'run-1/outputs/task-evidence.json'),'utf8'));
  assert.equal(Buffer.from(context.files['input.txt'].bytes_base64,'base64').toString(),'TASK_FROZEN');
  assert.equal(context.stdout,run.output??'');assert.equal(typeof run.telemetry.failed,'object');assert.equal(run.telemetry.failed.value,kind==='exit'||kind==='terminal-error');
 }
 assert.equal(r.status,kind==='exit'||kind==='terminal-error'?'failure':kind==='empty'?'inconclusive':'succeeded');
 assert.equal(readFileSync(f.log,'utf8').split('run').length-1,2);assert.equal(readFileSync(f.log,'utf8').split('session').length-1,2);
 }finally{f.cleanup();}
 }
});

// A collector write failure cannot turn a real host failure into an inconclusive execution.
test('failed host status survives final response attachment failure',async()=>{
 const f=nativeFixture(),original=fs.writeFileSync;try{
 writeFileSync(f.host,`const a=process.argv.slice(2);if(a[0]==='skills'){console.log('Name | Description | Location');console.log('goose-doc-guide | builtin | builtin://skills/goose-doc-guide');}else if(a[0]==='run'){console.log(JSON.stringify({type:'complete'}));process.exitCode=7;}else console.log(JSON.stringify({name:a[a.indexOf('--name')+1],conversation:[{role:'assistant',metadata:{userVisible:true},content:[{type:'text',text:'retained on failure'}]}]}));`);
 const calls=new Map<string,number>();
 fs.writeFileSync=((path:any,...args:any[])=>{const p=String(path);if(p.endsWith('outputs/task-evidence.json')){const n=(calls.get(p)??0)+1;calls.set(p,n);if(n===2)throw Error('injected-attachment-failure');}return (original as any)(path,...args);}) as typeof fs.writeFileSync;syncBuiltinESMExports();
 const r:any=await runIsolatedEvaluation({...f.options,dryRun:false});
 assert.equal(r.status,'failure');for(const run of r.runs){assert.equal(run.status,'failure');assert.equal(run.exit_reason,'host-exit');assert.equal(run.output,'retained on failure');assert.equal(run.response_capture.evidence_status,'unavailable');assert.equal(run.session_log.raw_files.status,'unavailable');}
 }finally{fs.writeFileSync=original;syncBuiltinESMExports();f.cleanup();}
});

test('native CLI missing final capture leaves null criteria and model-free resume',()=>{
 const f=nativeFixture();try{
 writeFileSync(f.host,`const a=process.argv.slice(2);if(a[0]==='skills'){console.log('Name | Description | Location');console.log('goose-doc-guide | builtin | builtin://skills/goose-doc-guide');if(process.env.HOME)console.log('one | fixture | '+process.env.HOME+'/.agents/skills/one');}else if(a[0]==='run'){console.log(JSON.stringify({type:'complete'}));}else console.log(JSON.stringify({name:a[a.indexOf('--name')+1],conversation:[]}));`);
 const evals=join(f.root,'cases.json');writeFileSync(evals,JSON.stringify({evals:[{id:0,prompt:'same',expectations:['result delivered']}]}));
 // Baseline inventory must not include selected capabilities.
 const script=readFileSync(f.host,'utf8');writeFileSync(f.host,script.replace("if(process.env.HOME)","if((await import('node:fs')).existsSync(process.env.HOME+'/.agents/skills/one'))"));
 const result=protocolCall(f,['--with-skills','one','--source-home',f.home,'--goose-command',f.options.command,'--eval-set',evals,'--output',f.options.output]);
 assert.equal(result.status,0,result.stdout+result.stderr);const report=JSON.parse(result.stdout).output;
 assert.equal(report.status,'inconclusive');assert.equal(report.grading_requests.length,0);assert(report.rows.every((row:any)=>row.expectations[0].passed===null));assert(report.runs.every((run:any)=>run.status==='unavailable'&&run.output===null));
 const before=readFileSync(join(f.options.output,'run.json'),'utf8');assert.equal(protocolCall(f,['--resume','--output',f.options.output]).status,0);assert.equal(readFileSync(join(f.options.output,'run.json'),'utf8'),before);
 }finally{f.cleanup();}
});
