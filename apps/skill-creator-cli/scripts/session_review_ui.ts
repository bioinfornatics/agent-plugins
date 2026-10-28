/** Offline, read-only projection of supplied behavioral review data. No grading or I/O. */
import { createHash } from "node:crypto";

function criteriaConclusion(comparison:any,findings:any[]){const c=comparison.criteria??{};return findings.some(f=>f.criterion)?'Observed results are provisional: review the supplied grading dispute.':c.regressions?'Regressions observed: inspect affected criteria before adoption.':comparison.incomplete_pairs?'Gains may be observed, but unresolved comparisons remain.':c.gains?'Gains observed on these criteria; not a release approval.':'No added quality observed on these trials; inspect shared gaps.';}
const htmlText = (value: unknown): string => String(value ?? "Unavailable").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const display = (value: unknown): string => value === undefined || value === null || value === "" ? "Unavailable" : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
const list = (value: any): any[] => Array.isArray(value) ? value : [];
const findingKeys = ["title", "criterion", "eval_id", "run_number", "configuration", "evidence", "rationale", "status"];
const cleanFinding = (value: any): Record<string, unknown> => Object.fromEntries(findingKeys.filter(key => value && value[key] !== undefined).map(key => [key, value[key]]));

// This executable is constant: supplied fields never become source, markup, URLs or CSS.
const interactionScript = String.raw`(() => {
'use strict';
const model = JSON.parse(document.getElementById('review-data').textContent);
const items = Array.isArray(model.items) ? model.items : [];
const labels = {gain:'Gain',regression:'Regression',both_pass:'Both pass',both_fail:'Shared gap',undecidable:'Undecidable',unavailable:'Missing',noncomparable:'Noncomparable',review_only:'Unlinked review'};
const filters = ['All','Needs review','Regressions','Undecidable','Shared gaps','Gains','Both pass','Disputes','Missing','Noncomparable'];
const $ = id => document.getElementById(id);
const text = value => value === undefined || value === null || value === '' ? 'Unavailable' : typeof value === 'object' ? JSON.stringify(value,null,2) : String(value);
const node = (tag,value,className) => { const n=document.createElement(tag); if(value!==undefined)n.textContent=text(value); if(className)n.className=className; return n; };
const append = (parent,tag,value,className) => { const n=node(tag,value,className); parent.append(n); return n; };
const allFindings = Array.isArray(model.review_findings) ? model.review_findings : [];
const findingsFor = item => Array.isArray(item.review_findings) ? item.review_findings : [];
const matches = (item,filter) => {
 switch(filter){
 case 'Needs review':return ['regression','both_fail','undecidable','unavailable','noncomparable'].includes(item.outcome) || findingsFor(item).length>0;
 case 'Regressions':return item.outcome==='regression';
 case 'Undecidable':return item.outcome==='undecidable';
 case 'Shared gaps':return item.outcome==='both_fail';
 case 'Gains':return item.outcome==='gain';case 'Both pass':return item.outcome==='both_pass';
 case 'Disputes':return findingsFor(item).length>0;
 case 'Missing':return item.outcome==='unavailable';case 'Noncomparable':return item.outcome==='noncomparable';
 default:return true;
 }
};
const draftNotes=new Map();
let activeFilter=items.some(i=>matches(i,'Needs review'))?'Needs review':'All', selected=null, visible=[];
const filterButtons=[];
filters.forEach(filter=>{
 const count=items.filter(i=>matches(i,filter)).length;
 const b=node('button',filter+' · '+count); b.type='button';b.setAttribute('aria-pressed',String(filter===activeFilter));
 b.addEventListener('click',()=>{activeFilter=filter; refresh();}); $('filters').append(b);filterButtons.push([filter,b]);
});
const fields = (parent,values) => {
 const dl=node('dl'); for(const [label,value] of values){append(dl,'dt',label);append(dl,'dd',text(value));} parent.append(dl);
};
const disclosure = (parent,label,build) => {
 const d=node('details');append(d,'summary',label);const content=node('div',undefined,'detail-body');d.append(content);
 d.addEventListener('toggle',()=>{if(d.open && !content.hasChildNodes())build(content);});parent.append(d);return d;
};
const longText = (parent,label,value,limit=260) => {
 append(parent,'h4',label);
 const full=text(value); append(parent,'p',full.length>limit ? full.slice(0,limit)+'…' : full,'quote');
 if(full.length>limit)disclosure(parent,'Full '+label.toLowerCase(),p=>append(p,'pre',full));
};
const renderSide = (parent,title,side) => {
 const section=node('section',undefined,'arm');append(section,'h4',title);parent.append(section);
 if(!side){append(section,'p','Unavailable — no retained side');return;}
 append(section,'p',text(side.configuration)+' · '+text(side.verdict),'verdict');if(side.status_reason)append(section,'p',side.status_reason,'muted');
 longText(section,'Evidence quote',side.evidence,220);
 disclosure(section,'Grading rationale',p=>append(p,'pre',text(side.rationale)));
 disclosure(section,'Retained response'+(side.response_truncated?' (truncated)':''),p=>{
  append(p,'p',side.response_truncated?'Source marks this response as truncated; omitted text is not available.':'Retained text only; no response is generated.');append(p,'pre',text(side.response));
 });
 disclosure(section,'Prompt, metadata and telemetry',p=>{
  fields(p,[['Execution status',side.execution_status],['Grading status',side.grading_status],['Time (seconds)',side.time_seconds],['Tokens',side.tokens]]);
  append(p,'h4','Retained prompt');append(p,'pre',text(side.prompt));
 });
};
function inspect(focus=false){
 const root=$('inspector');root.replaceChildren();const item=items.find(i=>String(i.id)===selected);
 if(!item || !visible.includes(item)){
  append(root,'h3','Criterion inspector');append(root,'p',visible.length?'Select a criterion to inspect retained evidence. Start with regressions, disputes or indeterminate criteria.':'No criteria match these filters.');$('previous').disabled=true;$('next').disabled=true;$('position').textContent='0 of '+visible.length;return;
 }
 const index=visible.indexOf(item);$('previous').disabled=index===0;$('next').disabled=index===visible.length-1;$('position').textContent=(index+1)+' of '+visible.length+' criteria';
 const heading=append(root,'h3',item.criterion);heading.tabIndex=-1;
 append(root,'p',(labels[item.outcome]||'Unavailable')+' · Evaluation '+text(item.eval_id)+' · Run '+text(item.run_number),'muted');
 const expected=append(root,'section');append(expected,'h4','Expected');append(expected,'p',item.criterion);
 disclosure(expected,'Scenario',p=>append(p,'pre',text(item.scenario)));
 append(root,'h4','Observed — Criterion side-by-side');
 const sides=append(root,'div',undefined,'sides');renderSide(sides,'A · Current',item.current);renderSide(sides,'B · Reference',item.reference);
 const why=append(root,'section');append(why,'h4','Why');
 append(why,'p',item.reason && item.reason.summary ? item.reason.summary : 'No reason supplied.');
append(why,'p',item.reason && item.reason.next_action ? item.reason.next_action : 'Inspect the available evidence.','muted');
 disclosure(why,'Reason details',p=>fields(p,[['Category',item.reason && item.reason.category],['Next action',item.reason && item.reason.next_action],['Source',item.reason && item.reason.source]]));
 const analysis=item.analysis;
if(analysis){append(why,'p','Reviewer-supplied explanation: '+text(analysis.explanation),'quote');append(why,'p','This analysis is unconfirmed, not an established root cause.','muted');}
 const revision=append(root,'section');append(revision,'h4','Potential revision');
 append(revision,'p',analysis?'Supplied analysis · Unconfirmed; not a causal conclusion.':'No supplied revision hypothesis. An instruction cannot be identified from the score alone.');
 if(analysis)disclosure(revision,'Inspect supplied hypothesis and instruction',p=>{
  fields(p,[['Category (supplied)',analysis.category],['Explanation',analysis.explanation],['Missing evidence',analysis.missing_evidence],['Next action',analysis.next_action],['Hypothesis',analysis.hypothesis],['Proposed change',analysis.proposed_change],['Confidence',analysis.confidence],['Confirmation state','unconfirmed']]);
  if(analysis.instruction){append(p,'p','Supplied snapshot integrity checked; its identity as the evaluated instruction revision is not independently verified.','muted');fields(p,[['Instruction locator (text only)',analysis.instruction.locator],['Source SHA-256',analysis.instruction.source_sha256]]);append(p,'pre',text(analysis.instruction.excerpt));}
 });
 const findings=findingsFor(item);
 if(findings.length)disclosure(root,'Supplied review findings · '+findings.length,p=>findings.forEach(f=>{
  const s=append(p,'section');append(s,'h4',f.title||'Supplied finding');fields(s,Object.keys(f).map(k=>[k,f[k]]));
 }));
 disclosure(root,'Optional feedback (does not alter grades)',p=>{
  append(p,'p','Local draft only. Explicit JSON download; no save, grading import or network request.');
  const label=append(p,'label','Reviewer note');const input=node('textarea');input.id='feedback-note';input.rows=4;input.value=draftNotes.get(item.id)||'';input.addEventListener('input',()=>draftNotes.set(item.id,input.value));label.htmlFor=input.id;p.append(input);
  const b=append(p,'button','Download feedback JSON');b.type='button';b.addEventListener('click',()=>{
   const payload={schema_version:'guided-review-feedback-v1',item_id:item.id,eval_id:item.eval_id,run_number:item.run_number,criterion:item.criterion,note:input.value,grade_modified:false};
   const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const link=node('a');link.href=url;link.download='review-feedback.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);$('live-status').textContent='Feedback download requested. Supplied grades unchanged.';
  });
 });
 if(focus)heading.focus();
}
function select(item,focus=false,updateHash=true){
 selected=String(item.id);if(updateHash){try{history.replaceState(null,'','#'+encodeURIComponent(selected));}catch{ /* file hosts may disallow history changes */ }}
 renderList();inspect(focus);
}
function renderList(){
 const ul=$('criterion-list');ul.replaceChildren();
 visible.forEach(item=>{
  const li=node('li');const b=node('button');b.type='button';b.className='criterion-choice';
  b.setAttribute('aria-current',String(String(item.id)===selected));
  append(b,'span',labels[item.outcome]||'Unavailable','outcome');append(b,'span',item.criterion,'criterion-title');append(b,'span','Evaluation '+text(item.eval_id)+' · Run '+text(item.run_number),'muted');
  if(findingsFor(item).length)append(b,'span','Supplied dispute','muted');
  b.addEventListener('click',()=>select(item,true));li.append(b);ul.append(li);
 });
}
function refresh(){
 const query=$('search').value.trim().toLowerCase();
 visible=items.filter(item=>matches(item,activeFilter) && (!query || [item.id,item.eval_id,item.scenario,item.criterion,item.outcome,item.reason && item.reason.summary].map(text).join(' ').toLowerCase().includes(query)));
 filterButtons.forEach(([filter,b])=>b.setAttribute('aria-pressed',String(filter===activeFilter)));
 // Retain selection across filters; do not silently replace it with a different criterion.
 renderList();inspect();$('list-status').textContent=visible.length+' of '+items.length+' review items (criteria and supplied disputes) · '+activeFilter;
}
$('search').addEventListener('input',refresh);
document.querySelectorAll('[data-review-filter]').forEach(b=>b.addEventListener('click',()=>{activeFilter=b.dataset.reviewFilter;refresh();$('search').focus();}));
$('previous').addEventListener('click',()=>{const n=visible.findIndex(i=>String(i.id)===selected);if(n>0)select(visible[n-1],true);});
$('next').addEventListener('click',()=>{const n=visible.findIndex(i=>String(i.id)===selected);if(n>=0 && n+1<visible.length)select(visible[n+1],true);});
function fromHash(){let id;try{id=decodeURIComponent(location.hash.slice(1));}catch{return;}const item=items.find(i=>String(i.id)===id || (Array.isArray(i.anchors)&&i.anchors.includes(id)));if(item){activeFilter='All';$('search').value='';selected=String(item.id);refresh();}}
window.addEventListener('hashchange',fromHash);
selected=null;
refresh();fromHash();
document.documentElement.classList.add('interactive-ready');
})();`;

const styles = `.distribution{background:white;padding:14px 16px;border:1px solid #d2d9e3;border-radius:7px}.distribution-bar{display:flex;height:14px;overflow:hidden;border-radius:4px;background:#e8edf3}.metric-cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:10px}.metric-card{border-top:4px solid;display:flex;flex-direction:column;text-align:left;padding:8px}.metric-card strong{font-size:1.45rem}.metric-card small{color:#526071}.triage{max-height:550px}@media(max-width:600px){.metric-cards{grid-template-columns:repeat(3,minmax(0,1fr))}}

:root{font-family:system-ui,sans-serif;color:#172332;background:#f5f7fa;line-height:1.5;font-size:15px}*{box-sizing:border-box}body{margin:0}main{max-width:1240px;margin:auto;padding:22px}h1{font-size:1.7rem;margin:0 0 6px}h2{font-size:1.15rem;margin:0 0 10px}h3{font-size:1.15rem;margin:0 0 8px}h4{font-size:.95rem;margin:12px 0 5px}p{margin:5px 0 12px}button,input,textarea{font:inherit}button{cursor:pointer;background:white;border:1px solid #a4afbe;border-radius:5px;padding:7px 10px;color:inherit}button:disabled{cursor:default;opacity:.55}button[aria-pressed=true],button[aria-current=true]{border:2px solid #174f92;background:#eaf2ff}button:focus-visible,input:focus-visible,textarea:focus-visible,summary:focus-visible,a:focus-visible,[tabindex]:focus-visible{outline:3px solid #245fa8;outline-offset:3px}a{color:#174f92}header{margin-bottom:16px}.eyebrow{font-size:.82rem;font-weight:650;letter-spacing:.04em}.muted{color:#526071;font-size:.84rem}.overview{display:flex;flex-wrap:wrap;gap:10px 24px;padding:12px 16px;background:white;border:1px solid #d2d9e3;border-radius:7px;margin:12px 0}.overview span{display:block}.overview strong{font-size:1.05rem}.scope-note{font-size:.83rem}.panel{background:white;border:1px solid #d2d9e3;border-radius:7px;padding:16px;min-width:0}details{border-top:1px solid #dbe1e9;margin:9px 0;padding-top:9px}summary{cursor:pointer;font-weight:550;overflow-wrap:anywhere}.detail-body{padding:8px 0}.detail-body section+section{border-top:1px solid #dbe1e9;padding-top:8px}dl{display:grid;grid-template-columns:minmax(100px,1fr) minmax(0,3fr);gap:5px 12px;margin:8px 0}dt{font-weight:600;font-size:.85rem}dd{margin:0;white-space:pre-wrap}pre,.quote{white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;font-size:.88rem}pre{padding:10px;background:#f3f5f8;margin:8px 0}p,dd,h1,h3,h4,span{overflow-wrap:anywhere}.toolbar{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 14px}.workspace{display:grid;grid-template-columns:minmax(230px,1fr) minmax(0,2fr);gap:16px}.search-label{display:block;font-size:.85rem;font-weight:600}input,textarea{width:100%;min-width:0;padding:8px;border:1px solid #a4afbe;border-radius:4px}ul{list-style:none;margin:10px 0 0;padding:0}.criterion-choice{width:100%;text-align:left;margin-bottom:7px;display:flex;flex-direction:column;gap:3px;padding:10px}.criterion-title{font-weight:600;font-size:.9rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.outcome{font-size:.78rem;font-weight:700;text-transform:uppercase}.triage{max-height:660px;overflow:auto}.nav{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px}.nav span{margin-right:auto;font-size:.85rem}.sides{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.arm{padding:10px;background:#f7f9fb;border:1px solid #dbe1e9;border-radius:5px;min-width:0}.verdict{font-weight:600;font-size:.88rem}.interactive{display:none}.interactive-ready .interactive{display:block}.interactive-ready .fallback{display:none}.fallback article{border-top:1px solid #dbe1e9;padding:16px 0}.sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}footer{margin:18px 0;font-size:.82rem;color:#526071}@media(max-width:760px){main{padding:12px}.workspace{grid-template-columns:minmax(0,1fr)}.triage{max-height:260px}.sides{grid-template-columns:minmax(0,1fr)}dl{grid-template-columns:minmax(0,1fr)}dd{margin-bottom:6px}.overview{gap:8px 16px}.panel{padding:12px}}@media print{body{background:white}main{max-width:none;padding:0}.interactive-ready .interactive,.interactive{display:none!important}.interactive-ready .fallback,.fallback{display:block!important}.panel{border:0;padding:0}details>.detail-body{display:block}details{break-inside:avoid}summary{list-style:none}.fallback article{break-inside:avoid}button{display:none}}
`;

/** The coordinator validates the model; this renderer only displays supplied data. */
export function renderGuidedReviewHtml(model: any): string {
  const context = model.context ?? {};
  const comparison = model.comparison ?? {};
  const items = list(model.items).map(item => ({ ...item, review_findings: list(item.review_findings).map(cleanFinding) }));
  const findings = list(model.review_findings).map(cleanFinding);
  const projected = { ...model, items, review_findings: findings };
  const json = JSON.stringify(projected).replace(/[<>&\u2028\u2029]/g, c => ({ "<": "\\u003c", ">": "\\u003e", "&": "\\u0026", "\u2028": "\\u2028", "\u2029": "\\u2029" }[c]!));
  const scriptHash = createHash("sha256").update(interactionScript).digest("base64");
  const fields = (entries: [string, unknown][]): string => `<dl>${entries.map(([name, value]) => `<dt>${htmlText(name)}</dt><dd>${htmlText(display(value))}</dd>`).join("")}</dl>`;
  const retainedSide = (name: string, side: any): string => `<section class="arm"><h4>${name}</h4>${side ? fields([["Configuration", side.configuration], ["Verdict", side.verdict], ["Evidence quote", side.evidence], ["Grading rationale", side.rationale], ["Execution status", side.execution_status], ["Grading status", side.grading_status], ["Availability reason", side.status_reason], ["Time (seconds)", side.time_seconds], ["Tokens", side.tokens]]) : "<p>Unavailable — no retained side</p>"}</section>`;
  const targets = list(context.selected_targets);
  const c = comparison.criteria ?? {};
  const entries = [['Gains','gains','Gains','#17613a'],['Regressions','regressions','Regressions','#9d263d'],['Both pass','both_pass','Both pass','#688978'],['Shared gaps','both_fail','Shared gaps','#b56322'],['Undecidable','undecidable','Undecidable','#846022']] as const;
  const total=entries.reduce((sum,[,key])=>sum+(typeof c[key]==='number'?c[key]:0),0);
  const conclusion=criteriaConclusion(comparison,findings);
  const distribution='<section class="distribution" aria-label="Criterion distribution"><h2>Criterion distribution</h2><div class="distribution-bar" role="img" aria-label="'+htmlText(entries.map(([label,key])=>label+': '+display(c[key])).join('; '))+'">'+entries.map(([label,key,,color])=>'<span style="width:'+ (total?100*(c[key]??0)/total:0)+'%;background:'+color+'" title="'+htmlText(label+': '+display(c[key]))+'"></span>').join('')+'</div><div class="metric-cards">'+entries.map(([label,key,filter,color])=>'<button type="button" data-review-filter="'+filter+'" class="metric-card" style="border-top-color:'+color+'"><strong>'+htmlText(c[key]??'Unavailable')+'</strong><span>'+label+'</span><small>criteria</small></button>').join('')+'</div></section>';
  const coverage=comparison.coverage??{};
  const overview='<div class="overview"><div><strong>'+htmlText(coverage.total_groups??'Unavailable')+' pairs</strong><span class="muted">'+htmlText(comparison.complete_pairs??'Unavailable')+' fully graded pairs (conclusive) · '+htmlText(coverage.with_indeterminate_criteria??'Unavailable')+' with indeterminate criteria</span></div><div><strong>'+htmlText(coverage.missing_or_ungraded??'Unavailable')+' missing or ungraded</strong><span class="muted">'+htmlText(coverage.noncomparable??'Unavailable')+' noncomparable</span></div></div>';
  const scope=targets.length ? ((list(context.requested_plugins).length || list(context.requested_plugin_paths).length) ? 'Full plugin bundle · '+targets.length+' selected Skills' : targets.length===1?targets[0]:targets.length+' selected capabilities') : 'Selection unavailable';
  const contextDetails = fields([
    ["Selected targets", targets.length ? targets : "No selected capability"], ["Requested skills", context.requested_skills], ["Full plugins", context.requested_plugins], ["Full plugin source paths (text only)", context.requested_plugin_paths], ["Model", context.model], ["Provider", context.provider], ["Repeats", context.runs_per_query], ["Hypothesis", context.hypothesis], ["Execution completeness", context.execution_summary], ["Grading completeness", context.grading_summary], ["Reference baseline", comparison.baseline === "old_skill" ? "Previous version" : "No selected capability"]
  ]);
  const criteria = comparison.criteria ?? {};
  const comparisonDetails = '<p>'+htmlText(coverage.total_groups)+' total groups; '+htmlText(coverage.missing_or_ungraded)+' missing or ungraded. All conclusive criteria are counted; indeterminate pairs are not missing executions.</p>'+fields([
    ["Gains (criteria)", criteria.gains], ["Regressions (criteria)", criteria.regressions], ["Both pass (criteria)", criteria.both_pass], ["Both fail (criteria)", criteria.both_fail], ["Undecidable (criteria)", criteria.undecidable], ["Total groups", coverage.total_groups], ["Conclusive groups", coverage.conclusive], ["Groups with indeterminate criteria", coverage.with_indeterminate_criteria], ["Missing or ungraded groups", coverage.missing_or_ungraded], ["Noncomparable groups", coverage.noncomparable]
  ]) + ["quality", "seconds", "tokens"].map(key => `<h4>${key === "quality" ? "Quality (proportion; multiply by 100 for percentage points)" : key === "seconds" ? "Time (seconds)" : "Tokens"}</h4>${fields([["Paired observations", comparison.metrics?.[key]?.pairs], ["Mean delta (current − reference)", comparison.metrics?.[key]?.mean_delta], ["Standard deviation of delta", comparison.metrics?.[key]?.stddev]])}`).join("");
  const findingsHtml = findings.length ? findings.map(f => `<section><h4>${htmlText(f.title ?? "Supplied finding")}</h4>${fields(Object.entries(f))}</section>`).join("") : "<p>No supplied review findings.</p>";
  const fallback = items.map((item, index) => `<article id="${htmlText(item.id)}"><h3>${htmlText(item.criterion)}</h3><p>${htmlText(item.outcome)} · Evaluation ${htmlText(item.eval_id)} · Run ${htmlText(item.run_number)}</p><h4>Expected</h4><p>${htmlText(item.criterion)}</p><p>Scenario: ${htmlText(display(item.scenario))}</p><h4>Observed — Criterion side-by-side</h4><div class="sides">${retainedSide("A · Current", item.current)}${retainedSide("B · Reference", item.reference)}</div><h4>Why</h4><p>${htmlText(item.reason?.summary ?? "No reason supplied.")}</p>${fields([["Next action", item.reason?.next_action], ["Reason source", item.reason?.source]])}<h4>Potential revision</h4><p>Supplied hypotheses remain unconfirmed.</p>${item.analysis ? fields([["Explanation", item.analysis.explanation], ["Missing evidence", item.analysis.missing_evidence], ["Hypothesis", item.analysis.hypothesis], ["Proposed change", item.analysis.proposed_change], ["Instruction locator (text only)", item.analysis.instruction?.locator], ["Source SHA-256", item.analysis.instruction?.source_sha256], ["Instruction excerpt", item.analysis.instruction?.excerpt], ["Next action", item.analysis.next_action]]) : "<p>No supplied revision hypothesis.</p>"}${list(item.review_findings).map(f => `<h4>Supplied review finding</h4>${fields(Object.entries(f))}`).join("")}</article>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${scriptHash}'"><title>${htmlText(model.title ?? "Behavioral evaluation")}</title><style>${styles}</style></head>
<body><main><header><p class="eyebrow">Behavioral evaluation</p><h1>${htmlText(model.title ?? "Guided evidence review")}</h1><p class="muted">${htmlText(conclusion)}</p>${overview}${distribution}<p class="scope-note">${htmlText(scope)} · ${targets.length ? `${targets.length} selected targets` : "No selected capability"} · Model: ${htmlText(context.model ?? "Unavailable")} · Provider: ${htmlText(context.provider ?? "Unavailable")} · Repeats: ${htmlText(context.runs_per_query ?? "Unavailable")}</p><p class="scope-note">Descriptive A/B evidence, not a per-skill causal claim or release approval. Supplied findings do not alter grades.</p></header>
<div class="interactive"><h2>Triage criteria</h2><div id="filters" class="toolbar" role="group" aria-label="Criterion filters; counts are review items"></div><details><summary>Filter definitions</summary><div class="detail-body"><p>Needs review: regressions, shared failures, undecidable, missing, noncomparable, or supplied findings. Shared gaps: both fail. Disputes: matching supplied findings, not independently verified disagreements. Missing: unavailable comparisons. Undecidable and noncomparable remain distinct. Counts precede search; categories may overlap. Unlinked supplied disputes are review items, not scored criteria.</p></div></details><div class="workspace"><section class="panel" aria-label="Criterion comparison list"><label for="search" class="search-label">Search criteria, scenarios or evaluation IDs</label><input id="search" type="search" autocomplete="off"><p id="list-status" class="muted" role="status" aria-live="polite"></p><div class="triage"><ul id="criterion-list"></ul></div></section><section class="panel" aria-label="Selected criterion"><nav class="nav" aria-label="Filtered criterion navigation"><span id="position"></span><button id="previous" type="button">Previous</button><button id="next" type="button">Next</button></nav><div id="inspector"></div></section></div></div>
<details class="report-context"><summary>Context, scope, metrics and supplied reviews</summary><div class="detail-body"><details><summary>Evaluation context</summary><div class="detail-body">${contextDetails}</div></details>
<details><summary>Comparison coverage and paired metrics</summary><div class="detail-body"><p>Counts are supplied, not recomputed grades. Pair counts, run groups and criterion counts use different units. Deltas describe observations, not causes or release readiness.</p>${comparisonDetails}</div></details>
<details><summary>Supplied review findings · ${findings.length}</summary><div class="detail-body"><p>Reviewer-supplied claims; original grades remain unchanged.</p>${findingsHtml}</div></details>
<details><summary>Render provenance</summary><div class="detail-body"><pre>${htmlText(display(context.render_provenance))}</pre></div></details>
</div></details>
<section class="fallback"><h2>Criterion side-by-side</h2><noscript><p>JavaScript is disabled. Retained evidence summaries follow; use the links or print this report.</p></noscript><ul>${items.map((item,index) => `<li><a href="#${htmlText(item.id)}">${htmlText(item.criterion)} · ${htmlText(item.outcome)}</a></li>`).join("")}</ul>${fallback || "<p>No retained criteria.</p>"}</section>
<p id="live-status" class="sr-only" role="status" aria-live="polite"></p><footer>Offline evidence review. No evaluation, network access, automatic grading write or persistent storage. External instruction locators are text only.</footer></main><script id="review-data" type="application/json">${json}</script><script>${interactionScript}</script></body></html>`;
}
