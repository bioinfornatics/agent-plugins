/** Render retained, untrusted evidence only. Never execute a scenario or rewrite its evidence. */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { renderIsolatedEvaluationReport } from "./evaluation_report.js";
import { validateReviewAnalysis } from "./session_review_analysis.js";
export const RENDER_REPORT_USAGE = "Usage: skill-creator render-report --report <report.json> --output <NEW HTML> [--review-findings <JSON>] [--analysis <JSON>] [--include-responses]\nRender retained isolated evidence only; no scenario rerun, grading import or acceptance. Existing parent required. Linux descriptor-anchored paths; symlinks and overwrites rejected.";
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const object = (v: unknown): Record<string, any> => { if (!v || typeof v !== "object" || Array.isArray(v)) throw Error("Expected JSON object"); return v as Record<string, any>; };
function bounded(value: unknown, stringLimit: number, depth = 0, budget = { nodes: 0 }): void {
 if (++budget.nodes > 100000 || depth > 24) throw Error("JSON structure exceeds limits");
 if (typeof value === "string" && value.length > stringLimit) throw Error("JSON string exceeds limit");
 if (Array.isArray(value)) { if (value.length > 10000) throw Error("JSON array exceeds limit"); for (const v of value) bounded(v,stringLimit,depth+1,budget); }
 else if (value && typeof value === "object") { const entries=Object.entries(value); if(entries.length>1000)throw Error("JSON object exceeds limit"); for(const [key,v] of entries){ if(key.length>256)throw Error("JSON key exceeds limit"); bounded(v,stringLimit,depth+1,budget); } }
}
/** Linux dirfd anchoring closes ancestor-swap races, not just final-component symlinks.
 * Node has no portable openat API: fail closed on platforms without this binding. */
function parentHandle(filename: string): { fd: number; leaf: string; anchored: string } {
 if (process.platform !== "linux") throw Error("Safe descriptor-anchored rendering currently requires Linux");
 if (!filename || filename.includes("\0") || filename.split(/[\/\\]/).includes("..")) throw Error("Unsafe path");
 const full=path.resolve(filename),parts=full.split(path.sep).filter(Boolean),leaf=parts.pop();
 if(!leaf)throw Error("A regular file path is required");
 let fd=fs.openSync("/",fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 try { for(const part of parts){const next=fs.openSync('/proc/self/fd/'+fd+'/'+part,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);fs.closeSync(fd);fd=next;} return {fd,leaf,anchored:'/proc/self/fd/'+fd+'/'+leaf}; }
 catch(error){fs.closeSync(fd);throw error;}
}
function readInput(filename: string, limit: number): Buffer {
 const parent=parentHandle(filename);let fd: number | undefined;
 try { fd=fs.openSync(parent.anchored,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 const before=fs.fstatSync(fd);if(!before.isFile()||before.size>limit)throw Error("Input must be a bounded regular file");
 const bytes=Buffer.alloc(limit+1);let n=0;while(n<bytes.length){const count=fs.readSync(fd,bytes,n,bytes.length-n,null);if(!count)break;n+=count;}
 const after=fs.fstatSync(fd);if(n>limit||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw Error("Input changed or exceeds limit");return bytes.subarray(0,n);
 } finally {if(fd!==undefined)fs.closeSync(fd);fs.closeSync(parent.fd);}
}
function parse(bytes: Buffer, stringLimit: number): unknown {const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);const value:unknown=JSON.parse(text);bounded(value,stringLimit);return value;}
/** Validate the bounded adapter schema, not receipt authenticity or the declared summary. */
function validateReport(value: unknown): Record<string,any> {
 const r=object(value);
 if(r.schema_version!=="isolated-evaluation-v1")throw Error("Unsupported report schema");
 if(!["behavioral","activation"].includes(r.mode))throw Error("Unsupported report mode");
 for(const key of ["runs","cases"])if(!Array.isArray(r[key])||r[key].length>2000)throw Error("Invalid report "+key);
 if(r.runs_per_query!==undefined&&(!Number.isInteger(r.runs_per_query)||r.runs_per_query<1||r.runs_per_query>100||r.cases.length*r.runs_per_query*2>2000))throw Error("Invalid or excessive repetitions");
 const id=(v:unknown)=>typeof v==='string'||typeof v==='number'&&Number.isFinite(v);
 for(const c of r.cases){const v=object(c);if(!id(v.id))throw Error("Invalid case identity");}
 for(const run of r.runs){const v=object(run);if(!id(v.case_id)||!Number.isInteger(v.repeat)||v.repeat<1||!['baseline','with_targets'].includes(v.arm))throw Error("Invalid retained run slot");}
 if(r.mode==='behavioral'){
  if(!Array.isArray(r.rows)||r.rows.length>2000)throw Error("Invalid report rows");
  for(const row of r.rows){const v=object(row);if(!id(v.eval_id)||!Number.isInteger(v.run_number)||v.run_number<1||!Array.isArray(v.expectations)||v.expectations.length>200)throw Error("Invalid behavioral row");for(const c of v.expectations){const e=object(c);if(typeof e.text!=='string'||!['boolean','undefined'].includes(typeof e.passed)&&e.passed!==null)throw Error("Invalid criterion grade");}}
 }else {
  if(!Array.isArray(r.activation_results)||r.activation_results.length>2000)throw Error("Invalid activation results");
  for(const result of r.activation_results){const v=object(result);if(typeof v.query!=='string'||!['baseline','with_targets'].includes(v.arm)||!Number.isInteger(v.repetition)||v.repetition<1||v.pass!==undefined&&v.pass!==null&&typeof v.pass!=='boolean')throw Error('Invalid activation observation');for(const key of ['expected_skills','requested_skills','target_requested_skills'])if(v[key]!==undefined&&v[key]!==null&&(!Array.isArray(v[key])||v[key].some((n:unknown)=>typeof n!=='string')))throw Error('Invalid activation identities');}
 }
 for(const key of ['missing_runs','campaigns'])if(r[key]!==undefined&&(!Array.isArray(r[key])||r[key].length>2000))throw Error("Invalid "+key);
 return r;
}
const reviewKeys=['title','criterion','criterion_text','disputed_criterion','verdict','status','eval_id','case_id','run_number','repeat','configuration','arm','evidence','evidence_quote','rationale','reason','message','original_grade','independent_audit','case'] as const;
function reviewEntry(value:unknown):Record<string,unknown>{const source=object(value),entry:Record<string,unknown>={};for(const key of reviewKeys){let v=source[key];if(v!==undefined){if(['independent_audit','original_grade'].includes(key)&&v&&typeof v==='object'&&!Array.isArray(v)){const audit=object(v);v=['verdict','status','passed','evidence_quote','evidence','rationale','reason'].filter(k=>['string','boolean'].includes(typeof audit[k])||audit[k]===null).map(k=>k+': '+String(audit[k])).join(' · ');if(!v)throw Error('Invalid independent audit');}if(!['string','number','boolean'].includes(typeof v)&&v!==null)throw Error('Invalid review field '+key);entry[key]=v;}}
 if(!Object.keys(entry).length)throw Error('Empty review entry');
 entry.criterion=entry.disputed_criterion??entry.criterion??entry.criterion_text;
 if(typeof source.case==='string'&&entry.title===undefined)entry.title='Supplied dispute: '+source.case;
 entry.grade_modified=false;
 // Existing renderer fields remain useful until the dedicated context projection is upgraded.
 if(entry.independent_audit!==undefined)entry.rationale=[entry.rationale, 'Supplied independent audit: '+entry.independent_audit, 'Original grade: '+String(entry.original_grade??'Unavailable')+'; grade_modified: false'].filter(Boolean).join(' · ');
 return entry;
}
export function normalizeReviewFindings(value:unknown):Record<string,unknown>[] {
 bounded(value,65536);if(Array.isArray(value)){if(value.length>30)throw Error('At most 30 review findings');return value.map(reviewEntry);}
 const campaign=object(value);if(campaign.grade_disagreement===undefined)throw Error('Campaign review requires grade_disagreement');
 const disagreement=campaign.grade_disagreement;let entries:Record<string,unknown>[];
 if(Array.isArray(disagreement))entries=disagreement.map(reviewEntry);
 else {const d=object(disagreement);entries=reviewKeys.some(k=>k in d)?[reviewEntry(d)]:Object.entries(d).map(([name,entry])=>({...reviewEntry(entry),title:name}));}
 if(campaign.limits!==undefined){const limits=typeof campaign.limits==='string'?[campaign.limits]:campaign.limits;if(!Array.isArray(limits)||limits.length>20||limits.some(v=>typeof v!=='string'))throw Error('Invalid review limits');for(const limit of limits)entries.push({title:'Supplied campaign limit',rationale:limit,grade_modified:false});}
 if(entries.length>30)throw Error('At most 30 review findings');return entries;
}
function createHtml(filename:string,html:string):void {
 const parent=parentHandle(filename);let fd:number|undefined,owned:fs.Stats|undefined;
 try {fd=fs.openSync(parent.anchored,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);owned=fs.fstatSync(fd);fs.writeFileSync(fd,html,'utf8');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.fsyncSync(parent.fd);}
 catch(error){if(fd!==undefined){try{fs.closeSync(fd);}catch{}}if(owned){try{const current=fs.lstatSync(parent.anchored);if(current.dev===owned.dev&&current.ino===owned.ino&&!current.isSymbolicLink())fs.unlinkSync(parent.anchored);}catch{}}throw error;}
 finally{fs.closeSync(parent.fd);}
}
/** Consent-only final-output projection; never diagnostics or provider/artifact fields. */
export function projectResponsePreviews(report:any):any[] {
 const rows=Array.isArray(report.rows)?report.rows:[],runs=Array.isArray(report.runs)?report.runs:[],out:any[]=[];let budget=512*1024;
 for(const row of rows){
  const peers=rows.filter((r:any)=>r.eval_id===row.eval_id&&r.run_number===row.run_number&&r.configuration===row.configuration);
  const arm=row.configuration==='with_skill'?'with_targets':['without_skill','old_skill'].includes(row.configuration)?'baseline':undefined;
  if(peers.length!==1||!arm)continue;
  const matched=runs.filter((r:any)=>r.case_id===row.eval_id&&r.repeat===row.run_number&&r.arm===arm);
  if(matched.length!==1||typeof matched[0].output!=='string')continue;
  const full=matched[0].output,response=full.slice(0,Math.min(32768,budget));budget-=response.length;
  out.push({eval_id:row.eval_id,run_number:row.run_number,configuration:row.configuration,response,response_truncated:response.length<full.length});
 }
 return out;
}
export async function runRenderReportCli(args:string[]):Promise<number>{
 if(args.length===1&&['--help','-h'].includes(args[0])){console.log(RENDER_REPORT_USAGE);return 0;}
 const values:Record<string,string>={};
 try {for(let i=0;i<args.length;){const key=args[i++];if(key in values)throw Error('Duplicate render-report argument');if(key==='--include-responses'){values[key]='true';continue;}const value=args[i++];if(!['--report','--output','--review-findings','--analysis'].includes(key)||!value||value.startsWith('-'))throw Error('Invalid render-report arguments');values[key]=value;}if(!values['--report']||!values['--output'])throw Error('Missing --report or --output');}
 catch{console.error(RENDER_REPORT_USAGE);return 2;}
 try {
 const bytes=readInput(values['--report'],16*1024*1024),report=validateReport(parse(bytes,1024*1024));
 const reviewBytes=values['--review-findings']?readInput(values['--review-findings'],1024*1024):undefined;
 const findings=reviewBytes?normalizeReviewFindings(parse(reviewBytes,65536)):report.review_findings===undefined?[]:normalizeReviewFindings(report.review_findings);
 const analysisBytes=values['--analysis']?readInput(values['--analysis'],1024*1024):undefined;
 const analysis=analysisBytes?validateReviewAnalysis(parse(analysisBytes,65536),report,hash(bytes)):[];
 const previews=values['--include-responses']?projectResponsePreviews(report):[];
 const toolBytes=readInput(fileURLToPath(import.meta.url),1024*1024);
 const rendererBytes=readInput(fileURLToPath(new URL(import.meta.url.endsWith('.ts')?'./evaluation_report.ts':'./evaluation_report.js',import.meta.url)),1024*1024);
 const moduleDigests=Object.fromEntries(['session_review_model','session_review_ui','session_review_analysis'].map(name=>[name,hash(readInput(fileURLToPath(new URL('./'+name+(import.meta.url.endsWith('.ts')?'.ts':'.js'),import.meta.url)),1024*1024))]));
 const provenance={source_sha256:hash(bytes),rendered_at:new Date().toISOString(),tool_version:'render-report-v2',tool_sha256:hash(toolBytes),renderer_sha256:hash(rendererBytes),review_findings_sha256:reviewBytes?hash(reviewBytes):null,analysis_sha256:analysisBytes?hash(analysisBytes):null,model_sha256:moduleDigests.session_review_model,ui_sha256:moduleDigests.session_review_ui,analysis_module_sha256:moduleDigests.session_review_analysis,evidence_authentication:'not verified; untrusted retained report',grade_modified:false};
 const projection={...report,review_findings:findings,review_analysis:undefined,validated_review_analysis:analysis,validated_response_previews:previews,include_responses:!!values['--include-responses'],report_provenance:provenance};
 const html=renderIsolatedEvaluationReport(projection);createHtml(values['--output'],html);console.log(JSON.stringify({status:'rendered',output:path.resolve(values['--output']),report_provenance:provenance}));return 0;
 }catch{console.error('Render unavailable: invalid input, unsafe path, output conflict or I/O failure; no evaluation was executed.');return 1;}
}
