#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { auditSkill, type PatternDecision } from "./audit_skill.js";

interface Failure { eval: string; configuration: string; assertion: string; evidence: string; category: string; recommended_patterns: string[]; }
interface NavigationFinding { eval: string; configuration: string; status: "pass" | "warning" | "unavailable"; message: string; }
function isDir(path: string): boolean { try { return statSync(path).isDirectory(); } catch { return false; } }
function json(path: string): any | null { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } }
function categorize(text: string): { category: string; patterns: string[] } {
  const value = text.toLowerCase();
  if (/trigger|activate|route|select|description/.test(value)) return { category: "selection", patterns: ["effective-description", "contrastive-boundaries"] };
  if (/coverage|rule space|rule-space|format|version|direction|unsupported construct|edge case|semantic pass|only one case|illustrative case/.test(value)) return { category: "domain-coverage", patterns: ["rule-rich-domain-coverage", "evaluation-driven-development"] };
  if (/reference|read|navigation|progressive|provider|domain/.test(value)) return { category: "navigation", patterns: ["progressive-disclosure", "domain-specific-organization", "conditional-details"] };
  if (/step|order|workflow|skip|sequence/.test(value)) return { category: "workflow", patterns: ["sequential-workflow", "conditional-workflow"] };
  if (/validate|verify|evidence|grading|benchmark|receipt|review/.test(value)) return { category: "verification", patterns: ["feedback-loop", "verifiable-intermediate-outputs"] };
  if (/script|command|deterministic|repeat/.test(value)) return { category: "automation", patterns: ["utility-scripts", "solve-dont-defer"] };
  if (/image|visual|layout|render|screenshot/.test(value)) return { category: "visual", patterns: ["visual-analysis"] };
  if (/delete|remove|migrate|deploy|publish|release|batch|overwrite/.test(value)) return { category: "risk", patterns: ["plan-validate-execute", "appropriate-degree-of-freedom"] };
  if (/format|template|structure|schema|example/.test(value)) return { category: "output", patterns: ["template-pattern", "examples-pattern"] };
  if (/tool|dependency|package|mcp|install|runner|browser|network/.test(value)) return { category: "capability", patterns: ["dependency-and-mcp-guidance", "clear-script-intent"] };
  return { category: "instruction", patterns: ["concise-instructions", "appropriate-degree-of-freedom"] };
}
function runDirectories(workspace: string): Array<{ evalName: string; configuration: string; run: string }> {
  const out: Array<{ evalName: string; configuration: string; run: string }> = [];
  for (const evalName of readdirSync(workspace).filter(n => n.startsWith("eval-")).sort()) {
    const evalDir = join(workspace, evalName); if (!isDir(evalDir)) continue;
    for (const configuration of readdirSync(evalDir).filter(n => /with_skill|old_skill|without_skill/.test(n)).sort()) {
      const configDir = join(evalDir, configuration); if (!isDir(configDir)) continue;
      const runs = readdirSync(configDir).filter(n => /^run-\d+$/.test(n) && isDir(join(configDir,n))).sort();
      for (const run of runs.length ? runs.map(n => join(configDir,n)) : [configDir]) out.push({ evalName, configuration, run });
    }
  }
  return out;
}
export function analyzeEvaluation(workspaceArg: string, skillPathArg: string) {
  const workspace = resolve(workspaceArg), skillPath = resolve(skillPathArg), failures: Failure[] = [], navigation: NavigationFinding[] = [];
  if (!isDir(workspace)) throw new TypeError(`evaluation workspace not found: ${workspace}`);
  if (!existsSync(join(skillPath,"SKILL.md"))) throw new TypeError(`SKILL.md not found: ${skillPath}`);
  for (const item of runDirectories(workspace)) {
    const grading = json(join(item.run,"grading.json"));
    for (const expectation of grading?.expectations ?? []) if (expectation?.passed === false) {
      const assertion = String(expectation.text ?? ""), evidence = String(expectation.evidence ?? ""), mapped = categorize(assertion + " " + evidence);
      failures.push({ eval: item.evalName, configuration: item.configuration, assertion, evidence, category: mapped.category, recommended_patterns: mapped.patterns });
    }
    const metadata = json(join(workspace,item.evalName,"eval_metadata.json")), expected = metadata?.navigation_expectations;
    if (expected && (expected.must_read?.length || expected.read_when_relevant?.length || expected.must_not_read?.length)) {
      const actual = json(join(item.run,"navigation.json")) ?? json(join(item.run,"outputs","navigation.json"));
      if (!actual) navigation.push({ eval: item.evalName, configuration: item.configuration, status: "unavailable", message: "Navigation expectations exist but navigation.json was not captured." });
      else {
        const read = new Set(Array.isArray(actual.read) ? actual.read : []), missed = (expected.must_read ?? []).filter((p:string)=>!read.has(p)), forbidden = (expected.must_not_read ?? []).filter((p:string)=>read.has(p));
        navigation.push({ eval: item.evalName, configuration: item.configuration, status: missed.length || forbidden.length ? "warning" : "pass", message: missed.length || forbidden.length ? `missed: ${missed.join(", ") || "none"}; unexpectedly read: ${forbidden.join(", ") || "none"}` : "Navigation expectations satisfied." });
      }
    }
  }
  const audit = auditSkill(skillPath), counts = new Map<string,number>();
  for (const failure of failures) for (const pattern of failure.recommended_patterns) counts.set(pattern,(counts.get(pattern)??0)+1);
  const recommendations = [...counts.entries()].sort((a,b)=>b[1]-a[1]).map(([pattern,count])=>({pattern,count,action:`Review ${pattern} against the cited failures and apply the smallest correction.`}));
  const benchmark = json(join(workspace,"benchmark.json")), current = benchmark?.run_summary?.with_skill?.pass_rate?.mean ?? null, baselineKey = Object.keys(benchmark?.run_summary??{}).find(k=>k.includes("old_skill")||k.includes("without_skill")), baseline = baselineKey ? benchmark.run_summary[baselineKey]?.pass_rate?.mean ?? null : null;
  const completed = ["authoring audit", ...(benchmark ? ["benchmark"] : []), ...(existsSync(join(workspace,"review.html")) ? ["review viewer"] : [])], unavailable = navigation.filter(n=>n.status==="unavailable").map(n=>n.message), blocked = [...(!benchmark?["benchmark missing"]:[]), ...(!existsSync(join(workspace,"review.html"))?["review viewer missing"]:[])];
  return { schema_version:"1.0", artifact:"evaluation-analysis", status:blocked.length?"blocked":"complete", workspace, skill_path:skillPath, evidence:{completed,unavailable,blocked}, benchmark:{current,baseline,delta:typeof current==="number"&&typeof baseline==="number"?current-baseline:null}, failures, navigation, authoring_audit:{status:audit.status,findings:audit.findings}, pattern_review:{base:audit.pattern_review as PatternDecision[],recommended:recommendations}, decision:failures.length?"revise":"accept" };
}
export function main(): void { try { const {positionals,values}=parseArgs({args:process.argv.slice(2),allowPositionals:true,options:{"skill-path":{type:"string"},output:{type:"string",short:"o"}}}); if(!positionals[0]||!values["skill-path"])throw new TypeError("usage: analyze_evaluation.js <workspace> --skill-path <dir> [-o analysis.json]"); const result=analyzeEvaluation(positionals[0],values["skill-path"]),text=JSON.stringify(result,null,2)+"\n"; if(values.output){mkdirSync(dirname(resolve(values.output)),{recursive:true});writeFileSync(resolve(values.output),text);} console.log(text.trim()); process.exit(result.status==="blocked"?3:0); } catch(error){console.error(`analyze_evaluation: ${(error as Error).message}`);process.exit(2);} }
const invoked=process.argv[1]?resolve(process.argv[1]):null;if(!import.meta.url.includes("/$bunfs/")&&invoked&&fileURLToPath(import.meta.url)===invoked)main();
