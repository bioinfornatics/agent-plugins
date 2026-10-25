import type { EvaluationPlanV1, EvaluationRunBudget, EvaluationScenarioReference } from "./evaluation-types.js";
import type { ResultContractV1 } from "./result-types.js";

export const HOST_ADAPTER_PROTOCOL_VERSION = "1.0.0" as const;
export const HOST_ADAPTER_SCHEMA_ID = "https://agent-plugins.org/schemas/host-execution-adapter/1.0.0/host-execution-adapter.schema.json" as const;
export const HOST_EVENT_SCHEMA_ID = "https://agent-plugins.org/schemas/host-execution-adapter/1.0.0/host-execution-event.schema.json" as const;
export type HostAdapterProtocolVersion = typeof HOST_ADAPTER_PROTOCOL_VERSION;

export interface HostIdentity { name: string; version: string; adapterVersion: string; }
export type IsolationLevel = "none" | "process" | "container" | "virtual-machine";
export interface HostCapabilityReport {
  protocolVersion: HostAdapterProtocolVersion;
  supportedProtocolVersions: string[];
  host: HostIdentity;
  isolation: { supported: boolean; levels: IsolationLevel[] };
  streaming: { supported: boolean; transports: ("iterator" | "jsonl")[] };
  cancellation: { supported: boolean };
  resume: { supported: boolean; tokenTtlSeconds?: number };
  supportedModels: string[];
  supportedTools: string[];
  filesystem: { supported: boolean; modes: ("read" | "write")[]; workspaceContained: boolean };
  network: { supported: boolean; allowlistEnforced: boolean };
  browser: { supported: boolean };
  metrics: { tokens: boolean; cost: boolean };
  allowedEnvironmentNames: string[];
}

export type HostCapabilityName = "isolation" | "streaming" | "cancellation" | "resume" | "model" | "tools" | "filesystem" | "network" | "browser" | "tokenMetrics" | "costMetrics";
export interface HostCapabilityRequirement { capability: HostCapabilityName; value?: string | string[]; }
export interface HostCapabilityRequirements { required: HostCapabilityRequirement[]; optional: HostCapabilityRequirement[]; }
export interface HostCapabilityDegradation { capability: HostCapabilityName; code: "OPTIONAL_CAPABILITY_UNAVAILABLE"; message: string; }
export interface HostNegotiationRequest { supportedProtocolVersions: string[]; capabilities: HostCapabilityRequirements; }
export interface HostNegotiationAccepted { compatible: true; protocolVersion: HostAdapterProtocolVersion; host: HostIdentity; report: HostCapabilityReport; degradations: HostCapabilityDegradation[]; }
export interface HostNegotiationBlocked { compatible: false; protocolVersion?: HostAdapterProtocolVersion; host: HostIdentity; report: HostCapabilityReport; errors: HostAdapterErrorData[]; }
export type HostNegotiationResult = HostNegotiationAccepted | HostNegotiationBlocked;

export interface HostFileBinding { path: string; sha256: string; mediaType: string; size: number; access: "read" | "write" | "read-write"; }
export interface HostCredentialReference { name: string; reference: string; }
export interface HostRunIdentity { runId: string; planId: string; scenarioId: string; configurationId: string; attempt: number; }
export interface HostIdempotency { key: string; resumeToken?: string; afterSequence?: number; }
export interface HostRunRequest {
  protocolVersion: HostAdapterProtocolVersion;
  host: HostIdentity;
  identity: HostRunIdentity;
  plan: EvaluationPlanV1;
  scenario: EvaluationScenarioReference;
  workspace: { root: string; cwd: string; files: HostFileBinding[] };
  tools: string[];
  environment: { names: string[]; credentials: HostCredentialReference[] };
  model: string;
  budget: EvaluationRunBudget;
  capabilities: HostCapabilityRequirements;
  idempotency: HostIdempotency;
}

export interface HostArtifactDescriptor { artifactId: string; path: string; sha256: string; mediaType: string; size: number; }
export interface HostArtifactExchange { protocolVersion: HostAdapterProtocolVersion; host: HostIdentity; runId: string; artifact: HostArtifactDescriptor; encoding: "base64"; content: string; }
export interface HostUsageMetrics { inputTokens?: number; outputTokens?: number; totalTokens?: number; costUsd?: number; }
export type HostEventType = "accepted" | "started" | "progress" | "heartbeat" | "artifact" | "completed" | "blocked" | "failed" | "cancelled";
export interface HostEventDataByType {
  accepted: { resumeToken?: string; degradations: HostCapabilityDegradation[] };
  started: { message?: string };
  progress: { message: string; completed?: number; total?: number };
  heartbeat: { message?: string };
  artifact: { artifact: HostArtifactDescriptor };
  completed: { result: ResultContractV1; metrics?: HostUsageMetrics };
  blocked: { result: ResultContractV1; error: HostAdapterErrorData };
  failed: { result: ResultContractV1; error: HostAdapterErrorData };
  cancelled: { reason: string };
}
export type HostEventEnvelope<T extends HostEventType = HostEventType> = T extends HostEventType ? {
  protocolVersion: HostAdapterProtocolVersion; host: HostIdentity; runId: string; sequence: number; timestamp: string; type: T; data: HostEventDataByType[T];
} : never;

export type HostAdapterErrorCode = "PROTOCOL_VERSION_UNSUPPORTED" | "REQUIRED_CAPABILITY_MISSING" | "RUN_REQUEST_INVALID" | "WORKSPACE_BOUNDARY_VIOLATION" | "FILE_BOUNDARY_VIOLATION" | "TOOL_NOT_ALLOWED" | "ENVIRONMENT_NOT_ALLOWED" | "CREDENTIAL_VALUE_FORBIDDEN" | "SECRET_IN_EVENT" | "EVENT_SEQUENCE_INVALID" | "ARTIFACT_INVALID" | "RUN_NOT_FOUND" | "RESUME_INVALID" | "RESUME_STALE" | "CANCELLATION_UNSUPPORTED" | "INTERNAL_ERROR";
export interface HostAdapterErrorData { code: HostAdapterErrorCode; message: string; retryable: boolean; details?: Record<string, unknown>; }
export class HostAdapterError extends Error { readonly data: HostAdapterErrorData; constructor(data: HostAdapterErrorData) { super(data.message); this.name = "HostAdapterError"; this.data = data; } }
export interface HostCancellationRequest { protocolVersion: HostAdapterProtocolVersion; host: HostIdentity; runId: string; reason: string; idempotencyKey: string; }
export interface HostCancellationResponse { protocolVersion: HostAdapterProtocolVersion; host: HostIdentity; runId: string; status: "cancel-requested" | "already-cancelled" | "already-terminal"; }
export interface HostResumeRequest { protocolVersion: HostAdapterProtocolVersion; host: HostIdentity; runId: string; resumeToken: string; afterSequence: number; }
export interface HostArtifactRequest { protocolVersion: HostAdapterProtocolVersion; host: HostIdentity; runId: string; artifactId: string; }
export interface HostExecutionAdapter {
  discover(request: HostNegotiationRequest): Promise<HostNegotiationResult>;
  submit(request: HostRunRequest): AsyncIterable<HostEventEnvelope>;
  cancel(request: HostCancellationRequest): Promise<HostCancellationResponse>;
  resume(request: HostResumeRequest): AsyncIterable<HostEventEnvelope>;
  exchangeArtifact(request: HostArtifactRequest): Promise<HostArtifactExchange>;
}
