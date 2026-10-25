import { type CandidateSelectionDecisionV1, type CandidateSelectionValidation } from "./candidate-selection-types.js";
export declare function validateCandidateSelection(value: unknown): CandidateSelectionValidation;
export declare function canonicalSerializeCandidateSelection(value: unknown): string;
export declare function hashCandidateSelectionInput(value: unknown): string;
export declare function selectCandidate(value: unknown): CandidateSelectionDecisionV1;
