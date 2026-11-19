import { assertSafeFixtureValue } from "../../../domain/retained-preparation.js";
import { assertExecutableScenarios } from "../../../domain/scenario-import.js";
import { executeEvaluation } from "../../../application/use-cases/execute-evaluation.js";
import { prepareEvaluation } from "../../../application/use-cases/prepare-evaluation.js";
import { baselineIsolationRisks } from "../../../domain/baseline-isolation.js";
import { EvaluationError } from "../../../domain/evaluation.js";
/** Named production handler; presents use-case results and sanitizes peripheral errors. */
export function createEvaluationCommandHandler(output, dependencies) {
    return async function handleEvaluationCommand(input, dryRun, resume) {
        const plan = resume ? undefined : await prepareEvaluation(input, dependencies.source);
        for (const path of [input.output, input.registry])
            if (path !== undefined)
                assertSafeFixtureValue(path);
        if (resume && dryRun)
            throw new EvaluationError("--resume cannot be combined with --dry-run");
        // Advisory only (stderr): the plan, its revision and stdout JSON stay unchanged.
        for (const risk of plan ? baselineIsolationRisks(plan.profile) : []) {
            output.writeErr(`Warning: ${risk.scenarioId} prompt names profile Skill path ${risk.skillDirectory}/SKILL.md; the baseline arm may read a real copy (same UID, no OS sandbox); activation export flags contamination\n`);
        }
        if (dryRun) {
            output.writeOut(`${JSON.stringify(plan, null, 2)}\n`);
            return;
        }
        if (plan)
            assertExecutableScenarios(plan.profile.scenarios);
        let result;
        try {
            result = await executeEvaluation(plan, dependencies.createHosts(), dependencies.createStore(input.output, input.registry), dependencies.newAttemptId, resume, dependencies.fixtureIO);
        }
        catch (error) {
            // EvaluationError messages are authored user-facing diagnostics (unknown agent,
            // invalid limits, unknown campaign); keep them. Foreign host/storage errors may
            // contain credentials or paths; never render them directly.
            if (error instanceof EvaluationError)
                throw error;
            throw new EvaluationError("Campaign execution, recovery or storage failed; inspect receipts; uncertain attempts require explicit --retry-uncertain");
        }
        output.writeOut(`${JSON.stringify(result, null, 2)}\n`);
        if (result.failed)
            throw new EvaluationError(`${result.failed} trial(s) failed or had incomplete collection; inspect campaign receipts`);
    };
}
