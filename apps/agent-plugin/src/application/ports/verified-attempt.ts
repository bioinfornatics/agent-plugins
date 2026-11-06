import type { EvaluationOptions } from "../../domain/evaluation.ts";
import type { TrialResult } from "../../domain/execution.ts";
import type { JudgeRequest } from "./judge.ts";

export interface AttemptSelection { campaignId: string; attemptId: string }
/** A detached view, issued only after archive and registry verification. Store implementations
 * must authenticate their own reader snapshot rather than trust caller-supplied artifacts. */
export interface VerifiedAttempt extends AttemptSelection {
  metadata: {
    profile: { id: string; name: string; revision: string };
    scenario: { id: string; sourceId: number; skill: string; suite: string };
    agent: string; condition: "with" | "without"; repetition: number; pairId: string;
    receipt: Omit<TrialResult, "artifacts">; options: EvaluationOptions;
    /** Existing source/evidence roots forbidden as export destinations. */
    protectedRoots: string[];
  };
  trialId: string;
  manifestDigest: string;
  evidenceDigest: string;
  request: JudgeRequest;
  artifacts: { path: string; sha256: string; content: Uint8Array }[];
}
export interface VerifiedAttemptReader { readAttempt(selection: AttemptSelection): Promise<VerifiedAttempt> }
