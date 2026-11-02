import type { EvaluationOptions, EvaluationProfile, Scenario } from "./evaluation.ts";
export interface HostIdentity { id: string; version: string }
export interface TrialRequest {
  id: string; pairId: string; agent: string; condition: "with" | "without";
  profile: EvaluationProfile; scenario: Scenario; options: EvaluationOptions;
}
/** Process outcome and evidence completeness are independent; neither implies a judged task success. */
export interface TrialResult {
  status: "completed" | "nonzero" | "timeout";
  exitCode: number | null; sessionName: string; collection: "complete" | "partial" | "unavailable";
  startedAt: string; finishedAt: string; host: HostIdentity;
  /** Host-collected bytes, already redacted for known credentials; storage does not redact them. */
  artifacts: { path: string; content: Uint8Array }[];
  limitations: string[];
}
export interface CampaignResult { id: string; output: string; registry?: string; completed: number; failed: number; total: number }
