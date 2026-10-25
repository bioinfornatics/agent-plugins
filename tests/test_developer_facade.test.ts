import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, linkSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
const root=path.join(import.meta.dirname,".."),work=mkdtempSync(path.join(tmpdir(),"facade-install-test-")),stage=path.join(work,"stage"),destination=path.join(work,"installed");
const config=JSON.parse(readFileSync(path.join(root,"bun-release.json"),"utf8")),releaseKey=process.platform+"-"+process.arch;
const run=(command:string,args:string[],cwd=root)=>spawnSync(command,args,{cwd,encoding:"utf8",timeout:30000});
const dryMake=(target:string,variables:string[]=[])=>{const result=run("make",["--no-print-directory","-n",target,...variables]);assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
function inventory(directory:string,base=directory):any[]{const rows:any[]=[];for(const entry of readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,"en"))){const absolute=path.join(directory,entry.name),relative=path.relative(base,absolute).split(path.sep).join("/"),stat=lstatSync(absolute);if(entry.isDirectory())rows.push(...inventory(absolute,base));else rows.push({path:relative,mode:(stat.mode&0o777).toString(8).padStart(3,"0"),size:stat.size,sha256:createHash("sha256").update(readFileSync(absolute)).digest("hex")});}return rows;}
function packageManifests(directory:string):string[]{const manifests:string[]=[];for(const entry of readdirSync(directory,{withFileTypes:true})){if(entry.isDirectory()&&[".git","node_modules","vendor"].includes(entry.name))continue;const absolute=path.join(directory,entry.name);if(entry.isDirectory())manifests.push(...packageManifests(absolute));else if(entry.name==="package.json")manifests.push(absolute);}return manifests;}
before(()=>{mkdirSync(path.join(stage,"skills","example","scripts"),{recursive:true});writeFileSync(path.join(stage,"plugin.json"),JSON.stringify({name:"agent-plugins"}));const executable=path.join(stage,"skills","example","scripts","example"+(process.platform==="win32"?".exe":""));writeFileSync(executable,"fixture");if(process.platform!=="win32")chmodSync(executable,0o755);const manifest={schemaVersion:1,runtimeMode:"native-bun",releaseKey,bunTarget:config.targets[releaseKey],bunVersion:config.bunVersion,files:inventory(stage)};writeFileSync(path.join(stage,"release-manifest.json"),JSON.stringify(manifest,null,2)+"\n");});
after(()=>rmSync(work,{recursive:true,force:true}));
test("developer facade uses the pinned Bun version",()=>{const packageJson=JSON.parse(readFileSync(path.join(root,"package.json"),"utf8"));assert.equal(config.bunVersion,"1.3.12");assert.equal(packageJson.packageManager,"bun@1.3.12");assert.equal(packageJson.engines.bun,"=1.3.12");const version=run("bun",["--version"]);assert.equal(version.status,0,version.stderr);assert.equal(version.stdout.trim(),config.bunVersion);});
test("all first-party package scripts use Bun for package-script chaining",()=>{const manifests=packageManifests(root);assert.ok(manifests.length>1);for(const manifest of manifests){const packageJson=JSON.parse(readFileSync(manifest,"utf8"));for(const [name,script] of Object.entries(packageJson.scripts??{}))assert.doesNotMatch(String(script),/\bnpm(?:\s|$)/,`${path.relative(root,manifest)} script ${name}`);}});
test("Make facade advertises explicit plugin commands and destinations",()=>{const help=run("make",["help"]);assert.equal(help.status,0,help.stderr);assert.match(help.stdout,/Bun/);for(const target of ["clean","test","bundle","release","install-plugin","bundle-install-plugin"])assert.ok(help.stdout.includes("make "+target));assert.match(help.stdout,/full plugin staging -> \.agents\/plugins/);assert.match(help.stdout,/Standalone \.skill artifacts belong under \.agents\/skills/);assert.match(help.stdout,/does not install them/);const makefile=readFileSync(path.join(root,"Makefile"),"utf8");assert.doesNotMatch(makefile,/\bnpm(?:\s|$)/m);assert.equal(dryMake("clean"),"bun run clean");assert.equal(dryMake("test"),"bun run test");assert.match(dryMake("bundle"),/Bundle plugin[\s\S]*bun run --silent bundle -- --format human --progress creators/);assert.equal(dryMake("release"),"bun run release --");assert.match(dryMake("install-plugin"),/Install plugin[\s\S]*bun run --silent install:plugin -- --format human --progress creators/);const packageJson=JSON.parse(readFileSync(path.join(root,"package.json"),"utf8"));assert.equal(packageJson.scripts["install:plugin"],"node scripts/install-staged-plugin.mjs");assert.equal(packageJson.scripts["install:staged"],undefined);});
test("canonical plugin install forwards arguments after Bun's separator",()=>{assert.equal(dryMake("release",["OUTPUT=/tmp/release output"]),'bun run release -- --output "/tmp/release output"');assert.match(dryMake("install-plugin",["SOURCE=/tmp/source tree","DEST=/tmp/destination tree","DRY_RUN=1","FORCE=1"]),/bun run --silent install:plugin -- --format human --progress creators --source "\/tmp\/source tree" --destination "\/tmp\/destination tree" --dry-run --force$/);});

test("bundle-install-plugin bundles before install without forwarding SOURCE",()=>{const output=dryMake("bundle-install-plugin",["SOURCE=/tmp/stale source","DEST=/tmp/local destination","DRY_RUN=1","FORCE=1"]);const bundle=output.indexOf("bun run --silent bundle"),install=output.indexOf("bun run --silent install:plugin");assert.ok(bundle>=0,output);assert.ok(install>bundle,output);assert.doesNotMatch(output,/--source/);assert.match(output,/--destination "\/tmp\/local destination" --dry-run --force/);});

function installStubCase(target:string){const suffix=target.replace(/[^a-z]/g,"-"),bin=path.join(work,"stub-bin-"+suffix),log=path.join(work,"make-"+suffix+".log"),stub=path.join(bin,"bun");mkdirSync(bin,{recursive:true});writeFileSync(stub,'#!/bin/sh\nset -eu\ncase "$*" in\n  "run --silent bundle --"*) printf "%s\\n" bundle-start >> "$MAKE_J_LOG"; sleep 0.2; printf "%s\\n" bundle-end >> "$MAKE_J_LOG" ;;\n  "run --silent install:plugin --"*) grep -qx bundle-end "$MAKE_J_LOG" || { printf "%s\\n" install-raced >> "$MAKE_J_LOG"; exit 42; }; printf "install %s\\n" "$*" >> "$MAKE_J_LOG" ;;\n  *) exit 43 ;;\nesac\n');chmodSync(stub,0o755);const result=spawnSync("make",["--no-print-directory","-j8",target,"SOURCE=/tmp/must-not-forward","DEST=/tmp/safe-destination","DRY_RUN=1","FORCE=1"],{cwd:root,encoding:"utf8",timeout:30000,env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,MAKE_J_LOG:log}});assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,"");const lines=readFileSync(log,"utf8").trim().split("\n");assert.deepEqual(lines.slice(0,2),["bundle-start","bundle-end"]);assert.match(lines[2],/^install run --silent install:plugin -- /);assert.match(lines[2],/--destination \/tmp\/safe-destination --dry-run --force$/);assert.doesNotMatch(lines[2],/--source/);}
test("canonical bundle install cannot race under parallel Make",{skip:process.platform==="win32"},()=>installStubCase("bundle-install-plugin"));
test("unpublished Make install aliases are absent and unknown",()=>{const makefile=readFileSync(path.join(root,"Makefile"),"utf8"),help=run("make",["help"]);for(const target of ["install","install-local","install-plugin-local"]){assert.doesNotMatch(makefile,new RegExp("(^|\\n)"+target.replaceAll("-","\\-")+"\\s*:"));assert.doesNotMatch(help.stdout,new RegExp("^\\s*make "+target.replaceAll("-","\\-")+"(?:\\s|$)","m"));const result=spawnSync("make",["--no-print-directory","-n",target],{cwd:root,encoding:"utf8",env:{...process.env,LC_ALL:"C",LANG:"C"}});assert.notEqual(result.status,0,`${target} unexpectedly resolved`);assert.match(result.stderr,/No rule to make target/);}});
test("installer help and dry-run do not write",()=>{const help=run(process.execPath,["scripts/install-staged-plugin.mjs","--help"]);assert.equal(help.status,0);assert.match(help.stdout,/--dry-run/);assert.match(help.stdout,/project-local|\.agents\/plugins/);const result=run(process.execPath,["scripts/install-staged-plugin.mjs","--source",stage,"--destination",destination,"--dry-run"]);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).status,"dry-run");assert.equal(lstatSync(destination,{throwIfNoEntry:false}),undefined);const fakeHome=path.join(work,"home");const local=spawnSync(process.execPath,["scripts/install-staged-plugin.mjs","--source",stage,"--dry-run","--force"],{cwd:root,encoding:"utf8",env:{...process.env,HOME:fakeHome}});assert.equal(local.status,0,local.stderr);assert.equal(JSON.parse(local.stdout).destination,path.join(root,".agents","plugins","agent-plugins"));assert.equal(lstatSync(fakeHome,{throwIfNoEntry:false}),undefined);});
test("plugin installation never mutates the standalone skills destination",()=>{const agents=path.join(work,"isolated-agents"),skills=path.join(agents,"skills"),plugin=path.join(agents,"plugins","agent-plugins"),sentinel=path.join(skills,"example.skill");mkdirSync(skills,{recursive:true});writeFileSync(sentinel,"standalone-skill");const result=run(process.execPath,["scripts/install-staged-plugin.mjs","--source",stage,"--destination",plugin]);assert.equal(result.status,0,result.stderr);assert.equal(readFileSync(sentinel,"utf8"),"standalone-skill");assert.equal(readdirSync(skills).join(","),"example.skill");assert.equal(JSON.parse(readFileSync(path.join(plugin,"plugin.json"),"utf8")).name,"agent-plugins");});
test("installer validates, refuses overwrite, and force replaces",()=>{let result=run(process.execPath,["scripts/install-staged-plugin.mjs","--source",stage,"--destination",destination]);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(readFileSync(path.join(destination,"plugin.json"),"utf8")).name,"agent-plugins");writeFileSync(path.join(destination,"marker"),"keep");result=run(process.execPath,["scripts/install-staged-plugin.mjs","--source",stage,"--destination",destination]);assert.notEqual(result.status,0);assert.match(result.stderr,/already exists/);assert.equal(readFileSync(path.join(destination,"marker"),"utf8"),"keep");result=run(process.execPath,["scripts/install-staged-plugin.mjs","--source",stage,"--destination",destination,"--force"]);assert.equal(result.status,0,result.stderr);assert.equal(lstatSync(path.join(destination,"marker"),{throwIfNoEntry:false}),undefined);});
test("installer rejects tampering",()=>{const plugin=path.join(stage,"plugin.json"),original=readFileSync(plugin,"utf8");writeFileSync(plugin,"tampered");const result=run(process.execPath,["scripts/install-staged-plugin.mjs","--source",stage,"--destination",path.join(work,"bad")]);assert.notEqual(result.status,0);assert.match(result.stderr,/checksum validation/);writeFileSync(plugin,original);});

test("direct scripts retain JSON output by default",()=>{const install=run(process.execPath,["scripts/install-staged-plugin.mjs","--source",stage,"--destination",path.join(work,"json-destination"),"--dry-run"]);assert.equal(install.status,0,install.stderr);assert.equal(JSON.parse(install.stdout).status,"dry-run");assert.equal(install.stderr,"");const bundle=run(process.execPath,["scripts/build-bun-executables.mjs"]);assert.equal(bundle.status,0,bundle.stderr);assert.equal(JSON.parse(bundle.stdout).status,"staged");assert.equal(bundle.stderr,"");});

test("normal Make bundle has stable human progress and no package noise",()=>{const result=run("make",["--no-print-directory","bundle"]);assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,"");assert.match(result.stdout,/^\[1\/1\] Bundle plugin\n  \[1\/4\] skill-creator\n  \[2\/4\] agent-creator\n  \[3\/4\] hook-creator\n  \[4\/4\] plugin-creator\nStaged: release-staging\/[^\n]+\n$/);for(const noise of ["Entering directory","Leaving directory","bun run","$ node","modules","sha256","tmp-"])assert.ok(!result.stdout.includes(noise),result.stdout);});

test("VERBOSE streams compiler detail while normal mode suppresses it",()=>{const result=run("make",["--no-print-directory","bundle","VERBOSE=1"]);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/bundle\s+\d+ modules/);assert.match(result.stdout,/compile/);});

test("normal Make install is concise, silent on stderr, and creates no log",()=>{const dest=path.join(work,"human-destination"),result=run("make",["--no-print-directory","install-plugin",`SOURCE=${stage}`,`DEST=${dest}`,"DRY_RUN=1"]);assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,"");assert.equal(result.stdout,`[1/1] Install plugin\nWould install: ${path.relative(root,dest).split(path.sep).join("/")}\n`);for(const noise of ["Entering directory","Leaving directory","$ node","sha256","tmp-"])assert.ok(!result.stdout.includes(noise),result.stdout);assert.equal(lstatSync(path.join(work,"unexpected.log"),{throwIfNoEntry:false}),undefined);});

test("LOG captures details and failures include a hint",()=>{const log=path.join(work,"logs","install.log"),dest=path.join(work,"logged-destination"),ok=run("make",["--no-print-directory","install-plugin",`SOURCE=${stage}`,`DEST=${dest}`,"DRY_RUN=1",`LOG=${log}`]);assert.equal(ok.status,0,ok.stderr);assert.match(readFileSync(log,"utf8"),/\"status\":\"dry-run\"/);const bad=run("make",["--no-print-directory","install-plugin",`SOURCE=${path.join(work,"missing")}`,`DEST=${dest}`,`LOG=${log}`]);assert.notEqual(bad.status,0);assert.match(bad.stderr,/Failed: source must be/);assert.match(bad.stderr,/details: \.\.\//);assert.match(readFileSync(log,"utf8"),/ERROR: source must be/);});

test("unsafe symlink log is refused",{skip:process.platform==="win32"},()=>{const real=path.join(work,"real-log");writeFileSync(real,"sentinel");const linked=path.join(work,"linked-log");symlinkSync(real,linked);const result=run(process.execPath,["scripts/install-staged-plugin.mjs","--source",stage,"--destination",path.join(work,"unused"),"--dry-run","--log",linked]);assert.notEqual(result.status,0);assert.match(result.stderr,/log path contains a symbolic link/);assert.equal(readFileSync(real,"utf8"),"sentinel");});

test("force never permits a symlink destination or destination ancestor",{skip:process.platform==="win32"},()=>{for(const dryRun of [false,true]){for(const kind of ["destination","ancestor"]){const caseRoot=path.join(work,`symlink-${kind}-${dryRun?"dry":"write"}`),outside=path.join(caseRoot,"outside"),container=path.join(caseRoot,"container");mkdirSync(outside,{recursive:true});mkdirSync(container,{recursive:true});const marker=path.join(outside,"outside-marker");writeFileSync(marker,"untouched");let attackedDestination:string;if(kind==="destination"){attackedDestination=path.join(container,"plugin");symlinkSync(outside,attackedDestination,"dir");}else{const linkedAncestor=path.join(container,"linked");symlinkSync(outside,linkedAncestor,"dir");attackedDestination=path.join(linkedAncestor,"plugin");}
const args=["scripts/install-staged-plugin.mjs","--source",stage,"--destination",attackedDestination,"--force",...(dryRun?["--dry-run"]:[])];const result=run(process.execPath,args);assert.notEqual(result.status,0,`${kind} ${dryRun?"dry-run":"write"} unexpectedly succeeded`);assert.match(result.stderr,/symbolic link/);assert.equal(readFileSync(marker,"utf8"),"untouched");assert.equal(lstatSync(path.join(outside,"plugin.json"),{throwIfNoEntry:false}),undefined);assert.equal(Boolean(lstatSync(attackedDestination,{throwIfNoEntry:false})?.isSymbolicLink()),kind==="destination");}}});


test("installer rejects logs inside source or destination before dry-run mutation",()=>{
  for(const [label,log,dest] of [
    ["destination",path.join(work,"nested-log-destination","logs","install.log"),path.join(work,"nested-log-destination")],
    ["source",path.join(stage,"logs","install.log"),path.join(work,"source-log-destination")]
  ] as const){
    const before=inventory(stage);
    const result=run(process.execPath,["scripts/install-staged-plugin.mjs","--source",stage,"--destination",dest,"--dry-run","--log",log]);
    assert.notEqual(result.status,0,label);
    assert.match(result.stderr,new RegExp("outside "+label));
    assert.equal(lstatSync(log,{throwIfNoEntry:false}),undefined);
    if(label==="destination")assert.equal(lstatSync(dest,{throwIfNoEntry:false}),undefined);
    assert.deepEqual(inventory(stage),before);
  }
});

test("bundle rejects logs inside output and final staging without changing the stage",()=>{
  const finalStage=path.join(root,config.stagingRoot,releaseKey);
  const before=inventory(finalStage);
  for(const log of [path.join(root,config.stagingRoot,"bundle.log"),path.join(finalStage,"diagnostics.log")]){
    const result=run(process.execPath,["scripts/build-bun-executables.mjs","--log",log]);
    assert.notEqual(result.status,0,result.stdout);
    assert.match(result.stderr,/log must be outside staging output/);
    assert.equal(lstatSync(log,{throwIfNoEntry:false}),undefined);
    assert.deepEqual(inventory(finalStage),before);
  }
});

test("bundle and installer reject logs inside operation sources",()=>{
  const bundleLog=path.join(root,"skills","skill-creator","diagnostics.log");
  const bundle=run(process.execPath,["scripts/build-bun-executables.mjs","--log",bundleLog]);
  assert.notEqual(bundle.status,0);
  assert.match(bundle.stderr,/log must be outside source/);
  assert.equal(lstatSync(bundleLog,{throwIfNoEntry:false}),undefined);
  const installLog=path.join(stage,"diagnostics.log");
  const install=run(process.execPath,["scripts/install-staged-plugin.mjs","--source",stage,"--destination",path.join(work,"source-overlap-dest"),"--dry-run","--log",installLog]);
  assert.notEqual(install.status,0);
  assert.match(install.stderr,/log must be outside source/);
  assert.equal(lstatSync(installLog,{throwIfNoEntry:false}),undefined);
});

test("existing logs are private, exclusively linked, and append safely",{skip:process.platform==="win32"},()=>{
  const parent=path.join(work,"secure-existing-log");mkdirSync(parent,{mode:0o700});
  const log=path.join(parent,"install.log");writeFileSync(log,"existing\n",{mode:0o644});chmodSync(log,0o644);
  const ok=run(process.execPath,["scripts/install-staged-plugin.mjs","--source",stage,"--destination",path.join(work,"permission-dest"),"--dry-run","--log",log]);
  assert.equal(ok.status,0,ok.stderr);
  assert.equal(lstatSync(log).mode&0o777,0o600);
  assert.match(readFileSync(log,"utf8"),/^existing\n[\s\S]*"status":"dry-run"/);
  const linked=path.join(parent,"linked.log");linkSync(log,linked);
  const rejected=run(process.execPath,["scripts/install-staged-plugin.mjs","--source",stage,"--destination",path.join(work,"hardlink-dest"),"--dry-run","--log",log]);
  assert.notEqual(rejected.status,0);
  assert.match(rejected.stderr,/plain, unlinked file/);
});

