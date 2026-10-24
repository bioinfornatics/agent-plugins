import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { aggregateJudgments, assertionHash, canonical as gradingCanonical, deterministicCheck, identityFields, invocationHash, normalizeAssertions, sha256 as gradingSha256, isMetaGradingClaim, type GraderJudgment } from "./evaluator_grading.js";
import { safeLocator } from "./execution_efficiency.js";
import { validEvidenceEventType } from "./runners/goose.js";
import { ADAPTIVE_SCHEDULER_STATE, readAdaptiveState } from "./adaptive_scheduling.js";
import { captureTrustedArtifact, readTrustedJson, readTrustedSnapshot } from "./trusted_snapshot.js";
import { assertPortableScenarioId } from "./scenario_id.js";
import { validateExecutionSamplingProtocol, executionSamplingProtocolHash } from "./execution_sampling_protocol.js";

export interface ExecutionBinding {
  schema_version: "1.0";
  skill_source_sha256: string;
  eval_plan_sha256: string;
  scenario_sha256: string;
  decision_policy: "fixed"|"adaptive";
  reasoning?: unknown;
  matrix_binding?: unknown;
  initial_policy_hash: string|null;
  configuration: string;
  run_index: number;
  pair_index?: number;
  seed?: number;
  order?: string[];
  order_position?: number;
  pair_equivalence?: { model: unknown; reasoning?: unknown; tools: unknown; fixture_sha256: unknown; timeout_seconds: unknown; max_turns: unknown };
  artifact_sha256: Record<string, string>;
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function compositeHash(parts: Array<string | Buffer>): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export type PairedOrder = ["with_skill" | "baseline", "with_skill" | "baseline"];

type ScheduleBinding = { skill_source_sha256: string; eval_plan_sha256: string; scenario_sha256: string };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Hash an evidence mode from canonical JSON, independent of object key order. */
export function evidenceModeHash(mode: unknown): string {
  return sha256(canonical(mode));
}

function rawPairSeed(binding: ScheduleBinding, pairIndex: number): number {
  return Number.parseInt(compositeHash([binding.skill_source_sha256, binding.eval_plan_sha256, binding.scenario_sha256, String(pairIndex)]).slice(0, 8), 16) >>> 0;
}

/** Derive a pair's execution order solely from its recorded unsigned 32-bit seed. */
export function pairedOrderFromSeed(seed: number): PairedOrder {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError("pair seed must be an unsigned 32-bit integer");
  return seed % 2 === 0 ? ["with_skill", "baseline"] : ["baseline", "with_skill"];
}

/** Derive reproducible seeds whose parity alternates, preserving counterbalance. */
export function counterbalancedPairSeed(binding: ScheduleBinding, pairIndex: number): number {
  if (!Number.isInteger(pairIndex) || pairIndex <= 0) throw new TypeError("pair index must be a positive integer");
  const startingParity = rawPairSeed(binding, 1) & 1;
  const requiredParity = startingParity ^ ((pairIndex - 1) & 1);
  return ((rawPairSeed(binding, pairIndex) & 0xfffffffe) | requiredParity) >>> 0;
}

function isDirectory(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

function filesBelow(root: string, current = root): string[] {
  if (!isDirectory(current)) return existsSync(current) ? [current] : [];
  const files: string[] = [];
  for (const name of readdirSync(current).sort()) files.push(...filesBelow(root, join(current, name)));
  return files;
}

/** A stable content hash that includes relative names and bytes for directories. */
export function artifactHash(path: string, trustRoot?:string): string {
  if (!existsSync(path)) return "missing";
  return captureTrustedArtifact(trustRoot??dirname(path),path,"evaluation evidence artifact").sha256;
}

export class ExecutionPlanError extends Error {
  readonly code: "invalid-evaluation-plan" | "incomplete-paired-runs";
  constructor(code: "invalid-evaluation-plan" | "incomplete-paired-runs", message: string) { super(message); this.name = "ExecutionPlanError"; this.code = code; }
}
export function expectedRunDirs(workspace: string, includeSuperseded = false): string[] {
  const absolute = resolve(workspace); if (!isDirectory(absolute)) return [];
  const result: string[] = [], ids = new Set<string>();
  for (const evalName of readdirSync(absolute).filter(name => name.startsWith("eval-")).sort()) {
    const evalDir = join(absolute, evalName); if (!isDirectory(evalDir)) continue;
    const metadata = loadJson(join(evalDir, "eval_metadata.json"));
    if (!metadata || !["fast", "standard", "release"].includes(metadata.run_profile)) throw new ExecutionPlanError("invalid-evaluation-plan", evalName+" has invalid or missing run_profile");
    const profilePairs:Record<string,number>={fast:1,standard:3,release:5};
    const adaptive=metadata.decision_policy==="adaptive";
    if (!Number.isInteger(metadata.requested_pairs) || metadata.requested_pairs<1 || (!adaptive&&metadata.requested_pairs !== profilePairs[metadata.run_profile])) throw new ExecutionPlanError("invalid-evaluation-plan", evalName+" requested_pairs must exactly match run_profile in fixed mode or be a positive adaptive maximum");
    let id:string;try{id=assertPortableScenarioId(metadata.eval_id)}catch(error){throw new ExecutionPlanError("invalid-evaluation-plan",evalName+" "+(error as Error).message)} if (evalName!=="eval-"+id)throw new ExecutionPlanError("invalid-evaluation-plan",evalName+" does not match eval_id "+id);if(ids.has(id)) throw new ExecutionPlanError("invalid-evaluation-plan", evalName+" has missing or duplicate eval_id "+id); ids.add(id);
    const schedules = metadata.execution_schedule;
    if (!Array.isArray(schedules) || schedules.length !== metadata.requested_pairs) throw new ExecutionPlanError("invalid-evaluation-plan", evalName+" execution_schedule must contain exactly requested_pairs entries");
    const binding=metadata.execution_binding;
    if (!binding || typeof binding!=="object") throw new ExecutionPlanError("invalid-evaluation-plan", evalName+" execution_binding is missing");
    const expectedConfigs = ["with_skill", metadata.baseline_configuration ?? (isDirectory(join(evalDir,"old_skill")) ? "old_skill" : "without_skill")];
    for (let index=1; index<=metadata.requested_pairs; index++) {
      const scheduled=schedules[index-1];
      const scheduleBinding={skill_source_sha256:String(binding.skill_source_sha256),eval_plan_sha256:String(binding.eval_plan_sha256),scenario_sha256:String(binding.scenario_sha256)};
      const expectedSeed=counterbalancedPairSeed(scheduleBinding,index);
      const expectedOrder=pairedOrderFromSeed(expectedSeed);
      if (!scheduled || scheduled.pair_index!==index || scheduled.seed!==expectedSeed || JSON.stringify(scheduled.order)!==JSON.stringify(expectedOrder)) throw new ExecutionPlanError("invalid-evaluation-plan", evalName+" execution_schedule is not a strict total deterministic schedule at pair "+index);
      for (const config of expectedConfigs) result.push(join(evalDir,config,"run-"+index));
    }
  }
  const statePath=join(absolute,ADAPTIVE_SCHEDULER_STATE);
  if(includeSuperseded||!existsSync(statePath))return result;
  const policies=result.map(path=>loadJson(join(dirname(dirname(path)),"eval_metadata.json"))?.anytime_quality_policy).filter(Boolean);
  if(!policies.length||policies.some(value=>JSON.stringify(value)!==JSON.stringify(policies[0])))throw new ExecutionPlanError("invalid-evaluation-plan","adaptive scheduling state has no single predeclared policy");
  const state=readAdaptiveState(statePath,policies[0],absolute,result),superseded=new Set(state.superseded_unstarted_tasks);
  return result.filter(path=>!superseded.has(relative(absolute,path).replaceAll("\\","/")));
}

/** The single verified evidence-membership boundary: fixed uses the full plan; adaptive uses the canonical admitted/countable prefix plus any started pair that must be drained. */
export function requiredRunDirs(workspace:string):string[]{return expectedRunDirs(workspace);}

export function listRunDirs(workspace: string): string[] {
  const result: string[] = [];
  const absolute = resolve(workspace);
  // Archives retain the original eval-* layout for auditability, but are never
  // active evaluation inputs even when a caller points discovery at one.
  if (absolute.split(sep).includes(".full-eval-archive") || !isDirectory(absolute)) return result;
  workspace = absolute;
  for (const evalName of readdirSync(workspace).filter(name => name.startsWith("eval-")).sort()) {
    const evalDir = join(workspace, evalName);
    if (!isDirectory(evalDir)) continue;
    for (const configuration of readdirSync(evalDir).sort()) {
      const configDir = join(evalDir, configuration);
      if (!isDirectory(configDir) || !(configuration.includes("with_skill") || configuration.includes("old_skill") || configuration.includes("without_skill"))) continue;
      const runs = readdirSync(configDir).filter(name => /^run-\d+$/.test(name) && isDirectory(join(configDir, name))).sort();
      result.push(...(runs.length ? runs.map(name => join(configDir, name)) : [configDir]));
    }
  }
  return result;
}

export function runCoordinates(runDir: string): { configuration: string; run_index: number } {
  const runName = basename(runDir);
  if (/^run-\d+$/.test(runName)) return { configuration: basename(dirname(runDir)), run_index: Number(runName.slice(4)) };
  return { configuration: basename(runDir), run_index: 1 };
}

const EVIDENCE_ARTIFACT_NAMES=["outputs", "grading.json", "timing.json", "navigation.json", "transcript.json", "events.json", "deterministic-evidence.json", "grader-evidence", "manual-import-manifest.json"] as const;
export function evidenceArtifactHashes(runDir: string): Record<string, string> {
  const result: Record<string, string> = {},root=resolve(runDir,"../../..");
  for (const name of EVIDENCE_ARTIFACT_NAMES) {
    const path = join(runDir, name);
    if (existsSync(path) && (name !== "outputs" || isDirectory(path))) result[name] = artifactHash(path,root);
  }
  return result;
}

function loadJson(path: string, root?:string): any | null {
  try { return readTrustedJson(root??resolve(dirname(path),".."),path,"trusted evaluation JSON"); } catch(error){if(/symbolic|realpath|identity|changed while|regular file|bounded snapshot/i.test((error as Error).message))throw error;return null;}
}

export function expectedExecutionBinding(runDir: string): Omit<ExecutionBinding, "schema_version" | "artifact_sha256"> | null {
  const evalDir = dirname(dirname(runDir));
  const metadata = loadJson(join(evalDir, "eval_metadata.json"));
  const context = metadata?.execution_binding;
  if (!context || typeof context !== "object") return null;
  const coordinates = runCoordinates(runDir);
  return {
    skill_source_sha256: String(context.skill_source_sha256 ?? ""),
    eval_plan_sha256: String(context.eval_plan_sha256 ?? ""),
    scenario_sha256: String(context.scenario_sha256 ?? ""),
    decision_policy: context.decision_policy,
    ...((context as any).reasoning !== undefined ? { reasoning:(context as any).reasoning } : {}),
    ...((context as any).matrix_binding !== undefined ? { matrix_binding:(context as any).matrix_binding } : {}),
    initial_policy_hash: context.initial_policy_hash??null,
    ...((context as any).family_manifest_hash ? { family_manifest_hash:String((context as any).family_manifest_hash), comparison_claim:(context as any).comparison_claim, sampling_protocol_hash:String((context as any).sampling_protocol_hash), sampling_protocol:(context as any).sampling_protocol } : {}),
    ...((context as any).evidence_mode_sha256 ? { evidence_mode_sha256: String((context as any).evidence_mode_sha256) } : {}),
    ...((context as any).grading_plan_sha256 ? { grading_plan_sha256: String((context as any).grading_plan_sha256) } : {}),
    ...coordinates,
    ...(Array.isArray(metadata?.execution_schedule) ? (() => { const scheduled=metadata.execution_schedule.find((item:any)=>item.pair_index===coordinates.run_index); if(!scheduled)return {}; const baseline=coordinates.configuration.includes("old_skill")||coordinates.configuration.includes("without_skill"); const role=baseline?"baseline":"with_skill"; return {pair_index:scheduled.pair_index,seed:scheduled.seed,order:scheduled.order,order_position:scheduled.order.indexOf(role)+1}; })() : {}),
  };
}

function metadataMode(runDir:string):{planned:string;hash:string}{ const metadata=loadJson(join(dirname(dirname(runDir)),"eval_metadata.json")); const mode=metadata?.evidence_mode; return {planned:String(mode?.planned??"manual-governed-import"),hash:evidenceModeHash(mode??{schema_version:1,planned:"manual-governed-import"})}; }
type CapturedArtifacts=Map<string,ReturnType<typeof captureTrustedArtifact>>;
function capturedJson(captured:CapturedArtifacts,name:string):any|null{const snapshot=captured.get(name)?.files.get("");if(!snapshot)return null;try{return JSON.parse(snapshot.bytes.toString("utf8"));}catch{return null;}}
function semanticEvidence(captured:CapturedArtifacts):any[]{const files=captured.get("grader-evidence")?.files??new Map();return [...files].filter(([name])=>name.endsWith(".json")).sort(([a],[b])=>a.localeCompare(b)).map(([,snapshot])=>{try{return JSON.parse(snapshot.bytes.toString("utf8"));}catch{return null;}}).filter(Boolean);}
function same(a:unknown,b:unknown):boolean{return gradingCanonical(a)===gradingCanonical(b);}
function verifyEvaluatorGrade(runDir:string,label:string,metadata:any,manifest:any,grading:any,captured:CapturedArtifacts,errors:string[]):void{
  const outputBytes=captured.get("outputs")?.files.get("result.txt")?.bytes??Buffer.alloc(0),output=outputBytes.toString("utf8");
  const assertions=normalizeAssertions(Array.isArray(metadata?.assertions)?metadata.assertions:[]), outputHash=gradingSha256(outputBytes);
  const assertionSetHash=gradingSha256(canonical(assertions)), configuration=runCoordinates(runDir).configuration;
  const sourceHash=metadata?.source_bindings?.[configuration]??null, fixtureHash=String(metadata?.fixture_sha256??"");
  const variantHash=gradingSha256(JSON.stringify({configuration,source_sha256:sourceHash,fixture_sha256:fixtureHash}));
  const plan=metadata?.grading_plan, planned=Array.isArray(plan?.graders)?plan.graders:[];
  if(!plan||metadata?.execution_binding?.grading_plan_sha256!==gradingSha256(gradingCanonical(plan)))errors.push(label+" immutable grading plan binding is invalid");
  if(planned.length<1||new Set(planned.map((g:any)=>g.id)).size!==planned.length||planned.some((g:any)=>g.blinded!==true))errors.push(label+" immutable grading plan requires at least one distinct blinded explicit grader");
  for(const [field,value] of Object.entries({assertion_set_sha256:assertionSetHash,variant_sha256:variantHash,output_sha256:outputHash})){
    if(grading?.[field]!==value)errors.push(label+" grading "+field+" is not derived from authoritative scaffold/output");
    if(manifest?.grading_binding?.[field]!==value)errors.push(label+" execution grading "+field+" is not derived from authoritative scaffold/output");
  }
  const claimed=Array.isArray(grading?.expectations)?grading.expectations:[], derived:any[]=[], allInvocationIds:Array<{id:string;grader:string}>=[];
  const allSemanticEvidence=semanticEvidence(captured),semanticAssertionHashes=new Set(assertions.filter(assertion=>assertion.classification==="semantic").map(assertion=>assertionHash(assertion))),plannedGraderIds=new Set(planned.map((grader:any)=>String(grader.id)));
  if(allSemanticEvidence.some(j=>!semanticAssertionHashes.has(j?.assertion_sha256)||!plannedGraderIds.has(String(j?.grader_id))))errors.push(label+" grader evidence is outside the immutable assertion/grader plan");
  const timing=capturedJson(captured,"timing.json"), usageRows=Array.isArray(timing?.grader_usage)?timing.grader_usage:[];
  for(const assertion of assertions){const ah=assertionHash(assertion), common={id:assertion.id,version:assertion.version,classification:assertion.classification,text:assertion.criterion,criterion:assertion.criterion,assertion_sha256:ah,variant_sha256:variantHash,output_sha256:outputHash};
    if(assertion.classification==="deterministic"){const checked=deterministicCheck(assertion,output);derived.push({...common,...(assertion.critical===undefined?{}:{critical:assertion.critical}),verdict:checked.verdict,passed:checked.verdict==="pass",evidence:checked.evidence});continue;}
    const files=allSemanticEvidence.filter(j=>j.assertion_sha256===ah), valid:GraderJudgment[]=[];
    if(files.length!==planned.length)errors.push(label+" semantic assertion "+assertion.id+" evidence set differs from the immutable planned grader set");
    for(const grader of planned){const matches=files.filter(j=>j.grader_id===grader.id);if(matches.length!==1){errors.push(label+" semantic assertion "+assertion.id+" requires exactly one judgment from planned grader "+grader.id);continue;}const j=matches[0], identity={id:String(grader.id),model:String(grader.model),provider:String(grader.provider??"unspecified"),command:Array.isArray(grader.command)?grader.command.map(String):[],config:grader.config??{},invocation_id:String(j.invocation_id??""),blinded:grader.blinded!==false},fields=identityFields(identity);
      const bound=j.assertion_sha256===ah&&j.variant_sha256===variantHash&&j.output_sha256===outputHash&&j.grader_identity_sha256===fields.grader_identity_sha256&&j.grader_config_sha256===fields.grader_config_sha256&&j.invocation_nonce_sha256===gradingSha256(identity.invocation_id)&&j.grader_invocation_sha256===invocationHash({assertionSha256:ah,variantSha256:variantHash,outputSha256:outputHash},fields);
      const quote=typeof j.evidence_quote==="string"?j.evidence_quote:"", evidence=quote.trim().length>0&&output.includes(quote)&&typeof j.rationale==="string"&&j.rationale.trim().length>0&&!isMetaGradingClaim(assertion.criterion,quote);
      let raw:any=null;try{const match=/\{[\s\S]*\}/.exec(String(j.raw_response??""));raw=match?JSON.parse(match[0]):null;}catch{}
      const rawMatches=raw&&raw.verdict===j.verdict&&raw.evidence_quote===j.evidence_quote&&raw.rationale===j.rationale;
      const usageMatches=usageRows.some((row:any)=>row.grader_id===grader.id&&row.model===grader.model&&same(row.usage,j.usage));
      if(!bound||j.blinded!==true||!identity.invocation_id||!evidence||j.valid_evidence!==true||!["pass","fail","inconclusive"].includes(j.verdict)||!rawMatches||!usageMatches){errors.push(label+" invalid bound/blinded/substantive judgment or usage for "+assertion.id+" from "+grader.id);continue;}allInvocationIds.push({id:j.invocation_id,grader:j.grader_id});valid.push(j as GraderJudgment);
    }
    if(new Set(valid.map(j=>j.invocation_id)).size!==valid.length)errors.push(label+" semantic assertion "+assertion.id+" reuses grader invocation IDs");
    const aggregate=aggregateJudgments(valid.length===planned.length?valid:[]);derived.push({...common,...aggregate,passed:aggregate.verdict==="pass",evidence:valid.map(j=>j.evidence_quote),judgments:valid,...(valid.length?{}:{reason:"Every planned explicit grader must provide one valid judgment"})});
  }
  if(allInvocationIds.some(a=>allInvocationIds.some(b=>a.id===b.id&&a.grader!==b.grader)))errors.push(label+" grader invocation IDs must be distinct across graders");
  if(claimed.length!==derived.length)errors.push(label+" grading expectations do not match planned assertions");
  for(let i=0;i<derived.length;i++){const a=claimed[i],d=derived[i];for(const key of ["id","version","classification",...(Object.hasOwn(d,"critical")?["critical"]:[]),"assertion_sha256","variant_sha256","output_sha256","verdict","passed"])if(!a||!same(a[key],d[key]))errors.push(label+" expectation "+(d.id??i)+" "+key+" is not independently derived");}
  const summary={passed:derived.filter(x=>x.verdict==="pass").length,failed:derived.filter(x=>x.verdict==="fail").length,inconclusive:derived.filter(x=>x.verdict==="inconclusive").length,total:derived.length};
  const complete={...summary,pass_rate:summary.total?summary.passed/summary.total:0,human_review:summary.inconclusive>0};for(const [key,value] of Object.entries(complete))if(!same(grading?.summary?.[key],value))errors.push(label+" grading summary "+key+" is not independently derived");
}
function verifySanitizedRunnerEvidence(runDir:string,label:string,timing:any,manifest:any,metadata:any,captured:CapturedArtifacts,errors:string[]):void{
 const telemetry=timing?.execution_efficiency;if(telemetry?.schema_version!=="1.3"||telemetry?.parser_protocol!=="provider-event-metadata-v4-closed-labels"){errors.push(label+" current Goose evidence requires telemetry schema 1.3 and the closed-label parser protocol");return;}
 const events=capturedJson(captured,"events.json"),transcript=capturedJson(captured,"transcript.json");
 if(!Array.isArray(events)||!transcript||transcript.schema_version!=="1.0"||transcript.privacy!=="sanitized-evidence-projection"||!same(transcript.events,events)){errors.push(label+" sanitized transcript/events projection is missing or inconsistent");return;}
 const allowed=new Set(["type","observed_at_seconds","tool_name","locator","redactions"]),declaredTools=Array.isArray(metadata?.capabilities?.tools)&&metadata.capabilities.tools.every((x:any)=>typeof x==="string")?metadata.capabilities.tools:[];
 if(!same(manifest?.pair_equivalence?.tools,declaredTools))errors.push(label+" execution evidence tools do not match the declared execution-plan allowlist");
 for(const event of events){if(!event||typeof event!=="object"||Object.keys(event).some(key=>!allowed.has(key))||!validEvidenceEventType(event.type)||typeof event.observed_at_seconds!=="number"||!Number.isFinite(event.observed_at_seconds)||event.observed_at_seconds<0||!Array.isArray(event.redactions)||event.redactions.some((x:any)=>typeof x!=="string")){errors.push(label+" contains invalid or unsanitized event projection");continue;}
  if(event.tool_name!==undefined&&(event.tool_name!=="[REDACTED]"&&!declaredTools.includes(event.tool_name)))errors.push(label+" projected tool name is not bound to the declared execution-plan allowlist");
  if(event.locator!==undefined){const locator=event.locator;if(!locator||typeof locator!=="object"||!["file","reference"].includes(locator.kind)||typeof locator.redacted!=="boolean"||!(locator.value===null||typeof locator.value==="string")||!(locator.reason===null||typeof locator.reason==="string")||(locator.value!==null&&safeLocator(locator.value,runDir)!==locator.value)||(locator.redacted!==(locator.value===null))){errors.push(label+" contains unsafe projected locator");}}
 }
 if(!manifest?.artifact_sha256?.["events.json"]||!manifest?.artifact_sha256?.["transcript.json"])errors.push(label+" sanitized evidence artifacts are not hash-bound");
 const parse=telemetry.stream_parse;if(!parse||!["valid","invalid"].includes(parse.status)||parse.source!=="runner-stream"||!Number.isSafeInteger(parse.error_count)||parse.error_count<0||(parse.status==="invalid")!==(parse.error_count>0)||!(parse.reason===null||typeof parse.reason==="string")||(parse.status==="invalid"&&!parse.reason))errors.push(label+" stream parse provenance is invalid or unavailable");
}
function verifyManualImport(runDir:string,label:string,metadata:any,manifest:any,captured:CapturedArtifacts,errors:string[]):void{const imported=capturedJson(captured,"manual-import-manifest.json");if(!imported||imported.schema_version!==1||imported.governed!==true||typeof imported.signer!=="string"||!imported.signer||typeof imported.signature!=="string"||!imported.signature||imported.evidence_mode_sha256!==metadata?.execution_binding?.evidence_mode_sha256||imported.scenario_sha256!==metadata?.execution_binding?.scenario_sha256)errors.push(label+" manual evidence requires a governed signed import manifest bound to the scaffold");if(manifest?.executor?.adapter!=="manual-import")errors.push(label+" manual import cannot relabel its executor as Goose");}

/**
 * Verifies grading.json produced by import_grading.ts's finalizeDelegatedRun
 * for a "delegated-grading" scenario (ap-8di.6). Deliberately independent
 * of verifyEvaluatorGrade's CommandGraderAdapter-specific fields
 * (grader_identity_sha256, invocation_nonce_sha256, raw_response, per-grader
 * timing.grader_usage rows) which have no meaning for a judgment authored
 * by a delegated subagent rather than a spawned subprocess. A run whose
 * grading.json/execution-evidence.json still reflect the pending state
 * gradeOutput produces with no adapter (authority !== "delegated-evaluator")
 * is treated as awaiting-grading, not as invalid evidence: full-eval's own
 * awaiting-grading checkpoint is responsible for reporting that state to
 * the caller, so this function only rejects grading that claims to be
 * delegated-evaluator-authored but does not actually satisfy the same
 * assertion-set/variant/output/grader-plan binding evaluator-owned grading
 * requires.
 */
function verifyDelegatedGrade(runDir:string,label:string,metadata:any,manifest:any,grading:any,captured:CapturedArtifacts,errors:string[]):void{
  if(grading?.authority!=="delegated-evaluator"){errors.push(label+" is awaiting delegated grading (run prepare-grading/import-grading, then --resume)");return;}
  const outputBytes=captured.get("outputs")?.files.get("result.txt")?.bytes??Buffer.alloc(0),output=outputBytes.toString("utf8");
  const assertions=normalizeAssertions(Array.isArray(metadata?.assertions)?metadata.assertions:[]), outputHash=gradingSha256(outputBytes);
  const assertionSetHash=gradingSha256(canonical(assertions)), configuration=runCoordinates(runDir).configuration;
  const sourceHash=metadata?.source_bindings?.[configuration]??null, fixtureHash=String(metadata?.fixture_sha256??"");
  const variantHash=gradingSha256(JSON.stringify({configuration,source_sha256:sourceHash,fixture_sha256:fixtureHash}));
  const plan=metadata?.grading_plan, planned=Array.isArray(plan?.graders)?plan.graders:[];
  if(!plan||metadata?.execution_binding?.grading_plan_sha256!==gradingSha256(gradingCanonical(plan)))errors.push(label+" immutable grading plan binding is invalid");
  if(planned.length<1)errors.push(label+" delegated grading plan requires at least one declared grader");
  for(const [field,value] of Object.entries({assertion_set_sha256:assertionSetHash,variant_sha256:variantHash,output_sha256:outputHash})){
    if(grading?.[field]!==value)errors.push(label+" delegated grading "+field+" is not derived from authoritative scaffold/output");
    if(manifest?.grading_binding?.[field]!==value)errors.push(label+" delegated execution grading "+field+" is not derived from authoritative scaffold/output");
  }
  const allSemanticEvidence=semanticEvidence(captured),semanticAssertionHashes=new Set(assertions.filter(assertion=>assertion.classification==="semantic").map(assertion=>assertionHash(assertion))),plannedGraderIds=new Set(planned.map((grader:any)=>String(grader.id)));
  if(allSemanticEvidence.some(j=>!semanticAssertionHashes.has(j?.assertion_sha256)||!plannedGraderIds.has(String(j?.grader_id))))errors.push(label+" delegated grader evidence is outside the immutable assertion/grader plan");
  const claimed=Array.isArray(grading?.expectations)?grading.expectations:[];
  for(const assertion of assertions){
    const ah=assertionHash(assertion);
    if(assertion.classification==="deterministic")continue;
    const files=allSemanticEvidence.filter(j=>j.assertion_sha256===ah);
    if(files.length!==planned.length){errors.push(label+" semantic assertion "+assertion.id+" evidence set differs from the immutable planned grader set");continue;}
    for(const grader of planned){
      const matches=files.filter(j=>j.grader_id===grader.id);
      if(matches.length!==1){errors.push(label+" semantic assertion "+assertion.id+" requires exactly one judgment from planned grader "+grader.id);continue;}
      const j=matches[0];
      const quote=typeof j.evidence_quote==="string"?j.evidence_quote:"";
      // A judgment with valid_evidence===false is a legitimate outcome
      // import-grading already produced (an uncontained, empty-rationale,
      // or self-referential quote resolves to inconclusive with
      // valid_evidence:false, not a fabricated pass/fail) — it must not be
      // re-flagged as invalid provenance here. Only a judgment CLAIMING
      // valid_evidence:true is re-verified against the same
      // containment/nonempty-rationale/anti-self-reference rule
      // import-grading itself enforced, so a tampered "true" claim cannot
      // slip through.
      const containedAndSubstantive=quote.trim().length>0&&output.includes(quote)&&typeof j.rationale==="string"&&j.rationale.trim().length>0&&!isMetaGradingClaim(assertion.criterion,quote);
      const evidence=j.valid_evidence===true?containedAndSubstantive:j.valid_evidence===false;
      if(j.assertion_sha256!==ah||j.variant_sha256!==variantHash||j.output_sha256!==outputHash||j.blinded!==true||!["pass","fail","inconclusive"].includes(j.verdict)||!evidence)errors.push(label+" invalid bound/blinded/substantive delegated judgment for "+assertion.id+" from "+grader.id);
    }
    const expectation=claimed.find((e:any)=>e.id===assertion.id&&e.version===assertion.version);
    if(!expectation||expectation.assertion_sha256!==ah||expectation.variant_sha256!==variantHash||expectation.output_sha256!==outputHash)errors.push(label+" delegated grading expectation "+assertion.id+" is not independently derived");
  }
  const summary=claimed.length?{passed:claimed.filter((e:any)=>e.verdict==="pass").length,failed:claimed.filter((e:any)=>e.verdict==="fail").length,inconclusive:claimed.filter((e:any)=>e.verdict!=="pass"&&e.verdict!=="fail").length,total:claimed.length}:null;
  if(summary){const complete={...summary,pass_rate:summary.total?summary.passed/summary.total:0,human_review:summary.inconclusive>0};for(const [key,value] of Object.entries(complete))if(!same(grading?.summary?.[key],value))errors.push(label+" delegated grading summary "+key+" is not independently derived");}
}

export function validateExecutionEvidence(
  workspace: string,
  expected?: { skill_source_sha256?: string; eval_plan_sha256?: string },
): { status: "complete" | "blocked"; errors: string[]; evidence_sha256: string; bindings: ExecutionBinding[] } {
  const errors: string[] = [];
  const bindings: ExecutionBinding[] = [];
  let job:any=null;try{job=readTrustedJson(resolve(workspace),join(resolve(workspace),".full-eval-job.json"),"full-eval job");}catch(error){if(existsSync(join(resolve(workspace),".full-eval-job.json")))errors.push((error as Error).message);}
  const jobMode=job?.decision_policy,jobPolicyHash=job?.initial_policy_hash??null;
  if(job&&(jobMode!=="fixed"&&jobMode!=="adaptive"))errors.push("full-eval job decision policy is invalid");
  if(jobMode==="adaptive"&&!/^[a-f0-9]{64}$/.test(String(jobPolicyHash??"")))errors.push("adaptive full-eval job initial policy hash is missing or invalid");
  if(jobMode==="fixed"&&jobPolicyHash!==null)errors.push("fixed full-eval job must have a null initial policy hash");
  const digestParts: Array<string | Buffer> = [];
  let completePlan: string[], planned: string[];
  try {
    // expectedRunDirs(..., true) is path planning only and never reads adaptive state.
    // Validate every materialized execution first; only then may state select the active prefix.
    completePlan = expectedRunDirs(workspace, true);
    const adaptiveStatePath=join(resolve(workspace),[".adaptive-scheduling","json"].join(".")),adaptive=existsSync(adaptiveStatePath),requiredArtifacts=[["execution-evidence","json"].join("."),["grading","json"].join("."),["timing","json"].join(".")];
    planned=adaptive?completePlan.filter(runDir=>requiredArtifacts.some(name=>existsSync(join(runDir,name)))):completePlan;
  } catch (error) { errors.push((error as Error).message); return { status: "blocked", errors, evidence_sha256: compositeHash([]), bindings }; }
  for (const runDir of planned) {
    if (!isDirectory(runDir)) { errors.push(relative(workspace,runDir).replaceAll("\\","/")+" missing planned run directory"); continue; }
    const label = relative(workspace, runDir).replaceAll("\\", "/");
    const manifestPath = join(runDir, "execution-evidence.json");
    const root=resolve(workspace),captured:CapturedArtifacts=new Map();
    try{for(const name of EVIDENCE_ARTIFACT_NAMES)if(existsSync(join(runDir,name)))captured.set(name,captureTrustedArtifact(root,join(runDir,name),label+"/"+name));}catch(error){errors.push((error as Error).message);continue;}
    let manifestSnapshot;try{manifestSnapshot=readTrustedSnapshot(root,manifestPath,label+"/"+["execution-evidence","json"].join("."));}catch(error){errors.push((error as Error).message);continue;}
    let manifest:ExecutionBinding|null=null;try{manifest=JSON.parse(manifestSnapshot.bytes.toString("utf8"));}catch{}
    const wanted = expectedExecutionBinding(runDir);
    if(job&&wanted&&(wanted.decision_policy!==jobMode||wanted.initial_policy_hash!==jobPolicyHash))errors.push(label+" execution plan intent does not match the trusted full-eval job");
    if (!manifest) { errors.push(`${label}/execution-evidence.json missing or invalid`); continue; }
    if (!wanted) { errors.push(`${label} generated eval metadata has no execution binding`); continue; }
    const fields: string[] = ["skill_source_sha256", "eval_plan_sha256", "scenario_sha256", "decision_policy", "initial_policy_hash", "family_manifest_hash", "comparison_claim", "sampling_protocol_hash", "sampling_protocol", "evidence_mode_sha256", "grading_plan_sha256", "configuration", "run_index", "pair_index", "seed", "order", "order_position"];
    for (const field of fields) if (JSON.stringify((manifest as any)[field]) !== JSON.stringify((wanted as any)[field])) errors.push(`${label} execution evidence ${field} does not match the current plan`);
    if (manifest.schema_version !== "1.0") errors.push(`${label} execution evidence schema_version must be 1.0`);
    if(jobMode==="adaptive"){try{const protocol=validateExecutionSamplingProtocol((manifest as any).sampling_protocol);if(executionSamplingProtocolHash(protocol)!==(manifest as any).sampling_protocol_hash)errors.push(`${label} execution sampling protocol hash is not canonical`);}catch(error){errors.push(`${label} execution sampling protocol is invalid: ${(error as Error).message}`);}}
    if (expected?.skill_source_sha256 && manifest.skill_source_sha256 !== expected.skill_source_sha256) errors.push(`${label} execution evidence is from a different skill source`);
    if (expected?.eval_plan_sha256 && manifest.eval_plan_sha256 !== expected.eval_plan_sha256) errors.push(`${label} execution evidence is from a different eval plan`);
    const actual=Object.fromEntries([...captured].map(([name,snapshot])=>[name,snapshot.sha256]));
    for (const required of ["outputs", "grading.json", "timing.json"]) if (!actual[required]) errors.push(`${label}/${required} missing`);
    const grading=capturedJson(captured,"grading.json"), timing=capturedJson(captured,"timing.json"), mode=metadataMode(runDir), executor=(manifest as any).executor;
    if ((manifest as any).evidence_mode_sha256!==mode.hash) errors.push(`${label} evidence mode does not match the immutable scaffold plan`);
    const metadata=loadJson(join(dirname(dirname(runDir)),"eval_metadata.json"));
    if((mode.planned==="goose-evaluator"||mode.planned==="delegated-grading")&&executor?.adapter!=="goose") errors.push(`${label} planned Goose execution cannot be downgraded by deleting or changing its executor marker`);
    if(mode.planned==="manual-governed-import") verifyManualImport(runDir,label,metadata,manifest,captured,errors);
    if(mode.planned==="goose-evaluator"){
      verifySanitizedRunnerEvidence(runDir,label,timing,manifest,metadata,captured,errors);
      if(grading?.schema_version!==2||grading?.authority!=="evaluator"||(manifest as any).grading_binding?.authority!=="evaluator")errors.push(`${label} production Goose execution requires evaluator-owned grading`);
      else verifyEvaluatorGrade(runDir,label,metadata,manifest,grading,captured,errors);
    }
    if(mode.planned==="delegated-grading"){
      verifySanitizedRunnerEvidence(runDir,label,timing,manifest,metadata,captured,errors);
      verifyDelegatedGrade(runDir,label,metadata,manifest,grading,captured,errors);
    }
    if (!manifest.artifact_sha256 || typeof manifest.artifact_sha256 !== "object") errors.push(`${label} execution evidence artifact hashes missing`);
    else {
      const keys = [...new Set([...Object.keys(actual), ...Object.keys(manifest.artifact_sha256)])].sort();
      for (const key of keys) if (manifest.artifact_sha256[key] !== actual[key]) errors.push(`${label}/${key} content hash mismatch`);
    }
    bindings.push(manifest);
    digestParts.push(label, manifestSnapshot.bytes);
    for (const [name, hash] of Object.entries(actual).sort(([a], [b]) => a.localeCompare(b))) digestParts.push(`${label}/${name}`, hash);
  }
  if(!errors.length&&existsSync(join(resolve(workspace),[".adaptive-scheduling","json"].join(".")))){
    try{const active=expectedRunDirs(workspace),materialized=new Set(planned.map(runDir=>resolve(runDir)));for(const runDir of active)if(!materialized.has(resolve(runDir)))errors.push(relative(workspace,runDir).replaceAll("\\","/")+" missing planned run directory");}
    catch(error){errors.push((error as Error).message);}
  }
  if(bindings.length&&!job)errors.push("bound execution evidence requires trusted .full-eval-job.json campaign authority");
  const byPair = new Map<string, ExecutionBinding[]>();
  for (const binding of bindings) { const key=String(binding.scenario_sha256)+":"+String(binding.pair_index); const group=byPair.get(key)??[]; group.push(binding); byPair.set(key,group); }
  for (const [key,pair] of byPair) {
    if (pair.length!==2) { errors.push(key+" expected exactly two paired executions"); continue; }
    const [a,b]=pair, ae=(a as any).pair_equivalence, be=(b as any).pair_equivalence;
    for (const field of ["model","reasoning","tools","fixture_sha256","timeout_seconds","max_turns"]) if (JSON.stringify(ae?.[field])!==JSON.stringify(be?.[field])) errors.push(key+" pair equivalence mismatch for "+field);
  }
  return { status: errors.length ? "blocked" : "complete", errors, evidence_sha256: compositeHash(digestParts), bindings };
}
