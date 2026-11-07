import type { JudgeInstructionLocation } from "./judge-instructions.ts";
import type { JudgeProvenance, JudgeRequest } from "./judge.ts";
import type { VerifiedAttempt } from "./verified-attempt.ts";
import type { JudgmentOutcome } from "../../domain/judgment.ts";
export interface GradingResult { outcome: JudgmentOutcome; provenance: JudgeProvenance | null }
export interface StoredGrading { id: string; result: GradingResult }
export interface JudgmentStore {
  /** Authenticate snapshot and preflight all immutable append columns/options before resolving destination; no writes. Optional for historical/mock stores. */
  prepareInstructions?(id: string, attempt: VerifiedAttempt, options?: JudgeRequest["options"]): Promise<JudgeInstructionLocation>;
  appendJudgment(id: string, attempt: VerifiedAttempt, result: GradingResult, options?: JudgeRequest["options"]): Promise<StoredGrading>;
}
