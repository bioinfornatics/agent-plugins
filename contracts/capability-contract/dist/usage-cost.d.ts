import { type UsageCostDelta, type UsageCostDiagnostic, type UsageCostEvidence, type UsageCostValidation } from "./usage-cost-types.js";
export declare function validateUsageCostInput(value: unknown): UsageCostValidation;
export declare class UsageCostValidationError extends Error {
    readonly diagnostics: UsageCostDiagnostic[];
    constructor(diagnostics: UsageCostDiagnostic[]);
}
export declare function computeUsageCostEvidence(value: unknown): UsageCostEvidence;
export declare function computePairedUsageCostDelta(baseline: UsageCostEvidence, candidate: UsageCostEvidence): UsageCostDelta;
