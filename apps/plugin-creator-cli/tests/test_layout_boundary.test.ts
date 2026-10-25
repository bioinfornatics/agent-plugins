import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const skillRoot=resolve(appRoot,"../../skills/plugin-creator");

test("application and portable Skill have a strict ownership boundary",()=>{
  for(const name of ["tests","dist","node_modules","vendor","package.json","package-lock.json","tsconfig.json"]){
    assert.equal(existsSync(join(skillRoot,name)),false,`portable Skill must not contain ${name}`);
  }
  for(const name of ["scripts","tests","dist","vendor","package.json","tsconfig.json"]){
    assert.equal(existsSync(join(appRoot,name)),true,`CLI app must own ${name}`);
  }
  for(const name of ["SKILL.md","README.md","references","assets","evals"]){
    assert.equal(existsSync(join(skillRoot,name)),true,`portable Skill must retain ${name}`);
  }
  assert.equal(existsSync(join(skillRoot,"scripts","plugin-creator.mjs")),true,"portable Skill owns only its generated Node launcher");
  assert.equal(existsSync(join(skillRoot,"runtime","runtime-manifest.json")),true,"portable Skill owns its generated runtime");
  const walk=(root:string):string[]=>readdirSync(root,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(join(root,entry.name)):[join(root,entry.name)]);
  assert.deepEqual(walk(skillRoot).filter(path=>path.endsWith(".ts")),[],"portable Skill must not contain TypeScript implementation");
});
