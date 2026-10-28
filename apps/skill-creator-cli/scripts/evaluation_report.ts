import {buildSessionReviewModel} from "./session_review_model.js";
import {renderGuidedReviewHtml} from "./session_review_ui.js";
/** Decision-oriented static session reports. Data stays untrusted; no acceptance receipt is inferred. */
export interface BehavioralCriterion { text: string; passed: boolean | null; evidence?: string; rationale?: string }
export interface BehavioralRun {
 eval_id: string | number; eval_name?: string; configuration: string; run_number: number;
 expectations: BehavioralCriterion[]; grading_status?: string; execution_status?: string;
 result?: { time_seconds?: number | null; tokens?: number | null; pass_rate?: number | null };
}
/** Normalized session seam. Isolated raw runs are not these graded view rows. */
export interface BehavioralSessionData {
 runs: BehavioralRun[];
 pending?: Array<{eval_id: string | number; configuration: string; run_number: number}>;
 pending_grading?: unknown[];
 skill_name?: string;
 metadata?: Record<string, unknown>;
 review_findings?: unknown[];
 review_analysis?: unknown[];
 response_previews?: unknown[];
}
const escape=(v:unknown)=>String(v??"Unavailable").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const list=(v:unknown):any[]=>Array.isArray(v)?v:[];
const record=(v:unknown):Record<string,any>=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,any>:{};
const badge=(label:string)=>'<span class="badge '+(label==="Pass"?'pass':label==="Fail"?'fail':'unknown')+'">'+escape(label)+'</span>';
const metric=(v:unknown,percent=false)=>typeof v==="number"&&Number.isFinite(v)?(percent?(v*100).toFixed(1)+'%':String(v)):'Unavailable';
const verdict=(v:any)=>v.passed===true?'Pass':v.passed===false?'Fail':v.passed===null?'Inconclusive':'Unavailable';
const cell=(v:unknown)=>'<td>'+escape(v)+'</td>';
const table=(heads:string[],rows:string[],caption:string)=>'<div class="table-wrap"><table><caption>'+escape(caption)+'</caption><thead><tr>'+heads.map(h=>'<th scope="col">'+escape(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
function gradingIssue(row:any):string | null {
 if (!row || row.pending) return null;
 if (row.grading_status !== undefined && !['complete','inconclusive'].includes(row.grading_status))
  return row.grading_status === 'absent' ? 'Grading unavailable' : 'Unknown grading status: '+String(row.grading_status);
 if (row.execution_status !== undefined && row.execution_status !== 'succeeded') return 'Execution not succeeded';
 return null;
}
function runState(row:any):string {
 if(!row)return 'Unavailable';if(row.pending)return 'Pending';if(gradingIssue(row))return 'Unavailable';
 const criteria=list(row.expectations);return !criteria.length?'Unavailable':criteria.some(c=>c.passed===false)?'Fail':criteria.some(c=>c.passed===null)?'Inconclusive':criteria.every(c=>c.passed===true)?'Pass':'Unavailable';
}
/** Descriptive matched-pair analysis; not a statistical non-inferiority test. */
export function analyzePairedValue(rows:any[],pending:any[]){
 const baseline=rows.some(r=>r.configuration==='old_skill')||pending.some(r=>r.configuration==='old_skill')?'old_skill':'without_skill';
 const groups=new Map<string,any[]>();for(const r of [...rows,...pending.map(p=>({...p,pending:true}))]){const key=JSON.stringify([r.eval_id,r.run_number]);groups.set(key,[...(groups.get(key)??[]),r]);}
 const coverage={total_groups:groups.size,conclusive:0,with_indeterminate_criteria:0,missing_or_ungraded:0,noncomparable:0};
 const criteria={gains:0,regressions:0,both_pass:0,both_fail:0,undecidable:0};let complete_pairs=0,incomplete_pairs=0;
 const observations:{quality:number[];seconds:number[];tokens:number[]}={quality:[],seconds:[],tokens:[]};
 for(const group of groups.values()){
  const current=group.filter(r=>r.configuration==='with_skill'),reference=group.filter(r=>r.configuration===baseline),a=current[0],b=reference[0],ca=list(a?.expectations),cb=list(b?.expectations);
  if(current.length>1||reference.length>1){coverage.noncomparable++;incomplete_pairs++;continue;}
  if(current.length!==1||reference.length!==1||a.pending||b.pending||!ca.length||!cb.length||gradingIssue(a)||gradingIssue(b)){coverage.missing_or_ungraded++;incomplete_pairs++;continue;}
  if(JSON.stringify(ca.map(c=>c.text))!==JSON.stringify(cb.map(c=>c.text))){coverage.noncomparable++;incomplete_pairs++;continue;}
  let unresolved=0;for(let i=0;i<ca.length;i++){const x=ca[i].passed,y=cb[i].passed;if(typeof x!=='boolean'||typeof y!=='boolean'){criteria.undecidable++;unresolved++;}else if(x&&!y)criteria.gains++;else if(!x&&y)criteria.regressions++;else if(x)criteria.both_pass++;else criteria.both_fail++;}
  if(unresolved){coverage.with_indeterminate_criteria++;incomplete_pairs++;}else{coverage.conclusive++;complete_pairs++;observations.quality.push((ca.filter(c=>c.passed).length-cb.filter(c=>c.passed).length)/ca.length);}
  for(const [key,field]of [['seconds','time_seconds'],['tokens','tokens']] as const){const x=record(a.result)[field],y=record(b.result)[field];if(typeof x==='number'&&Number.isFinite(x)&&x>=0&&typeof y==='number'&&Number.isFinite(y)&&y>=0)observations[key].push(x-y);}
 }
 const statistics=(values:number[])=>{const n=values.length;if(!n)return{pairs:0,mean_delta:null,stddev:null};const mean=values.reduce((a,b)=>a+b,0)/n;return{pairs:n,mean_delta:mean,stddev:n>1?Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/(n-1)):0};};
 return{baseline,complete_pairs,incomplete_pairs,criteria,coverage,metrics:{quality:statistics(observations.quality),seconds:statistics(observations.seconds),tokens:statistics(observations.tokens)}};
}
export function sessionEvaluationHtml(mode:string,status:string,data:unknown){
 const d=record(data),behavioral=mode==="Behavioral",rows=list(behavioral?d.runs:d.results),pending=list(d.pending),name=d.skill_name??record(d.metadata).skill_name??mode;
 if(behavioral&&(!Array.isArray(d.runs)||d.runs.some((r:any)=>!r||typeof r!=='object'||!Array.isArray(r.expectations)||r.expectations.some((c:any)=>!c||typeof c.text!=='string'))))throw new Error('Malformed behavioral payload: runs with expectations are required');
 if(behavioral)return renderGuidedReviewHtml(buildSessionReviewModel({...d,status},analyzePairedValue(rows,pending)));
 const counts={passed:0,failed:0,inconclusive:0,unavailable:0};
 const paired:any=null;
 let scenarioRows:string[]=[],evidence:string[]=[];
 if(behavioral){
  for(const [index,row]of rows.entries()){
   const criteria=list(row.expectations);for(const c of criteria){const key=gradingIssue(row)?'Unavailable':verdict(c);if(key==='Pass')counts.passed++;else if(key==='Fail')counts.failed++;else if(key==='Inconclusive')counts.inconclusive++;else counts.unavailable++;}
   if(!criteria.length)counts.unavailable++;
   const state=runState(row);
   const r=record(row.result),id='evidence-'+index;
   scenarioRows.push('<tr>'+cell(row.eval_name??'Scenario '+row.eval_id)+cell(row.configuration)+cell(row.run_number)+'<td>'+badge(state)+'</td>'+cell(criteria.filter(c=>c.passed===true).length+' / '+criteria.length)+cell(metric(r.time_seconds))+cell(metric(r.tokens))+'<td><a href="#'+id+'">Inspect</a></td></tr>');
   evidence.push('<details id="'+id+'"><summary>'+escape(row.eval_name??'Scenario '+row.eval_id)+' · '+escape(row.configuration)+' · Run '+escape(row.run_number)+' — '+state+'</summary>'+'<p>Execution: '+escape(row.execution_status)+' · Grading: '+escape(row.grading_status)+'</p>'+ (gradingIssue(row)?'<p>'+escape(gradingIssue(row))+'</p>':'')+(criteria.length?criteria.map((c,i)=>'<article id="'+id+'-criterion-'+i+'" class="criterion">'+badge(gradingIssue(row)?'Unavailable':verdict(c))+' <strong>'+escape(c.text)+'</strong><p><strong>Evidence:</strong> '+escape(c.evidence)+'</p>'+(c.rationale?'<p><strong>Rationale:</strong> '+escape(c.rationale)+'</p>':'')+'</article>').join(''):'<p>No grading evidence available yet.</p>')+'</details>');
  }
  for(const p of pending)scenarioRows.push('<tr>'+cell('Scenario '+p.eval_id)+cell(p.configuration)+cell(p.run_number)+'<td>'+badge('Pending')+'</td><td colspan="4">Execute the pending task; no output is available yet.</td></tr>');
 }else{
  for(const [index,row]of rows.entries()){
   const state=row.execution_status!==undefined&&row.execution_status!=='succeeded'?'Unavailable':row.pass===true?'Pass':row.pass===false?'Fail':list(row.outcomes).length?'Inconclusive':'Unavailable';if(state==='Pass')counts.passed++;else if(state==='Fail')counts.failed++;else if(state==='Inconclusive')counts.inconclusive++;else counts.unavailable++;
   if(Array.isArray(row.expected_skills)){
    scenarioRows.push('<tr>'+cell(row.query+' · '+row.arm+' · Run '+row.repetition)+cell(row.role+'; expected: '+JSON.stringify(row.expected_skills))+cell(row.requested_skills===null?'Unavailable':JSON.stringify(row.requested_skills))+cell(row.target_requested_skills===null?'Unavailable':JSON.stringify(row.target_requested_skills))+'<td>'+badge(state)+'</td></tr>');
    evidence.push('<details><summary>Scenario '+(index+1)+' — exact load observations</summary><p>'+escape(row.evidence_scope)+'</p><pre>'+escape(JSON.stringify({expected:row.expected_skills,requested:row.requested_skills,selected:row.target_requested_skills},null,2))+'</pre></details>');
   }else{   scenarioRows.push('<tr>'+cell(row.query)+cell(row.should_trigger===true?'Load Skill':'Do not load')+cell(metric(row.trigger_rate,true))+cell((row.triggers??0)+' / '+(row.runs??0))+'<td>'+badge(state)+'</td></tr>');}
   if(list(row.outcomes).length)evidence.push('<details><summary>Scenario '+(index+1)+' — host observations</summary>'+list(row.outcomes).map(o=>'<p><strong>Run '+escape(o.repetition)+': '+escape(o.outcome)+'</strong><br>'+escape(record(o.evidence).source)+' · '+escape(record(o.evidence).reference)+'</p>').join('')+'</details>');
  }
 }
 const advice:string[]=[];
 if(pending.length)advice.push('Execute the '+pending.length+' pending task(s), preserving completed work.');
 if(status==='awaiting-observations'||status==='inconclusive'&&!behavioral)advice.push('Collect actual host load-tool observations. Missing telemetry is not a negative activation result.');
 if(behavioral&&(list(d.pending_grading).length||counts.unavailable))advice.push('Complete missing grading with the anonymous request packets; do not rerun completed candidates.');
 if(counts.inconclusive)advice.push('Resolve inconclusive criteria with the missing evidence or qualified review; do not convert uncertainty into failure or success.');
 if(counts.failed)advice.push('Inspect failed scenarios and quoted evidence below. Propose a targeted correction; change the Skill only when authorized.');
 // Efficiency availability is secondary; missing historical telemetry is not a repair task.
 if(!advice.length)advice.push('Review the scenario evidence and confirm it addresses your intended use. Completed results alone do not establish acceptance or reliable improvement.');
 const summary='<section aria-label="Summary"><h2>At a glance</h2><div class="cards">'+[['Pass',counts.passed],['Fail',counts.failed],['Inconclusive',counts.inconclusive],['Unavailable',counts.unavailable]].map(([label,n])=>'<div class="card"><strong>'+n+'</strong><span>'+label+'</span></div>').join('')+'</div><p>'+ (behavioral?'Counts are criterion judgments; ungraded output rows count as unavailable, not failed.':'Counts are scenario verdicts; incomplete observations remain unavailable or inconclusive.')+'</p></section>';
 const visibleRows=paired?.rows??scenarioRows;
 const scenarios=table(paired?.heads??(rows.some(r=>Array.isArray(r.expected_skills))?['Request / arm','Role / expected selected names','All requested names','Selected requested names','Outcome']:['Request','Expected selection','Observed activation','Triggers / classified runs','Outcome']),visibleRows.length?visibleRows:['<tr><td colspan="5">No scenario results available.</td></tr>'],'Scenarios — '+(behavioral?'paired descriptive outcomes, not a causal improvement verdict':'selection accuracy, not answer quality'));
 const priorities=paired?'<details class="priorities" open><summary>Priority findings — regressions, shared gaps and uncertainty</summary>'+paired.findings+'</details>':'';
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(name)+' — '+escape(mode)+' evaluation</title><style>body{font:16px/1.5 system-ui;margin:0;color:#172231;background:#f5f7fa}main{max-width:1200px;margin:auto;padding:24px}h1{margin-bottom:8px}h2{font-size:1.2rem}section,details{background:white;padding:20px;border:1px solid #dce2e8;border-radius:10px;margin:18px 0}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card{display:flex;flex-direction:column;padding:16px;background:#f1f5f9;border-radius:8px}.card strong{font-size:2rem}.badge{display:inline-block;font-weight:650;padding:3px 10px;border-radius:20px;white-space:nowrap}.pass{background:#dcefe3;color:#165c32}.fail{background:#fde3e3;color:#962323}.unknown{background:#fff0d0;color:#735000}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left}caption{text-align:left;margin-bottom:12px;font-weight:600}th,td{padding:12px;border-bottom:1px solid #dce2e8;vertical-align:top}th{background:#f1f5f9}td:first-child{min-width:180px}summary{cursor:pointer;font-weight:650}.criterion{padding:12px 0;border-bottom:1px solid #e4e9ee}pre{white-space:pre-wrap;overflow-wrap:anywhere}p,td{overflow-wrap:anywhere}a{color:#164a99}a:focus-visible,summary:focus-visible{outline:3px solid #164a99;outline-offset:4px}@media(max-width:600px){main{padding:12px}.cards{grid-template-columns:repeat(2,1fr)}section,details{padding:14px}}</style></head><body><main><header><h1>'+escape(mode)+' evaluation</h1><p>'+escape(name)+'</p><p role="status">'+escape(status)+'</p></header>'+contextHtml(d.metadata)+reviewHtml(d.review_findings)+summary+'<section><h2>Next actions</h2><ol>'+advice.map(a=>'<li>'+escape(a)+'</li>').join('')+'</ol>'+priorities+'</section><section><h2>Scenarios</h2>'+scenarios+'</section>'+(paired?'<section><h2>Criterion side-by-side</h2>'+paired.criteria+'</section>':'')+'<section><h2>Evidence</h2>'+evidence.join('')+'</section><section aria-label="Evidence limits"><h2>Evidence limits</h2><p>No authenticated execution receipt. Report completeness is not acceptance, provider proof or independent grading proof.</p><p>Unavailable observations and telemetry remain unavailable, never inferred. Comparisons are descriptive; shared context can prevent causal uplift claims.</p></section></main></body></html>';
}

/** Only supplied review metadata is shown; this is not an adjudication or grade mutation. */
function reviewHtml(value:unknown):string {
 const findings=list(value);if(!findings.length)return '';
 const shown=findings.slice(0,30).map(f=>{const r=record(f);return '<article><h3>'+escape(r.title??r.criterion??r.criterion_text??'Supplied dispute')+'</h3><p><strong>Disputed criterion:</strong> '+escape(r.criterion??r.criterion_text)+'</p><p>Verdict: '+escape(r.verdict??r.status)+'</p><p>Scenario: '+escape(r.eval_id??r.case_id)+' · Run: '+escape(r.run_number??r.repeat)+' · Arm: '+escape(r.configuration??r.arm)+'</p><p>Evidence quote: '+escape(r.evidence??r.evidence_quote)+'</p><p>Rationale: '+escape(r.rationale??r.reason??r.message)+'</p></article>';});
 return '<section><h2>Supplied review findings</h2><p>These supplied disputes do not alter grades. Review their evidence before any authorized adjudication.</p>'+shown.join('')+(findings.length>30?'<p>Additional supplied findings omitted from this compact view.</p>':'')+'</section>';
}
function contextHtml(value:unknown):string {
 const m=record(value);if(!Object.keys(m).length)return '';
 const names=(v:unknown)=>list(v).filter(x=>typeof x==='string').map(escape).join(', ')||'Unavailable';
 return '<section><h2>Evaluation context</h2><p>Selected targets: '+names(m.selected_targets)+'</p><p>Isolated skills: '+names(m.requested_skills)+'</p><p>Full plugins: '+names(m.requested_plugins)+'</p><p>Full plugin source paths: '+names(m.requested_plugin_paths)+'</p><p>Repeats: '+escape(m.runs_per_query)+' · Model: '+escape(m.model)+' · Provider: '+escape(m.provider)+'</p><p>Baseline: No selected capability — not necessarily no Skill. Built-in or shared capabilities may remain.</p><p>Full plugin comparisons cover the selected bundle, including its available components; this is not a per-skill causal claim or release acceptance.</p><h3>Execution completeness</h3><p>'+escape(m.execution_summary)+'</p><h3>Grading completeness</h3><p>'+escape(m.grading_summary)+'</p><h3>Render provenance</h3><p>'+escape(m.render_provenance||'Not supplied for this projection')+'</p><h3>Hypotheses and context limitations</h3><p>'+(m.hypothesis?escape(m.hypothesis):'No explicit hypothesis supplied; observed differences do not establish a mechanism.')+'</p><p>Only supplied context and local observations are represented. Shared task context, limited repeats and unobserved model/provider settings limit generalization; unavailable values are not inferred.</p></section>';
}
/** Pure adapter from a retained isolated report to a whitelisted static view. No files or outputs are read. */
export function renderIsolatedEvaluationReport(report:unknown):string {
 const r=record(report);
 if(r.schema_version!=='isolated-evaluation-v1')throw new Error('Invalid isolated report schema: expected isolated-evaluation-v1');
 if(!['behavioral','activation'].includes(r.mode))throw new Error('Invalid isolated report mode');
 if(!Array.isArray(r.runs)||!Array.isArray(r.cases))throw new Error('Invalid isolated report: runs and cases arrays required');
 const rawRuns=list(r.runs),missing=list(r.missing_runs);
 const statusCounts=new Map<string,number>();for(const run of rawRuns){const status=typeof run?.status==='string'?run.status:'unavailable';statusCounts.set(status,(statusCounts.get(status)??0)+1);}
 const expected=Number.isInteger(r.runs_per_query)&&r.runs_per_query>0?r.cases.length*r.runs_per_query*2:null;
 const plannedKeys=new Set<string>();
 if(Number.isInteger(r.runs_per_query)&&r.runs_per_query>0&&r.runs_per_query<=100)for(const c of r.cases)for(let repeat=1;repeat<=r.runs_per_query;repeat++)for(const arm of ['baseline','with_targets'])plannedKeys.add(JSON.stringify([c?.id,repeat,arm]));
 const observedKeys=new Set(rawRuns.map(run=>JSON.stringify([run?.case_id,run?.repeat,run?.arm])));
 const computedMissing=expected===null?null:[...plannedKeys].filter(key=>!observedKeys.has(key)).length;
 const executionSummary=rawRuns.length+' retained runs'+(expected===null?' (expected count unavailable)':' / '+expected+' expected slots')+'; '+[...statusCounts].map(([s,n])=>n+' '+s).join(', ')+'; '+(computedMissing===null?missing.length:Math.max(missing.length,computedMissing))+' missing slots. Campaigns: '+list(r.campaigns).length+' retained / '+r.cases.length+' cases; '+list(r.campaigns).filter(c=>c?.status==='failure').length+' failed. Execution failure marker: '+(r.execution_failure?'present':'not supplied')+'.';
 const metadata:Record<string,unknown>={};
 for(const key of ['selected_targets','requested_skills','requested_plugins','requested_plugin_paths','runs_per_query','model','provider','hypothesis'])metadata[key]=r[key];
 metadata.execution_summary=executionSummary;
 const provenance=record(r.report_provenance);metadata.render_provenance=['source_sha256','rendered_at','tool_version','tool_sha256','renderer_sha256','review_findings_sha256','analysis_sha256','model_sha256','ui_sha256','analysis_module_sha256','evidence_authentication'].filter(key=>typeof provenance[key]==='string').map(key=>key+': '+provenance[key]).join(' · ');
 const projectedFindings=list(r.review_findings).map(f=>{const source=record(f),view:Record<string,unknown>={};for(const key of ['title','criterion','criterion_text','verdict','status','eval_id','case_id','run_number','repeat','configuration','arm','evidence','evidence_quote','rationale','reason','message'])if(typeof source[key]==='string'||typeof source[key]==='number')view[key]=source[key];return view;});
 if(r.mode==='activation'){
  if(!Array.isArray(r.activation_results))throw new Error('Invalid activation report: activation_results array required');
  const results=r.activation_results.map((v:any)=>{const source=record(v),view:Record<string,unknown>={};for(const key of ['case_id','query','arm','repetition','role','pass','evidence_scope','execution_status'])if(['string','number','boolean'].includes(typeof source[key])||source[key]===null)view[key]=source[key];for(const key of ['expected_skills','requested_skills','target_requested_skills'])view[key]=Array.isArray(source[key])?source[key].filter((n:unknown)=>typeof n==='string'):null;return view;});
  for(const view of results){
   const matches=rawRuns.filter(run=>run?.case_id===view.case_id&&run?.repeat===view.repetition&&run?.arm===view.arm);
   view.execution_status=matches.length===1?matches[0].status:matches.length?'duplicate raw execution slot':'raw execution slot unavailable';
   if(view.execution_status!=='succeeded')view.pass=null;
  }
  metadata.grading_summary='Behavioral grades not applicable. '+results.filter((v:any)=>typeof v.pass==='boolean').length+' classified activation observations / '+results.length+' retained observations; missing observations are unavailable.';
  return sessionEvaluationHtml('Activation',typeof r.status==='string'?r.status:'Unavailable',{results,pending:[],metadata,review_findings:projectedFindings});
 }
 const {runs:rows,pending}=isolatedBehavioralData(r);
 if(r.include_responses===true)for(const row of rows){const matches=list(r.cases).filter(c=>c.id===row.eval_id);if(matches.length===1&&typeof matches[0].prompt==='string')(row as any).prompt=matches[0].prompt.slice(0,32768);}
 metadata.grading_summary=rows.filter(row=>!gradingIssue(row)&&row.grading_status==='complete'&&row.expectations.length>0&&row.expectations.every(c=>typeof c.passed==='boolean')).length+' fully graded rows / '+rows.length+' retained grading rows; '+rows.filter(row=>row.grading_status==='inconclusive').length+' marked inconclusive; '+rows.filter(row=>Boolean(gradingIssue(row))||!row.expectations.length).length+' missing, ungraded or unavailable. Declared report status does not replace raw completeness.';
 const data:BehavioralSessionData={runs:rows,pending,metadata,review_findings:projectedFindings,review_analysis:Array.isArray(r.validated_review_analysis)?r.validated_review_analysis:[],response_previews:Array.isArray(r.validated_response_previews)?r.validated_response_previews:[]};
 return sessionEvaluationHtml('Behavioral',typeof r.status==='string'?r.status:'Unavailable',data);
}

/** One normalization seam for machine comparison and HTML, including missing slots. */
export function isolatedBehavioralData(report:unknown):BehavioralSessionData {
 const r=record(report),rawRuns=list(r.runs),missing=list(r.missing_runs);
 if(!Array.isArray(r.rows))throw new Error('Invalid behavioral isolated report: rows array required');
 const rows:BehavioralRun[]=r.rows.map((v:any)=>{
  const source=record(v);
  if(!Array.isArray(source.expectations)||!['with_skill','without_skill','old_skill'].includes(source.configuration)||!['string','number'].includes(typeof source.eval_id)||!Number.isInteger(source.run_number))throw new Error('Malformed behavioral report rows');
  return {eval_id:source.eval_id,eval_name:typeof source.eval_name==='string'?source.eval_name:undefined,configuration:source.configuration,run_number:source.run_number,execution_status:typeof source.execution_status==='string'?source.execution_status:'unavailable',grading_status:typeof source.grading_status==='string'?source.grading_status:'unavailable',expectations:source.expectations.map((c:any)=>{const e=record(c);if(typeof e.text!=='string')throw new Error('Malformed behavioral criterion');return {text:e.text,passed:typeof e.passed==='boolean'?e.passed:null,evidence:typeof e.evidence==='string'?e.evidence:undefined,rationale:typeof e.rationale==='string'?e.rationale:undefined};}),result:{time_seconds:record(source.result).time_seconds,tokens:record(source.result).tokens}};
 });
 // Retained execution without a projected grading row is visible, never an empty comparison.
 for(const run of rawRuns){
  const configuration=run?.arm==='baseline'?'without_skill':run?.arm==='with_targets'?'with_skill':null;
  if(configuration&&!rows.some(row=>row.eval_id===run.case_id&&row.run_number===run.repeat&&row.configuration===configuration))rows.push({eval_id:run.case_id,run_number:run.repeat,configuration,expectations:[],grading_status:'absent',execution_status:typeof run.status==='string'?run.status:'unavailable'});
 }
 const missingSlots=missing.filter(p=>p&&['baseline','with_targets'].includes(p.arm));
 if(Number.isInteger(r.runs_per_query)&&r.runs_per_query>0&&r.runs_per_query<=100)for(const c of r.cases)for(let repeat=1;repeat<=r.runs_per_query;repeat++)for(const arm of ['baseline','with_targets']){
  if(!rawRuns.some(run=>run?.case_id===c?.id&&run?.repeat===repeat&&run?.arm===arm)&&!missingSlots.some(p=>p.case_id===c?.id&&p.repeat===repeat&&p.arm===arm))missingSlots.push({case_id:c?.id,repeat,arm});
 }
 const pending=missingSlots.map(p=>({eval_id:p.case_id,configuration:p.arm==='baseline'?'without_skill':'with_skill',run_number:p.repeat}));
 // Raw execution status takes precedence where a retained slot can be matched.
 for(const row of rows){const matches=rawRuns.filter(run=>run?.case_id===row.eval_id&&run?.repeat===row.run_number&&run?.arm===(row.configuration==='without_skill'?'baseline':'with_targets'));if(matches.length===1)row.execution_status=typeof matches[0].status==='string'?matches[0].status:'unavailable';else row.execution_status=matches.length?'duplicate raw execution slot':'raw execution slot unavailable';}
 return {runs:rows,pending};
}
export function analyzeIsolatedEvaluationReport(report:unknown){const data=isolatedBehavioralData(report);return analyzePairedValue(data.runs,data.pending??[]);}
