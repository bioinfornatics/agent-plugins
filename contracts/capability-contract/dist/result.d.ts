import { type CreatorName, type LegacyMapResult, type LegacyStatusContext, type LegacyStatusMapping, type NormalizedResultContractV1, type ResultDiagnostic, type ResultExit, type ResultValidation } from "./result-types.js";
export declare function validateResultContract(value: unknown): ResultValidation;
export declare class ResultContractValidationError extends Error {
    readonly diagnostics: ResultDiagnostic[];
    constructor(diagnostics: ResultDiagnostic[]);
}
export declare function normalizeResultContract(value: unknown): NormalizedResultContractV1;
export declare function aggregateResultContracts(values: readonly unknown[]): NormalizedResultContractV1;
export declare function classifyResultExit(value: unknown, options?: {
    invalidUsage?: boolean;
}): ResultExit;
export declare const LEGACY_STATUS_MAPPINGS: readonly LegacyStatusMapping[];
export declare function mapLegacyStatus(input: {
    creator?: CreatorName;
    context?: LegacyStatusContext;
    token: string | number | boolean;
}): LegacyMapResult;
