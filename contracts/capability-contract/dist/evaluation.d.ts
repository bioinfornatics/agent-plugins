import { type EvaluationDiagnostic, type EvaluationPlanV1, type EvaluationProfileName, type EvaluationValidationResult } from "./evaluation-types.js";
export declare function canonicalJsonEqual(left: unknown, right: unknown): boolean;
export declare function validateEvaluationPlan(value: unknown): EvaluationValidationResult;
export declare class EvaluationPlanValidationError extends Error {
    readonly diagnostics: EvaluationDiagnostic[];
    constructor(diagnostics: EvaluationDiagnostic[]);
}
export declare function normalizeEvaluationPlan(value: unknown): EvaluationPlanV1;
export declare function canonicalSerializeEvaluationPlan(value: unknown): string;
export declare function hashEvaluationPlan(value: unknown): string;
/** Creates references into an existing creator eval document; scenario bodies remain authoritative there. */
export declare function adaptCreatorEvalsToEvaluationPlan(value: unknown, source: string, profile?: EvaluationProfileName): EvaluationPlanV1;
