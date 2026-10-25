export const RESULT_CONTRACT_VERSION = "1.0.0" as const;
export const RESULT_CONTRACT_SCHEMA_ID =
  "https://agent-plugins.org/schemas/result-contract/1.0.0/result-contract.schema.json" as const;

export type OperationState = "planned" | "running" | "completed" | "blocked" | "failed";
export type EvaluationVerdict = "pass" | "fail" | "inconclusive" | "not-applicable";
export type EvidenceAvailability = "available" | "partial" | "unavailable" | "not-applicable";
export type ApprovalState = "pending" | "approved" | "rejected" | "not-applicable";
export type ApprovalContext = "production-review";
export interface OperationResult { state: OperationState; reasons?: string[]; }
export interface EvaluationResult { applicable: boolean; verdict: EvaluationVerdict; }
export interface EvidenceResult { applicable: boolean; availability: EvidenceAvailability; }
export interface ApprovalResult { applicable: boolean; state: ApprovalState; context?: ApprovalContext; }
export interface ResultContractV1 { schemaVersion: typeof RESULT_CONTRACT_VERSION; operation: OperationResult; evaluation: EvaluationResult; evidence: EvidenceResult; approval: ApprovalResult; }
export interface NormalizedResultContractV1 extends Omit<ResultContractV1, "operation"> { operation: Required<OperationResult>; }
export type ResultDiagnosticCode =
  | "RESULT_NOT_OBJECT" | "RESULT_VERSION_REQUIRED" | "RESULT_VERSION_UNSUPPORTED" | "RESULT_UNKNOWN_FIELD"
  | "RESULT_OPERATION_INVALID" | "RESULT_EVALUATION_INVALID" | "RESULT_EVIDENCE_INVALID" | "RESULT_APPROVAL_INVALID"
  | "RESULT_APPLICABILITY_MISMATCH" | "RESULT_NONTERMINAL_VERDICT" | "RESULT_BLOCKED_VERDICT" | "RESULT_FAILED_VERDICT"
  | "RESULT_VERDICT_EVIDENCE_REQUIRED" | "RESULT_APPROVAL_CONTEXT_REQUIRED" | "RESULT_APPROVAL_NONTERMINAL"
  | "RESULT_APPROVAL_EVIDENCE_REQUIRED" | "RESULT_APPROVAL_VERDICT_REQUIRED" | "RESULT_AGGREGATE_EMPTY"
  | "LEGACY_CONTEXT_REQUIRED" | "LEGACY_CONTEXT_UNKNOWN" | "LEGACY_STATUS_UNKNOWN";
export interface ResultDiagnostic { code: ResultDiagnosticCode; path: string; message: string; remediation: string; }
export interface ResultValidation { valid: boolean; diagnostics: ResultDiagnostic[]; }
export type ResultExitCode = 0 | 1 | 2 | 3 | 4;
export type ResultExitReason = "success" | "quality-failure" | "blocked-capability-or-evidence" | "invalid-usage" | "pending-approval";
export interface ResultExit { code: ResultExitCode; reason: ResultExitReason; }
export type CreatorName = "agent-creator" | "hook-creator" | "plugin-creator" | "skill-creator";
export type LegacyStatusContext =
  | "agent-cli-ok" | "agent-cli-exit" | "agent-grading-passed" | "agent-evidence-import-status"
  | "hook-cli-ok" | "hook-cli-usage" | "hook-cli-exit" | "hook-production-approval-state"
  | "plugin-cli-ok" | "plugin-cli-exit" | "plugin-full-eval-status" | "plugin-full-eval-phase"
  | "plugin-gate-status" | "plugin-verification-receipt-status" | "plugin-component-evidence-status" | "plugin-evidence-applicability" | "plugin-human-review-status"
  | "plugin-validation-outcome" | "plugin-component-outcome-status" | "plugin-release-eligible" | "plugin-migration-status"
  | "plugin-migration-classification" | "plugin-schema-version-status" | "plugin-mcp-compatibility" | "plugin-path-containment-status"
  | "plugin-schema-aggregate-valid" | "plugin-schema-document-valid" | "plugin-mcp-aggregate-valid" | "plugin-mcp-aggregate-policy-valid"
  | "skill-cli-status" | "skill-cli-exit" | "skill-full-eval-status" | "skill-full-eval-phase" | "skill-gate-status"
  | "skill-verification-receipt-status" | "skill-paired-execution-status"
  | "skill-human-review-status" | "skill-receipt-status" | "skill-audit-status" | "skill-design-status"
  | "skill-analysis-status" | "skill-navigation-status" | "skill-analysis-decision" | "skill-trigger-result-pass"
  | "skill-grading-passed";
export interface LegacyStatusMapping { creator: CreatorName; context: LegacyStatusContext; token: string; result?: NormalizedResultContractV1; exit?: ResultExit; rationale: string; }
export interface LegacyMapSuccess { ok: true; mapping: LegacyStatusMapping; }
export interface LegacyMapFailure { ok: false; diagnostics: ResultDiagnostic[]; }
export type LegacyMapResult = LegacyMapSuccess | LegacyMapFailure;
