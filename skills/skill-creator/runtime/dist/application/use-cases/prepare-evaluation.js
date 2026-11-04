import { buildMatrix, validateOptions, EvaluationError } from "../../domain/evaluation.js";
export async function prepareEvaluation(input, source) {
    validateOptions(input);
    const targets = [];
    const seen = new Set();
    for (const [kind, paths] of [["skill", input.skills], ["plugin", input.plugins]]) {
        for (const root of paths) {
            const target = await source.load({ kind, root });
            // Deduplicate canonical roots returned by the source, but retain distinct Skill/Plugin treatments.
            const key = JSON.stringify([kind, target.root]);
            if (!seen.has(key)) {
                seen.add(key);
                targets.push(target);
            }
        }
    }
    const profile = composeProfile(targets, source, input.profileName);
    const { model, repetitions, maxTurns, timeout, parallelism } = input;
    return buildMatrix(profile, { agents: [...new Set(input.agents)], ...(model === undefined ? {} : { model }), repetitions, maxTurns, timeout, parallelism });
}
/** Paths identify a reusable local selection; captured bytes identify its revision.
 * A moved selection gets a new profile identity. Names are labels and do not alter either hash.
 */
export function composeProfile(targets, source, name) {
    const plugins = targets.filter((target) => target.kind === "plugin");
    const components = targets.filter((target) => target.kind !== "skill" || !plugins.some((plugin) => plugin.skillRoots.includes(target.root)))
        .sort((a, b) => JSON.stringify([a.kind, a.root]).localeCompare(JSON.stringify([b.kind, b.root])));
    const installed = new Set();
    const capabilities = new Map();
    for (const target of components) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(target.installationName))
            throw new EvaluationError("Unsafe profile installation name");
        const key = JSON.stringify([target.kind, target.installationName]);
        if (installed.has(key))
            throw new EvaluationError(`Ambiguous profile installation: ${target.installationName}`);
        installed.add(key);
        for (const root of target.skillRoots) {
            const skillName = root.replaceAll("\\", "/").split("/").at(-1) ?? "";
            const previous = capabilities.get(skillName);
            if (previous !== undefined)
                throw new EvaluationError(`Ambiguous profile Skill: ${skillName}`);
            capabilities.set(skillName, root);
        }
    }
    const id = source.fingerprint(JSON.stringify(components.map((target) => [target.kind, target.root])));
    const revision = source.fingerprint(JSON.stringify(components.map((target) => [target.kind, target.installationName, target.fingerprint])));
    const seen = new Set();
    const scenarios = components.flatMap((target) => target.scenarios.flatMap((scenario) => {
        const provenance = JSON.stringify([scenario.suite, scenario.sourceId]);
        if (seen.has(provenance))
            return [];
        seen.add(provenance);
        return [{ ...scenario, id: `${source.fingerprint(scenario.suite)}/${scenario.sourceId}` }];
    }));
    return { id, name: name?.trim() ?? `profile-${id.slice(0, 12)}`, revision, components, scenarios };
}
