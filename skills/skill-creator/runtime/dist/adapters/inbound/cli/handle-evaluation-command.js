import { executeEvaluation } from "../../../application/use-cases/execute-evaluation.js";
import { prepareEvaluation } from "../../../application/use-cases/prepare-evaluation.js";
import { EvaluationError } from "../../../domain/evaluation.js";
/** Named production handler; presents use-case results and sanitizes peripheral errors. */
export function createEvaluationCommandHandler(output, dependencies) {
    return async function handleEvaluationCommand(input, dryRun, resume) {
        const plan = resume ? undefined : await prepareEvaluation(input, dependencies.source);
        if (resume && dryRun)
            throw new EvaluationError("--resume cannot be combined with --dry-run");
        if (dryRun) {
            output.writeOut(`${JSON.stringify(plan, null, 2)}\n`);
            return;
        }
        let result;
        try {
            result = await executeEvaluation(plan, dependencies.createHosts(), dependencies.createStore(input.output, input.registry), dependencies.newAttemptId, resume);
        }
        catch {
            // Raw host/storage errors may contain credentials; never render them directly.
            throw new EvaluationError("Campaign execution, recovery or storage failed; inspect receipts; uncertain attempts require explicit --retry-uncertain");
        }
        output.writeOut(`${JSON.stringify(result, null, 2)}\n`);
        if (result.failed)
            throw new EvaluationError(`${result.failed} trial(s) failed or had incomplete collection; inspect campaign receipts`);
    };
}
