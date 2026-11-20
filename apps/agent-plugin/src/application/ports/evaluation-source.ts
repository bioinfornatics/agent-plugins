import type { EvaluationTarget, PreparedTarget } from "../../domain/evaluation.ts";

/** Reads and validates one local target; no installation or host execution. */
export interface EvaluationSource {
  /** Deterministic content identity; adapters own the hashing implementation. */
  fingerprint(value: string): string;
  /** `suites: false` (activation trials) reads no evals.json and returns no scenarios. */
  load(target: EvaluationTarget, options?: { suites?: boolean }): Promise<PreparedTarget>;
}
