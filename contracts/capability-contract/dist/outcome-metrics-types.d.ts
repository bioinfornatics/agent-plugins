export declare const OUTCOME_METRICS_VERSION: "1.0.0";
export declare const OUTCOME_METRICS_SCHEMA_ID: "https://agent-plugins.org/schemas/outcome-productivity-metrics/1.0.0/outcome-productivity-metrics.schema.json";
export declare const OUTCOME_METRIC_IDS: readonly ["task-success-rate", "time-savings-seconds", "intervention-savings", "creation-completion-rate", "improvement-yield", "regression-rate", "recovery-rate", "review-time-seconds", "confidence-score", "idea-to-release-candidate-credible-effectiveness"];
export type OutcomeMetricId = typeof OUTCOME_METRIC_IDS[number];
export type MetricOperator = "<=" | ">=";
export interface MetricTarget {
    operator: MetricOperator;
    value: number;
    unit: string;
}
export type OutcomeEventType = "idea-recorded" | "task-started" | "task-completed" | "creation-started" | "creation-completed" | "release-candidate-created" | "intervention" | "intervention-count-recorded" | "review-started" | "review-completed" | "recovery-started" | "recovery-completed" | "cost-recorded";
export type OutcomeEvaluationKind = "task-success" | "effectiveness" | "improvement" | "regression" | "recovery" | "confidence" | "evidence-credibility" | "safety" | "human-approval";
export interface MetricDefinition {
    id: OutcomeMetricId;
    title: string;
    formula: string;
    population: string;
    exclusions: readonly string[];
    provenance: {
        eventTypes: readonly OutcomeEventType[];
        evaluationKinds: readonly OutcomeEvaluationKind[];
        evidenceKinds: readonly OutcomeEvaluationKind[];
    };
    target: MetricTarget;
    guardrail?: boolean;
}
export interface MetricProvenance {
    sourceType: "host-event" | "evaluation-run" | "human-record";
    sourceId: string;
    digest: string;
}
export interface OutcomeEvent {
    id: string;
    runId: string;
    pairId: string;
    variant: "baseline" | "candidate";
    type: OutcomeEventType;
    occurredAt: string;
    amount?: number;
    provenance: MetricProvenance;
}
/** Registry records make every evidence reference resolvable and bind it to one run and evaluation kind. */
export interface OutcomeEvidence {
    id: string;
    runId: string;
    type: OutcomeEvaluationKind;
    provenance: MetricProvenance;
}
export interface OutcomeEvaluation {
    id: string;
    runId: string;
    kind: OutcomeEvaluationKind;
    passed: boolean;
    score?: number;
    evaluator: {
        id: string;
        type: "automated" | "human";
    };
    evidenceIds: string[];
    provenance: MetricProvenance;
}
export interface OutcomeMetricsInput {
    schemaVersion: typeof OUTCOME_METRICS_VERSION;
    journey: {
        id: string;
        golden: true;
    };
    metricContract: {
        dictionaryVersion: typeof OUTCOME_METRICS_VERSION;
        requiredMetricIds: OutcomeMetricId[];
        northStarMetricId: "idea-to-release-candidate-credible-effectiveness";
    };
    privacy?: {
        processing: "local-only";
        participation: "included" | "opted-out";
    };
    budget: {
        maxDurationSeconds: number;
        maxCostUsd: number;
        maxInterventions: number;
    };
    events: OutcomeEvent[];
    evidence: OutcomeEvidence[];
    evaluations: OutcomeEvaluation[];
}
export type MetricStatus = "computed" | "missing" | "opted-out" | "guardrail-blocked";
export interface MetricResult {
    id: OutcomeMetricId;
    status: MetricStatus;
    value?: number;
    unit: string;
    target: MetricTarget;
    met?: boolean;
    numerator?: number;
    denominator?: number;
    provenanceIds: string[];
}
export type OutcomeMetricDiagnosticCode = "METRICS_INVALID" | "METRICS_VERSION_UNSUPPORTED" | "METRICS_UNKNOWN_FIELD" | "METRICS_CONTRACT_INCOMPLETE" | "METRICS_PRIVACY_VIOLATION" | "METRICS_DUPLICATE" | "METRICS_EVENT_INVALID" | "METRICS_EVIDENCE_INVALID" | "METRICS_EVALUATION_INVALID" | "METRICS_PAIR_INVALID" | "METRICS_GUARDRAIL_INVALID";
export interface OutcomeMetricDiagnostic {
    code: OutcomeMetricDiagnosticCode;
    path: string;
    message: string;
    remediation: string;
}
export interface OutcomeMetricValidation {
    valid: boolean;
    diagnostics: OutcomeMetricDiagnostic[];
}
export interface OutcomeMetricsReport {
    schemaVersion: typeof OUTCOME_METRICS_VERSION;
    dictionaryVersion: typeof OUTCOME_METRICS_VERSION;
    journeyId: string;
    privacyStatus: "local-only" | "opted-out";
    metrics: MetricResult[];
    northStar: MetricResult;
    guardrails: {
        releaseEligible: boolean;
        blockedRunIds: string[];
        reasons: string[];
    };
    computationHash: string;
}
