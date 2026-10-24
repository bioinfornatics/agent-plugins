#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { determinePlatformSupport } from "./platform-support.mjs";

const buildOnly=process.argv[2]==='--build-only';
if(process.argv.length>3||process.argv[2]&&!buildOnly)throw new Error('usage: test-clean-source-reproducibility.mjs [--build-only]');
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const work=mkdtempSync(path.join(tmpdir(),"agent-plugins-clean-source-")),clean=path.join(work,"source"),emptyCache=path.join(work,"npm-cache"),home=path.join(work,"home");
const manifest=JSON.parse(readFileSync(path.join(source,"config/reproducibility/source-manifest.json"),"utf8"));
const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
const normalize=p=>p.split(path.sep).join("/");
function run(command,args,options={}){
 const env={PATH:process.env.PATH??"",HOME:home,LANG:"C",LC_ALL:"C",TZ:"UTC",SOURCE_DATE_EPOCH:"0",npm_config_cache:emptyCache,npm_config_offline:"true",npm_config_audit:"false",npm_config_fund:"false",PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:"1"};
 const result=spawnSync(command,args,{cwd:clean,stdio:"inherit",env,...options});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
}
function copyDeclared(relative){
 const from=path.join(source,relative),to=path.join(clean,relative);if(!existsSync(from))throw new Error(`required manifest file is absent: ${relative}`);const stat=lstatSync(from);if(!stat.isFile()||stat.isSymbolicLink())throw new Error(`manifest entry is not a regular file: ${relative}`);mkdirSync(path.dirname(to),{recursive:true});copyFileSync(from,to);chmodSync(to,stat.mode&0o777);
}
function copyTree(from,to){
 for(const entry of readdirSync(from,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,"en"))){const input=path.join(from,entry.name),output=path.join(to,entry.name);if(entry.isSymbolicLink())throw new Error(`vendored closure contains symlink: ${normalize(path.relative(source,input))}`);if(entry.isDirectory()){mkdirSync(output,{recursive:true});copyTree(input,output)}else if(entry.isFile()){mkdirSync(path.dirname(output),{recursive:true});copyFileSync(input,output);chmodSync(output,lstatSync(input).mode&0o777)}else throw new Error(`unsupported vendored entry: ${input}`)}
}
function inventory(directory){const rows=[];const walk=d=>{for(const e of readdirSync(d,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,"en"))){const a=path.join(d,e.name);if(e.isDirectory())walk(a);else rows.push({path:normalize(path.relative(directory,a)),sha256:digest(readFileSync(a)),mode:lstatSync(a).mode&0o777})}};walk(directory);return rows}
function snapshot(roots){return roots.flatMap(relative=>inventory(path.join(clean,relative)).map(x=>({...x,path:`${relative}/${x.path}`})))}
function installVendoredModules(destination){const modules=path.join(destination,"node_modules");rmSync(modules,{recursive:true,force:true});copyTree(path.join(clean,"vendor/build-node_modules/node_modules"),modules)}
const apps=["agent","hook","plugin","skill"],staleCanary="__stale_dist_canary__.js";
const appDistPattern=/^apps\/[^/]+-creator-cli\/dist\//;
try{
 mkdirSync(clean,{recursive:true});mkdirSync(emptyCache);mkdirSync(home);
 const required=[...new Set(manifest.requiredFiles)];if(required.length!==manifest.requiredFiles.length)throw new Error("duplicate source manifest entry");const admittedAppDist=required.filter(relative=>appDistPattern.test(relative));if(admittedAppDist.length)throw new Error(`source manifest admits generated app dist files: ${admittedAppDist.join(", ")}`);for(const relative of required)copyDeclared(relative);
 const copiedAppDist=apps.flatMap(app=>{const dist=path.join(clean,"apps",`${app}-creator-cli`,"dist");return existsSync(dist)?inventory(dist):[]});if(copiedAppDist.length)throw new Error(`clean source contains ${copiedAppDist.length} app dist files before build`);
 const embeddedViewer="apps/skill-creator-cli/eval-viewer/embedded_viewer.ts",embeddedViewerPath=path.join(clean,embeddedViewer);if(existsSync(embeddedViewerPath))throw new Error("clean source contains generated embedded_viewer.ts before build");
 run(process.execPath,["scripts/verify-repository-integrity.mjs"]);
 // Canary proves arbitrary untracked workspace content is not admitted by the explicit manifest.
 const canary=path.join(source,"arbitrary-untracked-repro-canary.txt");writeFileSync(canary,"must not be copied\n");try{if(existsSync(path.join(clean,path.basename(canary))))throw new Error("arbitrary untracked file entered clean source")}finally{rmSync(canary,{force:true})}
 // Some portable Git-install gates need repository semantics. Create metadata only after the
 // manifest projection, so Git cannot influence which source bytes entered the clean tree.
 run("git",["init","-q"]);run("git",["config","user.name","Clean Reproduction"]);run("git",["config","user.email","clean-reproduction@example.invalid"]);run("git",["add","-A"]);run("git",["commit","-qm","manifest source"]);
 run(process.execPath,["scripts/validate-change-set-inventory.mjs","--clean-projection"]);
 for(const app of apps){const appRoot=path.join(clean,"apps",`${app}-creator-cli`),dist=path.join(appRoot,"dist"),canary=path.join(dist,staleCanary);mkdirSync(dist,{recursive:true});writeFileSync(canary,"throw new Error('stale copied-tree dist survived');\n");installVendoredModules(appRoot);run(process.execPath,[path.join(appRoot,"scripts","build.mjs")],{cwd:appRoot});if(existsSync(canary))throw new Error(`${app} build retained stale dist canary`)}
 const viewer=readFileSync(path.join(clean,"apps/skill-creator-cli/eval-viewer/viewer.html"),"utf8"),expectedEmbedded=`/** Generated from viewer.html by scripts/build.mjs. Do not edit directly. */\nexport const EMBEDDED_VIEWER_HTML = ${JSON.stringify(viewer)};\n`;if(readFileSync(embeddedViewerPath,"utf8")!==expectedEmbedded)throw new Error("skill build did not deterministically recreate generated embedded_viewer.ts at its declared path before compilation");
 const contract=path.join(clean,"contracts","capability-contract");installVendoredModules(contract);run(process.execPath,[path.join(contract,"scripts","build.mjs")],{cwd:contract});run(process.execPath,[path.join(contract,"scripts","refresh-compatibility-fixtures.mjs")],{cwd:contract});
 run(process.execPath,[path.join(clean,"scripts","generate-skill-runtimes.mjs")]);
 run(process.execPath,["scripts/validate-change-set-inventory.mjs","--clean-projection"]);
 const roots=["contracts/capability-contract/fixtures/compatibility","skills/agent-creator/runtime","skills/hook-creator/runtime","skills/plugin-creator/runtime","skills/skill-creator/runtime"],first=snapshot(roots);
 run(process.execPath,[path.join(contract,"scripts","refresh-compatibility-fixtures.mjs")],{cwd:contract});run(process.execPath,[path.join(clean,"scripts","generate-skill-runtimes.mjs")]);const second=snapshot(roots);if(JSON.stringify(first)!==JSON.stringify(second))throw new Error("runtime or compatibility regeneration is not byte-stable");
 const release=JSON.parse(readFileSync(path.join(clean,"bun-release.json"),"utf8")),matrix=JSON.parse(readFileSync(path.join(clean,"config/reproducibility/platform-matrix.json"),"utf8")),key=`${process.platform}-${process.arch}`,nativeSupported=determinePlatformSupport(release,matrix,key).nativeSupported;
 if(nativeSupported&&!buildOnly){run(process.execPath,[path.join(clean,"scripts","build-bun-executables.mjs")]);const executable=path.join(clean,"release-staging",key,"skills","skill-creator","scripts",`skill-creator${process.platform==="win32"?".exe":""}`);const baseline=spawnSync(process.execPath,[path.join(clean,"apps/skill-creator-cli/dist/scripts/cli.js"),"--help"],{cwd:clean,encoding:"utf8"}),native=spawnSync(executable,["--help"],{cwd:clean,encoding:"utf8",env:{HOME:home,PATH:"",LANG:"C",LC_ALL:"C"}});if(baseline.status!==0||native.status!==0||baseline.stdout!==native.stdout||baseline.stderr!==native.stderr)throw new Error("standalone and source help differ")}
 if(!buildOnly)run(process.execPath,["scripts/test.mjs"],{env:{PATH:process.env.PATH??"",HOME:home,LANG:"C",LC_ALL:"C",TZ:"UTC",npm_config_cache:emptyCache,npm_config_offline:"true",AGENT_PLUGINS_NATIVE_PREBUILT:"1"}});
 if(buildOnly)run(process.execPath,['--test','tests/test_production.test.ts']);
 console.log(JSON.stringify({scope:buildOnly?'isolated-build-and-projection':'full',nativeTestsRun:nativeSupported&&!buildOnly,status:"passed",sourceFiles:required.length,deterministicFiles:second.length,npmCacheEntries:inventory(emptyCache).length,nativeSupported,platformExclusions:nativeSupported?0:matrix.nativeGates.length,appDistSourceFiles:0,staleDistCanariesRemoved:apps.length,arbitraryUntrackedExcluded:true}));
}finally{rmSync(work,{recursive:true,force:true})}
