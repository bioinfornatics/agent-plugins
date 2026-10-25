export const FEEDBACK_ANNOTATION_VERSION = "1.0.0";
export const FEEDBACK_ANNOTATION_SCHEMA_ID = "https://agent-plugins.org/schemas/feedback-annotation/1.0.0/feedback-annotation.schema.json";
export class FeedbackValidationError extends Error {
    diagnostics;
    constructor(diagnostics) {
        super("Feedback contract is invalid");
        this.diagnostics = diagnostics;
        this.name = "FeedbackValidationError";
    }
}
export class FeedbackConflictError extends Error {
    constructor(message) { super(message); this.name = "FeedbackConflictError"; }
}
