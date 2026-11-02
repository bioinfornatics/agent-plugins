import type { EvaluationInput } from "../../../domain/evaluation.ts";

/** CLI command callback: application input plus presentation/execution mode. */
export type EvaluationHandler = (input: EvaluationInput, dryRun: boolean) => Promise<void>;
