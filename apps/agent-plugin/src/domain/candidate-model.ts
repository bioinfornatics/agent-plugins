/** Selection source is provenance, not part of a configured model's comparison identity. */
export interface ConfiguredCandidateModel {
  source: "configuration-default" | "override";
  provider: string;
  model: string;
}
export interface CandidateModelEvidence {
  configured: ConfiguredCandidateModel;
  observed: { provider: string; model: string } | null;
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
/** Identities stay exact (no trimming/case normalization), bounded and control-free. */
export function validateModelIdentity(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 512 || [...value].some(character => { const code = character.charCodeAt(0); return code < 32 || (code >= 127 && code <= 159); })) throw new Error("Invalid candidate model identity");
}
export function validateConfiguredCandidateModel(value: unknown): asserts value is ConfiguredCandidateModel {
  if (!record(value) || !exactKeys(value, ["source", "provider", "model"]) || !["configuration-default", "override"].includes(value.source as string)) throw new Error("Invalid configured candidate model");
  validateModelIdentity(value.provider); validateModelIdentity(value.model);
}
/** Optional data extends plan v3 without inventing identities for historical campaigns. */
export function validateCandidateModels(options: { agents: string[]; model?: string; candidateModels?: unknown }): void {
  const models = options.candidateModels;
  if (models === undefined) return;
  if (!record(models) || !Object.keys(models).length) throw new Error("Invalid candidate models map");
  for (const [agent, configured] of Object.entries(models)) {
    if (!options.agents.includes(agent)) throw new Error("Candidate model agent mismatch");
    validateConfiguredCandidateModel(configured);
    if (configured.source !== (options.model === undefined ? "configuration-default" : "override") ||
      (options.model !== undefined && configured.model !== options.model)) throw new Error("Candidate model selection mismatch");
  }
}
/** Refuse invented/rewritten attribution; observed drift cannot produce a complete comparison. */
export function validateCandidateModelEvidence(value: unknown, frozen: ConfiguredCandidateModel | undefined): asserts value is CandidateModelEvidence | undefined {
  if (value === undefined) {
    if (frozen !== undefined) throw new Error("Missing candidate model evidence");
    return;
  }
  if (!record(value) || !exactKeys(value, ["configured", "observed"])) throw new Error("Invalid candidate model evidence");
  validateConfiguredCandidateModel(value.configured);
  if (!frozen || value.configured.source !== frozen.source || value.configured.provider !== frozen.provider || value.configured.model !== frozen.model) throw new Error("Candidate model attribution mismatch");
  if (value.observed !== null) {
    if (!record(value.observed) || !exactKeys(value.observed, ["provider", "model"])) throw new Error("Invalid observed candidate model");
    validateModelIdentity(value.observed.provider); validateModelIdentity(value.observed.model);
  }
}
export function candidateModelDrifted(evidence: CandidateModelEvidence | undefined): boolean {
  return !!evidence?.observed && (evidence.observed.provider !== evidence.configured.provider || evidence.observed.model !== evidence.configured.model);
}
