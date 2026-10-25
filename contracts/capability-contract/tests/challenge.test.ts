import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { challengeContractScenarios, hashChallengeScenarios } from "../dist/challenge.js";
import { CONTRACT_SCENARIO_CHALLENGE_VERSION } from "../dist/index.js";

const contract = {
  schemaVersion:"1.0.0", compatibility:{unknownFields:"reject"}, objective:"Draft release notes",
  users:[], targetTasks:[], artifactRecommendation:{candidateType:"skill"}, inputs:[], outputs:[],
  sideEffects:{applicable:false,effects:[]}, constraints:[], assumptions:[], risks:[],
  successSignals:[{name:"sections",metric:"present",operator:"=" as const,target:4}], targetHosts:[],
  productionBoundary:{level:"prototype" as const,statement:"Review required",conditions:[],excludedUses:[]}
};
const scenarios=[{id:"draft",description:"A maintainer drafts release notes."}];
const base=(reviews:unknown[], decisions?:unknown[])=>({version:"1.0.0",base:{revision:3,contract},scenarios,scenarioHash:hashChallengeScenarios(scenarios),reviews,...(decisions?{decisions}:{})});
const finding=(id:string, summary:string, risk:"low"|"medium"|"high", citation:unknown, proposedChange?:unknown)=>({id,summary,risk,citation,...(proposedChange?{proposedChange}:{})});

test("consolidates true duplicates across bounded roles but preserves disagreement",()=>{
  const duplicate=finding("d1","Terminology is vague","low",{kind:"contract-field",path:"/objective"});
  const result=challengeContractScenarios(base([
    {role:"domain",findings:[duplicate]},
    {role:"ux",findings:[{...duplicate,id:"u1"}]},
    {role:"safety",findings:[finding("s1","Objective permits unsafe publication","high",{kind:"contract-field",path:"/objective"})]},
  ]));
  assert.equal(result.findings.length,2);
  const advisory=result.findings.find((item)=>item.id==="d1")!;
  assert.deepEqual(advisory.roles,["domain","ux"]);
  assert.deepEqual(advisory.sourceFindingIds,["d1","u1"]);
  assert.deepEqual(advisory.disagreementWith,["s1"]);
  assert.equal(advisory.advisory,true);
  assert.equal(advisory.blocking,false);
  assert.deepEqual(result.blockers,["s1"]);
  assert.deepEqual(result.unknowns,["s1"]);
  assert.equal(result.canProceed,false);
});

test("accepted change creates next immutable revision and invalidates scenario hash",()=>{
  const reviews=[{role:"domain",findings:[finding("d1","Clarify objective","medium",{kind:"contract-field",path:"/objective"},{path:"/objective",value:"Draft reviewed release notes"})]}];
  const input=base(reviews,[{findingId:"d1",decision:"accepted"}]); const before=JSON.stringify(input);
  const a=challengeContractScenarios(input), b=challengeContractScenarios(input);
  assert.deepEqual(a,b); assert.equal(JSON.stringify(input),before);
  assert.equal(a.revision.revision,4); assert.equal(a.revision.contract.objective,"Draft reviewed release notes");
  assert.equal(contract.objective,"Draft release notes");
  assert.deepEqual(a.scenario,{previousHash:hashChallengeScenarios(scenarios),hash:null,invalidated:true});
});

test("rejected and unresolved low impact findings remain nonblocking without revision",()=>{
  const reviews=[{role:"evaluation",findings:[finding("e1","Add another metric","low",{kind:"scenario",scenarioId:"draft"})]}];
  const result=challengeContractScenarios(base(reviews));
  assert.equal(result.canProceed,true); assert.deepEqual(result.blockers,[]); assert.equal(result.revision.revision,3);
  assert.equal(result.scenario.hash,result.scenario.previousHash); assert.equal(result.scenario.invalidated,false);
});

test("conflicting decisions on duplicate reports preserve unresolved status",()=>{
  const f=finding("a","Same concern","high",{kind:"scenario",scenarioId:"draft"});
  const result=challengeContractScenarios(base([{role:"domain",findings:[f]},{role:"ux",findings:[{...f,id:"b"}]}],[{findingId:"a",decision:"accepted"},{findingId:"b",decision:"rejected"}]));
  assert.equal(result.findings[0].status,"unresolved"); assert.equal(result.findings[0].blocking,true);
});

test("strictly rejects hostile, stale, unknown, unbounded, and unsafe input",()=>{
  const valid=base([]); const getter=Object.defineProperty({},"version",{enumerable:true,get(){throw new Error("secret")}}); const cycle:Record<string,unknown>={};cycle.self=cycle;
  const stale={...valid,scenarioHash:"0".repeat(64)};
  const unknown={...valid,extra:true};
  const badCitation=base([{role:"domain",findings:[finding("x","bad","low",{kind:"scenario",scenarioId:"missing"})]}]);
  const poison=base([{role:"domain",findings:[finding("x","bad","low",{kind:"contract-field",path:"/__proto__/polluted"})]}]);
  const tooMany=base([{role:"domain",findings:Array.from({length:26},(_,i)=>finding(`f${i}`,"x","low",{kind:"scenario",scenarioId:"draft"}))}]);
  for(const bad of [getter,cycle,stale,unknown,badCitation,poison,tooMany]) assert.throws(()=>challengeContractScenarios(bad),TypeError);
});

test("scenario hash is deterministic across scenario ordering",()=>{
  const a=[{id:"b",description:"B"},{id:"a",description:"A"}];
  assert.equal(hashChallengeScenarios(a),hashChallengeScenarios([...a].reverse()));
});


test("accepted conflicting or overlapping changes remain explicit blockers and do not mutate the revision",()=>{
  const reviews=[{role:"domain",findings:[
    finding("a","Use reviewed wording","low",{kind:"contract-field",path:"/objective"},{path:"/objective",value:"Reviewed notes"}),
    finding("b","Use approved wording","medium",{kind:"contract-field",path:"/objective"},{path:"/objective",value:"Approved notes"}),
  ]}];
  const result=challengeContractScenarios(base(reviews,[{findingId:"a",decision:"accepted"},{findingId:"b",decision:"accepted"}]));
  assert.equal(result.canProceed,false); assert.deepEqual(result.blockers,["a","b"]); assert.deepEqual(result.unknowns,["a","b"]);
  assert.equal(result.revision.revision,3); assert.equal(result.revision.contract.objective,contract.objective); assert.equal(result.scenario.invalidated,false);
  assert.deepEqual(result.findings.map((item)=>[item.id,item.status,item.disagreementWith]).sort(),[["a","unresolved",["b"]],["b","unresolved",["a"]]]);
});

test("duplicate representative and complete output are permutation-invariant",()=>{
  const findings=[finding("z","Duplicate","low",{kind:"scenario",scenarioId:"draft"}),finding("a","Duplicate","low",{kind:"scenario",scenarioId:"draft"})];
  const first=challengeContractScenarios(base([{role:"domain",findings}]));
  const second=challengeContractScenarios(base([{role:"domain",findings:[...findings].reverse()}]));
  assert.deepEqual(first,second); assert.equal(first.findings[0].id,"a"); assert.deepEqual(first.findings[0].sourceFindingIds,["a","z"]);
});

test("proposed values are strict bounded recursive JSON",()=>{
  const request=(value:unknown)=>base([{role:"domain",findings:[finding("x","change","low",{kind:"contract-field",path:"/objective"},{path:"/objective",value})]}]);
  const sparse=new Array(1), accessor=Object.defineProperty({},"x",{enumerable:true,get(){return 1;}});
  for(const value of [undefined,()=>0,Symbol("x"),1n,NaN,Infinity,sparse,accessor]) assert.throws(()=>challengeContractScenarios(request(value)),TypeError);
  assert.doesNotThrow(()=>challengeContractScenarios(request({nested:[null,true,1,"x"]})));
});

test("challenge schema independently compiles strictly and validates request and result fixtures",()=>{
  const schema=JSON.parse(readFileSync(new URL("../schema/challenge/1.0.0/contract-scenario-challenge.schema.json",import.meta.url),"utf8"));
  const capabilitySchema=JSON.parse(readFileSync(new URL("../schema/1.0.0/capability-contract.schema.json",import.meta.url),"utf8"));
  const ajv=new Ajv2020({allErrors:true,strict:true}); ajv.addSchema(capabilitySchema); const validate=ajv.compile(schema);
  const request=JSON.parse(readFileSync(new URL("../fixtures/challenge/request.json",import.meta.url),"utf8"));
  const result=JSON.parse(readFileSync(new URL("../fixtures/challenge/result.json",import.meta.url),"utf8"));
  assert.equal(validate(request),true,JSON.stringify(validate.errors)); assert.equal(validate(result),true,JSON.stringify(validate.errors));
  assert.equal(validate({version:"1.0.0"}),false);
});

test("schema, fixture, and root exports are versioned and parseable",()=>{
  const schema=JSON.parse(readFileSync(new URL("../schema/challenge/1.0.0/contract-scenario-challenge.schema.json",import.meta.url),"utf8"));
  const fixture=JSON.parse(readFileSync(new URL("../fixtures/challenge/scenarios.json",import.meta.url),"utf8"));
  assert.equal(CONTRACT_SCENARIO_CHALLENGE_VERSION,"1.0.0");
  assert.equal(schema.$defs.request.properties.version.const,"1.0.0");
  assert.equal(fixture.version,"1.0.0");
  assert.equal(fixture.cases.length,5);
});
