import { assertExecutableScenarios } from "../../domain/scenario-import.js";
import { EvaluationError } from "../../domain/evaluation.js";
/** Bounded workers wait for durable start/finalization; database operations are serialized.
 * A persistence failure stops admission, then drains already active workers before closing storage.
 */
export async function executeEvaluation(preparedPlan, hosts, store, newAttemptId, resume) {
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
        const plan = resolvedPlan;
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
                let result;
                try {
                    result = await host.run(request);
                    // A receipt from another host cannot support this comparison. Session binding is
                    // host-specific; require an explicit name here and let the adapter verify its export.
                    if (result.host.id !== request.agent || !result.sessionName.trim())
                        throw new EvaluationError("Candidate receipt attribution mismatch");
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
