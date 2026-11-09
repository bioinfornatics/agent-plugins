import { exportCampaign, validateExportSelection } from "../../../application/use-cases/export-campaign.js";
import { EvaluationError } from "../../../domain/evaluation.js";
export function createExportCommandHandler(output, dependencies) {
    return async function handleExportCommand(input) {
        try {
            validateExportSelection(input);
        }
        catch (error) {
            throw new EvaluationError(error instanceof Error ? error.message : "Invalid export selection");
        }
        let result;
        try {
            result = await exportCampaign(input, { overviewHistory: dependencies.createOverviewHistory(input.registry), history: dependencies.createHistory(input.registry), reader: dependencies.createReader(input.registry), writer: dependencies.createWriter(input.registry), now: dependencies.now });
        }
        catch {
            throw new EvaluationError("Unable to export selected verified grades; explicit destination must be new or default report authenticated, selection decisive and bindings intact. No model calls or raw storage diagnostics.");
        }
        for (const warning of result.warnings ?? [])
            output.writeErr(`Warning: ${warning}\n`);
        output.writeOut(`Export complete: ${result.kind}; ${result.runs} selected runs${input.output === undefined ? `; ${result.output}` : ""}\n`);
    };
}
