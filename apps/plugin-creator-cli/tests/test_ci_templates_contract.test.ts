import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const APP_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),".."),REPO_ROOT=resolve(APP_ROOT,"../.."),PREFIX="apps/plugin-creator-cli/",SKILL_PREFIX="skills/plugin-creator/";
const TEMPLATES=new Map([
 [PREFIX+"templates/ci/goose-github-actions.yml","100644"],
 [PREFIX+"templates/ci/goose-host-adapter.mjs","100755"],
 [PREFIX+"templates/ci/plugin-creator-ci.json","100644"]
]);
function trackedSnapshot(destination:string){
 // Stage the app runtime plus the explicitly consumed portable Skill resources.
 copyFileSync(join(REPO_ROOT,"plugin.json"),join(destination,"plugin.json"));
 for(const relative of ["dist","vendor","templates"]){cpSync(join(APP_ROOT,relative),join(destination,PREFIX,relative),{recursive:true})}
 cpSync(join(REPO_ROOT,SKILL_PREFIX),join(destination,SKILL_PREFIX),{recursive:true});
 for(const [path,mode] of TEMPLATES){assert.ok(existsSync(join(destination,path)),path+" must be staged");chmodSync(join(destination,path),mode==="100755"?0o755:0o644)}
 assert.equal(existsSync(join(destination,SKILL_PREFIX,"dist")),false,"portable Skill must not contain app build output");
 assert.equal(existsSync(join(destination,SKILL_PREFIX,"node_modules")),false,"portable Skill must not contain dependencies");
}
const evidenceWriter=String.raw`
import{mkdirSync,readFileSync,writeFileSync}from'node:fs';import{join}from'node:path';import{pathToFileURL}from'node:url';
export async function writeEvidence(request){const base=join(request.plugin_path,'apps/plugin-creator-cli/dist/scripts'),{sourceHash}=await import(pathToFileURL(join(base,'package_manifest.js'))),{componentHash}=await import(pathToFileURL(join(base,'verify_plugin_gates.js'))),i=join(request.workspace,'integration'),c=join(request.workspace,'components','skill','plugin-creator');mkdirSync(i,{recursive:true});mkdirSync(c,{recursive:true});writeFileSync(join(c,'receipt.json'),JSON.stringify({schema_version:'1.0',artifact:'skill',name:'plugin-creator',status:'pass',source_sha256:componentHash(join(request.plugin_path,'skills/plugin-creator'))}));writeFileSync(join(i,'benchmark.json'),JSON.stringify({metadata:{evaluated_source_sha256:sourceHash(request.plugin_path)},run_summary:{with_skill:{pass_rate:{mean:1}},without_skill:{pass_rate:{mean:0}}}}));writeFileSync(join(i,'review.html'),'<html><body>offline review evidence</body></html>')}
`;
function runCli(root:string,config:string,env:NodeJS.ProcessEnv){return spawnSync(process.execPath,[join(root,PREFIX,"dist/scripts/cli.js"),"ci-eval","--config",config,"--format","json"],{cwd:root,encoding:"utf8",env})}
function expectPending(run:ReturnType<typeof spawnSync>){assert.equal(run.status,4,run.stderr?.toString()||run.stdout?.toString());const out=JSON.parse(String(run.stdout));assert.equal(out.status,"pending-approval");assert.equal(out.exit_code,4)}

test("tracked CI templates run both documented workflows from an archive-equivalent offline distribution",()=>{
 const root=mkdtempSync(join(tmpdir(),"plugin-creator-archive-"));trackedSnapshot(root);const ciDir=join(root,PREFIX,"templates/ci"),writer=join(root,"write-evidence.mjs");writeFileSync(writer,evidenceWriter);
 const canonical=JSON.parse(readFileSync(join(ciDir,"plugin-creator-ci.json"),"utf8"));assert.deepEqual(canonical.host.environment,["GOOSE_CI_VERIFIED_MODELS","GOOSE_PROVIDER","GOOSE_MODEL"]);

 const fakeHost=join(root,"fake-host.mjs");writeFileSync(fakeHost,`import{readFileSync}from'node:fs';import{writeEvidence}from'./write-evidence.mjs';const phase=process.argv[2],request=JSON.parse(readFileSync(process.argv[4],'utf8'));if(process.env.FORWARDED_SENTINEL!=='yes'||process.env.LEAKED_SENTINEL)process.exit(9);if(phase==='preflight')console.log(JSON.stringify({status:'ready',capabilities:['non-interactive','plugin-evaluation'],models:['offline-model']}));else{await writeEvidence(request);console.log(JSON.stringify({status:'pass'}))}`);
 const neutral=structuredClone(canonical);neutral.host={command:process.execPath,args:[fakeHost],required_credentials:[],required_models:["offline-model"],required_capabilities:["non-interactive","plugin-evaluation"],environment:["FORWARDED_SENTINEL"]};neutral.limits={timeout_ms:5000,max_output_bytes:1048576,total_budget_ms:10000};neutral.cache={enabled:false,resume:false};const neutralPath=join(root,"provider-neutral.json");writeFileSync(neutralPath,JSON.stringify(neutral));expectPending(runCli(root,neutralPath,{PATH:"",HOME:root,FORWARDED_SENTINEL:"yes",LEAKED_SENTINEL:"must-not-pass",HTTP_PROXY:"http://127.0.0.1:1",HTTPS_PROXY:"http://127.0.0.1:1"}));

 const bin=mkdtempSync(join(tmpdir(),"plugin-creator-goose-bin-"));symlinkSync(process.execPath,join(bin,"node"));const goose=join(bin,"goose"),writerUrl=pathToFileURL(writer).href;writeFileSync(goose,`#!/usr/bin/env node\nimport{readFileSync}from'node:fs';import{writeEvidence}from${JSON.stringify(writerUrl)};if(process.argv.includes('--version')){if(process.env.GOOSE_CI_VERIFIED_MODELS!=='evaluation-model'||process.env.GOOSE_PROVIDER!=='fake'||process.env.GOOSE_MODEL!=='evaluation-model'||process.env.PROVIDER_API_KEY!=='offline-secret'||process.env.LEAKED_SENTINEL)process.exit(9);console.log('fake-goose 1.0');process.exit(0)}const prompt=readFileSync(0,'utf8'),m=/Evaluate the plugin at (.+)\. Write all required typed receipts, benchmark\.json, and review\.html under (.+)\. Do not prompt/.exec(prompt);if(!m)process.exit(8);await writeEvidence({plugin_path:m[1],workspace:m[2]});process.exit(0)`,{mode:0o755});chmodSync(goose,0o755);
 const gooseConfig=join(root,"goose.json");copyFileSync(join(ciDir,"plugin-creator-ci.json"),gooseConfig);expectPending(runCli(root,gooseConfig,{PATH:bin,HOME:root,PROVIDER_API_KEY:"offline-secret",GOOSE_CI_VERIFIED_MODELS:"evaluation-model",GOOSE_PROVIDER:"fake",GOOSE_MODEL:"evaluation-model",LEAKED_SENTINEL:"must-not-pass",HTTP_PROXY:"http://127.0.0.1:1",HTTPS_PROXY:"http://127.0.0.1:1"}));
});
