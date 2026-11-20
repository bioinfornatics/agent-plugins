import type { CandidateToolMode } from "./candidate-tooling.ts";
import type { ActivationClass, ActivationObservation } from "./activation.ts";
import type { ConfiguredCandidateModel } from "./candidate-model.ts";
import { EvaluationError, type EvaluationOptions, type EvaluationProfile, type Scenario } from "./evaluation.ts";

/** Activation trials (product §37, ap-x8p7.13): query-only "with" runs classified by the
 * structural activation oracle (§31); no Judge, criteria or baseline arm. */
export const ACTIVATION_THRESHOLD = 0.5;
export const activationCaseLimits = { cases: 1000, queryCharacters: 8000 } as const;
const CASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Refused by grading/export: activation scenarios carry no criteria to judge. */
export class ActivationCampaignRefusal extends EvaluationError {
  constructor(operation: "grading" | "export") {
    super(`Activation campaigns have no grading criteria; ${operation} is refused. Use agent-plugin activation --resume <campaign-id> to read their result`);
  }
}

/** Frozen expectation; deliberately absent from scenarios, options and TrialRequest (blind runs). */
export interface ActivationCase { id: string; shouldTrigger: boolean; skill: string }
export interface ActivationCaseInput extends ActivationCase { query: string }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function onlyKeys(value: Record<string, unknown>, keys: string[], location: string) {
  const unsupported = Object.keys(value).filter(key => !keys.includes(key));
  if (unsupported.length) throw new EvaluationError(`${location}: unsupported fields: ${unsupported.join(", ")}`);
}
/** §35 normalization: trim, collapse whitespace and case-fold before duplicate detection. */
export function normalizedQuery(query: string): string { return query.trim().replace(/\s+/g, " ").toLowerCase(); }

/** Accepts `{cases:[{id,query,should_trigger,skill?}]}` or the upstream bare array
 * `[{query,should_trigger}]` (positional ids "1","2",…). `skills` are profile Skill
 * directory names; a case must name one when the profile holds more than one. */
export function validateActivationCases(document: unknown, skills: readonly string[]): ActivationCaseInput[] {
  let items: unknown[];
  let positional = false;
  if (Array.isArray(document)) { items = document; positional = true; }
  else if (record(document)) {
    onlyKeys(document, ["cases"], "queries");
    if (!Array.isArray(document.cases)) throw new EvaluationError("queries: cases must be an array");
    items = document.cases;
  } else throw new EvaluationError("queries: expected {\"cases\":[...]} or an array");
  if (!items.length) throw new EvaluationError("queries: at least one case is required");
  if (items.length > activationCaseLimits.cases) throw new EvaluationError(`queries: at most ${activationCaseLimits.cases} cases`);
  if (!skills.length) throw new EvaluationError("Activation profile contains no Skill");
  const cases: ActivationCaseInput[] = [];
  const ids = new Set<string>(), queries = new Map<string, string>();
  for (const [index, item] of items.entries()) {
    const location = `queries: case ${index + 1}`;
    if (!record(item)) throw new EvaluationError(`${location}: expected an object`);
    onlyKeys(item, positional ? ["query", "should_trigger", "skill"] : ["id", "query", "should_trigger", "skill"], location);
    const id = positional ? String(index + 1) : item.id;
    if (typeof id !== "string" || !CASE_ID.test(id)) throw new EvaluationError(`${location}: id must match ${CASE_ID.source}`);
    if (ids.has(id)) throw new EvaluationError(`${location}: duplicate id ${id}`);
    ids.add(id);
    if (typeof item.query !== "string" || !item.query.trim()) throw new EvaluationError(`${location}: query must be a nonempty string`);
    if (item.query.length > activationCaseLimits.queryCharacters) throw new EvaluationError(`${location}: query exceeds ${activationCaseLimits.queryCharacters} characters`);
    if (typeof item.should_trigger !== "boolean") throw new EvaluationError(`${location}: should_trigger must be a boolean`);
    const normalized = normalizedQuery(item.query), previous = queries.get(normalized);
    // Never merge silently: a duplicate would double-weight one query in the rates.
    if (previous !== undefined) throw new EvaluationError(`queries: duplicate normalized query in cases ${previous} and ${id}`);
    queries.set(normalized, id);
    let skill: string;
    if (item.skill === undefined) {
      if (skills.length !== 1) throw new EvaluationError(`${location}: skill is required when the profile contains several Skills`);
      skill = skills[0] as string;
    } else if (typeof item.skill !== "string" || !skills.includes(item.skill)) throw new EvaluationError(`${location}: skill must name a profile Skill directory`);
    else skill = item.skill;
    cases.push({ id, query: item.query, shouldTrigger: item.should_trigger, skill });
  }
  return cases;
}

export function activationScenarioId(caseId: string): string { return `activation/${caseId}`; }

/** Synthetic criterion-free scenarios plus a "with"-only matrix. `skillRoots` maps profile Skill
 * directory names to frozen roots; the queries digest namespaces the synthetic suite. */
export function buildActivationPlan(profile: EvaluationProfile, cases: readonly ActivationCaseInput[], skillRoots: ReadonlyMap<string, string>, options: EvaluationOptions, queriesSha256: string) {
  const scenarios: Scenario[] = cases.map((item, index) => {
    const skill = skillRoots.get(item.skill);
    if (!skill) throw new EvaluationError(`Unknown profile Skill: ${item.skill}`);
    return { id: activationScenarioId(item.id), sourceId: index + 1, skill, suite: `activation:${queriesSha256}`, prompt: item.query, expectations: [], grading: { notable: false } };
  });
  const frozen = { ...profile, scenarios };
  const trials: { id: string; scenario: string; agent: string; repetition: number; pairId: string; condition: "with" | "without" }[] = [];
  for (const scenario of scenarios) for (const agent of options.agents) {
    for (let repetition = 1; repetition <= options.repetitions; repetition++) {
      trials.push({ id: `trial-${trials.length + 1}`, scenario: scenario.id, agent, repetition, pairId: JSON.stringify([frozen.revision, scenario.id, agent, repetition]), condition: "with" });
    }
  }
  return { status: "prepared" as const, schemaVersion: 5 as const, mode: "activation" as const, queriesSha256,
    cases: cases.map(({ id, shouldTrigger, skill }) => ({ id, shouldTrigger, skill })), options, profile: frozen, candidateRuns: trials.length, trials };
}

/** Stored schema-5 consistency: cases, synthetic scenarios and with-only trials must agree exactly.
 * Throws plain Error (storage corruption), never a user diagnostic. */
export function validateActivationPlan(value: Record<string, unknown>): void {
  function invalid(): never { throw new Error("Invalid stored activation plan"); }
  const profile = value.profile as EvaluationProfile, options = value.options as EvaluationOptions;
  if (value.mode !== "activation" || typeof value.queriesSha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.queriesSha256) || !Array.isArray(value.cases) || !value.cases.length || value.cases.length > activationCaseLimits.cases) invalid();
  const cases = value.cases as unknown[], ids = new Set<string>();
  if (profile.scenarios.length !== cases.length || profile.components.some(component => component.scenarios.length)) invalid();
  cases.forEach((item, index) => {
    if (!record(item) || Object.keys(item).sort().join(",") !== "id,shouldTrigger,skill" || typeof item.id !== "string" || !CASE_ID.test(item.id) || ids.has(item.id) || typeof item.shouldTrigger !== "boolean" || typeof item.skill !== "string") invalid();
    ids.add(item.id as string);
    const scenario = profile.scenarios[index];
    const owners = profile.components.flatMap(component => component.skillRoots).filter(root => root.replaceAll("\\", "/").split("/").at(-1) === item.skill);
    if (!scenario || scenario.id !== activationScenarioId(item.id as string) || scenario.sourceId !== index + 1 || scenario.suite !== `activation:${value.queriesSha256}` ||
      !Array.isArray(scenario.expectations) || scenario.expectations.length || owners.length !== 1 || scenario.skill !== owners[0]) invalid();
  });
  const trials = value.trials as Record<string, unknown>[];
  if (trials.length !== cases.length * options.agents.length * options.repetitions) invalid();
  for (const trial of trials) {
    if (trial.condition !== "with" || !Number.isSafeInteger(trial.repetition) || (trial.repetition as number) < 1 || (trial.repetition as number) > options.repetitions ||
      trial.pairId !== JSON.stringify([profile.revision, trial.scenario, trial.agent, trial.repetition])) invalid();
  }
}

export type ActivationOutcome = "triggered" | "not-triggered" | "inconclusive" | "technical";
export interface ActivationRunInput {
  /** Logical binding: only a finalized attempt carries a verified receipt. */
  finalized: boolean;
  receipt?: { status: string; exitCode: number | null; collection: string };
  assessment?: { class: ActivationClass; observation: ActivationObservation };
}
/** Technical before oracle: an unfinished, failed or partially collected run proves nothing.
 * direct-read / attempted-failed / inconclusive stay inconclusive (subclass kept by caller). */
export function classifyTrialOutcome(run: ActivationRunInput): ActivationOutcome {
  const receipt = run.receipt;
  if (!run.finalized || !receipt || receipt.status !== "completed" || receipt.exitCode !== 0 || receipt.collection !== "complete") return "technical";
  if (run.assessment?.class === "triggered") return "triggered";
  if (run.assessment?.class === "not-triggered") return "not-triggered";
  return "inconclusive";
}

export interface ActivationCaseResult {
  id: string; shouldTrigger: boolean; triggerRate: number | null; pass: boolean; unresolved: boolean;
}
export interface ActivationSummary { tp: number; fp: number; tn: number; fn: number; unresolved: number; precision: number | null; recall: number | null }

/** §35 case outcome with a fixed 0.5 threshold. Unresolved (any inconclusive/technical run, or no
 * decisive run) counts as failed and is excluded from tp/fp/tn/fn: absence is never a false negative. */
export function aggregateActivationCases(cases: readonly ActivationCase[], outcomes: ReadonlyMap<string, readonly ActivationOutcome[]>): { cases: ActivationCaseResult[]; summary: ActivationSummary } {
  const summary: ActivationSummary = { tp: 0, fp: 0, tn: 0, fn: 0, unresolved: 0, precision: null, recall: null };
  const results = cases.map(item => {
    const runs = outcomes.get(item.id) ?? [];
    const triggered = runs.filter(outcome => outcome === "triggered").length;
    const decisive = triggered + runs.filter(outcome => outcome === "not-triggered").length;
    const triggerRate = decisive ? triggered / decisive : null;
    const unresolved = triggerRate === null || runs.some(outcome => outcome === "inconclusive" || outcome === "technical");
    const pass = !unresolved && (item.shouldTrigger ? (triggerRate as number) >= ACTIVATION_THRESHOLD : (triggerRate as number) < ACTIVATION_THRESHOLD);
    if (unresolved) summary.unresolved++;
    else if (item.shouldTrigger) { if (pass) summary.tp++; else summary.fn++; }
    else if (pass) summary.tn++; else summary.fp++;
    return { id: item.id, shouldTrigger: item.shouldTrigger, triggerRate, pass, unresolved };
  });
  summary.precision = summary.tp + summary.fp ? summary.tp / (summary.tp + summary.fp) : null;
  summary.recall = summary.tp + summary.fn ? summary.tp / (summary.tp + summary.fn) : null;
  return { cases: results, summary };
}

export interface ActivationRun { trialId: string; attemptId: string | null; outcome: ActivationOutcome; class: ActivationClass | null; observation: ActivationObservation | null }
/** Derived read model (`activation-run-v1`); never stored in the registry. Query text is omitted. */
export interface ActivationRunResult {
  format: "activation-run-v1";
  header: { campaignId: string; profile: { id: string; revision: string }; host: { id: string; version: string | null };
    candidateModel: { configured: Record<string, ConfiguredCandidateModel> | null };
    /** Frozen host tool exposure (ap-49tf); null for campaigns frozen before it was recorded. */
    candidateTooling: Record<string, CandidateToolMode> | null; threshold: number; repetitions: number };
  cases: { id: string; shouldTrigger: boolean; runs: ActivationRun[]; triggerRate: number | null; pass: boolean; unresolved: boolean }[];
  summary: ActivationSummary;
  limitations: string[];
}
