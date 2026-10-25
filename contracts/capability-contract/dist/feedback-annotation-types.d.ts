export declare const FEEDBACK_ANNOTATION_VERSION: "1.0.0";
export declare const FEEDBACK_ANNOTATION_SCHEMA_ID: "https://agent-plugins.org/schemas/feedback-annotation/1.0.0/feedback-annotation.schema.json";
export type FeedbackAnchorKind = "product" | "scenario" | "output" | "grade" | "region";
export interface FeedbackReviewer {
    reviewerId: string;
    displayName?: string;
    role: string;
}
export interface FeedbackAnchor {
    kind: FeedbackAnchorKind;
    resourceId: string;
    revision: number;
    resourceHash: string;
    selector?: string;
    region?: {
        x: number;
        y: number;
        width: number;
        height: number;
        unit: "px" | "percent";
    };
}
export interface FeedbackAnnotationV1 {
    schemaVersion: typeof FEEDBACK_ANNOTATION_VERSION;
    annotationId: string;
    anchor: FeedbackAnchor;
    reviewer: FeedbackReviewer;
    createdAt: string;
    instruction: string;
    annotationHash: string;
}
export type FeedbackIntent = "modify" | "remove" | "move" | "simplify" | "explain" | "replace" | "merge" | "behavior";
export type FeedbackPatchOperation = {
    op: "add" | "replace";
    path: string;
    value: unknown;
} | {
    op: "remove";
    path: string;
};
export interface FeedbackInterpretationV1 {
    schemaVersion: typeof FEEDBACK_ANNOTATION_VERSION;
    interpretationId: string;
    annotationId: string;
    annotationHash: string;
    createdAt: string;
    interpreter: FeedbackReviewer;
    intent: FeedbackIntent;
    summary: string;
    operations: FeedbackPatchOperation[];
    affectedResourceIds: string[];
    requiredTests: string[];
    interpretationHash: string;
}
export interface FeedbackRevision {
    resourceId: string;
    resourceKind: "product" | "scenario" | "candidate";
    revision: number;
    parentRevision: number | null;
    parentHash: string | null;
    content: unknown;
    resourceHash: string;
    provenance?: {
        annotationId: string;
        annotationHash: string;
        interpretationId: string;
        interpretationHash: string;
        proposalId: string;
        proposalHash: string;
        decisionId: string;
        decisionHash: string;
    };
}
export interface FeedbackDependency {
    resourceId: string;
    dependsOn: string[];
}
export interface FeedbackProposalV1 {
    schemaVersion: typeof FEEDBACK_ANNOTATION_VERSION;
    proposalId: string;
    annotationId: string;
    annotationHash: string;
    interpretationId: string;
    interpretationHash: string;
    baseResourceId: string;
    baseRevision: number;
    baseHash: string;
    action: "accept" | "reject" | "correct";
    rationale: string;
    operations: FeedbackPatchOperation[];
    affectedResourceIds: string[];
    requiredTests: string[];
    proposedAt: string;
    proposer: FeedbackReviewer;
    proposalHash: string;
}
export interface FeedbackPreviewV1 {
    schemaVersion: typeof FEEDBACK_ANNOTATION_VERSION;
    proposalId: string;
    proposalHash: string;
    baseResourceId: string;
    baseRevision: number;
    baseHash: string;
    before: unknown;
    after: unknown;
    operations: FeedbackPatchOperation[];
    affectedResourceIds: string[];
    requiredTests: string[];
    previewHash: string;
}
export interface FeedbackDecisionV1 {
    schemaVersion: typeof FEEDBACK_ANNOTATION_VERSION;
    decisionId: string;
    proposalId: string;
    proposalHash: string;
    decision: "accepted" | "rejected";
    rationale: string;
    reviewer: FeedbackReviewer;
    decidedAt: string;
    expectedRevision: number;
    expectedResourceHash: string;
    previewHash: string;
    decisionHash: string;
}
export interface FeedbackEffectBinding {
    sourceResourceId: string;
    sourceRevision: number;
    sourceHash: string;
}
export interface FeedbackDependencyEffect extends FeedbackEffectBinding {
    kind: "resource";
    resourceId: string;
    status: "rerun-required" | "invalidated";
    reason: string;
}
export interface FeedbackTestEffect extends FeedbackEffectBinding {
    kind: "test";
    testId: string;
    status: "rerun-required";
    reason: string;
}
export type FeedbackDecisionEffect = FeedbackDependencyEffect | FeedbackTestEffect;
export interface FeedbackDecisionResult {
    decision: FeedbackDecisionV1;
    revision: FeedbackRevision | null;
    effects: FeedbackDecisionEffect[];
}
export interface FeedbackValidation {
    valid: boolean;
    diagnostics: Array<{
        code: "FEEDBACK_INVALID";
        path: string;
        message: string;
    }>;
}
export declare class FeedbackValidationError extends Error {
    readonly diagnostics: FeedbackValidation["diagnostics"];
    constructor(diagnostics: FeedbackValidation["diagnostics"]);
}
export declare class FeedbackConflictError extends Error {
    constructor(message: string);
}
