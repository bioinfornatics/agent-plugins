/** Shared machine-readable outcomes for portable loading, Goose extensions, and release policy. */
export type ValidationMode = "portable-load" | "strict-authoring" | "goose-extension" | "release-gate";
export type OutcomeStatus = "accepted" | "rejected" | "partial" | "skipped" | "skipped-invalid" | "skipped-unsupported" | "runtime-failed" | "unsupported" | "policy-failed";
export type DiagnosticSeverity = "info" | "warning" | "error";
export type DiagnosticScope = "plugin" | "component-type" | "component-entry" | "runtime-process" | "release";

export interface TypedDiagnostic {
  code: string;
  rule: string;
  message: string;
  severity: DiagnosticSeverity;
  scope: DiagnosticScope;
  sourcePath: string;
  remediation: string;
  componentType?: "manifest" | "skill" | "mcp" | "hook" | "agent";
  componentId?: string;
}
export interface ComponentOutcome {
  status: OutcomeStatus;
  scope: DiagnosticScope;
  sourcePath: string;
  componentType?: TypedDiagnostic["componentType"];
  componentId?: string;
  diagnostics: TypedDiagnostic[];
}
export interface ValidationOutcome {
  mode: ValidationMode;
  status: OutcomeStatus;
  diagnostics: TypedDiagnostic[];
  components: ComponentOutcome[];
}

export function deriveOutcomeStatus(diagnostics: readonly TypedDiagnostic[], components: readonly ComponentOutcome[] = []): OutcomeStatus {
  if (diagnostics.some(d => d.scope === "plugin" && d.severity === "error")) return "rejected";
  if (diagnostics.some(d => d.severity === "error") || components.some(c => c.status !== "accepted")) return "partial";
  return "accepted";
}
export function createValidationOutcome(mode: ValidationMode, diagnostics: TypedDiagnostic[], components: ComponentOutcome[] = []): ValidationOutcome {
  return { mode, status: deriveOutcomeStatus(diagnostics, components), diagnostics, components };
}
/** Compatibility adapter: usage is handled by each CLI before an outcome exists. */
export function legacyExitCode(outcome: ValidationOutcome): 0 | 1 | 3 {
  if (outcome.status === "accepted") return 0;
  if (outcome.status === "unsupported") return 3;
  return 1;
}
export function assertTypedDiagnostic(value: TypedDiagnostic): void {
  for (const key of ["code", "rule", "message", "sourcePath", "remediation"] as const) {
    if (!value[key].trim()) throw new Error(`diagnostic.${key} must be non-empty`);
  }
}
