#!/usr/bin/env node
import { mkdtempSync, mkdirSync, cpSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { verifyProduction, smokeProduction } from './production.mjs';
const candidate=path.resolve(process.argv[2]??'');verifyProduction(candidate);smokeProduction(candidate);
const work=mkdtempSync(path.join(tmpdir(),'production-goose-install-'));
try{
 const repo=path.join(work,'repo'),home=path.join(work,'home'),paths=path.join(work,'goose'),foreign=path.join(work,'foreign');cpSync(candidate,repo,{recursive:true});mkdirSync(home);mkdirSync(foreign);
 const env={...process.env,HOME:home,GOOSE_PATH_ROOT:paths,GIT_CONFIG_NOSYSTEM:'1'};
 const run=(command,args,cwd=repo)=>{const r=spawnSync(command,args,{cwd,env,encoding:'utf8',timeout:120000});if(r.status!==0)throw new Error(command+' failed: '+r.stderr);return r.stdout;};
 const goose=process.env.GOOSE_EXECUTABLE||'goose';if(!/1\.47\.0\b/.test(run(goose,['--version'])))throw new Error('requires verified Goose 1.47.0');
 run('git',['init','-q']);run('git',['config','user.name','Production QA']);run('git',['config','user.email','qa@example.invalid']);run('git',['add','-A']);run('git',['commit','-qm','production candidate']);
 const output=run(goose,['plugin','install','--auto-update',pathToFileURL(repo).href],foreign);if(!output.includes('agent-plugins:skill-creator'))throw new Error('missing namespaced Skill');
 const installed=path.join(paths,'.agents/plugins/agent-plugins');
 for(const forbidden of ['apps','vendor','contracts','tests','scripts','package.json','.beads'])if(existsSync(path.join(installed,forbidden)))throw new Error('development leakage: '+forbidden);
 for(const name of ['agent-creator','hook-creator','plugin-creator','skill-creator']){const r=spawnSync(process.execPath,[path.join(installed,'skills',name,'scripts',name+'.mjs'),'--help'],{cwd:foreign,env:{HOME:home,PATH:'',NODE_PATH:'',LANG:'C'},encoding:'utf8',timeout:30000});if(r.status!==0||r.stderr)throw new Error('installed runtime failed: '+name);}
 const meta=JSON.parse(readFileSync(path.join(installed,'.goose-plugin-install.json'),'utf8'));if(meta.source_type!=='git'||!meta.auto_update)throw new Error('wrong Git update metadata');
 const file=path.join(repo,'plugin.json'),plugin=JSON.parse(readFileSync(file,'utf8'));plugin.version+='-qa';writeFileSync(file,JSON.stringify(plugin));run('git',['add','plugin.json']);run('git',['commit','-qm','QA update']);run(goose,['plugin','update','agent-plugins'],foreign);
 if(JSON.parse(readFileSync(path.join(installed,'plugin.json'),'utf8')).version!==plugin.version)throw new Error('update did not replace distribution');
 console.log(JSON.stringify({status:'passed',gitInstall:true,gitUpdate:true,standaloneCommands:4,developmentLeakage:0}));
}finally{rmSync(work,{recursive:true,force:true});}
