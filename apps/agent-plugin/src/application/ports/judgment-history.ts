import type { JudgeProvenance } from "./judge.ts";
import type { AttemptSelection } from "./verified-attempt.ts";
import type { JudgmentOutcome } from "../../domain/judgment.ts";

/** Stored bindings are validated without reopening candidate archives. No score is inferred. */
export interface JudgmentRecord extends AttemptSelection {
  id: string; trialId: string; createdAt: string;
  manifestDigest: string; evidenceDigest: string; requestDigest: string;
  status: JudgmentOutcome["status"]; outcome: JudgmentOutcome; provenance: JudgeProvenance | null;
  verification: { storedBindings: "validated"; archives: "not-reverified" };
}
export interface JudgmentHistory {
  list(selection: { campaignId: string; attemptId?: string }): Promise<JudgmentRecord[]>;
}
