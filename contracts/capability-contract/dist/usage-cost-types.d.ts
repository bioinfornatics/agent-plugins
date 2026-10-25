export declare const USAGE_COST_EVIDENCE_VERSION: "1.0.0";
export declare const USAGE_COST_EVIDENCE_SCHEMA_ID: "https://agent-plugins.org/schemas/goose-usage-cost-evidence/1.0.0/goose-usage-cost-evidence.schema.json";
export type UsageMeasurementUnavailableReason = "not-exposed" | "not-applicable" | "provider-omitted" | "adapter-omitted";
export type LatencyUnavailableReason = UsageMeasurementUnavailableReason;
export type CostUnavailableReason = "pricing-unavailable" | "pricing-incomplete" | "pricing-incompatible" | "currency-incompatible";
export type QualityUnavailableReason = "not-exposed" | "not-applicable";
export type QualityPerCostUnavailableReason = QualityUnavailableReason | CostUnavailableReason | "zero-cost";
export type UsageUnavailableReason = UsageMeasurementUnavailableReason | CostUnavailableReason | "zero-cost";
export interface NullableMetric {
    value: number | null;
    unavailableReason: UsageUnavailableReason | null;
}
/** Candidate minus baseline; signed only in a paired comparison. */
export interface SignedNullableMetric {
    value: number | null;
    unavailableReason: UsageUnavailableReason | null;
}
export interface TokenUsage {
    input: NullableMetric;
    output: NullableMetric;
    cached: NullableMetric;
    reasoning: NullableMetric;
    total: NullableMetric;
}
export interface ModelIdentity {
    providerRequested: string | null;
    modelRequested: string | null;
    providerResolved: string | null;
    modelResolved: string | null;
    resolutionConfidence: "exact" | "alias" | "inferred" | "unknown";
}
export interface RuntimeIdentity {
    gooseVersion: string;
    adapterName: string;
    adapterVersion: string;
}
export interface UsageObservation {
    tokens: TokenUsage;
    actualTurns: NullableMetric;
    latencyMs: {
        wall: NullableMetric;
        model: NullableMetric;
    };
    identity: ModelIdentity;
    runtime: RuntimeIdentity;
}
export interface PricingRate {
    category: "input" | "output" | "cached" | "reasoning";
    perMillionTokens: number;
}
export interface PricingEvidence {
    source: string;
    sourceVersion: string;
    retrievedAt: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    currency: string;
    provider: string;
    model: string;
    rates: PricingRate[];
}
export interface UsageCostInput {
    schemaVersion: typeof USAGE_COST_EVIDENCE_VERSION;
    evidenceId: string;
    observedAt: string;
    executor: UsageObservation;
    grader: UsageObservation;
    pricing: PricingEvidence | null;
    quality: NullableMetric;
}
export interface UsageCostTotals {
    tokens: TokenUsage;
    actualTurns: NullableMetric;
    latencyMs: {
        wall: NullableMetric;
        model: NullableMetric;
    };
    monetaryCost: NullableMetric;
    currency: string | null;
}
export interface UsageCostEvidence {
    schemaVersion: typeof USAGE_COST_EVIDENCE_VERSION;
    evidenceId: string;
    observedAt: string;
    observations: {
        executor: UsageObservation;
        grader: UsageObservation;
    };
    pricing: PricingEvidence | null;
    executor: UsageCostTotals;
    grader: UsageCostTotals;
    combined: UsageCostTotals;
    quality: NullableMetric;
    qualityPerDollar: NullableMetric;
    evidenceHash: string;
}
export interface UsageCostDeltaTotals {
    tokens: {
        input: SignedNullableMetric;
        output: SignedNullableMetric;
        cached: SignedNullableMetric;
        reasoning: SignedNullableMetric;
        total: SignedNullableMetric;
    };
    actualTurns: SignedNullableMetric;
    latencyMs: {
        wall: SignedNullableMetric;
        model: SignedNullableMetric;
    };
    monetaryCost: SignedNullableMetric;
    currency: string | null;
}
export interface UsageCostDelta {
    schemaVersion: typeof USAGE_COST_EVIDENCE_VERSION;
    baselineEvidenceHash: string;
    candidateEvidenceHash: string;
    executor: UsageCostDeltaTotals;
    grader: UsageCostDeltaTotals;
    combined: UsageCostDeltaTotals;
    quality: SignedNullableMetric;
    qualityPerDollar: SignedNullableMetric;
    deltaHash: string;
}
export type UsageCostDiagnosticCode = "USAGE_INVALID" | "USAGE_VERSION_UNSUPPORTED" | "USAGE_UNKNOWN_FIELD" | "USAGE_CATEGORY_INCONSISTENT" | "USAGE_PRICING_INVALID" | "USAGE_PRIVACY_VIOLATION";
export interface UsageCostDiagnostic {
    code: UsageCostDiagnosticCode;
    path: string;
    message: string;
    remediation: string;
}
export interface UsageCostValidation {
    valid: boolean;
    diagnostics: UsageCostDiagnostic[];
}
