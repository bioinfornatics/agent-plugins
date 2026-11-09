import type { ConfiguredCandidateModel } from "../../domain/candidate-model.ts";
import type { EvaluationOptions, EvaluationProfile } from "../../domain/evaluation.ts";
import type { TrialRequest, TrialResult } from "../../domain/execution.ts";
export interface CandidateHost {
  /** Capture configuration once for new campaigns; resume never consults current defaults. */
  resolveModel?(options: EvaluationOptions): Promise<ConfiguredCandidateModel>;
  /** Check transport/configuration support before campaign creation; reject if unsupported. */
  preflight(profile: EvaluationProfile): Promise<void>;
  /** Return process/collection outcomes; reject preparation or launch failures. Artifacts must be safe to persist. */
  run(request: TrialRequest): Promise<TrialResult>;
}
