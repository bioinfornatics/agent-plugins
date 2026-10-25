import { type ContractScenarioChallengeResultV1 } from "./challenge-types.js";
export declare function hashChallengeScenarios(value: unknown): string;
/** Pure deterministic challenge consolidation and optional revision acceptance. */
export declare function challengeContractScenarios(input: unknown): ContractScenarioChallengeResultV1;
