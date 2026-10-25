export function deriveOutcomeStatus(diagnostics, components = []) {
    if (diagnostics.some(d => d.scope === "plugin" && d.severity === "error"))
        return "rejected";
    if (diagnostics.some(d => d.severity === "error") || components.some(c => c.status !== "accepted"))
        return "partial";
    return "accepted";
}
export function createValidationOutcome(mode, diagnostics, components = []) {
    return { mode, status: deriveOutcomeStatus(diagnostics, components), diagnostics, components };
}
/** Compatibility adapter: usage is handled by each CLI before an outcome exists. */
export function legacyExitCode(outcome) {
    if (outcome.status === "accepted")
        return 0;
    if (outcome.status === "unsupported")
        return 3;
    return 1;
}
export function assertTypedDiagnostic(value) {
    for (const key of ["code", "rule", "message", "sourcePath", "remediation"]) {
        if (!value[key].trim())
            throw new Error(`diagnostic.${key} must be non-empty`);
    }
}
