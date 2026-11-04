#!/usr/bin/env node
/** Current source rebuild; reject changed generated output rather than publish drift. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,lstatSync} from 'node:fs';
const roots=['apps/agent-plugin/dist','skills/skill-creator/runtime','skills/skill-creator/scripts/skill-creator.mjs'];
function snapshot(){const rows=[];function walk(p){const stat=lstatSync(p);if(stat.isSymbolicLink())throw Error('generated symlink');if(stat.isDirectory())for(const n of readdirSync(p).sort())walk(p+'/'+n);else rows.push([p,createHash('sha256').update(readFileSync(p)).digest('hex'),stat.mode&0o777]);}for(const p of roots)walk(p);return JSON.stringify(rows);}
const before=snapshot();
const run=(file,cwd=process.cwd())=>execFileSync(process.execPath,[file],{cwd,stdio:'inherit'});
run('scripts/verify-repository-integrity.mjs');
run('scripts/build.mjs','apps/agent-plugin');
run('scripts/generate-skill-runtimes.mjs');
if(snapshot()!==before)throw Error('clean rebuild differs from committed outputs');
console.log(JSON.stringify({status:'passed',cleanBuild:true,committedOutputDrift:0}));
