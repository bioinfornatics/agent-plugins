#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPortableScenarioId } from "./scenario_id.js";
import { normalizeAssertions } from "./evaluator_grading.js";
import { parseArgs } from "node:util";

export type DesignSeverity = "error" | "warning";
export interface DesignFinding { severity: DesignSeverity; rule: string; message: string; eval_id?: string | number; }
export interface EvalCapabilities { filesystem: boolean; agent_runner: boolean; browser: boolean; network: boolean; tools: string[]; }
export interface EvalScenario {
  id: string | number; name: string; subject: string; language: string; prompt: string; expected_output: string; files: string[];
  target: Record<string, unknown>; preconditions: string[]; budget: { max_turns: number; timeout_seconds: number };
  capabilities: EvalCapabilities; assertions: unknown[]; coverage_tags: string[];
  navigation_expectations: { must_read: string[]; read_when_relevant: string[]; must_not_read: string[] };
}
export interface EvalDesignResult {
  schema_version: "1.0"; artifact: "evaluation-design"; status: "pass" | "warning" | "fail";
  eval_set: string; skill_path?: string; skill_name: string; scenarios: EvalScenario[];
  coverage: { declared: Record<string, string[]>; covered: string[]; missing: string[] };
  findings: DesignFinding[]; summary: { scenarios: number; errors: number; warnings: number };
}

const defaults: EvalCapabilities = { filesystem: true, agent_runner: true, browser: false, network: false, tools: [] };
const vaguePrompts = /^(do it|test it|evaluate it|help me|create a skill|validate this|benchmark this)[.!]?$/i;
const implementationAssertion = /\buses?\s+(?:quick_validate(?:\.js)?|run_eval(?:\.js)?|run_loop(?:\.js)?|aggregate_benchmark(?:\.js)?|generate_review(?:\.js)?)\b/i;
const compoundAssertion = /\b(?:and|then)\b.*\b(?:and|then)\b/i;

function asStrings(value: unknown): string[] { return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []; }
function add(findings: DesignFinding[], severity: DesignSeverity, rule: string, message: string, evalId?: string | number): void { findings.push({ severity, rule, message, ...(evalId !== undefined ? { eval_id: evalId } : {}) }); }
function capabilities(value: any): EvalCapabilities { return { filesystem: value?.filesystem ?? defaults.filesystem, agent_runner: value?.agent_runner ?? defaults.agent_runner, browser: value?.browser ?? defaults.browser, network: value?.network ?? defaults.network, tools: asStrings(value?.tools) }; }
function navigation(value: any) { return { must_read: asStrings(value?.must_read), read_when_relevant: asStrings(value?.read_when_relevant), must_not_read: asStrings(value?.must_not_read) }; }

export function designEvals(evalSetArg: string, skillPathArg?: string): EvalDesignResult {
  const evalSet = resolve(evalSetArg), skillPath = skillPathArg ? resolve(skillPathArg) : undefined, findings: DesignFinding[] = [];
  let document: any;
  try { document = JSON.parse(readFileSync(evalSet, "utf8")); }
  catch (error) { return { schema_version: "1.0", artifact: "evaluation-design", status: "fail", eval_set: evalSet, ...(skillPath ? { skill_path: skillPath } : {}), skill_name: "", scenarios: [], coverage: { declared: {}, covered: [], missing: [] }, findings: [{ severity: "error", rule: "invalid-json", message: (error as Error).message }], summary: { scenarios: 0, errors: 1, warnings: 0 } }; }
  const raw = Array.isArray(document) ? document : document?.evals;
  const skillName = String(Array.isArray(document) ? (skillPath ? basename(skillPath) : "") : document?.skill_name ?? (skillPath ? basename(skillPath) : ""));
  if (!Array.isArray(raw) || !raw.length) add(findings, "error", "scenario-set", "Evaluation set must contain a non-empty evals array.");
  if (skillPath && skillName && skillName !== basename(skillPath)) add(findings, "error", "skill-name", `skill_name '${skillName}' must match '${basename(skillPath)}'.`);
  const declaredCoverage: Record<string, string[]> = {};
  if (document?.coverage_dimensions && typeof document.coverage_dimensions === "object" && !Array.isArray(document.coverage_dimensions)) {
    for (const [dimension, values] of Object.entries(document.coverage_dimensions)) {
      const normalized = asStrings(values);
      if (!normalized.length) add(findings, "warning", "coverage-dimension", `Coverage dimension '${dimension}' has no values.`);
      declaredCoverage[dimension] = normalized;
    }
  }
  const seen = new Set<string>(), scenarios: EvalScenario[] = [];
  for (let index = 0; index < (Array.isArray(raw) ? raw.length : 0); index++) {
    const item = raw[index] ?? {}, id = item.id ?? index + 1; let key:string; try{key=assertPortableScenarioId(id)}catch(error){key=String(id);add(findings,"error","scenario-id",(error as Error).message,id)} const prompt = String(item.prompt ?? item.query ?? "").trim(), name = String(item.name ?? "").trim(), subject = String(item.subject ?? "").trim(), language = String(item.language ?? "").trim(), target = item.target && typeof item.target === "object" && !Array.isArray(item.target) ? item.target as Record<string, unknown> : {}, preconditions = asStrings(item.preconditions), budget = { max_turns: Number(item.budget?.max_turns ?? 0), timeout_seconds: Number(item.budget?.timeout_seconds ?? 0) }, assertions: unknown[] = Array.isArray(item.assertions ?? item.expectations) ? (item.assertions ?? item.expectations) : [], files = asStrings(item.files), coverageTags = asStrings(item.coverage_tags), caps = capabilities(item.capabilities), nav = navigation(item.navigation_expectations);
    if (seen.has(key)) add(findings, "error", "unique-id", `Duplicate scenario id: ${key}.`, id); seen.add(key);
    if (!name || /^(?:case|test|eval)[-_ ]?\d*$/i.test(name)) add(findings, "warning", "descriptive-name", "Scenario name should identify the capability or risk under test.", id);
    if (!subject) add(findings, "warning", "scenario-subject", "Declare the creator responsibility or behavior under test in subject.", id);
    if (!language) add(findings, "warning", "scenario-language", "Declare the prompt language and include a matching language coverage tag.", id);
    else if (!coverageTags.includes(`language:${language}`)) add(findings, "warning", "language-coverage", `Add coverage tag language:${language} for the declared prompt language.`, id);
    if (!Object.keys(target).length || typeof target.kind !== "string") add(findings, "error", "scenario-target", "Declare a target object with a concrete kind and paths or output identity.", id);
    const execution = target.execution;
    if (typeof execution !== "string" || !["explain", "dry-run", "execute", "resume"].includes(execution)) add(findings, "error", "execution-level", "Declare target.execution as explain, dry-run, execute, or resume.", id);
    if (!preconditions.length) add(findings, "warning", "scenario-preconditions", "Declare fixture mutability, baseline, capability, or workspace preconditions.", id);
    if (["execute", "resume"].includes(String(execution)) && caps.agent_runner && (!Number.isInteger(budget.max_turns) || budget.max_turns <= 0 || !Number.isFinite(budget.timeout_seconds) || budget.timeout_seconds <= 0)) add(findings, "warning", "execution-budget", "Executable agent scenarios must declare positive budget.max_turns and budget.timeout_seconds.", id);
    if (/\b(?:this|that) skill\b|\bcette skill\b/i.test(prompt) && !Object.keys(target).length) add(findings, "error", "ambiguous-target", "Prompt refers to a Skill without an explicit target.", id);
    if (!prompt) add(findings, "error", "prompt", "Scenario prompt is required.", id);
    else if (vaguePrompts.test(prompt) || prompt.length < 20) add(findings, "warning", "realistic-prompt", "Prompt is too vague to represent a discriminating real request.", id);
    if (!String(item.expected_output ?? "").trim()) add(findings, "warning", "expected-output", "Describe the observable overall result in expected_output.", id);
    if (!Array.isArray(item.capabilities)) {
      if (!item.capabilities) add(findings, "warning", "capabilities", "Declare filesystem, agent_runner, browser, network, and tools so execution claims can be graded fairly.", id);
    }
    if (!assertions.length) add(findings, "error", "assertions", "At least one observable assertion is required.", id);
    let assertionTexts: string[] = [];
    try { assertionTexts = normalizeAssertions(assertions).map(assertion => assertion.criterion); }
    catch (error) { add(findings, "error", "assertion-schema", (error as Error).message, id); }
    for (const assertion of assertionTexts) {
      if (assertion.length < 12) add(findings, "warning", "assertion-specificity", `Assertion is too vague: '${assertion}'.`, id);
      if (implementationAssertion.test(assertion)) add(findings, "warning", "implementation-coupling", `Prefer an observable outcome over a private script name: '${assertion}'.`, id);
      if (compoundAssertion.test(assertion)) add(findings, "warning", "atomic-assertion", `Split compound assertion into atomic outcomes: '${assertion}'.`, id);
    }
    if (skillPath) {
      const targetPaths = Object.entries(target).filter(([field, value]) => typeof value === "string" && ["path", "current", "baseline", "eval_set", "trigger_eval_set", "behavior_eval_set", "integration_eval_set", "workspace", "allow_payload", "block_payload"].includes(field)).map(([, value]) => value as string);
      for (const file of [...new Set([...files, ...targetPaths])]) {
        if (isAbsolute(file) || file.startsWith("../")) add(findings, "error", "fixture-path", `Fixture must stay inside the Skill: ${file}`, id);
        else if (!existsSync(join(skillPath, file))) add(findings, "error", "missing-fixture", `Fixture does not exist: ${file}`, id);
      }
    }
    const mentionsReferences = /reference|progressive disclosure|provider|domain/i.test(prompt + " " + assertionTexts.join(" "));
    if (mentionsReferences && !nav.must_read.length && !nav.read_when_relevant.length) add(findings, "warning", "navigation-expectations", "Progressive-disclosure scenario should declare required and conditional resource navigation.", id);
    for (const tag of coverageTags) if (!/^[a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9._-]*$/i.test(tag)) add(findings, "warning", "coverage-tag", `Use stable dimension:value coverage tags, got '${tag}'.`, id);
    scenarios.push({ id, name: name || `eval-${key}`, subject, language, prompt, expected_output: String(item.expected_output ?? ""), files, target, preconditions, budget, capabilities: caps, assertions, coverage_tags: coverageTags, navigation_expectations: nav });
  }
  const covered = [...new Set(scenarios.flatMap(s => s.coverage_tags))].sort();
  const requiredCoverage = Object.entries(declaredCoverage).flatMap(([dimension, values]) => values.map(value => `${dimension}:${value}`));
  const missing = requiredCoverage.filter(tag => !covered.includes(tag));
  for (const tag of missing) add(findings, "warning", "uncovered-domain-dimension", `No scenario covers declared rule-space cell: ${tag}.`);
  const errors = findings.filter(f => f.severity === "error").length, warnings = findings.filter(f => f.severity === "warning").length;
  return { schema_version: "1.0", artifact: "evaluation-design", status: errors ? "fail" : warnings ? "warning" : "pass", eval_set: evalSet, ...(skillPath ? { skill_path: skillPath } : {}), skill_name: skillName, scenarios, coverage: { declared: declaredCoverage, covered, missing }, findings, summary: { scenarios: scenarios.length, errors, warnings } };
}

export function main(): void {
  try {
    const { positionals, values } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: { "skill-path": { type: "string" }, output: { type: "string", short: "o" }, normalize: { type: "string" } } });
    if (!positionals[0]) throw new TypeError("usage: design_evals.js <evals.json> [--skill-path <dir>] [-o report.json] [--normalize <evals.json>]");
    const result = designEvals(positionals[0], values["skill-path"]);
    if (values.normalize) { mkdirSync(dirname(resolve(values.normalize)), { recursive: true }); writeFileSync(resolve(values.normalize), JSON.stringify({ skill_name: result.skill_name, ...(Object.keys(result.coverage.declared).length ? { coverage_dimensions: result.coverage.declared } : {}), evals: result.scenarios }, null, 2) + "\n"); }
    const json = JSON.stringify(result, null, 2) + "\n"; if (values.output) { mkdirSync(dirname(resolve(values.output)), { recursive: true }); writeFileSync(resolve(values.output), json); } console.log(json.trim()); process.exit(result.status === "fail" ? 1 : 0);
  } catch (error) { console.error(`design_evals: ${(error as Error).message}`); process.exit(2); }
}
const invoked = process.argv[1] ? resolve(process.argv[1]) : null; if (!import.meta.url.includes("/$bunfs/") && invoked && fileURLToPath(import.meta.url) === invoked) main();
