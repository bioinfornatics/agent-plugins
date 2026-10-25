#!/usr/bin/env node
import { readTrustedJson, readTrustedSnapshot } from "./trusted_snapshot.js";
import { AGGREGATE_HELP } from "./cli_help.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
/**
 * Aggregate individual run results into benchmark summary statistics.
 *
 * Reads grading.json files from run directories and produces:
 * - run_summary with mean, stddev, min, max for each metric
 * - delta between with_skill and without_skill configurations
 *
 * Usage:
 *   node aggregate_benchmark.js <benchmark_dir>
 *
 * The script supports two directory layouts:
 *
 *   Workspace layout (from skill-creator iterations):
 *   <benchmark_dir>/
 *   └── eval-N/
 *       ├── with_skill/
 *       │   ├── run-1/grading.json
 *       │   └── run-2/grading.json
 *       └── without_skill/
 *           ├── run-1/grading.json
 *           └── run-2/grading.json
 *
 *   Legacy layout (with runs/ subdirectory):
 *   <benchmark_dir>/
 *   └── runs/
 *       └── eval-N/
 *           ├── with_skill/
 *           │   └── run-1/grading.json
 *           └── without_skill/
 *               └── run-1/grading.json
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { parseArgs } from "node:util";
import { buildQualityConditionedEfficiency, type EfficiencyRun } from "./paired_efficiency.js";
import type { ExecutionEfficiencyTelemetry } from "./execution_efficiency.js";
import { analyzeInstructionEfficiency, snapshotRegularFile, type CampaignRunMembership } from "./instruction_efficiency.js";
import { artifactHash, expectedRunDirs, validateExecutionEvidence } from "./evaluation_provenance.js";
import { readAdaptiveState } from "./adaptive_scheduling.js";
import { assertPortableScenarioId, scenarioDirectory } from "./scenario_id.js";
import { ANYTIME_QUALITY_METHOD, ANYTIME_QUALITY_POLICY_VERSION, persistAnytimeQualityResult, readAndVerifyAnytimeQualityArtifact, type AnytimeQualityPolicy, type PairedQualityObservation } from "./anytime_quality.js";
import { durableAtomicWrite } from "./durable_file.js";

interface Stats {
  mean: number | null;
  p50: number | null;
  p95: number | null;
  sample_count: number;
  stddev: number | null;
  confidence_interval_95: { lower: number; upper: number } | null;
  statistically_valid: boolean;
  min: number | null;
  max: number | null;
  count: number;
}

interface RunResult {
  eval_id: string | number;
  run_number: number;
  pass_rate: number;
  passed: number;
  failed: number;
  total: number;
  time_seconds: number | null;
  tokens?: number | null;
  tool_calls?: number;
  errors?: number;
  expectations: unknown[];
  notes: string[];
  model: string;
  reasoning: string;
  telemetry: ExecutionEfficiencyTelemetry | null;
  quality_requirement?: { minimum_candidate_pass_rate?: number; minimum_delta?: number };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return round(sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower), 4);
}

export function calculateStats(values: number[], independentRepetitions = false): Stats {
  if (values.some(value => !Number.isFinite(value))) throw new TypeError("statistics require finite observations");
  if (!values.length) return { mean: null, p50: null, p95: null, sample_count: 0, stddev: null, confidence_interval_95: null, statistically_valid: false, min: null, max: null, count: 0 };
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  let stddev: number | null = null;
  if (n > 1) {
    const variance = values.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (n - 1);
    stddev = Math.sqrt(variance);
  }
  // Two-sided 95% Student t critical values indexed by degrees of freedom.
  const t95ByDf=[0,12.706,4.303,3.182,2.776,2.571,2.447,2.365,2.306,2.262,2.228,2.201,2.179,2.160,2.145,2.131,2.120,2.110,2.101,2.093,2.086,2.080,2.074,2.069,2.064,2.060,2.056,2.052,2.048,2.045,2.042];
  const df=n-1;
  // For df > 30, 2.042 is a documented conservative approximation (never narrower than the exact t interval).
  const t95=df<=30?t95ByDf[df]:2.042;
  const valid=independentRepetitions && n>1 && stddev!==null && stddev>0;
  const margin=!valid?null:t95*stddev!/Math.sqrt(n);
  return {
    mean: round(mean, 4),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    sample_count: n,
    stddev: stddev===null?null:round(stddev, 4),
    confidence_interval_95: margin===null?null:{lower:round(mean-margin,4),upper:round(mean+margin,4)},
    statistically_valid: valid,
    min: round(Math.min(...values), 4),
    max: round(Math.max(...values), 4),
    count: values.length,
  };
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function listSubdirs(dir: string, prefix: string): string[] {
  if (!isDir(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && isDir(join(dir, name)))
    .sort();
}

function loadRunResults(benchmarkDir: string, allowedRunDirs?: ReadonlySet<string>): Record<string, RunResult[]> {
  const runsDir = join(benchmarkDir, "runs");
  let searchDir: string;
  if (isDir(runsDir)) {
    searchDir = runsDir;
  } else if (listSubdirs(benchmarkDir, "eval-").length) {
    searchDir = benchmarkDir;
  } else {
    console.log(`No eval directories found in ${benchmarkDir} or ${runsDir}`);
    return {};
  }

  const results: Record<string, RunResult[]> = {};
  const evalDirs = listSubdirs(searchDir, "eval-");

  evalDirs.forEach((evalName, evalIdx) => {
    const evalDir = join(searchDir, evalName);
    const metadataPath = join(evalDir, "eval_metadata.json");
    let evalId: string | number = evalIdx;
    if (existsSync(metadataPath)) {
      try {
        const parsed = JSON.parse(readFileSync(metadataPath, "utf-8"));
        evalId = parsed.eval_id ?? evalIdx;
      } catch {
        evalId = evalIdx;
      }
    } else {
      const parts = evalName.split("-");
      const parsedNum = Number(parts[1]);
      evalId = Number.isFinite(parsedNum) ? parsedNum : evalIdx;
    }

    const configPriority = (name: string) =>
      name.includes("with_skill") ? 0 : name.includes("old_skill") || name.includes("without_skill") ? 1 : 2;
    const configDirs = readdirSync(evalDir)
      .filter((name) => isDir(join(evalDir, name)))
      .sort((a, b) => configPriority(a) - configPriority(b) || a.localeCompare(b));
    for (const config of configDirs) {
      const configDir = join(evalDir, config);
      let runDirs = listSubdirs(configDir, "run-");
      if (!runDirs.length && existsSync(join(configDir, "grading.json"))) {
        runDirs = ["."];
      }
      if (!runDirs.length) continue;
      results[config] = results[config] ?? [];

      runDirs.forEach((runName, runIndex) => {
        const runDir = runName === "." ? configDir : join(configDir, runName);
        if (allowedRunDirs && !allowedRunDirs.has(resolve(runDir))) return;
        const runNumber = runName.startsWith("run-")
          ? Number(runName.split("-")[1])
          : runIndex + 1;
        const gradingFile = join(runDir, "grading.json");
        if (!existsSync(gradingFile)) {
          console.log(`Warning: grading.json not found in ${runDir}`);
          return;
        }
        let grading: any;
        try {
          grading = JSON.parse(readFileSync(gradingFile, "utf-8"));
        } catch (error) {
          console.log(`Warning: Invalid JSON in ${gradingFile}: ${(error as Error).message}`);
          return;
        }

        const summary = grading.summary ?? {};
        const result: RunResult = {
          eval_id: evalId,
          run_number: runNumber,
          pass_rate: summary.inconclusive>0 || summary.unavailable>0 || typeof summary.pass_rate!=="number" || !Number.isFinite(summary.pass_rate) || summary.pass_rate<0 || summary.pass_rate>1 ? Number.NaN : summary.pass_rate,
          passed: summary.passed ?? 0,
          failed: summary.failed ?? 0,
          total: summary.total ?? 0,
          time_seconds: null,
          expectations: grading.expectations ?? [],
          notes: [],
          model: "unspecified",
          reasoning: "unspecified",
          telemetry: null,
        };

        const timing = grading.timing ?? {};
        result.time_seconds = typeof timing.total_duration_seconds === "number" ? timing.total_duration_seconds : null;
        const timingFile = join(runDir, "timing.json");
        if (existsSync(timingFile)) {
          try {
            const timingData = JSON.parse(readFileSync(timingFile, "utf-8"));
            if (result.time_seconds === null && typeof timingData.total_duration_seconds === "number") {
              result.time_seconds = timingData.total_duration_seconds;
            }
            result.tokens = typeof timingData.total_tokens === "number" ? timingData.total_tokens : null;
            const normalized = timingData.execution_efficiency;
            if (normalized?.schema_version === "1.3" && normalized?.parser_protocol === "provider-event-metadata-v4-closed-labels") result.telemetry = normalized;
          } catch {
            // ignore malformed timing.json
          }
        }

        const evidenceFile = join(runDir, "execution-evidence.json");
        let evidence: any = null;
        if (existsSync(evidenceFile)) try { evidence = JSON.parse(readFileSync(evidenceFile, "utf-8")); } catch { /* unavailable */ }
        let metadata: any = null;
        if (existsSync(metadataPath)) try { metadata = JSON.parse(readFileSync(metadataPath, "utf-8")); } catch { /* unavailable */ }
        result.model = String(evidence?.pair_equivalence?.model ?? metadata?.model ?? "unspecified");
        result.reasoning = String(evidence?.inference?.reasoning ?? metadata?.reasoning ?? metadata?.model_config?.reasoning ?? "unspecified");
        const requirement = metadata?.quality_requirement ?? metadata?.efficiency_quality;
        if (requirement && typeof requirement === "object") result.quality_requirement = {
          ...(typeof requirement.minimum_candidate_pass_rate === "number" ? { minimum_candidate_pass_rate: requirement.minimum_candidate_pass_rate } : {}),
          ...(typeof requirement.minimum_delta === "number" ? { minimum_delta: requirement.minimum_delta } : {}),
        };

        const metrics = grading.execution_metrics ?? {};
        result.tool_calls = metrics.total_tool_calls ?? 0;
        // Token counts remain unavailable unless explicitly reported by the provider.
        result.errors = metrics.errors_encountered ?? 0;

        const rawExpectations: any[] = grading.expectations ?? [];
        for (const exp of rawExpectations) {
          if (!("text" in exp) || !("passed" in exp)) {
            console.log(
              `Warning: expectation in ${gradingFile} missing required fields (text, passed, evidence): ${JSON.stringify(exp)}`
            );
          }
        }
        result.expectations = rawExpectations;

        const notesSummary = grading.user_notes_summary ?? {};
        const notes: string[] = [
          ...(notesSummary.uncertainties ?? []),
          ...(notesSummary.needs_review ?? []),
          ...(notesSummary.workarounds ?? []),
        ];
        result.notes = notes;

        results[config].push(result);
      });
    }
  });

  return results;
}

function aggregateResults(results: Record<string, RunResult[]>, declared?:{scenarios:string[];rounds:number[]}): Record<string, any> {
  const runSummary: Record<string, any> = {};
  const configs = Object.keys(results);

  for (const config of configs) {
    const runs = results[config] ?? [];
    if (!runs.length) {
      runSummary[config] = {
        pass_rate: calculateStats([]),
        time_seconds: calculateStats([]),
        tokens: calculateStats([]),
      };
      continue;
    }
    const passRates = runs.map((r) => r.pass_rate).filter(Number.isFinite);
    const times = runs.map((r) => r.time_seconds).filter((value): value is number => typeof value === "number");
    const tokens = runs.map((r) => r.tokens).filter((value): value is number => typeof value === "number");
    runSummary[config] = {
      pass_rate: calculateStats(passRates),
      time_seconds: calculateStats(times),
      tokens: calculateStats(tokens),
    };
  }

  const primaryRuns=results[configs[0]]??[],baselineRuns=results[configs[1]]??[];
  const uniqueByPair=(runs:RunResult[],configuration:string)=>{const map=new Map<string,RunResult>();for(const run of runs){const key=String(run.eval_id)+":"+run.run_number;if(map.has(key))throw new Error(`duplicate pair key ${key} in ${configuration}`);map.set(key,run);}return map;};
  const primaryByPair=uniqueByPair(primaryRuns,configs[0]??"primary"),baselineByPair=uniqueByPair(baselineRuns,configs[1]??"baseline");
  const scenarioIds=declared?.scenarios??Array.from(new Set([...primaryRuns,...baselineRuns].map(r=>String(r.eval_id)))).sort();
  const roundIds=declared?.rounds??Array.from(new Set([...primaryRuns,...baselineRuns].map(r=>r.run_number))).sort((a,b)=>a-b);
  const completeRounds=roundIds.flatMap(index=>{const values=scenarioIds.map(id=>{const a=primaryByPair.get(id+":"+index),b=baselineByPair.get(id+":"+index);return a&&b&&Number.isFinite(a.pass_rate)&&Number.isFinite(b.pass_rate)?a.pass_rate-b.pass_rate:null;});return values.length&&values.every((v):v is number=>v!==null)?[values.reduce((a,b)=>a+b,0)/values.length]:[];});
  const missing_quality=roundIds.flatMap(index=>scenarioIds.flatMap(id=>[...(!primaryByPair.has(id+":"+index)||!Number.isFinite(primaryByPair.get(id+":"+index)!.pass_rate)?[{scenario_id:id,round:index,configuration:configs[0]??"candidate"}]:[]),...(!baselineByPair.has(id+":"+index)||!Number.isFinite(baselineByPair.get(id+":"+index)!.pass_rate)?[{scenario_id:id,round:index,configuration:configs[1]??"baseline"}]:[])]));
  const allComplete=scenarioIds.length>0&&roundIds.length>0&&missing_quality.length===0;
  const pairedPass=calculateStats(completeRounds,allComplete);
  // Public summaries use the same complete fixed-suite sampling unit as the delta.
  // Incomplete quality is unavailable, not an observed-prefix or marginal winner.
  for(const [configuration,byPair] of [[configs[0],primaryByPair],[configs[1],baselineByPair]] as const){if(!configuration)continue;const values=allComplete?roundIds.map(index=>scenarioIds.reduce((sum,id)=>sum+byPair.get(id+":"+index)!.pass_rate,0)/scenarioIds.length):[];runSummary[configuration].pass_rate=calculateStats(values);}
  const sampling={unit:"complete-fixed-suite-repetition",scenario_weights:scenarioIds.map(id=>({scenario_id:id,weight:1/scenarioIds.length})),planned_rounds:roundIds.length,complete_rounds:completeRounds.length,missing_quality,complete:allComplete,assumptions:"Fixed equally weighted suite; independent stable repetitions and approximate normality of round effects are assumed, not established by sample count. Degenerate empirical variance cannot establish stochastic stability. Missing rounds prevent inference; no source-population generalization."};
  const roundMetric=(metric:"time_seconds"|"tokens")=>{const observations=roundIds.flatMap(index=>{const values=scenarioIds.map(id=>{const a=primaryByPair.get(id+":"+index),b=baselineByPair.get(id+":"+index);return a&&b&&typeof a[metric]==="number"&&typeof b[metric]==="number"&&Number.isFinite(a[metric])&&Number.isFinite(b[metric])?a[metric]!-b[metric]!:null;});return values.length&&values.every((v):v is number=>v!==null)?[values.reduce((a,b)=>a+b,0)/values.length]:[];});return calculateStats(observations,allComplete&&observations.length===roundIds.length);};
  const pairedTime=roundMetric("time_seconds"),pairedTokens=roundMetric("tokens");
  runSummary.delta = {
    pass_rate: !allComplete||pairedPass.mean===null?null:`${pairedPass.mean >= 0 ? "+" : ""}${pairedPass.mean.toFixed(2)}`,
    time_seconds: pairedTime.count!==roundIds.length||pairedTime.mean===null ? null : `${pairedTime.mean >= 0 ? "+" : ""}${pairedTime.mean.toFixed(1)}`,
    tokens: pairedTokens.count!==roundIds.length||pairedTokens.mean===null ? null : `${pairedTokens.mean >= 0 ? "+" : ""}${pairedTokens.mean.toFixed(0)}`,
    sampling,paired:{pass_rate:pairedPass,time_seconds:pairedTime,tokens:pairedTokens},
    resource_missingness:{time_seconds:{planned_rounds:roundIds.length,complete_rounds:pairedTime.count,excluded_rounds:roundIds.length-pairedTime.count},tokens:{planned_rounds:roundIds.length,complete_rounds:pairedTokens.count,excluded_rounds:roundIds.length-pairedTokens.count}},
    stable_improvement:completeRounds.length===roundIds.length&&pairedPass.statistically_valid&&pairedPass.confidence_interval_95!==null&&pairedPass.confidence_interval_95.lower>0,
    stable_improvement_reason:!allComplete?"Missing quality or incomplete fixed-suite repetitions prevent inference":completeRounds.length<2?"at least two complete independent repetitions are required; one stochastic run cannot establish stable improvement":!pairedPass.statistically_valid?"Degenerate round effects cannot establish stochastic stability; independent stable repetitions and approximate normality remain assumptions":"95% fixed-suite round-effect Student-t interval must be wholly above zero under declared assumptions",
  };

  return runSummary;
}

export type DecisionPolicyMode = "fixed" | "adaptive";
function persistAdaptiveDecision(benchmarkDir:string,results:Record<string,RunResult[]>,candidateConfig:string,baselineConfig:string):string {
 const scheduledState=join(benchmarkDir,".adaptive-scheduling.json");if(existsSync(scheduledState)){const allRuns=expectedRunDirs(benchmarkDir,true),metadata=allRuns.map(run=>JSON.parse(readFileSync(join(resolve(run,"../.."),["eval_metadata","json"].join(".")),"utf8"))),policy=metadata[0]?.anytime_quality_policy;if(!policy)throw new TypeError("adaptive scheduling state has no predeclared policy");const state=readAdaptiveState(scheduledState,policy,benchmarkDir,allRuns),path=join(benchmarkDir,["anytime-quality-decision","json"].join("."));persistAnytimeQualityResult(path,state.policy,state.observations);return path;}
 const validated=validateExecutionEvidence(benchmarkDir);if(validated.status!=="complete")throw new TypeError("adaptive decision policy requires completed validated pairs: "+validated.errors.join("; "));
 const scenarioIds=Array.from(new Set(Object.values(results).flat().map(row=>String(row.eval_id)))).sort();if(!scenarioIds.length)throw new TypeError("adaptive decision policy requires at least one completed scenario");
 const candidate=new Map((results[candidateConfig]??[]).map(row=>[String(row.eval_id)+"\0"+row.run_number,row])),baseline=new Map((results[baselineConfig]??[]).map(row=>[String(row.eval_id)+"\0"+row.run_number,row]));
 const observations:PairedQualityObservation[]=[];let maxPairs=0;for(const scenario_id of scenarioIds){const indexes=Array.from(new Set((results[candidateConfig]??[]).filter(row=>String(row.eval_id)===scenario_id).map(row=>row.run_number))).sort((a,b)=>a-b);for(const pair_index of indexes){const a=candidate.get(scenario_id+"\0"+pair_index),b=baseline.get(scenario_id+"\0"+pair_index);if(!a||!b)continue;observations.push({scenario_id,pair_index,candidate:a.pass_rate,baseline:b.pass_rate});maxPairs=Math.max(maxPairs,pair_index)}}
 if(!observations.length||maxPairs<1)throw new TypeError("adaptive decision policy requires paired candidate and baseline grades");const weight=1/scenarioIds.length;
 const policy:AnytimeQualityPolicy={schema_version:"2.0",method:ANYTIME_QUALITY_METHOD,estimand:"fixed-weight-mean-paired-quality-effect",assumptions:{round_data_generating_process:"stable-independent-rounds",completion_missingness:"all-admitted-rounds-complete-no-skip",retry_target:"terminal-attempt-policy",informative_missingness_scope:"no-source-population-generalization"},comparison_family:{family_id:"default",global_alpha:.05,planned_comparisons:1,comparison_ids:["candidate-vs-baseline"],allocation_weights:[1],comparison_id:"candidate-vs-baseline",comparison_index:1},min_pairs:Math.min(3,maxPairs),max_pairs:maxPairs,alpha:.05,quality_bounds:{min:0,max:1},practical_superiority_delta:0,regression_tolerance:0,multiplicity:{winner_fraction:.5,regression_fraction:.5},scenarios:scenarioIds.map(id=>({id,weight})),futility:{enabled:false,minimum_pairs:Math.min(3,maxPairs),equivalence_lower:0,equivalence_upper:0,at_max:"futility-if-contained"}};
 const path=join(benchmarkDir,["anytime-quality-decision","json"].join("."));persistAnytimeQualityResult(path,policy,observations);return path;
}

const EVAL_METADATA_FILE=["eval_metadata","json"].join(".");
function aggregationPlanHashes(benchmarkDir:string):{skill_source_sha256:string;eval_plan_sha256:string}{
  const runs=expectedRunDirs(benchmarkDir,true);
  if(!runs.length)throw new TypeError("aggregation requires a non-empty current execution plan");
  const bindings=runs.map(run=>JSON.parse(readFileSync(join(resolve(run,"../.."),EVAL_METADATA_FILE),"utf8"))?.execution_binding);
  const sources=new Set(bindings.map(value=>String(value?.skill_source_sha256??""))),plans=new Set(bindings.map(value=>String(value?.eval_plan_sha256??"")));
  if(sources.size!==1||plans.size!==1||![...sources][0]||![...plans][0])throw new TypeError("aggregation requires one current source/eval hash binding");
  return{skill_source_sha256:[...sources][0],eval_plan_sha256:[...plans][0]};
}

function generateBenchmark(benchmarkDir: string, skillName: string, skillPath: string, decisionPolicy:DecisionPolicyMode="fixed") {
  const jobPath=join(benchmarkDir,".full-eval-job.json");let job:any=null;if(existsSync(jobPath)){const snap=snapshotRegularFile(jobPath,benchmarkDir,8*1024*1024);try{job=JSON.parse(snap.bytes.toString("utf8"));}catch{throw new TypeError("full-eval job is invalid");}if(job.schema_version!=="2.0")throw new TypeError("unsupported full-eval job version");const legacy=!Object.hasOwn(job,"decision_policy");if(legacy&&decisionPolicy==="fixed")throw new TypeError("historical fixed job requires migrate-evaluation before aggregation; write a new --output rather than mutating archival benchmark bytes");if(job.decision_policy!==decisionPolicy)throw new TypeError("decision-policy mode disagrees with trusted full-eval job");}
  if(decisionPolicy==="adaptive"&&!job)throw new TypeError("adaptive aggregation requires trusted .full-eval-job.json campaign authority");
  const declaredModes=new Set(readdirSync(benchmarkDir).filter(name=>name.startsWith("eval-")).flatMap(name=>{try{const mode=JSON.parse(readFileSync(join(benchmarkDir,name,EVAL_METADATA_FILE),"utf8"))?.decision_policy;return mode?[mode]:[];}catch{return[];}}));
  if(declaredModes.size>1)throw new TypeError("evaluation metadata contains mixed decision-policy modes");
  const declaredMode=[...declaredModes][0];if(declaredMode&&declaredMode!==decisionPolicy)throw new TypeError("decision-policy mode is immutably bound by evaluation metadata");
  // Adaptive aggregation is a strict consumption boundary: validate every counted
  // run before reading grading or adaptive state. Fixed legacy aggregation is unchanged.
  const expected=decisionPolicy==="adaptive" || job?.decision_policy==="fixed" ? aggregationPlanHashes(benchmarkDir):null;
  const validatedBefore=expected?validateExecutionEvidence(benchmarkDir,expected):null;
  if(validatedBefore?.status==="blocked")throw new TypeError("aggregation requires completed validated execution and grading evidence: "+validatedBefore.errors.join("; "));
  const bindingKeys=validatedBefore?new Set(validatedBefore.bindings.map(binding=>String(binding.scenario_sha256)+"\0"+binding.configuration+"\0"+binding.run_index)):null;
  const plannedRuns=bindingKeys?expectedRunDirs(benchmarkDir,true).filter(run=>{const metadata=JSON.parse(readFileSync(join(resolve(run,"../.."),EVAL_METADATA_FILE),"utf8"));const coordinates=/run-(\d+)$/.exec(run);return bindingKeys.has(String(metadata.execution_binding.scenario_sha256)+"\0"+basename(resolve(run,".."))+"\0"+Number(coordinates?.[1]));}):null;
  const results = loadRunResults(benchmarkDir,plannedRuns?new Set(plannedRuns.map(run=>resolve(run))):undefined);
  if(expected){const validatedAfter=validateExecutionEvidence(benchmarkDir,expected);if(validatedAfter.status!=="complete"||validatedAfter.evidence_sha256!==validatedBefore!.evidence_sha256)throw new TypeError("aggregation evidence changed while inputs were being recomputed: "+validatedAfter.errors.join("; "));}
  const fixedPlan=decisionPolicy==="fixed"?(()=>{const metadata=readdirSync(benchmarkDir).filter(name=>name.startsWith("eval-")).flatMap(name=>{const path=join(benchmarkDir,name,EVAL_METADATA_FILE);if(!existsSync(path))return [];const value=JSON.parse(readTrustedSnapshot(benchmarkDir,path,"fixed sampling metadata",{maxBytes:1024*1024}).bytes.toString("utf8"));return Number.isSafeInteger(value.requested_pairs)&&value.requested_pairs>0?[{id:String(value.eval_id??name.slice(5)),pairs:value.requested_pairs}]:[];});if(!metadata.length)return undefined;const counts=new Set(metadata.map(m=>m.pairs));if(counts.size!==1||metadata[0].pairs>1024)throw new TypeError("Fixed suite must declare one bounded repetition count");return {scenarios:metadata.map(m=>m.id).sort(),rounds:Array.from({length:metadata[0].pairs},(_,i)=>i+1)};})():undefined;
  const runSummary = aggregateResults(results,fixedPlan);

  const configs = Object.keys(results);
  const candidateConfig = configs.find(name => /with_skill|new_skill|candidate/i.test(name)) ?? configs[0] ?? "candidate";
  const baselineConfig = configs.find(name => /without_skill|old_skill|baseline/i.test(name)) ?? configs.find(name => name !== candidateConfig) ?? "baseline";
  let sequentialDecision:any=null;
  if(decisionPolicy==="adaptive"){
    const decisionPath=persistAdaptiveDecision(benchmarkDir,results,candidateConfig,baselineConfig),artifact=readAndVerifyAnytimeQualityArtifact(decisionPath),statePath=join(benchmarkDir,".adaptive-scheduling.json"),state=existsSync(statePath)?JSON.parse(readFileSync(statePath,"utf8")):null,last=artifact.result.looks.at(-1)??null;
    sequentialDecision={mode:"adaptive",method:artifact.result.method,method_version:ANYTIME_QUALITY_POLICY_VERSION,policy_hash:artifact.result.policy_hash,decision:artifact.result.decision,terminal:artifact.result.terminal,stop_reason:artifact.result.terminal?artifact.result.decision:null,looks:artifact.result.looks,sample_count:artifact.result.complete_pairs,confidence_sequence:last?.confidence_sequence??null,practical_superiority_delta:artifact.result.policy.practical_superiority_delta,regression_tolerance:artifact.result.policy.regression_tolerance,estimand:artifact.result.policy.estimand,assumptions:artifact.result.policy.assumptions,comparison_family:artifact.result.policy.comparison_family,scenario_weights:artifact.result.policy.scenarios,multiplicity_allocation:artifact.result.policy.multiplicity,counted_membership:state?.counted_pairs??[],superseded_count:Array.isArray(state?.superseded_unstarted_tasks)?state.superseded_unstarted_tasks.length:0,artifact:"anytime-quality-decision.json"};
  }
  const efficiencyRuns: EfficiencyRun[] = Object.entries(results).flatMap(([configuration, items]) => items.map(result => ({scenario_id:String(result.eval_id),configuration,run_number:result.run_number,pass_rate:result.pass_rate,model:result.model,reasoning:result.reasoning,telemetry:result.telemetry,quality_requirement:result.quality_requirement})));
  if(fixedPlan)for(const id of fixedPlan.scenarios)for(const index of fixedPlan.rounds)for(const configuration of [candidateConfig,baselineConfig])if(!efficiencyRuns.some(row=>row.scenario_id===id&&row.run_number===index&&row.configuration===configuration)){const peer=efficiencyRuns.find(row=>row.scenario_id===id&&row.run_number===index);efficiencyRuns.push({scenario_id:id,configuration,run_number:index,pass_rate:Number.NaN,model:peer?.model??"unspecified",reasoning:peer?.reasoning??"unspecified",telemetry:null});}
  const qualityConditionedEfficiency = buildQualityConditionedEfficiency(efficiencyRuns,candidateConfig,baselineConfig);
  const instructionEvidencePath=join(benchmarkDir,"instruction-efficiency-evidence.json"),instructionEvidence=existsSync(instructionEvidencePath)?(()=>{try{return JSON.parse(snapshotRegularFile(instructionEvidencePath,benchmarkDir,8*1024*1024).bytes.toString("utf8"));}catch{return null;}})():null;
  const campaignId=String(instructionEvidence?.campaign_id??basename(resolve(benchmarkDir))),completedAt=String(instructionEvidence?.completed_at??"unavailable"),scenarioId=instructionEvidence?.scenario_id===undefined?"":assertPortableScenarioId(instructionEvidence.scenario_id);
  let metadata:any=null;try{metadata=JSON.parse(snapshotRegularFile(join(scenarioDirectory(benchmarkDir,scenarioId),"eval_"+["metadata","json"].join(".")),benchmarkDir,8*1024*1024).bytes.toString("utf8"));}catch{}
  const skillSourceSha256=expected?.skill_source_sha256??String(metadata?.execution_binding?.skill_source_sha256??""),evalPlanSha256=expected?.eval_plan_sha256??String(metadata?.execution_binding?.eval_plan_sha256??"");
  const validated=validatedBefore??validateExecutionEvidence(benchmarkDir,{skill_source_sha256:skillSourceSha256,eval_plan_sha256:evalPlanSha256});
  const aggregateMembership:CampaignRunMembership[]=validated.status==="complete"?validated.bindings.filter(binding=>binding.scenario_sha256===metadata?.execution_binding?.scenario_sha256).map(binding=>{const artifactRoot="eval-"+scenarioId+"/"+binding.configuration+"/run-"+binding.run_index,manifest=snapshotRegularFile(join(benchmarkDir,artifactRoot,["execution-evidence","json"].join(".")),benchmarkDir,8*1024*1024);return{artifact_root:artifactRoot,scenario_id:scenarioId,scenario_sha256:binding.scenario_sha256,configuration:binding.configuration,run_index:binding.run_index,pair_index:Number(binding.pair_index),model:String(binding.pair_equivalence?.model??metadata?.model??""),reasoning:String(metadata?.reasoning??metadata?.model_config?.reasoning??"unspecified"),manifest_sha256:manifest.sha256,aggregate_evidence_sha256:validated.evidence_sha256};}):[];
  const currentCampaign={campaign_id:campaignId,completed_at:completedAt,scenario_id:scenarioId,model:String(metadata?.model??instructionEvidence?.model??""),reasoning:String(metadata?.reasoning??metadata?.model_config?.reasoning??instructionEvidence?.reasoning??""),candidate_configuration:candidateConfig,baseline_configuration:baselineConfig,skill_source_sha256:skillSourceSha256,eval_plan_sha256:evalPlanSha256,execution_evidence_sha256:validated.evidence_sha256,aggregate_membership:aggregateMembership,quality_conditioned_efficiency:qualityConditionedEfficiency};
  const instructionEfficiency=analyzeInstructionEfficiency({workspace_root:benchmarkDir,skill_root:skillPath||undefined,current_campaign:currentCampaign,observations:Array.isArray(instructionEvidence?.observations)?instructionEvidence.observations:[],confirmation_campaigns:Array.isArray(instructionEvidence?.confirmation_campaigns)?instructionEvidence.confirmation_campaigns:[]});
  const runs: any[] = [];
  for (const config of Object.keys(results).sort()) {
    for (const result of results[config]) {
      runs.push({
        eval_id: result.eval_id,
        configuration: config,
        run_number: result.run_number,
        result: {
          pass_rate: result.pass_rate,
          passed: result.passed,
          failed: result.failed,
          total: result.total,
          time_seconds: result.time_seconds,
          tokens: result.tokens ?? null,
          tool_calls: result.tool_calls ?? 0,
          errors: result.errors ?? 0,
        },
        expectations: result.expectations,
        notes: result.notes,
      });
    }
  }

  const evalIds = Array.from(
    new Set(Object.values(results).flat().map((r) => r.eval_id))
  ).sort((a, b) => String(a).localeCompare(String(b)));

  return {
    metadata: {
      skill_name: skillName || "<skill-name>",
      skill_path: skillPath || "<path/to/skill>",
      executor_model: "<model-name>",
      analyzer_model: "<model-name>",
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      evals_run: evalIds,
      decision_policy: decisionPolicy,
      initial_policy_hash: job?.initial_policy_hash??null,
      family_manifest_hash: job?.family_manifest_hash??null, comparison_claim:job?.comparison_claim??null, sampling_protocol_hash:job?.sampling_protocol_hash??null, family_conclusion:job?.family_conclusion??null,
      runs_per_configuration: Object.fromEntries(Object.entries(results).map(([name, runs]) => [name, runs.length])),
    },
    campaign: {
      campaign_id: currentCampaign.campaign_id, completed_at: currentCampaign.completed_at, scenario_id: currentCampaign.scenario_id, model: currentCampaign.model, reasoning: currentCampaign.reasoning,
      candidate_configuration: currentCampaign.candidate_configuration, baseline_configuration: currentCampaign.baseline_configuration, skill_source_sha256: currentCampaign.skill_source_sha256,
      eval_plan_sha256: currentCampaign.eval_plan_sha256, decision_policy:decisionPolicy, initial_policy_hash:job?.initial_policy_hash??null, family_manifest_hash:job?.family_manifest_hash??null, comparison_claim:job?.comparison_claim??null, sampling_protocol_hash:job?.sampling_protocol_hash??null, execution_evidence_sha256: currentCampaign.execution_evidence_sha256, aggregate_membership: currentCampaign.aggregate_membership,
    },
    runs,
    run_summary: runSummary,
    decision_evidence: sequentialDecision??{mode:"fixed",method:"student-t-95-complete-fixed-suite-repetitions",method_version:"2.0",policy_hash:null,decision:runSummary.delta?.stable_improvement?"winner":"inconclusive",terminal:runSummary.delta.sampling.complete,stop_reason:runSummary.delta.sampling.complete?"fixed-suite-repetitions-complete":"fixed-suite-incomplete",sampling:runSummary.delta.sampling,assumptions:runSummary.delta.sampling.assumptions,looks:[],sample_count:runSummary.delta?.paired?.pass_rate?.count??0,confidence_sequence:null,practical_superiority_delta:null,regression_tolerance:null,scenario_weights:runSummary.delta.sampling.scenario_weights,multiplicity_allocation:null,counted_membership:[],superseded_count:0},
    quality_conditioned_efficiency: qualityConditionedEfficiency,
    instruction_efficiency_analysis: instructionEfficiency,
    notes: [] as string[],
  };
}

export interface FixedWorkspaceVerification {
  independently_recomputed: boolean;
  historical: boolean;
  errors: string[];
  decision: any;
  run_summary: any;
}

/** Read-only projection verification. Local hashes are not external authentication
 * or proof of independent repetitions. Archives stay readable, never release eligible.
 */
export function verifyFixedWorkspace(workspace: string, benchmark: any): FixedWorkspaceVerification {
  const result: FixedWorkspaceVerification = {independently_recomputed:false,historical:false,errors:[],decision:null,run_summary:null};
  try {
    const jobPath=join(workspace,".full-eval-job.json");
    if (!existsSync(jobPath)) { result.historical=true; return result; }
    const job:any=readTrustedJson(workspace,jobPath,"fixed campaign authority");
    if (existsSync(join(workspace,".full-eval-migration-receipt.json"))) { result.historical=true; return result; }
    if (!Object.hasOwn(job,"decision_policy")) { result.historical=true; return result; }
    if (job.decision_policy!=="fixed") { result.errors.push("trusted campaign is not fixed"); return result; }
    // Verify actual evidence before consuming grades for any derived claim.
    const plan=aggregationPlanHashes(workspace), before=validateExecutionEvidence(workspace,plan);
    if (before.status!=="complete" || !before.bindings.length) {
      result.errors.push(...before.errors,"fixed derivation requires nonempty verified planned runs"); return result;
    }
    if (!job.eval_set || artifactHash(job.eval_set)!==plan.eval_plan_sha256) {
      result.errors.push("fixed eval-plan hash does not match current declared eval set"); return result;
    }
    const evalSet=JSON.parse(readFileSync(job.eval_set,"utf8"));
    const scenarios=Array.isArray(evalSet)?evalSet:evalSet.evals;
    const declaredIds=(scenarios??[]).map((item:any,index:number)=>String(item.id??index+1)).sort();
    const plannedIds=Array.from(new Set(expectedRunDirs(workspace,true).map(run=>String(JSON.parse(readTrustedSnapshot(workspace,join(resolve(run,"../.."),EVAL_METADATA_FILE),"fixed membership metadata").bytes.toString("utf8")).eval_id)))).sort();
    if (!declaredIds.length || new Set(declaredIds).size!==declaredIds.length || JSON.stringify(declaredIds)!==JSON.stringify(plannedIds)) {
      result.errors.push("fixed declared scenario membership does not match the current eval set"); return result;
    }
    const configs=new Set(expectedRunDirs(workspace,true).map(run=>basename(resolve(run,".."))));
    if (configs.size!==2 || !configs.has("with_skill") || !configs.has(job.baseline)) {
      result.errors.push("fixed configuration membership does not match trusted campaign baseline"); return result;
    }
    const derived=generateBenchmark(workspace,benchmark?.metadata?.skill_name??"",job.skill??"","fixed");
    const after=validateExecutionEvidence(workspace,plan);
    if (artifactHash(job.eval_set)!==plan.eval_plan_sha256) { result.errors.push("fixed eval set changed during derivation"); return result; }
    if (after.status!=="complete" || after.evidence_sha256!==before.evidence_sha256) {
      result.errors.push(...after.errors,"fixed evidence changed during derivation"); return result;
    }
    const normalize=(value:any):any=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
    const equal=(a:any,b:any):boolean=>{
      if(a===b)return true;
      if(!a||!b||typeof a!=="object"||typeof b!=="object"||Array.isArray(a)!==Array.isArray(b))return false;
      const keys=Object.keys(a).sort(),other=Object.keys(b).sort();
      return JSON.stringify(keys)===JSON.stringify(other)&&keys.every(key=>equal(a[key],b[key]));
    };
    const compare=(label:string,actual:any,wanted:any)=>{if(!equal(normalize(actual),normalize(wanted)))result.errors.push(label+" is not independently derived from verified planned runs");};
    compare("run_summary",benchmark?.run_summary,derived.run_summary);
    compare("decision_evidence",benchmark?.decision_evidence,derived.decision_evidence);
    compare("runs membership and observations",benchmark?.runs,derived.runs);
    compare("metadata.evals_run",benchmark?.metadata?.evals_run,derived.metadata.evals_run);
    compare("metadata.runs_per_configuration",benchmark?.metadata?.runs_per_configuration,derived.metadata.runs_per_configuration);
    compare("metadata.decision_policy",benchmark?.metadata?.decision_policy,"fixed");
    for(const field of ["initial_policy_hash","family_manifest_hash","comparison_claim","sampling_protocol_hash","family_conclusion"]) compare("metadata."+field,benchmark?.metadata?.[field],(derived.metadata as any)[field]);
    for (const field of ["scenario_id","model","reasoning","candidate_configuration","baseline_configuration","decision_policy","initial_policy_hash","family_manifest_hash","comparison_claim","sampling_protocol_hash","execution_evidence_sha256","aggregate_membership"]) compare("campaign."+field,benchmark?.campaign?.[field],(derived.campaign as any)[field]);
    compare("quality_conditioned_efficiency",benchmark?.quality_conditioned_efficiency,derived.quality_conditioned_efficiency);
    compare("instruction_efficiency_analysis",benchmark?.instruction_efficiency_analysis,derived.instruction_efficiency_analysis);
    if (benchmark?.campaign?.skill_source_sha256!==plan.skill_source_sha256 || benchmark?.campaign?.eval_plan_sha256!==plan.eval_plan_sha256) result.errors.push("fixed campaign source/eval provenance does not match verified planned runs");
    if (benchmark?.metadata?.source_sha256!==plan.skill_source_sha256 || benchmark?.metadata?.eval_plan_sha256!==plan.eval_plan_sha256 || benchmark?.metadata?.execution_evidence_sha256!==before.evidence_sha256) result.errors.push("fixed benchmark provenance does not match verified planned runs");
    result.independently_recomputed=true;
    result.decision=derived.decision_evidence;
    result.run_summary=derived.run_summary;
  } catch(error) { result.errors.push((error as Error).message); }
  return result;
}

function generateMarkdown(benchmark: any): string {
  const metadata = benchmark.metadata;
  const runSummary = benchmark.run_summary;
  const configs = Object.keys(runSummary).filter((k) => k !== "delta");
  const configA = configs[0] ?? "config_a";
  const configB = configs[1] ?? "config_b";
  const titleCase = (s: string) =>
    s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const lines: string[] = [
    `# Skill Benchmark: ${metadata.skill_name}`,
    "",
    `**Model**: ${metadata.executor_model}`,
    `**Date**: ${metadata.timestamp}`,
    `**Evals**: ${metadata.evals_run.join(", ")} (runs per configuration: ${JSON.stringify(metadata.runs_per_configuration)})`,
    "",
    "## Summary",
    "",
    `| Metric | ${titleCase(configA)} | ${titleCase(configB)} | Delta |`,
    "|--------|------------|---------------|-------|",
  ];

  const aSummary = runSummary[configA] ?? {};
  const bSummary = runSummary[configB] ?? {};
  const delta = runSummary.delta ?? {};

  const aPr = aSummary.pass_rate ?? {};
  const bPr = bSummary.pass_rate ?? {};
  lines.push(
    `| Pass Rate | ${aPr.mean===null?"n/a":(aPr.mean * 100).toFixed(0)+"%"} ± ${aPr.stddev===null?"n/a":(aPr.stddev * 100).toFixed(0)+"%"} | ${bPr.mean===null?"n/a":(bPr.mean * 100).toFixed(0)+"%"} ± ${bPr.stddev===null?"n/a":(bPr.stddev * 100).toFixed(0)+"%"} | ${delta.pass_rate ?? "—"} |`
  );

  const aTime = aSummary.time_seconds ?? {};
  const bTime = bSummary.time_seconds ?? {};
  const formatMetric = (value: number | null | undefined, digits = 0) =>
    value === null || value === undefined ? "n/a" : value.toFixed(digits);
  lines.push(
    `| Time | ${aTime.mean==null?"n/a":formatMetric(aTime.mean, 1)+"s"} ± ${aTime.stddev==null?"n/a":formatMetric(aTime.stddev, 1)+"s"} | ${bTime.mean==null?"n/a":formatMetric(bTime.mean, 1)+"s"} ± ${bTime.stddev==null?"n/a":formatMetric(bTime.stddev, 1)+"s"} | ${delta.time_seconds ?? "—"} |`
  );

  const aTokens = aSummary.tokens ?? {};
  const bTokens = bSummary.tokens ?? {};
  lines.push(
    `| Tokens | ${formatMetric(aTokens.mean)} ± ${formatMetric(aTokens.stddev)} | ${formatMetric(bTokens.mean)} ± ${formatMetric(bTokens.stddev)} | ${delta.tokens ?? "—"} |`
  );

  const sequential=benchmark.decision_evidence;
  if(sequential){const cs=sequential.confidence_sequence;lines.push("", "## Decision evidence", "", `- Mode / method / version: **${sequential.mode} / ${sequential.method} / ${sequential.method_version}**`, `- Decision / stop reason: **${sequential.decision} / ${sequential.stop_reason??"not stopped"}**`, `- Policy hash: ${sequential.policy_hash??"not applicable"}`, `- Looks / counted pairs / superseded runs: ${sequential.looks.length} / ${sequential.sample_count} / ${sequential.superseded_count}`, `- Confidence-sequence bounds: ${cs?`${cs.lower} to ${cs.upper} (${cs.confidence})`:"not applicable; fixed-sample interval only"}`, `- Practical delta / regression tolerance: ${sequential.practical_superiority_delta??"not applicable"} / ${sequential.regression_tolerance??"not applicable"}`, `- Estimand: ${sequential.estimand??"fixed-sample; not applicable"}`, `- Assumptions / missingness scope: ${JSON.stringify(sequential.assumptions??null)}`, `- Comparison family: ${JSON.stringify(sequential.comparison_family??null)}`, `- Scenario weights: ${JSON.stringify(sequential.scenario_weights)}`, `- Within-comparison tail allocation: ${JSON.stringify(sequential.multiplicity_allocation)}`, `- Counted membership: ${JSON.stringify(sequential.counted_membership)}`);}

  const decision=benchmark.decision_evidence;
  if(decision?.mode==="fixed")lines.push("", "## Fixed-suite statistical interpretation", "", "Method: "+decision.method+" v"+decision.method_version+". Sampling unit: "+decision.sampling.unit+". Complete repetitions: "+decision.sampling.complete_rounds+" / "+decision.sampling.planned_rounds+".", "", decision.assumptions, "", "Conclusion: **"+decision.decision+"** — "+delta.stable_improvement_reason, "", "Missing quality cells: "+decision.sampling.missing_quality.length+". Resource and quality summaries are descriptive; no causal attribution is established.");
  const efficiency = benchmark.quality_conditioned_efficiency;
  if (efficiency?.strata?.length) {
    lines.push("", "## Quality-conditioned paired efficiency", "", "Resource delta is candidate minus baseline; negative means lower candidate usage. Skill context overhead is disclosed separately and is unavailable unless telemetry attributes it explicitly.", "", "| Scenario | Model | Reasoning | Pairs | Quality delta p50/p95 | Verdict |", "|---|---|---|---:|---:|---|");
    for (const stratum of efficiency.strata) lines.push("| "+stratum.scenario_id+" | "+stratum.model+" | "+stratum.reasoning+" | "+stratum.pair_sample_count+" | "+formatMetric(stratum.quality.delta.p50,4)+" / "+formatMetric(stratum.quality.delta.p95,4)+" | "+stratum.verdict+" |");
    for (const stratum of efficiency.strata) {
      lines.push("", "### "+stratum.scenario_id+" · "+stratum.model+" · "+stratum.reasoning, "", stratum.explanation, "", "- Skill context overhead: **"+stratum.skill_context_overhead.availability+"** — "+stratum.skill_context_overhead.reason, "- Downstream execution savings: **"+stratum.downstream_execution_savings.availability+"** — "+stratum.downstream_execution_savings.reason+" ("+stratum.downstream_execution_savings.attribution+"; rule: "+stratum.downstream_execution_savings.rule+")", "- Quality exclusions: **"+stratum.quality.availability.excluded_pair_count+"**"+(stratum.quality.availability.reasons.length?" — "+stratum.quality.availability.reasons.join("; "):" — none"), "", "| Metric (taxonomy; unit) | Candidate p50/p95 (n) | Baseline p50/p95 (n) | Delta p50/p95 (n) | Availability, exclusions, and taxonomy boundary |", "|---|---:|---:|---:|---|");
      for (const metric of stratum.metrics) lines.push("| "+metric.id+" ("+metric.taxonomy.category+"; "+metric.unit+")"+" | "+formatMetric(metric.candidate.p50,4)+" / "+formatMetric(metric.candidate.p95,4)+" ("+metric.candidate.sample_count+") | "+formatMetric(metric.baseline.p50,4)+" / "+formatMetric(metric.baseline.p95,4)+" ("+metric.baseline.sample_count+") | "+formatMetric(metric.delta.p50,4)+" / "+formatMetric(metric.delta.p95,4)+" ("+metric.delta.sample_count+") | "+(metric.availability.available ? "observed" : "unavailable")+"; excluded "+metric.availability.excluded_pair_count+(metric.availability.reasons.length?" — "+metric.availability.reasons.join("; "):" — none")+"; downstream savings eligible: "+metric.taxonomy.downstream_savings_eligible+"; "+metric.taxonomy.boundary+" |");
    }
  }

  if (benchmark.notes?.length) {
    lines.push("", "## Notes", "");
    for (const note of benchmark.notes) lines.push(`- ${note}`);
  }

  return lines.join("\n");
}

function main(): number {
  try {
    if(process.argv.slice(2).some(value=>value==="--help"||value==="-h")){console.log(AGGREGATE_HELP);return 0;}
    const { positionals, values } = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        "skill-name": { type: "string", default: "" },
        "skill-path": { type: "string", default: "" },
        output: { type: "string", short: "o" },
        "decision-policy": { type: "string", default: "fixed" },
      },
    });

    const [benchmarkDirArg] = positionals;
    const decisionPolicy=values["decision-policy"] as DecisionPolicyMode;
    if(decisionPolicy!=="fixed"&&decisionPolicy!=="adaptive")throw new TypeError("--decision-policy must be fixed or adaptive");
    if (!benchmarkDirArg) throw new TypeError("benchmark directory is required");
    if (!existsSync(benchmarkDirArg)) {
      console.log(`Directory not found: ${benchmarkDirArg}`);
      return 1;
    }

    const benchmark = generateBenchmark(
      benchmarkDirArg,
      values["skill-name"] as string,
      values["skill-path"] as string,
      decisionPolicy
    );

    const migratedArchive=existsSync(join(benchmarkDirArg,".full-eval-migration-receipt.json"));
    if(migratedArchive&&!values.output)throw new TypeError("migrated historical workspaces require explicit --output; archived benchmark/review/receipt bytes are immutable");
    const outputJson = (values.output as string) || join(benchmarkDirArg, "benchmark.json");
    const outputMd = outputJson.replace(/\.json$/, ".md");

    durableAtomicWrite(outputJson, JSON.stringify(benchmark, null, 2));
    console.log(`Generated: ${outputJson}`);

    const markdown = generateMarkdown(benchmark);
    durableAtomicWrite(outputMd, markdown);
    console.log(`Generated: ${outputMd}`);

    const runSummary = benchmark.run_summary;
    const configs = Object.keys(runSummary).filter((k) => k !== "delta");
    const delta = runSummary.delta ?? {};

    console.log("\nSummary:");
    for (const config of configs) {
      const pr = runSummary[config].pass_rate.mean;
      const label = config.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      console.log(`  ${label}: ${typeof pr === "number" && Number.isFinite(pr) ? (pr * 100).toFixed(1)+"%" : "n/a"} pass rate`);
    }
    console.log(`  Delta:         ${delta.pass_rate ?? "—"}`);
    return 0;
  } catch (error) {
    console.error(`aggregate_benchmark: ${(error as Error).message}`);
    return 2;
  }
}

export { main };
if (!import.meta.url.includes("/$bunfs/") && process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exitCode=main();