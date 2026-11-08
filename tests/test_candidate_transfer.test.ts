import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, lstatSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareEvaluationCandidate } from '../scripts/prepare-evaluation-candidate.mjs';
import { packCandidate, unpackCandidate, downloadCandidate } from '../scripts/candidate-transfer.mjs';
import { verifyFrozenCandidate } from '../scripts/frozen-candidate.mjs';

// Transport is data-only: reject paths and identity before restoring any candidate, preserve frozen bytes/modes.
test('frozen transport roundtrip preserves production bytes and rejects identity/path drift', async () => {
 const temp=mkdtempSync(path.join(tmpdir(),'candidate-transfer-'));
 try {
  const root=path.join(temp,'candidate'),manifest=await prepareEvaluationCandidate(root);
  const identity={source:manifest.sourceCommit,repository:'owner/repo',runId:42,runAttempt:2};
  const packed=path.join(temp,'candidate.json');packCandidate(root,packed,identity);
  const restored=path.join(temp,'restored');unpackCandidate(packed,restored,identity);
  const verified=verifyFrozenCandidate(restored,identity.source);
  for(const row of manifest.production.files){
   const file=path.join(verified.production,row.path);
   assert.deepEqual(readFileSync(file),readFileSync(path.join(root,'production',row.path)));
   assert.equal(Boolean(lstatSync(file).mode&0o111),row.mode===755);
  }
  assert.throws(()=>verifyFrozenCandidate(restored,'b'.repeat(40)),/source mismatch/);
  for(const change of [{runId:43},{runAttempt:1},{repository:'foreign/repo'},{source:'b'.repeat(40)}])assert.throws(()=>unpackCandidate(packed,path.join(temp,'bad'),{...identity,...change}),/producer mismatch/);
  const original=readFileSync(packed,'utf8'),payload=JSON.parse(original);
  for(const member of ['../escape','/absolute','plugin/../escape','plugin\\escape']){
   writeFileSync(packed,JSON.stringify({...payload,files:[{path:member,type:'directory'}]}));
   assert.throws(()=>unpackCandidate(packed,path.join(temp,'bad'),identity),/unsafe/);assert.equal(existsSync(path.join(temp,'bad')),false);
  }
  writeFileSync(packed,JSON.stringify({...payload,files:[payload.files[0],payload.files[0]]}));
  assert.throws(()=>unpackCandidate(packed,path.join(temp,'bad'),identity),/duplicate/);
  writeFileSync(packed,original);
  assert.throws(()=>unpackCandidate(packed,restored,identity),/new/);
 } finally {rmSync(temp,{recursive:true,force:true});}
});

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
// Real ZIP bytes, fake API transport: authenticate archive before reading its sole data member.
test('download authenticates archive digest and refuses extra members or existing output',()=>{
 const temp=mkdtempSync(path.join(tmpdir(),'candidate-download-test-'));
 const keys=['PATH','GITHUB_REPOSITORY','CANDIDATE_ARTIFACT_ID','CANDIDATE_ARTIFACT_DIGEST','TEST_ZIP'];
 const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try {
  writeFileSync(path.join(temp,'candidate.json'),'{}');
  const zip=path.join(temp,'artifact.zip');execFileSync('zip',['-q',zip,'candidate.json'],{cwd:temp});
  const gh=path.join(temp,'gh');writeFileSync(gh,'#!'+process.execPath+'\nprocess.stdout.write(require("node:fs").readFileSync(process.env.TEST_ZIP));\n');chmodSync(gh,0o755);
  process.env.PATH=temp+':'+before.PATH;process.env.GITHUB_REPOSITORY='owner/repo';process.env.CANDIDATE_ARTIFACT_ID='12';process.env.TEST_ZIP=zip;
  process.env.CANDIDATE_ARTIFACT_DIGEST='sha256:'+createHash('sha256').update(readFileSync(zip)).digest('hex');
  const output=path.join(temp,'download.json');downloadCandidate(output);assert.equal(readFileSync(output,'utf8'),'{}');
  assert.throws(()=>downloadCandidate(output),/EEXIST/);assert.equal(readFileSync(output,'utf8'),'{}');
  process.env.CANDIDATE_ARTIFACT_DIGEST='sha256:'+'a'.repeat(64);
  assert.throws(()=>downloadCandidate(path.join(temp,'bad')),/digest mismatch/);assert.equal(existsSync(path.join(temp,'bad')),false);
  writeFileSync(path.join(temp,'extra'),'extra');execFileSync('zip',['-q',zip,'extra'],{cwd:temp});
  process.env.CANDIDATE_ARTIFACT_DIGEST='sha256:'+createHash('sha256').update(readFileSync(zip)).digest('hex');
  assert.throws(()=>downloadCandidate(path.join(temp,'bad')),/unexpected candidate archive/);
 } finally {for(const key of keys){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}rmSync(temp,{recursive:true,force:true});}
});
