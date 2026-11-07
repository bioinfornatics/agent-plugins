import { assertSafeFixtureValue } from "../../../domain/retained-preparation.ts";
import { assertExecutableScenarios } from "../../../domain/scenario-import.ts";
import type { CandidateHost } from "../../../application/ports/candidate-host.ts";
import type { EvaluationSource } from "../../../application/ports/evaluation-source.ts";
import type { EvaluationStore } from "../../../application/ports/evaluation-store.ts";
import { executeEvaluation } from "../../../application/use-cases/execute-evaluation.ts";
import { prepareEvaluation } from "../../../application/use-cases/prepare-evaluation.ts";
import { EvaluationError, type EvaluationInput } from "../../../domain/evaluation.ts";
import type { CliOutput } from "./cli-output.ts";

/** CLI command callback: application input plus presentation/execution mode. */
export type EvaluationHandler = (input: EvaluationInput, dryRun: boolean, resume?: { id: string; retryUncertain: boolean }) => Promise<void>;

/** Dependencies stay lazy: dry-run does not construct host or storage resources. */
export interface EvaluationCommandDependencies {
  fixtureIO?: import("../../../application/ports/retained-fixture.ts").RetainedFixtureIO;
  source: EvaluationSource;
  newAttemptId: () => string;
  createHosts: () => ReadonlyMap<string, CandidateHost>;
  createStore: (output?: string, registry?: string) => EvaluationStore;
}

/** Named production handler; presents use-case results and sanitizes peripheral errors. */
export function createEvaluationCommandHandler(
  output: CliOutput,
  dependencies: EvaluationCommandDependencies,
): EvaluationHandler {
  return async function handleEvaluationCommand(input, dryRun, resume) {
    const plan = resume ? undefined : await prepareEvaluation(input, dependencies.source);
    for (const path of [input.output, input.registry]) if (path !== undefined) assertSafeFixtureValue(path);
    if (resume && dryRun) throw new EvaluationError("--resume cannot be combined with --dry-run");
    if (dryRun) { output.writeOut(`${JSON.stringify(plan, null, 2)}\n`); return; }
    if (plan) assertExecutableScenarios(plan.profile.scenarios);
    let result: Awaited<ReturnType<typeof executeEvaluation>>;
    try {
      result = await executeEvaluation(plan, dependencies.createHosts(), dependencies.createStore(input.output, input.registry), dependencies.newAttemptId, resume, dependencies.fixtureIO);
    } catch {
      // Raw host/storage errors may contain credentials; never render them directly.
      throw new EvaluationError("Campaign execution, recovery or storage failed; inspect receipts; uncertain attempts require explicit --retry-uncertain");
    }
    output.writeOut(`${JSON.stringify(result, null, 2)}\n`);
    if (result.failed) throw new EvaluationError(`${result.failed} trial(s) failed or had incomplete collection; inspect campaign receipts`);
  };
}
