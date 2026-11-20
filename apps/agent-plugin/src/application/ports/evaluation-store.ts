import type { buildMatrix } from "../../domain/evaluation.ts";
import type { ActivationCase } from "../../domain/activation-trial.ts";
import type { TrialRequest, TrialResult } from "../../domain/execution.ts";
/** Schema 3/4 paired evaluation plans; schema 5 activation plans add frozen cases (product §37).
 * `cases` stay plan-only: executors never copy them into TrialRequest. */
export type EvaluationPlan = Omit<ReturnType<typeof buildMatrix>, "schemaVersion"> & {
  schemaVersion: 3 | 4 | 5; mode?: "activation"; queriesSha256?: string; cases?: ActivationCase[];
};
/** Campaign lifecycle: begin, then start before each finish/fail, and close in executor cleanup.
 * Persistence failures reject and stop further admission; fail records a host rejection, not a write error.
 */
export interface ResumedCampaign {
  campaign: { id: string; output: string; registry?: string };
  plan: EvaluationPlan;
  pending: string[];
  completed: number;
  failed: number;
}
export interface EvaluationStore {
  /** Dedicated optional capability keeps unprepared stores/test doubles unchanged. */
  preparation?: import("./retained-fixture.ts").PreparationStorage;
  resume(id: string, retryUncertain: boolean): Promise<ResumedCampaign>;
  begin(plan: EvaluationPlan): Promise<{ id: string; output: string; registry?: string }>;
  start(request: TrialRequest): Promise<void>;
  /** Persist host-supplied artifacts without redaction; no cross-filesystem/database atomicity is promised. */
  finish(request: TrialRequest, result: TrialResult): Promise<void>;
  fail(request: TrialRequest): Promise<void>;
  /** Mark successful orchestration completion (not a semantic score); close alone interrupts. */
  complete(): Promise<void>;
  close(): Promise<void>;
}
