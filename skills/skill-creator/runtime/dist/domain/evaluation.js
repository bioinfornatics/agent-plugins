export class EvaluationError extends Error {
}
export function validateOptions(input) {
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
    for (const agent of input.agents) {
        if (!["goose", "claude", "codex"].includes(agent))
            throw new EvaluationError(`Unsupported --agent: ${agent}`);
    }
    if (!input.agents.length)
        throw new EvaluationError("Select at least one --agent");
    if (input.model !== undefined && !input.model.trim())
        throw new EvaluationError("--model must not be empty");
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
    return { status: "prepared", schemaVersion: 3, options, profile, candidateRuns: trials.length, trials };
}
