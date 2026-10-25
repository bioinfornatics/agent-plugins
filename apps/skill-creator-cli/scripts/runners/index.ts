// Select a non-interactive runner for skill evaluation.
import { RunnerError } from "./base.js";
import type { Runner } from "./base.js";
import { GooseRunner } from "./goose.js";

export { RunnerError } from "./base.js";
export { PairedExecutionError } from "./paired.js";
export type { Runner } from "./base.js";
export type { PairedRunner, PairedExecutionPlan, PairedExecutionResult } from "./paired.js";

const RUNNERS: Record<string, new (command?: string) => Runner> = {
  goose: GooseRunner,
};

export function createRunner(name?: string): Runner {
  const runnerName = name || process.env.SKILL_CREATOR_RUNNER || "goose";
  const RunnerClass = RUNNERS[runnerName];
  if (!RunnerClass) {
    const supported = Object.keys(RUNNERS).sort().join(", ");
    throw new RunnerError(`Unsupported runner '${runnerName}'. Supported runners: ${supported}`);
  }
  return new RunnerClass();
}
