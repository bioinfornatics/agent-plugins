import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,readdirSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {counterbalancedPairSeed,pairedOrderFromSeed,sha256} from "../dist/scripts/evaluation_provenance.js";
import {prepareGrading} from "../dist/scripts/prepare_grading.js";
import {groupPendingBatches,applyBatchResults} from "../dist/scripts/batch_grading.js";
import {importGrading} from "../dist/scripts/import_grading.js";

const graders=[{id:"grader-a",model:"model-a",provider:"fixture"},{id:"grader-b",model:"model-b",provider:"fixture"}];
const configurations=["with_skill","without_skill"];
const outputFor=(configuration:string)=>configuration+": Criterion number 1. Criterion number 2. Criterion number 3.";
function fixture(){
 const root=mkdtempSync(join(tmpdir(),"batch-journey-")),evalDir=join(root,"eval-one");
 const binding={skill_source_sha256:"a".repeat(64),eval_plan_sha256:"b".repeat(64),scenario_sha256:"c".repeat(64)},seed=counterbalancedPairSeed(binding,1);
 mkdirSync(evalDir,{recursive:true});writeFileSync(join(evalDir,"eval_metadata.json"),JSON.stringify({
  eval_id:"one",run_profile:"fast",requested_pairs:1,decision_policy:"fixed",execution_schedule:[{pair_index:1,seed,order:pairedOrderFromSeed(seed)}],
  execution_binding:binding,baseline_configuration:"without_skill",prompt:"Prepare a report",model:"test-model",
  assertions:[1,2,3].map(i=>({id:"a"+i,version:1,classification:"semantic",criterion:"Criterion number "+i})),
  grading_plan:{schema_version:1,evidence:"grader-evidence",graders},
 }));
 for(const configuration of configurations){const run=join(evalDir,configuration,"run-1"),output=outputFor(configuration);
  mkdirSync(join(run,"outputs"),{recursive:true});writeFileSync(join(run,"outputs/result.txt"),output);
  writeFileSync(join(run,"deterministic-evidence.json"),JSON.stringify({schema_version:1,variant_sha256:sha256(configuration),output_sha256:sha256(output),assertions:[]}));
 }
 return {root,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
function batch(root:string,id:string){return JSON.parse(readFileSync(join(root,"grading-batches",id+".json"),"utf8"));}
function pendingIds(root:string){return groupPendingBatches(root).batches.flatMap(s=>batch(root,s.batch_id).requests.map((r:any)=>r.invocation_id)).sort();}
function judgmentFiles(root:string){const dir=join(root,"grading-judgments");return existsSync(dir)?readdirSync(dir).sort():[];}

test("Batch delegation preserves each candidate, grader and criterion; importing keeps mixed judgments and excludes only completed slots",()=>{
 const f=fixture();try{
  prepareGrading(f.root);const grouped=groupPendingBatches(f.root);
  assert.deepEqual(grouped.errors,[]);assert.equal(grouped.batches_written,4);assert.equal(grouped.requests_batched,12);
  assert.deepEqual(grouped.batches.map(s=>[s.run_directory,s.grader_id]).sort(),configurations.flatMap(c=>graders.map(g=>["eval-one/"+c+"/run-1",g.id])).sort());
  const allIds:string[]=[],expectedJudgments=new Map<string,any>();
  for(const summary of grouped.batches){
   const b=batch(f.root,summary.batch_id),configuration=b.run_directory.split("/")[1],grader=graders.find(g=>g.id===b.grader_id)!;
   assert.equal(b.candidate_output,outputFor(configuration));assert.equal(b.prompt,"Prepare a report");
   assert.equal(b.grader_model,grader.model);assert.equal(b.grader_provider,grader.provider);
   assert.deepEqual(b.requests.map((r:any)=>[r.assertion_id,r.assertion_version,r.criterion]).sort(),[["a1",1,"Criterion number 1"],["a2",1,"Criterion number 2"],["a3",1,"Criterion number 3"]]);
   for(const request of b.requests){
    allIds.push(request.invocation_id);const original=JSON.parse(readFileSync(join(f.root,"grading-requests",request.invocation_id+".json"),"utf8"));
    assert.equal(original.candidate.output,outputFor(configuration));assert.deepEqual(original.grader,{model:grader.model,provider:grader.provider});assert.equal(original.assertion.id,request.assertion_id);
    const verdict=({a1:"pass",a2:"fail",a3:"inconclusive"} as Record<string,string>)[request.assertion_id];
    expectedJudgments.set(request.invocation_id,{invocation_id:request.invocation_id,verdict,evidence_quote:"Criterion number "+request.assertion_id.slice(1),rationale:configuration+"/"+grader.id+"/"+request.assertion_id});
   }
  }
  assert.equal(new Set(allIds).size,12);
  // Results arrive in reverse order; fan-out must use IDs rather than array positions.
  const first=grouped.batches[0],firstIds=batch(f.root,first.batch_id).requests.map((r:any)=>r.invocation_id);
  const apply=(id:string)=>{const results=batch(f.root,id).requests.map((r:any)=>expectedJudgments.get(r.invocation_id)).reverse();
   const result=applyBatchResults(f.root,id,results);assert.equal(result.judgments_written,3);assert.deepEqual(result.errors,[]);
  };
  apply(first.batch_id);
  assert.deepEqual(pendingIds(f.root),allIds.filter(id=>!firstIds.includes(id)).sort());
  for(const summary of grouped.batches.slice(1))apply(summary.batch_id);
  assert.deepEqual(pendingIds(f.root),[]);assert.equal(judgmentFiles(f.root).length,12);
  for(const [id,expected] of expectedJudgments){const persisted=JSON.parse(readFileSync(join(f.root,"grading-judgments",id+".json"),"utf8"));
   assert.equal(persisted.invocation_id,id);assert.equal(persisted.verdict,expected.verdict);assert.equal(persisted.evidence_quote,expected.evidence_quote);assert.equal(persisted.rationale,expected.rationale);
  }
  const imported=importGrading(f.root);assert.deepEqual(imported.rejected,[]);assert.deepEqual(imported.errors,[]);assert.equal(imported.imported.length,12);assert.equal(imported.ready_to_resume,true);
  assert.deepEqual(imported.imported.map(x=>[x.invocation_id,x.verdict]).sort(),[...expectedJudgments].map(([id,j])=>[id,j.verdict]).sort());
 }finally{f.cleanup();}
});

test("Unknown IDs and invalid verdicts write no judgments and leave the exact pending set unchanged",()=>{
 const f=fixture();try{
  prepareGrading(f.root);const grouped=groupPendingBatches(f.root),id=grouped.batches[0].batch_id;
  const before=pendingIds(f.root),invocation=batch(f.root,id).requests[0].invocation_id;
  for(const entry of [
   {invocation_id:"foreign-invocation",verdict:"pass",message:/not part of batch/},
   {invocation_id:invocation,verdict:"maybe",message:/verdict/},
  ]){
   const result=applyBatchResults(f.root,id,[{invocation_id:entry.invocation_id,verdict:entry.verdict,evidence_quote:"Criterion",rationale:"fixture"}]);
   assert.equal(result.judgments_written,0);assert.equal(result.errors.length,1);assert.equal(result.errors[0].invocation_id,entry.invocation_id);assert.match(result.errors[0].message,entry.message);
   assert.deepEqual(judgmentFiles(f.root),[]);assert.deepEqual(pendingIds(f.root),before);
  }
 }finally{f.cleanup();}
});

test("An unprepared workspace has no delegation work and grouping does not create files",()=>{
 const root=mkdtempSync(join(tmpdir(),"unprepared-batch-"));try{const result=groupPendingBatches(root);
  assert.equal(result.batches_written,0);assert.equal(result.requests_batched,0);assert.deepEqual(result.batches,[]);assert.deepEqual(result.errors,[]);assert.deepEqual(readdirSync(root),[]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
