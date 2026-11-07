import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, cp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { seedRetained } from './seed-retained.mjs';
const repo=fileURLToPath(new URL('../../../',import.meta.url));
async function snapshot(root) {
  const files=[];
  for(const entry of (await readdir(root,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
    const path=join(root,entry.name);
    if(entry.isDirectory()) files.push(...await snapshot(path));
    else {assert.ok(entry.isFile()); files.push([path,await readFile(path)]);}
  }
  return files;
}

// Product guarantee: retained IDs and archives remain usable by the contained CLI
// without app imports in the consumer, at two distinct final native locations.
test('final-workspace seeds support contained history/inspect with immutable bytes and real IDs',async()=>{
  const root=await mkdtemp(join(tmpdir(),'retained-seed-test-'));
  try {
    const installed=join(root,'standalone');
    await mkdir(join(installed,'scripts'),{recursive:true});
    await cp(join(repo,'skills/skill-creator/scripts/skill-creator.mjs'),join(installed,'scripts/skill-creator.mjs'));
    await cp(join(repo,'skills/skill-creator/runtime'),join(installed,'runtime'),{recursive:true});
    const launcher=join(installed,'scripts/skill-creator.mjs');
    for(const arm of ['with','without']) {
      const workspace=join(root,arm);
      const metadata=await seedRetained(join(repo,'apps/agent-plugin'),workspace);
      const before=await snapshot(workspace);
      const run=args=>{
        const result=spawnSync(process.execPath,[launcher,...args],{cwd:root,encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH,HOME:root,XDG_DATA_HOME:join(root,'private-data')}});
        assert.equal(result.status,0,result.stderr); return result.stdout;
      };
      const rows=JSON.parse(run(['history','--registry',metadata.registry,'--json']));
      assert.equal(rows.length,2);
      const completed=rows.find(row=>row.id===metadata.completedCampaign);
      const interrupted=rows.find(row=>row.id===metadata.interruptedCampaign);
      assert.equal(completed.status,'completed'); assert.equal(completed.finalized,2);
      assert.equal(interrupted.status,'interrupted'); assert.equal(interrupted.finalized,1); assert.equal(interrupted.total,2);
      assert.deepEqual(new Set(rows.map(row=>row.id)),new Set([metadata.completedCampaign,metadata.interruptedCampaign]));
      for(const id of [metadata.completedCampaign,metadata.interruptedCampaign]) {
        const out=run(['inspect',id,'--registry',metadata.registry]);
        assert.ok(out.includes(id)); assert.ok(!out.includes('MISSING:'));
      }
      assert.deepEqual(await snapshot(workspace),before);
      const bound=JSON.parse(await readFile(join(workspace,'bound-retained-cases.json'),'utf8'));
      assert.ok(!JSON.stringify(bound).match(/\{(?:campaign_id|registry_path|with_attempt_id|without_attempt_id)\}/));
      assert.equal(bound.cases.find(item=>item.name==='resume').target.campaign,metadata.interruptedCampaign);
      assert.equal((await readdir(join(workspace,'campaigns'))).length,2);
      // Run-end consumers are launcher subprocesses: no generator/app import needed.
      assert.equal(resolve(metadata.workspace),workspace);
    }
  } finally {await rm(root,{recursive:true,force:true});}
});
