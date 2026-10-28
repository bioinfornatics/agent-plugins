#!/usr/bin/env node
/** Trusted base-tree code only. PR source is API data, never code or artifacts to execute. */
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {validateRequestIdentity} from './production-request.mjs';
import {awaitCanonicalVerification} from './production-verification.mjs';
export async function verifyPromotionPreflight({number,repository,source,main,api,verify=awaitCanonicalVerification,waitSeconds=0}) {
 if(!/^[1-9][0-9]*$/.test(String(number))||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository??'')||![source,main].every(s=>/^[a-f0-9]{40}$/.test(s??'')))throw Error('invalid promotion preflight inputs');
 const check=()=>validateRequestIdentity(api('pulls/'+number),repository,main,api('branches/develop').commit.sha,api('branches/main').commit.sha,source);
 check();
 const proof=await verify({source,repository,api,waitSeconds});
 check();
 return {sourceCommit:source,baseCommit:main,verification:proof,authority:'informational only; publication still requires approval'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const {PR_NUMBER:number,GITHUB_REPOSITORY:repository,EXPECTED_SOURCE:source,EXPECTED_MAIN:main}=process.env;
 if(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==main)throw Error('preflight must execute from exact trusted base checkout');
 const api=(endpoint,paginate=false)=>JSON.parse(execFileSync('gh',['api',...(paginate?['--paginate','--slurp']:[]),'repos/'+repository+(endpoint?'/'+endpoint:'')],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024}));
 console.log(JSON.stringify(await verifyPromotionPreflight({number,repository,source,main,api,waitSeconds:1500})));
}
