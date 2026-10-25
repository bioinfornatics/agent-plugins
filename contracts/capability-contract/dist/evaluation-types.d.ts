export declare const EVALUATION_PLAN_VERSION: "1.0.0";
export declare const EVALUATION_PLAN_SCHEMA_ID: "https://agent-plugins.org/schemas/evaluation-plan/1.0.0/evaluation-plan.schema.json";
export type EvaluationProfileName = "fast" | "standard" | "release";
export type EvaluationExecutionLevel = "static" | "behavioral" | "integration";
export type EvaluationThresholdOperator = "<" | "<=" | "=" | ">=" | ">";
export interface EvaluationScenarioReference {
    id: string;
    source: string;
    selector?: string;
}
export interface EvaluationModelRole {
    role: string;
    model: string;
}
export interface EvaluationRunBudget {
    maxTurns: number;
    timeoutSeconds: number;
    maxTokens?: number;
    maxCostUsd?: number;
}
export interface EvaluationRunBudgetInput {
    maxTurns?: number;
    timeoutSeconds?: number;
    maxTokens?: number;
    maxCostUsd?: number;
}
export interface EvaluationTotalBudget {
    maxRuns: number;
    maxTurns: number;
    timeoutSeconds: number;
    maxTokens?: number;
    maxCostUsd?: number;
}
export interface EvaluationBudgetInput {
    perRun?: EvaluationRunBudgetInput;
    total?: Partial<EvaluationTotalBudget>;
}
export interface EvaluationConfigurationInput {
    id: string;
    executionLevel: EvaluationExecutionLevel;
    capabilities: string[];
    modelRoles: EvaluationModelRole[];
    inputs: string[];
    tools: string[];
    fixtures: string[];
    budget?: EvaluationRunBudgetInput;
}
export interface EvaluationConfiguration extends Omit<EvaluationConfigurationInput, "budget"> {
    budget: EvaluationRunBudget;
}
export interface EvaluationPair {
    baseline: string;
    candidate: string;
    equivalent: {
        inputs: true;
        tools: true;
        fixtures: true;
        budgets: true;
    };
}
export interface EvaluationThreshold {
    metric: string;
    operator: EvaluationThresholdOperator;
    value: number;
}
export interface EvaluationRetryPolicy {
    maxRetries: number;
    retryOn: string[];
}
export interface EvaluationStopPolicy {
    budgetExhaustion: "stop";
    thresholdFailure: "stop" | "continue";
    maxFailedRuns: number;
}
export interface EvaluationPlanInput {
    schemaVersion: typeof EVALUATION_PLAN_VERSION;
    profile: EvaluationProfileName;
    scenarios: EvaluationScenarioReference[];
    baseline: string;
    configurations: EvaluationConfigurationInput[];
    pairs: EvaluationPair[];
    repetitions?: number;
    concurrency?: number;
    budget?: EvaluationBudgetInput;
    thresholds?: EvaluationThreshold[];
    retries?: Partial<EvaluationRetryPolicy>;
    stopPolicy?: Partial<EvaluationStopPolicy>;
    computed?: EvaluationPlanComputed;
}
export interface EvaluationPlanComputed {
    totalJobs: number;
    totalRuns: number;
    effectiveConcurrency: number;
    requiredBudget: EvaluationTotalBudget;
}
export interface EvaluationPlanV1 extends Omit<EvaluationPlanInput, "configurations" | "repetitions" | "concurrency" | "budget" | "thresholds" | "retries" | "stopPolicy"> {
    configurations: EvaluationConfiguration[];
    repetitions: number;
    concurrency: number;
    budget: {
        perRun: EvaluationRunBudget;
        total: EvaluationTotalBudget;
    };
    thresholds: EvaluationThreshold[];
    retries: EvaluationRetryPolicy;
    stopPolicy: EvaluationStopPolicy;
    computed: EvaluationPlanComputed;
}
export interface EvaluationProfileDefaults {
    repetitions: number;
    concurrency: number;
    max_turns_per_run: number;
    perRun: EvaluationRunBudget;
    retries: EvaluationRetryPolicy;
    stopPolicy: EvaluationStopPolicy;
}
export declare const EVALUATION_PROFILES: Readonly<Record<EvaluationProfileName, EvaluationProfileDefaults>>;
export type EvaluationDiagnosticCode = "EVALUATION_PLAN_NOT_OBJECT" | "EVALUATION_VERSION_REQUIRED" | "EVALUATION_VERSION_UNSUPPORTED" | "EVALUATION_PROFILE_INVALID" | "EVALUATION_SCENARIOS_REQUIRED" | "EVALUATION_SCENARIO_INVALID" | "EVALUATION_SCENARIO_DUPLICATE" | "EVALUATION_BASELINE_REQUIRED" | "EVALUATION_CONFIGURATIONS_REQUIRED" | "EVALUATION_CONFIGURATION_INVALID" | "EVALUATION_CONFIGURATION_DUPLICATE" | "EVALUATION_BASELINE_UNKNOWN" | "EVALUATION_PAIR_INVALID" | "EVALUATION_PAIR_UNKNOWN" | "EVALUATION_PAIR_EQUIVALENCE_REQUIRED" | "EVALUATION_PAIR_EQUIVALENCE_MISMATCH" | "EVALUATION_REPETITIONS_INVALID" | "EVALUATION_CONCURRENCY_INVALID" | "EVALUATION_BUDGET_INVALID" | "EVALUATION_BUDGET_UNBOUNDED" | "EVALUATION_BUDGET_CONTRADICTORY" | "EVALUATION_THRESHOLDS_INVALID" | "EVALUATION_RETRIES_INVALID" | "EVALUATION_STOP_POLICY_INVALID" | "EVALUATION_MATRIX_INVALID" | "EVALUATION_IDENTITY_UNAVAILABLE" | "EVALUATION_UNKNOWN_FIELD";
export interface EvaluationDiagnostic {
    code: EvaluationDiagnosticCode;
    path: string;
    message: string;
    remediation: string;
}
export interface EvaluationValidationResult {
    valid: boolean;
    diagnostics: EvaluationDiagnostic[];
}
