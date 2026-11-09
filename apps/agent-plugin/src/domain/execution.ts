import type { EvaluationOptions, EvaluationProfile, Scenario } from "./evaluation.ts";
export interface HostIdentity { id: string; version: string }
export interface TrialRequest {
  id: string; trialId: string; pairId: string; agent: string; condition: "with" | "without";
  /** Runtime task/workspace are detached from the frozen scenario. */
  runtime?: import("./retained-preparation.ts").PreparationProof;
  profile: EvaluationProfile; scenario: Scenario; options: EvaluationOptions;
}
/** Process outcome and evidence completeness are independent; neither implies a judged task success. */
export interface TrialResult {
  model?: import("./candidate-model.ts").CandidateModelEvidence;
  status: "completed" | "nonzero" | "timeout";
  exitCode: number | null; sessionName: string; collection: "complete" | "partial" | "unavailable";
  startedAt: string; finishedAt: string; host: HostIdentity;
  /** Host-collected bytes, already redacted for known credentials; storage does not redact them. */
  artifacts: { path: string; content: Uint8Array }[];
  /** Storage-owned authentication of pre-host preparation; never trusted from host input. */
  preparationDigest?: string;
  limitations: string[];
}
export interface CampaignResult { id: string; output: string; registry?: string; completed: number; failed: number; total: number }
