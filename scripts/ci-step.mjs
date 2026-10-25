#!/usr/bin/env node
/** Bounded console output, complete file logs and exact child failure propagation. */
import { mkdirSync, openSync, closeSync, readFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const [label,command,...args]=process.argv.slice(2);
if(!/^[a-z][a-z0-9-]*$/.test(label??'')||!command)throw new Error('usage: ci-step.mjs <label> <command> [arguments]');
mkdirSync('.artifacts/ci-logs',{recursive:true});
const log=path.resolve('.artifacts/ci-logs',label+'.log'),fd=openSync(log,'w'),start=Date.now();
console.log('Starting '+label+'; full log: '+log);
let result;try{result=spawnSync(command,args,{stdio:['ignore',fd,fd]});}finally{closeSync(fd);}
const lines=readFileSync(log,'utf8').split('\n');
const status=result.error||result.signal||result.status!==0?'FAIL':'PASS';
const summary=label+': '+status+' ('+((Date.now()-start)/1000).toFixed(1)+'s, '+lines.length+' log lines)';
console.log(summary);
console.log(lines.filter(line=>/^(> |# (tests|pass|fail|skipped)|.*"status":"passed")/.test(line)).slice(-60).join('\n'));
if(status==='FAIL'){console.error(String(result.error??result.signal??''));console.error(lines.slice(-100).join('\n'));}
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,'- '+summary+'; details in ci-logs artifact\n');
process.exitCode=status==='PASS'?0:result.status||1;
