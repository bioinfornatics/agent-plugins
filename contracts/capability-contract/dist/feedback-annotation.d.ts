import { type FeedbackAnnotationV1, type FeedbackDecisionResult, type FeedbackDecisionV1, type FeedbackDependency, type FeedbackInterpretationV1, type FeedbackPreviewV1, type FeedbackProposalV1, type FeedbackRevision, type FeedbackValidation } from "./feedback-annotation-types.js";
export declare function canonicalSerializeFeedback(value: unknown): string;
export declare function hashFeedback(value: unknown): string;
export declare function validateFeedbackAnnotation(value: unknown): FeedbackValidation;
export declare function createFeedbackAnnotation(input: Omit<FeedbackAnnotationV1, "schemaVersion" | "annotationHash">): FeedbackAnnotationV1;
export declare function createFeedbackInterpretation(input: Omit<FeedbackInterpretationV1, "schemaVersion" | "interpretationHash">, annotation: FeedbackAnnotationV1): FeedbackInterpretationV1;
export declare function createFeedbackProposal(input: Omit<FeedbackProposalV1, "schemaVersion" | "proposalHash">, annotation: FeedbackAnnotationV1, interpretation: FeedbackInterpretationV1): FeedbackProposalV1;
export declare function previewFeedbackProposal(proposal: FeedbackProposalV1, base: FeedbackRevision): FeedbackPreviewV1;
export declare function decideFeedbackProposal(input: Omit<FeedbackDecisionV1, "schemaVersion" | "decisionHash">, proposal: FeedbackProposalV1, preview: FeedbackPreviewV1, current: FeedbackRevision, annotation: FeedbackAnnotationV1, interpretation: FeedbackInterpretationV1, dependencies?: FeedbackDependency[]): FeedbackDecisionResult;
export declare function compareFeedbackRevisions(a: FeedbackRevision, b: FeedbackRevision): {
    resourceId: string;
    fromRevision: number;
    toRevision: number;
    fromHash: string;
    toHash: string;
    equal: boolean;
    before: unknown;
    after: unknown;
};
