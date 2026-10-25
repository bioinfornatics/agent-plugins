import {
  RESULT_CONTRACT_VERSION, type ApprovalState, type CreatorName, type EvaluationVerdict,
  type EvidenceAvailability, type LegacyMapResult, type LegacyStatusContext, type LegacyStatusMapping,
  type NormalizedResultContractV1, type OperationState, type ResultContractV1,
  type ResultDiagnostic, type ResultDiagnosticCode, type ResultExit, type ResultValidation,
} from "./result-types.js";

const OPERATIONS = new Set(["planned", "running", "completed", "blocked", "failed"]);
const VERDICTS = new Set(["pass", "fail", "inconclusive", "not-applicable"]);
const EVIDENCE = new Set(["available", "partial", "unavailable", "not-applicable"]);
const APPROVALS = new Set(["pending", "approved", "rejected", "not-applicable"]);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const nonBlank = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const compareUtf16 = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
function diagnostic(code: ResultDiagnosticCode, path: string, message: string, remediation: string): ResultDiagnostic { return { code, path, message, remediation }; }
function unknownFields(value: Record<string, unknown>, allowed: readonly string[], path: string, out: ResultDiagnostic[]): void {
  const known = new Set(allowed);
  for (const key of Object.keys(value).sort(compareUtf16)) if (!known.has(key)) out.push(diagnostic("RESULT_UNKNOWN_FIELD", path + "/" + key, "Unknown result field: " + key + ".", "Remove " + key + " or use a schema version that defines it."));
}

export function validateResultContract(value: unknown): ResultValidation {
  const diagnostics: ResultDiagnostic[] = [];
  if (!isRecord(value)) return { valid: false, diagnostics: [diagnostic("RESULT_NOT_OBJECT", "/", "Result contract must be a JSON object.", "Provide a result-contract 1.0.0 object.")] };
  unknownFields(value, ["schemaVersion", "operation", "evaluation", "evidence", "approval"], "", diagnostics);
  if (!nonBlank(value.schemaVersion)) diagnostics.push(diagnostic("RESULT_VERSION_REQUIRED", "/schemaVersion", "schemaVersion is required.", "Set schemaVersion to " + RESULT_CONTRACT_VERSION + "."));
  else if (value.schemaVersion !== RESULT_CONTRACT_VERSION) diagnostics.push(diagnostic("RESULT_VERSION_UNSUPPORTED", "/schemaVersion", "Unsupported result contract version: " + value.schemaVersion + ".", "Use schemaVersion " + RESULT_CONTRACT_VERSION + "."));
  const operation = value.operation;
  if (!isRecord(operation) || !OPERATIONS.has(operation.state as string) || (operation.reasons !== undefined && (!Array.isArray(operation.reasons) || operation.reasons.some((item) => !nonBlank(item))))) diagnostics.push(diagnostic("RESULT_OPERATION_INVALID", "/operation", "operation requires a supported state and optional non-empty reasons.", "Use planned, running, completed, blocked, or failed and explain blockers or failures in reasons."));
  else unknownFields(operation, ["state", "reasons"], "/operation", diagnostics);
  const evaluation = value.evaluation;
  if (!isRecord(evaluation) || typeof evaluation.applicable !== "boolean" || !VERDICTS.has(evaluation.verdict as string)) diagnostics.push(diagnostic("RESULT_EVALUATION_INVALID", "/evaluation", "evaluation requires explicit applicability and a supported verdict.", "Declare applicable and pass, fail, inconclusive, or not-applicable."));
  else unknownFields(evaluation, ["applicable", "verdict"], "/evaluation", diagnostics);
  const evidence = value.evidence;
  if (!isRecord(evidence) || typeof evidence.applicable !== "boolean" || !EVIDENCE.has(evidence.availability as string)) diagnostics.push(diagnostic("RESULT_EVIDENCE_INVALID", "/evidence", "evidence requires explicit applicability and a supported availability.", "Declare applicable and available, partial, unavailable, or not-applicable."));
  else unknownFields(evidence, ["applicable", "availability"], "/evidence", diagnostics);
  const approval = value.approval;
  if (!isRecord(approval) || typeof approval.applicable !== "boolean" || !APPROVALS.has(approval.state as string) || (approval.context !== undefined && approval.context !== "production-review")) diagnostics.push(diagnostic("RESULT_APPROVAL_INVALID", "/approval", "approval requires explicit applicability, a supported state, and only the production-review context.", "Declare pending, approved, rejected, or not-applicable; use context production-review only when applicable."));
  else unknownFields(approval, ["applicable", "state", "context"], "/approval", diagnostics);
  if (!isRecord(operation) || !OPERATIONS.has(operation.state as string) || !isRecord(evaluation) || typeof evaluation.applicable !== "boolean" || !VERDICTS.has(evaluation.verdict as string) || !isRecord(evidence) || typeof evidence.applicable !== "boolean" || !EVIDENCE.has(evidence.availability as string) || !isRecord(approval) || typeof approval.applicable !== "boolean" || !APPROVALS.has(approval.state as string)) return { valid: false, diagnostics };
  if (evaluation.applicable === (evaluation.verdict === "not-applicable")) diagnostics.push(diagnostic("RESULT_APPLICABILITY_MISMATCH", "/evaluation", "evaluation applicability and verdict disagree.", "Use not-applicable exactly when evaluation.applicable is false."));
  if (evidence.applicable === (evidence.availability === "not-applicable")) diagnostics.push(diagnostic("RESULT_APPLICABILITY_MISMATCH", "/evidence", "evidence applicability and availability disagree.", "Use not-applicable exactly when evidence.applicable is false."));
  if (approval.applicable === (approval.state === "not-applicable")) diagnostics.push(diagnostic("RESULT_APPLICABILITY_MISMATCH", "/approval", "approval applicability and state disagree.", "Use not-applicable exactly when approval.applicable is false."));
  if ((evaluation.applicable || approval.applicable) && !evidence.applicable) diagnostics.push(diagnostic("RESULT_APPLICABILITY_MISMATCH", "/evidence/applicable", "Applicable evaluation or approval requires an applicable evidence domain.", "Set evidence.applicable true and report its actual availability."));
  if (approval.applicable && approval.context !== "production-review") diagnostics.push(diagnostic("RESULT_APPROVAL_CONTEXT_REQUIRED", "/approval/context", "Applicable approval requires the exact production-review context.", "Set approval.context to production-review; do not infer approval from quality or completion."));
  if (!approval.applicable && approval.context !== undefined) diagnostics.push(diagnostic("RESULT_APPROVAL_CONTEXT_REQUIRED", "/approval/context", "Non-applicable approval cannot carry an approval context.", "Remove approval.context or mark approval applicable explicitly."));
  const state = operation.state as OperationState, verdict = evaluation.verdict as EvaluationVerdict, approvalState = approval.state as ApprovalState;
  if ((state === "planned" || state === "running") && evaluation.applicable && verdict !== "inconclusive") diagnostics.push(diagnostic("RESULT_NONTERMINAL_VERDICT", "/evaluation/verdict", "A non-terminal operation cannot have a pass or fail verdict.", "Use inconclusive until the operation reaches completed."));
  if (state === "blocked" && evaluation.applicable && verdict !== "inconclusive") diagnostics.push(diagnostic("RESULT_BLOCKED_VERDICT", "/evaluation/verdict", "A blocked operation cannot imply pass or fail.", "Use inconclusive and record the blocker independently."));
  if (state === "failed" && evaluation.applicable && verdict !== "inconclusive") diagnostics.push(diagnostic("RESULT_FAILED_VERDICT", "/evaluation/verdict", "An operation failure is not an evaluation verdict.", "Use inconclusive and preserve operation.state failed."));
  if ((verdict === "pass" || verdict === "fail") && evidence.availability !== "available") diagnostics.push(diagnostic("RESULT_VERDICT_EVIDENCE_REQUIRED", "/evidence/availability", "A pass or fail verdict requires available evidence.", "Use available evidence or change the verdict to inconclusive."));
  if ((approvalState === "approved" || approvalState === "rejected") && state !== "completed") diagnostics.push(diagnostic("RESULT_APPROVAL_NONTERMINAL", "/approval/state", "A final approval decision requires a completed operation.", "Use pending until operation.state is completed."));
  if (approvalState === "approved" && evidence.availability !== "available") diagnostics.push(diagnostic("RESULT_APPROVAL_EVIDENCE_REQUIRED", "/evidence/availability", "Approval requires available evidence.", "Keep approval pending until evidence is available."));
  if (approvalState === "approved" && evaluation.applicable && verdict !== "pass") diagnostics.push(diagnostic("RESULT_APPROVAL_VERDICT_REQUIRED", "/approval/state", "Approval of an applicable evaluation requires a pass verdict.", "Keep approval pending or record the actual rejection."));
  return { valid: diagnostics.length === 0, diagnostics };
}

export class ResultContractValidationError extends Error {
  constructor(readonly diagnostics: ResultDiagnostic[]) { super(diagnostics.map((item) => item.code + " " + item.path + ": " + item.message).join("\n")); this.name = "ResultContractValidationError"; }
}
export function normalizeResultContract(value: unknown): NormalizedResultContractV1 {
  const checked = validateResultContract(value); if (!checked.valid) throw new ResultContractValidationError(checked.diagnostics);
  const source = value as ResultContractV1;
  return { schemaVersion: RESULT_CONTRACT_VERSION, operation: { state: source.operation.state, reasons: [...new Set(source.operation.reasons?.map((item) => item.trim()) ?? [])].sort(compareUtf16) }, evaluation: { ...source.evaluation }, evidence: { ...source.evidence }, approval: { ...source.approval } };
}
const OPERATION_PRECEDENCE: readonly OperationState[] = ["failed", "blocked", "running", "planned", "completed"];
const VERDICT_PRECEDENCE: readonly EvaluationVerdict[] = ["fail", "inconclusive", "pass"];
const EVIDENCE_PRECEDENCE: readonly EvidenceAvailability[] = ["unavailable", "partial", "available"];
const APPROVAL_PRECEDENCE: readonly ApprovalState[] = ["rejected", "pending", "approved"];
function firstPresent<T extends string>(precedence: readonly T[], values: readonly T[]): T { return precedence.find((item) => values.includes(item))!; }
export function aggregateResultContracts(values: readonly unknown[]): NormalizedResultContractV1 {
  if (!values.length) throw new ResultContractValidationError([diagnostic("RESULT_AGGREGATE_EMPTY", "/", "At least one result is required for aggregation.", "Provide one or more valid result contracts.")]);
  const items = values.map(normalizeResultContract);
  const evaluationApplicable = items.some((item) => item.evaluation.applicable);
  const evidenceApplicable = items.some((item) => item.evidence.applicable);
  const approvalApplicable = items.some((item) => item.approval.applicable);
  const rawOperation = firstPresent(OPERATION_PRECEDENCE, items.map((item) => item.operation.state));
  const rawEvidence = evidenceApplicable
    ? firstPresent(EVIDENCE_PRECEDENCE, items.filter((item) => item.evidence.applicable).map((item) => item.evidence.availability).filter((item): item is Exclude<EvidenceAvailability, "not-applicable"> => item !== "not-applicable"))
    : "not-applicable";
  const rawVerdict = evaluationApplicable
    ? firstPresent(VERDICT_PRECEDENCE, items.filter((item) => item.evaluation.applicable).map((item) => item.evaluation.verdict).filter((item): item is Exclude<EvaluationVerdict, "not-applicable"> => item !== "not-applicable"))
    : "not-applicable";
  const rawApproval = approvalApplicable
    ? firstPresent(APPROVAL_PRECEDENCE, items.filter((item) => item.approval.applicable).map((item) => item.approval.state).filter((item): item is Exclude<ApprovalState, "not-applicable"> => item !== "not-applicable"))
    : "not-applicable";

  // A valid aggregate must not manufacture available evidence or attach a conclusive
  // verdict/decision to an unfinished operation. When those facts conflict, project
  // the conclusive failure onto operation.failed so its exit class remains failure.
  const hasFailure = rawOperation === "failed" || rawVerdict === "fail" || rawApproval === "rejected";
  const failureNeedsProjection = hasFailure && (
    rawOperation !== "completed" || (rawVerdict === "fail" && rawEvidence !== "available")
  );
  const operationState: OperationState = failureNeedsProjection ? "failed" : rawOperation;
  const evidenceAvailability: EvidenceAvailability = rawEvidence;
  let evaluationVerdict: EvaluationVerdict = rawVerdict;
  if (evaluationApplicable && (operationState !== "completed" || ((rawVerdict === "pass" || rawVerdict === "fail") && evidenceAvailability !== "available"))) evaluationVerdict = "inconclusive";
  let approvalState: ApprovalState = rawApproval;
  if (approvalApplicable && operationState !== "completed") approvalState = "pending";
  else if (approvalState === "approved" && (evidenceAvailability !== "available" || (evaluationApplicable && evaluationVerdict !== "pass"))) approvalState = "pending";

  const reasons = items.flatMap((item) => item.operation.reasons);
  if (rawVerdict === "fail" && evaluationVerdict !== "fail") reasons.push("aggregate preserves child evaluation fail");
  if (rawApproval === "rejected" && approvalState !== "rejected") reasons.push("aggregate preserves child approval rejected");
  return normalizeResultContract({
    schemaVersion: RESULT_CONTRACT_VERSION,
    operation: { state: operationState, reasons },
    evaluation: { applicable: evaluationApplicable, verdict: evaluationVerdict },
    evidence: { applicable: evidenceApplicable, availability: evidenceAvailability },
    approval: { applicable: approvalApplicable, state: approvalState, ...(approvalApplicable ? { context: "production-review" as const } : {}) },
  });
}
export function classifyResultExit(value: unknown, options: { invalidUsage?: boolean } = {}): ResultExit {
  if (options.invalidUsage) return { code: 2, reason: "invalid-usage" };
  const result = normalizeResultContract(value);
  if (result.operation.state === "failed" || result.evaluation.verdict === "fail" || result.approval.state === "rejected") return { code: 1, reason: "quality-failure" };
  if (result.operation.state !== "completed" || result.evaluation.verdict === "inconclusive" || (result.evidence.applicable && result.evidence.availability !== "available")) return { code: 3, reason: "blocked-capability-or-evidence" };
  if (result.approval.state === "pending") return { code: 4, reason: "pending-approval" };
  return { code: 0, reason: "success" };
}

const canonical = (operation: OperationState, verdict: EvaluationVerdict = "not-applicable", availability: EvidenceAvailability = "not-applicable", approval: ApprovalState = "not-applicable", reason?: string): NormalizedResultContractV1 => normalizeResultContract({ schemaVersion: RESULT_CONTRACT_VERSION, operation: { state: operation, ...(reason ? { reasons: [reason] } : {}) }, evaluation: { applicable: verdict !== "not-applicable", verdict }, evidence: { applicable: availability !== "not-applicable", availability }, approval: { applicable: approval !== "not-applicable", state: approval, ...(approval !== "not-applicable" ? { context: "production-review" as const } : {}) } });
const entry = (creator: CreatorName, context: LegacyStatusContext, token: string, result: NormalizedResultContractV1 | undefined, rationale: string, exit?: ResultExit): LegacyStatusMapping => ({ creator, context, token, ...(result ? { result } : {}), ...(exit ? { exit } : {}), rationale });
const completed = canonical("completed"), failed = canonical("failed", "not-applicable", "not-applicable", "not-applicable", "legacy operation failed"), blocked = canonical("blocked", "inconclusive", "unavailable", "not-applicable", "legacy operation blocked");
const pass = canonical("completed", "pass", "available"), fail = canonical("completed", "fail", "available"), warning = canonical("completed", "inconclusive", "partial"), skipped = canonical("completed"), planned = canonical("planned");
const reviewApproved = canonical("completed", "not-applicable", "available", "approved"), reviewRejected = canonical("completed", "not-applicable", "available", "rejected"), reviewPending = canonical("completed", "not-applicable", "available", "pending");
const usage: ResultExit = { code: 2, reason: "invalid-usage" };
export const LEGACY_STATUS_MAPPINGS: readonly LegacyStatusMapping[] = Object.freeze([
  entry("agent-creator","agent-cli-ok","true",completed,"Successful agent CLI operation; no quality or approval semantics."), entry("agent-creator","agent-cli-ok","false",undefined,"Ambiguous without exitCode; use agent-cli-exit context."),
  ...["0","1","2","3"].map((t)=>entry("agent-creator","agent-cli-exit",t,t==="0"?completed:t==="1"?failed:t==="3"?blocked:undefined,"Agent CLI exit status.",t==="2"?usage:undefined)),
  entry("agent-creator","agent-grading-passed","true",pass,"Explicit grading verdict."), entry("agent-creator","agent-grading-passed","false",fail,"Explicit grading verdict."),
  entry("agent-creator","agent-evidence-import-status","imported",completed,"External evidence was imported."), entry("agent-creator","agent-evidence-import-status","duplicate",completed,"An identical imported evidence record already exists."),
  entry("hook-creator","hook-cli-ok","true",completed,"Successful hook CLI operation."), entry("hook-creator","hook-cli-ok","false",undefined,"Ambiguous without usage; use hook-cli-usage context."), entry("hook-creator","hook-cli-usage","true",undefined,"Usage error occurs before a result.",usage), entry("hook-creator","hook-cli-usage","false",failed,"Non-usage hook CLI error is an operation failure."),
  ...["0","1","2"].map((t)=>entry("hook-creator","hook-cli-exit",t,t==="0"?completed:t==="1"?failed:undefined,"Hook CLI process exit status.",t==="2"?usage:undefined)),
  ...[["pending",reviewPending],["reviewed",reviewPending],["approved",reviewApproved],["rejected",reviewRejected]].map(([t,r])=>entry("hook-creator","hook-production-approval-state",t as string,r as NormalizedResultContractV1,"Identity-bound production approval state.")), ...["expired","superseded","stale","invalid"].map((t)=>entry("hook-creator","hook-production-approval-state",t,undefined,"Non-current or invalid approval cannot authorize production; inspect errors and lineage.")),
  entry("plugin-creator","plugin-cli-ok","true",completed,"Successful plugin CLI operation."), entry("plugin-creator","plugin-cli-ok","false",undefined,"Validation failure; use the nested outcome or process exit for exact semantics."), ...["0","1","2","3"].map((t)=>entry("plugin-creator","plugin-cli-exit",t,t==="0"?completed:t==="1"?failed:t==="3"?blocked:undefined,"Plugin CLI process exit status.",t==="2"?usage:undefined)),
  ...[["planned",planned],["success",pass],["failure",failed],["blocked",blocked]].map(([t,r])=>entry("plugin-creator","plugin-full-eval-status",t as string,r as NormalizedResultContractV1,"Plugin full-eval status.")),
  ...["planned","pass","fail","blocked","skipped"].map((t)=>entry("plugin-creator","plugin-full-eval-phase",t,t==="planned"?planned:t==="pass"?pass:t==="fail"?fail:t==="blocked"?blocked:skipped,"Plugin phase status.")),
  ...["pass","fail","blocked","na"].map((t)=>entry("plugin-creator","plugin-component-evidence-status",t,t==="pass"?pass:t==="fail"?fail:t==="blocked"?blocked:skipped,"Typed component evidence verdict.")), entry("plugin-creator","plugin-evidence-applicability","applicable",completed,"Component evidence applies."), entry("plugin-creator","plugin-evidence-applicability","na",skipped,"Component evidence is explicitly not applicable."),
  ...["pass","fail","blocked","na"].map((t)=>entry("plugin-creator","plugin-gate-status",t,t==="pass"?pass:t==="fail"?fail:t==="blocked"?blocked:skipped,"Explicit plugin gate status.")),
  ...["pass","fail","blocked"].map((t)=>entry("plugin-creator","plugin-verification-receipt-status",t,t==="pass"?pass:t==="fail"?fail:blocked,"Top-level plugin verification receipt status; no approval is inferred.")),
  entry("plugin-creator","plugin-human-review-status","pass",canonical("completed","inconclusive","available"),"Human review completed, but production approval is a separate identity-bound artifact."), entry("plugin-creator","plugin-human-review-status","pending",reviewPending,"Evaluation evidence is available and human review is pending; this is not an approved decision."), entry("plugin-creator","plugin-human-review-status","na",skipped,"Review not applicable."),
  ...[["accepted",pass],["rejected",fail],["partial",warning]].map(([t,r])=>entry("plugin-creator","plugin-validation-outcome",t as string,r as NormalizedResultContractV1,"Top-level ValidationOutcome.status derived from diagnostics and component outcomes.")),
  ...[["accepted",pass],["skipped",skipped],["skipped-invalid",fail],["skipped-unsupported",blocked],["runtime-failed",canonical("failed","inconclusive","partial","not-applicable","legacy runtime failed")]].map(([t,r])=>entry("plugin-creator","plugin-component-outcome-status",t as string,r as NormalizedResultContractV1,"ComponentOutcome.status emitted by portable loading or MCP runtime checks.")),
  entry("plugin-creator","plugin-release-eligible","true",pass,"Release eligibility is a composite passing signal across release or production profile; inspect the review gate for production approval identity."), entry("plugin-creator","plugin-release-eligible","false",undefined,"False can mean a non-release profile or any non-passing gate; inspect receipt status and gates."),
  ...[["ready",completed],["blocked",blocked],["applied",completed]].map(([t,r])=>entry("plugin-creator","plugin-migration-status",t as string,r as NormalizedResultContractV1,"Migration workflow status; never approval.")),
  ...[["portable-core",completed],["goose-extension",completed],["legacy-compatible",completed],["migratable",completed]].map(([t,r])=>entry("plugin-creator","plugin-migration-classification",t as string,r as NormalizedResultContractV1,"Migration finding classification; never approval.")), entry("plugin-creator","plugin-migration-classification","unsupported",undefined,"Unsupported findings need their blocking flag to determine operation semantics."),
  entry("plugin-creator","plugin-schema-version-status","published",completed,"Schema lifecycle classification."), entry("plugin-creator","plugin-schema-version-status","draft",completed,"Schema lifecycle classification."),
  ...[["portable",pass],["legacy-compatible",pass],["absent",skipped],["migratable",completed],["blocked",blocked]].map(([t,r])=>entry("plugin-creator","plugin-mcp-compatibility",t as string,r as NormalizedResultContractV1,"Currently emitted MCP compatibility status; migratable does not imply approval.")),
  ...[["contained",completed],["lexical-outside",failed],["resolved-outside",failed],["invalid-root",failed],["unresolved-parent",blocked],["filesystem-error",failed]].map(([t,r])=>entry("plugin-creator","plugin-path-containment-status",t as string,r as NormalizedResultContractV1,"Path containment operation status; no quality or approval semantics.")),
  entry("plugin-creator","plugin-schema-aggregate-valid","true",pass,"Autonomous aggregate schema-conformance verdict across every document."), entry("plugin-creator","plugin-schema-aggregate-valid","false",fail,"Autonomous aggregate schema-conformance verdict across every document."),
  entry("plugin-creator","plugin-schema-document-valid","true",pass,"Autonomous per-document schema-conformance verdict."), entry("plugin-creator","plugin-schema-document-valid","false",fail,"Autonomous per-document schema-conformance verdict."),
  entry("plugin-creator","plugin-mcp-aggregate-valid","true",pass,"Autonomous aggregate MCP semantic-validity verdict across every server."), entry("plugin-creator","plugin-mcp-aggregate-valid","false",fail,"Autonomous aggregate MCP semantic-validity verdict across every server."),
  entry("plugin-creator","plugin-mcp-aggregate-policy-valid","true",pass,"Autonomous aggregate MCP strict-policy verdict across every server."), entry("plugin-creator","plugin-mcp-aggregate-policy-valid","false",fail,"Autonomous aggregate MCP strict-policy verdict across every server."),
  ...["success","failure","blocked","usage"].map((t)=>entry("skill-creator","skill-cli-status",t,t==="success"?completed:t==="failure"?failed:t==="blocked"?blocked:undefined,"Skill CLI wrapper status.",t==="usage"?usage:undefined)), ...["0","1","2","3"].map((t)=>entry("skill-creator","skill-cli-exit",t,t==="0"?completed:t==="1"?failed:t==="3"?blocked:undefined,"Skill CLI exit status.",t==="2"?usage:undefined)),
  ...[["planned",planned],["success",pass],["failure",failed],["fail",fail],["blocked",blocked]].map(([t,r])=>entry("skill-creator","skill-full-eval-status",t as string,r as NormalizedResultContractV1,t==="fail"?"Skill full-eval forwards a failing verification receipt quality verdict.":"Skill full-eval status.")), ...[["planned",planned],["complete",completed],["blocked",blocked],["skipped",skipped],["failed",failed]].map(([t,r])=>entry("skill-creator","skill-full-eval-phase",t as string,r as NormalizedResultContractV1,"Skill phase status; complete is not pass.")),
  ...["pass","fail","blocked","na"].map((t)=>entry("skill-creator","skill-gate-status",t,t==="pass"?pass:t==="fail"?fail:t==="blocked"?blocked:skipped,"Explicit skill gate status.")),
  ...["complete","blocked","failed","cancelled"].map((t)=>entry("skill-creator","skill-paired-execution-status",t,t==="complete"?completed:t==="blocked"?blocked:failed,"Paired execution aggregate status.")),
  ...["pass","fail","blocked"].map((t)=>entry("skill-creator","skill-verification-receipt-status",t,t==="pass"?pass:t==="fail"?fail:blocked,"Top-level skill verification receipt status; no approval is inferred.")), entry("skill-creator","skill-human-review-status","pass",reviewApproved,"Explicit production human-review approval."), entry("skill-creator","skill-human-review-status","fail",reviewRejected,"Explicit production human-review rejection."), entry("skill-creator","skill-human-review-status","blocked",reviewPending,"Evaluation evidence is available and production human review lacks a final decision."),
  entry("skill-creator","skill-receipt-status","complete",canonical("completed","inconclusive","available"),"Receipt complete means evidence available, not quality or approval."), entry("skill-creator","skill-receipt-status","blocked",blocked,"Receipt evidence incomplete."),
  ...["pass","warning","fail"].flatMap((t)=>[entry("skill-creator","skill-audit-status",t,t==="pass"?pass:t==="warning"?warning:fail,"Audit verdict."),entry("skill-creator","skill-design-status",t,t==="pass"?pass:t==="warning"?warning:fail,"Evaluation-design verdict.")]),
  entry("skill-creator","skill-analysis-status","complete",canonical("completed","inconclusive","available"),"Analysis operation complete; decision separate."), entry("skill-creator","skill-analysis-status","blocked",blocked,"Analysis lacks evidence."), ...[["pass",pass],["warning",warning],["unavailable",blocked]].map(([t,r])=>entry("skill-creator","skill-navigation-status",t as string,r as NormalizedResultContractV1,"Navigation evidence status.")), entry("skill-creator","skill-analysis-decision","accept",pass,"Quality recommendation, not approval."), entry("skill-creator","skill-analysis-decision","revise",fail,"Revision recommendation."),
  entry("skill-creator","skill-trigger-result-pass","true",pass,"Explicit results[].pass trigger verdict."), entry("skill-creator","skill-trigger-result-pass","false",fail,"Explicit results[].pass trigger verdict."), entry("skill-creator","skill-grading-passed","true",pass,"Explicit grading expectation verdict."), entry("skill-creator","skill-grading-passed","false",fail,"Explicit grading expectation verdict."),
]);
export function mapLegacyStatus(input: { creator?: CreatorName; context?: LegacyStatusContext; token: string | number | boolean }): LegacyMapResult {
  if (!input.context || !input.creator) return { ok: false, diagnostics: [diagnostic("LEGACY_CONTEXT_REQUIRED", "/context", "Legacy status mapping requires creator and envelope context.", "Provide emitting creator, exact field context, and token; ambiguous tokens are never mapped globally.")] };
  const contexts = LEGACY_STATUS_MAPPINGS.filter((item) => item.creator === input.creator && item.context === input.context);
  if (!contexts.length) return { ok: false, diagnostics: [diagnostic("LEGACY_CONTEXT_UNKNOWN", "/context", "Unknown legacy context for " + input.creator + ": " + input.context + ".", "Use an exported context-specific mapping.")] };
  const token = String(input.token), mapping = contexts.find((item) => item.token === token);
  if (!mapping) return { ok: false, diagnostics: [diagnostic("LEGACY_STATUS_UNKNOWN", "/token", "Unknown legacy status token in " + input.context + ": " + token + ".", "Do not guess; add a versioned context-specific mapping after inventorying its producer.")] };
  return { ok: true, mapping };
}
