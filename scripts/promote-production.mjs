#!/usr/bin/env node
/** Publish only a locally verified production projection, with optimistic Git guards. */
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { projectProduction, verifyProduction, smokeProduction } from './production.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),remote=args[0],expected=args[1],write=args[2];
if(!remote||!/^[a-f0-9]{40}$/.test(expected)||write&&write!=='--push')throw new Error('usage: promote-production.mjs <remote> <expected-main-sha> [--push]');
const git=(a,options={})=>execFileSync('git',a,{cwd:root,encoding:'utf8',...options}).trim();
const source=git(['rev-parse','HEAD']);
const sourceBranch=git(['branch','--show-current']);
if(!['development','develop'].includes(sourceBranch)||git(['status','--porcelain']))throw new Error('promotion requires clean development or develop branch');
git(['fetch',remote,'main',sourceBranch]);
if(git(['rev-parse',remote+'/'+sourceBranch])!==source)throw new Error('source branch commit must already be pushed');
if(git(['rev-parse',remote+'/main'])!==expected)throw new Error('remote main changed before verification');
const work=mkdtempSync(path.join(tmpdir(),'production-promotion-'));
try{
 const first=path.join(work,'first'),second=path.join(work,'second');
 projectProduction(first);projectProduction(second);
 if(readFileSync(path.join(first,'distribution-manifest.json'),'utf8')!==readFileSync(path.join(second,'distribution-manifest.json'),'utf8'))throw new Error('nondeterministic production');
 verifyProduction(first);smokeProduction(first);
 const check=spawnSync(process.execPath,[path.join(root,'scripts/test-production-install.mjs'),first],{cwd:root,stdio:'inherit'});if(check.status!==0)throw new Error('production Git installation gate failed');
 // Temporary index preserves the real source index and worktree.
 const env={...process.env,GIT_INDEX_FILE:path.join(work,'index'),GIT_WORK_TREE:first};
 git(['read-tree','--empty'],{env});git(['add','-A'],{env});const tree=git(['write-tree'],{env});
 const commit=git(['commit-tree',tree,'-p',expected,'-m','build: promote verified '+sourceBranch+' '+source]);
 const ref='refs/heads/candidate/production-'+source.slice(0,12);git(['update-ref',ref,commit,'0000000000000000000000000000000000000000']);
 const current=git(['ls-remote',remote,'refs/heads/main']).split(/\s/)[0];if(current!==expected)throw new Error('remote main changed after verification');
 if(write){git(['push',remote,ref+':refs/heads/main']);}
 console.log(JSON.stringify({status:write?'promoted':'verified-candidate',sourceCommit:source,previousMain:expected,productionCommit:commit,candidateRef:ref,pushed:Boolean(write)}));
}finally{rmSync(work,{recursive:true,force:true});}
