import type { JudgeProvenance, JudgeRequest } from "./judge.ts";
import type { VerifiedAttempt } from "./verified-attempt.ts";
import type { JudgmentOutcome } from "../../domain/judgment.ts";
export interface GradingResult { outcome: JudgmentOutcome; provenance: JudgeProvenance | null }
export interface StoredGrading { id: string; result: GradingResult }
export interface JudgmentStore {
  appendJudgment(id: string, attempt: VerifiedAttempt, result: GradingResult, options?: JudgeRequest["options"]): Promise<StoredGrading>;
}
