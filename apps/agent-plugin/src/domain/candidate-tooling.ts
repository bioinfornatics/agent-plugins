/** Host tool-exposure settings frozen with a campaign (ap-49tf).
 *
 * Goose 1.57.0 with code mode exposes `load_skill` only through `execute_javascript`
 * (fixed upstream in v1.60.0, aaif-goose/goose#13574), so natural Skill activation is
 * only comparable between runs with the same setting. Omission keeps historical
 * campaigns and hosts without a resolver explicitly unknown, never "disabled".
 */
export const CODE_MODES = ["enabled", "disabled"] as const;
export type CodeMode = typeof CODE_MODES[number];
export interface CandidateToolMode { codeMode: CodeMode }

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function validateCandidateToolMode(value: unknown): asserts value is CandidateToolMode {
  if (!record(value) || Object.keys(value).length !== 1 || !CODE_MODES.includes(value.codeMode as CodeMode)) throw new Error("Invalid candidate tool mode");
}
export function validateCandidateToolModes(options: { agents: string[]; candidateToolModes?: unknown }): void {
  const modes = options.candidateToolModes;
  if (modes === undefined) return;
  if (!record(modes) || !Object.keys(modes).length) throw new Error("Invalid candidate tool modes map");
  for (const [agent, mode] of Object.entries(modes)) {
    if (!options.agents.includes(agent)) throw new Error("Candidate tool mode agent mismatch");
    validateCandidateToolMode(mode);
  }
}
