import { type MetricDefinition, type OutcomeMetricDiagnostic, type OutcomeMetricsInput, type OutcomeMetricsReport, type OutcomeMetricValidation } from "./outcome-metrics-types.js";
export declare const OUTCOME_METRIC_DICTIONARY: Readonly<Record<MetricDefinition["id"], MetricDefinition>>;
export declare function validateOutcomeMetricsInput(value: unknown): OutcomeMetricValidation;
export declare class OutcomeMetricsValidationError extends Error {
    readonly diagnostics: OutcomeMetricDiagnostic[];
    constructor(diagnostics: OutcomeMetricDiagnostic[]);
}
export declare function createGoldenJourneyMetricContract(): OutcomeMetricsInput["metricContract"];
export declare function computeOutcomeMetrics(value: unknown): OutcomeMetricsReport;
