import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isolatedEnvironment, runCommand, selectGoose } from '../scripts/test-production-install.mjs';
import { projectProduction } from '../scripts/production.mjs';
const root=path.resolve(import.meta.dirname,'..');

test('explicit host selection has no PATH or version fallback',()=>{
  assert.throws(()=>selectGoose({PATH:'/usr/local/bin'}),/set GOOSE_EXECUTABLE or GOOSE_TEST_BINARY/);
  assert.equal(selectGoose({GOOSE_TEST_BINARY:'./goose'}),path.resolve('goose'));
  assert.throws(()=>selectGoose({GOOSE_EXECUTABLE:'/one',GOOSE_TEST_BINARY:'/two'}),/conflicting/);
});
test('isolated child environment excludes credentials, hooks and inherited loader/test overrides',()=>{
  const work=path.resolve(tmpdir(),'contract-isolation');
  const env=isolatedEnvironment(work,{PATH:'/bin',HOME:'/operator',XDG_DATA_HOME:'/operator/data',GOOSE_PATH_ROOT:'/operator/goose',
    GIT_CONFIG_COUNT:'2',GIT_CONFIG_KEY_0:'credential.helper',GIT_CONFIG_VALUE_0:'operator-helper',GIT_DIR:'/operator/repo',
    GIT_CONFIG_GLOBAL:'/operator/gitconfig',OPENAI_API_KEY:'private',NODE_OPTIONS:'--import=bad',NODE_TEST_CONTEXT:'child-v8'});
  for(const key of ['HOME','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_STATE_HOME','XDG_CACHE_HOME','XDG_RUNTIME_DIR','GOOSE_PATH_ROOT','TMPDIR']) assert.ok(env[key].startsWith(work+path.sep),key);
  for(const key of ['GIT_DIR','OPENAI_API_KEY','NODE_OPTIONS','NODE_TEST_CONTEXT']) assert.equal(env[key],undefined,key);
  assert.equal(env.GIT_CONFIG_COUNT,'1');assert.equal(env.GIT_CONFIG_KEY_0,'core.hooksPath');assert.equal(env.GIT_CONFIG_VALUE_0,path.join(work,'empty-hooks'));
  assert.equal(env.GIT_CONFIG_GLOBAL,path.join(work,'empty-gitconfig'));
});
test('subprocess execution proves env/cwd isolation and propagates exit, timeout and spawn failures',()=>{
  const work=mkdtempSync(path.join(tmpdir(),'install-command-contract-'));
  try {
    const env=isolatedEnvironment(work,{PATH:process.env.PATH});
    const actual=JSON.parse(runCommand(process.execPath,['-e','console.log(JSON.stringify({cwd:process.cwd(),home:process.env.HOME,context:process.env.NODE_TEST_CONTEXT}))'],{cwd:work,env}));
    assert.deepEqual(actual,{cwd:work,home:path.join(work,'home')});
    assert.throws(()=>runCommand(process.execPath,['-e','console.error("specific failure"); process.exit(7)'],{cwd:work,env}),/exit 7[\s\S]*specific failure/);
    assert.throws(()=>runCommand(process.execPath,['-e','setTimeout(()=>{},10000)'],{cwd:work,env,timeout:30}),/ETIMEDOUT/);
    assert.throws(()=>runCommand(path.join(work,'missing'),[],{cwd:work,env}),/ENOENT/);
  } finally {rmSync(work,{recursive:true,force:true});}
});
test('actual native local-Git install/update uses relative candidate input and the contained single launcher', {timeout:240000}, t=>{
  const goose=process.env.GOOSE_EXECUTABLE || process.env.GOOSE_TEST_BINARY;
  if(!goose) {
    if(process.env.CI) assert.fail('required CI Git-install proof missing: explicitly set GOOSE_EXECUTABLE or GOOSE_TEST_BINARY');
    t.skip('native host not explicitly supplied (required in CI)');return;
  }
  const temp=mkdtempSync(path.join(tmpdir(),'production-install-contract-'));
  try {
    const candidate=process.env.PRODUCTION_INSTALL_CANDIDATE ? path.resolve(process.env.PRODUCTION_INSTALL_CANDIDATE) : path.join(temp,'candidate');
    if(!process.env.PRODUCTION_INSTALL_CANDIDATE) projectProduction(candidate);
    const env={...process.env,GOOSE_EXECUTABLE:path.resolve(goose)};
    delete env.GOOSE_TEST_BINARY;delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;delete env.NODE_PATH;
    const result=spawnSync(process.execPath,[path.join(root,'scripts/test-production-install.mjs'),path.relative(temp,candidate)],{cwd:temp,env,encoding:'utf8',timeout:220000});
    assert.ifError(result.error);assert.equal(result.signal,null);assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
    const proof=JSON.parse(result.stdout);
    assert.equal(proof.status,'passed');assert.equal(proof.gitInstall,true);assert.equal(proof.gitUpdate,true);
    assert.equal(proof.skillsListAfterInstall,true);assert.equal(proof.skillsListAfterUpdate,true);
    assert.equal(proof.discoveredSkills,5);assert.equal(proof.standaloneCommands,1);assert.equal(proof.readOnlyHistory,true);
    assert.equal(proof.autoUpdate,false);assert.equal(proof.removedCanaries,7);assert.equal(proof.developmentLeakage,0);
    assert.equal(proof.exportPayloadsIdentical,true);assert.equal(proof.externalFixturePreserved,true);
    assert.equal(proof.fakeCandidateCalls,2);assert.equal(proof.fakeJudgeCalls,2);assert.equal(proof.nativeModelCalls,0);
    for(const phase of ['exportBeforeUpdate','exportAfterUpdate']) {
      const exported=proof[phase];
      assert.equal(exported.ready,true);assert.equal(exported.selectedRuns,2);assert.equal(exported.readonly,true);
      assert.equal(exported.delta,'+1.0000');assert.equal(exported.gradingIds.length,2);
      assert.ok(exported.payloadHashes.some(file=>file.path==='iteration-1/eval-1/with_skill/run-1/grading.json'));
      assert.ok(exported.payloadHashes.some(file=>file.path==='iteration-1/eval-1/without_skill/run-1/grading.json'));
    }
    assert.deepEqual(proof.exportAfterUpdate,proof.exportBeforeUpdate);
    assert.match(proof.goose.sha256,/^[a-f0-9]{64}$/);assert.match(proof.goose.version,/\d+\.\d+\.\d+/);
    assert.equal(proof.candidate.directory,candidate);
    assert.equal(existsSync(path.join(temp,'home')),false,'gate must own and clean its separate installation');
    t.diagnostic(JSON.stringify(proof));
  } finally {rmSync(temp,{recursive:true,force:true});}
});
