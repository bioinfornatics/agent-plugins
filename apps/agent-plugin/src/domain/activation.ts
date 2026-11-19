/** Host-neutral activation/contamination classes derived from retained trial evidence.
 * They qualify a comparison; they never change, replace or synthesize a score (product §31). */
export type ActivationScan = "complete" | "unsupported" | "capped";
export type ActivationClass =
  | "triggered" | "attempted-failed" | "direct-read" | "not-triggered"
  | "baseline-clean" | "baseline-probe" | "baseline-contaminated"
  | "inconclusive";

/** Structural observations only: an assistant claim such as "I loaded the Skill" is never evidence. */
export interface ActivationObservation {
  version: 1;
  scan: ActivationScan;
  /** Exact profile Skill names whose host load result was observed as successful. */
  loaded: string[];
  /** Profile Skill names (or their unqualified Plugin child names) whose load attempts all failed. */
  failedLoads: string[];
  /** Profile Skill names whose bundled resources were loaded through the host Skill loader. */
  resourceLoads: string[];
  /** Profile Skill names whose SKILL.md body reached a non-loader tool response. */
  fileReads: string[];
  /** Profile Skill names whose SKILL.md was requested by a non-loader tool without observed content. */
  fileProbes: string[];
  /** Loader calls whose outcome cannot be attributed (wrapper output absent, forged or ambiguous). */
  unresolved: number;
}

/** Ordering matters: incomplete scans cannot prove absence, and delivered content outranks failures. */
export function classifyActivation(condition: "with" | "without", observation: ActivationObservation): ActivationClass {
  if (observation.scan !== "complete") return "inconclusive";
  if (condition === "without") {
    if (observation.loaded.length || observation.resourceLoads.length || observation.fileReads.length) return "baseline-contaminated";
    if (observation.unresolved) return "inconclusive";
    if (observation.failedLoads.length || observation.fileProbes.length) return "baseline-probe";
    return "baseline-clean";
  }
  if (observation.loaded.length) return "triggered";
  // Profile content consumed without an observed SKILL.md activation is not a trigger.
  if (observation.fileReads.length || observation.resourceLoads.length) return "direct-read";
  if (observation.unresolved) return "inconclusive";
  if (observation.failedLoads.length || observation.fileProbes.length) return "attempted-failed";
  return "not-triggered";
}
