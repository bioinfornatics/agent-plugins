import type { CapabilityContractV1 } from "./types.js";
export declare const CONTRACT_SCENARIO_CHALLENGE_VERSION: "1.0.0";
export declare const CHALLENGE_ROLES: readonly ["domain", "ux", "safety", "evaluation"];
export declare const CHALLENGE_RISKS: readonly ["low", "medium", "high"];
export type ChallengeRole = (typeof CHALLENGE_ROLES)[number];
export type ChallengeRisk = (typeof CHALLENGE_RISKS)[number];
export interface ContractRevisionV1 {
    revision: number;
    contract: CapabilityContractV1;
}
export interface ChallengeScenarioV1 {
    id: string;
    description: string;
}
export type ChallengeCitationV1 = {
    kind: "contract-field";
    path: string;
} | {
    kind: "scenario";
    scenarioId: string;
};
export interface ChallengeChangeV1 {
    path: string;
    value: unknown;
}
export interface ChallengeFindingV1 {
    id: string;
    summary: string;
    risk: ChallengeRisk;
    citation: ChallengeCitationV1;
    proposedChange?: ChallengeChangeV1;
}
export interface ChallengeRoleInputV1 {
    role: ChallengeRole;
    findings: ChallengeFindingV1[];
}
export interface ContractScenarioChallengeRequestV1 {
    version: typeof CONTRACT_SCENARIO_CHALLENGE_VERSION;
    base: ContractRevisionV1;
    scenarios: ChallengeScenarioV1[];
    scenarioHash: string;
    reviews: ChallengeRoleInputV1[];
    decisions?: Array<{
        findingId: string;
        decision: "accepted" | "rejected";
    }>;
}
export interface ConsolidatedChallengeFindingV1 extends ChallengeFindingV1 {
    roles: ChallengeRole[];
    sourceFindingIds: string[];
    status: "unresolved" | "accepted" | "rejected";
    blocking: boolean;
    advisory: boolean;
    disagreementWith: string[];
}
export interface ContractScenarioChallengeResultV1 {
    version: typeof CONTRACT_SCENARIO_CHALLENGE_VERSION;
    baseRevision: number;
    findings: ConsolidatedChallengeFindingV1[];
    unknowns: string[];
    blockers: string[];
    canProceed: boolean;
    revision: ContractRevisionV1;
    scenario: {
        previousHash: string;
        hash: string | null;
        invalidated: boolean;
    };
}
