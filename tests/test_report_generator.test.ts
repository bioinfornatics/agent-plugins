import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
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
const transcript = ' { "messages": [{"role":"user","content":[{"type":"text","text":"Question"}]},{"role":"assistant","content":[{"type":"text","text":"**Answer**"}]}], "n":1.00 }\r\n';
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
    const runMetadata = {...metadata, eval_id:evalId, id:`scenario/${evalId}`};
    const scenarioPath = `iteration-1/eval-${evalId}/eval_metadata.json`;
    if (!files.some(file => file.path === scenarioPath)) await add(scenarioPath, JSON.stringify(runMetadata));
    const path = `iteration-1/eval-${evalId}/${condition === 'with' ? 'with_skill' : 'without_skill'}/run-${repetition}`;
    const gradeId = grades[index] || `${String(index+2).padStart(8,'0')}-4444-4444-8444-444444444444`;
    selectedGrades.push(gradeId);
    runs.push({path, condition, evalId, repetition, campaignId:campaign, gradeId, trialId:`trial-${index}`,
      attemptId:gradeId, manifestDigest:'a'.repeat(64), evidenceDigest:'b'.repeat(64), requestDigest:'c'.repeat(64),
      profile:{name:'Example profile', revision:'revision'}, scenario:{id:`scenario/${evalId}`}, agent:'goose', protectedRoots:[]});
    await add(`${path}/eval_metadata.json`, JSON.stringify(runMetadata));
    await add(`${path}/grading.json`, JSON.stringify(grading));
    await add(`${path}/outputs/transcript.json`, transcript);
    await add(`${path}/outputs/artifacts/workspace/result.json`, ' {"n":1.00}\n');
    for (const [name, bytes] of Object.entries(diagnostics)) await add(`${path}/outputs/${name}`, bytes);
    await add(`${path}/outputs/artifacts/raw.bin`, Buffer.from([0,255]).toString('latin1'));
  }
  const manifest = {schemaVersion:1, method:'agent-plugin-explicit-quality-v1', status:'complete', kind:'workspace', campaignId:campaign,
    selection:{strategy:'explicit-one-grade-per-logical-trial', gradingIds:selectedGrades}, runs, files};
  await writeFile(join(workspace,'export-manifest.json'),JSON.stringify(manifest));
  return {workspace, manifest};
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
    const installed = join(base,'installed skill');
    await mkdir(join(installed,'scripts'),{recursive:true}); await mkdir(join(installed,'assets'));
    await cp(join(source,'scripts/generate-report.mjs'),join(installed,'scripts/generate-report.mjs'));
    await cp(join(source,'assets/report-viewer.html'),join(installed,'assets/report-viewer.html'));
    const script = join(installed,'scripts/generate-report.mjs');
    assert.equal(invoke(script,['--help']).status,0);
    const before = await readFile(join(workspace,'export-manifest.json'));
    const output = join(base,'report with spaces.html');
    const result = invoke(script,['--workspace',workspace,'--output',output,'--skill-name','Supplied label']);
    assert.equal(result.status,0,result.stderr); assert.equal(result.stderr,'');
    const html = await readFile(output,'utf8'), data = dataFrom(html);
    assert.equal(data.skill_name,'Supplied label'); assert.equal(data.runs.length,2);
    assert.deepEqual(data.runs.map((run: any) => run.id),['eval-1-with_skill-run-1','eval-1-without_skill-run-1']);
    assert.equal(data.export_provenance.manifest_sha256,hash(before));
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
    assert.equal(invoke(script,['--workspace',workspace,'--output',repeat,'--skill-name','Supplied label']).status,0);
    assert.equal(await readFile(repeat,'utf8'),html);
  } finally { await rm(base,{recursive:true,force:true}); }
});

// Each rejection targets a different misleading-success observable: unfinished,
// altered, unbound, ambiguous, misgraded, heterogeneously paired, or destructive.
test('incomplete/corrupt/nonexport/ambiguous/mismatched workspaces fail before creating HTML', async () => {
  const script = join(source,'scripts/generate-report.mjs');
  const cases = [
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

// Browser verification is opt-in with pre-existing tools, never an install or
// model call. Detects inert buttons, wrong comparison/feedback IDs, or network use.
test('generated standalone viewer keeps top transcript modes local and preserves raw bytes, grades and feedback',
  {skip:!process.env.REPORT_PLAYWRIGHT_MODULE || !process.env.REPORT_CHROMIUM}, async () => {
    const {chromium}=await import(pathToFileURL(process.env.REPORT_PLAYWRIGHT_MODULE!).href);
    const base=await mkdtemp(join(tmpdir(),'report-browser-'));
    const browser=await chromium.launch({executablePath:process.env.REPORT_CHROMIUM,headless:true});
    try {
      const {workspace}=await fixture(base), output=join(base,'review.html');
      const result=invoke(join(source,'scripts/generate-report.mjs'),['--workspace',workspace,'--output',output]);
      assert.equal(result.status,0,result.stderr);
      const page=await browser.newPage({acceptDownloads:true});
      const errors: string[]=[], requests: string[]=[];
      page.on('pageerror',(error: Error)=>errors.push(error.message));
      page.on('request',(request: any)=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
      await page.goto(pathToFileURL(output).href);
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
      await page.locator('#feedback').fill('Case 1 with');
      await page.locator('#next-btn').click();
      // Exporter layout order places With/run-2 before Without/run-1: preserve initial
      // repetition order rather than silently renumbering the exported trials.
      assert.match(await page.locator('#case-status').innerText(),/Case 2 · Repetition 2/);
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
