import type { JudgeRequest } from "./judge.ts";

export interface AttemptSelection { campaignId: string; attemptId: string }
/** A detached view, issued only after archive and registry verification. Store implementations
 * must authenticate their own reader snapshot rather than trust caller-supplied artifacts. */
export interface VerifiedAttempt extends AttemptSelection {
  trialId: string;
  manifestDigest: string;
  evidenceDigest: string;
  request: JudgeRequest;
  artifacts: { path: string; sha256: string; content: Uint8Array }[];
}
export interface VerifiedAttemptReader { readAttempt(selection: AttemptSelection): Promise<VerifiedAttempt> }
