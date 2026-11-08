#!/usr/bin/env node
/** Publish only a locally verified production projection, with optimistic Git guards. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyProduction, smokeProduction } from './production.mjs';
import { verifyFrozenCandidate } from './frozen-candidate.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),remote=args[0],expected=args[1],candidate=args[2],write=args[3];
if(!remote||!/^[a-f0-9]{40}$/.test(expected)||!candidate||args.length>4||write&&write!=='--push')throw new Error('usage: promote-production.mjs <remote> <expected-main-sha> <frozen-candidate-directory> [--push]');
const git=(a,options={})=>execFileSync('git',a,{cwd:root,encoding:'utf8',...options}).trim();
const source=git(['rev-parse','HEAD']);
const sourceBranch=git(['branch','--show-current']);
if(!['develop'].includes(sourceBranch)||git(['status','--porcelain']))throw new Error('promotion requires clean develop branch');
git(['fetch',remote,'main',sourceBranch]);
if(git(['rev-parse',remote+'/'+sourceBranch])!==source)throw new Error('source branch commit must already be pushed');
if(git(['rev-parse',remote+'/main'])!==expected)throw new Error('remote main changed before verification');
const work=mkdtempSync(path.join(tmpdir(),'production-promotion-'));
try{
 const {production:first}=verifyFrozenCandidate(candidate,source);
 if(verifyProduction(first).sourceTree!==git(['rev-parse','HEAD^{tree}']))throw Error('frozen production source tree mismatch');
 verifyProduction(first);smokeProduction(first);
 const check=spawnSync(process.execPath,[path.join(root,'scripts/test-production-install.mjs'),first],{cwd:root,stdio:'inherit'});if(check.status!==0)throw new Error('production Git installation gate failed');
 verifyFrozenCandidate(candidate,source);
 // Temporary index preserves the real source index and worktree.
 const env={...process.env,GIT_INDEX_FILE:path.join(work,'index'),GIT_WORK_TREE:first};
 git(['read-tree','--empty'],{env});git(['add','-A'],{env});
 const frozen=verifyFrozenCandidate(candidate,source).manifest.production;
 const manifestBytes=readFileSync(path.join(first,'distribution-manifest.json'));
 const expectedFiles=[...frozen.files,{path:'distribution-manifest.json',mode:644,size:manifestBytes.length,sha256:createHash('sha256').update(manifestBytes).digest('hex')}];
 const staged=git(['ls-files','--stage','-z'],{env}).split('\0').filter(Boolean);
 if(staged.length!==expectedFiles.length)throw Error('staged frozen inventory mismatch');
 for(const entry of staged){
  const match=/^(100644|100755) ([a-f0-9]{40}) 0\t(.+)$/.exec(entry);
  const row=match&&expectedFiles.find(file=>file.path===match[3]);
  if(!row||Number(match[1])!==(row.mode===755?100755:100644))throw Error('staged frozen path/mode mismatch');
  const bytes=execFileSync('git',['cat-file','blob',match[2]],{cwd:root,env,maxBuffer:8*1024*1024});
  if(bytes.length!==row.size||createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw Error('staged frozen bytes mismatch');
 }
 const tree=git(['write-tree'],{env});
 const commit=git(['commit-tree',tree,'-p',expected,'-m','build: promote verified '+sourceBranch+' '+source]);
 const ref='refs/heads/candidate/production-'+source.slice(0,12);git(['update-ref',ref,commit,'0000000000000000000000000000000000000000']);
 const current=git(['ls-remote',remote,'refs/heads/main']).split(/\s/)[0];if(current!==expected)throw new Error('remote main changed after verification');
 const currentSource=git(['ls-remote',remote,'refs/heads/'+sourceBranch]).split(/\s/)[0];if(currentSource!==source)throw new Error('remote source changed after verification');
 if(write){
  if(!process.env.PR_NUMBER||process.env.VERIFIED_SHA!==source||!process.env.CANDIDATE_ARTIFACT_ID||!process.env.CANDIDATE_ARTIFACT_DIGEST||!process.env.CANDIDATE_RUN_ID||!process.env.CANDIDATE_RUN_ATTEMPT)throw Error('publication requires pinned proof and approval inputs');
  execFileSync(process.execPath,[path.join(root,'scripts/production-verification.mjs'),source],{cwd:root,stdio:'inherit'});
  execFileSync(process.execPath,[path.join(root,'scripts/production-request.mjs'),process.env.PR_NUMBER,expected,source],{cwd:root,stdio:'inherit'});
  if(git(['ls-remote',remote,'refs/heads/main']).split(/\s/)[0]!==expected||git(['ls-remote',remote,'refs/heads/develop']).split(/\s/)[0]!==source)throw Error('remote identity changed before push');
  git(['push',remote,ref+':refs/heads/main']);
 }
 console.log(JSON.stringify({status:write?'promoted':'verified-candidate',sourceCommit:source,previousMain:expected,productionCommit:commit,candidateRef:ref,pushed:Boolean(write)}));
}finally{rmSync(work,{recursive:true,force:true});}
