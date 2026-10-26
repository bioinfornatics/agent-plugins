/** Anthropic-compatible behavioral artifact adapter. Candidate/grader calls belong to the current session. */
import {existsSync,mkdirSync,readdirSync,lstatSync,rmSync} from "node:fs";
import {join,resolve,dirname,relative,isAbsolute} from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {read,regularPath} from "./run_evaluation.js";
import {parseSkillMd} from "./utils.js";
import {durableAtomicWrite,acquireDirectoryLockSync} from "./durable_file.js";
import {calculateStats} from "./aggregate_benchmark.js";
import {sessionEvaluationHtml} from "./evaluation_report.js";
import {prepareSessionGrading,applySessionGrades} from "./evaluation_grading.js";

interface Scenario{id:number;name:string;prompt:string;expected_output:string;files:string[];expectations:string[]}
interface State{schema_version:"anthropic-behavioral-v1";run_id:string;skill_path:string;baseline_skill:string|null;eval_set:string;bindings:Record<string,string>;cases:Scenario[];runs_per_query:number;iteration:number}
const digest=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
const obj=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const json=(path:string):unknown=>JSON.parse(read(path).toString("utf8"));
const save=(path:string,value:unknown)=>{regularPath(path);durableAtomicWrite(path,JSON.stringify(value,null,2)+"\n");};
function filePath(root:string,file:string):string{if(isAbsolute(file)||file.includes("\\")||file.split("/").some(p=>!p||p==="."||p===".."))throw new Error("Fixture must be Skill-relative: "+file);const path=resolve(root,file);if(relative(root,path).startsWith(".."))throw new Error("Unsafe fixture path");regularPath(path);return path;}
function scenarios(value:unknown,name:string):Scenario[]{
 if(!obj(value)||value.skill_name!==name||!Array.isArray(value.evals)||!value.evals.length||value.evals.length>1000)throw new Error("Expected Anthropic {skill_name, evals:[{id,prompt,expected_output,files,expectations}]} matching SKILL.md name");
 const seen=new Set<number>();return value.evals.map(v=>{
  if(!obj(v)||!Number.isSafeInteger(v.id)||Number(v.id)<0||seen.has(Number(v.id))||typeof v.prompt!=="string"||!v.prompt.trim()||typeof v.expected_output!=="string"||!v.expected_output.trim())throw new Error("Each behavioral case requires unique nonnegative integer id, prompt and expected_output");seen.add(Number(v.id));
  const expectations=v.expectations??v.assertions??[],files=v.files??[];
  if(!Array.isArray(expectations)||expectations.some(x=>typeof x!=="string"||!x.trim())||new Set(expectations).size!==expectations.length||!Array.isArray(files)||files.some(x=>typeof x!=="string"))throw new Error("Expected distinct string expectations and Skill-relative files");
  if(v.expectations!==undefined&&v.assertions!==undefined&&JSON.stringify(v.expectations)!==JSON.stringify(v.assertions))throw new Error("Conflicting expectations/assertions aliases");
  return{id:Number(v.id),name:typeof v.name==="string"&&v.name.trim()?v.name:"eval-"+v.id,prompt:v.prompt,expected_output:v.expected_output,files:files as string[],expectations:expectations as string[]};
 });
}
function outputFiles(root:string):string[]{regularPath(root,true);if(!existsSync(root))return[];const entries=readdirSync(root,{withFileTypes:true});if(entries.length>256)throw new Error("Outputs exceed 256 files");let bytes=0;return entries.filter(e=>{const path=join(root,e.name);regularPath(path);const stat=lstatSync(path);if(!stat.isFile())throw new Error("Anthropic viewer requires flat regular output files");bytes+=stat.size;if(bytes>16*1024*1024)throw new Error("Outputs exceed 16 MiB");return !["transcript.md","user_notes.md","metrics.json"].includes(e.name);}).map(e=>e.name);}
function grading(value:unknown,s:Scenario){
 if(!obj(value)||!Array.isArray(value.expectations)||!obj(value.summary))throw new Error("grading.json requires expectations and summary");
 if(!s.expectations.length)throw new Error("No frozen expectations: start a new run with verifiable expectations before grading");
 if(value.expectations.length!==s.expectations.length)throw new Error("grading expectations must match frozen case");
 const judged=value.expectations.map((v,i)=>{if(!obj(v)||v.text!==s.expectations[i]||typeof v.passed!=="boolean"||typeof v.evidence!=="string"||!v.evidence.trim()||v.verdict!==undefined&&v.verdict!==(v.passed?"pass":"fail"))throw new Error("grading expectations require exact text, boolean passed and nonempty evidence; inconclusive cannot be exported as boolean");return{text:v.text,passed:v.passed,evidence:v.evidence};});
 const passed=judged.filter(v=>v.passed).length,summary={passed,failed:judged.length-passed,total:judged.length,pass_rate:passed/judged.length};
 for(const [k,v]of Object.entries(summary))if(value.summary[k]!==v)throw new Error("grading summary disagrees with expectations: "+k);
 if(value.summary.inconclusive||value.summary.unavailable)throw new Error("Incomplete grading cannot be an Anthropic boolean export");
 return{expectations:judged,summary};
}
function timing(value:unknown){if(!obj(value)||typeof value.total_duration_seconds!=="number"||!Number.isFinite(value.total_duration_seconds)||value.total_duration_seconds<0||!Number.isSafeInteger(value.total_tokens)||Number(value.total_tokens)<0)throw new Error("timing.json requires observed nonnegative total_duration_seconds and integer total_tokens; do not estimate missing telemetry");return{total_duration_seconds:value.total_duration_seconds,total_tokens:Number(value.total_tokens)};}
function stats(values:number[]){const s=calculateStats(values);return{mean:s.mean,stddev:values.length===1?0:s.stddev,min:s.min,max:s.max};}
export async function runBehavioralEvaluation(options:{gradingResults?:string;skillPath:string;evalSet?:string;output?:string;resume?:boolean;baselineSkill?:string;iteration?:number;runsPerQuery?:number}){
 const skill=resolve(options.skillPath),metadata=parseSkillMd(skill),evalSet=resolve(options.evalSet??join(skill,"evals/evals.json")),evalBytes=read(evalSet),cases=scenarios(JSON.parse(evalBytes.toString("utf8")),metadata.name),baseline=options.baselineSkill?resolve(options.baselineSkill):null;
 if(!/^[a-z0-9][a-z0-9-]*$/.test(metadata.name))throw new Error("Skill name must be a portable lowercase directory component");
 const iteration=options.iteration??1,runs=options.runsPerQuery??1;if(!Number.isSafeInteger(iteration)||iteration<1||!Number.isSafeInteger(runs)||runs<1||runs>100||cases.length*runs*2>2048)throw new Error("Invalid iteration/repetition count (at most 2048 paired run directories)");
 const output=resolve(options.output??join(dirname(skill),metadata.name+"-workspace","iteration-"+iteration));regularPath(output,true);
 if(options.resume&&!options.output)throw new Error("--resume requires --output <iteration-directory>");
 if(!options.resume&&existsSync(output))throw new Error("Output already exists; use --resume or a new iteration");
 if(options.resume&&!existsSync(output))throw new Error("Iteration directory does not exist");
 let state:State;
 if(options.resume){const value=json(join(output,"run.json"));if(!obj(value)||value.schema_version!=="anthropic-behavioral-v1")throw new Error("Invalid behavioral run.json");state=value as unknown as State;if(!Number.isSafeInteger(state.runs_per_query)||state.runs_per_query<1||state.runs_per_query>100||cases.length*state.runs_per_query*2>2048||!obj(state.bindings)||state.baseline_skill!==null&&typeof state.baseline_skill!=="string")throw new Error("Invalid behavioral state settings");if(state.skill_path!==skill||state.eval_set!==evalSet||options.baselineSkill!==undefined&&state.baseline_skill!==baseline||options.iteration!==undefined&&state.iteration!==iteration||options.runsPerQuery!==undefined&&state.runs_per_query!==runs||JSON.stringify(state.cases)!==JSON.stringify(cases))throw new Error("Behavioral inputs/settings drift");}
 else{state={schema_version:"anthropic-behavioral-v1",run_id:randomUUID(),skill_path:skill,baseline_skill:baseline,eval_set:evalSet,bindings:{},cases,runs_per_query:runs,iteration};}
 const bindings:Record<string,string>={[join(skill,"SKILL.md")]:digest(read(join(skill,"SKILL.md"))),[evalSet]:digest(evalBytes)};
 if(state.baseline_skill)bindings[join(state.baseline_skill,"SKILL.md")]=digest(read(join(state.baseline_skill,"SKILL.md")));
 for(const s of cases)for(const file of s.files){const path=filePath(skill,file);bindings[path]=digest(read(path));}
 if(options.resume&&JSON.stringify(state.bindings)!==JSON.stringify(bindings))throw new Error("Behavioral source/fixture drift; start a new iteration");state.bindings=bindings;
 if(!options.resume){mkdirSync(dirname(output),{recursive:true});mkdirSync(output,{mode:0o700});}
 regularPath(join(output,".lock"),true);
 const release=acquireDirectoryLockSync(join(output,".lock"));
 try{
  if(options.gradingResults&&!options.resume)throw new Error("grading-results requires resume");
  const packets:ReturnType<typeof prepareSessionGrading>[]=[];
  if(options.resume)for(const scenario of cases)for(const config of ["with_skill",state.baseline_skill?"old_skill":"without_skill"])for(let n=1;n<=state.runs_per_query;n++){const dir=join(output,"eval-"+scenario.id,config,"run-"+n),files=outputFiles(join(dir,"outputs"));if(files.length&&!existsSync(join(dir,"grading.json")))packets.push(prepareSessionGrading(output,dir,files,scenario.expectations));}
  if(options.gradingResults)applySessionGrades(resolve(options.gradingResults),packets);
  const configurations=["with_skill",state.baseline_skill?"old_skill":"without_skill"],pending:unknown[]=[],pendingGrading:unknown[]=[],missingTiming:string[]=[],rows:any[]=[];
  for(const s of cases){const evalDir=join(output,"eval-"+s.id),coordinator={eval_id:s.id,eval_name:s.name,prompt:s.prompt,assertions:s.expectations};
   if(!options.resume){mkdirSync(evalDir);save(join(evalDir,"eval_metadata.json"),coordinator);}
   else if(JSON.stringify(json(join(evalDir,"eval_metadata.json")))!==JSON.stringify(coordinator))throw new Error("Evaluation metadata drift");
   for(const configuration of configurations)for(let run_number=1;run_number<=state.runs_per_query;run_number++){
    const runDir=join(evalDir,configuration,"run-"+run_number),outputs=join(runDir,"outputs"),publicMetadata={eval_id:s.id,eval_name:s.name,prompt:s.prompt};
    if(!options.resume){mkdirSync(outputs,{recursive:true});save(join(runDir,"eval_metadata.json"),publicMetadata);}
    else if(JSON.stringify(json(join(runDir,"eval_metadata.json")))!==JSON.stringify(publicMetadata))throw new Error("Run metadata drift");
    const files=outputFiles(outputs),gradePath=join(runDir,"grading.json"),timePath=join(runDir,"timing.json");
    if(!files.length){pending.push({eval_id:s.id,configuration,run_number,prompt:s.prompt,skill_path:configuration==="with_skill"?skill:configuration==="old_skill"?state.baseline_skill:null,files:s.files.map(f=>filePath(skill,f)),run_directory:runDir,output_directory:outputs});continue;}
    if(!existsSync(gradePath)){pendingGrading.push({eval_id:s.id,configuration,run_number,run_directory:runDir,output_directory:outputs,expectations:s.expectations});continue;}
    const raw=json(gradePath) as any;
    if(raw?.summary?.inconclusive>0){pendingGrading.push({run_directory:runDir,status:"inconclusive"});continue;}
    const grade=grading(raw,s);
    if(!existsSync(timePath))missingTiming.push(relative(output,timePath));
    const time=existsSync(timePath)?timing(json(timePath)):{total_duration_seconds:null,total_tokens:null};
    // Python falls back to output_chars when tokens == 0; do not allow that to invent token usage.
    const rawGrade=json(gradePath) as Record<string,unknown>;if(time.total_tokens===0&&obj(rawGrade.execution_metrics)&&rawGrade.execution_metrics.output_chars)throw new Error("Anthropic token fallback would substitute output_chars for zero tokens; remove that conflicting metric for export");
    rows.push({eval_id:s.id,eval_name:s.name,configuration,run_number,result:{...grade.summary,...time,time_seconds:time.total_duration_seconds,tokens:time.total_tokens,tool_calls:null,errors:null},expectations:grade.expectations,notes:[]});
   }
  }
  const report:any={schema_version:state.schema_version,run_id:state.run_id,output,eval_set:evalSet,skill_path:skill,status:pending.length?"awaiting-execution":pendingGrading.length?"awaiting-grading":missingTiming.length?"awaiting-telemetry":"complete",pending,pending_grading:pendingGrading,missing_timing:missingTiming,completed_runs:rows.length,total_runs:cases.length*configurations.length*state.runs_per_query,evidence_authority:"coordinator-reported task/grader artifacts; independent host execution is not authenticated",input_binding:"SKILL.md, eval and declared fixture bytes; resources/ambient context are not frozen"};
  report.grading_requests=packets.filter(p=>!existsSync(join(p.run_directory,"grading.json"))).map(p=>({request_id:p.request_id,request_path:p.request_path}));
  report.review=join(output,"review.html");report.local_benchmark=join(output,"benchmark.local.json");
  {
   const summary:Record<string,any>={};for(const configuration of configurations){const r=rows.filter(row=>row.configuration===configuration);summary[configuration]={pass_rate:stats(r.map(row=>row.result.pass_rate)),time_seconds:stats(r.map(row=>row.result.time_seconds).filter((v:any)=>v!==null)),tokens:stats(r.map(row=>row.result.tokens).filter((v:any)=>v!==null))};}
   const delta=(key:string,digits:number)=>{const a=summary[configurations[0]][key].mean,b=summary[configurations[1]][key].mean;if(a===null||b===null)return null;const v=a-b;return(v>=0?"+":"")+v.toFixed(digits);};summary.delta={pass_rate:delta("pass_rate",2),time_seconds:delta("time_seconds",1),tokens:delta("tokens",0)};
   const benchmark={metadata:{skill_name:metadata.name,skill_path:skill,executor_model:null,analyzer_model:null,timestamp:new Date().toISOString(),evals_run:cases.map(s=>s.id),runs_per_configuration:state.runs_per_query},runs:rows.map(row=>({...row,result:{pass_rate:row.result.pass_rate,passed:row.result.passed,failed:row.result.failed,total:row.result.total,time_seconds:row.result.time_seconds,tokens:row.result.tokens,tool_calls:row.result.tool_calls,errors:row.result.errors}})),run_summary:summary,notes:["Coordinator-reported artifacts; not authenticated provider or independent grading evidence. Descriptive statistics only; no stable-improvement claim."]};
   if(report.status!=="complete"&&existsSync(join(output,"benchmark.json")))throw new Error("Previously complete export is now incomplete; preserve it and start a new iteration");
   if(report.status==="complete")report.benchmark=join(output,"benchmark.json");
   const markdown="# Behavioral benchmark\n\n"+configurations.map(c=>"- "+c+": "+summary[c].pass_rate.mean+" pass rate").join("\n")+"\n\nDescriptive, coordinator-reported evidence only.\n";
   // The local viewer has stricter decision gates; render without fabricating a full-eval receipt.
   const html=sessionEvaluationHtml("Behavioral",report.status,{...benchmark,runs:benchmark.runs.map(row=>({...row,prompt:cases.find(s=>s.id===row.eval_id)?.prompt})),pending:report.pending,pending_grading:report.pending_grading,missing_timing:report.missing_timing});regularPath(report.review);regularPath(join(output,"benchmark.md"));save(report.local_benchmark,benchmark);if(report.status==="complete")save(report.benchmark,benchmark);durableAtomicWrite(join(output,"benchmark.md"),markdown);durableAtomicWrite(report.review,html);
  }
  save(join(output,"run.json"),state);save(join(output,"status.json"),report);return report;
 }catch(error){if(!options.resume)rmSync(output,{recursive:true,force:true});throw error;}finally{release();}
}
