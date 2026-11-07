import type { JudgeInstructionArtifact, JudgeInstructionLocation } from "./judge-instructions.ts";
import type { JudgmentArtifact, JudgmentCriterion, JudgmentOutcome } from "../../domain/judgment.ts";

/** Artifacts are caller-preverified text/hash bindings, never paths for the judge to open.
 * Identity-bearing paths and criterion IDs are translated to neutral aliases by the adapter.
 */
export interface JudgeRequest {
  /** Versioned archive + frozen-input projection; absence preserves historical archive-only grading. */
  evidenceVersion?: 2;
  /** Authenticated retained preparation for archive-independent storage; never sent to Judge evidence JSON. */
  preparation?: import("../../domain/retained-preparation.ts").PreparationProof;
  instructionLocation?: JudgeInstructionLocation;
  task: string;
  expectedOutput?: string;
  criteria: JudgmentCriterion[];
  artifacts: JudgmentArtifact[];
  options?: { model?: string; maxTurns?: number; timeout?: number };
}
export interface JudgeProvenance {
  host: { id: "goose"; version?: string };
  model: { requested?: string; source: "override" | "configuration-default"; effective: "unknown" };
  limits: { maxTurns: number; timeout: number; preflightTimeout: number; exportTimeout: number; outputBytes: number };
  packetVersion?: 2;
  evidenceManifestSha256?: string;
  sessionName?: string;
  instructionsSha256?: string;
  instructionArtifact?: JudgeInstructionArtifact;
}
export interface JudgeResult { outcome: JudgmentOutcome; provenance: JudgeProvenance }
export interface Judge { judge(request: JudgeRequest): Promise<JudgeResult> }
