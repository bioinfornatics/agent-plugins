import { buildMatrix, validateOptions, type EvaluationInput, type PreparedTarget } from "../../domain/evaluation.ts";
import type { EvaluationSource } from "../ports/evaluation-source.ts";

export async function prepareEvaluation(input: EvaluationInput, source: EvaluationSource) {
  validateOptions(input);
  const targets: PreparedTarget[] = [];
  const seen = new Set<string>();
  for (const [kind, paths] of [["skill", input.skills], ["plugin", input.plugins]] as const) {
    for (const root of paths) {
      const target = await source.load({ kind, root });
      const key = JSON.stringify([kind, target.root]);
      if (!seen.has(key)) { seen.add(key); targets.push(target); }
    }
  }
  const { model, repetitions, maxTurns, timeout, parallelism } = input;
  return buildMatrix(targets, { agents: [...new Set(input.agents)], ...(model === undefined ? {} : { model }), repetitions, maxTurns, timeout, parallelism });
}
