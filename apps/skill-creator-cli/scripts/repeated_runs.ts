import { counterbalancedPairSeed, pairedOrderFromSeed } from "./evaluation_provenance.js";

export type RunProfile = "fast" | "standard" | "release";
export const RUN_PROFILE_COUNTS: Record<RunProfile, number> = { fast: 1, standard: 3, release: 5 };
export interface AggregateBudget { max_runs: number; max_turns: number; timeout_seconds: number; }
export interface ScheduledPair { pair_index: number; seed: number; order: ["with_skill" | "baseline", "with_skill" | "baseline"]; }

export class RepeatedRunPlanError extends Error {
  readonly code = "invalid-aggregate-budget";
  constructor(message: string) { super(message); this.name = "RepeatedRunPlanError"; }
}

export function parseRunProfile(value: unknown): RunProfile {
  const profile = String(value ?? "fast");
  if (!(profile in RUN_PROFILE_COUNTS)) throw new TypeError("--run-profile must be fast, standard, or release");
  return profile as RunProfile;
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new RepeatedRunPlanError(`aggregate_budget.${field} must be a positive integer`);
  return parsed;
}

export function validateAggregateBudget(document: any, profile: RunProfile, scenarios: any[], worstCasePairs = RUN_PROFILE_COUNTS[profile]): AggregateBudget {
  const requested = worstCasePairs;
  if (!Number.isInteger(requested) || requested <= 0) throw new RepeatedRunPlanError("worst-case pair count must be a positive integer");
  const required = {
    max_runs: scenarios.length * requested * 2,
    max_turns: scenarios.reduce((sum, item) => sum + Number(item?.budget?.max_turns ?? 40) * requested * 2, 0),
    timeout_seconds: scenarios.reduce((sum, item) => sum + Number(item?.budget?.timeout_seconds ?? 300) * requested * 2, 0),
  };
  const raw = document?.aggregate_budget;
  // Legacy one-pair plans remain executable; repeated profiles require an explicit cap.
  if (raw === undefined && profile === "fast") return required;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RepeatedRunPlanError(`${profile} requires aggregate_budget with max_runs, max_turns, and timeout_seconds`);
  const budget = { max_runs: positiveInteger(raw.max_runs, "max_runs"), max_turns: positiveInteger(raw.max_turns, "max_turns"), timeout_seconds: positiveInteger(raw.timeout_seconds, "timeout_seconds") };
  for (const key of Object.keys(required) as Array<keyof AggregateBudget>) if (budget[key] < required[key]) throw new RepeatedRunPlanError(`aggregate_budget.${key} ${budget[key]} is below required ${required[key]} for profile ${profile}`);
  return budget;
}

export function schedulePairs(binding: { skill_source_sha256: string; eval_plan_sha256: string; scenario_sha256: string }, count: number): ScheduledPair[] {
  if (!Number.isInteger(count) || count <= 0) throw new TypeError("requested pair count must be a positive integer");
  return Array.from({ length: count }, (_, offset) => {
    const pair_index = offset + 1;
    const seed = counterbalancedPairSeed(binding, pair_index);
    return { pair_index, seed, order: pairedOrderFromSeed(seed) };
  });
}
