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
 const expected=['agent-creator','hook-creator','plugin-creator','plugin-script-packaging','skill-creator'].sort();
 const checkDiscovery=()=>{
  const listing=run(goose,['skills','list'],foreign);
  const rows=listing.split('\n').filter(line=>line.includes(installed));
  const names=rows.map(line=>line.split('|')[0].trim().replace(/^agent-plugins:/,'')).sort();
  if(JSON.stringify(names)!==JSON.stringify(expected))throw new Error('unexpected installed Skill discovery: '+JSON.stringify(names)+'\n'+listing);
  if(rows.some(line=>line.includes('/assets/')||line.includes('/runtime/')))throw new Error('nested Skill discovered');
 };
 checkDiscovery();
 for(const forbidden of ['apps','vendor','contracts','tests','scripts','package.json','.beads'])if(existsSync(path.join(installed,forbidden)))throw new Error('development leakage: '+forbidden);
 for(const name of ['agent-creator','hook-creator','plugin-creator','skill-creator']){const r=spawnSync(process.execPath,[path.join(installed,'skills',name,'scripts',name+'.mjs'),'--help'],{cwd:foreign,env:{HOME:home,PATH:'',NODE_PATH:'',LANG:'C'},encoding:'utf8',timeout:30000});if(r.status!==0||r.stderr)throw new Error('installed runtime failed: '+name);}
 const meta=JSON.parse(readFileSync(path.join(installed,'.goose-plugin-install.json'),'utf8'));if(meta.source_type!=='git'||!meta.auto_update)throw new Error('wrong Git update metadata');
 // Model an older installed distribution: update must remove obsolete fixtures.
 const legacy=path.join(installed,'skills/skill-creator/assets/evaluation-fixtures/frontmatter-invalid');
 mkdirSync(legacy,{recursive:true});writeFileSync(path.join(legacy,'SKILL.md.fixture'),'obsolete fixture');
 const file=path.join(repo,'plugin.json'),plugin=JSON.parse(readFileSync(file,'utf8'));plugin.version+='-qa';writeFileSync(file,JSON.stringify(plugin));run('git',['add','plugin.json']);run('git',['commit','-qm','QA update']);run(goose,['plugin','update','agent-plugins'],foreign);
 if(JSON.parse(readFileSync(path.join(installed,'plugin.json'),'utf8')).version!==plugin.version)throw new Error('update did not replace distribution');
 if(existsSync(legacy))throw new Error('update retained obsolete evaluation fixture');
 checkDiscovery();
 const updatedMeta=JSON.parse(readFileSync(path.join(installed,'.goose-plugin-install.json'),'utf8'));
 if(!updatedMeta.auto_update||updatedMeta.source_type!=='git')throw new Error('update lost Git metadata');
 console.log(JSON.stringify({status:'passed',gitInstall:true,gitUpdate:true,skillsListAfterInstall:true,skillsListAfterUpdate:true,discoveredSkills:expected.length,standaloneCommands:4,developmentLeakage:0}));
}finally{rmSync(work,{recursive:true,force:true});}
