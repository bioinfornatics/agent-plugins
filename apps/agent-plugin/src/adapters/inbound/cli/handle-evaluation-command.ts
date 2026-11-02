import type { CandidateHost } from "../../../application/ports/candidate-host.ts";
import type { EvaluationSource } from "../../../application/ports/evaluation-source.ts";
import type { EvaluationStore } from "../../../application/ports/evaluation-store.ts";
import { executeEvaluation } from "../../../application/use-cases/execute-evaluation.ts";
import { prepareEvaluation } from "../../../application/use-cases/prepare-evaluation.ts";
import { EvaluationError, type EvaluationInput } from "../../../domain/evaluation.ts";
import type { CliOutput } from "./cli-output.ts";

/** CLI command callback: application input plus presentation/execution mode. */
export type EvaluationHandler = (input: EvaluationInput, dryRun: boolean) => Promise<void>;

/** Dependencies stay lazy: dry-run does not construct host or storage resources. */
export interface EvaluationCommandDependencies {
  source: EvaluationSource;
  createHosts: () => ReadonlyMap<string, CandidateHost>;
  createStore: (output?: string, registry?: string) => EvaluationStore;
}

/** Named production handler; presents use-case results and sanitizes peripheral errors. */
export function createEvaluationCommandHandler(
  output: CliOutput,
  dependencies: EvaluationCommandDependencies,
): EvaluationHandler {
  return async function handleEvaluationCommand(input, dryRun) {
    const plan = await prepareEvaluation(input, dependencies.source);
    if (dryRun) { output.writeOut(`${JSON.stringify(plan, null, 2)}\n`); return; }
    let result: Awaited<ReturnType<typeof executeEvaluation>>;
    try {
      result = await executeEvaluation(plan, dependencies.createHosts(), dependencies.createStore(input.output, input.registry));
    } catch {
      // Raw host/storage errors may contain credentials; never render them directly.
      throw new EvaluationError("Campaign preflight or storage failed; no raw configuration diagnostics are exposed");
    }
    output.writeOut(`${JSON.stringify(result, null, 2)}\n`);
    if (result.failed) throw new EvaluationError(`${result.failed} trial(s) failed or had incomplete collection; inspect campaign receipts`);
  };
}
