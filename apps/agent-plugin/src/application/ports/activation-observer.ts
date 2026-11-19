import type { ActivationClass, ActivationObservation } from "../../domain/activation.ts";

/** Frozen profile Skill files needed to attribute activation; content is UTF-8 SKILL.md text. */
export interface ActivationTreatment {
  components: { kind: "skill" | "plugin"; installationName: string; skillFiles: { path: string; content: string }[] }[];
}
export interface ActivationAssessment { class: ActivationClass; observation: ActivationObservation }
/** Read-only post-trial analysis of verified artifacts. Implementations must not execute
 * recorded code, call a model or mutate evidence; unsupported hosts return undefined. */
export interface ActivationObserver {
  observe(input: { agent: string; condition: "with" | "without"; treatment: ActivationTreatment;
    artifacts: readonly { path: string; content: Uint8Array }[] }): ActivationAssessment | undefined;
}
