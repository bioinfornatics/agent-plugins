import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT=join(dirname(fileURLToPath(import.meta.url)),"..");
test("clean-source implementation uses only the explicit manifest and never npm ci",()=>{const source=readFileSync(join(ROOT,"scripts/test-clean-source-reproducibility.mjs"),"utf8");assert.match(source,/source-manifest\.json/);assert.match(source,/for\(const relative of required\)copyDeclared/);assert.doesNotMatch(source,/copyTree\(source|npm[^\n]+ci|\.\.\.process\.env/)});
test("source manifest has disjoint source/generated classes and an exhaustive build order",()=>{
  const manifest=JSON.parse(readFileSync(join(ROOT,"config/reproducibility/source-manifest.json"),"utf8"));assert.equal(manifest.schemaVersion,1);
  assert.ok(manifest.requiredFiles.includes("scripts/test-clean-source-reproducibility.mjs"));assert.ok(manifest.requiredFiles.includes("vendor/build-node_modules/integrity-manifest.json"));
  const expression=(pattern:string)=>new RegExp("^"+pattern.replace(/[.+?^${}()|[\]\\]/g,"\\$&").replaceAll("**","\u0000").replaceAll("*","[^/]*").replaceAll("\u0000",".*")+"$");
  const generated=manifest.generatedClassifications.map((entry:any)=>({...entry,match:expression(entry.path)}));
  assert.deepEqual(generated.filter((x:any)=>/^apps\/.+\/dist\/\*\*$/.test(x.path)).map((x:any)=>x.path),["apps/agent-plugin/dist/**"]);
  assert.ok(!manifest.requiredFiles.some((file:string)=>/^apps\/[^/]+-creator-cli\//.test(file)));
  assert.equal(new Set(manifest.requiredFiles).size,manifest.requiredFiles.length);
  assert.deepEqual(manifest.requiredFiles.filter((file:string)=>generated.some((entry:any)=>entry.match.test(file))),[]);
  assert.deepEqual(manifest.requiredFiles.filter((file:string)=>manifest.transientGeneratedOutputs.some((entry:any)=>expression(entry.path).test(file))),[]);
  for(let i=0;i<generated.length;i++)for(let j=i+1;j<generated.length;j++){const a=generated[i].path.replace(/\/\*\*$/,"").replace("*","probe"),b=generated[j].path.replace(/\/\*\*$/,"").replace("*","probe");assert.ok(!generated[i].match.test(b)&&!generated[j].match.test(a),`${generated[i].path} overlaps ${generated[j].path}`)}
  const produced=new Set(manifest.buildOrder.flatMap((step:any)=>step.produces));assert.deepEqual(generated.filter((entry:any)=>!produced.has(entry.path)).map((entry:any)=>entry.path),[]);
  assert.deepEqual(manifest.buildOrder.map((step:any)=>step.step),manifest.buildOrder.map((_:any,index:number)=>index+1));
  const appBuild=manifest.buildOrder.find((step:any)=>step.produces.includes("apps/agent-plugin/dist/**"));
  assert.ok(appBuild);assert.match(appBuild.command,/agent-plugin/);
  assert.ok(!manifest.buildOrder.some((step:any)=>/creator-cli|embedded_viewer/.test(JSON.stringify(step))));
  assert.deepEqual(manifest.transientGeneratedOutputs.map((entry:any)=>entry.path),["artifacts/platform-exclusions.json"]);
  assert.ok(manifest.authoritativeSourceClassifications.every((entry:any)=>/authoritative|Canonical/.test(entry.reason)));
});
test("current app stages compilation before retiring dist and preserves rollback safety",()=>{
  const source=readFileSync(join(ROOT,"apps/agent-plugin/scripts/build.mjs"),"utf8");
  assert.match(source,/mkdtemp\(join\(root, "\.build-"\)\)/);
  assert.ok(source.indexOf("await compileJavaScript(stage)")<source.indexOf("await rename(destination, backup)"));
  assert.match(source,/if \(code !== 0\) return code/);
  assert.match(source,/await rename\(backup, destination\)/);
  assert.match(source,/if \(!backedUp\) await rm\(workspace/);
  assert.match(source,/delete env\.NODE_TEST_CONTEXT/);
});
test("clean-source rebuild targets only current emitted app and contained runtime",()=>{
  const source=readFileSync(join(ROOT,"scripts/test-clean-source-reproducibility.mjs"),"utf8");
  assert.match(source,/agent-plugin/);assert.match(source,/stale.*canary|staleCanary/i);
  assert.match(source,/skills\/skill-creator\/runtime/);assert.match(source,/byte-stable/);
  assert.doesNotMatch(source,/embedded_viewer|viewer\.html|apps\/skill-creator-cli|\["agent","hook","plugin","skill"\]/);
  assert.match(source,/finally\{rmSync\(work/);
});
test("vendored closure integrity is enforced and detects tampering",()=>{const ok=spawnSync(process.execPath,[join(ROOT,"scripts/verify-repository-integrity.mjs")],{encoding:"utf8"});assert.equal(ok.status,0,ok.stderr);const manifest=JSON.parse(readFileSync(join(ROOT,"vendor/build-node_modules/integrity-manifest.json"),"utf8"));const playwright=manifest.packages.find((x:any)=>x.name==="playwright-core");assert.equal(playwright.version,"1.60.0");assert.equal(playwright.license,"Apache-2.0");assert.ok(manifest.packages.every((x:any)=>x.license&&x.files.every((f:any)=>/^[a-f0-9]{64}$/.test(f.sha256))))});
test("platform contract requires portable gates and explicit unsupported exclusions",()=>{const matrix=JSON.parse(readFileSync(join(ROOT,"config/reproducibility/platform-matrix.json"),"utf8"));assert.ok(matrix.portableGates.length>=8);assert.ok(matrix.nativeGates.includes("release-package-execution"));assert.match(matrix.unsupportedPlatformPolicy,/portable gate/);assert.equal(matrix.reportPath,"artifacts/platform-exclusions.json");const runner=readFileSync(join(ROOT,"scripts/test.mjs"),"utf8");assert.match(runner,/test runner changed working-tree status outside Beads/);assert.match(runner,/retiredGuarantees/);assert.match(runner,/nativeCompatibility:\s*['"]unverified['"]/);assert.doesNotMatch(runner,/mkdirSync\(path\.join\(root,"artifacts"/)});

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
  // The negative undeclared-file case runs in a private projection: never add
  // canaries to the shared checkout while other workers validate its inventory.
  const rejected=spawnSync(process.execPath,['--input-type=module','-e',`
    import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
    import {tmpdir} from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
    const work=mkdtempSync(path.join(tmpdir(),'inventory-negative-'));
    try {
      mkdirSync(path.join(work,'scripts'));mkdirSync(path.join(work,'config/reproducibility'),{recursive:true});
      copyFileSync(${JSON.stringify(validator)},path.join(work,'scripts/validate-change-set-inventory.mjs'));
      writeFileSync(path.join(work,'config/reproducibility/source-manifest.json'),JSON.stringify({schemaVersion:1,requiredFiles:['scripts/validate-change-set-inventory.mjs','config/reproducibility/source-manifest.json'],generatedClassifications:[],transientGeneratedOutputs:[]}));
      const g=spawnSync('git',['init','-q'],{cwd:work,encoding:'utf8'});if(g.status!==0)throw Error(g.stderr);
      writeFileSync(path.join(work,'unknown-change-set-canary.txt'),'must be rejected');
      const r=spawnSync(process.execPath,['scripts/validate-change-set-inventory.mjs','--clean-projection'],{cwd:work,encoding:'utf8'});
      process.stderr.write(r.stderr);process.exitCode=r.status??1;
    } finally {rmSync(work,{recursive:true,force:true});}
  `],{encoding:'utf8'});
  assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/undeclared source files:[^\n]*unknown-change-set-canary\.txt/);
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
