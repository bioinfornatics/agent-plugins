#!/usr/bin/env node
/** Bounded data-only transport preserves executable intent without archive extraction. */
import { readFileSync, writeFileSync, readdirSync, lstatSync, mkdirSync, chmodSync, rmSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { verifyFrozenCandidate } from './frozen-candidate.mjs';
const maxBytes=64*1024*1024,maxRows=20000;
function safe(member){return typeof member==='string'&&member.length<4096&&!member.includes('\\')&&!path.isAbsolute(member)&&member.split('/').every(p=>p&&p!=='.'&&p!=='..')&&member.split('/').length<=64;}
export function packCandidate(root,output,{source,repository,runId,runAttempt}){
 const {manifest}=verifyFrozenCandidate(root,source);
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)||![runId,runAttempt].every(n=>Number.isSafeInteger(n)&&n>0))throw Error('invalid candidate producer');
 const files=[];let bytes=0;
 function visit(relative=''){
  for(const name of readdirSync(path.join(root,relative)).sort()){
   const member=relative?relative+'/'+name:name,stat=lstatSync(path.join(root,member));
   if(!safe(member)||files.length>=maxRows)throw Error('candidate transport bounds');
   if(stat.isDirectory()){files.push({path:member,type:'directory'});visit(member);}
   else if(stat.isFile()){
    if(stat.size>4*1024*1024||(bytes+=stat.size)>maxBytes)throw Error('candidate transport size limit');
    files.push({path:member,type:'file',mode:stat.mode&0o111?755:644,content:readFileSync(path.join(root,member)).toString('base64')});
   }else throw Error('candidate transport rejects links');
  }
 }
 visit();
 const payload={schemaVersion:1,source,repository,runId,runAttempt,inventorySha256:manifest.inventorySha256,files};
 writeFileSync(output,JSON.stringify(payload)+'\n',{flag:'wx'});
 return payload;
}
export function unpackCandidate(input,destination,{source,repository,runId,runAttempt}){
 if(lstatSync(input).size>96*1024*1024||!lstatSync(input).isFile())throw Error('candidate transport size/type limit');
 const payload=JSON.parse(readFileSync(input,'utf8'));
 if(payload.schemaVersion!==1||payload.source!==source||payload.repository!==repository||payload.runId!==runId||payload.runAttempt!==runAttempt)throw Error('candidate producer mismatch');
 if(!Array.isArray(payload.files)||payload.files.length>maxRows)throw Error('candidate transport bounds');
 const seen=new Set();let bytes=0;
 for(const row of payload.files){
  if(!safe(row.path)||seen.has(row.path)||!['file','directory'].includes(row.type))throw Error('unsafe/duplicate candidate path');seen.add(row.path);
  if(row.type==='file'){
   if(![644,755].includes(row.mode)||typeof row.content!=='string'||row.content.length>6*1024*1024)throw Error('invalid candidate file');
   const data=Buffer.from(row.content,'base64');if(data.toString('base64')!==row.content||data.length>4*1024*1024||(bytes+=data.length)>maxBytes)throw Error('candidate transport size/encoding limit');
  }
 }
 destination=path.resolve(destination);
 let parent=path.parse(destination).root;
 for(const part of path.dirname(destination).slice(parent.length).split(path.sep).filter(Boolean)){parent=path.join(parent,part);if(!lstatSync(parent).isDirectory())throw Error('plain existing destination parent required');}
 if(lstatSync(destination,{throwIfNoEntry:false}))throw Error('candidate destination must be new');
 mkdirSync(destination);
 try{
  for(const row of payload.files){const target=path.join(destination,row.path);
   if(row.type==='directory')mkdirSync(target,{recursive:true});
   else {mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,Buffer.from(row.content,'base64'),{flag:'wx'});chmodSync(target,row.mode===755?0o755:0o644);}
  }
  const {manifest}=verifyFrozenCandidate(destination,source);
  if(manifest.inventorySha256!==payload.inventorySha256)throw Error('candidate transport inventory mismatch');
  return manifest;
 }catch(error){rmSync(destination,{recursive:true,force:true});throw error;}
}
export function downloadCandidate(output) {
 const {GITHUB_REPOSITORY:repository,CANDIDATE_ARTIFACT_ID:id,CANDIDATE_ARTIFACT_DIGEST:digest}=process.env;
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository??'')||!/^[1-9][0-9]*$/.test(id??'')||!/^sha256:[a-f0-9]{64}$/.test(digest??''))throw Error('invalid pinned artifact identity');
 const zip=execFileSync('gh',['api','repos/'+repository+'/actions/artifacts/'+id+'/zip'],{maxBuffer:96*1024*1024,timeout:60000});
 if('sha256:'+createHash('sha256').update(zip).digest('hex')!==digest)throw Error('artifact digest mismatch');
 const temporary=mkdtempSync(path.join(tmpdir(),'candidate-download-'));
 try {
  const file=path.join(temporary,'artifact.zip');writeFileSync(file,zip,{flag:'wx'});
  // Never extract archive paths: require exactly the single expected data payload.
  const names=execFileSync('unzip',['-Z1',file],{encoding:'utf8',maxBuffer:1024*1024,timeout:30000});
  if(names.trim()!=='candidate.json')throw Error('unexpected candidate archive entries');
  const payload=execFileSync('unzip',['-p',file,'candidate.json'],{maxBuffer:96*1024*1024,timeout:30000});
  writeFileSync(output,payload,{flag:'wx'});
 } finally {rmSync(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [mode,input,output,...extra]=process.argv.slice(2);
  if(mode==='download'&&input&&!output){downloadCandidate(input);process.exit(0);}
  if(extra.length||!input||!output||!['pack','unpack'].includes(mode))throw Error('usage: candidate-transfer.mjs pack|unpack <input> <new-output>');
  const identity={source:process.env.CANDIDATE_SOURCE,repository:process.env.GITHUB_REPOSITORY,runId:Number(process.env.CANDIDATE_RUN_ID||process.env.GITHUB_RUN_ID),runAttempt:Number(process.env.CANDIDATE_RUN_ATTEMPT||process.env.GITHUB_RUN_ATTEMPT)};
  (mode==='pack'?packCandidate:unpackCandidate)(input,output,identity);
 }catch(error){console.error(error.message);process.exitCode=1;}
}
