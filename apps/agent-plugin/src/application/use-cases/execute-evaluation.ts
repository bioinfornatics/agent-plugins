import { EvaluationError } from "../../domain/evaluation.ts";
import type { CampaignResult, TrialRequest } from "../../domain/execution.ts";
import type { CandidateHost } from "../ports/candidate-host.ts";
import type { EvaluationPlan, EvaluationStore } from "../ports/evaluation-store.ts";

/** Sequential admission for this first slice; never exceeds requested concurrency. */
export async function executeEvaluation(plan: EvaluationPlan, hosts: ReadonlyMap<string, CandidateHost>, store: EvaluationStore): Promise<CampaignResult> {
  // Resolve every trial before any preflight or storage side effect.
  const selected = new Map<string, CandidateHost>();
  for (const agent of new Set([...plan.options.agents, ...plan.trials.map((trial) => trial.agent)])) {
    const host = hosts.get(agent);
    if (!host) throw new EvaluationError(`No execution adapter registered for agent: ${agent}`);
    selected.set(agent, host);
  }
  for (const host of new Set(selected.values())) await host.preflight(plan.profile);
  let completed = 0, failed = 0;
  try {
    const campaign = await store.begin(plan);
    for (const [index, trial] of plan.trials.entries()) {
      const scenario = plan.profile.scenarios.find((item) => item.id === trial.scenario);
      if (!scenario) throw new EvaluationError("Invalid prepared trial reference");
      const host = selected.get(trial.agent);
      if (!host) throw new EvaluationError("Invalid trial host reference");
      const request: TrialRequest = { agent: trial.agent, id: `${campaign.id}-${index + 1}`, pairId: trial.pairId,
        condition: trial.condition, profile: plan.profile, scenario, options: plan.options };
      await store.start(request);
      let result: Awaited<ReturnType<CandidateHost["run"]>>;
      try { result = await host.run(request); }
      catch { await store.fail(request); failed++; continue; }
      // Storage failure stops admission. Never turn a write failure into a candidate result.
      await store.finish(request, result);
      // A successful exit with incomplete evidence is not a completed evaluation trial.
      if (result.status === "completed" && result.collection === "complete") completed++;
      else failed++;
    }
    await store.complete();
    return { ...campaign, completed, failed, total: plan.trials.length };
  } finally { await store.close(); }
}
