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
function inventory(directory:string,base=directory):any[]{const rows:any[]=[];for(const entry of readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,"en"))){const absolute=path.join(directory,entry.name),relative=path.relative(base,absolute).split(path.sep).join("/"),stat=lstatSync(absolute);if(entry.isDirectory())rows.push(...inventory(absolute,base));else rows.push({path:relative,mode:(stat.mode&0o777).toString(8).padStart(3,"0"),size:stat.size,sha256:createHash("sha256").update(readFileSync(absolute)).digest("hex")});}return rows;}
before(()=>{mkdirSync(path.join(stage,"skills","example","scripts"),{recursive:true});writeFileSync(path.join(stage,"plugin.json"),JSON.stringify({name:"agent-plugins"}));const executable=path.join(stage,"skills","example","scripts","example"+(process.platform==="win32"?".exe":""));writeFileSync(executable,"fixture");if(process.platform!=="win32")chmodSync(executable,0o755);const manifest={schemaVersion:1,runtimeMode:"native-bun",releaseKey,bunTarget:config.targets[releaseKey],bunVersion:config.bunVersion,files:inventory(stage)};writeFileSync(path.join(stage,"release-manifest.json"),JSON.stringify(manifest,null,2)+"\n");});
after(()=>rmSync(work,{recursive:true,force:true}));
test("current developer runtime mapping has one Node app and no retired compiler inputs",()=>{
  const mapping=JSON.parse(readFileSync(path.join(root,"config/skill-runtimes/skill-runtime-map.json"),"utf8"));
  assert.equal(mapping.skills.length,1);assert.equal(mapping.skills[0].app,"apps/agent-plugin");
  assert.equal(mapping.skills[0].emittedEntry,"dist/index.js");
  const app=JSON.parse(readFileSync(path.join(root,"apps/agent-plugin/package.json"),"utf8"));
  assert.equal(app.scripts.build,"node scripts/build.mjs");assert.match(app.engines.node,/22\.22\.2/);
});
test("retired native bundle wrapper cannot publish staging",()=>{
  const output=path.join(work,"retired-bundle");
  const result=run(process.execPath,["scripts/build-bun-executables.mjs","--output",output]);
  assert.notEqual(result.status,0,"retired creator compiler must not succeed");
  assert.doesNotMatch(result.stdout,/"status"\s*:\s*"staged"|Staged:/);
  assert.equal(lstatSync(path.join(output,releaseKey),{throwIfNoEntry:false}),undefined);
});

test("installer help and dry-run do not write",()=>{const help=run(process.execPath,["scripts/install-staged-plugin.mjs","--help"]);assert.equal(help.status,0);assert.match(help.stdout,/--dry-run/);assert.match(help.stdout,/project-local|\.agents\/plugins/);const result=run(process.execPath,["scripts/install-staged-plugin.mjs","--source",stage,"--destination",destination,"--dry-run"]);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).status,"dry-run");assert.equal(lstatSync(destination,{throwIfNoEntry:false}),undefined);const fakeHome=path.join(work,"home");const local=spawnSync(process.execPath,["scripts/install-staged-plugin.mjs","--source",stage,"--dry-run","--force"],{cwd:root,encoding:"utf8",env:{...process.env,HOME:fakeHome}});assert.equal(local.status,0,local.stderr);assert.equal(JSON.parse(local.stdout).destination,path.join(root,".agents","plugins","agent-plugins"));assert.equal(lstatSync(fakeHome,{throwIfNoEntry:false}),undefined);});
test("plugin installation never mutates the standalone skills destination",()=>{const agents=path.join(work,"isolated-agents"),skills=path.join(agents,"skills"),plugin=path.join(agents,"plugins","agent-plugins"),sentinel=path.join(skills,"example.skill");mkdirSync(skills,{recursive:true});writeFileSync(sentinel,"standalone-skill");const result=run(process.execPath,["scripts/install-staged-plugin.mjs","--source",stage,"--destination",plugin]);assert.equal(result.status,0,result.stderr);assert.equal(readFileSync(sentinel,"utf8"),"standalone-skill");assert.equal(readdirSync(skills).join(","),"example.skill");assert.equal(JSON.parse(readFileSync(path.join(plugin,"plugin.json"),"utf8")).name,"agent-plugins");});
test("installer validates, refuses overwrite, and force replaces",()=>{let result=run(process.execPath,["scripts/install-staged-plugin.mjs","--source",stage,"--destination",destination]);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(readFileSync(path.join(destination,"plugin.json"),"utf8")).name,"agent-plugins");writeFileSync(path.join(destination,"marker"),"keep");result=run(process.execPath,["scripts/install-staged-plugin.mjs","--source",stage,"--destination",destination]);assert.notEqual(result.status,0);assert.match(result.stderr,/already exists/);assert.equal(readFileSync(path.join(destination,"marker"),"utf8"),"keep");result=run(process.execPath,["scripts/install-staged-plugin.mjs","--source",stage,"--destination",destination,"--force"]);assert.equal(result.status,0,result.stderr);assert.equal(lstatSync(path.join(destination,"marker"),{throwIfNoEntry:false}),undefined);});
test("installer rejects tampering",()=>{const plugin=path.join(stage,"plugin.json"),original=readFileSync(plugin,"utf8");writeFileSync(plugin,"tampered");const result=run(process.execPath,["scripts/install-staged-plugin.mjs","--source",stage,"--destination",path.join(work,"bad")]);assert.notEqual(result.status,0);assert.match(result.stderr,/checksum validation/);writeFileSync(plugin,original);});

test("direct installer retains JSON output by default",()=>{const result=run(process.execPath,["scripts/install-staged-plugin.mjs","--source",stage,"--destination",path.join(work,"json-destination"),"--dry-run"]);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).status,"dry-run");assert.equal(result.stderr,"");});

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

test("installer rejects logs inside operation sources",()=>{
  const log=path.join(stage,"diagnostics.log");
  const result=run(process.execPath,["scripts/install-staged-plugin.mjs","--source",stage,"--destination",path.join(work,"source-overlap-dest"),"--dry-run","--log",log]);
  assert.notEqual(result.status,0);assert.match(result.stderr,/log must be outside source/);
  assert.equal(lstatSync(log,{throwIfNoEntry:false}),undefined);
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



test("Make install uses Node directly without requiring the retired Bun package runner",()=>{
 const makefile=readFileSync(path.join(root,"Makefile"),"utf8");
 const install=makefile.split("install-plugin:\n")[1].split("bundle-install-plugin:")[0];
 assert.match(install,/node scripts\/install-staged-plugin\.mjs/);
 assert.doesNotMatch(install,/\bbun\b/);
});
