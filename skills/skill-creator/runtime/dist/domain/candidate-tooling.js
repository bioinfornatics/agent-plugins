/** Host tool-exposure settings frozen with a campaign (ap-49tf).
 *
 * Goose 1.57.0 with code mode exposes `load_skill` only through `execute_javascript`
 * (fixed upstream in v1.60.0, aaif-goose/goose#13574), so natural Skill activation is
 * only comparable between runs with the same setting. Omission keeps historical
 * campaigns and hosts without a resolver explicitly unknown, never "disabled".
 */
export const CODE_MODES = ["enabled", "disabled"];
function record(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
export function validateCandidateToolMode(value) {
    if (!record(value) || Object.keys(value).length !== 1 || !CODE_MODES.includes(value.codeMode))
        throw new Error("Invalid candidate tool mode");
}
export function validateCandidateToolModes(options) {
    const modes = options.candidateToolModes;
    if (modes === undefined)
        return;
    if (!record(modes) || !Object.keys(modes).length)
        throw new Error("Invalid candidate tool modes map");
    for (const [agent, mode] of Object.entries(modes)) {
        if (!options.agents.includes(agent))
            throw new Error("Candidate tool mode agent mismatch");
        validateCandidateToolMode(mode);
    }
}
