import { test } from "node:test";
import assert from "node:assert/strict";
import { GooseRunner } from "../dist/scripts/runners/goose.js";
import {CommandGraderAdapter} from "../dist/scripts/evaluator_grading.js";
const fake=new URL("fixtures/adversarial-runner.mjs",import.meta.url).pathname;
const plan={prompt:"task",assertions:[],cwd:process.cwd(),model:null,tools:[],capabilities:{filesystem:true,agent_runner:true,browser:false,network:false,tools:[]},timeoutSeconds:.15};
for(const [mode,code] of [["partial","incomplete"],["error-complete","host-exit"],["failed-terminal","incomplete"],["clean-timeout","timeout"],["ignore-term","timeout"],["descendant","timeout"]]) {
 test("execution cannot complete: "+mode,{timeout:5000},async()=>{
  const start=Date.now();
  await assert.rejects(new GooseRunner(process.execPath+" "+fake+" "+mode).executePaired(plan),(e:any)=>e.code===code&&e.evidence.exitReason!=="completed");
  assert.ok(Date.now()-start<3000,"termination must be bounded");
 });
}
test("grader rejects stream error, failed terminal and terminal-less semantic JSON",async()=>{const input:any={prompt:"task",output:"valid result",assertion:{id:"a",version:1,criterion:"result"},variantAlias:"variant-a",identity:{id:"g",model:"m"}};for(const mode of ["partial","failed-terminal","error-complete"]){const adapter=new CommandGraderAdapter([process.execPath,new URL("fixtures/adversarial-grader.mjs",import.meta.url).pathname,mode],2);await assert.rejects(adapter.grade(input),/grader.*completion|grader.*error/i,mode);}});
test("grader timeout kills a SIGTERM-resistant process within a bounded interval",{timeout:5000},async()=>{const adapter=new CommandGraderAdapter([process.execPath,new URL("fixtures/adversarial-grader.mjs",import.meta.url).pathname,"ignore-term"],.15),start=Date.now();await assert.rejects(adapter.grade({prompt:"task",output:"valid result",assertion:{id:"a",version:1,classification:"semantic",criterion:"result"},variantAlias:"variant-a",identity:{id:"g",model:"m"},assertionSha256:"a",variantSha256:"b",outputSha256:"c"}),/timeout/);assert.ok(Date.now()-start<3000);});
test("valid terminal remains successful",async()=>{
 const result=await new GooseRunner(process.execPath+" "+fake+" valid").executePaired({...plan,timeoutSeconds:2});assert.equal(result.output,"valid result");assert.equal(result.exitReason,"completed");
});

test('unsupported isolated transport fails before launching task host',async()=>{
 const provider=process.env.GOOSE_PROVIDER;process.env.GOOSE_PROVIDER='custom_unverified_transport';
 try{await assert.rejects(new GooseRunner(process.execPath+' '+fake+' valid').executePaired({...plan,timeoutSeconds:2}),(e:any)=>e.code==='capability-mismatch'&&/Unsupported isolated/.test(e.message));}finally{provider===undefined?delete process.env.GOOSE_PROVIDER:process.env.GOOSE_PROVIDER=provider;}
});

// Mock hosts do not use the operator's ambient provider/keyring selection.
const priorProvider=process.env.GOOSE_PROVIDER,priorModel=process.env.GOOSE_MODEL;
test.before(()=>{process.env.GOOSE_PROVIDER="ollama";process.env.GOOSE_MODEL="no-provider-fixture";});
test.after(()=>{priorProvider===undefined?delete process.env.GOOSE_PROVIDER:process.env.GOOSE_PROVIDER=priorProvider;priorModel===undefined?delete process.env.GOOSE_MODEL:process.env.GOOSE_MODEL=priorModel;});

import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('candidate and grader retain UTF-8 at every multibyte boundary in message and terminal records',{timeout:30000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'split-utf8-')),host=join(root,'host.mjs');
 try{
  writeFileSync(host,["import {readFileSync} from 'node:fs';if(process.argv.includes('--version')){console.log('fake');process.exit(0);}readFileSync(0,'utf8');", "const [transport,word,offset,grading]=process.argv.slice(2);const task=JSON.stringify({output:word,status:'REJECTED'}),judgment={verdict:'pass',evidence_quote:word,rationale:word+' evidence'},response=grading==='yes'?JSON.stringify(judgment):grading==='batch'?JSON.stringify({judgments:[{id:'a',version:1,...judgment}]}):task;const stream=transport==='terminal'?JSON.stringify({type:'complete',output:response})+String.fromCharCode(10):JSON.stringify({type:'message',message:{role:'assistant',content:[{type:'text',text:response}]}})+String.fromCharCode(10)+JSON.stringify({type:'complete'})+String.fromCharCode(10);const bytes=Buffer.from(stream),index=bytes.indexOf(Buffer.from(word))+Number(offset);process.stdout.write(bytes.subarray(0,index));setTimeout(()=>process.stdout.write(bytes.subarray(index)),40);"].join(''));
  for(const transport of ['message','terminal'])for(const word of ['é','€','😀'])for(let offset=1;offset<Buffer.byteLength(word);offset++){
   const args=[host,transport,word,String(offset)],expected=JSON.stringify({output:word,status:'REJECTED'});
   const result=await new GooseRunner([process.execPath,...args].join(' ')).executePaired({...plan,cwd:root,timeoutSeconds:3});assert.equal(result.output,expected,transport+' '+word+' '+offset);assert.equal(result.telemetry.stream_parse.error_count,0);
   const response=await new CommandGraderAdapter([process.execPath,...args,'yes'],3).grade({prompt:'task',output:word,assertion:{id:'a',version:1,classification:'semantic',criterion:'text'},variantAlias:'a',identity:{id:'g',model:'fake'},assertionSha256:'a',variantSha256:'b',outputSha256:'c'});assert.deepEqual(JSON.parse(response.raw),{verdict:'pass',evidence_quote:word,rationale:word+' evidence'});
   const batch=await new CommandGraderAdapter([process.execPath,...args,'batch'],3).gradeBatch({prompt:'task',output:word,assertions:[{id:'a',version:1,classification:'semantic',criterion:'text'}],variantAlias:'a',identity:{id:'g',model:'fake'},variantSha256:'b',outputSha256:'c'});assert.deepEqual(JSON.parse(batch.raw),{judgments:[{id:'a',version:1,verdict:'pass',evidence_quote:word,rationale:word+' evidence'}]});
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('candidate and grader reject malformed and truncated UTF-8 explicitly',{timeout:10000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'invalid-utf8-')),host=join(root,'host.mjs');
 try{for(const mode of ['malformed','truncated']){
  writeFileSync(host,"import {readFileSync} from 'node:fs';if(process.argv.includes('--version')){console.log('fake');process.exit(0);}readFileSync(0,'utf8');process.stdout.write(Buffer.from(["+(mode==='malformed'?'255':'240,159')+"]));");
  await assert.rejects(new GooseRunner(process.execPath+' '+host).executePaired({...plan,cwd:root,timeoutSeconds:2}),(error:any)=>error.code==='invalid-response'&&/UTF-8/.test(error.message));
  await assert.rejects(new CommandGraderAdapter([process.execPath,host],2).grade({prompt:'task',output:'text',assertion:{id:'a',version:1,classification:'semantic',criterion:'text'},variantAlias:'a',identity:{id:'g',model:'fake'},assertionSha256:'a',variantSha256:'b',outputSha256:'c'}),/UTF-8/);
 }}finally{rmSync(root,{recursive:true,force:true});}
});

// Native v1.55.0 messages are emitted deltas, not cumulative snapshots.
const finalMessage=(id:string|null,text:string,extra:Record<string,unknown>={})=>({type:'message',message:{id,role:'assistant',created:1,metadata:{userVisible:true,agentVisible:true},content:[{type:'text',text}],...extra}});
const finalTool=(id='preliminary')=>finalMessage(id,'alpha',{content:[{type:'text',text:'alpha'},{type:'toolRequest',id:'call',toolCall:{status:'success',value:{name:'developer__shell',arguments:{command:'printf done'}}}}]});
const finalToolResult={type:'message',message:{id:'tool-result',role:'user',content:[{type:'toolResponse',id:'call',toolResult:{status:'success',value:{content:[{type:'text',text:'alpha'}]}}}]}};
test('candidate and both graders reconstruct only final native message deltas and reject ambiguous boundaries',{timeout:30000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'final-turn-')),host=join(root,'host.mjs');
 const expected=' \n{"output":"café 😀", "nested":{"status":"REJECTED"}}\n  ';
 const cases:[string,any[],string|null][]=[
  ['tool boundary',[finalTool(),finalToolResult,finalMessage('final',expected)],expected],
  ['new message ID',[finalMessage('comment','alpha'),finalMessage('final',expected)],expected],
  ['fragments and text blocks',[finalTool(),finalToolResult,finalMessage('final',' \n{"output":'),{type:'notification',message:'alpha'},finalMessage('final','',{content:[{type:'text',text:'"café 😀", '},{type:'thinking',text:'alpha'},{type:'text',text:'"nested":{"status":"REJECTED"}}\n  '}]})],expected],
  ['repeated identical and prefix chunks',[finalMessage('final','ha'),finalMessage('final','ha'),finalMessage('final','haha')],'hahahaha'],
  ['internal block',[finalMessage('final','',{content:[{type:'text',text:'alpha',annotations:{audience:['assistant']}},{type:'thinking',text:'alpha'},{type:'redactedThinking',text:'alpha'},{type:'text',text:expected}]})],expected],
  ['tool invalidates earlier same-ID text',[finalMessage('preliminary','alpha'),finalTool(),finalToolResult],null],
  ['tool request with no final',[finalTool()],null],
  ['unsupported boundary',[finalMessage('final','alpha'),{type:'unknown-turn',message:'boundary'}],null],
  ['malformed boundary',[finalMessage('final','alpha'),'MALFORMED'],null],
  ['explicit terminal cannot override post-completion messages',[{type:'complete',output:'alpha'},finalMessage('final',expected)],null],
  ['user after response',[finalMessage('final',expected),{type:'message',message:{role:'user',content:[{type:'text',text:'alpha'}]}}],null],
  ['hidden only',[finalMessage('final','alpha',{metadata:{userVisible:false,agentVisible:true}})],null],
  ['new hidden message cannot resurrect previous',[finalMessage('previous','alpha'),finalMessage('hidden','secret',{metadata:{userVisible:false}})],null],
  ['turn context',[finalMessage('final','alpha',{metadata:{turnContext:true}})],null],
  ['truncated output marker',[finalMessage('final','alpha',{metadata:{outputTokenLimitReached:true}})],null],
  ['missing identities',[finalMessage(null,'alpha'),finalMessage(null,expected)],null],
  ['ID reappears across messages',[finalMessage('a','alpha'),finalMessage('b','other'),finalMessage('a',expected)],null],
  ['ID reused after tool',[finalTool('a'),finalToolResult,finalMessage('a',expected)],null],
  ['no final text',[finalMessage('final','',{content:[{type:'thinking',text:'alpha'}]})],null],
  ['message after complete',[finalMessage('a','alpha'),{type:'complete'},finalMessage('final',expected)],null],
 ];
 try{for(const [label,events,output] of cases){
  writeFileSync(host,"import {readFileSync} from 'node:fs';if(process.argv.includes('--version')){console.log('fake');process.exit(0);}readFileSync(0,'utf8');for(const event of "+JSON.stringify([...events,{type:'complete',total_tokens:5}])+")console.log(event==='MALFORMED'?'{bad-json':JSON.stringify(event));");
  const candidate=()=>new GooseRunner(process.execPath+' '+host).executePaired({...plan,cwd:root,timeoutSeconds:3});
  const adapter=new CommandGraderAdapter([process.execPath,host],3),input:any={prompt:'task',output:'café 😀',assertion:{id:'a',version:1,classification:'semantic',criterion:'text'},assertions:[{id:'a',version:1,classification:'semantic',criterion:'text'}],variantAlias:'a',identity:{id:'g',model:'fake'},assertionSha256:'a',variantSha256:'b',outputSha256:'c'};
  if(output===null){await assert.rejects(candidate(),(e:any)=>e.code==='invalid-response'&&/final response unavailable/.test(e.message),label);await assert.rejects(adapter.grade(input),/final response unavailable/,label);await assert.rejects(adapter.gradeBatch(input),/final response unavailable/,label);}
  else{assert.equal((await candidate()).output,output,label);assert.equal((await adapter.grade(input)).raw,output,label);assert.equal((await adapter.gradeBatch(input)).raw,output,label);}
 }}finally{rmSync(root,{recursive:true,force:true});}
});
