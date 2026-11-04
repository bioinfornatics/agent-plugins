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
  repetitions: number;
  maxTurns: number;
  /** Seconds; 0 disables the candidate-run deadline, not host preflight/collection deadlines. */
  timeout: number;
  /** Maximum active candidate trials; persistence is serialized independently. */
  parallelism: number;
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

export function validateOptions(input: EvaluationInput): void {
  if (input.profileName !== undefined && (!input.profileName.trim() || input.profileName.length > 200)) throw new EvaluationError("--profile-name must contain 1 to 200 characters");
  if (!input.skills.length && !input.plugins.length) throw new EvaluationError("Select --skills or --plugin");
  for (const [name, value, minimum] of [
    ["--repetitions", input.repetitions, 1], ["--max-turns", input.maxTurns, 1],
    ["--timeout", input.timeout, 0], ["--parallelism", input.parallelism, 1],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < minimum) throw new EvaluationError(`${name} must be a safe integer >= ${minimum}`);
  }
  for (const agent of input.agents) {
    if (!["goose", "claude", "codex"].includes(agent)) throw new EvaluationError(`Unsupported --agent: ${agent}`);
  }
  if (!input.agents.length) throw new EvaluationError("Select at least one --agent");
  if (input.model !== undefined && !input.model.trim()) throw new EvaluationError("--model must not be empty");
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
  return { status: "prepared" as const, schemaVersion: 3 as const, options, profile, candidateRuns: trials.length, trials };
}
