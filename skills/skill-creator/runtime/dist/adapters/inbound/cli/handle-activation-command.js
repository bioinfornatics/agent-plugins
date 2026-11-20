import { prepareActivationTrials, runActivationTrials } from "../../../application/use-cases/run-activation-trials.js";
import { EvaluationError } from "../../../domain/evaluation.js";
import { assertSafeFixtureValue } from "../../../domain/retained-preparation.js";
/** Dry-run output: frozen identities, options and expectations; never query text or captured file bytes. */
export function activationPlanSummary(plan) {
    return { status: plan.status, schemaVersion: plan.schemaVersion, mode: plan.mode, queriesSha256: plan.queriesSha256,
        profile: { id: plan.profile.id, name: plan.profile.name, revision: plan.profile.revision, components: plan.profile.components.map(({ kind, root, installationName, skillRoots }) => ({ kind, root, installationName, skillRoots })) },
        options: plan.options, cases: plan.cases, candidateRuns: plan.candidateRuns, trials: plan.trials };
}
const rate = (value) => value === null ? "-" : value.toFixed(2);
/** Concise table: case IDs only, never query text. */
export function formatActivationTable(result, location) {
    const { header, summary } = result;
    const lines = [`Activation campaign ${header.campaignId}: host ${header.host.id} ${header.host.version ?? "unknown"}, threshold ${header.threshold}, repetitions ${header.repetitions}`,
        ["case", "expected", "triggered/decisive", "rate", "result"].join("\t")];
    for (const item of result.cases) {
        const triggered = item.runs.filter(run => run.outcome === "triggered").length;
        const decisive = item.runs.filter(run => run.outcome === "triggered" || run.outcome === "not-triggered").length;
        lines.push([item.id, item.shouldTrigger ? "trigger" : "no-trigger", `${triggered}/${decisive}`, rate(item.triggerRate), item.unresolved ? "unresolved" : item.pass ? "pass" : "fail"].join("\t"));
    }
    lines.push(`Summary: tp ${summary.tp}, fp ${summary.fp}, tn ${summary.tn}, fn ${summary.fn}, unresolved ${summary.unresolved}; precision ${rate(summary.precision)}; recall ${rate(summary.recall)}`, `Result: ${location}`);
    return `${lines.join("\n")}\n`;
}
/** Named production handler: prepare or resume, execute, present; foreign errors are sanitized. */
export function createActivationCommandHandler(output, dependencies) {
    return async function handleActivationCommand(input, mode) {
        for (const path of [input.output, input.registry])
            if (path !== undefined)
                assertSafeFixtureValue(path);
        if (mode.resume && mode.dryRun)
            throw new EvaluationError("--resume cannot be combined with --dry-run");
        const plan = mode.resume ? undefined : await prepareActivationTrials(input, dependencies.source, dependencies.caseSource);
        if (mode.dryRun) {
            output.writeOut(`${JSON.stringify(plan && activationPlanSummary(plan), null, 2)}\n`);
            return;
        }
        let run;
        try {
            run = await runActivationTrials(plan, { hosts: dependencies.createHosts(), store: dependencies.createStore(input.output, input.registry), newAttemptId: dependencies.newAttemptId,
                history: dependencies.createHistory(input.registry), reader: dependencies.createReader(input.registry), observer: dependencies.observer, writer: dependencies.writer }, mode.resume);
        }
        catch (error) {
            // Authored diagnostics (mode mismatch, limits, unknown campaign) stay; host/storage errors may hold secrets or paths.
            if (error instanceof EvaluationError)
                throw error;
            throw new EvaluationError("Activation execution, verification or result publication failed; inspect receipts; uncertain attempts require explicit --retry-uncertain");
        }
        output.writeOut(mode.json ? `${JSON.stringify(run.result, null, 2)}\n` : formatActivationTable(run.result, run.location));
        if (run.campaign.failed)
            throw new EvaluationError(`${run.campaign.failed} trial(s) failed or had incomplete collection; their cases are unresolved; inspect campaign receipts`);
    };
}
