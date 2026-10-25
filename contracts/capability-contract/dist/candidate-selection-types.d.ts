export declare const CANDIDATE_SELECTION_VERSION: "1.0.0";
export declare const CANDIDATE_SELECTION_SCHEMA_ID: "https://agent-plugins.org/schemas/candidate-selection/1.0.0/candidate-selection.schema.json";
export type SelectionDimension = "effectiveness" | "productivity" | "stability" | "safety";
export type CandidateSelectionStatus = "selected" | "inconclusive";
export interface SelectionThreshold {
    minimum: number;
}
export interface SelectionObjective {
    kind: "weighted-conservative-utility";
    weights: Record<SelectionDimension, number>;
    tieTolerance: number;
    thresholds: Record<SelectionDimension, SelectionThreshold>;
    criticalSafetyMinimum: number;
}
export interface SelectionUncertaintyPolicy {
    minimumSamples: number;
    maximumSamples: number;
    maximumIntervalWidth: Record<SelectionDimension, number>;
}
export interface CandidateMetricEvidence {
    estimate: number;
    lowerBound: number;
    upperBound: number;
    sampleSize: number;
    evidenceHashes: string[];
}
export interface SelectionCandidate {
    candidateId: string;
    candidateHash: string;
    metrics: Record<SelectionDimension, CandidateMetricEvidence>;
}
export interface SelectionOverride {
    candidateId: string;
    nonSafetyOnly: true;
    identity: {
        actorId: string;
        role: string;
    };
    rationale: string;
}
export interface CandidateSelectionInputV1 {
    schemaVersion: typeof CANDIDATE_SELECTION_VERSION;
    objective: SelectionObjective;
    uncertainty: SelectionUncertaintyPolicy;
    candidates: SelectionCandidate[];
    override?: SelectionOverride;
}
export type CandidateDispositionReason = "selected" | "critical-safety-veto" | "safety-threshold" | "insufficient-safety-evidence" | "non-safety-threshold" | "insufficient-evidence" | "pareto-dominated" | "pareto-conflict" | "non-safety-human-override";
export interface CandidateSelectionTrace {
    candidateId: string;
    candidateHash: string;
    evidenceHashes: string[];
    conservativeUtility: number;
    thresholdFailures: SelectionDimension[];
    uncertaintyFailures: SelectionDimension[];
    criticalSafetyVeto: boolean;
    paretoDominatedBy: string[];
    disposition: "selected" | "rejected" | "eligible";
    reason: CandidateDispositionReason;
}
export interface CandidateSelectionDecisionV1 {
    schemaVersion: typeof CANDIDATE_SELECTION_VERSION;
    status: CandidateSelectionStatus;
    inputHash: string;
    selectedCandidateId: string | null;
    selectedCandidateHash: string | null;
    humanDecisionRequired: boolean;
    reason: "objective-winner" | "unique-pareto-winner" | "non-safety-human-override" | "no-eligible-candidate" | "pareto-conflict";
    objective: {
        formula: "sum(weight[dimension] * lowerBound[dimension]) / sum(weights)";
        dimensions: SelectionDimension[];
        weights: Record<SelectionDimension, number>;
        tieTolerance: number;
        thresholds: Record<SelectionDimension, SelectionThreshold>;
        criticalSafetyMinimum: number;
    };
    uncertainty: SelectionUncertaintyPolicy;
    traces: CandidateSelectionTrace[];
    override: null | SelectionOverride;
}
export interface CandidateSelectionValidation {
    valid: boolean;
    diagnostics: {
        code: "CANDIDATE_SELECTION_INVALID";
        path: string;
        message: string;
        remediation: string;
    }[];
}
export declare class CandidateSelectionValidationError extends Error {
    readonly diagnostics: CandidateSelectionValidation["diagnostics"];
    constructor(diagnostics: CandidateSelectionValidation["diagnostics"]);
}
