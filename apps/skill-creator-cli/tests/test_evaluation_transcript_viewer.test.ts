import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {renderIsolatedEvaluationReport,analyzeIsolatedEvaluationReport} from '../dist/scripts/evaluation_report.js';
const hash=(s:Buffer|string)=>createHash('sha256').update(s).digest('hex');
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'transcript-viewer-'));
 const source={protocol:'goose-session-log-v1',session_name:'test',redacted:false,completeness:'complete-visible-text',messages:[{role:'user',text:['first é user']},{role:'assistant',text:['CANARY_PRIVATE_VALUE <script>alert(1)</script>']},{role:'user',text:['third user']},{role:'assistant',text:['last assistant']},{role:'system',text:['HIDDEN_SYSTEM']},{role:'assistant',annotations:{audience:['assistant']},text:['HIDDEN_INTERNAL']}],omitted:{thinking:1,toolResponse:2}};
 const bytes=JSON.stringify(source);mkdirSync(join(root,'a'));writeFileSync(join(root,'a/session-log.json'),bytes);
 const run={case_id:'case',repeat:1,arm:'with_targets',status:'succeeded',directory:'a',output:'FINAL_LITERAL',session_log:{status:'retained',path:'session-log.json',bytes:Buffer.byteLength(bytes),sha256:hash(bytes),session_name:'test'}};
 const row=(configuration:string)=>({eval_id:'case',run_number:1,configuration,execution_status:'succeeded',grading_status:'complete',expectations:[{text:'criterion',passed:true,evidence:'judge quote'}]});
 const report:any={schema_version:'isolated-evaluation-v1',mode:'behavioral',status:'complete',output:root,cases:[{id:'case'}],runs:[run,{case_id:'case',repeat:1,arm:'baseline',status:'succeeded'}],rows:[row('with_skill'),row('without_skill')]};
 return {root,report,run,bytes};
}
const model=(html:string)=>JSON.parse(html.split('<script id="review-data" type="application/json">')[1].split('</script>')[0]);
test('canonical adapter shows chronological literal visible messages and final response without optional previews',()=>{const f=fixture();try{
 const before=analyzeIsolatedEvaluationReport(f.report),html=renderIsolatedEvaluationReport(f.report),side=model(html).items[0].current;
 assert.deepEqual(side.transcript.messages.map((m:any)=>m.text),['first é user','CANARY_PRIVATE_VALUE <script>alert(1)</script>','third user','last assistant']);
 assert.equal(side.response,'FINAL_LITERAL');assert.equal(side.transcript.omitted.thinking,1);assert.doesNotMatch(html,/HIDDEN_SYSTEM|HIDDEN_INTERNAL|<script>alert/);assert.match(html,/CANARY_PRIVATE_VALUE &lt;script&gt;/);assert.match(html,/Visible conversation/);assert.match(html,/Final response/);
 assert.deepEqual(analyzeIsolatedEvaluationReport(f.report),before);assert.equal(readFileSync(join(f.root,'a/session-log.json'),'utf8'),f.bytes);
 }finally{rmSync(f.root,{recursive:true,force:true});}});
test('missing, hash-drifted, oversized and symlink transcripts show gaps without changing grades',()=>{const f=fixture();try{
 for(const kind of ['hash','oversize','missing','symlink']){
  const binding={...f.run.session_log};f.run.session_log=binding;
  if(kind==='hash')binding.sha256='0'.repeat(64);
  if(kind==='oversize')binding.bytes=3*1024*1024;
  if(kind==='missing')f.run.directory='missing';
  if(kind==='symlink'){f.run.directory='alias';symlinkSync(join(f.root,'a'),join(f.root,'alias'));}
  const side=model(renderIsolatedEvaluationReport(f.report)).items[0].current;assert.equal(side.transcript.status,'unavailable',kind);assert.equal(side.verdict,'Pass');assert.equal(side.transcript.messages.length,0);
  f.run.directory='a';f.run.session_log={status:'retained',path:'session-log.json',bytes:Buffer.byteLength(f.bytes),sha256:hash(f.bytes),session_name:'test'};
 }
 }finally{rmSync(f.root,{recursive:true,force:true});}});
test('large visible projection explicitly truncates, retains literal prefix and immutable full archive',()=>{const f=fixture();try{
 const source=JSON.parse(f.bytes);source.messages=[{role:'assistant',text:['LONG_CANARY '+ '界'.repeat(200000)]}];const bytes=JSON.stringify(source);writeFileSync(join(f.root,'a/session-log.json'),bytes);Object.assign(f.run.session_log,{bytes:Buffer.byteLength(bytes),sha256:hash(bytes)});
 const html=renderIsolatedEvaluationReport(f.report),side=model(html).items[0].current;
 assert.equal(side.transcript.truncated,true);assert.equal(side.transcript.messages[0].text.length,128*1024);assert.match(html,/projection truncated/i);assert.equal(hash(readFileSync(join(f.root,'a/session-log.json'))),hash(bytes));
 }finally{rmSync(f.root,{recursive:true,force:true});}});

import {chromium} from 'playwright-core';
import {systemChromiumExecutable} from './browser-fixture.ts';
import {runRenderReportCli} from '../dist/scripts/render_evaluation_report.js';
test('render-report reads bound transcript by default, preserves reports and archives, and executes no candidates',async()=>{const f=fixture();try{
 const input=join(f.root,'report.json'),output=join(f.root,'rerender.html');const bytes=JSON.stringify(f.report);writeFileSync(input,bytes);
 assert.equal(await runRenderReportCli(['--report',input,'--output',output]),0);
 assert.equal(model(readFileSync(output,'utf8')).items[0].current.transcript.messages[2].text,'third user');
 assert.equal(readFileSync(input,'utf8'),bytes);assert.equal(readFileSync(join(f.root,'a/session-log.json'),'utf8'),f.bytes);
 }finally{rmSync(f.root,{recursive:true,force:true});}});
test('offline Chromium desktop/mobile keyboard, no-JS and print show literal conversations without network or overflow',async()=>{const f=fixture();let browser;try{
 const file=join(f.root,'review.html');writeFileSync(file,renderIsolatedEvaluationReport(f.report));
 browser=await chromium.launch({headless:true,executablePath:systemChromiumExecutable()});
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900}});const page=await context.newPage();const network:string[]=[];
  page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});await page.goto('file://'+file);await page.locator('#criterion-list button').first().click();
  const arm=page.locator('#inspector .arm').first();await arm.getByText('first é user',{exact:true}).waitFor();
  assert.deepEqual(await arm.locator('ol.conversation li h4').allTextContents(),['1 · user','2 · assistant','3 · user','4 · assistant']);
  assert.match(await arm.innerText(),/CANARY_PRIVATE_VALUE <script>alert\(1\)<\/script>/);assert.match(await arm.innerText(),/FINAL_LITERAL/);
  const summary=arm.locator('summary').filter({hasText:'Ordered user'});await summary.focus();await page.keyboard.press('Space');assert.equal(await summary.evaluate(e=>(e.parentElement as HTMLDetailsElement).open),false);await page.keyboard.press('Space');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);assert.deepEqual(network,[]);
  if(process.env.VIEWER_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.VIEWER_SCREENSHOT_DIR,mobile?'mobile.png':'desktop.png'),fullPage:true});
  await page.emulateMedia({media:'print'});assert.match(await page.locator('.fallback').innerText(),/first é user/);assert.match(await page.locator('.fallback').innerText(),/FINAL_LITERAL/);await context.close();
 }
 const context=await browser.newContext({javaScriptEnabled:false});const page=await context.newPage();await page.goto('file://'+file);assert.match(await page.locator('.fallback').innerText(),/third user/);assert.match(await page.locator('.fallback').innerText(),/FINAL_LITERAL/);await context.close();
 }finally{if(browser)await browser.close();rmSync(f.root,{recursive:true,force:true});}});

test('exact case arm repeat bindings isolate conversations and reject ambiguous execution slots',()=>{const f=fixture();try{
 mkdirSync(join(f.root,'b'));const source=JSON.parse(f.bytes);source.messages=[{role:'assistant',text:['REFERENCE_ONLY']}];const bytes=JSON.stringify(source);writeFileSync(join(f.root,'b/session-log.json'),bytes);
 Object.assign(f.report.runs[1],{directory:'b',output:'REFERENCE_FINAL',session_log:{...f.run.session_log,bytes:Buffer.byteLength(bytes),sha256:hash(bytes)}});
 let item=model(renderIsolatedEvaluationReport(f.report)).items[0];assert.equal(item.reference.transcript.messages[0].text,'REFERENCE_ONLY');assert.equal(item.current.transcript.messages[0].text,'first é user');
 f.report.runs.push({...f.run,repeat:2,directory:'b',session_log:f.report.runs[1].session_log});f.report.rows.push({...f.report.rows[0],run_number:2});
 const items=model(renderIsolatedEvaluationReport(f.report)).items;assert.equal(items.find((i:any)=>i.run_number===2).current.transcript.messages[0].text,'REFERENCE_ONLY');
 f.report.runs.push({...f.run});item=model(renderIsolatedEvaluationReport(f.report)).items.find((i:any)=>i.run_number===1);assert.equal(item.current.transcript.status,'unavailable');assert.equal(item.reference.transcript.messages[0].text,'REFERENCE_ONLY');
 }finally{rmSync(f.root,{recursive:true,force:true});}});
