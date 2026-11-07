/** Execution-only destination. Never include this attribution in the blinded evidence packet. */
export interface JudgeInstructionLocation {
  path: string;
  gradeId: string;
  campaignId: string;
  attemptId: string;
}
export interface JudgeInstructionArtifact extends JudgeInstructionLocation { sha256: string }
/** Persist exact UTF-8 instructions exclusively, after the Judge's credential discovery/checks.
 * Implementations retain the file independently of the host's temporary HOME lifecycle. */
export interface JudgeInstructionWriter {
  write(location: JudgeInstructionLocation, instructions: string, bundle?: JudgeEvidenceBundle): Promise<JudgeInstructionArtifact>;
}

/** Neutral immutable copies only; original source paths never enter the reader manifest. */
export interface JudgeEvidenceBundle {
  manifest: string;
  files: { name: string; text: string; sha256: string }[];
}
