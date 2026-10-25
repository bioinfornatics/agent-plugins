import { type CapabilityContractV1, type CapabilityDiagnostic, type CapabilityValidationResult } from "./types.js";
export declare function validateCapabilityContract(value: unknown): CapabilityValidationResult;
export declare class CapabilityContractValidationError extends Error {
    readonly diagnostics: CapabilityDiagnostic[];
    constructor(diagnostics: CapabilityDiagnostic[]);
}
/** Validate first, then apply deterministic defaults. Invalid or rejected fields are never silently dropped. */
export declare function normalizeCapabilityContract(value: unknown): CapabilityContractV1;
