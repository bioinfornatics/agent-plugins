#!/usr/bin/env node
import { mkdtempSync, mkdirSync, cpSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
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
// Executed in an isolated child: imports resolve only into the installed emitted
// closure. Fake ports exercise storage/export mechanics, never native providers.
async function prepareInstalledExportFixture(skillRoot, fixtureRoot) {
  const load = relative => import(pathToFileURL(path.join(skillRoot, 'runtime/dist', relative)).href);
  const [{ prepareEvaluation }, { executeEvaluation }, { FilesystemEvaluationSource },
    { SqliteEvaluationStore }, { SqliteVerifiedAttemptReader }, { SqliteJudgmentStore },
    { Database }, { gradeAttempt }] = await Promise.all([
    load('application/use-cases/prepare-evaluation.js'), load('application/use-cases/execute-evaluation.js'),
    load('adapters/outbound/filesystem/filesystem-evaluation-source.js'), load('adapters/outbound/storage/sqlite-evaluation-store.js'),
    load('adapters/outbound/storage/sqlite-verified-attempt.js'), load('adapters/outbound/storage/sqlite-judgment-store.js'),
    load('adapters/outbound/storage/sqlite-database.js'), load('application/use-cases/grade-attempt.js')]);
  const skill = path.join(fixtureRoot, 'skill');
  mkdirSync(path.join(skill, 'evals'), { recursive: true });
  writeFileSync(path.join(skill, 'SKILL.md'), 'export fixture');
  writeFileSync(path.join(skill, 'evals/evals.json'), JSON.stringify({ evals: [{ id: 1, prompt: 'task', expectations: ['works'] }] }));
  writeFileSync(path.join(fixtureRoot, 'user-report.txt'), 'user report survives plugin update');
  const registry = path.join(fixtureRoot, 'registry/db.sqlite');
  const evidence = path.join(fixtureRoot, 'evidence');
  const plan = await prepareEvaluation({ skills: [skill], plugins: [], profileName: 'installed export fixture',
    agents: ['goose'], repetitions: 1, maxTurns: 5, timeout: 0, parallelism: 1 }, new FilesystemEvaluationSource());
  const now = () => '2026-11-06T09:00:00.000Z';
  let candidateCalls = 0, judgeCalls = 0;
  const result = await executeEvaluation(plan, new Map([['goose', { preflight: async () => {}, run: async () => {
    candidateCalls++;
    return { status: 'completed', collection: 'complete', exitCode: 0, sessionName: 'fixture', startedAt: now(), finishedAt: now(),
      host: { id: 'goose', version: 'fixture' }, limitations: [], artifacts: [
        { path: 'goose/conversation.json', content: Buffer.from('{"messages":[{"role":"assistant","content":"exact answer"}]}') },
        { path: 'workspace/subdir/file.txt', content: Buffer.from('exact original') }] };
  } }]]), new SqliteEvaluationStore(evidence, registry), randomUUID);
  const db = new Database(registry, { readonly: true });
  const attempts = db.query('SELECT id,condition FROM trials ORDER BY condition').all(); db.close();
  const reader = new SqliteVerifiedAttemptReader(registry), store = new SqliteJudgmentStore(registry), gradingIds = [];
  for (const attempt of attempts) {
    const grade = await gradeAttempt({ campaignId: result.id, attemptId: attempt.id }, { reader, store, newId: randomUUID,
      judge: { judge: async request => {
        judgeCalls++;
        const artifact = request.artifacts[0];
        return { outcome: { status: 'completed', judgments: request.criteria.map(criterion => ({ ...criterion,
          verdict: attempt.condition === 'without' ? 'fail' : 'pass', rationale: 'inspected',
          evidence: [{ path: artifact.path, sha256: artifact.sha256, quote: artifact.kind === 'text' ? artifact.text : '' }] })) },
          provenance: { host: { id: 'goose', version: 'fixture' }, model: { source: 'configuration-default', effective: 'unknown' },
            limits: { maxTurns: 50, timeout: 0, preflightTimeout: 1, exportTimeout: 1, outputBytes: 1024 } } };
      } } });
    gradingIds.push(grade.id);
  }
  assert.equal(candidateCalls, 2); assert.equal(judgeCalls, 2);
  return { campaignId: result.id, gradingIds, registry, skill, evidence, candidateCalls, judgeCalls };
}

function checkInstalledExport(launcher, fixture, output, run, snapshot) {
  const protectedPaths = [path.dirname(fixture.registry), fixture.skill, fixture.evidence];
  const before = protectedPaths.map(snapshot);
  const stdout = run(process.execPath, [launcher, 'export', fixture.campaignId, '--registry', fixture.registry,
    '--output', output, '--benchmark', ...fixture.gradingIds.flatMap(id => ['--grading', id])]);
  assert.equal(stdout, 'Export complete: quality-only-benchmark; 2 selected runs\n');
  assert.deepEqual(protectedPaths.map(snapshot), before, 'export changed registry/source/evidence');
  const manifest = JSON.parse(readFileSync(path.join(output, 'export-manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.status, 'complete');
  assert.equal(existsSync(path.join(output, '.export-pending')), false);
  assert.equal(manifest.campaignId, fixture.campaignId);
  assert.deepEqual(manifest.selection, { gradingIds: fixture.gradingIds, strategy: 'explicit-one-grade-per-logical-trial' });
  assert.deepEqual(manifest.runs.map(run => run.gradeId).sort(), [...fixture.gradingIds].sort());
  assert.deepEqual(manifest.runs.map(run => run.path), ['iteration-1/eval-1/with_skill/run-1', 'iteration-1/eval-1/without_skill/run-1']);
  assert.deepEqual(readdirSync(output).sort(), ['export-manifest.json', 'iteration-1', 'overview.json']);
  assert.equal(manifest.overview, 'overview.json');
  assert.ok(manifest.files.some(file => file.path === 'overview.json'));
  const payloadHashes = [];
  for (const file of manifest.files) {
    const bytes = readFileSync(path.join(output, file.path));
    assert.equal(bytes.length, file.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    // Benchmark provenance includes the export timestamp; compare its meaningful
    // fields separately rather than requiring two invocations to share a clock.
    if (file.path !== 'iteration-1/benchmark.json') payloadHashes.push({ path: file.path, bytes: file.bytes, sha256: file.sha256 });
  }
  for (const [condition, rate] of [['with_skill', 1], ['without_skill', 0]]) {
    const dir = path.join(output, 'iteration-1/eval-1', condition, 'run-1');
    const grading = JSON.parse(readFileSync(path.join(dir, 'grading.json'), 'utf8'));
    assert.deepEqual(grading.summary, { passed: rate, failed: 1-rate, total: 1, pass_rate: rate });
    const transcript = Buffer.from('{"messages":[{"role":"assistant","content":"exact answer"}]}');
    const transcriptHash = createHash('sha256').update(transcript).digest('hex');
    assert.deepEqual(grading.expectations, [{ text: 'works', passed: rate === 1,
      evidence: `inspected\ngoose/conversation.json (sha256: ${transcriptHash}): ${JSON.stringify(transcript.toString())}` }]);
    assert.deepEqual(readFileSync(path.join(dir, 'outputs/transcript.json')), transcript);
    assert.deepEqual(readFileSync(path.join(dir, 'outputs/artifacts/goose/conversation.json')), transcript);
    assert.equal(readFileSync(path.join(dir, 'outputs/artifacts/workspace/subdir/file.txt'), 'utf8'), 'exact original');
  }
  const benchmark = JSON.parse(readFileSync(path.join(output, 'iteration-1/benchmark.json'), 'utf8'));
  assert.deepEqual(benchmark.run_summary.delta, { pass_rate: '+1.0000' });
  assert.deepEqual(Object.keys(benchmark.run_summary.with_skill), ['pass_rate']);
  assert.equal(benchmark.metadata.quality_only, true);
  delete benchmark.metadata.timestamp;
  const { timestamp, files, ...provenance } = manifest;
  return { ready: true, selectedRuns: manifest.runs.length, campaignId: manifest.campaignId, gradingIds: manifest.selection.gradingIds,
    delta: benchmark.run_summary.delta.pass_rate, readonly: true, payloadHashes, benchmark, provenance };
}

// Exercise the installed helper, not repository imports: all external inputs and
// the installed Skill stay byte-identical while new HTML retains explicit grades.
function checkInstalledReport(skillRoot, fixture, workspace, output, run, snapshot) {
  const protectedPaths = [skillRoot, path.dirname(fixture.registry), fixture.skill, fixture.evidence, workspace];
  const before = protectedPaths.map(snapshot);
  run(process.execPath, [path.join(skillRoot, 'scripts/generate-report.mjs'), '--workspace', workspace, '--output', output]);
  assert.deepEqual(protectedPaths.map(snapshot), before, 'report changed installed Skill or external inputs');
  const html = readFileSync(output, 'utf8');
  const data = JSON.parse(html.split('const EMBEDDED_DATA = ')[1].split(';\n')[0]);
  assert.equal(data.export_provenance.campaign_id, fixture.campaignId);
  assert.deepEqual(data.export_provenance.selection.gradingIds, fixture.gradingIds);
  assert.deepEqual(data.runs.map(row => row.id), ['eval-1-with_skill-run-1', 'eval-1-without_skill-run-1']);
  assert.deepEqual(data.runs.map(row => row.grading.summary.pass_rate), [1, 0]);
  for (const row of data.runs) {
    assert.equal(row.outputs.find(file => file.name === 'transcript.json').content,
      '{"messages":[{"role":"assistant","content":"exact answer"}]}');
    assert.equal(row.outputs.find(file => file.name === 'artifacts/workspace/subdir/file.txt').content, 'exact original');
  }
  for (const selector of ['id="condition-picker"', 'data-condition="with_skill"', 'data-condition="without_skill"',
    'data-condition="compare"', 'id="repetition-select"', 'className = "chat-bubble"']) assert.ok(html.includes(selector), selector);
  assert.ok(!/<(?:script|link)[^>]+(?:src|href)="https?:/i.test(html));
  return { ready: true, selectedRuns: data.runs.length, gradingIds: data.export_provenance.selection.gradingIds,
    readonly: true, selectorsAndBubbleRenderer: true, outputBytes: Buffer.byteLength(html),
    sha256: createHash('sha256').update(html).digest('hex') };
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
      if(readdirSync(path.join(installed,'skills/skill-creator/scripts')).sort().join()!==['generate-report.mjs','skill-creator.mjs'].join()) throw new Error('unexpected launcher');
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
    const skillRoot = path.join(installed, 'skills/skill-creator');
    const fixtureRoot = path.join(work, 'export-fixture');
    const installedBefore = snapshot(skillRoot);
    const preparation = `import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto'; import assert from 'node:assert/strict';
import path from 'node:path'; import { pathToFileURL } from 'node:url';
${prepareInstalledExportFixture.toString()}
console.log(JSON.stringify(await prepareInstalledExportFixture(process.argv[1], process.argv[2])));`;
    const fixture = JSON.parse(run(process.execPath, ['--input-type=module', '-e', preparation, skillRoot, fixtureRoot]));
    assert.equal(snapshot(skillRoot), installedBefore, 'fixture imports modified installed runtime');
    const launcher = path.join(skillRoot, 'scripts/skill-creator.mjs');
    const exportBeforeUpdate = checkInstalledExport(launcher, fixture, path.join(work, 'export-before-update'), run, snapshot);
    const htmlBefore = path.join(work, 'review-before-update.html');
    const reportBeforeUpdate = checkInstalledReport(skillRoot, fixture, path.join(work, 'export-before-update'), htmlBefore, run, snapshot);
    const fixtureBeforeUpdate = snapshot(fixtureRoot);
    const exportSnapshotBeforeUpdate = snapshot(path.join(work, 'export-before-update'));
    const htmlBytesBeforeUpdate = readFileSync(htmlBefore);
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
    assert.equal(snapshot(fixtureRoot), fixtureBeforeUpdate, 'update changed external fixture/user report');
    assert.equal(snapshot(path.join(work, 'export-before-update')), exportSnapshotBeforeUpdate, 'update changed user export');
    assert.deepEqual(readFileSync(htmlBefore), htmlBytesBeforeUpdate, 'update changed user HTML');
    const exportAfterUpdate = checkInstalledExport(launcher, fixture, path.join(work, 'export-after-update'), run, snapshot);
    assert.deepEqual(exportAfterUpdate, exportBeforeUpdate, 'update changed explicit grades or export payload/provenance');
    const reportAfterUpdate = checkInstalledReport(skillRoot, fixture, path.join(work, 'export-after-update'), path.join(work, 'review-after-update.html'), run, snapshot);
    return {reportBeforeUpdate,reportAfterUpdate,reportGenerators:1,userHtmlPreserved:true,exportBeforeUpdate,exportAfterUpdate,exportPayloadsIdentical:true,externalFixturePreserved:true,
      fakeCandidateCalls:fixture.candidateCalls,fakeJudgeCalls:fixture.judgeCalls,nativeModelCalls:0,status:'passed',goose:{executable:goose,version,sha256},candidate:{directory:candidate,sourceCommit:manifest.sourceCommit,inventorySha256:manifest.inventorySha256},gitInstall:true,gitUpdate:true,skillsListAfterInstall:true,skillsListAfterUpdate:true,discoveredSkills:5,standaloneCommands:1,readOnlyHistory:true,autoUpdate:false,removedCanaries:canaries.length,developmentLeakage:0};
  } finally { rmSync(work,{recursive:true,force:true}); }
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(testProductionInstall(process.argv[2]))); }
  catch(error) { console.error(error.message);process.exitCode=1; }
}
