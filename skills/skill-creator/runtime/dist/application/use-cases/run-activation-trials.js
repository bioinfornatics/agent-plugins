import { ACTIVATION_THRESHOLD, activationScenarioId, aggregateActivationCases, buildActivationPlan, classifyTrialOutcome, validateActivationCases } from "../../domain/activation-trial.js";
import { EvaluationError, validateOptions } from "../../domain/evaluation.js";
import { executeEvaluation } from "./execute-evaluation.js";
import { composeProfile, loadProfileTargets } from "./prepare-evaluation.js";
function skillDirectory(root) { return root.replaceAll("\\", "/").split("/").at(-1) ?? ""; }
/** Frozen SKILL.md path of a profile Skill directory, matching installation layout. */
function skillFilePath(kind, installationName, skill) {
    return kind === "plugin" ? `skills/${skill}/SKILL.md` : installationName === skill ? "SKILL.md" : undefined;
}
/** Profile without suites + validated queries file -> frozen schema-5 plan. No host or storage call. */
export async function prepareActivationTrials(input, source, caseSource) {
    validateOptions(input);
    // The structural activation oracle exists only for Goose conversations (product §31).
    if (input.agents.some(agent => agent !== "goose"))
        throw new EvaluationError("Activation trials support only --agent goose");
    if (!input.queries.trim())
        throw new EvaluationError("--queries must name a queries file");
    const base = composeProfile(await loadProfileTargets(input, source, { suites: false }), source);
    const roots = new Map(base.components.flatMap(component => component.skillRoots).map(root => [skillDirectory(root), root]));
    const { document, sha256 } = await caseSource.read(input.queries);
    const cases = validateActivationCases(document, [...roots.keys()].sort());
    for (const skill of new Set(cases.map(item => item.skill))) {
        if (!base.components.some(component => component.files.some(file => file.path === skillFilePath(component.kind, component.installationName, skill))))
            throw new EvaluationError(`Profile Skill ${skill} has no captured SKILL.md`);
    }
    // Revision binds installed bytes and the exact queries file: different query sets of one
    // profile must not collide on the immutable (profile, revision) snapshot.
    const profile = { ...base, revision: source.fingerprint(JSON.stringify({ method: "activation-trials-v1", revision: base.revision, queriesSha256: sha256 })) };
    const { model, repetitions, maxTurns, timeout, parallelism, sandbox } = input;
    const options = { agents: [...new Set(input.agents)], ...(model === undefined ? {} : { model }), repetitions, maxTurns, timeout, parallelism, ...(sandbox === undefined ? {} : { sandbox }) };
    return buildActivationPlan(profile, cases, roots, options, sha256);
}
/** Only the case's target Skill is attributed; other profile Skills are unattributed loads.
 * Body-line uniqueness is then computed against that Skill alone, so a sibling read sharing
 * its lines can surface as direct-read (inconclusive), never as a trigger. */
export function targetActivationTreatment(treatment, skill) {
    const components = treatment.components.flatMap(component => {
        const files = component.skillFiles.filter(file => file.path === skillFilePath(component.kind, component.installationName, skill));
        return files.length ? [{ ...component, skillFiles: files }] : [];
    });
    if (components.length !== 1)
        throw new EvaluationError(`Frozen activation target ${skill} is missing or ambiguous`);
    return { components };
}
export const ACTIVATION_LIMITATIONS = [
    "Activation is observed structurally from the verified Goose conversation; assistant claims are not evidence.",
    "Inconclusive or technical runs leave a case unresolved (counted as failed); absence of evidence is never a false negative.",
    "No baseline arm: trigger rates are not compared with an agent lacking the profile.",
    "Configured candidate model identity is configuration, not backend proof.",
];
/** Read-only post-execution classification of every logical trial from verified archives.
 * Integrity failures propagate; they are never downgraded to a technical outcome. */
export async function observeActivationCampaign(campaignId, dependencies) {
    const snapshot = await dependencies.history.overview(campaignId);
    if (snapshot.mode !== "activation" || !snapshot.activationCases || !snapshot.treatment)
        throw new EvaluationError("Not an activation campaign");
    const cases = new Map(snapshot.activationCases.map(item => [activationScenarioId(item.id), { item, runs: [] }]));
    const hostVersions = new Set();
    for (const trial of snapshot.trials) {
        const entry = cases.get(trial.scenarioId);
        if (!entry || trial.condition !== "with")
            throw new Error("Activation trial binding mismatch");
        const finalized = trial.status === "finalized" && trial.attemptId !== null;
        let receipt;
        let assessment;
        if (finalized) {
            const attempt = await dependencies.reader.readAttempt({ campaignId, attemptId: trial.attemptId });
            receipt = attempt.metadata.receipt;
            hostVersions.add(attempt.metadata.receipt.host.version);
            assessment = dependencies.observer.observe({ agent: trial.agent, condition: "with", treatment: targetActivationTreatment(snapshot.treatment, entry.item.skill), artifacts: attempt.artifacts });
        }
        const outcome = classifyTrialOutcome({ finalized, ...(receipt ? { receipt } : {}), ...(assessment ? { assessment } : {}) });
        entry.runs.push({ trialId: trial.trialId, attemptId: trial.attemptId, outcome, class: assessment?.class ?? null, observation: assessment?.observation ?? null });
    }
    const aggregate = aggregateActivationCases(snapshot.activationCases, new Map([...cases.values()].map(({ item, runs }) => [item.id, runs.map(run => run.outcome)])));
    const versions = [...hostVersions];
    return { format: "activation-run-v1",
        header: { campaignId, profile: { id: snapshot.profile.id, revision: snapshot.profile.revision },
            host: { id: snapshot.options.agents[0] ?? "goose", version: versions.length === 1 ? versions[0] ?? null : null },
            candidateModel: { configured: snapshot.options.candidateModels ?? null }, threshold: ACTIVATION_THRESHOLD, repetitions: snapshot.options.repetitions },
        cases: aggregate.cases.map(result => ({ id: result.id, shouldTrigger: result.shouldTrigger, runs: cases.get(activationScenarioId(result.id))?.runs ?? [],
            triggerRate: result.triggerRate, pass: result.pass, unresolved: result.unresolved })),
        summary: aggregate.summary,
        limitations: [...ACTIVATION_LIMITATIONS, ...(versions.length > 1 ? ["Several host versions answered this campaign; header host version is null."] : []),
            ...(snapshot.options.sandbox === undefined ? ["Candidate runs were not OS-sandboxed (private HOME/XDG only)."] : [])],
    };
}
/** Execute (or resume) the frozen with-only matrix, then classify, aggregate and publish the derived result. */
export async function runActivationTrials(plan, dependencies, resume) {
    const campaign = await executeEvaluation(plan, dependencies.hosts, dependencies.store, dependencies.newAttemptId, resume, undefined, "activation");
    const result = await observeActivationCampaign(campaign.id, dependencies);
    const location = await dependencies.writer.write(campaign.output, result);
    return { campaign, result, location };
}
