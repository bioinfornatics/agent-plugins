/** Static promotion boundary: built-in imports only; never execute candidate code. */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { verifyProduction } from './production.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function plain(directory) {
 let current=path.parse(directory).root;
 for(const part of directory.slice(current.length).split(path.sep).filter(Boolean)){
  current=path.join(current,part);if(!lstatSync(current).isDirectory())throw Error('frozen candidate requires plain directory ancestry');
 }
}
function inventory(root,relative='') {
 const rows=[];
 for(const name of readdirSync(path.join(root,relative)).sort()){
  const member=relative?relative+'/'+name:name,stat=lstatSync(path.join(root,member));
  if(stat.isDirectory()){rows.push({path:member,type:'directory'});rows.push(...inventory(root,member));}
  else if(stat.isFile())rows.push({path:member,type:'file',mode:stat.mode&0o111?755:644,size:stat.size,sha256:hash(readFileSync(path.join(root,member)))});
  else throw Error('frozen candidate rejects links/special files');
 }
 return rows;
}
export function verifyFrozenCandidate(directory, expectedSource) {
 directory=path.resolve(directory);plain(directory);
 if(readdirSync(directory).sort().join()!=='candidate-manifest.json,plugin,production')throw Error('unexpected frozen candidate envelope');
 const manifestPath=path.join(directory,'candidate-manifest.json');
 if(!lstatSync(manifestPath).isFile())throw Error('plain candidate manifest required');
 const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
 if(manifest.schemaVersion!==2||manifest.kind!=='local-evaluation-candidate'||!/^[a-f0-9]{40}$/.test(manifest.sourceCommit)||manifest.sourceCommit!==expectedSource)throw Error('frozen candidate source mismatch');
 const production=path.join(directory,'production');plain(production);
 const verified=verifyProduction(production);
 if(JSON.stringify(verified)!==JSON.stringify(manifest.production)||verified.sourceCommit!==expectedSource||verified.sourceTree!==manifest.sourceTree)throw Error('frozen production baseline mismatch');
 const plugin=path.join(directory,'plugin');plain(plugin);
 const entries=inventory(plugin);
 if(JSON.stringify(entries)!==JSON.stringify(manifest.entries)||hash(JSON.stringify(entries))!==manifest.inventorySha256)throw Error('frozen candidate inventory mismatch');
 const treatment=entries.filter(row=>row.type==='file'&&!row.path.split('/').includes('evals'));
 if(treatment.length!==verified.files.length||treatment.some(row=>!verified.files.some(file=>file.path===row.path&&file.mode===row.mode&&file.size===row.size&&file.sha256===row.sha256)))throw Error('frozen treatment differs from production');
 return {manifest,production};
}
