import type { ArtifactRecommendationV1 } from "./recommendation-types.js";
export declare const ADAPTIVE_ELICITATION_VERSION: "1.0.0";
export declare const KNOWLEDGE_STATES: readonly ["known", "assumed", "unknown", "contradictory"];
export declare const DECISION_KINDS: readonly ["architecture", "safety", "evaluation"];
export declare const AMBIGUITY_CLASSES: readonly ["ordinary", "destructive", "security", "production", "untestable"];
export type KnowledgeState = (typeof KNOWLEDGE_STATES)[number];
export type DecisionKind = (typeof DECISION_KINDS)[number];
export type AmbiguityClass = (typeof AMBIGUITY_CLASSES)[number];
export interface ElicitationEvidenceV1 {
    id: string;
    state: KnowledgeState;
    summary: string;
    source?: string;
}
export interface ReversibleDefaultV1 {
    value: string;
    reversible: true;
    consequence: string;
}
export interface ElicitationFieldV1 {
    id: string;
    label: string;
    state: KnowledgeState;
    value?: string;
    evidence: ElicitationEvidenceV1[];
    decisions: DecisionKind[];
    ambiguity: AmbiguityClass;
    question: string;
    default?: ReversibleDefaultV1;
}
export interface AdaptiveElicitationRequestV1 {
    version: typeof ADAPTIVE_ELICITATION_VERSION;
    outcome: string;
    explicitType?: string;
    expertise?: "novice" | "expert";
    fields: ElicitationFieldV1[];
    context?: {
        answeredFieldIds?: string[];
        askedQuestionIds?: string[];
    };
}
export interface ElicitationQuestionV1 {
    id: string;
    fieldId: string;
    prompt: string;
    mandatory: boolean;
    ambiguity: AmbiguityClass;
    value: {
        score: number;
        decisions: DecisionKind[];
        rationale: string;
    };
    default?: ReversibleDefaultV1;
}
export interface AdaptiveElicitationResultV1 {
    version: typeof ADAPTIVE_ELICITATION_VERSION;
    recommendation: ArtifactRecommendationV1;
    model: {
        fields: ElicitationFieldV1[];
    };
    questions: ElicitationQuestionV1[];
    deferredMandatoryFieldIds: string[];
    preview: {
        ready: boolean;
        unansweredOptionalFieldIds: string[];
        appliedDefaults: Array<{
            fieldId: string;
            value: string;
            consequence: string;
            reversible: true;
        }>;
        blockers: string[];
    };
}
