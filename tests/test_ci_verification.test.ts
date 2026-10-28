import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {validateShardPlan,loadTestPlan} from '../scripts/ci-test-plan.mjs';
import {selectCanonicalRun,validateCanonicalJobs,awaitCanonicalVerification,requiredJobs} from '../scripts/production-verification.mjs';
const root=new URL('../',import.meta.url).pathname;
const source='a'.repeat(40),repo='owner/repo',identity={source,repository:repo,repositoryId:1,workflowId:2};
const run={id:3,run_attempt:1,event:'push',head_branch:'develop',head_sha:source,workflow_id:2,repository:{id:1,full_name:repo},head_repository:{id:1,full_name:repo},path:'.github/workflows/development-ci.yml',status:'completed',conclusion:'success'};
const jobs=()=>requiredJobs.map(name=>({name,status:'completed',conclusion:'success',run_id:3,run_attempt:1,head_sha:source}));
const clone=(v:any)=>JSON.parse(JSON.stringify(v));
test('shard plan partitions every current test exactly once and rejects drift',()=>{
 const p=loadTestPlan(root),all=p.shards.flatMap((s:any)=>s.files);assert.equal(all.length,readdirSync(root+'apps/skill-creator-cli/tests').filter(f=>f.endsWith('.test.ts')).length);assert.equal(new Set(all).size,all.length);
 const actual=readdirSync(root+'apps/skill-creator-cli/tests').filter(f=>f.endsWith('.test.ts'));
 for(const kind of ['missing','duplicate','extra','path','ids']){const broken=clone(p);if(kind==='missing')broken.shards[0].files.pop();if(kind==='duplicate')broken.shards[1].files.push(broken.shards[0].files[0]);if(kind==='extra')broken.shards[0].files.push('test_unknown.test.ts');if(kind==='path')broken.shards[0].files[0]='../unsafe.test.ts';if(kind==='ids')broken.shards[0].id=4;assert.throws(()=>validateShardPlan(broken,actual));}
});
test('canonical proof excludes PR, foreign repository, wrong workflow, source and branch',()=>{
 assert.equal(selectCanonicalRun([run],identity)?.state,'success');
 for(const change of [{event:'pull_request'},{head_branch:'main'},{head_sha:'b'.repeat(40)},{workflow_id:9},{path:'.github/workflows/other.yml'},{repository:{id:9,full_name:repo}},{head_repository:{id:9,full_name:'fork/repo'}}])assert.equal(selectCanonicalRun([{...run,...change}],identity),null);
 assert.equal(selectCanonicalRun([{...run,status:'in_progress',conclusion:null}],identity)?.state,'pending');
 assert.throws(()=>selectCanonicalRun([{...run,conclusion:'failure'}],identity),/failed/);
 assert.equal(selectCanonicalRun([run,{...run,id:4,status:'queued',conclusion:null}],identity)?.state,'pending');
});
test('proof requires all seven successful jobs of exact source and attempt',()=>{
 assert.equal(validateCanonicalJobs(jobs(),run),true);
 for(const kind of ['missing','duplicate','skip','sha','run','attempt']){const j=jobs();if(kind==='missing')j.pop();if(kind==='duplicate')j[0].name=j[1].name;if(kind==='skip')j[0].conclusion='skipped';if(kind==='sha')j[0].head_sha='b'.repeat(40);if(kind==='run')j[0].run_id=8;if(kind==='attempt')j[0].run_attempt=2;assert.throws(()=>validateCanonicalJobs(j,run));}
});
function apiFixture(options:any={}){let reads=0;return (endpoint:string,paginate=false)=>{
 if(endpoint==='')return {id:1,full_name:repo};
 if(endpoint.startsWith('contents/'))return {type:'file',encoding:'base64',content:Buffer.from('workflow fixture').toString('base64')};
 if(endpoint==='actions/workflows/development-ci.yml')return {id:2,path:run.path,state:'active'};
 if(endpoint==='branches/develop')return {commit:{sha:options.sourceMoved?'b'.repeat(40):source}};
 if(endpoint.includes('/runs?')){reads++;return [{workflow_runs:options.missing?[]:[options.pending&&reads===1?{...run,status:'in_progress',conclusion:null}:run]}];}
 if(endpoint.includes('/jobs?'))return [{jobs:options.jobs??jobs()}];
 if(endpoint==='actions/runs/3')return options.changedAttempt?{...run,run_attempt:2}:run;
 throw Error('unexpected API '+endpoint);
};}
test('canonical wait resolves pending then rechecks source and rerun races',async()=>{
 let clock=0,sleeps=0;const proof=await awaitCanonicalVerification({source,repository:repo,api:apiFixture({pending:true}),waitSeconds:20,sleep:async()=>{clock+=1000;sleeps++;},now:()=>clock});assert.equal(proof.runId,3);assert.equal(sleeps,1);
 for(const options of [{missing:true},{sourceMoved:true},{changedAttempt:true},{jobs:jobs().slice(1)}])await assert.rejects(awaitCanonicalVerification({source,repository:repo,api:apiFixture(options),waitSeconds:0}));
});
test('public CI group entrypoint rejects unknown modes and arguments',()=>{
 for(const args of [[],['skill','0'],['skill','5'],['quick','extra'],['remaining','extra'],['unknown']]){const p=spawnSync(process.execPath,['scripts/ci-tests.mjs',...args],{cwd:root,encoding:'utf8'});assert.notEqual(p.status,0);assert.match(p.stderr,/usage:/);}
});
test('mandatory CI Goose host contract fails instead of silently skipping missing binary',()=>{
 const env={...process.env,CI_REQUIRE_GOOSE_HOST:'1',GOOSE_TEST_BINARY:'/nonexistent-ci-goose'};delete env.NODE_TEST_CONTEXT;
 const p=spawnSync(process.execPath,['--test','tests/test_goose_host_contract.test.ts'],{cwd:root+'apps/skill-creator-cli',encoding:'utf8',env});assert.notEqual(p.status,0);assert.match(p.stdout+p.stderr,/Real Goose unavailable/);
});
import yaml from '../apps/skill-creator-cli/node_modules/js-yaml/index.js';
test('workflow DAG stops expensive jobs on quick failure and requires all shards',()=>{
 const ci:any=yaml.load(readFileSync(root+'.github/workflows/development-ci.yml','utf8')),promotion:any=yaml.load(readFileSync(root+'.github/workflows/promote-production.yml','utf8'));
 assert.equal(ci.jobs.skill.needs,'quick');assert.equal(ci.jobs.remaining.needs,'quick');assert.deepEqual(ci.jobs.skill.strategy.matrix.shard,[1,2,3,4]);assert.equal(ci.jobs.skill.strategy['fail-fast'],false);
 assert(ci.jobs.skill.steps.some((s:any)=>s.if==='matrix.shard == 1'&&s.run?.includes('build-bun-executables.mjs')));
 assert.deepEqual(ci.jobs.verify.needs,['quick','skill','remaining']);assert.equal(ci.jobs.verify.if,'always()');
 const check=ci.jobs.verify.steps[0].run;
 for(const values of [['success','success','success'],['failure','success','success'],['success','skipped','success'],['success','success','cancelled']]){
  const p=spawnSync('bash',['-c',check],{env:{...process.env,QUICK:values[0],SKILL:values[1],REMAINING:values[2]}});assert.equal(p.status===0,values.every(v=>v==='success'));
 }
 for(const name of ['quick','skill','remaining','verify']){const job=ci.jobs[name];const checkout=job.steps.find((s:any)=>s.uses?.startsWith('actions/checkout@'));assert.match(checkout.with.ref,/pull_request.head.sha/);assert.equal(checkout.with['persist-credentials'],false);}
 assert.equal(promotion.jobs.verify.uses,undefined);assert.deepEqual(promotion.jobs.publish.needs,['resolve','verify']);
 const publish=promotion.jobs.publish.steps.at(-1).run;assert(publish.indexOf('production-verification.mjs')<publish.indexOf('production-request.mjs'));assert(publish.indexOf('production-request.mjs')<publish.indexOf('promote-production.mjs'));
});
test('pending proof is bounded and API failures never authorize publication',async()=>{
 let clock=0;const api=apiFixture({missing:true});await assert.rejects(awaitCanonicalVerification({source,repository:repo,api,waitSeconds:1,sleep:async()=>{clock+=1000;},now:()=>clock}),/missing/);
 await assert.rejects(awaitCanonicalVerification({source,repository:repo,api:()=>{throw Error('transport unavailable');}}),/transport unavailable/);
 for(const options of [{source:'bad'},{repository:'owner/repo/unsafe'},{pollSeconds:0},{waitSeconds:1501}])await assert.rejects(awaitCanonicalVerification({source,repository:repo,api,...options}));
});

import {validateRequestIdentity,validateRequest} from '../scripts/production-request.mjs';
test('promotion preflight validates current source/base without granting publication approval',()=>{
 const main='b'.repeat(40),request={state:'open',draft:false,user:{login:'author'},head:{ref:'develop',sha:source,repo:{full_name:repo}},base:{ref:'main',sha:main,repo:{full_name:repo}}};
 const identityCheck=(pr=request,currentSource=source,currentMain=main)=>validateRequestIdentity(pr,repo,main,currentSource,currentMain,source);
 assert.equal(identityCheck(),source);
 assert.throws(()=>validateRequest(request,[],repo,main,source,main,source),/approval/,'identity success must not authorize publication');
 for(const changed of [{state:'closed'},{draft:true},{head:{...request.head,ref:'feature'}},{head:{...request.head,repo:{full_name:'fork/repo'}}},{base:{...request.base,repo:{full_name:'fork/repo'}}},{base:{...request.base,ref:'develop'}},{head:{...request.head,sha:main}},{base:{...request.base,sha:source}}])assert.throws(()=>identityCheck({...request,...changed}));
 assert.throws(()=>identityCheck(request,main),/moved/);assert.throws(()=>identityCheck(request,source,source),/moved/);
});
test('conflicting promotion PRs use trusted base code only while feature/develop keep full CI',()=>{
 const ci:any=yaml.load(readFileSync(root+'.github/workflows/development-ci.yml','utf8'));
 const light:any=yaml.load(readFileSync(root+'.github/workflows/promotion-pr.yml','utf8'));
 assert.deepEqual(ci.on.push.branches,['develop']);assert.deepEqual(ci.on.pull_request.branches,['develop']);
 assert.equal(light.on.pull_request,undefined);assert.deepEqual(light.on.pull_request_target.branches,['main']);
 assert.deepEqual(light.permissions,{contents:'read'});assert.deepEqual(Object.keys(light.jobs),['promotion-preflight']);
 const job=light.jobs['promotion-preflight'];assert.deepEqual(job.permissions,{contents:'read','pull-requests':'read',actions:'read'});
 assert.match(job.if,/head.ref == 'develop'/);assert.match(job.if,/head.repo.full_name == github.repository/);
 const checkout=job.steps.find((s:any)=>s.uses?.startsWith('actions/checkout@'));
 assert.equal(checkout.with.ref,'${{ github.event.pull_request.base.sha }}');assert.equal(checkout.with['persist-credentials'],false);
 const commands=job.steps.filter((s:any)=>s.run).map((s:any)=>s.run);
 assert.deepEqual(commands,['node .github/scripts/promotion-preflight.mjs']);
 assert.equal(job.steps.find((s:any)=>s.run).env.EXPECTED_SOURCE,'${{ github.event.pull_request.head.sha }}');
 for(const step of job.steps)assert.doesNotMatch(step.run??'',/ci-tests|test.mjs|rebuild|production.mjs project|promote-production|gh pr merge|owner_manual/);
 const projection=readFileSync(root+'scripts/production.mjs','utf8');assert(projection.includes("'promotion-pr.yml'"));assert(projection.includes("'promotion-preflight.mjs'"));
});

import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('identity-only CLI uses read-only current identities and cannot replace approval or ignore drift',()=>{
 const temp=mkdtempSync(join(tmpdir(),'promotion-preflight-')),main='b'.repeat(40);
 const head=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim();
 const request={state:'open',draft:false,user:{login:'author'},head:{ref:'develop',sha:head,repo:{full_name:repo}},base:{ref:'main',sha:main,repo:{full_name:repo}}};
 try{
  // Only API transport is fake; execute the real CLI and Git checkout check.
  const transport=join(temp,'gh'),calls=join(temp,'calls');
  writeFileSync(transport,'#!'+process.execPath+String.fromCharCode(10)+
   'const fs=require("node:fs");const endpoint=process.argv.at(-1);fs.appendFileSync(process.env.CALLS,endpoint+String.fromCharCode(10));let value;if(endpoint.endsWith("/pulls/42"))value=JSON.parse(process.env.REQUEST);else if(endpoint.endsWith("/branches/develop"))value={commit:{sha:process.env.CURRENT_SOURCE}};else if(endpoint.endsWith("/branches/main"))value={commit:{sha:process.env.CURRENT_MAIN}};else if(endpoint.includes("/reviews?"))value=[[]];else process.exit(9);console.log(JSON.stringify(value));',{mode:0o700});
  const env={...process.env,PATH:temp+':'+process.env.PATH,GITHUB_REPOSITORY:repo,CALLS:calls,REQUEST:JSON.stringify(request),CURRENT_SOURCE:head,CURRENT_MAIN:main};delete env.NODE_TEST_CONTEXT;delete env.OWNER_MANUAL;
  const invoke=(mode:string[]=[],overrides:any={})=>spawnSync(process.execPath,['scripts/production-request.mjs','42',main,head,...mode],{cwd:root,encoding:'utf8',env:{...env,...overrides}});
  const valid=invoke(['--identity-only']);assert.equal(valid.status,0,valid.stderr);assert.equal(valid.stdout,'source_sha='+head+String.fromCharCode(10));
  assert.deepEqual(readFileSync(calls,'utf8').trim().split(String.fromCharCode(10)),['repos/'+repo+'/pulls/42','repos/'+repo+'/branches/develop','repos/'+repo+'/branches/main']);
  const noApproval=invoke();assert.notEqual(noApproval.status,0);assert.match(noApproval.stderr,/independent maintainer approval/);
  for(const overrides of [{CURRENT_SOURCE:main},{CURRENT_MAIN:head},{OWNER_MANUAL:'true'}]){const denied=invoke(['--identity-only'],overrides);assert.notEqual(denied.status,0);assert.match(denied.stderr,/moved|cannot authorize publication/);}
  const invalid=invoke(['--unknown']);assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/unsupported promotion request mode/);
 }finally{rmSync(temp,{recursive:true,force:true});}
});

import {verifyPromotionPreflight} from '../scripts/promotion-preflight.mjs';
test('trusted promotion preflight rejects request drift before and after canonical proof without executing source',async()=>{
 const main='b'.repeat(40),request={state:'open',draft:false,head:{ref:'develop',sha:source,repo:{full_name:repo}},base:{ref:'main',sha:main,repo:{full_name:repo}}};
 function fixture(change:string|null=null){let verified=false;const calls:string[]=[];return {calls,
  api:(endpoint:string)=>{calls.push(endpoint);if(endpoint==='pulls/42')return change==='fork'?{...request,head:{...request.head,repo:{full_name:'fork/repo'}}}:request;
   if(endpoint==='branches/develop')return {commit:{sha:verified&&change==='source'?main:source}};
   if(endpoint==='branches/main')return {commit:{sha:verified&&change==='base'?source:main}};throw Error('unexpected API '+endpoint);},
  verify:async()=>{verified=true;if(change==='proof')throw Error('canonical verification missing');return {sourceCommit:source,runId:3};},
 };}
 const f=fixture(),result=await verifyPromotionPreflight({number:42,repository:repo,source,main,...f});
 assert.equal(result.sourceCommit,source);assert.equal(result.baseCommit,main);assert.equal(result.verification.runId,3);assert.match(result.authority,/informational only/);
 assert.deepEqual(f.calls,['pulls/42','branches/develop','branches/main','pulls/42','branches/develop','branches/main']);
 for(const change of ['fork','source','base','proof'])await assert.rejects(verifyPromotionPreflight({number:42,repository:repo,source,main,...fixture(change)}),/same-repository|moved|canonical verification missing/);
 for(const altered of [{number:0},{repository:'owner/repo/unsafe'},{source:'bad'},{main:'bad'}])await assert.rejects(verifyPromotionPreflight({number:42,repository:repo,source,main,...fixture(),...altered}),/invalid/);
});
