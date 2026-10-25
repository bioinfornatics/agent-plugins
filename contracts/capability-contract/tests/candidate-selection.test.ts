import {test} from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";import {join,dirname} from "node:path";import {fileURLToPath} from "node:url";import Ajv2020 from "ajv/dist/2020.js";import {selectCandidate,validateCandidateSelection,canonicalSerializeCandidateSelection,CandidateSelectionValidationError} from "../dist/index.js";
const root=join(dirname(fileURLToPath(import.meta.url)),"..");const sample=()=>JSON.parse(readFileSync(join(root,"fixtures/candidate-selection/valid.json"),"utf8"));
test("selects unique Pareto winner with hash/evidence trace and permutation invariance",()=>{const a=sample(),x=selectCandidate(a);assert.equal(x.status,"selected");assert.equal(x.selectedCandidateId,"alpha");assert.match(x.inputHash,/^[a-f0-9]{64}$/);assert.equal(x.traces[0].evidenceHashes.length,4);const b=sample();b.candidates.reverse();for(const c of b.candidates)for(const m of Object.values(c.metrics) as any[])m.evidenceHashes.reverse();assert.equal(canonicalSerializeCandidateSelection(a),canonicalSerializeCandidateSelection(b));assert.deepEqual(selectCandidate(a),selectCandidate(b));});
test("critical safety veto is absolute, including override",()=>{const x=sample();x.candidates[0].metrics.safety.lowerBound=.79;x.override={candidateId:"alpha",nonSafetyOnly:true,identity:{actorId:"reviewer-1",role:"approver"},rationale:"Reviewed non-safety tradeoff."};assert.throws(()=>selectCandidate(x),CandidateSelectionValidationError);delete x.override;const d=selectCandidate(x);assert.equal(d.traces.find((t:any)=>t.candidateId==="alpha").reason,"critical-safety-veto");});
test("Pareto conflict and uncertainty are inconclusive; attributable non-safety override resolves only safe candidates",()=>{const x=sample();x.candidates[1].metrics.effectiveness.lowerBound=.9;x.candidates[1].metrics.effectiveness.estimate=.92;x.candidates[1].metrics.effectiveness.upperBound=.95;let d=selectCandidate(x);assert.equal(d.status,"inconclusive");assert.equal(d.humanDecisionRequired,true);x.override={candidateId:"beta",nonSafetyOnly:true,identity:{actorId:"reviewer-1",role:"approver"},rationale:"Accept productivity tradeoff after review."};d=selectCandidate(x);assert.equal(d.reason,"non-safety-human-override");assert.deepEqual(d.override?.identity,{actorId:"reviewer-1",role:"approver"});const y=sample();for(const c of y.candidates)c.metrics.productivity.sampleSize=2;assert.equal(selectCandidate(y).status,"inconclusive");});
test("hostile validation is total, strict, bounded, and finite",()=>{for(const mutate of [(x:any)=>x.evil=true,(x:any)=>x.candidates[0].metrics.safety.lowerBound=NaN,(x:any)=>x.candidates[0].metrics.safety.extra=true,(x:any)=>x.candidates[1].candidateHash=x.candidates[0].candidateHash,(x:any)=>x.uncertainty.maximumSamples=1]){const x=sample();mutate(x);assert.equal(validateCandidateSelection(x).valid,false);}const x=sample();Object.defineProperty(x,"objective",{get(){throw new Error("boom")}});assert.equal(validateCandidateSelection(x).valid,false);});
test("input and decision JSON schemas accept fixtures and reject nested extras",()=>{const ajv=new Ajv2020({strict:true,allErrors:true});const schema=JSON.parse(readFileSync(join(root,"schema/candidate-selection/1.0.0/candidate-selection.schema.json"),"utf8"));const decisionSchema=JSON.parse(readFileSync(join(root,"schema/candidate-selection/1.0.0/candidate-selection-decision.schema.json"),"utf8"));const validate=ajv.compile(schema),validateDecision=ajv.compile(decisionSchema);const x=sample();assert.equal(validate(x),true,JSON.stringify(validate.errors));assert.equal(validateDecision(selectCandidate(x)),true,JSON.stringify(validateDecision.errors));x.candidates[0].metrics.safety.extra=true;assert.equal(validate(x),false);});

test("decision embeds the exact configured selection and uncertainty policy",()=>{
  const x=sample(),d=selectCandidate(x);
  assert.deepEqual(d.objective,{
    formula:"sum(weight[dimension] * lowerBound[dimension]) / sum(weights)",
    dimensions:["effectiveness","productivity","stability","safety"],
    weights:x.objective.weights,tieTolerance:x.objective.tieTolerance,
    thresholds:x.objective.thresholds,criticalSafetyMinimum:x.objective.criticalSafetyMinimum
  });
  assert.deepEqual(d.uncertainty,x.uncertainty);
});

test("rejects symbols, non-enumerable properties, and non-plain data descriptors at every depth",()=>{
  const hostile:Array<(x:any)=>void>=[
    x=>{x[Symbol("hidden")]=true;},
    x=>{x.objective.weights[Symbol("hidden")]=1;},
    x=>Object.defineProperty(x,"hidden",{value:true,enumerable:false}),
    x=>Object.defineProperty(x.objective,"kind",{value:x.objective.kind,enumerable:true,writable:false,configurable:true}),
    x=>Object.defineProperty(x.candidates[0].metrics.safety,"estimate",{value:.94,enumerable:true,writable:true,configurable:false}),
    x=>Object.defineProperty(x.candidates,"hidden",{value:true,enumerable:false}),
  ];
  for(const mutate of hostile){const x=sample();mutate(x);assert.equal(validateCandidateSelection(x).valid,false);}
});

test("metric intervals are ordered and schema/runtime fixtures stay structurally aligned",()=>{
  const ajv=new Ajv2020({strict:true,allErrors:true});
  const inputSchema=JSON.parse(readFileSync(join(root,"schema/candidate-selection/1.0.0/candidate-selection.schema.json"),"utf8"));
  const decisionSchema=JSON.parse(readFileSync(join(root,"schema/candidate-selection/1.0.0/candidate-selection-decision.schema.json"),"utf8"));
  const validateInput=ajv.compile(inputSchema),validateDecision=ajv.compile(decisionSchema);
  const valid=sample(),decision=selectCandidate(valid);
  assert.equal(validateInput(valid),true,JSON.stringify(validateInput.errors));
  assert.equal(validateCandidateSelection(valid).valid,true);
  assert.equal(validateDecision(decision),true,JSON.stringify(validateDecision.errors));
  for(const values of [[.7,.8,.9],[.9,.8,.85]]){
    const x=sample(),m=x.candidates[0].metrics.effectiveness;
    [m.estimate,m.lowerBound,m.upperBound]=values;
    assert.equal(validateCandidateSelection(x).valid,false,"runtime enforces lowerBound <= estimate <= upperBound");
  }
  const samples=sample();samples.uncertainty.minimumSamples=50;samples.uncertainty.maximumSamples=49;
  assert.equal(validateInput(samples),true,"portable schema accepts the structurally valid cross-field case");
  assert.equal(validateCandidateSelection(samples).valid,false,"runtime enforces maximumSamples >= minimumSamples");
  const interval=sample();interval.candidates[0].metrics.effectiveness={...interval.candidates[0].metrics.effectiveness,estimate:.7,lowerBound:.8,upperBound:.9};
  assert.equal(validateInput(interval),true,"portable schema accepts the structurally valid interval case");
  assert.equal(validateCandidateSelection(interval).valid,false,"runtime supplies the documented cross-field invariant");
});

test("candidate IDs and hashes are independently unique",()=>{
  for(const field of ["candidateId","candidateHash"] as const){const x=sample();x.candidates[1][field]=x.candidates[0][field];assert.equal(validateCandidateSelection(x).valid,false);}
});

test("only eligible non-veto candidates participate in Pareto dominance and reasons",()=>{
  const x=sample();
  x.candidates[0].metrics.safety.lowerBound=.79;
  x.candidates[0].metrics.safety.estimate=.82;
  x.candidates[0].metrics.safety.upperBound=.84;
  const d=selectCandidate(x),alpha=d.traces.find(t=>t.candidateId==="alpha")!,beta=d.traces.find(t=>t.candidateId==="beta")!;
  assert.equal(d.selectedCandidateId,"beta");
  assert.deepEqual(alpha.paretoDominatedBy,[]);
  assert.equal(alpha.reason,"critical-safety-veto");
  assert.deepEqual(beta.paretoDominatedBy,[]);
  assert.notEqual(beta.reason,"pareto-dominated");

  const y=sample();y.candidates[0].metrics.productivity.lowerBound=.49;
  const dy=selectCandidate(y),by=dy.traces.find(t=>t.candidateId==="beta")!;
  assert.equal(dy.selectedCandidateId,"beta");
  assert.deepEqual(by.paretoDominatedBy,[]);
});
