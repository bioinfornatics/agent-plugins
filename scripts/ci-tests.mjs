#!/usr/bin/env node
/** Execute a closed CI group; no builds race with test consumers. */
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadTestPlan,quickGroups} from './ci-test-plan.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),app=path.join(root,'apps/skill-creator-cli');
const [mode,arg,...extra]=process.argv.slice(2);
if(extra.length||!['quick','skill','remaining','plan'].includes(mode)||(mode==='skill'?!/^[1-4]$/.test(arg??''):arg!==undefined))throw Error('usage: ci-tests.mjs <quick|skill 1..4|remaining|plan>');
const plan=loadTestPlan(root);
const env={...process.env,SKILL_CREATOR_SKILL_ROOT:path.join(root,'skills/skill-creator')};
for(const key of ['NODE_TEST_CONTEXT','PLAYWRIGHT_MODULE_PATH','PLAYWRIGHT_CHROMIUM_EXECUTABLE','CHROME','NODE_PATH'])delete env[key];
function run(argv,cwd=app){const result=spawnSync(process.execPath,argv,{cwd,env,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0||result.signal)process.exit(result.status||1);}
if(mode==='plan'){console.log(JSON.stringify(plan));}
else if(mode==='quick'){run(['--test',path.join(root,'tests/test_ci_verification.test.ts')],root);for(const group of quickGroups)run(['--test','--test-concurrency=2',...(group.pattern?['--test-name-pattern='+group.pattern]:[]),...group.files.map(f=>path.join('tests',f))]);}
else if(mode==='skill'){run(['--test','--test-concurrency=2',...plan.shards[Number(arg)-1].files.map(f=>path.join('tests',f))]);}
else {
 // Reuse the complete production runner, with a strictly declared omission: Skill
 // Creator is required separately by all four CI shards, never silently optional.
 run([path.join(root,'scripts/test.mjs'),'--profile=production','--ci-skill-shards'],root);
}
