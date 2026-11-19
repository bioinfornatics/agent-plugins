import { validateCandidateModels, type ConfiguredCandidateModel } from "./candidate-model.ts";
import type { JsonData } from "./scenario-import.ts";
/** Shared preparation/execution data; each host defines which requested limits it enforces. */
export type TargetKind = "skill" | "plugin";
export interface EvaluationTarget { kind: TargetKind; root: string }
/** Captured bytes are base64; executable preserves install intent, not source permissions. */
export interface SnapshotFile { path: string; content: string; executable: boolean }
export interface ScenarioDiagnostic { code: "unsupported-scenario-constraint"; field: string; message: string }
export interface Scenario {
  id: string;
  sourceId: number;
  skill: string;
  suite: string;
  prompt: string;
  preparation?: import("./retained-preparation.ts").RetainedPreparation;
  expectations: string[];
  /** Judge-side description, never appended to candidate instructions. */
  expectedOutput?: string;
  extensions?: Record<string, JsonData>;
  suiteMetadata?: Record<string, JsonData>;
  grading?: { notable: boolean };
  /** Skill-root source to workspace mapping; paths are preserved in both arms. */
  inputs?: { source: string; workspace: string }[];
  diagnostics?: ScenarioDiagnostic[];
  fixtures?: string;
  fixturesFiles?: SnapshotFile[];
}
export interface EvaluationOptions {
  agents: string[];
  model?: string;
  /** Frozen preflight identities; omission retains historical/unsupported-host unknowns. */
  candidateModels?: Record<string, ConfiguredCandidateModel>;
  repetitions: number;
  maxTurns: number;
  /** Seconds; 0 disables the candidate-run deadline, not host preflight/collection deadlines. */
  timeout: number;
  /** Maximum active candidate trials; persistence is serialized independently. */
  parallelism: number;
  /** Opt-in OS sandbox for candidate runs (ap-15xv); omitted means private HOME/XDG only.
   * Frozen with the plan so resume applies the same isolation. */
  sandbox?: CandidateSandbox;
}
export const CANDIDATE_SANDBOXES = ["bubblewrap"] as const;
export type CandidateSandbox = typeof CANDIDATE_SANDBOXES[number];
export function validateSandbox(value: unknown): void {
  if (value !== undefined && !CANDIDATE_SANDBOXES.includes(value as CandidateSandbox)) throw new EvaluationError(`--sandbox must be one of: ${CANDIDATE_SANDBOXES.join(", ")}`);
}
export interface PreparedTarget extends EvaluationTarget {
  installationName: string;
  skillRoots: string[];
  fingerprint: string;
  files: SnapshotFile[];
  scenarios: Scenario[];
}
export interface EvaluationProfile {
  id: string;
  name: string;
  revision: string;
  components: PreparedTarget[];
  scenarios: Scenario[];
}
export interface EvaluationInput extends EvaluationOptions { skills: string[]; plugins: string[]; output?: string; registry?: string; profileName?: string }
export class EvaluationError extends Error {}

/** Largest candidate-run deadline in seconds. Hosts arm it with setTimeout, whose
 * delay is a signed 32-bit millisecond value; a larger value passed preparation but
 * failed every frozen trial at run time, leaving an unrecoverable campaign. */
export const MAX_TIMEOUT_SECONDS = 2147483;

/** Execution limits every host must accept; checked before any campaign is begun. */
export function validateExecutionLimits(options: Pick<EvaluationOptions, "maxTurns" | "timeout">): void {
  if (!Number.isSafeInteger(options.maxTurns) || options.maxTurns < 1) throw new EvaluationError("--max-turns must be a safe integer >= 1");
  if (!Number.isSafeInteger(options.timeout) || options.timeout < 0 || options.timeout > MAX_TIMEOUT_SECONDS) throw new EvaluationError(`--timeout must be an integer from 0 to ${MAX_TIMEOUT_SECONDS} seconds`);
}

export function validateOptions(input: EvaluationInput): void {
  validateCandidateModels(input);
  if (input.profileName !== undefined && (!input.profileName.trim() || input.profileName.length > 200)) throw new EvaluationError("--profile-name must contain 1 to 200 characters");
  if (!input.skills.length && !input.plugins.length) throw new EvaluationError("Select --skills or --plugin");
  for (const [name, value, minimum] of [
    ["--repetitions", input.repetitions, 1], ["--max-turns", input.maxTurns, 1],
    ["--timeout", input.timeout, 0], ["--parallelism", input.parallelism, 1],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < minimum) throw new EvaluationError(`${name} must be a safe integer >= ${minimum}`);
  }
  validateExecutionLimits(input);
  for (const agent of input.agents) {
    if (!["goose", "claude", "codex"].includes(agent)) throw new EvaluationError(`Unsupported --agent: ${agent}`);
  }
  if (!input.agents.length) throw new EvaluationError("Select at least one --agent");
  if (input.model !== undefined && !input.model.trim()) throw new EvaluationError("--model must not be empty");
  validateSandbox(input.sandbox);
}

/** Profile treatment is shared by every scenario; source provenance is never an install selector. */
export function buildMatrix(profile: EvaluationProfile, options: EvaluationOptions) {
  const trials: { id: string; scenario: string; agent: string; repetition: number; pairId: string; condition: "with" | "without" }[] = [];
  for (const scenario of profile.scenarios) for (const agent of options.agents) {
    for (let repetition = 1; repetition <= options.repetitions; repetition++) {
      const pairId = JSON.stringify([profile.revision, scenario.id, agent, repetition]);
      for (const condition of ["with", "without"] as const) trials.push({ id: `trial-${trials.length + 1}`, scenario: scenario.id, agent, repetition, pairId, condition });
    }
  }
  // Sandboxed plans use schema 4 so runtimes predating the sandbox refuse to resume them
  // unsandboxed; plans without a sandbox keep schema 3 and their exact historical bytes.
  return { status: "prepared" as const, schemaVersion: (options.sandbox === undefined ? 3 : 4) as 3 | 4, options, profile, candidateRuns: trials.length, trials };
}
