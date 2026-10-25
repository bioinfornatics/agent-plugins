#!/usr/bin/env node
/** Rebuild tracked outputs from source; reject drift rather than silently publishing it. */
import { execFileSync } from 'node:child_process';
const run=(file,cwd=process.cwd())=>execFileSync(process.execPath,[file],{cwd,stdio:'inherit'});
run('scripts/verify-repository-integrity.mjs');
for(const name of ['agent','hook','plugin','skill'])run('scripts/build.mjs','apps/'+name+'-creator-cli');
run('scripts/build.mjs','contracts/capability-contract');
run('contracts/capability-contract/scripts/refresh-compatibility-fixtures.mjs');
run('scripts/generate-skill-runtimes.mjs');
const status=execFileSync('git',['status','--porcelain','--','apps','contracts','skills'],{encoding:'utf8'});
if(status.trim())throw new Error('clean rebuild differs from committed outputs; regenerate on development before promotion:\n'+status);
console.log(JSON.stringify({status:'passed',cleanBuild:true,committedOutputDrift:0}));
