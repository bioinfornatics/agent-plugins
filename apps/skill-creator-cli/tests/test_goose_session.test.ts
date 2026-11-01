import test from "node:test";
import fs from "node:fs";
import {syncBuiltinESMExports} from "node:module";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,existsSync,statSync,mkdirSync,mkdtempSync,rmSync,symlinkSync,linkSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {projectSessionLog,retainRawLogs} from "../dist/scripts/runners/goose_session.js";
import {runIsolatedEvaluation} from "../dist/scripts/evaluation_isolated.js";
import {fixture, protocolCall} from "./fixtures/isolated-evaluation.ts";
// Distinct guarantee: only visible text and closed omission counts survive hostile exports.
test("session projection excludes settings, hidden messages, thinking and tool bodies",()=>{
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
 const f=fixture();try{
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
 const f=fixture();try{
  const path=join(f.root,"cases.json");writeFileSync(path,JSON.stringify({evals:[{id:1,name:"_scenario",prompt:"same"},{id:2,name:"---_scenario",prompt:"same"},{id:3,name:"!!!",prompt:"same"}]}));
  const r=protocolCall(f,["--with-skills","one","--source-home",f.home,"--eval-set",path,"--output",f.options.output,"--dry-run"]);assert.equal(r.status,0,r.stdout+r.stderr);
  const d=JSON.parse(r.stdout).output;assert.deepEqual(d.cases.map((c:any)=>c.sessionName),["scenario-case-1","scenario-case-2","evaluation-case-3"]);
  const bad=protocolCall(f,["--with-skills","one","--source-home",f.home,"--prompt","same","--output",join(f.root,"bad"),"--session-name","_unsafe","--dry-run"]);assert.equal(bad.status,2);assert(!existsSync(join(f.root,"bad")));
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
