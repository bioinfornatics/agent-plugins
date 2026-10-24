#!/usr/bin/env node
/** Strict source -> installable Git distribution projection; never publishes. */
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const commands = ['agent-creator', 'hook-creator', 'plugin-creator', 'skill-creator'];
const guidance = 'plugin-script-packaging';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = file => typeof file === 'string' && !path.isAbsolute(file) && !file.includes('\\') && file.split('/').every(p => p && p !== '.' && p !== '..');
function inventory(root, dir = root) {
  return readdirSync(dir, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en')).flatMap(e => {
    const absolute = path.join(dir,e.name), stat = lstatSync(absolute);
    if(stat.isSymbolicLink())throw new Error('production symlink forbidden: '+absolute);
    if(stat.isDirectory())return inventory(root,absolute);
    if(!stat.isFile())throw new Error('production special file forbidden: '+absolute);
    return [{path:path.relative(root,absolute).split(path.sep).join('/'),mode:stat.mode&0o111?755:644,size:stat.size,sha256:hash(readFileSync(absolute))}];
  });
}
function copy(from,to) {
  const stat=lstatSync(from);if(stat.isSymbolicLink())throw new Error('source symlink forbidden: '+from);
  if(stat.isDirectory()){mkdirSync(to,{recursive:true});for(const e of readdirSync(from).sort())copy(path.join(from,e),path.join(to,e));}
  else if(stat.isFile()){mkdirSync(path.dirname(to),{recursive:true});copyFileSync(from,to);chmodSync(to,stat.mode&0o111?0o755:0o644);}
  else throw new Error('source special file forbidden: '+from);
}
function runtimeClosed(skill) {
  const root=path.join(skill,'runtime'), manifest=JSON.parse(readFileSync(path.join(root,'runtime-manifest.json'),'utf8'));
  if(manifest.schemaVersion!==1||manifest.runtimeMode!=='node-bundled'||!commands.includes(manifest.logicalName))throw new Error('invalid runtime manifest');
  const expected=manifest.files.map(file=>{if(!canonical(file.path))throw new Error('unsafe runtime path');return file.path;});
  if(new Set(expected).size!==expected.length)throw new Error('duplicate runtime entry');
  const actual=inventory(root).filter(file=>file.path!=='runtime-manifest.json');
  if(actual.length!==expected.length)throw new Error('unexpected/missing runtime file');
  for(const file of actual){const row=manifest.files.find(e=>e.path===file.path);if(!row||row.sha256!==file.sha256||row.size!==file.size)throw new Error('runtime hash drift: '+file.path);}
  if(!canonical(manifest.runtimeEntry)||!expected.includes(manifest.runtimeEntry))throw new Error('missing runtime entry');
}
export function verifyProduction(root) {
  const manifest=JSON.parse(readFileSync(path.join(root,'distribution-manifest.json'),'utf8'));
  if(manifest.schemaVersion!==1||manifest.runtimeMode!=='node-bundled'||!/^[a-f0-9]{40}$/.test(manifest.sourceCommit)||!/^[a-f0-9]{40}$/.test(manifest.sourceTree))throw new Error('invalid production provenance');
  const rows=inventory(root).filter(e=>e.path!=='distribution-manifest.json');
  if(JSON.stringify(rows)!==JSON.stringify(manifest.files)||hash(JSON.stringify(rows))!==manifest.inventorySha256)throw new Error('production inventory mismatch');
  const roots=readdirSync(root).sort();
  if(roots.join()!==['.github','AGENTS.md','LICENSE','README.md','distribution-manifest.json','plugin.json','skills'].sort().join())throw new Error('source-only/unknown production root');
  if(readdirSync(path.join(root,'skills')).sort().join()!==[...commands,guidance].sort().join())throw new Error('unexpected production Skills');
  const plugin=JSON.parse(readFileSync(path.join(root,'plugin.json'),'utf8'));
  if(plugin.name!=='agent-plugins'||plugin.extensions?.['io.github.bioinfornatics.agent-plugins.runtime']?.mode!=='node-bundled')throw new Error('wrong production plugin mode');
  for(const name of commands){runtimeClosed(path.join(root,'skills',name));const scripts=readdirSync(path.join(root,'skills',name,'scripts'));if(scripts.join()!==name+'.mjs')throw new Error('wrong source launcher closure');}
  if(rows.some(e=>e.path.endsWith('/SKILL.md')&&e.path.split('/').length>3))throw new Error('active nested fixture Skill');
  return manifest;
}
export function projectProduction(destination) {
  destination=path.resolve(destination);
  if(destination===source||source.startsWith(destination+path.sep)||existsSync(destination))throw new Error('production destination must be new and non-overlapping');
  let ancestor=path.dirname(destination);while(ancestor!==path.dirname(ancestor)){const s=lstatSync(ancestor,{throwIfNoEntry:false});if(s?.isSymbolicLink())throw new Error('symlink destination ancestor');ancestor=path.dirname(ancestor);}
  const git=args=>execFileSync('git',args,{cwd:source,encoding:'utf8'}).trim();
  const commit=git(['rev-parse','HEAD']), tree=git(['rev-parse','HEAD^{tree}']);
  mkdirSync(destination,{recursive:true});
  copy(path.join(source,'plugin.json'),path.join(destination,'plugin.json'));copy(path.join(source,'LICENSE'),path.join(destination,'LICENSE'));
  copy(path.join(source,'docs','production-README.md'),path.join(destination,'README.md'));
  copy(path.join(source,'docs','production-AGENTS.md'),path.join(destination,'AGENTS.md'));
  for(const name of [...commands,guidance]){
    const skill=path.join(source,'skills',name),to=path.join(destination,'skills',name);
    for(const entry of ['SKILL.md','README.md','AGENTS.md','LICENSE.txt','THIRD_PARTY_NOTICES.md','references','assets','agents','evals','schemas'])if(existsSync(path.join(skill,entry)))copy(path.join(skill,entry),path.join(to,entry));
    if(commands.includes(name)){runtimeClosed(skill);copy(path.join(skill,'runtime'),path.join(to,'runtime'));copy(path.join(skill,'scripts',name+'.mjs'),path.join(to,'scripts',name+'.mjs'));}
  }
  // GitHub discovers manually dispatched workflows from the default branch.
  for(const file of ['development-ci.yml','promote-production.yml'])copy(path.join(source,'.github','workflows',file),path.join(destination,'.github','workflows',file));
  const files=inventory(destination);const manifest={schemaVersion:1,runtimeMode:'node-bundled',sourceCommit:commit,sourceTree:tree,inventorySha256:hash(JSON.stringify(files)),files};
  writeFileSync(path.join(destination,'distribution-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  verifyProduction(destination);return manifest;
}
export function smokeProduction(root) {
  verifyProduction(root);
  for(const name of commands){const run=spawnSync(process.execPath,[path.join(root,'skills',name,'scripts',name+'.mjs'),'--help'],{cwd:root,encoding:'utf8',timeout:30000,env:{PATH:'',NODE_PATH:'',HOME:root,LANG:'C',LC_ALL:'C'}});if(run.status!==0||!run.stdout.includes('Usage:')||run.stderr)throw new Error(name+' smoke failed: '+run.stderr);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const [mode,target]=process.argv.slice(2);if(!target||!['project','verify','smoke'].includes(mode))throw new Error('usage: production.mjs project|verify|smoke <directory>');const result=mode==='project'?projectProduction(target):mode==='verify'?verifyProduction(target):smokeProduction(target);console.log(JSON.stringify({status:'passed',mode,sourceCommit:result?.sourceCommit,files:result?.files.length}));}catch(e){console.error(e.message);process.exitCode=1;}
}
