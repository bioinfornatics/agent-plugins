import type { EvaluationTarget, PreparedTarget } from "../../domain/evaluation.ts";

/** Reads and validates one local target; no installation or host execution. */
export interface EvaluationSource {
  /** Deterministic content identity; adapters own the hashing implementation. */
  fingerprint(value: string): string;
  load(target: EvaluationTarget): Promise<PreparedTarget>;
}
