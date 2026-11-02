import type { EvaluationTarget, PreparedTarget } from "../../domain/evaluation.ts";

/** Reads and validates one local target; no installation or host execution. */
export interface EvaluationSource {
  load(target: EvaluationTarget): Promise<PreparedTarget>;
}
