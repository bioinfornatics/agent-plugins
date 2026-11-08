import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { prepareEvaluationCandidate } from '../scripts/prepare-evaluation-candidate.mjs';
import { verifyFrozenCandidate } from '../scripts/frozen-candidate.mjs';
const root=path.resolve(import.meta.dirname,'..');

// Real publication CLI and local Git remote; only external install/approval services are doubles.
// This proves frozen-to-Git mechanics, not Goose compatibility or GitHub authorization.
for(const mutate of [false,true])test(mutate?'promotion refuses installation-time corruption without updating main':'promotion publishes exact frozen blobs/modes with previous main as sole parent',async()=>{
 const temp=mkdtempSync(path.join(tmpdir(),'frozen-promotion-'));
 try {
  const repo=path.join(temp,'source'),remote=path.join(temp,'remote.git'),candidate=path.join(temp,'candidate');
  mkdirSync(repo);mkdirSync(path.join(temp,'home'));mkdirSync(path.join(temp,'hooks'));mkdirSync(path.join(repo,'scripts'));
  const env={PATH:process.env.PATH,HOME:path.join(temp,'home'),LANG:'C',LC_ALL:'C',
   GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(temp,'empty-config'),GIT_TERMINAL_PROMPT:'0',
   GIT_AUTHOR_NAME:'Test',GIT_AUTHOR_EMAIL:'test@example.invalid',GIT_COMMITTER_NAME:'Test',GIT_COMMITTER_EMAIL:'test@example.invalid',
   GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.hooksPath',GIT_CONFIG_VALUE_0:path.join(temp,'hooks'),
   PR_NUMBER:'42',CANDIDATE_ARTIFACT_ID:'12',CANDIDATE_ARTIFACT_DIGEST:'sha256:'+'a'.repeat(64),CANDIDATE_RUN_ID:'3',CANDIDATE_RUN_ATTEMPT:'1',
   TEST_RECORD:path.join(temp,'checks'),TEST_MUTATE:mutate?'1':'0'};
  const git=(args:string[],cwd=repo)=>execFileSync('git',args,{cwd,env,encoding:'utf8'}).trim();
  git(['init','--initial-branch=main']);git(['commit','--allow-empty','-m','previous main']);
  const previous=git(['rev-parse','HEAD']);
  git(['init','--bare',remote]);git(['remote','add','origin',remote]);git(['push','origin','main']);git(['switch','-c','develop']);
  for(const file of ['promote-production.mjs','production.mjs','frozen-candidate.mjs'])copyFileSync(path.join(root,'scripts',file),path.join(repo,'scripts',file));
  writeFileSync(path.join(repo,'scripts/test-production-install.mjs'),`import fs from 'node:fs';import path from 'node:path';fs.appendFileSync(process.env.TEST_RECORD,'install\\n');if(process.env.TEST_MUTATE==='1')fs.appendFileSync(path.join(process.argv[2],'LICENSE'),'corruption');`);
  for(const file of ['production-verification.mjs','production-request.mjs'])writeFileSync(path.join(repo,'scripts',file),`import fs from 'node:fs';fs.appendFileSync(process.env.TEST_RECORD,${JSON.stringify(file+'\n')});`);
  git(['add','scripts']);git(['commit','-m','isolated publisher fixture']);git(['push','origin','develop']);
  const source=git(['rev-parse','HEAD']),tree=git(['rev-parse','HEAD^{tree}']);
  const manifest=await prepareEvaluationCandidate(candidate);
  // Bind the disposable producer to its own Git identity before freezing; production treatment is unchanged.
  manifest.sourceCommit=source;manifest.sourceTree=tree;manifest.production.sourceCommit=source;manifest.production.sourceTree=tree;
  writeFileSync(path.join(candidate,'production/distribution-manifest.json'),JSON.stringify(manifest.production,null,2)+'\n');
  writeFileSync(path.join(candidate,'candidate-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  verifyFrozenCandidate(candidate,source);
  const beforeIndex=git(['ls-files','--stage']);
  const result=spawnSync(process.execPath,['scripts/promote-production.mjs','origin',previous,candidate,'--push'],{cwd:repo,env:{...env,VERIFIED_SHA:source},encoding:'utf8',timeout:60000});
  assert.equal(git(['ls-files','--stage']),beforeIndex,'publisher must preserve source index');
  assert.equal(git(['status','--porcelain']),'','publisher must preserve source worktree');
  if(mutate){
   assert.notEqual(result.status,0);assert.match(result.stderr,/production inventory mismatch/);
   assert.equal(git(['rev-parse','refs/heads/main'],remote),previous);
   assert.equal(git(['for-each-ref','--format=%(refname)','refs/heads/candidate/']),'');
   assert.equal(readFileSync(env.TEST_RECORD,'utf8'),'install\n');
  }else{
   assert.equal(result.status,0,result.stderr);
   const output=JSON.parse(result.stdout.trim().split('\n').at(-1)!);
   assert.equal(output.status,'promoted');assert.equal(output.pushed,true);
   const published=git(['rev-parse','refs/heads/main'],remote);assert.equal(published,output.productionCommit);
   assert.equal(git(['show','-s','--format=%P',published]),previous,'previous main must be the sole parent');
   const rows=git(['ls-tree','-r',published]).split('\n');
   assert.equal(rows.length,manifest.production.files.length+1);
   for(const row of rows){
    const [,mode,blob,name]=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row)!;
    const actual=execFileSync('git',['cat-file','blob',blob],{cwd:repo,env});
    assert.deepEqual(actual,readFileSync(path.join(candidate,'production',name)),name);
    const expected=manifest.production.files.find((f:any)=>f.path===name);
    assert.equal(mode,expected?.mode===755?'100755':'100644',name);
    if(expected)assert.equal(createHash('sha256').update(actual).digest('hex'),expected.sha256);
   }
   assert.equal(readFileSync(env.TEST_RECORD,'utf8'),'install\nproduction-verification.mjs\nproduction-request.mjs\n');
  }
 }finally{rmSync(temp,{recursive:true,force:true});}
});
