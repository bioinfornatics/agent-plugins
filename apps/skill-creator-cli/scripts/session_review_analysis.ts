/** Pure validation of supplied hypotheses, never root-cause or grading authority. */
import { createHash } from 'node:crypto';
const fail = (): never => { throw Error('Invalid review analysis'); };
const object = (v: any): any => v && typeof v === 'object' && !Array.isArray(v) ? v : fail();
const text = (v: any): string => typeof v === 'string' && v.trim() && v.length <= 65536 ? v : fail();
const sha = (v: string): string => createHash('sha256').update(v, 'utf8').digest('hex');
function bound(v: any, depth = 0, budget = {nodes: 0}): void {
 if (++budget.nodes > 100000 || depth > 24) fail();
 if (typeof v === 'string' && v.length > 65536) fail();
 if (v && typeof v === 'object') { const values = Object.entries(v); if (values.length > 10000) fail(); for (const [key, value] of values) {if(key.length>256)fail();bound(value,depth+1,budget);} }
}
/** ATX/setext headings outside fenced code. Sections include nested headings. */
function sections(source: string): {anchor: string; start: number; end: number}[] {
 const lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [], headings: {anchor:string;start:number;level:number}[] = [];
 const used = new Set<string>(); let offset = 0, fence: string | undefined, fenceLength = 0;
 for (let i = 0; i < lines.length; i++) {
  const line = lines[i].replace(/\r?\n$/, ''), marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  if (fence) {if(marker && marker[1][0]===fence && marker[1].length>=fenceLength && /^ {0,3}(?:`+|~+)\s*$/.test(line))fence=undefined;offset+=lines[i].length;continue;}
  if (marker) {fence=marker[1][0];fenceLength=marker[1].length;offset+=lines[i].length;continue;}
  const atx = /^ {0,3}(#{1,6})(?:\s+|$)(.*)$/.exec(line);
  const setext = !atx && line.trim() && i+1<lines.length ? /^ {0,3}(=+|-+)\s*$/.exec(lines[i+1].replace(/\r?\n$/, '')) : null;
  if (atx || setext) {
   const title = atx ? atx[2].replace(/\s+#+\s*$/, '') : line.trim();
   const base = title.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
   let anchor=base, n=0;while(used.has(anchor))anchor=base+'-'+(++n);used.add(anchor);
   headings.push({anchor,start:offset,level:atx?atx[1].length:setext![1][0]==='='?1:2});
   if(setext){offset+=lines[i].length;i++;}
  }
  offset+=lines[i].length;
 }
 return headings.map((h,i)=>({...h,end:headings.slice(i+1).find(next=>next.level<=h.level)?.start??source.length}));
}
function snapshot(value: any): any {
 const v=object(value), locator=text(v.locator), content=text(v.source_content), excerpt=text(v.excerpt), digest=text(v.source_sha256);
 const match=/^skills\/([a-zA-Z0-9_-]+)\/(SKILL\.md|references\/[a-zA-Z0-9_./-]+\.md)#([\p{L}\p{N}_-]+)$/u.exec(locator);
 if(!match || locator.split(/[\/#]/).some(p=>p==='.'||p==='..'||!p) || !/^[a-f0-9]{64}$/.test(digest) || sha(content)!==digest)fail();
 const section=sections(content).find(s=>s.anchor===match![3]);
 if(!section || !content.slice(section.start,section.end).includes(excerpt))fail();
 return {locator,source_sha256:digest,excerpt};
}
export function validateReviewAnalysis(input: unknown, report: any, sourceSha256: string): any[] {
 bound(input); const root=object(input);
 if(root.schema_version!=='evaluation-review-analysis-v1'||! /^[a-f0-9]{64}$/.test(sourceSha256)||root.report_sha256!==sourceSha256||!Array.isArray(root.items)||root.items.length>10000)fail();
 if(Buffer.byteLength(JSON.stringify(input),'utf8')>1024*1024)fail();
 const rows=Array.isArray(report?.rows)?report.rows:[], seen=new Set<string>();
 return root.items.map((value:any)=>{
  const v=object(value), criterion=text(v.criterion);
  if(!((typeof v.eval_id==='string' && v.eval_id.length>0)||typeof v.eval_id==='number'&&Number.isFinite(v.eval_id))||!Number.isInteger(v.run_number)||v.run_number<1)fail();
  if(v.configuration!==undefined&&!['with_skill','without_skill','old_skill'].includes(v.configuration))fail();
  const matches=rows.filter((r:any)=>r?.eval_id===v.eval_id&&r?.run_number===v.run_number&&(v.configuration===undefined||r.configuration===v.configuration)&&Array.isArray(r.expectations)&&r.expectations.some((e:any)=>e?.text===criterion));
  if(!matches.length)fail();
  const configs=new Set<string>();
  for(const row of matches){if(!['with_skill','without_skill','old_skill'].includes(row.configuration)||configs.has(row.configuration)||row.expectations.filter((e:any)=>e?.text===criterion).length!==1)fail();configs.add(row.configuration);}
  if(v.configuration!==undefined&&matches.length!==1)fail();
  for(const config of configs){const key=JSON.stringify([v.eval_id,v.run_number,criterion,config]);if(seen.has(key))fail();seen.add(key);}
  if(!['evidence_gap','criterion_ambiguity','grader_disagreement','capture_gap','instruction_hypothesis','not_diagnosed'].includes(v.category)||!['low','medium','high'].includes(v.confidence))fail();
  const out:any={eval_id:v.eval_id,run_number:v.run_number,criterion,category:v.category,explanation:text(v.explanation),next_action:text(v.next_action),confidence:v.confidence,confirmation_state:'unconfirmed'};
  if(v.configuration!==undefined)out.configuration=v.configuration;
  for(const key of ['hypothesis','proposed_change'])if(v[key]!==undefined)out[key]=text(v[key]);
  if(v.missing_evidence!==undefined){if(!Array.isArray(v.missing_evidence)||v.missing_evidence.length>1000)fail();out.missing_evidence=v.missing_evidence.map(text);}
  if(v.instruction!==undefined)out.instruction=snapshot(v.instruction);
  if(v.category==='instruction_hypothesis'&&!out.instruction)fail();
  return out;
 });
}
