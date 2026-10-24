import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectProduction, verifyProduction, smokeProduction } from '../scripts/production.mjs';
const root=path.resolve(import.meta.dirname,'..');
test('production projection is deterministic, self-contained and tamper-evident',()=>{
 const temp=mkdtempSync(path.join(tmpdir(),'production-test-'));
 try{
  const a=path.join(temp,'a'),b=path.join(temp,'b');projectProduction(a);projectProduction(b);
  assert.equal(readFileSync(path.join(a,'distribution-manifest.json'),'utf8'),readFileSync(path.join(b,'distribution-manifest.json'),'utf8'));
  smokeProduction(a);assert.throws(()=>projectProduction(a),/new and non-overlapping/);
  writeFileSync(path.join(a,'source.ts'),'leaked');assert.throws(()=>verifyProduction(a),/inventory mismatch/);rmSync(path.join(a,'source.ts'));
  const entry=path.join(a,'skills/skill-creator/scripts/skill-creator.mjs');writeFileSync(entry,'tampered');assert.throws(()=>verifyProduction(a),/inventory mismatch/);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
test('production projection rejects source runtime additions and symlink destination ancestry',()=>{
 const temp=mkdtempSync(path.join(tmpdir(),'production-unsafe-')),extra=path.join(root,'skills/skill-creator/runtime/__production_test_canary__');
 try{
  writeFileSync(extra,'unexpected runtime');assert.throws(()=>projectProduction(path.join(temp,'bad')),/unexpected\/missing runtime/);rmSync(extra);
  if(process.platform!=='win32'){symlinkSync(temp,path.join(temp,'linked'),'dir');assert.throws(()=>projectProduction(path.join(temp,'linked','bad2')),/symlink destination ancestor/);}
 }finally{rmSync(extra,{force:true});rmSync(temp,{recursive:true,force:true});}
});
test('promotion fails closed before any push when branch or expected SHA is invalid',()=>{
 const result=spawnSync(process.execPath,[path.join(root,'scripts/promote-production.mjs'),'upstream','invalid'],{cwd:root,encoding:'utf8'});
 assert.notEqual(result.status,0);assert.match(result.stderr,/expected-main-sha/);
});
test('CI is read-only for PRs and promotion is serialized and source guarded',()=>{
 const ci=readFileSync(path.join(root,'.github/workflows/development-ci.yml'),'utf8'),promotion=readFileSync(path.join(root,'.github/workflows/promote-production.yml'),'utf8');
 assert.match(ci,/branches: \[development\]/);assert.doesNotMatch(ci,/contents: write|pull_request_target/);
 assert.match(ci,/npm run test:reproducibility/);assert.match(ci,/sha256sum -c/);assert.match(ci,/persist-credentials: false/);
 assert.match(promotion,/expected_main/);assert.match(promotion,/cancel-in-progress: false/);assert.match(promotion,/needs: \[resolve, verify\]/);assert.match(promotion,/VERIFIED_SHA/);assert.match(promotion,/contents: write/);assert.doesNotMatch(promotion,/--force/);
 const script=readFileSync(path.join(root,'scripts/promote-production.mjs'),'utf8');assert.match(script,/remote main changed after verification/);assert.match(script,/test-production-install/);assert.match(script,/commit-tree/);
});

import { validateRequest } from '../scripts/production-request.mjs';
test('promotion request requires current independent approval and immutable branch identities',()=>{
 const source='a'.repeat(40),main='b'.repeat(40),repo='owner/plugin';
 const pr={state:'open',draft:false,user:{login:'author'},head:{ref:'development',sha:source,repo:{full_name:repo}},base:{ref:'main',sha:main,repo:{full_name:repo}}};
 const approved={state:'APPROVED',commit_id:source,user:{login:'reviewer'},author_association:'COLLABORATOR'};
 const check=(request=pr,reviews=[approved],verified=source)=>validateRequest(request,reviews,repo,main,source,main,verified);
 assert.equal(check(),source);
 assert.throws(()=>check(pr,[]),/approval/);
 assert.throws(()=>check(pr,[{...approved,commit_id:main}]),/approval/);
 assert.throws(()=>check(pr,[{...approved,user:{login:'author'}}]),/approval/);
 assert.throws(()=>check(pr,[approved,{...approved,state:'DISMISSED'}]),/approval/);
 assert.throws(()=>check(pr,[approved,{...approved,state:'CHANGES_REQUESTED'}]),/approval/);
 assert.throws(()=>check({...pr,draft:true}),/non-draft/);
 assert.throws(()=>check({...pr,head:{...pr.head,repo:{full_name:'fork/plugin'}}}),/same-repository/);
 assert.throws(()=>check({...pr,base:{...pr.base,sha:source}}),/moved/);
 assert.throws(()=>check(pr,[approved],main),/moved/);
});
test('PR CI verifies head source rather than synthetic source-to-production merge',()=>{
 const ci=readFileSync(path.join(root,'.github/workflows/development-ci.yml'),'utf8');
 const promotion=readFileSync(path.join(root,'.github/workflows/promote-production.yml'),'utf8');
 assert.match(ci,/branches: \[development, main\]/);
 assert.match(ci,/pull_request.head.sha/);
 assert.match(promotion,/source_sha:.*needs.resolve.outputs.source_sha/);
 assert.match(promotion,/production-request.mjs.*VERIFIED_SHA/);
 assert.match(promotion,/gh pr close/);
 assert.match(promotion,/pull_request_review:/);
 assert.ok(promotion.includes("inputs.pull_request || github.event.pull_request.number"));
 assert.ok(promotion.includes("inputs.expected_main || github.event.pull_request.base.sha"));
 assert.doesNotMatch(promotion,/gh pr merge|pull_request_target/);
});
