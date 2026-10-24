import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotTaskFiles,preserveTaskEvidence,renderTaskEvidence } from "../dist/scripts/task_evidence.js";
import { normalizeAssertion,deterministicCheck } from "../dist/scripts/evaluator_grading.js";
test("actual artifacts remain bound after workspace deletion, and missing file cannot pass against JSON root",()=>{
 const root=mkdtempSync(join(tmpdir(),"task-files-")),run=mkdtempSync(join(tmpdir(),"task-run-"));
 try {mkdirSync(join(run,"outputs"));writeFileSync(join(root,"input.txt"),"original");const before=snapshotTaskFiles(root);mkdirSync(join(root,"outputs"));writeFileSync(join(root,"outputs","data.csv"),"name,total\nAlice,42\n");writeFileSync(join(root,"outputs","binary.bin"),Buffer.from([0,255,1]));
 const context=preserveTaskEvidence(root,run,before,"Created outputs/data.csv",0);const output=renderTaskEvidence(context);rmSync(root,{recursive:true,force:true});assert.deepEqual(readFileSync(join(run,"outputs","artifacts","outputs","binary.bin")),Buffer.from([0,255,1]));assert.match(output,/Alice/);
 const check=(operator:string,locator:any,expected:any)=>deterministicCheck(normalizeAssertion({id:"a",subject:"property",operator,locator,expected},0),"{}",context).verdict;
 assert.equal(check("exists",{kind:"file",path:"missing.csv"},true),"fail");assert.equal(check("exists",{kind:"file",path:"outputs/data.csv"},true),"pass");assert.equal(check("contains",{kind:"file",path:"outputs/data.csv"},"Alice,42"),"pass");assert.equal(check("preserves",{kind:"file",path:"input.txt"},true),"pass");assert.equal(check("equals",{kind:"exit-code"},0),"pass");assert.equal(check("contains",{kind:"stdout"},"Created"),"pass");
 assert.throws(()=>normalizeAssertion({subject:"stderr",operator:"contains",locator:{kind:"stderr"},expected:"bad"},0),/Unsupported/);
 }finally{rmSync(root,{recursive:true,force:true});rmSync(run,{recursive:true,force:true});}
});
test("unsafe task artifact symlinks are rejected",()=>{const root=mkdtempSync(join(tmpdir(),"task-escape-"));try{symlinkSync("/etc/passwd",join(root,"escape"));assert.throws(()=>snapshotTaskFiles(root),/symlink/);}finally{rmSync(root,{recursive:true,force:true});}});
