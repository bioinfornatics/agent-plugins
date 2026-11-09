import type { CampaignOverviewHistory } from "../../../application/ports/campaign-overview-history.ts";
import type { JudgmentHistory } from "../../../application/ports/judgment-history.ts";
import type { VerifiedAttemptReader } from "../../../application/ports/verified-attempt.ts";
import type { ExportWriter } from "../../../application/ports/export-writer.ts";
import { exportCampaign, validateExportSelection, type ExportSelection } from "../../../application/use-cases/export-campaign.ts";
import { EvaluationError } from "../../../domain/evaluation.ts";
import type { CliOutput } from "./cli-output.ts";
export type ExportHandler = (input: ExportSelection & { registry?: string }) => Promise<void>;
export function createExportCommandHandler(output: CliOutput, dependencies: {
  createOverviewHistory: (registry?: string) => CampaignOverviewHistory;
  createHistory: (registry?: string) => JudgmentHistory; createReader: (registry?: string) => VerifiedAttemptReader;
  createWriter: (registry?: string) => ExportWriter; now: () => string;
}): ExportHandler {
  return async function handleExportCommand(input) {
    try { validateExportSelection(input); } catch (error) { throw new EvaluationError(error instanceof Error ? error.message : "Invalid export selection"); }
    let result: Awaited<ReturnType<typeof exportCampaign>>;
    try { result = await exportCampaign(input, { overviewHistory: dependencies.createOverviewHistory(input.registry), history: dependencies.createHistory(input.registry), reader: dependencies.createReader(input.registry), writer: dependencies.createWriter(input.registry), now: dependencies.now }); }
    catch { throw new EvaluationError("Unable to export selected verified grades; explicit destination must be new or default report authenticated, selection decisive and bindings intact. No model calls or raw storage diagnostics."); }
    for (const warning of result.warnings ?? []) output.writeErr(`Warning: ${warning}\n`);
    output.writeOut(`Export complete: ${result.kind}; ${result.runs} selected runs${input.output === undefined ? `; ${result.output}` : ""}\n`);
  };
}
