
import test from "node:test";
import assert from "node:assert/strict";
import { buildQualityConditionedEfficiency, type EfficiencyRun } from "../dist/scripts/paired_efficiency.js";
import { normalizeExecutionEfficiency } from "../dist/scripts/execution_efficiency.js";

function telemetry(values:Record<string,number>,currency="USD"){
 const usage:any={input_tokens:values.input_tokens,output_tokens:values.output_tokens,reasoning_tokens:values.reasoning_tokens,cache_read_tokens:values.cache_read_tokens,cache_write_tokens:values.cache_write_tokens,total_tokens:values.total_tokens,turns:values.turns,cost:values.cost,currency};
 const events=Array.from({length:values.tool_calls??0},(_,i)=>({message:{content:[{type:"toolRequest",toolCall:{name:i%2?"read_file":"load_skill",arguments:{path:i%2?"file.ts":"references/doc.md"}}}]}}));
 return normalizeExecutionEfficiency({events,terminal:{type:"complete",usage},durationSeconds:values.duration??1,firstUsefulActionSeconds:values.ttfa??.1,failed:false,retries:values.retries??0,workspaceRoot:process.cwd()});
}
function run(scenario:string,configuration:string,n:number,quality:number,values:Record<string,number>,model="m",reasoning="medium",req={minimum_candidate_pass_rate:0,minimum_delta:0}):EfficiencyRun{return{scenario_id:scenario,configuration,run_number:n,pass_rate:quality,model,reasoning,telemetry:telemetry(values),quality_requirement:req};}
const low={input_tokens:10,output_tokens:5,reasoning_tokens:2,cache_read_tokens:1,cache_write_tokens:1,total_tokens:19,turns:2,tool_calls:2,cost:.1,duration:1,ttfa:.2,retries:0};
const high={input_tokens:20,output_tokens:10,reasoning_tokens:4,cache_read_tokens:2,cache_write_tokens:2,total_tokens:38,turns:4,tool_calls:4,cost:.2,duration:2,ttfa:.4,retries:1};

test("quality-conditioned fixtures cover improvement, quality regressions, tradeoffs, unavailable dimensions, and mixed strata",()=>{
 const runs:EfficiencyRun[]=[run("efficient","with_skill",1,1,low),run("efficient","without_skill",1,1,high),run("regressed","with_skill",1,.5,low,"m","medium",{minimum_candidate_pass_rate:.8,minimum_delta:0}),run("regressed","without_skill",1,1,high,"m","medium",{minimum_candidate_pass_rate:.8,minimum_delta:0}),run("quality-tradeoff","with_skill",1,1,high),run("quality-tradeoff","without_skill",1,.5,low),run("mixed","with_skill",1,1,low,"a","low"),run("mixed","without_skill",1,1,high,"a","low"),run("mixed","with_skill",1,1,high,"b","high"),run("mixed","without_skill",1,1,low,"b","high")];
 const unavailable=run("unavailable","with_skill",1,1,low);unavailable.telemetry=null;runs.push(unavailable,run("unavailable","without_skill",1,1,high));
 const result=buildQualityConditionedEfficiency(runs,"with_skill","without_skill");
 assert.deepEqual(result.strata.map(s=>[s.scenario_id,s.model,s.reasoning,s.verdict]),[["efficient","m","medium","efficient_improvement"],["mixed","a","low","efficient_improvement"],["mixed","b","high","efficiency_regression"],["quality-tradeoff","m","medium","higher_quality_cost_tradeoff"],["regressed","m","medium","quality_regression"],["unavailable","m","medium","inconclusive"]]);
 const efficient=result.strata[0],tokens=efficient.metrics.find(m=>m.id==="total_tokens")!;assert.deepEqual({candidate:tokens.candidate.p50,baseline:tokens.baseline.p50,delta:tokens.delta.p50,n:tokens.delta.sample_count},{candidate:19,baseline:38,delta:-19,n:1});assert.equal(efficient.skill_context_overhead.availability,"unavailable");
 const regression=result.strata.find(s=>s.scenario_id==="regressed")!;assert.match(regression.explanation,/not an efficiency improvement/);
 const missing=result.strata.find(s=>s.scenario_id==="unavailable")!;assert.equal(missing.metrics.every(m=>m.delta.sample_count===0),true);assert.ok(missing.metrics[0].availability.reasons.length);
});

test("paired efficiency output is deterministic under reordered completion and reports p50/p95",()=>{
 const runs=[run("s","with_skill",2,1,{...low,total_tokens:17,output_tokens:3}),run("s","without_skill",2,1,high),run("s","without_skill",1,1,high),run("s","with_skill",1,1,low)];
 const a=buildQualityConditionedEfficiency(runs,"with_skill","without_skill"),b=buildQualityConditionedEfficiency([...runs].reverse(),"with_skill","without_skill");assert.deepEqual(a,b);const metric=a.strata[0].metrics.find(m=>m.id==="total_tokens")!;assert.deepEqual({p50:metric.delta.p50,p95:metric.delta.p95,n:metric.delta.sample_count},{p50:-20,p95:-19.1,n:2});
});

test("aggregation boundary excludes negative, unsafe, malformed, and cross-currency normalized values",()=>{
 const candidate=run("adversarial","with_skill",1,1,low),baseline=run("adversarial","without_skill",1,1,high);
 (candidate.telemetry as any).total_tokens.value=-1;
 (candidate.telemetry as any).turns.value=Number.MAX_SAFE_INTEGER+1;
 (candidate.telemetry as any).tool_calls={value:1};
 (candidate.telemetry as any).cost.currency="EUR";
 const s=buildQualityConditionedEfficiency([candidate,baseline],"with_skill","without_skill").strata[0];
 for(const id of ["total_tokens","turns","tool_calls","cost"]){const m=s.metrics.find(x=>x.id===id)!;assert.equal(m.delta.sample_count,0,id);assert.equal(m.availability.excluded_pair_count,1,id);assert.ok(m.availability.reasons.length,id);}
 assert.match(s.metrics.find(x=>x.id==="cost")!.availability.reasons.join(" "),/currency mismatch: candidate EUR, baseline USD/);
});

test("cost never combines currencies across pairs and reports the excluded units",()=>{
 const runs=[run("currency","with_skill",1,1,{...low,cost:.1}),run("currency","without_skill",1,1,{...high,cost:.2}),run("currency","with_skill",2,1,{...low,cost:.1}),run("currency","without_skill",2,1,{...high,cost:.2})];
 (runs[2].telemetry as any).cost.currency="EUR";(runs[3].telemetry as any).cost.currency="EUR";
 const cost=buildQualityConditionedEfficiency(runs,"with_skill","without_skill").strata[0].metrics.find(x=>x.id==="cost")!;
 assert.equal(cost.delta.sample_count,0);assert.equal(cost.unit,"currency");assert.match(cost.availability.reasons.join(" "),/mixed cost currencies excluded: EUR, USD/);
});

test("nonfinite and out-of-range quality values and thresholds fail closed",()=>{
 for(const mutate of [(c:EfficiencyRun)=>{c.pass_rate=Number.NaN},(c:EfficiencyRun)=>{c.pass_rate=1.1},(c:EfficiencyRun)=>{c.quality_requirement={minimum_candidate_pass_rate:Number.POSITIVE_INFINITY,minimum_delta:0}},(c:EfficiencyRun)=>{c.quality_requirement={minimum_candidate_pass_rate:0,minimum_delta:-2}}]){
  const c=run("quality-invalid","with_skill",1,1,low),b=run("quality-invalid","without_skill",1,1,high);mutate(c);const s=buildQualityConditionedEfficiency([c,b],"with_skill","without_skill").strata[0];assert.equal(s.verdict,"inconclusive");assert.equal(s.quality.regressed,null);assert.equal(s.quality.availability.available,false);assert.ok(s.quality.availability.reasons.length);
 }
});

test("downstream savings requires an actual lower paired downstream resource delta and remains non-causal",()=>{
 const same=buildQualityConditionedEfficiency([run("same","with_skill",1,1,low),run("same","without_skill",1,1,low)],"with_skill","without_skill").strata[0];assert.equal(same.downstream_execution_savings.availability,"no_savings");assert.deepEqual(same.downstream_execution_savings.observed_metric_ids,[]);
 const higher=buildQualityConditionedEfficiency([run("higher","with_skill",1,1,high),run("higher","without_skill",1,1,low)],"with_skill","without_skill").strata[0];assert.equal(higher.downstream_execution_savings.availability,"no_savings");
 const lower=buildQualityConditionedEfficiency([run("lower","with_skill",1,1,low),run("lower","without_skill",1,1,high)],"with_skill","without_skill").strata[0];assert.equal(lower.downstream_execution_savings.availability,"observed");assert.ok(lower.downstream_execution_savings.observed_metric_ids.length);assert.match(lower.downstream_execution_savings.attribution,/never causal/);
});

test("exact reproduction: input and matching total-token reductions never prove downstream execution savings",()=>{
 const candidate={...low,input_tokens:5,cache_read_tokens:0,cache_write_tokens:0,total_tokens:12};
 const baseline={...low,input_tokens:10,cache_read_tokens:0,cache_write_tokens:0,total_tokens:17};
 const s=buildQualityConditionedEfficiency([run("input-only","with_skill",1,1,candidate),run("input-only","without_skill",1,1,baseline)],"with_skill","without_skill").strata[0];
 assert.equal(s.metrics.find(m=>m.id==="input_tokens")!.delta.mean,-5);
 assert.equal(s.metrics.find(m=>m.id==="total_tokens")!.delta.mean,-5);
 assert.equal(s.downstream_execution_savings.availability,"no_savings");
 assert.deepEqual(s.downstream_execution_savings.observed_metric_ids,[]);
 assert.ok(s.downstream_execution_savings.excluded_metric_ids.includes("input_tokens"));
 assert.ok(s.downstream_execution_savings.excluded_metric_ids.includes("total_tokens"));
});

test("taxonomy boundary is explicit and unavailable decomposition fails attribution closed",()=>{
 const candidate=run("total-only","with_skill",1,1,{...low,input_tokens:5,total_tokens:14}),baseline=run("total-only","without_skill",1,1,{...low,input_tokens:10,total_tokens:19});
 for(const r of [candidate,baseline])for(const id of ["turns","output_tokens","reasoning_tokens","tool_calls","unique_tool_calls","references_read","unique_references_read","files_read","unique_files_read","time_to_first_useful_action_seconds","total_duration_seconds","retries"])(r.telemetry as any)[id]={value:null,source:"provider",reason:"component decomposition unavailable"};
 const result=buildQualityConditionedEfficiency([candidate,baseline],"with_skill","without_skill"),s=result.strata[0];
 assert.equal(s.downstream_execution_savings.availability,"unavailable");
 assert.match(s.downstream_execution_savings.attribution,/unavailable/);
 assert.deepEqual(s.metric_taxonomy.context_overhead_metric_ids,["input_tokens","cache_read_tokens","cache_write_tokens"]);
 assert.ok(s.metric_taxonomy.downstream_execution_metric_ids.includes("output_tokens"));
 assert.deepEqual(s.metric_taxonomy.overall_consumption_metric_ids,["total_tokens"]);
 assert.deepEqual(s.metric_taxonomy.resource_tradeoff_metric_ids,["cost"]);
 const total=s.metrics.find(m=>m.id==="total_tokens")!,cost=s.metrics.find(m=>m.id==="cost")!;
 assert.equal(total.taxonomy.downstream_savings_eligible,false);assert.match(total.taxonomy.boundary,/never independently prove/);
 assert.equal(cost.taxonomy.category,"resource_tradeoff");assert.equal(cost.taxonomy.downstream_savings_eligible,false);
 assert.match(result.downstream_savings_policy,/Input, cache, total tokens/);
});
