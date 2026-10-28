import test from "node:test";
import assert from "node:assert/strict";
import * as renderer from "../dist/scripts/evaluation_report.js";
const criterion=(text:string,passed:boolean|null)=>({text,passed,evidence:"quoted observation <safe>",rationale:"reason supplied"});
const row=(configuration:string,expectations:any[],extra:any={})=>({eval_id:0,eval_name:"Decision scenario",run_number:1,configuration,expectations,result:{time_seconds:null,tokens:null},...extra});
const report=(rows:any[]=[])=>({schema_version:"isolated-evaluation-v1",mode:"behavioral",status:"complete",selected_targets:["bundle:writer"],requested_skills:[],requested_plugins:["bundle"],requested_plugin_paths:["/sources/full-bundle"],runs_per_query:2,model:null,provider:null,cases:[{id:0,prompt:"private prompt",expectations:[]}],runs:[{case_id:0,repeat:1,arm:"with_targets",status:"succeeded",output:"PRIVATE_RAW_OUTPUT"},{case_id:0,repeat:1,arm:"baseline",status:"succeeded"}],campaigns:[],rows,missing_runs:[]});
const render=(r:unknown)=>{assert.equal(typeof renderer.renderIsolatedEvaluationReport,"function");return renderer.renderIsolatedEvaluationReport(r);};
test("malformed behavioral rows payload is rejected rather than silently empty",()=>{
 assert.throws(()=>renderer.sessionEvaluationHtml("Behavioral","complete",{rows:[row("with_skill",[criterion("a",true)])]}),/runs|behavioral/i);
});
test("criterion comparisons retain gains, regressions and uncertainty within aggregate failures",()=>{
 const html=renderer.sessionEvaluationHtml("Behavioral","inconclusive",{runs:[row("with_skill",[criterion("gain",true),criterion("regression",false),criterion("gap",false),criterion("unknown",null)]),row("without_skill",[criterion("gain",false),criterion("regression",true),criterion("gap",false),criterion("unknown",null)])],pending:[]});
 const model=JSON.parse(html.split('<script id='+String.fromCharCode(34)+'review-data'+String.fromCharCode(34)+' type='+String.fromCharCode(34)+'application/json'+String.fromCharCode(34)+'>')[1].split('</script>')[0]);assert.equal(model.comparison.criteria.gains,1);assert.equal(model.comparison.criteria.regressions,1);assert.match(html,/Criterion side-by-side/);assert.match(html,/Shared gap/);assert.match(html,/Evidence quote/);assert.match(html,/reason supplied/);assert.ok(model.items.some((i:any)=>i.anchors.includes("evidence-0-criterion-1")));
});
test("pair coverage is mutually exclusive without changing legacy statistics",()=>{
 const rows=[row("with_skill",[criterion("a",true)]),row("without_skill",[criterion("a",false)])];
 rows.push(row("with_skill",[criterion("a",null)],{eval_id:1}),row("without_skill",[criterion("a",false)],{eval_id:1}));
 rows.push(row("with_skill",[criterion("a",true)],{eval_id:2}));
 rows.push(row("with_skill",[criterion("a",true)],{eval_id:3}),row("without_skill",[criterion("b",false)],{eval_id:3}));
 const v=renderer.analyzePairedValue(rows,[]);assert.equal(v.complete_pairs,1);assert.equal(v.incomplete_pairs,3);assert.equal(v.criteria.gains,1);assert.equal(v.metrics.quality.mean_delta,1);
 assert.deepEqual(v.coverage,{total_groups:4,conclusive:1,with_indeterminate_criteria:1,missing_or_ungraded:1,noncomparable:1});
});
test("isolated adapter names context, projects only allowed evidence and never infers null metadata",()=>{
 const r=report([row("with_skill",[criterion("a",true)],{grading_status:"complete",execution_status:"succeeded"}),row("without_skill",[criterion("a",false)],{grading_status:"complete",execution_status:"succeeded"})]);
 const before=JSON.stringify(r),html=render(r);assert.equal(JSON.stringify(r),before);
 for(const text of ["bundle:writer","/sources/full-bundle","Full plugin","No selected capability","Model: Unavailable","Provider: Unavailable","Repeats: 2","Execution completeness","Grading completeness","not a per-skill causal claim"])assert.ok(html.includes(text),text);
 assert.ok(!html.includes("PRIVATE_RAW_OUTPUT"));assert.ok(!html.includes("private prompt"));assert.ok(!html.includes("Technical data (JSON)"));assert.match(html,/Content-Security-Policy/);
 assert.match(html,/&lt;safe&gt;/);
});
test("unknown grading status cannot silently pass and supplied disputes do not rewrite judgments",()=>{
 const r:any=report([row("with_skill",[criterion("a",true)],{grading_status:"unexpected"}),row("without_skill",[criterion("a",false)],{grading_status:"complete"})]);
 r.review_findings=[{criterion:"a",verdict:"disputed",evidence:"review quote",rationale:"review reason",output:"PRIVATE_REVIEW_OUTPUT"}];const html=render(r);
 assert.match(html,/Unknown grading status/);assert.match(html,/Supplied review findings/);assert.match(html,/review reason/);assert.match(html,/do not alter grades/);assert.ok(!html.includes("PRIVATE_REVIEW_OUTPUT"));assert.match(html,/0 fully graded pairs/);
});
test("adapter validates isolated schema and mode; activation remains supported",()=>{
 assert.throws(()=>render({schema_version:"wrong",mode:"behavioral",rows:[]}),/schema/i);
 assert.throws(()=>render({...report(),mode:"wrong"}),/mode/i);
 assert.throws(()=>render({...report(),rows:undefined}),/rows/i);
 const html=render({...report(),mode:"activation",activation_results:[{query:"Load writer",arm:"with_targets",repetition:1,role:"activation-measure",expected_skills:["bundle:writer"],requested_skills:["bundle:writer"],target_requested_skills:["bundle:writer"],pass:true}]});assert.match(html,/Load writer/);assert.match(html,/selection accuracy/);
 assert.match(renderer.sessionEvaluationHtml("Activation","complete",{results:[],pending:[]}),/Activation evaluation/);
});

 test("coverage separates duplicates, ungraded and inconclusive without double counting",()=>{
 const rows=[row("with_skill",[criterion("a",true)]),row("with_skill",[criterion("a",false)]),row("without_skill",[criterion("a",true)]),row("with_skill",[criterion("a",true)],{eval_id:1,grading_status:"absent"}),row("without_skill",[criterion("a",true)],{eval_id:1})];
 const v=renderer.analyzePairedValue(rows,[]);assert.deepEqual(v.coverage,{total_groups:2,conclusive:0,with_indeterminate_criteria:0,missing_or_ungraded:1,noncomparable:1});assert.equal(v.criteria.gains,0);
 assert.throws(()=>renderer.sessionEvaluationHtml("Behavioral","complete",{runs:[row("with_skill",[null])]}),/behavioral/i);
 });
 test("raw execution failure overrides projected pass and planned missing slots appear",()=>{
 const r:any=report([row("with_skill",[criterion("a",true)],{grading_status:"complete",execution_status:"succeeded"}),row("without_skill",[criterion("a",true)],{grading_status:"complete",execution_status:"succeeded"})]);
 r.runs=[{case_id:0,repeat:1,arm:"with_targets",status:"failure",output:"DO_NOT_SHOW"},{case_id:0,repeat:1,arm:"baseline",status:"succeeded"}];
 const html=render(r);assert.match(html,/1 failure/);assert.match(html,/2 missing slots/);assert.match(html,/Execution not succeeded/);assert.match(html,/0 fully graded pairs/);assert.match(html,/2 total groups/);assert.ok(!html.includes("DO_NOT_SHOW"));
 });

test("retained ungraded executions remain visible when projected rows are absent",()=>{
 const html=render({...report(),runs_per_query:1});assert.match(html,/1 total groups/);assert.match(html,/1 missing or ungraded/);assert.match(html,/Grading unavailable/);assert.match(html,/0 fully graded pairs/);
});

test("Chromium renders comparisons, follows evidence links and supports narrow viewports",async()=>{
 const {chromium}=await import("playwright-core");const {systemChromiumExecutable}=await import("./browser-fixture.ts");const browser=await chromium.launch({headless:true,executablePath:systemChromiumExecutable()});
 try {const page=await browser.newPage({viewport:{width:1280,height:900}});const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 const r:any=report([row("with_skill",[criterion("gain",true),criterion("regression",false)],{grading_status:"complete"}),row("without_skill",[criterion("gain",false),criterion("regression",true)],{grading_status:"complete"})]);r.runs_per_query=1;
 await page.setContent(render(r));const json=await page.locator('#review-data').textContent();const model=JSON.parse(json!);assert.equal(model.comparison.criteria.gains,1);assert.equal(model.comparison.criteria.regressions,1);
 await page.getByRole('button',{name:'Regressions · 1',exact:true}).click();await page.locator('.criterion-choice').first().click();assert.match(await page.locator('#inspector').innerText(),/regression/);assert.match(await page.locator('#inspector').innerText(),/Evidence quote/);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

test("named review titles do not hide a disputed criterion absent from graded rows",()=>{
 const r:any=report();r.review_findings=[{title:"test17",criterion:"UNIQUE_DISPUTED_CRITERION",rationale:"OTHER_AUDIT_QUOTE"}];const html=render(r);assert.match(html,/UNIQUE_DISPUTED_CRITERION/);
});
test("activation projection reconciles failed, missing and duplicate raw slots",()=>{
 for(const raw of [[{case_id:0,repeat:1,arm:"with_targets",status:"failure"}],[],[{case_id:0,repeat:1,arm:"with_targets",status:"succeeded"},{case_id:0,repeat:1,arm:"with_targets",status:"succeeded"}]]){
 const r:any={...report(),mode:"activation",runs:raw,activation_results:[{case_id:0,query:"Observe load",arm:"with_targets",repetition:1,expected_skills:[],requested_skills:[],target_requested_skills:[],execution_status:"succeeded",pass:true}]};const html=render(r);assert.ok(!html.includes('class="badge pass"'));assert.match(html,/1<\/strong><span>Unavailable/);
 }
});
