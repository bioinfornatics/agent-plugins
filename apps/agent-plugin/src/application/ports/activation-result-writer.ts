import type { ActivationRunResult } from "../../domain/activation-trial.ts";

/** Publishes the derived activation result beside the campaign evidence; returns its path. */
export interface ActivationResultWriter {
  write(campaignDirectory: string, result: ActivationRunResult): Promise<string>;
}
