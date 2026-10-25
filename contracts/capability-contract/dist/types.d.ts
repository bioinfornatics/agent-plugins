export declare const CAPABILITY_CONTRACT_VERSION: "1.0.0";
export declare const CAPABILITY_CONTRACT_SCHEMA_ID: "https://agent-plugins.org/schemas/capability-contract/1.0.0/capability-contract.schema.json";
export type CapabilityCandidateType = "skill" | "agent" | "hook" | "plugin";
export type UnknownFieldPolicy = "reject" | "preserve";
export type ProductionLevel = "exploration" | "prototype" | "internal" | "production";
export type SuccessOperator = "<" | "<=" | "=" | ">=" | ">";
export type SideEffectKind = "filesystem" | "process" | "network" | "credential" | "external-system" | "other";
export interface CompatibilityPolicy {
    unknownFields: UnknownFieldPolicy;
}
export interface CapabilityUser {
    name: string;
    need?: string;
}
export interface CapabilityValue {
    name: string;
    description: string;
    required: boolean;
    format?: string;
}
export interface ArtifactRecommendation {
    candidateType: CapabilityCandidateType;
    rationale?: string;
}
export interface CapabilitySideEffect {
    kind: SideEffectKind;
    description: string;
    mitigation?: string;
}
export interface SideEffectDeclaration {
    applicable: boolean;
    effects: CapabilitySideEffect[];
}
export interface SuccessSignal {
    name: string;
    metric: string;
    operator: SuccessOperator;
    target: number;
    unit?: string;
}
export interface ProductionBoundary {
    level: ProductionLevel;
    statement: string;
    conditions: string[];
    excludedUses: string[];
}
/** Canonical normalized representation. Unknown root fields exist only under preserve policy. */
export interface CapabilityContractV1 {
    schemaVersion: typeof CAPABILITY_CONTRACT_VERSION;
    compatibility: CompatibilityPolicy;
    objective: string;
    users: CapabilityUser[];
    targetTasks: string[];
    artifactRecommendation: ArtifactRecommendation;
    inputs: CapabilityValue[];
    outputs: CapabilityValue[];
    sideEffects: SideEffectDeclaration;
    constraints: string[];
    assumptions: string[];
    risks: string[];
    successSignals: SuccessSignal[];
    targetHosts: string[];
    productionBoundary: ProductionBoundary;
    [futureField: string]: unknown;
}
export type CapabilityDiagnosticCode = "CAPABILITY_CONTRACT_NOT_OBJECT" | "CAPABILITY_VERSION_REQUIRED" | "CAPABILITY_VERSION_UNSUPPORTED" | "CAPABILITY_COMPATIBILITY_REQUIRED" | "CAPABILITY_OBJECTIVE_REQUIRED" | "CAPABILITY_ARTIFACT_RECOMMENDATION_REQUIRED" | "CAPABILITY_SIDE_EFFECTS_REQUIRED" | "CAPABILITY_SIDE_EFFECT_DETAILS_REQUIRED" | "CAPABILITY_SUCCESS_SIGNAL_REQUIRED" | "CAPABILITY_PRODUCTION_BOUNDARY_REQUIRED" | "CAPABILITY_PRODUCTION_CONDITIONS_REQUIRED" | "CAPABILITY_UNKNOWN_FIELD" | "CAPABILITY_FIELD_INVALID";
export interface CapabilityDiagnostic {
    code: CapabilityDiagnosticCode;
    path: string;
    message: string;
    remediation: string;
}
export interface CapabilityValidationResult {
    valid: boolean;
    diagnostics: CapabilityDiagnostic[];
}
