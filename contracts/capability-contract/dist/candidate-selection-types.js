export const CANDIDATE_SELECTION_VERSION = "1.0.0";
export const CANDIDATE_SELECTION_SCHEMA_ID = "https://agent-plugins.org/schemas/candidate-selection/1.0.0/candidate-selection.schema.json";
export class CandidateSelectionValidationError extends Error {
    diagnostics;
    constructor(diagnostics) {
        super("Candidate selection input is invalid");
        this.diagnostics = diagnostics;
        this.name = "CandidateSelectionValidationError";
    }
}
