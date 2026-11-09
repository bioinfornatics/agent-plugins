import { candidateModelDrifted, validateCandidateModels, validateCandidateModelEvidence } from "../../domain/candidate-model.js";
import { prepareRetainedFixture } from "./prepare-retained-fixture.js";
import { assertExecutableScenarios } from "../../domain/scenario-import.js";
import { EvaluationError } from "../../domain/evaluation.js";
/** Bounded workers wait for durable start/finalization; database operations are serialized.
 * A persistence failure stops admission, then drains already active workers before closing storage.
 */
export async function executeEvaluation(preparedPlan, hosts, store, newAttemptId, resume, fixtureIO) {
    let ownsStorage = false;
    let writeTail = Promise.resolve();
    let failure;
    function persist(operation) {
        const next = writeTail.then(() => {
            if (failure !== undefined)
                throw failure;
            return operation();
        });
        writeTail = next.catch(error => { failure = error; });
        return next;
    }
    try {
        if (resume)
            ownsStorage = true;
        const restored = resume ? await store.resume(resume.id, resume.retryUncertain) : undefined;
        const resolvedPlan = restored?.plan ?? preparedPlan;
        if (!resolvedPlan)
            throw new EvaluationError("A prepared plan or resume campaign is required");
        let plan = resolvedPlan;
        validateCandidateModels(plan.options);
        assertExecutableScenarios([...plan.profile.scenarios, ...plan.profile.components.flatMap(component => component.scenarios)]);
        const selected = new Map();
        for (const agent of new Set([...plan.options.agents, ...plan.trials.map(trial => trial.agent)])) {
            const host = hosts.get(agent);
            if (!host)
                throw new EvaluationError(`No execution adapter registered for agent: ${agent}`);
            selected.set(agent, host);
        }
        for (const host of new Set(selected.values()))
            await host.preflight(plan.profile);
        if (!restored) {
            const captured = [];
            for (const [agent, host] of selected)
                if (host.resolveModel) {
                    // Give resolvers detached options; freezing must not mutate the caller's prepared plan.
                    const configured = await host.resolveModel(structuredClone(plan.options));
                    captured.push([agent, { ...configured }]);
                }
            if (captured.length) {
                const options = { ...plan.options, candidateModels: Object.fromEntries(captured) };
                validateCandidateModels(options);
                plan = { ...plan, options };
            }
        }
        ownsStorage = true;
        const campaign = restored?.campaign ?? await store.begin(plan);
        const pending = restored ? new Set(restored.pending) : new Set(plan.trials.map(trial => trial.id));
        const trials = plan.trials.filter(trial => pending.has(trial.id));
        let completed = restored?.completed ?? 0, failed = restored?.failed ?? 0, cursor = 0;
        async function worker() {
            while (failure === undefined) {
                const trial = trials[cursor++];
                if (!trial)
                    return;
                const scenario = plan.profile.scenarios.find(item => item.id === trial.scenario);
                const host = selected.get(trial.agent);
                if (!scenario || !host)
                    throw new EvaluationError("Invalid prepared trial reference");
                const request = { agent: trial.agent, id: newAttemptId(), trialId: trial.id,
                    pairId: trial.pairId, condition: trial.condition, profile: plan.profile, scenario, options: plan.options };
                await persist(() => store.start(request));
                if (scenario.preparation) {
                    if (!store.preparation || !fixtureIO)
                        throw new EvaluationError("Retained preparation capability unavailable");
                    const preparation = store.preparation;
                    const locations = await persist(() => preparation.allocatePreparation(request));
                    // Setup failure leaves the durable running attempt/partial seed; never admits a host.
                    const proof = await prepareRetainedFixture(request, locations, fixtureIO);
                    await persist(() => preparation.savePreparation(request, proof));
                    request.runtime = proof;
                }
                let result;
                try {
                    result = await host.run(request);
                    // A receipt from another host cannot support this comparison. Session binding is
                    // host-specific; require an explicit name here and let the adapter verify its export.
                    if (result.host.id !== request.agent || !result.sessionName.trim())
                        throw new EvaluationError("Candidate receipt attribution mismatch");
                    validateCandidateModelEvidence(result.model, plan.options.candidateModels?.[trial.agent]);
                    if (candidateModelDrifted(result.model) && result.collection === "complete")
                        result = { ...result, collection: "partial" };
                }
                catch {
                    await persist(() => store.fail(request));
                    failed++;
                    continue;
                }
                await persist(() => store.finish(request, result));
                if (result.status === "completed" && result.collection === "complete")
                    completed++;
                else
                    failed++;
            }
        }
        const workers = Array.from({ length: Math.min(plan.options.parallelism, trials.length) }, async () => {
            try {
                await worker();
            }
            catch (error) {
                failure = error;
            }
        });
        await Promise.all(workers);
        await writeTail;
        if (failure !== undefined)
            throw failure;
        await store.complete();
        return { ...campaign, completed, failed, total: plan.trials.length };
    }
    finally {
        if (ownsStorage)
            await store.close();
    }
}
