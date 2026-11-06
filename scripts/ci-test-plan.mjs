/** Closed CI partition: every current agent-plugin test appears exactly once. */
import {readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function discoverAppTests(base=root){
 const directory=path.join(base,'apps/agent-plugin/tests');
 function walk(relative=''){return readdirSync(path.join(directory,relative),{withFileTypes:true}).flatMap(entry=>{
  const member=path.posix.join(relative,entry.name);
  return entry.isDirectory()?walk(member):entry.isFile()&&member.endsWith('.test.ts')?[member]:[];
 });}
 return walk().sort();
}
export function validateShardPlan(plan,actual){
 if(plan?.schemaVersion!==1||!Array.isArray(plan.shards)||plan.shards.length!==4)throw Error('CI requires four shards');
 const ids=plan.shards.map(s=>s.id);if(JSON.stringify(ids)!=='[1,2,3,4]')throw Error('invalid shard ids');
 const members=[];
 for(const shard of plan.shards){if(!Array.isArray(shard.files)||!shard.files.length)throw Error('empty shard');for(const f of shard.files){if(typeof f!=='string'||!/^(?:[a-z0-9-]+\/)*[a-z0-9-]+\.test\.ts$/.test(f))throw Error('unsafe test member');members.push(f);}}
 if(new Set(members).size!==members.length)throw Error('duplicate shard membership');
 if(JSON.stringify([...members].sort())!==JSON.stringify([...actual].sort()))throw Error('test partition is incomplete or stale');
 return plan;
}
export function loadTestPlan(base=root){return validateShardPlan(JSON.parse(readFileSync(path.join(base,'config/ci/skill-test-shards.json'),'utf8')),discoverAppTests(base));}
export const quickGroups=[
 {files:['scaffold/entrypoint.test.ts','scaffold/cli-output.test.ts']},
 {files:['evaluation/preparation.test.ts','execution/host-selection.test.ts']},
];
// Removed creator grading/report/browser/native campaigns are historical evidence,
// not accepted replacements. Current seams cover preparation, execution, registry,
// contained Node packaging and trust/production/cleanup contracts in the remainder.
export const retiredGuarantees=[
 {guarantee:'legacy creator validation, authoring, grading and report commands',status:'retired-not-accepted',replacement:'agent-plugin preparation/execution/registry tests cover only the new evaluation surface'},
 {guarantee:'Bun standalone executables, offline native bundle and five-platform native release packaging',status:'retired-not-accepted',replacement:'contained Node build/package and Git-install contracts; no native compatibility claim'},
 {guarantee:'legacy delegated/domain grading projections and browser/keyring campaigns',status:'retired-not-accepted',replacement:'none; no acceptance claimed'},
];
export const remainingRootTests=[
 'test_skill_runtime_generation.test.ts','test_goose_hook_compatibility.test.ts',
 'test_distribution.test.ts','test_goose_git_install.test.ts','test_production_install_contract.test.ts',
 'test_developer_facade.test.ts','test_ci_verification.test.ts','test_clean.test.ts',
 'test_reproducibility_contract.test.ts','test_production.test.ts','test_inert_fixtures.test.ts',
 'test_report_generator.test.ts',
];
