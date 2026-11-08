import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const source = resolve(import.meta.dirname, '../skills/skill-creator');
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const campaign = '11111111-1111-4111-8111-111111111111';
const grades = ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
const prompt = 'Explain <script>window.injected=true</script> & preserve literal Unicode Ω.';
const diagnostics = {
  'artifacts/goose/stream.jsonl': '{"event":"message"}\r\n{"text":"Ω <script> literal"}\n',
  'artifacts/goose/logs/llm_request.1.jsonl': '{"request":1}\n',
  'artifacts/goose/logs/session.LOG': 'Diagnostic Ω\r\n',
};
const markdown = [
  '**Answer**', '',
  'Literal tokens: __REPORT_LIBRARY_MARKED__ __REPORT_LIBRARY_DOMPURIFY__ __REPORT_LIBRARY_NOTICES__ /*__REPORT_DATA__*/', '',
  '| Item | Count | Note |', '| :--- | ---: | :---: |',
  '| **Bold cell** | 42 | escaped\\|pipe |', '',
  '- Outer item', '  - Nested item with `inline code`', '',
  '```html', '<script>window.codeInjected=true</script>', '```', '',
  '<b onclick="window.rawInjected=true">Raw HTML stays literal</b>', '',
  '<script>window.rawInjected=true</script>', '',
  '<img src="https://report-attacker.invalid/raw.png" onerror="window.rawInjected=true">', '',
  '<iframe src="https://report-attacker.invalid/frame"></iframe>', '',
  '[unsafe link](javascript:window.urlInjected=true)',
  '[unsafe data](data:text/html;base64,PHNjcmlwdD4=)',
  '![remote image](https://report-attacker.invalid/markdown.png)',
  '![data image](data:image/svg+xml;base64,PHN2Zz4=)',
  '[safe link](https://example.invalid/docs)',
].join('\n');
// Deliberately retain noncanonical JSON whitespace/number spelling and CRLF:
// richer display must never rewrite the original transcript/download bytes.
const transcript = ' { "messages": [{"role":"user","content":[{"type":"text","text":"Question"}]},{"role":"assistant","content":[{"type":"text","text":'
  + JSON.stringify(markdown) + '}]}], "n":1.00 }\r\n';
async function fixture(base: string, layouts = [{evalId:1, condition:'with', repetition:1}, {evalId:1, condition:'without', repetition:1}]) {
  const workspace = join(base, 'export'); await mkdir(workspace);
  const files: {path: string; bytes: number; sha256: string}[] = [];
  async function add(path: string, content: string) {
    await mkdir(join(workspace, path, '..'), {recursive:true});
    await writeFile(join(workspace, path), content);
    files.push({path, bytes:Buffer.byteLength(content), sha256:hash(content)});
  }
  const metadata = {eval_id:1, id:'scenario/1', prompt, expectations:['Correct answer']};
  const grading = {expectations:[{text:'Correct answer', passed:true, evidence:'Actual artifact evidence'}], summary:{passed:1, failed:0, total:1, pass_rate:1}};
  const runs = [];
  const selectedGrades: string[] = [];
  for (const [index, {evalId,condition,repetition}] of layouts.entries()) {
    const sourceIdentity = {skillName:`skill-${evalId}`, pluginName:"declared-plugin"};
    const runMetadata = {...metadata, eval_id:evalId, id:`scenario/${evalId}`, source:sourceIdentity};
    const scenarioPath = `iteration-1/eval-${evalId}/eval_metadata.json`;
    if (!files.some(file => file.path === scenarioPath)) await add(scenarioPath, JSON.stringify(runMetadata));
    const path = `iteration-1/eval-${evalId}/${condition === 'with' ? 'with_skill' : 'without_skill'}/run-${repetition}`;
    const gradeId = grades[index] || `${String(index+2).padStart(8,'0')}-4444-4444-8444-444444444444`;
    selectedGrades.push(gradeId);
    runs.push({path, condition, evalId, repetition, campaignId:campaign, gradeId, trialId:`trial-${index}`,
      attemptId:gradeId, manifestDigest:'a'.repeat(64), evidenceDigest:'b'.repeat(64), requestDigest:'c'.repeat(64),
      profile:{id:'profile',name:'Example profile', revision:'revision'}, scenario:{id:`scenario/${evalId}`,source:sourceIdentity}, agent:'goose', protectedRoots:[]});
    await add(`${path}/eval_metadata.json`, JSON.stringify(runMetadata));
    await add(`${path}/grading.json`, JSON.stringify(grading));
    await add(`${path}/outputs/transcript.json`, transcript);
    await add(`${path}/outputs/artifacts/workspace/result.json`, ' {"n":1.00}\n');
    for (const [name, bytes] of Object.entries(diagnostics)) await add(`${path}/outputs/${name}`, bytes);
    await add(`${path}/outputs/artifacts/raw.bin`, Buffer.from([0,255]).toString('latin1'));
  }
  const overview={schemaVersion:1,campaignId:campaign,profile:{id:'profile',name:'Example profile',revision:'revision'},candidateModel:{source:'override',requested:'candidate-model-A',effective:'unknown'},trials:runs.map((run,index)=>({trialId:run.trialId,sequence:index,scenarioId:run.scenario.id,source:run.scenario.source,agent:'goose',repetition:run.repetition,pairId:`pair-${run.evalId}-${run.repetition}`,condition:run.condition,status:'finalized',attemptId:run.attemptId,attemptStatus:'completed',selectedGradeId:run.gradeId,grades:[{id:run.gradeId,attemptId:run.attemptId,status:'completed',outcomeClass:'decisive',judge:null}],score:{passed:1,failed:0,total:1,passRate:1}}))};
  for (const run of runs) Object.assign(run,{pairId:`pair-${run.evalId}-${run.repetition}`,options:{model:'candidate-model-A'}});
  await add('overview.json',JSON.stringify(overview));
  const manifest = {schemaVersion:1, method:'agent-plugin-explicit-quality-v1', status:'complete', kind:'workspace', campaignId:campaign, overview:'overview.json',
    selection:{strategy:'explicit-one-grade-per-logical-trial', gradingIds:selectedGrades}, runs, files};
  await writeFile(join(workspace,'export-manifest.json'),JSON.stringify(manifest));
  return {workspace, manifest};
}
async function copyHelper(base: string) {
  const installed=join(base,'installed skill');
  await mkdir(join(installed,'scripts'),{recursive:true}); await mkdir(join(installed,'assets'));
  await cp(join(source,'scripts/generate-report.mjs'),join(installed,'scripts/generate-report.mjs'));
  await cp(join(source,'assets/report-viewer.html'),join(installed,'assets/report-viewer.html'));
  await cp(join(source,'assets/report-libraries'),join(installed,'assets/report-libraries'),{recursive:true});
  return {installed, script:join(installed,'scripts/generate-report.mjs')};
}
function invoke(script: string, args: string[]) {
  return spawnSync(process.execPath,[script,...args],{encoding:'utf8', env:{PATH:'', NODE_PATH:'', HOME:tmpdir()}});
}
function dataFrom(html: string) {
  return JSON.parse(html.split('const EMBEDDED_DATA = ')[1].split(';\n')[0]);
}

// Detects a helper which depends on repository/app/npm/Python access, loses raw
// bytes, embeds only a shallow listing, guesses grades, or injects task HTML.
test('contained copied helper embeds every explicitly selected run and output without modifying exports', async () => {
  const base = await mkdtemp(join(tmpdir(),'report-generator-'));
  try {
    const {workspace, manifest} = await fixture(base);
    const {installed,script} = await copyHelper(base);
    assert.equal(invoke(script,['--help']).status,0);
    const before = await readFile(join(workspace,'export-manifest.json'));
    const output = join(base,'report with spaces.html');
    const result = invoke(script,['--workspace',workspace,'--output',output,'--skill-name','Supplied label __REPORT_LIBRARY_MARKED__ __REPORT_LIBRARY_DOMPURIFY__ __REPORT_LIBRARY_NOTICES__ /*__REPORT_DATA__*/']);
    assert.equal(result.status,0,result.stderr); assert.equal(result.stderr,'');
    const html = await readFile(output,'utf8'), data = dataFrom(html);
    const libraries=JSON.parse(await readFile(join(installed,'assets/report-libraries/manifest.json'),'utf8'));
    const scriptData=[...html.matchAll(/<script src="data:text\/javascript;base64,([A-Za-z0-9+/=]+)"><\/script>/g)];
    assert.equal(scriptData.length,2,'embed each library exactly once');
    for (const [index,entry] of libraries.libraries.entries()) {
      assert.deepEqual(Buffer.from(scriptData[index][1],'base64'),await readFile(join(installed,'assets/report-libraries',entry.path)));
      assert.ok(html.includes(`${entry.name} ${entry.version}`),'embedded license attribution');
    }
    assert.equal(data.runs[0].outputs.find((file: any) => file.name === 'transcript.json').content,transcript,'placeholder-like text preserved');
    assert.equal(data.skill_name,'Supplied label __REPORT_LIBRARY_MARKED__ __REPORT_LIBRARY_DOMPURIFY__ __REPORT_LIBRARY_NOTICES__ /*__REPORT_DATA__*/'); assert.equal(data.runs.length,2);
    assert.deepEqual(data.runs.map((run: any) => run.id),['eval-1-with_skill-run-1','eval-1-without_skill-run-1']);
    assert.equal(data.export_provenance.manifest_sha256,hash(before));
    assert.equal(data.overview.trials.length,2);
    assert.equal(data.runs[0].source_label,'declared-plugin:skill-1');
    assert.equal(data.runs[0].prompt,prompt); assert.ok(!html.includes('<script>window.injected'));
    assert.equal(data.runs[0].outputs.find((file: any) => file.name === 'transcript.json').content,transcript);
    assert.equal(data.runs[0].outputs.find((file: any) => file.name === 'artifacts/workspace/result.json').content,' {"n":1.00}\n');
    assert.equal(data.runs[0].outputs.length,6);
    assert.ok(!/<(?:script|link)[^>]+(?:src|href)="https?:/i.test(html));
    assert.ok(!html.includes('fetch("/api/feedback")')); assert.equal(data.benchmark,null);
    assert.deepEqual(await readFile(join(workspace,'export-manifest.json')),before);
    for (const entry of manifest.files) assert.equal(hash(await readFile(join(workspace,entry.path))),entry.sha256);
    const duplicate = invoke(script,['--workspace',workspace,'--output',output]);
    assert.notEqual(duplicate.status,0); assert.equal(await readFile(output,'utf8'),html);
    const repeat = join(base,'repeat.html');
    assert.equal(invoke(script,['--workspace',workspace,'--output',repeat,'--skill-name','Supplied label __REPORT_LIBRARY_MARKED__ __REPORT_LIBRARY_DOMPURIFY__ __REPORT_LIBRARY_NOTICES__ /*__REPORT_DATA__*/']).status,0);
    assert.equal(await readFile(repeat,'utf8'),html);
  } finally { await rm(base,{recursive:true,force:true}); }
});


// Exact supplied names, never profile titles or checkout-path guesses.
test('source labels require explicit provenance and preserve standalone and literal names', async () => {
  const base=await mkdtemp(join(tmpdir(),'report-source-'));
  try {
    const {workspace,manifest}=await fixture(base);
    const identity={skillName:'notes <script>'};
    for (const run of manifest.runs) run.scenario.source=identity;
    for (const entry of manifest.files.filter(file=>file.path.endsWith('eval_metadata.json'))) {
      const metadata=JSON.parse(await readFile(join(workspace,entry.path),'utf8')); metadata.source=identity;
      const bytes=JSON.stringify(metadata); await writeFile(join(workspace,entry.path),bytes); entry.bytes=Buffer.byteLength(bytes);entry.sha256=hash(bytes);
    }
    const overviewEntry=manifest.files.find(file=>file.path==='overview.json')!;
    const overview=JSON.parse(await readFile(join(workspace,'overview.json'),'utf8'));for(const trial of overview.trials)trial.source=identity;
    const overviewBytes=JSON.stringify(overview);await writeFile(join(workspace,'overview.json'),overviewBytes);overviewEntry.bytes=Buffer.byteLength(overviewBytes);overviewEntry.sha256=hash(overviewBytes);
    await writeFile(join(workspace,'export-manifest.json'),JSON.stringify(manifest));
    const output=join(base,'standalone.html');
    const result=invoke(join(source,'scripts/generate-report.mjs'),['--workspace',workspace,'--output',output,'--skill-name','Not a plugin name']);
    assert.equal(result.status,0,result.stderr);
    const html=await readFile(output,'utf8');assert.equal(dataFrom(html).runs[0].source_label,'notes <script>');assert.ok(!html.includes('notes <script>'));
  } finally {await rm(base,{recursive:true,force:true});}
});

// Home shows omitted outcomes without inventing scores; judge configurations stay separate.
test('overview highlights ungraded trials and separates model-specific rows with exact evidence navigation',
  {skip:!process.env.REPORT_PLAYWRIGHT_MODULE || !process.env.REPORT_CHROMIUM}, async()=>{
  const base=await mkdtemp(join(tmpdir(),'overview-browser-'));
  const {chromium}=await import(pathToFileURL(process.env.REPORT_PLAYWRIGHT_MODULE!).href);
  const browser=await chromium.launch({executablePath:process.env.REPORT_CHROMIUM,headless:true});
  try {
    const {workspace,manifest}=await fixture(base);
    const overview=JSON.parse(await readFile(join(workspace,'overview.json'),'utf8'));
    overview.trials.push({...overview.trials[0],sequence:2,trialId:'pending-trial',repetition:2,pairId:'pending-pair',status:'pending',attemptId:null,attemptStatus:null,selectedGradeId:null,grades:[],score:null});
    const bytes=JSON.stringify(overview),entry=manifest.files.find(f=>f.path==='overview.json')!;
    await writeFile(join(workspace,'overview.json'),bytes);entry.bytes=Buffer.byteLength(bytes);entry.sha256=hash(bytes);
    await writeFile(join(workspace,'export-manifest.json'),JSON.stringify(manifest));
    const output=join(base,'overview.html');let result=invoke(join(source,'scripts/generate-report.mjs'),['--workspace',workspace,'--output',output]);assert.equal(result.status,0,result.stderr);
    const page=await browser.newPage();await page.goto(pathToFileURL(output).href);
    assert.equal(await page.locator('#panel-overview').isVisible(),true);
    assert.equal(await page.locator('.overview-primary').count()>0,true);
    assert.equal(await page.locator('.overview-metrics').count()>0,true);
    assert.equal(await page.locator('#overview-method').getAttribute('open'),null);
    assert.equal(await page.locator('.overview-result').first().getAttribute('data-band'),'dark-green');
    assert.equal(await page.locator('.overview-primary').filter({hasText:'criteria failed'}).count(),0);
    assert.equal(await page.locator('.overview-row details[open]').count(),0);
    assert.match(await page.locator('#overview-summary').innerText(),/3 planned trials/);
    assert.match(await page.locator('#overview-context').innerText(),/candidate-model-A.*effective.*unknown/i);
    assert.match(await page.locator('#overview-rows').innerText(),/without selected verdict/);
    await page.getByRole('button',{name:'All evaluations',exact:true}).click();
    const disclosure=page.locator('#overview-rows details').first();await disclosure.locator('summary').click();
    const card=page.locator('.overview-row').first();const scoreBox=await card.locator('.overview-result').boundingBox(),coverageBox=await card.locator('.overview-metrics .overview-coverage').boundingBox();
    assert.ok(scoreBox!.y<coverageBox!.y+coverageBox!.height&&coverageBox!.y<scoreBox!.y+scoreBox!.height,'metric row shares vertical space');
    const actionBox=await card.locator('.overview-review').boundingBox(),summaryBox=await disclosure.locator('summary').boundingBox();
    assert.ok(Math.abs(actionBox!.y-summaryBox!.y)<15,'footer controls share row');
    assert.ok((await disclosure.locator('.overview-score').first().boundingBox())!.width>(await card.boundingBox())!.width*0.8,'expanded evidence spans card');
    await disclosure.locator('summary').click();await page.setViewportSize({width:320,height:844});await disclosure.locator('summary').click();
    assert.ok((await disclosure.locator('.overview-score').first().boundingBox())!.width>(await card.boundingBox())!.width*0.8);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.setViewportSize({width:1280,height:720});

    await page.getByRole('button',{name:'Open evidence',exact:true}).first().click();
    assert.equal(await page.locator('#panel-outputs').isVisible(),true);assert.equal(await page.locator('#source-label').innerText(),'declared-plugin:skill-1');
    await page.getByRole('button',{name:'Overview',exact:true}).click();assert.equal(await page.locator('#panel-overview').isVisible(),true);
    overview.trials[2].score={passed:1,failed:0,total:1,passRate:1};
    const invalid=JSON.stringify(overview);await writeFile(join(workspace,'overview.json'),invalid);entry.bytes=Buffer.byteLength(invalid);entry.sha256=hash(invalid);await writeFile(join(workspace,'export-manifest.json'),JSON.stringify(manifest));
    result=invoke(join(source,'scripts/generate-report.mjs'),['--workspace',workspace,'--output',join(base,'invalid.html')]);assert.notEqual(result.status,0);assert.match(result.stderr,/Unselected overview score/);
  } finally {await browser.close();await rm(base,{recursive:true,force:true});}
});

// Exercise renderer band boundaries, raw sorting, ties and nulls on detached overview rows.
test('overview colors raw score bands and sorts scored cards separately from unavailable cards',
  {skip:!process.env.REPORT_PLAYWRIGHT_MODULE || !process.env.REPORT_CHROMIUM},async()=>{
    const base=await mkdtemp(join(tmpdir(),'overview-bands-'));
    const {chromium}=await import(pathToFileURL(process.env.REPORT_PLAYWRIGHT_MODULE!).href);
    const browser=await chromium.launch({executablePath:process.env.REPORT_CHROMIUM,headless:true});
    try {
      const {workspace}=await fixture(base);const output=join(base,'report.html');
      assert.equal(invoke(join(source,'scripts/generate-report.mjs'),['--workspace',workspace,'--output',output]).status,0);
      const page=await browser.newPage();await page.goto(pathToFileURL(output).href);
      await page.evaluate(()=>{
        const data=(window as any).eval('EMBEDDED_DATA'),template=data.overview.trials[0];
        const values=[90,49.6,70,null,0,100,50,69.9,89.9,49.5,50,50];
        data.overview.trials=values.map((score,index)=>({...template,trialId:'band-'+index,scenarioId:'bands/'+index,pairId:'bandpair-'+index,
          selectedGradeId:score===null?null:template.selectedGradeId,score:score===null?null:{passed:score,failed:100-score,total:100,passRate:score/100},grades:[],source:{skillName:'bands-'+index}}));
        data.overview.trials[10].score={passed:1,failed:1,total:2,passRate:0.5};
        data.overview.trials[11].score={passed:10,failed:10,total:20,passRate:0.5};
        // Same score: 1/2 coverage must precede 1/1, without merging sources.
        data.overview.trials.push({...data.overview.trials[6],trialId:'tie',selectedGradeId:null,score:null,grades:[],repetition:2});
        (window as any).eval('renderOverview(false)');
      });
      assert.deepEqual(await page.locator('#overview-scored .overview-result').evaluateAll((els: Element[])=>els.map(el=>Number((el as HTMLElement).dataset.score))),[0,49.5,49.6,50,50,50,69.9,70,89.9,90,100]);
      assert.deepEqual(await page.locator('#overview-scored .overview-result').evaluateAll((els: Element[])=>els.map(el=>(el as HTMLElement).dataset.band)),['red','red','red','orange','orange','orange','orange','light-green','light-green','dark-green','dark-green']);
      assert.deepEqual(await page.locator('#overview-scored .overview-row').filter({has:page.locator('.overview-result[data-score="50"]')}).locator('h3').allTextContents(),['bands-6 · Scenario 6','bands-10 · Scenario 10','bands-11 · Scenario 11']);
      assert.equal(await page.locator('#overview-unavailable .overview-result').getAttribute('data-band'),'unavailable');
      assert.match(await page.locator('#overview-unavailable .overview-result').innerText(),/No score/);
      assert.equal(await page.locator('#overview-unavailable .overview-result strong').evaluate(el=>getComputedStyle(el).color),'rgb(180, 35, 24)');
      assert.equal(await page.locator('#overview-unavailable').evaluate(el=>!!(el.compareDocumentPosition(document.getElementById('overview-scored')!) & Node.DOCUMENT_POSITION_FOLLOWING)),true);
      assert.equal(await page.locator('#overview-unavailable .overview-result').getAttribute('data-score'),'');
      assert.equal(await page.locator('.overview-primary').filter({hasText:'criteria failed'}).count(),0);
      const details=page.locator('.overview-details').first();await details.locator('summary').click();assert.match(await details.innerText(),/with-profile criteria failed/);
    }finally{await browser.close();await rm(base,{recursive:true,force:true});}
  });

// Each rejection targets a different misleading-success observable: unfinished,
// altered, unbound, ambiguous, misgraded, heterogeneously paired, or destructive.
test('incomplete/corrupt/nonexport/ambiguous/mismatched workspaces fail before creating HTML', async () => {
  const script = join(source,'scripts/generate-report.mjs');
  const cases = [
    ...[
      ['overview-profile',(o: any)=>{o.profile.id='other';}],
      ['overview-process',(o: any)=>{o.trials[0].attemptStatus='nonsense';}],
      ['overview-pending',(o: any)=>{o.trials[0].status='pending';}],
      ['overview-judge',(o: any)=>{o.trials[0].grades[0].judge={model:{requested:'invented'}};}],
    ].map(([name,mutate]: any)=>[name,async(w: string,m: any)=>{
      const entry=m.files.find((f: any)=>f.path==='overview.json');const overview=JSON.parse(await readFile(join(w,'overview.json'),'utf8'));mutate(overview);
      const bytes=JSON.stringify(overview);await writeFile(join(w,'overview.json'),bytes);entry.bytes=Buffer.byteLength(bytes);entry.sha256=hash(bytes);
    }, /overview|Overview/]),
    ['missing-source', async (_w: string,m: any) => {delete m.runs[0].scenario.source;}, /explicit scenario source/],
    ['source-mismatch', async (_w: string,m: any) => {m.runs[0].scenario.source.skillName='other';}, /metadata mismatch/],
    ['pending', async (w: string) => writeFile(join(w,'.export-pending'),'pending'), /pending/],
    ['corrupt', async (w: string, m: any) => writeFile(join(w,m.files[0].path),'corrupt'), /mismatch/],
    ['unbound', async (w: string) => writeFile(join(w,'extra.txt'),'foreign'), /Unmanifested/],
    ['not-export', async (w: string) => rm(join(w,'export-manifest.json')), /Missing export-manifest/],
    ['duplicate-grade', async (_w: string, m: any) => {m.runs[1].gradeId=m.runs[0].gradeId;}, /Ambiguous/],
    ['heterogeneous', async (_w: string, m: any) => {m.runs[1].profile.revision='other';}, /Incompatible/],
    ['grade-summary', async (w: string, m: any) => {
      const entry=m.files.find((f: any)=>f.path.endsWith('with_skill/run-1/grading.json'));
      const bytes=JSON.stringify({expectations:[{text:'Correct answer',passed:true,evidence:'Evidence'}],summary:{passed:0,failed:1,total:1,pass_rate:0}});
      await writeFile(join(w,entry.path),bytes); entry.bytes=Buffer.byteLength(bytes); entry.sha256=hash(bytes);
    }, /summary mismatch/],
    ['path-escape', async (_w: string, m: any) => {m.files[0].path='../outside';}, /relative path/],
  ] as const;
  for (const [name, mutate, expected] of cases) {
    const base=await mkdtemp(join(tmpdir(),'report-reject-'));
    try {
      const {workspace,manifest}=await fixture(base); await mutate(workspace,manifest);
      if(name!=='not-export') await writeFile(join(workspace,'export-manifest.json'),JSON.stringify(manifest));
      const output=join(base,'report.html'); const result=invoke(script,['--workspace',workspace,'--output',output]);
      assert.notEqual(result.status,0,name); assert.match(result.stderr,expected,name);
      await assert.rejects(readFile(output),{code:'ENOENT'});
    } finally {await rm(base,{recursive:true,force:true});}
  }
  const base=await mkdtemp(join(tmpdir(),'report-overlap-'));
  try {
    const {workspace}=await fixture(base);
    const result=invoke(script,['--workspace',workspace,'--output',join(workspace,'review.html')]);
    assert.notEqual(result.status,0);assert.match(result.stderr,/outside/);
    await assert.rejects(readFile(join(workspace,'review.html')),{code:'ENOENT'});
  } finally {await rm(base,{recursive:true,force:true});}
});

// The copied installation must fail closed before output creation when its
// offline rendering closure is missing, altered, linked, or unsafe to inline.
// Exact vendor bytes travel in Base64 data scripts, outside the HTML tokenizer.
test('copied helper rejects unsafe or incomplete local report library bindings before writing HTML', async () => {
  const cases: [string, (root: string, manifest: any) => Promise<void>][] = [
    ['missing-manifest', async root => {await rm(join(root,'manifest.json'));}],
    ['invalid-json', async root => {await writeFile(join(root,'manifest.json'),'{');}],
    ['unsupported-schema', async (_root,m) => {m.schemaVersion=2;}],
    ['missing-library-binding', async (_root,m) => {m.libraries.pop();}],
    ['duplicate-library', async (_root,m) => {m.libraries.push({...m.libraries[0]});}],
    ['escaping-library-path', async (_root,m) => {m.libraries[0].path='../outside.js';}],
    ['escaping-license-path', async (_root,m) => {m.libraries[0].licensePath='../outside-license';}],
    ...['%2e%2e/report-viewer.html','licenses%2fmarked-LICENSE','licenses/marked-LICENSE?alias','licenses/marked-LICENSE#alias'].map(path => [
      `url-license-${path}`, async (_root: string,m: any) => {m.libraries[0].licensePath=path;},
    ] as [string, (root: string, manifest: any) => Promise<void>]),
    ['absolute-library-path', async (_root,m) => {m.libraries[0].path='/tmp/outside.js';}],
    ['missing-script', async (root,m) => {await rm(join(root,m.libraries[0].path));}],
    ['missing-license', async (root,m) => {await rm(join(root,m.libraries[0].licensePath));}],
    ['script-size-mismatch', async (_root,m) => {m.libraries[0].bytes+=1;}],
    ['script-hash-mismatch', async (root,m) => {
      const path=join(root,m.libraries[0].path), bytes=await readFile(path);
      bytes[0]^=1; await writeFile(path,bytes);
    }],
    ['license-hash-mismatch', async (root,m) => {await writeFile(join(root,m.libraries[0].licensePath),'altered license');}],
    ['linked-library-directory', async root => {
      const target=join(root,'../linked-libraries');
      await cp(root,target,{recursive:true}); await rm(root,{recursive:true}); await symlink(target,root);
    }],
    ['linked-script', async (root,m) => {
      const path=join(root,m.libraries[0].path), bytes=await readFile(path), target=join(root,'../linked-target.js');
      await writeFile(target,bytes); await rm(path); await symlink(target,path);
    }],
    ['linked-manifest', async root => {
      const path=join(root,'manifest.json'), target=join(root,'../linked-manifest.json');
      await cp(path,target); await rm(path); await symlink(target,path);
    }],

  ];
  for (const [name,mutate] of cases) {
    const base=await mkdtemp(join(tmpdir(),'report-libraries-reject-'));
    try {
      const {workspace}=await fixture(base), {installed,script}=await copyHelper(base);
      const root=join(installed,'assets/report-libraries'), manifestPath=join(root,'manifest.json');
      const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
      await mutate(root,manifest);
      if (!['missing-manifest','invalid-json','linked-manifest','linked-library-directory'].includes(name))
        await writeFile(manifestPath,JSON.stringify(manifest));
      const output=join(base,'review.html'), before=await readFile(join(workspace,'export-manifest.json'));
      const result=invoke(script,['--workspace',workspace,'--output',output]);
      assert.notEqual(result.status,0,name); assert.match(result.stderr,/Report generation failed:/,name);
      await assert.rejects(readFile(output),{code:'ENOENT'},name+' must not leave output');
      assert.deepEqual(await readFile(join(workspace,'export-manifest.json')),before);
    } finally {await rm(base,{recursive:true,force:true});}
  }
});

// Browser verification is opt-in with pre-existing tools, never an install or
// model call. Detects inert buttons, wrong comparison/feedback IDs, or network use.
test('generated standalone viewer keeps top transcript modes local and preserves raw bytes, grades and feedback',
  {skip:!process.env.REPORT_PLAYWRIGHT_MODULE || !process.env.REPORT_CHROMIUM}, async () => {
    const {chromium}=await import(pathToFileURL(process.env.REPORT_PLAYWRIGHT_MODULE!).href);
    const base=await mkdtemp(join(tmpdir(),'report-browser-'));
    const browser=await chromium.launch({executablePath:process.env.REPORT_CHROMIUM,headless:true});
    try {
      const {workspace}=await fixture(base), output=join(base,'review.html');
      const {installed,script}=await copyHelper(base);
      const result=invoke(script,['--workspace',workspace,'--output',output]);
      assert.equal(result.status,0,result.stderr);
      // Remove the copied helper/assets: the generated HTML must remain usable
      // without adjacent JS files or the authoring/install tree.
      await rm(installed,{recursive:true});
      const page=await browser.newPage({acceptDownloads:true});
      const errors: string[]=[], requests: string[]=[];
      page.on('pageerror',(error: Error)=>errors.push(error.message));
      await page.route(/^https?:/,async (route: any) => { requests.push(route.request().url()); await route.abort(); });
      page.on('request',(request: any)=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
      await page.goto(pathToFileURL(output).href);
      await page.getByRole('button',{name:'Review details',exact:true}).click();
      // A denied real clipboard is not a renderer failure: capture the exact
      // public writeText payload without depending on desktop clipboard policy.
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
        value: {writeText: async (text: string) => { (window as any).copiedRaw=text; }}, configurable:true,
      }));
      async function verifyModes(view: any, raw: string) {
        assert.equal(await view.locator('.json-inspection').count(),0,'no nested Inspect data mode selector');
        const toolbar=view.locator('.json-toolbar');
        assert.equal(await toolbar.isVisible(),true);
        assert.deepEqual(await toolbar.locator('button[aria-pressed]').allTextContents(),['Conversation','Tree view','Formatted JSON']);
        assert.equal(await toolbar.evaluate((el: Element) => el === el.parentElement!.firstElementChild),true,'toolbar precedes content');
        const conversation=view.locator('.conversation');
        // GFM semantics, not a pipe-delimited paragraph or manually split cells.
        const answer=conversation.locator('.chat-bubble').nth(1);
        const table=answer.locator('table');
        assert.equal(await table.count(),1,'assistant GFM table renders as a real table');
        assert.deepEqual(await table.locator('thead th').allTextContents(),['Item','Count','Note']);
        assert.deepEqual(await table.locator('tbody td').allTextContents(),['Bold cell','42','escaped|pipe']);
        assert.equal(await table.locator('tbody td strong').innerText(),'Bold cell');
        assert.deepEqual(await table.locator('thead th').evaluateAll((cells: Element[]) =>
          cells.map(cell => getComputedStyle(cell).textAlign)),['left','right','center']);
        assert.deepEqual(await table.locator('tbody td').evaluateAll((cells: Element[]) =>
          cells.map(cell => getComputedStyle(cell).textAlign)),['left','right','center']);
        assert.match(await answer.locator('ul li ul li').innerText(),/Nested item with inline code/);
        assert.equal(await answer.locator('li code').innerText(),'inline code');
        assert.equal((await answer.locator('pre code').textContent())!.trim(),'<script>window.codeInjected=true</script>');
        // Untrusted source remains readable; neither raw HTML nor Markdown
        // images may become executable/resource-loading DOM elements.
        assert.equal(await answer.locator('script,img,iframe,object,embed,svg,math,style,link').count(),0);
        assert.equal(await answer.locator('[onclick],[onerror],[onload]').count(),0);
        assert.match(await answer.innerText(),/<b onclick="window.rawInjected=true">Raw HTML stays literal<\/b>/);
        assert.match(await answer.innerText(),/<img src="https:\/\/report-attacker\.invalid\/raw\.png"/);
        assert.match(await answer.innerText(),/unsafe link/);
        assert.match(await answer.innerText(),/remote image/);
        assert.match(await answer.innerText(),/data image/);
        assert.equal(await answer.getByRole('link',{name:'safe link',exact:true}).getAttribute('href'),'https://example.invalid/docs');
        assert.equal(await answer.locator('*').evaluateAll((elements: Element[]) =>
          elements.some(el => [...el.attributes].some(attr => /^on/i.test(attr.name)))),false);
        assert.equal(await answer.locator('a').evaluateAll((links: HTMLAnchorElement[]) =>
          links.some(link => /^(?:javascript|data|vbscript):/i.test(link.getAttribute('href') || ''))),false);
        assert.equal(await page.evaluate(() => ['rawInjected','urlInjected','codeInjected','injected']
          .some(name => (window as any)[name] !== undefined)),false);
        const before=await conversation.innerHTML();
        assert.equal(await conversation.isVisible(),true);
        assert.equal(await view.getByRole('button',{name:'Conversation',exact:true}).getAttribute('aria-pressed'),'true');
        assert.equal(await view.getByRole('button',{name:'Expand all',exact:true}).isVisible(),false);
        // Technical disclosures stay in conversation rather than selecting JSON.
        await view.locator('.execution-details > summary').click();
        assert.equal(await conversation.isVisible(),true);
        await view.locator('.execution-details > summary').click();
        await view.getByRole('button',{name:'Tree view',exact:true}).click();
        assert.equal(await view.locator('.json-tree').isVisible(),true);
        assert.equal(await conversation.isVisible(),false);
        assert.equal(await view.getByRole('button',{name:'Tree view',exact:true}).getAttribute('aria-pressed'),'true');
        await view.getByRole('button',{name:'Expand all',exact:true}).click();
        assert.equal(await view.locator('.json-tree details:not([open])').count(),0);
        await view.getByRole('button',{name:'Collapse all',exact:true}).click();
        assert.equal(await view.locator('.json-tree details[open]').count(),0);
        await view.getByRole('button',{name:'Formatted JSON',exact:true}).click();
        assert.equal(await view.locator('.json-formatted').innerText(),JSON.stringify(JSON.parse(raw),null,2));
        assert.equal(await view.locator('.json-formatted').evaluate((el: HTMLElement)=>el.scrollWidth<=el.clientWidth),true,'formatted text stays in its card');
        assert.equal(await view.getByRole('button',{name:'Expand all',exact:true}).isVisible(),false);
        assert.equal(await view.getByRole('button',{name:'Collapse all',exact:true}).isVisible(),false);
        await view.getByRole('button',{name:'Copy raw JSON',exact:true}).click();
        assert.equal(await page.evaluate(() => (window as any).copiedRaw),raw);
        const rawDownload=page.waitForEvent('download');
        const downloadLink=toolbar.getByRole('link',{name:'Download raw JSON',exact:true});
        assert.equal(await downloadLink.getAttribute('title'),'Download raw JSON');
        assert.equal(await downloadLink.locator('svg').count(),1);
        assert.equal(await downloadLink.innerText(),'');
        await downloadLink.click();
        const download=await rawDownload, path=join(base,'raw.json'); await download.saveAs(path);
        assert.deepEqual(await readFile(path),Buffer.from(raw));
        await view.getByRole('button',{name:'Conversation',exact:true}).click();
        assert.equal(await conversation.isVisible(),true);
        // Details toggle updates its caption asynchronously; compare authored
        // bubbles, not transient disclosure text or rebuilt global cards.
        assert.equal(await conversation.locator('.chat-bubble').count(),2);
        assert.equal(await toolbar.isVisible(),true);
        assert.equal(await conversation.innerHTML(),before);
      }
      const gradeSummary=page.locator('#grades-section .grades-summary');
      assert.equal(await gradeSummary.isVisible(),true,'formal result visible without expanding criteria');
      assert.match(await gradeSummary.innerText(),/100%.*1 passed, 0 failed of 1/s);
      assert.equal(await page.locator('#grades-section').evaluate((el: Element) => !!(el.compareDocumentPosition(document.getElementById('outputs-body')!) & Node.DOCUMENT_POSITION_FOLLOWING)),true,'formal grades precede outputs');
      const gradeDetails=page.locator('#grades-section details');
      assert.equal(await gradeDetails.getAttribute('open'),null);
      await gradeDetails.locator('summary').focus(); await page.keyboard.press('Enter');
      assert.equal(await gradeDetails.locator('.assertion-evidence').isVisible(),true);
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#source-label').innerText(),'declared-plugin:skill-1');
      assert.equal(await page.locator('#prompt-text').count(),0);
      const supporting=page.locator('details.supporting-artifacts');
      assert.equal(await supporting.getAttribute('open'),null);
      await supporting.locator(':scope > summary').click();
      assert.equal(await page.locator('#feedback-dock').evaluate((el: Element) => !document.querySelector('.main')!.contains(el)),true);
      for (const [name, raw] of Object.entries(diagnostics)) {
        const card=page.locator('.output-file').filter({has:page.locator('.output-file-header span',{hasText:name})});
        const disclosure=card.locator('details.artifact-disclosure');
        assert.equal(await disclosure.count(),1,name);
        assert.equal(await disclosure.getAttribute('open'),null,name+' starts collapsed');
        assert.equal(await card.locator('pre').isVisible(),false);
        const downloadPromise=page.waitForEvent('download');
        await card.getByRole('link',{name:'Download',exact:true}).click();
        const download=await downloadPromise, saved=join(base,'diagnostic.txt'); await download.saveAs(saved);
        assert.deepEqual(await readFile(saved),Buffer.from(raw),'collapsed download retains bytes');
        await disclosure.locator('summary').focus(); await page.keyboard.press('Enter');
        assert.equal(await card.locator('pre').isVisible(),true);
        assert.equal(await card.locator('pre').textContent(),raw);
        await page.keyboard.press('Enter');
        assert.equal(await card.locator('pre').isVisible(),false);
      }
      const transcriptView=page.locator('.output-file').first();
      await page.locator('#feedback').fill('Single feedback');
      const singleGrade=await page.locator('#grades-section').innerHTML();
      await verifyModes(transcriptView,transcript);
      assert.equal(await page.locator('#feedback').inputValue(),'Single feedback');
      assert.equal(await page.locator('#grades-section').innerHTML(),singleGrade);
      const otherJson=page.locator('.output-file').filter({has:page.locator('.output-file-header span',{hasText:'artifacts/workspace/result.json'})});
      assert.equal(await otherJson.locator('.json-tree').isVisible(),true);
      assert.equal(await otherJson.getByRole('button',{name:'Conversation',exact:true}).count(),0);
      await page.getByRole('button',{name:'Compare',exact:true}).click();
      assert.equal(await page.locator('.chat-bubble').count(),4);
      assert.equal(await page.locator('.panel-grades').count(),2);
      const fields=page.locator('.panel-feedback textarea'); assert.equal(await fields.count(),2);
      await fields.nth(0).fill('With feedback');await fields.nth(1).fill('Without feedback');
      const left=page.locator('.condition-panel').nth(0), right=page.locator('.condition-panel').nth(1);
      for (const panel of [left,right]) {
        assert.equal(await panel.locator('.grades-summary').isVisible(),true);
        assert.equal(await panel.locator('.panel-grades').evaluate((el: Element) => !!(el.compareDocumentPosition(el.parentElement!.querySelector('.conversation-card')!) & Node.DOCUMENT_POSITION_FOLLOWING)),true,'comparison grade precedes conversation');
        assert.equal(await panel.locator('.panel-grades details').getAttribute('open'),null);
      }
      const gradesBefore=await page.locator('.panel-grades').allInnerTexts();
      const rightBefore=await right.innerHTML();
      await left.getByRole('button',{name:'Tree view',exact:true}).click();
      assert.equal(await left.locator('.json-tree').isVisible(),true);
      assert.equal(await right.locator('.conversation').isVisible(),true);
      assert.equal(await right.innerHTML(),rightBefore,'left mode never mutates right card');
      await left.getByRole('button',{name:'Conversation',exact:true}).click();
      await verifyModes(left.locator('.conversation-card'),transcript);
      assert.deepEqual(await page.locator('.panel-grades').allInnerTexts(),gradesBefore);
      assert.deepEqual(await fields.evaluateAll((els: HTMLTextAreaElement[])=>els.map(el=>el.value)),['With feedback','Without feedback']);
      await page.getByRole('button',{name:'With skill',exact:true}).click();
      assert.equal(await page.locator('#feedback').inputValue(),'With feedback');
      await page.getByRole('button',{name:'Without skill',exact:true}).click();
      assert.equal(await page.locator('#feedback').inputValue(),'Without feedback');
      await page.getByRole('button',{name:'Compare',exact:true}).click();
      const downloadPromise=page.waitForEvent('download');await page.locator('#done-btn').click();
      const download=await downloadPromise;const saved=join(base,'feedback.json');await download.saveAs(saved);
      const feedback=JSON.parse(await readFile(saved,'utf8'));
      assert.deepEqual(feedback.reviews.map((row: any)=>[row.run_id,row.feedback]),
        [['eval-1-with_skill-run-1','With feedback'],['eval-1-without_skill-run-1','Without feedback']]);
      // A one-sided selection is not a failed grade and must not reuse stale
      // feedback/grades from the present arm for the unavailable counterpart.
      await page.evaluate(() => { (window as any).eval('EMBEDDED_DATA.runs.splice(1); showRun(0);'); });
      await page.getByRole('button',{name:'Without skill',exact:true}).click();
      assert.match(await page.locator('#outputs-body').innerText(),/Without skill.*case 1.*repetition 1.*not included/i);
      assert.equal(await page.locator('#grades-section').isVisible(),false);
      assert.equal(await page.locator('#feedback').isVisible(),false);
      await page.getByRole('button',{name:'Compare',exact:true}).click();
      assert.equal(await page.locator('.panel-grades').count(),1);
      assert.match(await page.locator('.condition-panel').nth(1).innerText(),/Unavailable/);
      await page.getByRole('button',{name:'With skill',exact:true}).click();
      assert.equal(await page.locator('#grades-section .grades-summary').isVisible(),true);
      assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
    } finally {await browser.close();await rm(base,{recursive:true,force:true});}
});

// Exercises intact generated partial exports, not mutated embedded data: navigation
// must expose an available run without inventing a cross-repetition counterpart.
test('partial export navigation selects a unique available arm and explains explicitly missing conditions',
  {skip:!process.env.REPORT_PLAYWRIGHT_MODULE || !process.env.REPORT_CHROMIUM}, async () => {
    const {chromium}=await import(pathToFileURL(process.env.REPORT_PLAYWRIGHT_MODULE!).href);
    const base=await mkdtemp(join(tmpdir(),'report-partial-'));
    const browser=await chromium.launch({executablePath:process.env.REPORT_CHROMIUM,headless:true});
    try {
      const {workspace}=await fixture(base,[
        {evalId:1,condition:'with',repetition:1}, {evalId:1,condition:'without',repetition:1},
        {evalId:2,condition:'with',repetition:2}, {evalId:2,condition:'without',repetition:1},
        {evalId:3,condition:'with',repetition:1}, {evalId:3,condition:'without',repetition:1},
      ]);
      const before=await readFile(join(workspace,'export-manifest.json'));
      const output=join(base,'review.html');
      const result=invoke(join(source,'scripts/generate-report.mjs'),['--workspace',workspace,'--output',output]);
      assert.equal(result.status,0,result.stderr);
      const page=await browser.newPage(); const errors: string[]=[];
      page.on('pageerror',(error: Error)=>errors.push(error.message));
      await page.goto(pathToFileURL(output).href);
      await page.getByRole('button',{name:'Review details',exact:true}).click();
      await page.locator('#feedback').fill('Case 1 with');
      await page.locator('#next-btn').click();
      // Exporter layout order places With/run-2 before Without/run-1: preserve initial
      // repetition order rather than silently renumbering the exported trials.
      assert.match(await page.locator('#case-status').innerText(),/Case 2 · Repetition 2/);
      assert.equal(await page.locator('#source-label').innerText(),'declared-plugin:skill-2');
      await page.locator('#feedback').fill('Case 2 with run 2');
      await page.locator('#repetition-select').selectOption({label:'Repetition 1'});
      assert.equal(await page.getByRole('button',{name:'Without skill',exact:true}).getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('#grades-section .grades-summary').isVisible(),true);
      assert.equal(await page.locator('.chat-bubble').count(),2);
      assert.equal(await page.locator('#feedback').inputValue(),'');
      await page.locator('#feedback').fill('Case 2 without run 1');
      await page.getByRole('button',{name:'With skill',exact:true}).click();
      const missing=await page.locator('#outputs-body').innerText();
      assert.match(missing,/With skill.*case 2.*repetition 1.*not included/i);
      assert.match(missing,/Without skill.*available/i);
      assert.equal(await page.locator('#grades-section').isVisible(),false);
      assert.equal(await page.locator('#feedback').isVisible(),false);
      await page.getByRole('button',{name:'Compare',exact:true}).click();
      assert.equal(await page.locator('.panel-grades').count(),1,'no cross-repetition pair');
      assert.match(await page.locator('.condition-panel').first().innerText(),/With skill.*case 2.*repetition 1.*not included/i);
      await page.locator('#repetition-select').selectOption({label:'Repetition 2'});
      assert.equal(await page.getByRole('button',{name:'Compare',exact:true}).getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('.panel-grades').count(),1);
      await page.locator('#next-btn').click();
      assert.equal(await page.getByRole('button',{name:'Compare',exact:true}).getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('.panel-grades').count(),2);
      await page.getByRole('button',{name:'Without skill',exact:true}).click();
      await page.locator('#prev-btn').click();
      assert.equal(await page.getByRole('button',{name:'With skill',exact:true}).getAttribute('aria-pressed'),'true','case navigation picks unique available alternative');
      assert.equal(await page.locator('#feedback').inputValue(),'Case 2 with run 2');
      await page.locator('#repetition-select').selectOption({label:'Repetition 1'});
      assert.equal(await page.locator('#feedback').inputValue(),'Case 2 without run 1');
      await page.locator('#prev-btn').click();
      assert.equal(await page.getByRole('button',{name:'Without skill',exact:true}).getAttribute('aria-pressed'),'true','complete pair preserves selected arm');
      await page.getByRole('button',{name:'With skill',exact:true}).click();
      assert.equal(await page.locator('#feedback').inputValue(),'Case 1 with');
      assert.deepEqual(await readFile(join(workspace,'export-manifest.json')),before);
      assert.deepEqual(errors,[]);
    } finally {await browser.close();await rm(base,{recursive:true,force:true});}
  });
