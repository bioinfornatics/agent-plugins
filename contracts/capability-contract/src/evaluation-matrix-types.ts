import type { EvaluationPlanInput, EvaluationPlanV1, EvaluationRunBudget, EvaluationTotalBudget } from "./evaluation-types.js";

export const EVALUATION_MATRIX_PLAN_VERSION = "1.1.0" as const;
export const EVALUATION_MATRIX_SCHEMA_ID =
  "https://agent-plugins.org/schemas/evaluation-plan/1.1.0/evaluation-plan.schema.json" as const;

export type EvaluationMatrixRoleName = "builder" | "challenger" | "verifier" | "grader";
export type EvaluationIdentityConfidence = "exact" | "alias" | "host-default" | "unknown";
export interface EvaluationConcreteModelRequest { provider: string; model: string; alias?: string; confidence?: "exact"; }
export interface EvaluationAliasModelRequest { alias: string; confidence: "alias"; provider?: string; model?: never; }
export interface EvaluationHostDefaultRequest { hostDefault: true; documentation: string; confidence: "host-default"; provider?: never; model?: never; alias?: never; }
export type EvaluationModelRequest = EvaluationConcreteModelRequest | EvaluationAliasModelRequest | EvaluationHostDefaultRequest;
export interface EvaluationMatrixRole { role: EvaluationMatrixRoleName; models: EvaluationModelRequest[]; fallback?: EvaluationModelRequest[]; }
export interface EvaluationMatrixLimits extends EvaluationTotalBudget { concurrency: number; }
export interface EvaluationModelMatrixInput { roles: EvaluationMatrixRole[]; repetitions: number; budgetPerRun: Required<EvaluationRunBudget>; limits: EvaluationMatrixLimits; }
export interface EvaluationMatrixPlanInput extends Omit<EvaluationPlanInput, "schemaVersion" | "computed"> { schemaVersion: typeof EVALUATION_MATRIX_PLAN_VERSION; modelMatrix: EvaluationModelMatrixInput; }
export interface EvaluationMatrixComputed { totalJobs: number; totalRuns: number; effectiveConcurrency: number; requiredBudget: Required<EvaluationTotalBudget>; }
export interface EvaluationMatrixPlanV1_1 extends Omit<EvaluationPlanV1, "schemaVersion" | "computed"> { schemaVersion: typeof EVALUATION_MATRIX_PLAN_VERSION; modelMatrix: EvaluationModelMatrixInput; computed: EvaluationMatrixComputed; }
export interface EvaluationAvailableModel { provider: string; model: string; aliases?: string[]; }
/** A host-routable alias whose underlying provider/model identity is intentionally not exposed. */
export interface EvaluationOpaqueAlias { alias: string; provider?: string; documentation: string; }
export interface EvaluationResolutionContext { availableModels: EvaluationAvailableModel[]; opaqueAliases?: EvaluationOpaqueAlias[]; hostDefault?: { provider: string; model: string; documentation: string; }; }
export interface EvaluationResolvedKnownIdentity { provider: string; model: string; confidence: "exact" | "alias" | "host-default"; alias?: string; }
export interface EvaluationResolvedOpaqueIdentity { alias: string; confidence: "unknown"; executionIdentity: "host-opaque-alias"; documentation: string; provider?: string; model?: never; }
export type EvaluationResolvedIdentity = EvaluationResolvedKnownIdentity | EvaluationResolvedOpaqueIdentity;
export interface EvaluationIdentityReceipt { requested: EvaluationModelRequest; resolved: EvaluationResolvedIdentity; fallbackUsed: boolean; fallbackIndex?: number; }
export interface EvaluationResolvedJob { jobId: string; runIndex: number; matrixEntryIndex: number; matrixEntryIdentity: string; scenarioId: string; configurationId: string; role: EvaluationMatrixRoleName; repetition: number; budget: Required<EvaluationRunBudget>; identity: EvaluationIdentityReceipt; }
export interface EvaluationResolutionReceipt { schemaVersion: typeof EVALUATION_MATRIX_PLAN_VERSION; planHash: string; requestedIdentities: EvaluationModelRequest[]; resolvedIdentities: EvaluationIdentityReceipt[]; jobs: EvaluationResolvedJob[]; totalRuns: number; effectiveConcurrency: number; }
