import type { EvaluationOptions } from "../../domain/evaluation.ts";

export interface CampaignOverviewSnapshot {
  campaignId: string;
  profile: { id: string; name: string; revision: string };
  options: EvaluationOptions;
  trials: { trialId: string; sequence: number; scenarioId: string;
    source: { skillName: string; pluginName?: string }; agent: string; repetition: number;
    pairId: string; condition: "with" | "without"; status: string;
    attemptId: string | null; attemptStatus: string | null }[];
}
/** Frozen plan coordinates and current logical bindings only. No archive reads,
 * receipts, migrations, source rediscovery or implicit latest-attempt selection. */
export interface CampaignOverviewHistory {
  overview(campaignId: string): Promise<CampaignOverviewSnapshot>;
}
