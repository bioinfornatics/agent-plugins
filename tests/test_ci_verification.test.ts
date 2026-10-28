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
