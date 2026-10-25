import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, symlinkSync, mkdirSync, copyFileSync } from 'node:fs';
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
 assert.match(ci,/branches: \[development, develop\]/);assert.doesNotMatch(ci,/contents: write|pull_request_target/);
 assert.doesNotMatch(ci,/npm run test:reproducibility/);assert.match(ci,/profile=production/);assert.match(ci,/sha256sum -c/);assert.match(ci,/persist-credentials: false/);
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
 assert.match(ci,/branches: \[development, develop, main\]/);
 assert.match(ci,/pull_request.head.sha/);
 assert.match(promotion,/source_sha:.*needs.resolve.outputs.source_sha/);
 assert.match(promotion,/production-request.mjs.*VERIFIED_SHA/);
 assert.match(promotion,/gh pr close/);
 assert.match(promotion,/pull_request_review:/);
 assert.ok(promotion.includes("inputs.pull_request || github.event.pull_request.number"));
 assert.ok(promotion.includes("inputs.expected_main || github.event.pull_request.base.sha"));
 assert.doesNotMatch(promotion,/gh pr merge|pull_request_target/);
});

test('CI wrapper retains full logs, bounds console output and propagates child failures',()=>{
 const temp=mkdtempSync(path.join(tmpdir(),'ci-wrapper-'));
 const wrapper=path.join(root,'scripts/ci-step.mjs'),summary=path.join(temp,'summary.md');
 const run=(label:string,args:string[])=>spawnSync(process.execPath,[wrapper,label,...args],{cwd:temp,encoding:'utf8',env:{...process.env,GITHUB_STEP_SUMMARY:summary}});
 try{
  const ok=run('success',[process.execPath,'-e',"for(let i=0;i<2000;i++)console.log('line '+i);console.error('stderr sentinel');console.log('# pass 3')"]);
  assert.equal(ok.status,0,ok.stderr);assert.match(ok.stdout,/success: PASS/);assert.match(ok.stdout,/# pass 3/);assert.ok(ok.stdout.split('\n').length<70);
  const log=readFileSync(path.join(temp,'.artifacts/ci-logs/success.log'),'utf8');assert.match(log,/line 0\n/);assert.match(log,/line 1999\n/);assert.match(log,/stderr sentinel/);
  const fail=run('failure',[process.execPath,'-e',"for(let i=0;i<2000;i++)console.log('line '+i);console.error('failure sentinel');process.exit(7)"]);
  assert.equal(fail.status,7);assert.match(fail.stderr,/failure sentinel/);assert.ok(fail.stderr.split('\n').length<105);
  const missing=run('missing',['__nonexistent_ci_command__']);assert.equal(missing.status,1);assert.match(missing.stderr,/ENOENT/);
  const invalid=run('../unsafe',[process.execPath,'-e','']);assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/usage:/);
  assert.match(readFileSync(summary,'utf8'),/success: PASS/);assert.match(readFileSync(summary,'utf8'),/failure: FAIL/);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
test('clean rebuild rejects generated drift instead of silently accepting it',()=>{
 const temp=mkdtempSync(path.join(tmpdir(),'ci-rebuild-'));
 const put=(file:string,content:string)=>{mkdirSync(path.dirname(path.join(temp,file)),{recursive:true});writeFileSync(path.join(temp,file),content);};
 const git=(...args:string[])=>{const r=spawnSync('git',args,{cwd:temp,encoding:'utf8'});assert.equal(r.status,0,r.stderr);};
 try{
  copyFileSync(path.join(root,'scripts/rebuild-production.mjs'),path.join(temp,'rebuild.mjs'));
  put('scripts/verify-repository-integrity.mjs','');put('scripts/generate-skill-runtimes.mjs','');
  for(const name of ['agent','hook','plugin','skill'])put('apps/'+name+'-creator-cli/scripts/build.mjs','');
  put('contracts/capability-contract/scripts/build.mjs','');put('contracts/capability-contract/scripts/refresh-compatibility-fixtures.mjs','');put('skills/example/runtime/output.js','original');
  git('init','-q');git('add','-A');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','fixture');
  const run=()=>spawnSync(process.execPath,['rebuild.mjs'],{cwd:temp,encoding:'utf8'});
  assert.equal(run().status,0);
  put('skills/example/runtime/output.js','stale');const stale=run();assert.notEqual(stale.status,0);assert.match(stale.stderr,/clean rebuild differs from committed outputs/);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
test('routine and exhaustive CI preserve explicit verification scopes and failure log artifacts',()=>{
 const ci=readFileSync(path.join(root,'.github/workflows/development-ci.yml'),'utf8'),exhaustive=readFileSync(path.join(root,'.github/workflows/reproducibility.yml'),'utf8');
 assert.match(ci,/ci-step.mjs clean-build node scripts\/rebuild-production.mjs/);assert.doesNotMatch(ci,/--profile=full|test-clean-source-reproducibility/);
 for(const workflow of [ci,exhaustive]){assert.match(workflow,/if: always\(\)/);assert.match(workflow,/path: .artifacts\/ci-logs/);assert.match(workflow,/contents: read/);assert.doesNotMatch(workflow,/contents: write|pull_request_target/);}
 assert.match(exhaustive,/schedule:/);assert.match(exhaustive,/workflow_dispatch:/);assert.ok(exhaustive.includes("ref: ${{ steps.source.outputs.sha }}"));assert.match(exhaustive,/reproducibility.mjs --build-only/);assert.equal((exhaustive.match(/scripts\/test.mjs --profile=full/g)||[]).length,1);
 const runner=readFileSync(path.join(root,'scripts/test.mjs'),'utf8');assert.match(runner,/if\(full\)gate\("Testing release packaging"/);assert.match(runner,/deferredGates/);
 for(const [script,arg] of [['test.mjs','--profile=unknown'],['test-clean-source-reproducibility.mjs','--unknown']]){const invalid=spawnSync(process.execPath,[path.join(root,'scripts',script),arg],{cwd:root,encoding:'utf8'});assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/usage:/);}
});

test('branch transition accepts develop without weakening approval or source guards',()=>{
 const source='a'.repeat(40),main='b'.repeat(40),repo='owner/plugin';
 const approved={state:'APPROVED',commit_id:source,user:{login:'reviewer'},author_association:'COLLABORATOR'};
 const pr={state:'open',draft:false,user:{login:'author'},head:{ref:'develop',sha:source,repo:{full_name:repo}},base:{ref:'main',sha:main,repo:{full_name:repo}}};
 const check=(request=pr,reviews=[approved],verified=source)=>validateRequest(request,reviews,repo,main,source,main,verified);
 assert.equal(check(),source);
 assert.equal(check({...pr,head:{...pr.head,ref:'development'}}),source);
 for(const ref of ['main','feature/develop','developement',''])assert.throws(()=>check({...pr,head:{...pr.head,ref}}),/source branch|same-repository/);
 assert.throws(()=>check(pr,[]),/approval/);
 assert.throws(()=>check(pr,[{...approved,user:{login:'author'}}]),/approval/);
 assert.throws(()=>check(pr,[approved],main),/moved/);
 assert.throws(()=>check({...pr,head:{...pr.head,repo:{full_name:'fork/plugin'}}}),/same-repository/);
});

test('scheduled branch resolution prefers develop and fails closed without a source',()=>{
 const workflow=readFileSync(path.join(root,'.github/workflows/reproducibility.yml'),'utf8');
 const block=workflow.split('        run: |\n')[1].split('      - uses:')[0];
 assert.ok(block);
 const script=block.split('\n').map(line=>line.replace(/^          /,'')).join('\n');
 const temp=mkdtempSync(path.join(tmpdir(),'source-resolution-'));
 try{
  const run=(branches:unknown[],fail=false)=>{
   const output=path.join(temp,'output');writeFileSync(output,'');
   // Fake only API transport; execute the real workflow jq pipeline.
   const fake='gh(){ if [ "$API_FAIL" = 1 ]; then return 1; fi; printf "%s" "$BRANCH_FIXTURE"; };\n';
   const result=spawnSync('bash',['-c',fake+script],{encoding:'utf8',env:{...process.env,BRANCH_FIXTURE:JSON.stringify([branches]),API_FAIL:fail?'1':'0',GITHUB_REPOSITORY:'owner/repo',GITHUB_OUTPUT:output}});
   return {...result,output:readFileSync(output,'utf8')};
  };
  const old={name:'development',commit:{sha:'a'.repeat(40)}},next={name:'develop',commit:{sha:'b'.repeat(40)}};
  for(const [branches,sha] of [[[old],old.commit.sha],[[next],next.commit.sha],[[old,next],next.commit.sha]] as const){const result=run([...branches]);assert.equal(result.status,0,result.stderr);assert.equal(result.output,'sha='+sha+'\n');}
  for(const result of [run([]),run([{name:'main',commit:{sha:'c'.repeat(40)}}]),run([old],true),run([{name:'develop',commit:{sha:'invalid'}}])]){assert.notEqual(result.status,0);assert.equal(result.output,'');}
 }finally{rmSync(temp,{recursive:true,force:true});}
});

test('transitional publication attaches only an allowed approved source branch',()=>{
 const promotion=readFileSync(path.join(root,'.github/workflows/promote-production.yml'),'utf8');
 assert.ok(promotion.includes('github.event.pull_request.head.ref || github.ref_name'));
 assert.ok(promotion.includes('case "$SOURCE_BRANCH" in development|develop) ;; *) exit 1 ;; esac'));
 assert.ok(promotion.includes('git switch -c "$SOURCE_BRANCH"'));
 for(const file of ['development-ci.yml','promote-production.yml']){
  const text=readFileSync(path.join(root,'.github/workflows',file),'utf8');
  assert.ok(text.includes('contains(fromJSON('));assert.ok(text.includes('"development","develop"'));
 }
});

test('explicit manual owner authorization requires personal owner and exact source',()=>{
 const source='a'.repeat(40),main='b'.repeat(40),repo='owner/plugin';
 const pr={state:'open',draft:false,user:{login:'owner'},head:{ref:'development',sha:source,repo:{full_name:repo}},base:{ref:'main',sha:main,repo:{full_name:repo}}};
 const manual={event:'workflow_dispatch',confirmed:true,actor:'owner',owner:'owner',ownerType:'User',admin:true,expectedSource:source};
 const check=(authorization=manual,reviews:unknown[]=[])=>validateRequest(pr,reviews,repo,main,source,main,source,authorization);
 assert.equal(check(),source);
 for(const altered of [{actor:'other'},{ownerType:'Organization'},{admin:false},{expectedSource:main},{confirmed:false},{event:'pull_request_review'}])assert.throws(()=>check({...manual,...altered}),/owner|approval/);
 assert.throws(()=>check(manual,[{state:'CHANGES_REQUESTED',user:{login:'reviewer'}}]),/change requests/);
});

test('manual CLI reads repository metadata without a trailing slash',()=>{
 const script=readFileSync(path.join(root,'scripts/production-request.mjs'),'utf8');
 assert.ok(script.includes("repository+(endpoint ? '/'+endpoint : '')"));
});
