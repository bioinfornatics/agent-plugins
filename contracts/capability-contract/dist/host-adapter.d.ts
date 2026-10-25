import type { EvaluationPlanV1 } from "./evaluation-types.js";
import type { HostArtifactDescriptor, HostCapabilityReport, HostEventEnvelope, HostIdentity, HostNegotiationRequest, HostNegotiationResult, HostRunRequest } from "./host-adapter-types.js";
export declare function isRfc3339Timestamp(value: unknown): value is string;
export declare function evaluationPlanId(plan: EvaluationPlanV1): string;
export declare function negotiateHostCapabilities(report: HostCapabilityReport, request: HostNegotiationRequest): HostNegotiationResult;
export declare function assertHostIdentity(expected: HostIdentity, actual: HostIdentity): void;
/** Validates every structural, binding, and security invariant except requested capability availability. */
export declare function validateHostRunRequestBinding(request: HostRunRequest, report: HostCapabilityReport): void;
export declare function validateHostRunRequest(request: HostRunRequest, report: HostCapabilityReport): void;
export declare function validateArtifactDescriptor(artifact: HostArtifactDescriptor, workspaceRoot: string): void;
export declare function sha256(content: Uint8Array | string): string;
export declare function validateHostEventSequence(events: readonly HostEventEnvelope[]): void;
