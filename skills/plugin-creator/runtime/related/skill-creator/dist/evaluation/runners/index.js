// Select a non-interactive runner for skill evaluation.
import { RunnerError } from "./base.js";
import { GooseRunner } from "./goose.js";
export { RunnerError } from "./base.js";
export { PairedExecutionError } from "./paired.js";
const RUNNERS = {
    goose: GooseRunner,
};
export function createRunner(name) {
    const runnerName = name || process.env.SKILL_CREATOR_RUNNER || "goose";
    const RunnerClass = RUNNERS[runnerName];
    if (!RunnerClass) {
        const supported = Object.keys(RUNNERS).sort().join(", ");
        throw new RunnerError(`Unsupported runner '${runnerName}'. Supported runners: ${supported}`);
    }
    return new RunnerClass();
}
