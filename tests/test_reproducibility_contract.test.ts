import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT=join(dirname(fileURLToPath(import.meta.url)),"..");
test("clean-source implementation uses only the explicit manifest and never npm ci",()=>{const source=readFileSync(join(ROOT,"scripts/test-clean-source-reproducibility.mjs"),"utf8");assert.match(source,/source-manifest\.json/);assert.match(source,/for\(const relative of required\)copyDeclared/);assert.doesNotMatch(source,/copyTree\(source|npm[^\n]+ci|\.\.\.process\.env/)});
test("source manifest has disjoint source/generated classes and an exhaustive build order",()=>{
  const manifest=JSON.parse(readFileSync(join(ROOT,"config/reproducibility/source-manifest.json"),"utf8"));assert.equal(manifest.schemaVersion,1);
  assert.ok(manifest.requiredFiles.includes("scripts/test-clean-source-reproducibility.mjs"));assert.ok(manifest.requiredFiles.includes("vendor/build-node_modules/integrity-manifest.json"));
  const expression=(pattern:string)=>new RegExp("^"+pattern.replace(/[.+?^${}()|[\]\\]/g,"\\$&").replaceAll("**","\u0000").replaceAll("*","[^/]*").replaceAll("\u0000",".*")+"$");
  const generated=manifest.generatedClassifications.map((entry:any)=>({...entry,match:expression(entry.path)}));
  assert.deepEqual(generated.filter((x:any)=>/^apps\/.+-creator-cli\/dist\/\*\*$/.test(x.path)).map((x:any)=>x.path).sort(),["agent","hook","plugin","skill"].map(app=>`apps/${app}-creator-cli/dist/**`));
  const embeddedPath="apps/skill-creator-cli/eval-viewer/embedded_viewer.ts",embedded=generated.find((x:any)=>x.path===embeddedPath);
  assert.ok(embedded);assert.equal(embedded.source,"apps/skill-creator-cli/eval-viewer/viewer.html");assert.equal(embedded.regenerator,"apps/skill-creator-cli/scripts/build.mjs");
  assert.ok(!manifest.requiredFiles.includes(embeddedPath));
  assert.equal(new Set(manifest.requiredFiles).size,manifest.requiredFiles.length);
  assert.deepEqual(manifest.requiredFiles.filter((file:string)=>generated.some((entry:any)=>entry.match.test(file))),[]);
  assert.deepEqual(manifest.requiredFiles.filter((file:string)=>manifest.transientGeneratedOutputs.some((entry:any)=>expression(entry.path).test(file))),[]);
  for(let i=0;i<generated.length;i++)for(let j=i+1;j<generated.length;j++){const a=generated[i].path.replace(/\/\*\*$/,"").replace("*","probe"),b=generated[j].path.replace(/\/\*\*$/,"").replace("*","probe");assert.ok(!generated[i].match.test(b)&&!generated[j].match.test(a),`${generated[i].path} overlaps ${generated[j].path}`)}
  const produced=new Set(manifest.buildOrder.flatMap((step:any)=>step.produces));assert.deepEqual(generated.filter((entry:any)=>!produced.has(entry.path)).map((entry:any)=>entry.path),[]);
  assert.deepEqual(manifest.buildOrder.map((step:any)=>step.step),[1,2,3,4,5]);
  const creatorBuild=manifest.buildOrder.find((step:any)=>step.step===2);assert.ok(creatorBuild.produces.includes("apps/skill-creator-cli/eval-viewer/embedded_viewer.ts"));assert.ok(creatorBuild.produces.indexOf("apps/skill-creator-cli/eval-viewer/embedded_viewer.ts")<creatorBuild.produces.indexOf("apps/skill-creator-cli/dist/**"));
  assert.deepEqual(manifest.transientGeneratedOutputs.map((entry:any)=>entry.path),["artifacts/platform-exclusions.json"]);
  assert.ok(manifest.authoritativeSourceClassifications.every((entry:any)=>/authoritative|Canonical/.test(entry.reason)));
});
test("every creator build safely cleans dist before compiling",()=>{for(const app of ["agent","hook","plugin","skill"]){const source=readFileSync(join(ROOT,"apps",`${app}-creator-cli`,`scripts/build.mjs`),"utf8"),compact=source.replace(/\s+/g,"");assert.match(compact,/path\.dirname\(dist\)!==root\|\|path\.basename\(dist\)!=="dist"/);assert.match(compact,/if\(existsSync\(dist\)\)renameSync\(dist,retired\)/);assert.match(compact,/rmSync\(retired,\{recursive:true,force:true\}\)/);assert.ok(compact.indexOf("renameSync(dist")<compact.indexOf("spawnSync("),app)}});
test("skill creator build emits the generated viewer bridge at its declared path before TypeScript compilation",()=>{const source=readFileSync(join(ROOT,"apps/skill-creator-cli/scripts/build.mjs"),"utf8"),output='path.join(root,"eval-viewer","embedded_viewer.ts")',header="/** Generated from viewer.html by scripts/build.mjs. Do not edit directly. */";assert.match(source,/readFileSync\(path\.join\(root,"eval-viewer","viewer\.html"\),"utf8"\)/);assert.ok(source.includes(output));assert.ok(source.includes(header));assert.ok(source.indexOf(output)<source.indexOf("spawnSync("));const generated=readFileSync(join(ROOT,"apps/skill-creator-cli/eval-viewer/embedded_viewer.ts"),"utf8");assert.ok(generated.startsWith(header+"\n"))});
test("vendored closure integrity is enforced and detects tampering",()=>{const ok=spawnSync(process.execPath,[join(ROOT,"scripts/verify-repository-integrity.mjs")],{encoding:"utf8"});assert.equal(ok.status,0,ok.stderr);const manifest=JSON.parse(readFileSync(join(ROOT,"vendor/build-node_modules/integrity-manifest.json"),"utf8"));const playwright=manifest.packages.find((x:any)=>x.name==="playwright-core");assert.equal(playwright.version,"1.60.0");assert.equal(playwright.license,"Apache-2.0");assert.ok(manifest.packages.every((x:any)=>x.license&&x.files.every((f:any)=>/^[a-f0-9]{64}$/.test(f.sha256))))});
test("platform contract requires portable gates and explicit unsupported exclusions",()=>{const matrix=JSON.parse(readFileSync(join(ROOT,"config/reproducibility/platform-matrix.json"),"utf8"));assert.ok(matrix.portableGates.length>=8);assert.ok(matrix.nativeGates.includes("release-package-execution"));assert.match(matrix.unsupportedPlatformPolicy,/portable gate/);assert.equal(matrix.reportPath,"artifacts/platform-exclusions.json");const runner=readFileSync(join(ROOT,"scripts/test.mjs"),"utf8");assert.match(runner,/mkdtempSync\(path\.join\(tmpdir\(\),"agent-plugins-platform-report-"\)\)/);assert.doesNotMatch(runner,/mkdirSync\(path\.join\(root,"artifacts"/)});

test("platform support fails closed against authoritative release targets",()=>{
  const release=JSON.parse(readFileSync(join(ROOT,"bun-release.json"),"utf8"));
  const matrix=JSON.parse(readFileSync(join(ROOT,"config/reproducibility/platform-matrix.json"),"utf8"));
  const moduleUrl=new URL("../scripts/platform-support.mjs",import.meta.url);
  return import(moduleUrl.href).then(({classifyPlatformGates,determinePlatformSupport,validatePlatformMatrix})=>{
    const clone=(value:any)=>JSON.parse(JSON.stringify(value));
    const unknown=determinePlatformSupport(release,matrix,"freebsd-x64");
    assert.equal(unknown.nativeSupported,false);
    assert.equal(unknown.releaseTarget,null);
    const unknownPlan=classifyPlatformGates(release,matrix,"freebsd-x64");
    assert.equal(unknownPlan.nativeSupported,false);
    assert.deepEqual(unknownPlan.exclusions.map((entry:any)=>entry.gate),matrix.nativeGates);
    assert.ok(unknownPlan.exclusions.every((entry:any)=>entry.platform==="freebsd-x64"&&/portable gates remain mandatory/.test(entry.reason)));
    const missing=clone(matrix);delete missing.nativeSupported["linux-x64"];
    assert.throws(()=>determinePlatformSupport(release,missing,"linux-x64"),/missing supported release target linux-x64/);
    const downgraded=clone(matrix);downgraded.nativeSupported["linux-x64"]=false;
    assert.throws(()=>determinePlatformSupport(release,downgraded,"linux-x64"),/must be true for a supported release target/);
    const extra=clone(matrix);extra.nativeSupported["freebsd-x64"]=false;
    assert.throws(()=>validatePlatformMatrix(release,extra),/unknown release target freebsd-x64/);
    const malformed=clone(matrix);malformed.nativeSupported["linux-x64"]="bun-linux-x64-baseline";
    assert.throws(()=>validatePlatformMatrix(release,malformed),/must be true for a supported release target/);
    const malformedGates=clone(matrix);malformedGates.nativeGates=["native-build",false];
    assert.throws(()=>classifyPlatformGates(release,malformedGates,"freebsd-x64"),/nativeGates must be a non-empty string array/);
    assert.deepEqual(validatePlatformMatrix(release,matrix),Object.keys(release.targets).sort());
    for(const key of Object.keys(release.targets))assert.equal(determinePlatformSupport(release,matrix,key).nativeSupported,true,key);
    assert.equal(determinePlatformSupport(release,matrix,"linux-x64").releaseTarget,"bun-linux-x64-baseline");
    assert.equal(determinePlatformSupport(release,matrix,process.platform+"-"+process.arch).nativeSupported,Object.hasOwn(release.targets,process.platform+"-"+process.arch));
  });
});

test("source inventory rejects undeclared files before and after commit",()=>{
  const validator=join(ROOT,"scripts/validate-change-set-inventory.mjs");
  const ok=spawnSync(process.execPath,[validator],{encoding:"utf8"});
  assert.equal(ok.status,0,ok.stderr);
  const report=JSON.parse(ok.stdout);assert.equal(report.unknownPaths,0);assert.equal(report.sourceGeneratedOverlap,0);
  const canary=join(ROOT,"unknown-change-set-canary.txt");writeFileSync(canary,"must be rejected\n");
  try{const rejected=spawnSync(process.execPath,[validator],{encoding:"utf8"});assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/undeclared source files: unknown-change-set-canary.txt/)}finally{rmSync(canary,{force:true})}
});

test("build configuration is grouped under config without changing runtime schema identity",()=>{
  const manifest=JSON.parse(readFileSync(join(ROOT,"config/reproducibility/source-manifest.json"),"utf8"));
  const mapping=JSON.parse(readFileSync(join(ROOT,"config/skill-runtimes/skill-runtime-map.json"),"utf8"));
  const schema=JSON.parse(readFileSync(join(ROOT,"config/skill-runtimes/skill-runtime-map.schema.json"),"utf8"));
  assert.equal(mapping.$schema,"./skill-runtime-map.schema.json");
  assert.equal(schema.$id,"https://agent-plugins.org/schemas/skill-runtime-map.schema.json");
  for(const file of ["config/reproducibility/source-manifest.json","config/reproducibility/platform-matrix.json","config/skill-runtimes/skill-runtime-map.json","config/skill-runtimes/skill-runtime-map.schema.json"])assert.ok(manifest.requiredFiles.includes(file),file);
  assert.deepEqual(manifest.requiredFiles.filter((file:string)=>file.startsWith("runtime/")||file.startsWith("reproducibility/")),[]);
  assert.deepEqual(manifest.requiredFiles,[...manifest.requiredFiles].sort());
});
