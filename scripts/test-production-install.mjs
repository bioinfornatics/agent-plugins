#!/usr/bin/env node
import { mkdtempSync, mkdirSync, cpSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { verifyProduction } from './production.mjs';

export const expectedSkills = ['agent-creator','hook-creator','plugin-creator','plugin-script-packaging','skill-creator'];
export function isolatedEnvironment(work, parent = process.env) {
  // Allowlist instead of inheritance: Git config/identity, hooks, credentials,
  // provider configuration and Node loader overrides must not cross this boundary.
  return { PATH: parent.PATH ?? '', LANG: 'C', LC_ALL: 'C', HOME: path.join(work,'home'),
    XDG_CONFIG_HOME: path.join(work,'config'), XDG_DATA_HOME: path.join(work,'data'),
    XDG_STATE_HOME: path.join(work,'state'), XDG_CACHE_HOME: path.join(work,'cache'),
    XDG_RUNTIME_DIR: path.join(work,'run'), GOOSE_PATH_ROOT: path.join(work,'goose'),
    TMPDIR: path.join(work,'tmp'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(work,'empty-gitconfig'),
    GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Production QA', GIT_AUTHOR_EMAIL: 'qa@example.invalid',
    GIT_COMMITTER_NAME: 'Production QA', GIT_COMMITTER_EMAIL: 'qa@example.invalid',
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: path.join(work,'empty-hooks') };
}
export function runCommand(command, args, { cwd, env, timeout = 120000 }) {
  const result = spawnSync(command,args,{cwd,env,encoding:'utf8',timeout});
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error?.message ?? result.signal ?? `exit ${result.status}`}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
  return result.stdout;
}
export function selectGoose(env = process.env) {
  const executable = env.GOOSE_EXECUTABLE || env.GOOSE_TEST_BINARY;
  if (!executable) throw new Error('required Git install gate: set GOOSE_EXECUTABLE or GOOSE_TEST_BINARY explicitly');
  if (env.GOOSE_EXECUTABLE && env.GOOSE_TEST_BINARY && path.resolve(env.GOOSE_EXECUTABLE) !== path.resolve(env.GOOSE_TEST_BINARY)) throw new Error('conflicting explicit Goose executables');
  // Resolve before entering the empty project; never silently search PATH.
  return path.resolve(executable);
}
export function testProductionInstall(input, options = {}) {
  if (!input) throw new Error('usage: test-production-install.mjs <candidate-directory>');
  const candidate = path.resolve(input), goose = selectGoose(options.env ?? process.env);
  const manifest = verifyProduction(candidate);
  const work = mkdtempSync(path.join(tmpdir(),'production-goose-install-'));
  try {
    const env = isolatedEnvironment(work, options.env ?? process.env);
    for (const key of ['HOME','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_STATE_HOME','XDG_CACHE_HOME','XDG_RUNTIME_DIR','GOOSE_PATH_ROOT','TMPDIR']) mkdirSync(env[key],{recursive:true,mode:0o700});
    mkdirSync(env.GIT_CONFIG_VALUE_0); writeFileSync(env.GIT_CONFIG_GLOBAL,'');
    const repo = path.join(work,'repo'), project = path.join(work,'empty-project');
    mkdirSync(project); cpSync(candidate,repo,{recursive:true});
    const run = (command,args,cwd=project) => runCommand(command,args,{cwd,env});
    const version = run(goose,['--version']).trim();
    if (!/^(?:goose\s+)?\d+\.\d+\.\d+(?:\s|$)/.test(version)) throw new Error('unrecognized Goose version: '+version);
    const sha256 = createHash('sha256').update(readFileSync(goose)).digest('hex');
    // Version is evidence, not a compatibility guess: require the actual local
    // host's documented command surfaces before attempting a native install.
    const installHelp=run(goose,['plugin','install','--help']);
    const updateHelp=run(goose,['plugin','update','--help']);
    const listHelp=run(goose,['skills','list','--help']);
    if (!installHelp.includes('<URL>') || !installHelp.includes('--auto-update') || !updateHelp.includes('<NAME>') || !listHelp.includes('Usage:')) throw new Error('Goose version does not support required Git plugin commands: '+version);
    const git = args => run('git',args,repo);
    git(['init','-q']); git(['add','-A']); git(['commit','-qm','production candidate']);
    const source = pathToFileURL(repo).href;
    run(goose,['plugin','install',source]); // false prevents skills list from fetching.
    const installed = path.join(env.GOOSE_PATH_ROOT,'.agents/plugins/agent-plugins');
    const metadataFile=path.join(installed,'.goose-plugin-install.json');
    const metadata = () => JSON.parse(readFileSync(metadataFile,'utf8'));
    const originalMeta=metadata();
    if (originalMeta.source_type!=='git' || originalMeta.auto_update!==false) throw new Error('wrong Git install metadata');
    const checkDiscovery = () => {
      const listing=run(goose,['skills','list']);
      // Goose 1.57 also lists built-ins; these are host capabilities, not installed Skills.
      const rows=listing.split('\n').filter(line => /\|/.test(line) && !line.startsWith('Name ') && !line.includes('builtin://'));
      const names=rows.map(line=>line.split('|')[0].trim()).sort();
      if (JSON.stringify(names)!==JSON.stringify(expectedSkills.map(name=>'agent-plugins:'+name).sort()) || rows.some(line=>!line.includes(installed)||/\/(assets|runtime)\//.test(line))) throw new Error('unexpected installed Skill discovery: '+listing);
    };
    const checkLayout = () => {
      for (const forbidden of ['apps','vendor','contracts','tests','scripts','package.json','.beads']) if(existsSync(path.join(installed,forbidden))) throw new Error('development leakage: '+forbidden);
      for (const name of expectedSkills.filter(name=>name!=='skill-creator')) for(const entry of ['scripts','runtime']) if(existsSync(path.join(installed,'skills',name,entry))) throw new Error('retired executable retained: '+name+'/'+entry);
      const runtime=JSON.parse(readFileSync(path.join(installed,'skills/skill-creator/runtime/runtime-manifest.json'),'utf8'));
      if(runtime.app!=='apps/agent-plugin'||runtime.runtimeEntry!=='dist/index.js') throw new Error('wrong installed runtime mapping');
      if(readdirSync(path.join(installed,'skills/skill-creator/scripts')).join()!=='skill-creator.mjs') throw new Error('unexpected launcher');
    };
    const snapshot = directory => {
      const rows=[];
      const walk=(dir,relative='')=>{for(const item of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const rel=path.join(relative,item.name);if(item.isDirectory()){rows.push(rel+'/');walk(path.join(dir,item.name),rel);}else rows.push(rel+':'+createHash('sha256').update(readFileSync(path.join(dir,item.name))).digest('hex'));}};
      walk(directory);return JSON.stringify(rows);
    };
    const checkLauncher = () => {
      const before=snapshot(work);
      const launcher=path.join(installed,'skills/skill-creator/scripts/skill-creator.mjs');
      for(const args of [['--help'],['evaluation','--help']]) if(!run(process.execPath,[launcher,...args]).includes('Usage: agent-plugin')) throw new Error('installed agent-plugin help missing');
      const history=run(process.execPath,[launcher,'history','--json']);
      if(JSON.stringify(JSON.parse(history))!=='[]') throw new Error('absent registry history was not empty');
      if(snapshot(work)!==before || readdirSync(project).length) throw new Error('read-only installed commands wrote files');
    };
    checkDiscovery();checkLayout();checkLauncher();
    // Canary bytes emulate an old installed tree, not a source fixture. Update
    // must replace the tree and remove all three retired executable closures.
    const canaries=[];
    for(const name of ['agent-creator','hook-creator','plugin-creator']) for(const entry of ['scripts','runtime']) {
      const dir=path.join(installed,'skills',name,entry);mkdirSync(dir,{recursive:true});
      writeFileSync(path.join(dir,entry==='scripts'?name+'.mjs':'obsolete.js'),'obsolete');canaries.push(dir);
    }
    const legacy=path.join(installed,'skills/skill-creator/assets/evaluation-fixtures/obsolete');
    mkdirSync(legacy,{recursive:true});writeFileSync(path.join(legacy,'SKILL.md.fixture'),'obsolete');canaries.push(legacy);
    const file=path.join(repo,'plugin.json'),plugin=JSON.parse(readFileSync(file,'utf8'));
    plugin.version+='-qa';writeFileSync(file,JSON.stringify(plugin));git(['add','plugin.json']);git(['commit','-qm','QA update']);
    run(goose,['plugin','update','agent-plugins']);
    if(JSON.parse(readFileSync(path.join(installed,'plugin.json'),'utf8')).version!==plugin.version) throw new Error('update did not replace distribution');
    if(canaries.some(file=>existsSync(file))) throw new Error('update retained obsolete executable/fixture');
    const updatedMeta=metadata();
    for(const key of ['source_type','source','source_url','url','auto_update']) if(JSON.stringify(updatedMeta[key])!==JSON.stringify(originalMeta[key])) throw new Error('update lost Git metadata: '+key);
    checkDiscovery();checkLayout();checkLauncher();
    return {status:'passed',goose:{executable:goose,version,sha256},candidate:{directory:candidate,sourceCommit:manifest.sourceCommit,inventorySha256:manifest.inventorySha256},gitInstall:true,gitUpdate:true,skillsListAfterInstall:true,skillsListAfterUpdate:true,discoveredSkills:5,standaloneCommands:1,readOnlyHistory:true,autoUpdate:false,removedCanaries:canaries.length,developmentLeakage:0};
  } finally { rmSync(work,{recursive:true,force:true}); }
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(testProductionInstall(process.argv[2]))); }
  catch(error) { console.error(error.message);process.exitCode=1; }
}
