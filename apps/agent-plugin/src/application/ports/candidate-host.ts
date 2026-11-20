import type { ConfiguredCandidateModel } from "../../domain/candidate-model.ts";
import type { CandidateToolMode } from "../../domain/candidate-tooling.ts";
import type { CandidateSandbox, EvaluationOptions, EvaluationProfile } from "../../domain/evaluation.ts";
import type { TrialRequest, TrialResult } from "../../domain/execution.ts";
export interface CandidateHost {
  /** Capture configuration once for new campaigns; resume never consults current defaults. */
  resolveModel?(options: EvaluationOptions): Promise<ConfiguredCandidateModel>;
  /** Capture tool exposure (e.g. Goose code mode) once for new campaigns; `run` must refuse drift. */
  resolveToolMode?(): Promise<CandidateToolMode>;
  /** OS sandboxes this host can apply to candidate runs; absent means none. */
  readonly sandboxes?: readonly CandidateSandbox[];
  /** Check transport/configuration support before campaign creation; reject if unsupported.
   * Receives the frozen options so a requested sandbox is probed before any trial. */
  preflight(profile: EvaluationProfile, options?: EvaluationOptions): Promise<void>;
  /** Return process/collection outcomes; reject preparation or launch failures. Artifacts must be safe to persist. */
  run(request: TrialRequest): Promise<TrialResult>;
}
