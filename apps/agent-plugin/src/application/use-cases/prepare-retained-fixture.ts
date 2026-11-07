import { bindFixturePrompt, type PreparationLocations, type PreparationProof } from "../../domain/retained-preparation.ts";
import type { TrialRequest, TrialResult } from "../../domain/execution.ts";
import type { RetainedFixtureIO } from "../ports/retained-fixture.ts";
import { prepareEvaluation } from "./prepare-evaluation.ts";
import { executeEvaluation } from "./execute-evaluation.ts";

/** Deterministic retained data, not a candidate/provider trial or effectiveness evidence.
 * Use public lifecycle seams so the fixture obeys current registry/checkpoint invariants. */
export async function prepareRetainedFixture(request: TrialRequest, locations: PreparationLocations, io: RetainedFixtureIO): Promise<PreparationProof> {
  const declaration = request.scenario.preparation;
  if (!declaration) throw new Error("Preparation declaration required");
  const source = await io.createSource(locations);
  const plan = await prepareEvaluation({ skills: [source], plugins: [], agents: ["goose"], repetitions: 1, maxTurns: 5, timeout: 0, parallelism: 1 }, io.source);
  const attempts: { condition: "with" | "without"; id: string }[] = [];
  async function syntheticRun(trial: TrialRequest): Promise<TrialResult> {
    attempts.push({ condition: trial.condition, id: trial.id });
    return { status: "completed", collection: "complete", exitCode: 0, sessionName: trial.id,
      host: { id: "goose", version: "synthetic-fixture-not-native" }, startedAt: "2026-11-06T00:00:00.000Z", finishedAt: "2026-11-06T00:00:01.000Z",
      limitations: ["Synthetic deterministic fixture; no provider execution or effectiveness evidence."], artifacts: [{ path: "answer.txt", content: new TextEncoder().encode("fixture proof\n") }] };
  }
  const store = io.createStore(locations);
  let campaignId: string;
  if (declaration.campaign === "completed") {
    campaignId = (await executeEvaluation(plan, new Map([["goose", { preflight: async () => {}, run: syntheticRun }]]), store, () => io.newId())).id;
  } else {
    try {
      campaignId = (await store.begin(plan)).id;
      const trial = plan.trials[0], scenario = plan.profile.scenarios[0];
      if (!trial || !scenario) throw new Error("Missing synthetic trial");
      const synthetic: TrialRequest = { id: io.newId(), trialId: trial.id, pairId: trial.pairId, agent: trial.agent, condition: trial.condition, profile: plan.profile, scenario, options: plan.options };
      await store.start(synthetic); await store.finish(synthetic, await syntheticRun(synthetic));
    } finally { await store.close(); }
  }
  const bindings = io.bindings(locations, campaignId, attempts);
  return { schemaVersion: 1, declaration, bindings, task: bindFixturePrompt(request.scenario.prompt, declaration, bindings), locations,
    manifest: await io.capture(locations), provenance: "synthetic-public-seams-no-model" };
}
