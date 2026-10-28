/** Closed CI partition: every current Skill Creator test file appears exactly once. */
import {readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function validateShardPlan(plan,actual){
 if(plan?.schemaVersion!==1||!Array.isArray(plan.shards)||plan.shards.length!==4)throw Error('CI requires four shards');
 const ids=plan.shards.map(s=>s.id);if(JSON.stringify(ids)!=='[1,2,3,4]')throw Error('invalid shard ids');
 const members=[];
 for(const shard of plan.shards){if(!Array.isArray(shard.files)||!shard.files.length)throw Error('empty shard');for(const f of shard.files){if(typeof f!=='string'||!/^test_[a-z0-9_]+\.test\.ts$/.test(f))throw Error('unsafe test member');members.push(f);}}
 if(new Set(members).size!==members.length)throw Error('duplicate shard membership');
 if(JSON.stringify([...members].sort())!==JSON.stringify([...actual].sort()))throw Error('test partition is incomplete or stale');
 return plan;
}
export function loadTestPlan(base=root){const actual=readdirSync(path.join(base,'apps/skill-creator-cli/tests')).filter(f=>f.endsWith('.test.ts'));return validateShardPlan(JSON.parse(readFileSync(path.join(base,'config/ci/skill-test-shards.json'),'utf8')),actual);}
export const quickGroups=[
 {files:['test_isolated_evaluation.test.ts'],pattern:'skill-creator launcher forwards the selected model'},
 {files:['test_corrective_outcomes.test.ts'],pattern:'mock grader ordinals|adaptive unavailable round'},
 {files:['test_evaluation_process.test.ts']},
];
