/** Preparation data only; limits are requested, never claimed as enforced. */
export type TargetKind = "skill" | "plugin";
export interface EvaluationTarget { kind: TargetKind; root: string }
export interface Scenario {
  id: string;
  sourceId: number;
  skill: string;
  suite: string;
  prompt: string;
  expectations: string[];
  fixtures?: string;
}
export interface EvaluationOptions {
  agents: string[];
  model?: string;
  repetitions: number;
  maxTurns: number;
  timeout: number;
  parallelism: number;
}
export interface PreparedTarget extends EvaluationTarget { scenarios: Scenario[] }
export interface EvaluationInput extends EvaluationOptions { skills: string[]; plugins: string[] }
export class EvaluationError extends Error {}

export function validateOptions(input: EvaluationInput): void {
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

export function buildMatrix(targets: PreparedTarget[], options: EvaluationOptions) {
  const trials: { target: number; scenario: string; agent: string; repetition: number; pairId: string; condition: "with" | "without" }[] = [];
  targets.forEach((target, index) => {
    for (const scenario of target.scenarios) for (const agent of options.agents) {
      for (let repetition = 1; repetition <= options.repetitions; repetition++) {
        const pairId = JSON.stringify([index, scenario.id, agent, repetition]);
        for (const condition of ["with", "without"] as const) trials.push({ target: index, scenario: scenario.id, agent, repetition, pairId, condition });
      }
    }
  });
  return { status: "prepared" as const, options, targets, candidateRuns: trials.length, trials };
}
