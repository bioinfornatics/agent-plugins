import type { EvaluationOptions } from "../../domain/evaluation.ts";
import type { ActivationTreatment } from "./activation-observer.ts";
import type { ActivationCase } from "../../domain/activation-trial.ts";

export interface CampaignOverviewSnapshot {
  campaignId: string;
  /** Stored campaign directory; optional only for legacy explicit-export adapters. */
  output?: string;
  profile: { id: string; name: string; revision: string };
  options: EvaluationOptions;
  /** Frozen profile SKILL.md text for activation attribution; absent from legacy explicit adapters. */
  treatment?: ActivationTreatment;
  /** Present only for schema-5 activation campaigns (product §37); export refuses them. */
  mode?: "activation";
  activationCases?: ActivationCase[];
  trials: { trialId: string; sequence: number; scenarioId: string;
    source: { skillName: string; pluginName?: string }; agent: string; repetition: number;
    pairId: string; condition: "with" | "without"; status: string;
    attemptId: string | null; attemptStatus: string | null }[];
}
/** Frozen plan coordinates/options (including optional configured candidate models)
 * and current logical bindings only. No archive reads,
 * receipts, migrations, source rediscovery or implicit latest-attempt selection. */
export interface CampaignOverviewHistory {
  overview(campaignId: string): Promise<CampaignOverviewSnapshot>;
}
