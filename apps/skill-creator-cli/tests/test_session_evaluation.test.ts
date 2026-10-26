import {test} from "node:test";
import {chromium} from "playwright-core";
import {systemChromiumExecutable} from "./browser-fixture.ts";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join} from "node:path";
import {spawnSync} from "node:child_process";
const cli=resolve("dist/scripts/cli.js");
function fixture(){const root=mkdtempSync(join(tmpdir(),"session-eval-")),skill=join(root,"demo");mkdirSync(join(skill,"evals"),{recursive:true});writeFileSync(join(skill,"SKILL.md"),"---\nname: demo\ndescription: Demo review.\n---\nReview.\n");writeFileSync(join(skill,"eval.json"),JSON.stringify([{query:"Review <script>alert(1)</script>",should_trigger:true}]));writeFileSync(join(skill,"evals/evals.json"),JSON.stringify({skill_name:"demo",evals:[{id:0,prompt:"Review record",expected_output:"HIDDEN_ANSWER",expectations:["Reports the record"]}]}));return{root,skill};}
test("OP-6 browser renders both modes without script injection or receipt claims",async()=>{const f=fixture(),browser=await chromium.launch({headless:true,executablePath:systemChromiumExecutable()});try{for(const args of [[],["--mode","behavioral"]]){const r=call(f.skill,args);assert.equal(r.status,0);const page=await browser.newPage();const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await page.goto("file://"+r.value.review);assert.match(await page.getByRole("heading",{level:1}).innerText(),/evaluation/);assert.match(await page.getByRole("status").innerText(),/awaiting/);assert.match(await page.locator("main").innerText(),/No authenticated execution receipt/);assert.equal(await page.locator("script").count(),0);assert.deepEqual(errors,[]);await page.screenshot({path:join(f.root,args.length?"behavioral.png":"activation.png"),fullPage:true});await page.close();}}finally{await browser.close();rmSync(f.root,{recursive:true,force:true});}});
test("HR-1/2 reports present scenario decisions and advice before technical JSON",async()=>{
 const {sessionEvaluationHtml}=await import("../dist/scripts/evaluation_report.js");
 const activation=sessionEvaluationHtml("Activation","inconclusive",{skill_name:"demo",results:[{query:"Review record",should_trigger:true,pass:false,trigger_rate:0,runs:3,triggers:0,outcomes:[]},{query:"Unknown telemetry",should_trigger:false,pass:null,trigger_rate:null,runs:0,triggers:0,outcomes:[]} ]});
 assert.match(activation,/<table/);assert.match(activation,/Next actions/);assert.match(activation,/Fail/);assert.match(activation,/Unavailable/);assert.ok(activation.indexOf("Scenarios")<activation.indexOf("Technical data"));
 const behavioral=sessionEvaluationHtml("Behavioral","awaiting-grading",{metadata:{skill_name:"demo"},runs:[{eval_id:1,eval_name:"record",configuration:"with_skill",run_number:1,expectations:[{text:"Reports record",passed:false,evidence:"actual quote"},{text:"Preserves work",passed:null,rationale:"No state evidence"}],result:{passed:0,failed:1,total:2,tokens:null,time_seconds:null}}],pending:[],pending_grading:[{status:"inconclusive"}],missing_timing:["timing.json"]});
 for(const expected of ["Next actions","Reports record","actual quote","No state evidence","Inconclusive","Unavailable","Technical data"])assert.ok(behavioral.includes(expected),expected);
 assert.match(behavioral,/<details/);assert.ok(!behavioral.includes("<script"));
});
test("HR-5 comparison pairs scenarios, exposes missing variants and links advice",async()=>{
 const {sessionEvaluationHtml}=await import("../dist/scripts/evaluation_report.js");
 const run=(configuration:string,passed:boolean|null,text="Preserves work")=>({eval_id:7,eval_name:"Resume safely",configuration,run_number:1,expectations:[{text,passed,evidence:"Observed artifact",rationale:"Workspace state is incomplete"}],result:{tokens:null,time_seconds:null}});
 const html=sessionEvaluationHtml("Behavioral","awaiting-grading",{runs:[run("with_skill",false),run("old_skill",true)],pending:[],missing_timing:[]});
 for(const text of ["Current Skill","Previous Skill","Current fails / reference passes","Preserves work","Priority findings"])assert.ok(html.includes(text),text);
 assert.match(html,/href="#evidence-0"/);
 const missing=sessionEvaluationHtml("Behavioral","awaiting-execution",{runs:[run("with_skill",true)],pending:[{eval_id:7,configuration:"without_skill",run_number:1}]});
 assert.ok(missing.includes("Comparison incomplete"));assert.ok(missing.includes("Pending"));
 const mismatch=sessionEvaluationHtml("Behavioral","complete",{runs:[run("with_skill",true),run("old_skill",true,"Different criterion")]});
 assert.ok(mismatch.includes("Criteria differ"));
});
test("HR-6 value analysis keeps gains, regressions and partial pairs distinct",async()=>{
 const {analyzePairedValue}=await import("../dist/scripts/evaluation_report.js");
 const run=(configuration:string,values:Array<boolean|null>,seconds:number|null=10)=>({eval_id:1,run_number:1,configuration,expectations:values.map((passed,i)=>({text:"Criterion "+i,passed})),result:{time_seconds:seconds,tokens:100}});
 const mixed=analyzePairedValue([run("with_skill",[true,false,true,false]),run("without_skill",[false,true,true,false],20)],[]);
 assert.deepEqual(mixed.criteria,{gains:1,regressions:1,both_pass:1,both_fail:1,undecidable:0});
 assert.equal(mixed.metrics.quality.mean_delta,0);assert.equal(mixed.metrics.seconds.mean_delta,-10);assert.equal(mixed.complete_pairs,1);
 const partial=analyzePairedValue([run("with_skill",[true,null]),run("without_skill",[false,true],null)],[]);
 assert.equal(partial.criteria.gains,1);assert.equal(partial.criteria.undecidable,1);assert.equal(partial.complete_pairs,0);assert.equal(partial.metrics.quality.mean_delta,null);assert.equal(partial.metrics.seconds.mean_delta,null);
 const missing=analyzePairedValue([run("with_skill",[true])],[{eval_id:2,run_number:1,configuration:"with_skill"}]);assert.equal(missing.incomplete_pairs,2);assert.equal(missing.metrics.quality.mean_delta,null);
});
test("HR-7 future runs show quality value independently of optional efficiency telemetry",async()=>{
 const {sessionEvaluationHtml}=await import("../dist/scripts/evaluation_report.js");
 const run=(configuration:string,passed:boolean)=>({eval_id:1,run_number:1,configuration,expectations:[{text:"Correct result",passed,evidence:"Observed result"}],result:{time_seconds:null,tokens:null}});
 const html=sessionEvaluationHtml("Behavioral","awaiting-telemetry",{runs:[run("with_skill",true),run("without_skill",false)],pending:[],missing_timing:["a/timing.json","b/timing.json"]});
 assert.ok(html.includes("Value observed on the compared criteria"));
 assert.ok(html.includes("Efficiency telemetry (optional for quality)"));
 assert.ok(html.includes("Quality comparison ready"));
 assert.ok(!html.includes("Timing or token telemetry is unavailable for"));
 const f=fixture();try{
  const first=call(f.skill,["--mode","behavioral"]);
  for(const task of first.value.pending){writeFileSync(join(task.output_directory,"report.txt"),"Reports the record");writeFileSync(join(task.run_directory,"timing.json"),JSON.stringify({total_duration_seconds:task.configuration==="with_skill"?2:4,total_tokens:task.configuration==="with_skill"?0:20}));}
  const prepared=call(f.skill,["--mode","behavioral","--output",first.value.output,"--resume"]);
  const answers=prepared.value.grading_requests.map((p:any)=>{const req=JSON.parse(readFileSync(p.request_path,"utf8"));return{request_id:req.request_id,judgments:req.expectations.map((text:string)=>({text,verdict:"pass",evidence_quote:"Reports the record",rationale:"The output contains the requested record."}))};});
  const path=join(f.root,"new-judgments.json");writeFileSync(path,JSON.stringify(answers));
  const done=call(f.skill,["--mode","behavioral","--output",first.value.output,"--resume","--grading-results",path]);
  assert.equal(done.status,0,done.stdout);assert.equal(done.value.status,"complete");
  const benchmark=JSON.parse(readFileSync(done.value.benchmark,"utf8"));
  assert.equal(benchmark.run_summary.with_skill.tokens.mean,0);assert.equal(benchmark.run_summary.delta.time_seconds,"-2.0");assert.equal(benchmark.run_summary.delta.tokens,"-20");
 }finally{rmSync(f.root,{recursive:true,force:true})}
});
function call(skill:string,args:string[]=[]){const r=spawnSync(process.execPath,[cli,"run-evaluation","--skill-path",skill,...args,"--format","json"],{encoding:"utf8",env:{...process.env,SKILL_CREATOR_GOOSE_COMMAND:"/nonexistent"}});return{...r,value:JSON.parse(r.stdout).output};}
test("OP-4 activation generates safe HTML while observations unavailable",()=>{const f=fixture();try{const r=call(f.skill);assert.equal(r.status,0);assert.ok(existsSync(r.value.review));const html=readFileSync(r.value.review,"utf8");assert.ok(html.includes("No authenticated execution receipt"));assert.ok(!html.includes("<script>alert(1)</script>"));assert.ok(html.includes("awaiting-observations"));}finally{rmSync(f.root,{recursive:true,force:true});}});
test("OP-2/3 blind requests and import produce quality report without tokens",()=>{const f=fixture();try{const first=call(f.skill,["--mode","behavioral"]);assert.equal(first.status,0);for(const task of first.value.pending)writeFileSync(join(task.output_directory,"report.txt"),"Reports the record");const prepared=call(f.skill,["--mode","behavioral","--output",first.value.output,"--resume"]);assert.equal(prepared.status,0);assert.equal(prepared.value.grading_requests.length,2);const answers=prepared.value.grading_requests.map((p:any)=>{const request=JSON.parse(readFileSync(p.request_path,"utf8"));assert.ok(!JSON.stringify(request).includes("with_skill"));assert.ok(!JSON.stringify(request).includes("without_skill"));assert.ok(!JSON.stringify(request).includes("HIDDEN_ANSWER"));assert.ok(!JSON.stringify(request).includes(f.root));return{request_id:request.request_id,judgments:request.expectations.map((text:string)=>({text,verdict:"pass",evidence_quote:"Reports the record",rationale:"The displayed output states the record."}))};});const path=join(f.root,"judgments.json");writeFileSync(path,JSON.stringify(answers));const done=call(f.skill,["--mode","behavioral","--output",first.value.output,"--resume","--grading-results",path]);assert.equal(done.status,0,done.stdout+done.stderr);assert.equal(done.value.status,"awaiting-telemetry");assert.ok(existsSync(done.value.review));assert.equal(existsSync(join(first.value.output,"benchmark.json")),false);assert.equal(JSON.parse(readFileSync(done.value.local_benchmark,"utf8")).run_summary.with_skill.tokens.mean,null);const replay=call(f.skill,["--mode","behavioral","--output",first.value.output,"--resume","--grading-results",path]);assert.equal(replay.status,2);}finally{rmSync(f.root,{recursive:true,force:true});}});
