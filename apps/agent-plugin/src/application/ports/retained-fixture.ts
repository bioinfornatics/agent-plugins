import type { EvaluationSource } from "./evaluation-source.ts";
import type { EvaluationStore } from "./evaluation-store.ts";
import type { FixtureBindings, PreparationLocations, PreparationProof } from "../../domain/retained-preparation.ts";
import type { TrialRequest } from "../../domain/execution.ts";

/** Only the trusted application recipe uses these IO operations; no suite-supplied paths. */
export interface RetainedFixtureIO {
  source: EvaluationSource;
  createSource(locations: PreparationLocations): Promise<string>;
  createStore(locations: PreparationLocations): EvaluationStore;
  bindings(locations: PreparationLocations, campaignId: string, attempts: { condition: "with" | "without"; id: string }[]): FixtureBindings;
  capture(locations: PreparationLocations): Promise<PreparationProof["manifest"]>;
  newId(): string;
}
export interface PreparationStorage {
  allocatePreparation(request: TrialRequest): Promise<PreparationLocations>;
  savePreparation(request: TrialRequest, proof: PreparationProof): Promise<void>;
}
