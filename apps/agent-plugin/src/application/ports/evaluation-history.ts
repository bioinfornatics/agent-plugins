import type { EvaluationOptions } from "../../domain/evaluation.ts";

export interface CampaignSummary {
  id: string; profileId: string; profileName: string; revision: string; createdAt: string;
  status: string; total: number; finalized: number; uncertain: number; output: string;
  score: null;
}
export interface CampaignInspection extends CampaignSummary {
  options: EvaluationOptions;
  trials: { id: string; sequence: number; status: string; attemptId: string | null }[];
  attempts: { id: string; trialId: string; condition: string; scenario: string; status: string;
    collection: string; receipt: unknown; evidence: { path: string; sha256: string; bytes: number; available: boolean }[] }[];
}
/** Read-only campaign discovery; no migration, agent calls or implicit registry creation. */
export interface EvaluationHistory {
  list(profileId?: string): Promise<CampaignSummary[]>;
  inspect(campaignId: string): Promise<CampaignInspection>;
}
