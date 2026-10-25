import type { EvaluationDiagnostic } from "./evaluation-types.js";
import { type EvaluationMatrixPlanV1_1, type EvaluationResolutionContext, type EvaluationResolutionReceipt } from "./evaluation-matrix-types.js";
export declare function validateEvaluationMatrixPlan(value: unknown): {
    valid: boolean;
    diagnostics: EvaluationDiagnostic[];
};
export declare function normalizeEvaluationMatrixPlan(value: unknown): EvaluationMatrixPlanV1_1;
export declare function canonicalSerializeEvaluationMatrixPlan(value: unknown): string;
export declare function hashEvaluationMatrixPlan(value: unknown): string;
export declare function resolveEvaluationJobs(value: unknown, context: EvaluationResolutionContext): EvaluationResolutionReceipt;
