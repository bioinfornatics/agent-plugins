import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { classifyPlatformGates } from "./platform-support.mjs";

const profile=process.argv[2]??'--profile=full';
if(process.argv.length>3||!['--profile=full','--profile=production'].includes(profile))throw new Error('usage: test.mjs [--profile=full|--profile=production]');
const full=profile==='--profile=full';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."),creatorNames=["skill","agent","hook","plugin"],contractRoot=path.join(root,"contracts","capability-contract");
const release=JSON.parse(readFileSync(path.join(root,"bun-release.json"),"utf8")),matrix=JSON.parse(readFileSync(path.join(root,"config/reproducibility/platform-matrix.json"),"utf8")),platformKey=`${process.platform}-${process.arch}`,platformPlan=classifyPlatformGates(release,matrix,platformKey),nativeSupported=platformPlan.nativeSupported;
const exclusions=[...platformPlan.exclusions];
const deliverableStatus=()=>execFileSync("git",["status","--porcelain=v1"],{cwd:root,encoding:"utf8"}).split("\n").filter(line=>line&&!line.slice(3).startsWith(".beads/")).sort().join("\n");
const initialDeliverableStatus=deliverableStatus();
process.on("exit",()=>{const finalStatus=deliverableStatus();if(finalStatus!==initialDeliverableStatus){console.error("test runner changed working-tree status outside Beads\n--- before ---\n"+initialDeliverableStatus+"\n--- after ---\n"+finalStatus);process.exitCode=1;}});
function run(args,cwd=root,env=process.env){const result=spawnSync(process.execPath,args,{cwd,stdio:"inherit",env});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1)}
function gate(label,args,cwd=root){console.log(`\n> ${label}`);run(args,cwd)}
gate("Verifying repository vendored dependency integrity",[path.join(root,"scripts","verify-repository-integrity.mjs")]);
if(nativeSupported&&process.env.AGENT_PLUGINS_NATIVE_PREBUILT!=="1")gate("Building standalone executables required by supported release-profile package tests",[path.join(root,"scripts","build-bun-executables.mjs")]);
else if(!nativeSupported) console.log("Native gates excluded for unsupported platform "+platformKey+"; portable gates remain mandatory.");
gate("Testing capability contract",[path.join(contractRoot,"scripts","test.mjs")],contractRoot);
for(const name of creatorNames)gate(`Testing ${name}-creator`,[path.join(root,"apps",`${name}-creator-cli`,"scripts","test.mjs")],path.join(root,"apps",`${name}-creator-cli`));
gate("Testing tracked per-Skill runtime generation",["--test",path.join(root,"tests","test_skill_runtime_generation.test.ts")]);
gate("Checking tracked app dist drift",[path.join(root,"scripts","check-skill-runtime-dist-drift.mjs")]);
gate("Testing distribution",["--test",path.join(root,"tests","test_distribution.test.ts")]);
gate("Testing isolated Goose 1.47 Git install and local update",["--test",path.join(root,"tests","test_goose_git_install.test.ts")]);
gate("Testing developer facade and installer safety",["--test",path.join(root,"tests","test_developer_facade.test.ts")]);
gate("Testing generated-output cleanup safety and reproducibility contracts",["--test",path.join(root,"tests","test_clean.test.ts"),path.join(root,"tests","test_reproducibility_contract.test.ts"),path.join(root,"tests","test_production.test.ts")]);
if(nativeSupported){gate("Testing standalone Bun executables",["--test",path.join(root,"tests","test_bun_executables.test.ts")]);if(full)gate("Testing release packaging",["--test",path.join(root,"tests","test_release_packaging.test.ts")]);const bun=process.env.BUN_EXECUTABLE||"bun",workflow=spawnSync(bun,["test",path.join(root,"tests","test_bun_release_workflow.test.ts")],{cwd:root,stdio:"inherit",env:process.env});if(workflow.status!==0)process.exit(workflow.status??1);gate("Testing offline bundle",[path.join(root,"scripts","test-offline-bundle.mjs")])}
else { // The workflow contract itself is portable even when native execution is excluded.
 const bun=process.env.BUN_EXECUTABLE||"bun",workflow=spawnSync(bun,["test",path.join(root,"tests","test_bun_release_workflow.test.ts")],{cwd:root,stdio:"inherit",env:process.env});if(workflow.status!==0)process.exit(workflow.status??1);
}
const reportDirectory=mkdtempSync(path.join(tmpdir(),"agent-plugins-platform-report-"));
try{writeFileSync(path.join(reportDirectory,"platform-exclusions.json"),JSON.stringify({schemaVersion:1,platform:platformKey,nativeSupported,exclusions},null,2)+"\n");}finally{rmSync(reportDirectory,{recursive:true,force:true});}
console.log(JSON.stringify({status:"passed",platform:platformKey,nativeSupported,portableGates:"passed",profile:full?"full":"production",deferredGates:full?[]:["five-platform-release-packaging"],platformExclusions:exclusions}));
