#!/usr/bin/env node
/** Reuse only completed canonical push/develop verification for the exact source.
 * GitHub Actions job metadata is the authority; caller-supplied artifacts are not.
 */
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export const requiredJobs=['quick','remaining','skill-1','skill-2','skill-3','skill-4','verify'];
const workflowPath='.github/workflows/development-ci.yml';
export function selectCanonicalRun(runs,{repository,repositoryId,workflowId,source}){
 if(!/^[a-f0-9]{40}$/.test(source)||!Number.isSafeInteger(repositoryId)||!Number.isSafeInteger(workflowId))throw Error('invalid verification identity');
 const canonical=runs.filter(r=>r.event==='push'&&r.head_branch==='develop'&&r.head_sha===source&&r.workflow_id===workflowId&&r.repository?.id===repositoryId&&r.repository?.full_name===repository&&r.head_repository?.id===repositoryId&&r.head_repository?.full_name===repository&&r.path===workflowPath);
 if(!canonical.length)return null;
 canonical.sort((a,b)=>b.id-a.id);const r=canonical[0];
 if(!Number.isSafeInteger(r.id)||!Number.isSafeInteger(r.run_attempt)||r.run_attempt<1)throw Error('invalid canonical run');
 if(r.status!=='completed')return {state:'pending',run:r};
 if(r.conclusion!=='success')throw Error('canonical verification failed; repair source before promotion');
 return {state:'success',run:r};
}
export function validateCanonicalJobs(jobs,run){
 if(!Array.isArray(jobs)||jobs.length!==requiredJobs.length)throw Error('missing or unexpected verification jobs');
 const names=jobs.map(j=>j.name).sort();if(JSON.stringify(names)!==JSON.stringify([...requiredJobs].sort()))throw Error('missing or duplicate required jobs');
 if(jobs.some(j=>j.status!=='completed'||j.conclusion!=='success'||j.run_id!==run.id||j.run_attempt!==run.run_attempt||j.head_sha!==run.head_sha))throw Error('incomplete, foreign or stale-attempt verification job');
 return true;
}
export async function awaitCanonicalVerification({source,repository,api,waitSeconds=0,pollSeconds=20,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>Date.now()}){
 if(!/^[a-f0-9]{40}$/.test(source??'')||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository??'')||!Number.isFinite(waitSeconds)||waitSeconds<0||waitSeconds>1500||!Number.isFinite(pollSeconds)||pollSeconds<=0||pollSeconds>60)throw Error('invalid canonical verification request');
 const metadata=api(''),workflow=api('actions/workflows/development-ci.yml');
 if(metadata.full_name!==repository||workflow.path!==workflowPath||workflow.state!=='active')throw Error('wrong repository or workflow');
 const started=now();
 const sourceWorkflow=api('contents/'+workflowPath+'?ref='+source);
 if(sourceWorkflow.type!=='file'||sourceWorkflow.encoding!=='base64'||typeof sourceWorkflow.content!=='string')throw Error('source workflow unavailable');
 const workflowSha256=createHash('sha256').update(Buffer.from(sourceWorkflow.content.replace(/\s/g,''),'base64')).digest('hex');
 while(true){
  if(api('branches/develop').commit.sha!==source)throw Error('source moved while awaiting verification');
  const pages=api('actions/workflows/'+workflow.id+'/runs?event=push&head_sha='+source+'&per_page=100',true);
  const runs=pages.flatMap(p=>p.workflow_runs??[]),selected=selectCanonicalRun(runs,{repository,repositoryId:metadata.id,workflowId:workflow.id,source});
  if(selected?.state==='success'){
   const run=selected.run;
   const pages=api('actions/runs/'+run.id+'/attempts/'+run.run_attempt+'/jobs?per_page=100',true);
   validateCanonicalJobs(pages.flatMap(p=>p.jobs??[]),run);
   // Reruns/source changes during the read invalidate the proof.
   const current=api('actions/runs/'+run.id);
   const latest=selectCanonicalRun(api('actions/workflows/'+workflow.id+'/runs?event=push&head_sha='+source+'&per_page=100',true).flatMap(p=>p.workflow_runs??[]),{repository,repositoryId:metadata.id,workflowId:workflow.id,source});
   if(latest?.state!=='success'||latest.run.id!==run.id||latest.run.run_attempt!==run.run_attempt)throw Error('new canonical run superseded verification');
   if(selectCanonicalRun([current],{repository,repositoryId:metadata.id,workflowId:workflow.id,source})?.state!=='success'||current.run_attempt!==run.run_attempt||api('branches/develop').commit.sha!==source)throw Error('verification changed during proof resolution');
   return {schemaVersion:1,sourceCommit:source,repository,workflowPath,workflowSha256,runId:run.id,runAttempt:run.run_attempt,jobs:requiredJobs,authority:'GitHub canonical push/develop run, exact source; not independent review'};
  }
  if(now()-started>=waitSeconds*1000)throw Error(selected?'canonical verification still pending':'canonical verification missing');
  await sleep(pollSeconds*1000);
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [source,wait,...extra]=process.argv.slice(2);if(extra.length||!source||wait!==undefined&&!/^\d+$/.test(wait))throw Error('usage: production-verification.mjs <source-sha> [wait-seconds]');
 const repository=process.env.GITHUB_REPOSITORY;
 if(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==source)throw Error('verification guard must execute from exact source checkout');
 const api=(endpoint,paginate=false)=>JSON.parse(execFileSync('gh',['api',...(paginate?['--paginate','--slurp']:[]),'repos/'+repository+(endpoint?'/'+endpoint:'')],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024}));
 const proof=await awaitCanonicalVerification({source,repository,api,waitSeconds:wait===undefined?0:Number(wait)});
 if(proof.workflowSha256!==createHash('sha256').update(readFileSync(workflowPath)).digest('hex'))throw Error('executed workflow differs from exact source');
 console.log(JSON.stringify(proof));
 if(process.env.GITHUB_OUTPUT){const {appendFileSync}=await import('node:fs');appendFileSync(process.env.GITHUB_OUTPUT,'source_sha='+source+'\nverification_run='+proof.runId+'\n');}
}
