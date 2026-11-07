/** Operator-only setup; never include this script in candidate `files`.
 * Generate at the final workspace path: checkpoints bind absolute paths.
 */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export async function seedRetained(appRoot, workspace, templatePath = new URL('./pending-retained-execution.json', import.meta.url)) {
  appRoot = resolve(appRoot); workspace = resolve(workspace);
  // Exclusive creation prevents overwriting user data or an earlier seed.
  await mkdir(workspace, { mode: 0o700 });
  const load = path => import(pathToFileURL(join(appRoot, 'src', path)).href);
  const { prepareEvaluation } = await load('application/use-cases/prepare-evaluation.ts');
  const { executeEvaluation } = await load('application/use-cases/execute-evaluation.ts');
  const { FilesystemEvaluationSource } = await load('adapters/outbound/filesystem/filesystem-evaluation-source.ts');
  const { SqliteEvaluationStore } = await load('adapters/outbound/storage/sqlite-evaluation-store.ts');
  const { SqliteEvaluationHistory } = await load('adapters/outbound/storage/sqlite-evaluation-history.ts');
  const { SqliteVerifiedAttemptReader } = await load('adapters/outbound/storage/sqlite-verified-attempt.ts');
  const { main } = await load('main.ts');
  const source = join(workspace, 'neutral-source');
  await mkdir(join(source, 'evals'), { recursive: true });
  await writeFile(join(source, 'SKILL.md'), '---\nname: neutral-proof\ndescription: Produces a neutral fixture answer.\n---\nReturn fixture proof.\n');
  await writeFile(join(source, 'evals/evals.json'), JSON.stringify({evals:[{id:1,prompt:'Return fixture proof.',expectations:['Answer contains fixture proof.']}]}));
  const plan = await prepareEvaluation({skills:[source],plugins:[],agents:['goose'],repetitions:1,maxTurns:5,timeout:0,parallelism:1}, new FilesystemEvaluationSource());
  const registry = join(workspace, 'registry/evaluations.sqlite');
  const output = join(workspace, 'campaigns');
  const host = {preflight:async()=>{},run:async request=>({status:'completed',collection:'complete',exitCode:0,sessionName:request.id,host:{id:'goose',version:'synthetic-fixture-not-native'},startedAt:'2026-11-06T00:00:00.000Z',finishedAt:'2026-11-06T00:00:01.000Z',limitations:['Synthetic deterministic fixture; no provider execution or effectiveness evidence.'],artifacts:[{path:'answer.txt',content:Buffer.from('fixture proof\n')}]})};
  const completed = await executeEvaluation(plan, new Map([['goose',host]]), new SqliteEvaluationStore(output,registry), randomUUID);
  // Public store lifecycle creates a retained interrupted campaign, no SQL forgery.
  const store = new SqliteEvaluationStore(output,registry);
  const interrupted = await store.begin(plan);
  const trial = plan.trials[0];
  const request = {id:randomUUID(),trialId:trial.id,pairId:trial.pairId,agent:trial.agent,condition:trial.condition,profile:plan.profile,scenario:plan.profile.scenarios[0],options:plan.options};
  try {
    await store.start(request);
    await store.finish(request, await host.run(request));
  } finally { await store.close(); }
  const history = new SqliteEvaluationHistory(registry);
  const detail = await history.inspect(completed.id);
  assert.equal(detail.attempts.length,2);
  const reader = new SqliteVerifiedAttemptReader(registry);
  for (const attempt of detail.attempts) {
    const verified = await reader.readAttempt({campaignId:completed.id,attemptId:attempt.id});
    assert.ok(verified.artifacts.length > 0);
  }
  async function digestTree(dir) {
    const entries=[];
    for (const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      const path=join(dir,entry.name);
      if(entry.isDirectory()) entries.push(...await digestTree(path));
      else { assert.ok(entry.isFile()); entries.push([path,createHash('sha256').update(await readFile(path)).digest('hex')]); }
    }
    return entries;
  }
  const before=await digestTree(workspace);
  const observations=[];
  for(const args of [['history','--registry',registry,'--json'],['inspect',completed.id,'--registry',registry],['inspect',interrupted.id,'--registry',registry]]) {
    let out='',err=''; const code=await main(args,{writeOut:s=>{out+=s;},writeErr:s=>{err+=s;}});
    assert.equal(code,0,err); observations.push({args,code,out,err});
  }
  assert.deepEqual(await digestTree(workspace),before);
  const interruptedDetail=await history.inspect(interrupted.id);
  assert.equal(interruptedDetail.status,'interrupted');
  assert.equal(interruptedDetail.attempts.length,1);
  assert.equal(interruptedDetail.finalized,1);
  assert.equal(interruptedDetail.total,2);
  await reader.readAttempt({campaignId:interrupted.id,attemptId:interruptedDetail.attempts[0].id});
  const bindings={registry_path:registry,campaign_id:completed.id,with_attempt_id:detail.attempts.find(a=>a.condition==='with').id,without_attempt_id:detail.attempts.find(a=>a.condition==='without').id,new_export_path:join(workspace,'new-export')};
  const pending=JSON.parse(await readFile(templatePath,'utf8'));
  const boundCases=pending.cases.map(item=>{
    const tokens={...bindings,campaign_id:item.name==='resume'?interrupted.id:completed.id};
    return JSON.parse(JSON.stringify(item).replace(/\{([a-z_]+)\}/g,(match,key)=>tokens[key]??match));
  });
  const metadata={schemaVersion:1,provenance:'Synthetic public-seam fixture; not native Goose/model evidence.',workspace,registry,completedCampaign:completed.id,interruptedCampaign:interrupted.id,bindings,verification:{archives:'reverified through SqliteVerifiedAttemptReader',consultation:'CLI history/inspect exit 0; all existing workspace bytes unchanged'},observations};
  await writeFile(join(workspace,'fixture-metadata.json'),JSON.stringify(metadata,null,2));
  await writeFile(join(workspace,'bound-retained-cases.json'),JSON.stringify({status:'operator-bound-not-discovered',reason:'Not active suite cases; resume/grading still require future model authority. Regenerate in each final workspace; never relocate this registry.',cases:boundCases},null,2));
  return metadata;
}
if(process.argv[1] && resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))) {
  if(process.argv.length!==4) throw Error('Usage: node seed-retained.mjs <app-root> <new-final-workspace>');
  console.log(JSON.stringify(await seedRetained(process.argv[2],process.argv[3]),null,2));
}
