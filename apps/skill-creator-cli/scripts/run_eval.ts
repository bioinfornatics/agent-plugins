#!/usr/bin/env node
import {mkdirSync,mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from "node:fs";
import {join,resolve,basename} from "node:path";
import {tmpdir} from "node:os";
import {randomUUID} from "node:crypto";
import {parseArgs} from "node:util";
import {createRunner,RunnerError} from "./runners/index.js";
import {parseSkillMd} from "./utils.js";
import {aggregateTriggerOutcomes,initialTelemetry,makeTriggerOutcome,observeTriggerTelemetry,summarizeTriggerClassifications} from "./trigger_evaluation.js";
import type {TriggerOutcomeKind,TriggerRunOutcome} from "./trigger_evaluation.js";
interface EvalItem{query:string;should_trigger:boolean}
interface EvalResult{query:string;should_trigger:boolean;trigger_rate:number|null;triggers:number;runs:number;pass:boolean|null;classification_runs:number;infrastructure_failures:number;outcomes:TriggerRunOutcome[]}
interface EvalOutput{schema_version:"2.0";skill_name:string;description:string;results:EvalResult[];summary:{total:number;passed:number;failed:number;unavailable:number};metrics:ReturnType<typeof aggregateTriggerOutcomes>}
const MAX_STREAM_BYTES=1024*1024,MAX_LINE_BYTES=256*1024,MAX_EVENTS=10000;
/** Description-only treatment, matching Anthropic's uniquely named discovery stub.
 * Full Skill evaluation remains a separate isolated behavioral/activation protocol.
 */
function copySkill(skillPath:string,root:string){
 const {name:original,description}=parseSkillMd(skillPath),name=original.slice(0,49).replace(/-+$/,"")+"-skill-"+randomUUID().replaceAll("-","").slice(0,8);
 const target=join(root,".agents","skills",name);mkdirSync(target,{recursive:true});
 const block=description.split("\n").map(line=>"  "+line).join("\n");
 writeFileSync(join(target,"SKILL.md"),`---\nname: ${name}\ndescription: |\n${block}\n---\n\n# ${original}\n\nThis skill handles: ${description}\n`);
 return{name};
}
// First-choice routing telemetry is a request, not successful loading/task use.
export async function runSingleQuery(query:string,skillPath:string,timeoutMs:number,model?:string,runner?:string):Promise<TriggerRunOutcome>{
 const tmp=mkdtempSync(join(tmpdir(),"skill-trigger-eval-")),started=performance.now(),telemetry=initialTelemetry();
 try{
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new RunnerError("Trigger timeout must be positive and finite");
  const {name}=copySkill(resolve(skillPath),tmp),adapter=createRunner(runner);
  let child:ReturnType<typeof adapter.startStream>;
  try{child=adapter.startStream(query,model??null,tmp);}catch{return makeTriggerOutcome("host-failure",started,telemetry);}
  return await new Promise(done=>{
   let buffer="",settled=false,bytes=0,events=0,pending:TriggerOutcomeKind|undefined,triggerMs:number|undefined,terminal=false;
   let escalation:NodeJS.Timeout|undefined;
   const killOwned=(signal:NodeJS.Signals)=>{try{if(process.platform!=="win32"&&child.pid)process.kill(-child.pid,signal);else child.kill(signal);}catch{/* already reaped */}};
   const stop=(kind:TriggerOutcomeKind,time?:number)=>{
    if(settled||pending)return;pending=kind;triggerMs=time;killOwned("SIGTERM");
    escalation=setTimeout(()=>killOwned("SIGKILL"),250);
   };
   const timer=setTimeout(()=>stop("timeout"),timeoutMs);
   const finish=(kind:TriggerOutcomeKind)=>{if(settled)return;settled=true;clearTimeout(timer);if(escalation)clearTimeout(escalation);killOwned("SIGKILL");done(makeTriggerOutcome(kind,started,telemetry,triggerMs));};
   const line=(raw:string)=>{
    if(settled||pending||!raw.trim())return;
    if(Buffer.byteLength(raw)>MAX_LINE_BYTES)return stop("malformed-stream");
    let parsed:unknown;try{parsed=JSON.parse(raw);}catch{return stop("malformed-stream");}
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||++events>MAX_EVENTS)return stop("malformed-stream");
    const event=parsed as Record<string,unknown>;observeTriggerTelemetry(event,telemetry);
    if(["error","failed"].includes(String(event.type))||(event.type==="complete"&&(event.error||event.success===false||(event.exit_code!==undefined&&event.exit_code!==0)||(event.status!==undefined&&!["success","complete","completed"].includes(String(event.status)))||(event.exit_reason!==undefined&&!["success","complete","completed"].includes(String(event.exit_reason))))))return stop("host-failure");
    let decision:boolean|null;try{decision=adapter.firstChoiceLoadedSkill(event,name);}catch{return stop("malformed-stream");}
    if(decision===true)return stop("triggered",performance.now());
    if(decision===false && event.type!=="complete")return stop("not-triggered");
    if(event.type==="complete")terminal=true; // classify negatives only after a clean process close
   };
   child.stdout.on("data",(chunk:Buffer)=>{
    if(settled||pending)return;bytes+=chunk.byteLength;if(bytes>MAX_STREAM_BYTES)return stop("malformed-stream");buffer+=chunk.toString("utf8");
    let i=-1;while(!pending&&(i=buffer.indexOf(String.fromCharCode(10)))!==-1){const value=buffer.slice(0,i);buffer=buffer.slice(i+1);line(value);}
    if(Buffer.byteLength(buffer)>MAX_LINE_BYTES)stop("malformed-stream");
   });
   child.on("error",()=>{pending="host-failure";});
   child.on("exit",()=>killOwned("SIGKILL")); // descendants must not hold the stream open
   child.on("close",code=>{
    if(settled)return;if(!pending&&buffer.trim())line(buffer);
    finish(pending??(code!==0?"host-failure":terminal?"not-triggered":"unsupported-telemetry"));
   });
  });
 }finally{rmSync(tmp,{recursive:true,force:true});}
}
async function mapLimit<T,R>(items:T[],limit:number,fn:(item:T)=>Promise<R>){const results:R[]=new Array(items.length);let index=0;async function worker(){while(index<items.length){const current=index++;results[current]=await fn(items[current])}}await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));return results}
function stageDescription(skillPath:string,description:string,_original:string,tmp:string){
 const staged=join(tmp,basename(skillPath)),{name}=parseSkillMd(skillPath);mkdirSync(staged,{recursive:true});
 writeFileSync(join(staged,"SKILL.md"),`---\nname: ${name}\ndescription: |\n${description.split("\n").map(line=>"  "+line).join("\n")}\n---\n`);
 return staged;
}
export async function runEval(evalSet:EvalItem[],skillPath:string,numWorkers:number,timeoutMs:number,options:{runsPerQuery?:number;triggerThreshold?:number;model?:string;runner?:string;description?:string}={}):Promise<EvalOutput>{const{runsPerQuery=1,triggerThreshold=.5,model,runner,description:override}=options,{name,description:original}=parseSkillMd(skillPath),description=override||original,tmp=mkdtempSync(join(tmpdir(),"skill-description-"));try{const staged=stageDescription(skillPath,description,original,tmp),jobs=evalSet.flatMap((item,itemIndex)=>Array.from({length:runsPerQuery},()=>({item,itemIndex}))),runs=await mapLimit(jobs,numWorkers,async job=>({...job,run:await runSingleQuery(job.item.query,staged,timeoutMs,model,runner)}));const results=evalSet.map((item,itemIndex)=>{const outcomes=runs.filter(x=>x.itemIndex===itemIndex).map(x=>x.run),stats=summarizeTriggerClassifications(outcomes.map(x=>x.classification),item.should_trigger,triggerThreshold,runsPerQuery);return{query:item.query,should_trigger:item.should_trigger,...stats,outcomes}}),passed=results.filter(x=>x.pass===true).length,failed=results.filter(x=>x.pass===false).length,unavailable=results.filter(x=>x.pass===null).length,records=results.flatMap(r=>r.outcomes.map(run=>({should_trigger:r.should_trigger,run})));return{schema_version:"2.0",skill_name:name,description,results,summary:{total:results.length,passed,failed,unavailable},metrics:aggregateTriggerOutcomes(records)}}finally{rmSync(tmp,{recursive:true,force:true})}}
export async function main(){const{values}=parseArgs({args:process.argv.slice(2),options:{"eval-set":{type:"string"},"skill-path":{type:"string"},description:{type:"string"},"num-workers":{type:"string",default:"10"},timeout:{type:"string",default:"30"},"runs-per-query":{type:"string",default:"3"},"trigger-threshold":{type:"string",default:"0.5"},model:{type:"string"},runner:{type:"string"},verbose:{type:"boolean",default:false}}});if(!values["eval-set"]||!values["skill-path"]){console.error("usage: run_eval.js --eval-set <file> --skill-path <dir> [options]");process.exit(2)}const evalSet:EvalItem[]=JSON.parse(readFileSync(resolve(values["eval-set"]),"utf8")),skillPath=resolve(values["skill-path"]);if(!existsSync(join(skillPath,"SKILL.md"))){console.error("error: No SKILL.md found at "+skillPath);process.exit(2)}try{const output=await runEval(evalSet,skillPath,Number(values["num-workers"]),Number(values.timeout)*1000,{description:values.description,runsPerQuery:Number(values["runs-per-query"]),triggerThreshold:Number(values["trigger-threshold"]),model:values.model,runner:values.runner});if(values.verbose){console.error("Results: "+output.summary.passed+"/"+output.summary.total+" passed");for(const result of output.results)console.error("  ["+(result.pass===null?"UNAVAILABLE":result.pass?"PASS":"FAIL")+"] rate="+result.triggers+"/"+result.classification_runs+" expected="+result.should_trigger+": "+result.query.slice(0,70))}console.log(JSON.stringify(output,null,2))}catch(error){console.error("error: "+(error as Error).message);process.exit(error instanceof RunnerError?2:1)}}
if(!import.meta.url.includes("/$bunfs/")&&import.meta.url==="file://"+process.argv[1])main().catch(error=>{console.error(error?.message??error);process.exit(1)})
