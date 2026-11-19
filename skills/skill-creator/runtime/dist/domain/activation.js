/** Ordering matters: incomplete scans cannot prove absence, and delivered content outranks failures. */
export function classifyActivation(condition, observation) {
    if (observation.scan !== "complete")
        return "inconclusive";
    if (condition === "without") {
        if (observation.loaded.length || observation.resourceLoads.length || observation.fileReads.length)
            return "baseline-contaminated";
        if (observation.unresolved)
            return "inconclusive";
        if (observation.failedLoads.length || observation.fileProbes.length)
            return "baseline-probe";
        return "baseline-clean";
    }
    if (observation.loaded.length)
        return "triggered";
    // Profile content consumed without an observed SKILL.md activation is not a trigger.
    if (observation.fileReads.length || observation.resourceLoads.length)
        return "direct-read";
    if (observation.unresolved)
        return "inconclusive";
    if (observation.failedLoads.length || observation.fileProbes.length)
        return "attempted-failed";
    return "not-triggered";
}
