import type { buildMatrix } from "../../domain/evaluation.ts";
import type { TrialRequest, TrialResult } from "../../domain/execution.ts";
export type EvaluationPlan = ReturnType<typeof buildMatrix>;
/** Campaign lifecycle: begin, then start before each finish/fail, and close in executor cleanup.
 * Persistence failures reject and stop further admission; fail records a host rejection, not a write error.
 */
export interface EvaluationStore {
  begin(plan: EvaluationPlan): Promise<{ id: string; output: string }>;
  start(request: TrialRequest): Promise<void>;
  /** Persist host-supplied artifacts without redaction; no cross-filesystem/database atomicity is promised. */
  finish(request: TrialRequest, result: TrialResult): Promise<void>;
  fail(request: TrialRequest): Promise<void>;
  close(): Promise<void>;
}
