import { validateCandidateModels } from "./candidate-model.js";
export const CANDIDATE_SANDBOXES = ["bubblewrap"];
export function validateSandbox(value) {
    if (value !== undefined && !CANDIDATE_SANDBOXES.includes(value))
        throw new EvaluationError(`--sandbox must be one of: ${CANDIDATE_SANDBOXES.join(", ")}`);
}
export class EvaluationError extends Error {
}
/** Largest candidate-run deadline in seconds. Hosts arm it with setTimeout, whose
 * delay is a signed 32-bit millisecond value; a larger value passed preparation but
 * failed every frozen trial at run time, leaving an unrecoverable campaign. */
export const MAX_TIMEOUT_SECONDS = 2147483;
/** Execution limits every host must accept; checked before any campaign is begun. */
export function validateExecutionLimits(options) {
    if (!Number.isSafeInteger(options.maxTurns) || options.maxTurns < 1)
        throw new EvaluationError("--max-turns must be a safe integer >= 1");
    if (!Number.isSafeInteger(options.timeout) || options.timeout < 0 || options.timeout > MAX_TIMEOUT_SECONDS)
        throw new EvaluationError(`--timeout must be an integer from 0 to ${MAX_TIMEOUT_SECONDS} seconds`);
}
export function validateOptions(input) {
    validateCandidateModels(input);
    if (input.profileName !== undefined && (!input.profileName.trim() || input.profileName.length > 200))
        throw new EvaluationError("--profile-name must contain 1 to 200 characters");
    if (!input.skills.length && !input.plugins.length)
        throw new EvaluationError("Select --skills or --plugin");
    for (const [name, value, minimum] of [
        ["--repetitions", input.repetitions, 1], ["--max-turns", input.maxTurns, 1],
        ["--timeout", input.timeout, 0], ["--parallelism", input.parallelism, 1],
    ]) {
        if (!Number.isSafeInteger(value) || value < minimum)
            throw new EvaluationError(`${name} must be a safe integer >= ${minimum}`);
    }
    validateExecutionLimits(input);
    for (const agent of input.agents) {
        if (!["goose", "claude", "codex"].includes(agent))
            throw new EvaluationError(`Unsupported --agent: ${agent}`);
    }
    if (!input.agents.length)
        throw new EvaluationError("Select at least one --agent");
    if (input.model !== undefined && !input.model.trim())
        throw new EvaluationError("--model must not be empty");
    validateSandbox(input.sandbox);
}
/** Profile treatment is shared by every scenario; source provenance is never an install selector. */
export function buildMatrix(profile, options) {
    const trials = [];
    for (const scenario of profile.scenarios)
        for (const agent of options.agents) {
            for (let repetition = 1; repetition <= options.repetitions; repetition++) {
                const pairId = JSON.stringify([profile.revision, scenario.id, agent, repetition]);
                for (const condition of ["with", "without"])
                    trials.push({ id: `trial-${trials.length + 1}`, scenario: scenario.id, agent, repetition, pairId, condition });
            }
        }
    // Sandboxed plans use schema 4 so runtimes predating the sandbox refuse to resume them
    // unsandboxed; plans without a sandbox keep schema 3 and their exact historical bytes.
    return { status: "prepared", schemaVersion: (options.sandbox === undefined ? 3 : 4), options, profile, candidateRuns: trials.length, trials };
}
