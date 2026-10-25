export const EVALUATION_PLAN_VERSION = "1.0.0";
export const EVALUATION_PLAN_SCHEMA_ID = "https://agent-plugins.org/schemas/evaluation-plan/1.0.0/evaluation-plan.schema.json";
export const EVALUATION_PROFILES = Object.freeze({
    fast: { repetitions: 1, concurrency: 2, max_turns_per_run: 12, perRun: { maxTurns: 12, timeoutSeconds: 300 }, retries: { maxRetries: 0, retryOn: [] }, stopPolicy: { budgetExhaustion: "stop", thresholdFailure: "stop", maxFailedRuns: 0 } },
    standard: { repetitions: 3, concurrency: 4, max_turns_per_run: 40, perRun: { maxTurns: 40, timeoutSeconds: 1200 }, retries: { maxRetries: 1, retryOn: ["transient-host-error"] }, stopPolicy: { budgetExhaustion: "stop", thresholdFailure: "stop", maxFailedRuns: 0 } },
    release: { repetitions: 5, concurrency: 8, max_turns_per_run: 80, perRun: { maxTurns: 80, timeoutSeconds: 1800 }, retries: { maxRetries: 2, retryOn: ["transient-host-error"] }, stopPolicy: { budgetExhaustion: "stop", thresholdFailure: "stop", maxFailedRuns: 0 } },
});
