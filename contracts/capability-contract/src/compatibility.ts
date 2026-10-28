import { createHash } from "node:crypto";
import { RESULT_CONTRACT_VERSION, RESULT_CONTRACT_SCHEMA_ID } from "./result-types.js";
import type { CompatibilityDiagnostic, CompatibilityEntry, CompatibilityReadResult, MigrationCopyOperation, MigrationPreview, MigrationPreviewOptions } from "./compatibility-types.js";
import { COMPATIBILITY_POLICY_VERSION } from "./compatibility-types.js";
import { validateShapeById } from "./compatibility-shapes.js";
const E=(value:CompatibilityEntry):CompatibilityEntry=>Object.freeze(value);
export const COMPATIBILITY_REGISTRY:readonly CompatibilityEntry[]=Object.freeze(([
  {
    "id": "contract.capability.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/types.ts",
    "sourceFieldOrLayout": "contract.capability.v1",
    "sourceEvidence": "CAPABILITY_CONTRACT_VERSION = \"1.0.0\"",
    "kind": "shared-contract",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/schemaVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "schema:capability-contract"
  },
  {
    "id": "contract.evaluation-plan.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/evaluation-types.ts",
    "sourceFieldOrLayout": "contract.evaluation-plan.v1",
    "sourceEvidence": "EVALUATION_PLAN_VERSION = \"1.0.0\"",
    "kind": "shared-contract",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/schemaVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "schema:evaluation-plan"
  },
  {
    "id": "contract.result.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/result-types.ts",
    "sourceFieldOrLayout": "contract.result.v1",
    "sourceEvidence": "RESULT_CONTRACT_VERSION = \"1.0.0\"",
    "kind": "shared-contract",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/schemaVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "schema:result-contract"
  },
  {
    "id": "api.recommend-artifact.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/recommendation.ts",
    "sourceFieldOrLayout": "recommendArtifact",
    "sourceEvidence": "export function recommendArtifact(input: unknown): ArtifactRecommendationV1",
    "kind": "public-api",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "schema.artifact-recommendation.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/schema/recommendation/1.0.0/artifact-recommendation.schema.json",
    "sourceFieldOrLayout": "artifact-recommendation.schema.json",
    "sourceEvidence": "\"$id\": \"https://agent-plugins.dev/schemas/artifact-recommendation/1.0.0\"",
    "kind": "schema-document",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "shape:artifact-recommendation-schema-document"
  },
  {
    "id": "contract.artifact-recommendation.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/recommendation-types.ts",
    "sourceFieldOrLayout": "ArtifactRecommendationV1",
    "sourceEvidence": "ARTIFACT_RECOMMENDATION_VERSION = \"1.0.0\"",
    "kind": "shared-contract",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "schema:artifact-recommendation"
  },
  {
    "id": "schema.host-adapter.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HOST_ADAPTER_SCHEMA_ID",
    "sourceEvidence": "HOST_ADAPTER_SCHEMA_ID = \"https://agent-plugins.org/schemas/host-execution-adapter/1.0.0/host-execution-adapter.schema.json\"",
    "kind": "schema-document",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "shape:json-schema-document"
  },
  {
    "id": "schema.host-event.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HOST_EVENT_SCHEMA_ID",
    "sourceEvidence": "HOST_EVENT_SCHEMA_ID = \"https://agent-plugins.org/schemas/host-execution-adapter/1.0.0/host-execution-event.schema.json\"",
    "kind": "schema-document",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "shape:json-schema-document"
  },
  {
    "id": "contract.host.adapter-protocol-version.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostAdapterProtocolVersion",
    "sourceEvidence": "export type HostAdapterProtocolVersion = typeof HOST_ADAPTER_PROTOCOL_VERSION;",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "contract.host.identity.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostIdentity",
    "sourceEvidence": "export interface HostIdentity { name: string; version: string; adapterVersion: string; }",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "contract.host.capability-report.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostCapabilityReport",
    "sourceEvidence": "export interface HostCapabilityReport {",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/protocolVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "host:capability-report"
  },
  {
    "id": "contract.host.capability-name.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostCapabilityName",
    "sourceEvidence": "export type HostCapabilityName = \"isolation\" | \"streaming\" | \"cancellation\" | \"resume\" | \"model\" | \"tools\" | \"filesystem\" | \"network\" | \"browser\" | \"tokenMetrics\" | \"costMetrics\";",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "contract.host.capability-requirement.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostCapabilityRequirement",
    "sourceEvidence": "export interface HostCapabilityRequirement { capability: HostCapabilityName; value?: string | string[]; }",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "contract.host.capability-requirements.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostCapabilityRequirements",
    "sourceEvidence": "export interface HostCapabilityRequirements { required: HostCapabilityRequirement[]; optional: HostCapabilityRequirement[]; }",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "contract.host.capability-degradation.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostCapabilityDegradation",
    "sourceEvidence": "export interface HostCapabilityDegradation { capability: HostCapabilityName; code: \"OPTIONAL_CAPABILITY_UNAVAILABLE\"; message: string; }",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "contract.host.negotiation-request.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostNegotiationRequest",
    "sourceEvidence": "export interface HostNegotiationRequest { supportedProtocolVersions: string[]; capabilities: HostCapabilityRequirements; }",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "host:negotiation-request"
  },
  {
    "id": "contract.host.negotiation-accepted.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostNegotiationAccepted",
    "sourceEvidence": "export interface HostNegotiationAccepted { compatible: true; protocolVersion: HostAdapterProtocolVersion; host: HostIdentity; report: HostCapabilityReport; degradations: HostCapabilityDegradation[]; }",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/protocolVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "host:negotiation-result"
  },
  {
    "id": "contract.host.negotiation-blocked.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostNegotiationBlocked",
    "sourceEvidence": "export interface HostNegotiationBlocked { compatible: false; protocolVersion?: HostAdapterProtocolVersion; host: HostIdentity; report: HostCapabilityReport; errors: HostAdapterErrorData[]; }",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "host:negotiation-result"
  },
  {
    "id": "contract.host.negotiation-result.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostNegotiationResult",
    "sourceEvidence": "export type HostNegotiationResult = HostNegotiationAccepted | HostNegotiationBlocked;",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/protocolVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "host:negotiation-result"
  },
  {
    "id": "contract.host.file-binding.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostFileBinding",
    "sourceEvidence": "export interface HostFileBinding { path: string; sha256: string; mediaType: string; size: number; access: \"read\" | \"write\" | \"read-write\"; }",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "contract.host.credential-reference.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostCredentialReference",
    "sourceEvidence": "export interface HostCredentialReference { name: string; reference: string; }",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "contract.host.run-identity.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostRunIdentity",
    "sourceEvidence": "export interface HostRunIdentity { runId: string; planId: string; scenarioId: string; configurationId: string; attempt: number; }",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "contract.host.idempotency.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostIdempotency",
    "sourceEvidence": "export interface HostIdempotency { key: string; resumeToken?: string; afterSequence?: number; }",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "contract.host.run-request.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostRunRequest",
    "sourceEvidence": "export interface HostRunRequest {",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/protocolVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "host:run-request"
  },
  {
    "id": "contract.host.artifact-descriptor.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostArtifactDescriptor",
    "sourceEvidence": "export interface HostArtifactDescriptor { artifactId: string; path: string; sha256: string; mediaType: string; size: number; }",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "contract.host.artifact-exchange-response.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostArtifactExchange",
    "sourceEvidence": "export interface HostArtifactExchange { protocolVersion: HostAdapterProtocolVersion; host: HostIdentity; runId: string; artifact: HostArtifactDescriptor; encoding: \"base64\"; content: string; }",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/protocolVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "host:artifact-exchange"
  },
  {
    "id": "contract.host.usage-metrics.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostUsageMetrics",
    "sourceEvidence": "export interface HostUsageMetrics { inputTokens?: number; outputTokens?: number; totalTokens?: number; costUsd?: number; }",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "contract.host.event-type.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostEventType",
    "sourceEvidence": "export type HostEventType = \"accepted\" | \"started\" | \"progress\" | \"heartbeat\" | \"artifact\" | \"completed\" | \"blocked\" | \"failed\" | \"cancelled\";",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "contract.host.event-data-by-type.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostEventDataByType",
    "sourceEvidence": "export interface HostEventDataByType {",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "contract.host.event-family.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostEventEnvelope",
    "sourceEvidence": "export type HostEventEnvelope<T extends HostEventType = HostEventType> = T extends HostEventType ? {",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/protocolVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "host:event-envelope"
  },
  {
    "id": "contract.host.adapter-error-code.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostAdapterErrorCode",
    "sourceEvidence": "export type HostAdapterErrorCode = \"PROTOCOL_VERSION_UNSUPPORTED\" | \"REQUIRED_CAPABILITY_MISSING\" | \"RUN_REQUEST_INVALID\" | \"WORKSPACE_BOUNDARY_VIOLATION\" | \"FILE_BOUNDARY_VIOLATION\" | \"TOOL_NOT_ALLOWED\" | \"ENVIRONMENT_NOT_ALLOWED\" | \"CREDENTIAL_VALUE_FORBIDDEN\" | \"SECRET_IN_EVENT\" | \"EVENT_SEQUENCE_INVALID\" | \"ARTIFACT_INVALID\" | \"RUN_NOT_FOUND\" | \"RESUME_INVALID\" | \"RESUME_STALE\" | \"CANCELLATION_UNSUPPORTED\" | \"INTERNAL_ERROR\";",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "contract.host.adapter-error-data.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostAdapterErrorData",
    "sourceEvidence": "export interface HostAdapterErrorData { code: HostAdapterErrorCode; message: string; retryable: boolean; details?: Record<string, unknown>; }",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "host:error"
  },
  {
    "id": "contract.host.adapter-error.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostAdapterError",
    "sourceEvidence": "export type HostAdapterErrorCode = \"PROTOCOL_VERSION_UNSUPPORTED\" | \"REQUIRED_CAPABILITY_MISSING\" | \"RUN_REQUEST_INVALID\" | \"WORKSPACE_BOUNDARY_VIOLATION\" | \"FILE_BOUNDARY_VIOLATION\" | \"TOOL_NOT_ALLOWED\" | \"ENVIRONMENT_NOT_ALLOWED\" | \"CREDENTIAL_VALUE_FORBIDDEN\" | \"SECRET_IN_EVENT\" | \"EVENT_SEQUENCE_INVALID\" | \"ARTIFACT_INVALID\" | \"RUN_NOT_FOUND\" | \"RESUME_INVALID\" | \"RESUME_STALE\" | \"CANCELLATION_UNSUPPORTED\" | \"INTERNAL_ERROR\";",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "host:error"
  },
  {
    "id": "contract.host.cancellation-request.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostCancellationRequest",
    "sourceEvidence": "export interface HostCancellationRequest { protocolVersion: HostAdapterProtocolVersion; host: HostIdentity; runId: string; reason: string; idempotencyKey: string; }",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/protocolVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "host:cancellation-request"
  },
  {
    "id": "contract.host.cancellation-response.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostCancellationResponse",
    "sourceEvidence": "export interface HostCancellationResponse { protocolVersion: HostAdapterProtocolVersion; host: HostIdentity; runId: string; status: \"cancel-requested\" | \"already-cancelled\" | \"already-terminal\"; }",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/protocolVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "host:cancellation-response"
  },
  {
    "id": "contract.host.resume-request.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostResumeRequest",
    "sourceEvidence": "export interface HostResumeRequest { protocolVersion: HostAdapterProtocolVersion; host: HostIdentity; runId: string; resumeToken: string; afterSequence: number; }",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/protocolVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "host:resume-request"
  },
  {
    "id": "contract.host.artifact-exchange-request.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostArtifactRequest",
    "sourceEvidence": "export interface HostArtifactRequest { protocolVersion: HostAdapterProtocolVersion; host: HostIdentity; runId: string; artifactId: string; }",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/protocolVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "host:artifact-request"
  },
  {
    "id": "contract.host.execution-adapter.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostExecutionAdapter",
    "sourceEvidence": "export interface HostExecutionAdapter {",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "contract.host.event-accepted.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostEventDataByType.accepted",
    "sourceEvidence": "  accepted: { resumeToken?: string; degradations: HostCapabilityDegradation[] };",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/protocolVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "host:event-envelope"
  },
  {
    "id": "contract.host.event-started.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostEventDataByType.started",
    "sourceEvidence": "  started: { message?: string };",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/protocolVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "host:event-envelope"
  },
  {
    "id": "contract.host.event-progress.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostEventDataByType.progress",
    "sourceEvidence": "  progress: { message: string; completed?: number; total?: number };",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/protocolVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "host:event-envelope"
  },
  {
    "id": "contract.host.event-heartbeat.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostEventDataByType.heartbeat",
    "sourceEvidence": "  heartbeat: { message?: string };",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/protocolVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "host:event-envelope"
  },
  {
    "id": "contract.host.event-artifact.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostEventDataByType.artifact",
    "sourceEvidence": "  artifact: { artifact: HostArtifactDescriptor };",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/protocolVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "host:event-envelope"
  },
  {
    "id": "contract.host.event-completed.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostEventDataByType.completed",
    "sourceEvidence": "  completed: { result: ResultContractV1; metrics?: HostUsageMetrics };",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/protocolVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "host:event-envelope"
  },
  {
    "id": "contract.host.event-blocked.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostEventDataByType.blocked",
    "sourceEvidence": "  blocked: { result: ResultContractV1; error: HostAdapterErrorData };",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/protocolVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "host:event-envelope"
  },
  {
    "id": "contract.host.event-failed.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostEventDataByType.failed",
    "sourceEvidence": "  failed: { result: ResultContractV1; error: HostAdapterErrorData };",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/protocolVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "host:event-envelope"
  },
  {
    "id": "contract.host.event-cancelled.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/host-adapter-types.ts",
    "sourceFieldOrLayout": "HostEventDataByType.cancelled",
    "sourceEvidence": "  cancelled: { reason: string };",
    "kind": "protocol-message",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/protocolVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "host:event-envelope"
  },
  {
    "id": "skill.cli.envelope.unversioned",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/cli.ts",
    "sourceFieldOrLayout": "skill.cli.envelope.unversioned",
    "sourceEvidence": "JSON.stringify({ command: name, status:",
    "kind": "envelope",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned replacement."
    },
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:cli-envelope"
  },
  {
    "id": "agent.cli.envelope.unversioned",
    "creator": "agent-creator",
    "sourceFile": "apps/agent-creator-cli/scripts/cli.ts",
    "sourceFieldOrLayout": "agent.cli.envelope.unversioned",
    "sourceEvidence": "JSON.stringify({ ok: exitCode === 0, command:",
    "kind": "envelope",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned replacement."
    },
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:cli-envelope"
  },
  {
    "id": "hook.cli.envelope.unversioned",
    "creator": "hook-creator",
    "sourceFile": "apps/hook-creator-cli/scripts/cli.ts",
    "sourceFieldOrLayout": "hook.cli.envelope.unversioned",
    "sourceEvidence": "JSON.stringify({ok:false,error:error.message,usage})",
    "kind": "envelope",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned replacement."
    },
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:cli-envelope"
  },
  {
    "id": "plugin.cli.envelope.unversioned",
    "creator": "plugin-creator",
    "sourceFile": "apps/plugin-creator-cli/scripts/cli.ts",
    "sourceFieldOrLayout": "plugin.cli.envelope.unversioned",
    "sourceEvidence": "emit({ok:true,command,output}",
    "kind": "envelope",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned replacement."
    },
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:cli-envelope"
  },
  {
    "id": "skill.full-eval.v1",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/full_eval.ts",
    "sourceFieldOrLayout": "skill.full-eval.v1",
    "sourceEvidence": "schema_version:\"1.1\",command:\"full-eval\"",
    "kind": "envelope",
    "readVersionsOrRanges": [
      "1.0",
      "1.1"
    ],
    "emittedVersion": "1.1",
    "versionField": "/schema_version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:full-eval"
  },
  {
    "id": "plugin.full-eval.v1",
    "creator": "plugin-creator",
    "sourceFile": "apps/plugin-creator-cli/scripts/full_eval.ts",
    "sourceFieldOrLayout": "plugin.full-eval.v1",
    "sourceEvidence": "schema_version:\"1.0\",command:\"full-eval\"",
    "kind": "envelope",
    "readVersionsOrRanges": [
      "1.0"
    ],
    "emittedVersion": "1.0",
    "versionField": "/schema_version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:full-eval"
  },
  {
    "id": "skill.full-eval-state.v2",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/full_eval.ts",
    "sourceFieldOrLayout": ".full-eval-job.json",
    "sourceEvidence": "const STATE_FILE = \".full-eval-job.json\"",
    "kind": "evaluation-artifact",
    "readVersionsOrRanges": [
      "2.0"
    ],
    "emittedVersion": "2.0",
    "versionField": "/schema_version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:skill-full-eval-state"
  },
  {
    "id": "plugin.full-eval-state.v1",
    "creator": "plugin-creator",
    "sourceFile": "apps/plugin-creator-cli/scripts/full_eval.ts",
    "sourceFieldOrLayout": "full-eval-state.json",
    "sourceEvidence": "const STATE_FILE=\"full-eval-state.json\"",
    "kind": "evaluation-artifact",
    "readVersionsOrRanges": [
      "1.0"
    ],
    "emittedVersion": "1.0",
    "versionField": "/schema_version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:plugin-full-eval-state"
  },
  {
    "id": "skill.execution-evidence.v1",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/evaluation_provenance.ts",
    "sourceFieldOrLayout": "eval-<id>/<configuration>/run-<n>/execution-evidence.json",
    "sourceEvidence": "const manifestPath = join(runDir, \"execution-evidence.json\");",
    "kind": "evaluation-artifact",
    "readVersionsOrRanges": [
      "1.0"
    ],
    "emittedVersion": "1.0",
    "versionField": "/schema_version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:execution-evidence"
  },
  {
    "id": "skill.authoring-audit.v1",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/audit_skill.ts",
    "sourceFieldOrLayout": "skill.authoring-audit.v1",
    "sourceEvidence": "schema_version: \"1.0\"",
    "kind": "envelope",
    "readVersionsOrRanges": [
      "1.0"
    ],
    "emittedVersion": "1.0",
    "versionField": "/schema_version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:authoring-audit"
  },
  {
    "id": "skill.evaluation-design.v1",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/design_evals.ts",
    "sourceFieldOrLayout": "skill.evaluation-design.v1",
    "sourceEvidence": "artifact: \"evaluation-design\"",
    "kind": "envelope",
    "readVersionsOrRanges": [
      "1.0"
    ],
    "emittedVersion": "1.0",
    "versionField": "/schema_version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:evaluation-design"
  },
  {
    "id": "skill.evaluation-analysis.v1",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/analyze_evaluation.ts",
    "sourceFieldOrLayout": "skill.evaluation-analysis.v1",
    "sourceEvidence": "artifact:\"evaluation-analysis\"",
    "kind": "envelope",
    "readVersionsOrRanges": [
      "1.0"
    ],
    "emittedVersion": "1.0",
    "versionField": "/schema_version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:evaluation-analysis"
  },
  {
    "id": "skill.evaluation-receipt.unversioned",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/validate_evaluation_receipt.ts",
    "sourceFieldOrLayout": "skill.evaluation-receipt.unversioned",
    "sourceEvidence": "status: \"complete\" | \"blocked\"",
    "kind": "receipt",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned replacement."
    },
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:evaluation-receipt"
  },
  {
    "id": "skill.verification-receipt.v1",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/verify_skill_gates.ts",
    "sourceFieldOrLayout": "skill.verification-receipt.v1",
    "sourceEvidence": "schema_version: \"1.0\"",
    "kind": "receipt",
    "readVersionsOrRanges": [
      "1.0"
    ],
    "emittedVersion": "1.0",
    "versionField": "/schema_version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:verification-receipt"
  },
  {
    "id": "plugin.verification-receipt.v1",
    "creator": "plugin-creator",
    "sourceFile": "apps/plugin-creator-cli/scripts/verify_plugin_gates.ts",
    "sourceFieldOrLayout": "plugin.verification-receipt.v1",
    "sourceEvidence": "schema_version: \"1.0\", artifact: \"plugin\"",
    "kind": "receipt",
    "readVersionsOrRanges": [
      "1.0"
    ],
    "emittedVersion": "1.0",
    "versionField": "/schema_version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:verification-receipt"
  },
  {
    "id": "plugin.validation-outcome.unversioned",
    "creator": "plugin-creator",
    "sourceFile": "apps/plugin-creator-cli/scripts/validation_outcomes.ts",
    "sourceFieldOrLayout": "plugin.validation-outcome.unversioned",
    "sourceEvidence": "export interface ValidationOutcome",
    "kind": "envelope",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned replacement."
    },
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:validation-outcome"
  },
  {
    "id": "plugin.migration-report.unversioned",
    "creator": "plugin-creator",
    "sourceFile": "apps/plugin-creator-cli/scripts/migrate_plugin.ts",
    "sourceFieldOrLayout": "plugin.migration-report.unversioned",
    "sourceEvidence": "export interface MigrationReport",
    "kind": "envelope",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned replacement."
    },
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:migration-report"
  },
  {
    "id": "skill.evals-form.unversioned",
    "creator": "skill-creator",
    "sourceFile": "skills/skill-creator/evals/evals.json",
    "sourceFieldOrLayout": "/evals",
    "sourceEvidence": "\"evals\": [",
    "kind": "evaluation-definition",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "contract.evaluation-plan.v1"
    },
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:evals-form"
  },
  {
    "id": "agent.evals-form.unversioned",
    "creator": "agent-creator",
    "sourceFile": "skills/agent-creator/evals/evals.json",
    "sourceFieldOrLayout": "/evals",
    "sourceEvidence": "\"evals\": [",
    "kind": "evaluation-definition",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "contract.evaluation-plan.v1"
    },
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:evals-form"
  },
  {
    "id": "hook.evals-form.unversioned",
    "creator": "hook-creator",
    "sourceFile": "skills/hook-creator/evals/evals.json",
    "sourceFieldOrLayout": "/evals",
    "sourceEvidence": "\"evals\": [",
    "kind": "evaluation-definition",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "contract.evaluation-plan.v1"
    },
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:evals-form"
  },
  {
    "id": "plugin.evals-form.unversioned",
    "creator": "plugin-creator",
    "sourceFile": "skills/plugin-creator/evals/evals.json",
    "sourceFieldOrLayout": "/evals",
    "sourceEvidence": "\"evals\": [",
    "kind": "evaluation-definition",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "contract.evaluation-plan.v1"
    },
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:evals-form"
  },
  {
    "id": "skill.eval-metadata.unversioned",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/full_eval.ts",
    "sourceFieldOrLayout": "eval-<id>/eval_metadata.json",
    "sourceEvidence": "eval_metadata.json",
    "kind": "evaluation-artifact",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned evaluation metadata."
    },
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:eval-metadata"
  },
  {
    "id": "agent.eval-metadata.unversioned",
    "creator": "agent-creator",
    "sourceFile": "apps/agent-creator-cli/scripts/run_agent_eval.ts",
    "sourceFieldOrLayout": "eval-<id>/eval_metadata.json",
    "sourceEvidence": "eval_metadata.json",
    "kind": "evaluation-artifact",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned evaluation metadata."
    },
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:eval-metadata"
  },
  {
    "id": "skill.grading.unversioned",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/validate_evaluation_receipt.ts",
    "sourceFieldOrLayout": "eval-<id>/<configuration>/run-<n>/grading.json",
    "sourceEvidence": "join(runDir, \"grading.json\")",
    "kind": "evaluation-artifact",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned grading result."
    },
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:grading"
  },
  {
    "id": "agent.grading.unversioned",
    "creator": "agent-creator",
    "sourceFile": "apps/agent-creator-cli/scripts/grade_agent_eval.ts",
    "sourceFieldOrLayout": "eval-<id>/<configuration>/run-<n>/grading.json",
    "sourceEvidence": "grading.json",
    "kind": "evaluation-artifact",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned grading result."
    },
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:grading"
  },
  {
    "id": "skill.timing.unversioned",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/validate_evaluation_receipt.ts",
    "sourceFieldOrLayout": "eval-<id>/<configuration>/run-<n>/timing.json",
    "sourceEvidence": "join(runDir, \"timing.json\")",
    "kind": "evaluation-artifact",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned timing result."
    },
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:timing"
  },
  {
    "id": "agent.timing.unversioned",
    "creator": "agent-creator",
    "sourceFile": "apps/agent-creator-cli/scripts/run_agent_eval.ts",
    "sourceFieldOrLayout": "eval-<id>/<configuration>/run-<n>/timing.json",
    "sourceEvidence": "writeFileSync(join(runDir, \"timing.json\")",
    "kind": "evaluation-artifact",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned timing result."
    },
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:timing"
  },
  {
    "id": "skill.review-html.unversioned",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/full_eval.ts",
    "sourceFieldOrLayout": "review.html",
    "sourceEvidence": "join(workspace,\"review.html\")",
    "kind": "review-artifact",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned review artifact."
    },
    "migrationId": null,
    "artifactFormat": "html",
    "validatorId": "signature:html-document"
  },
  {
    "id": "skill.viewer-html.unversioned",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/eval-viewer/generate_review.ts",
    "sourceFieldOrLayout": "eval-viewer/viewer.html",
    "sourceEvidence": "readFileSync(join(HERE,\"viewer.html\"),\"utf8\")",
    "kind": "review-artifact",
    "artifactFormat": "html",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned review viewer."
    },
    "migrationId": null,
    "validatorId": "signature:html-document"
  },
  {
    "id": "agent.transcript.unversioned",
    "creator": "agent-creator",
    "sourceFile": "apps/agent-creator-cli/scripts/run_agent_eval.ts",
    "sourceFieldOrLayout": "eval-<id>/<configuration>/run-<n>/transcript.json",
    "sourceEvidence": "writeFileSync(join(runDir, \"transcript.json\")",
    "kind": "evaluation-artifact",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned transcript."
    },
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:transcript"
  },
  {
    "id": "agent.review-html.unversioned",
    "creator": "agent-creator",
    "sourceFile": "apps/agent-creator-cli/eval-viewer/generate_review.ts",
    "sourceFieldOrLayout": "review.html",
    "sourceEvidence": "const html = generateHtml(runs, agentName, previous, benchmark)",
    "kind": "review-artifact",
    "artifactFormat": "html",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned review artifact."
    },
    "migrationId": null,
    "validatorId": "signature:html-document"
  },
  {
    "id": "agent.feedback.unversioned",
    "creator": "agent-creator",
    "sourceFile": "apps/agent-creator-cli/eval-viewer/generate_review.ts",
    "sourceFieldOrLayout": "feedback.json",
    "sourceEvidence": "const feedbackPath = join(workspace, \"feedback.json\")",
    "kind": "review-artifact",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned feedback artifact."
    },
    "migrationId": null,
    "validatorId": "artifact:feedback"
  },
  {
    "id": "agent.viewer-html.unversioned",
    "creator": "agent-creator",
    "sourceFile": "apps/agent-creator-cli/eval-viewer/generate_review.ts",
    "sourceFieldOrLayout": "eval-viewer/viewer.html",
    "sourceEvidence": "const templatePath = join(HERE, \"viewer.html\")",
    "kind": "review-artifact",
    "artifactFormat": "html",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned review viewer."
    },
    "migrationId": null,
    "validatorId": "signature:html-document"
  },
  {
    "id": "skill.trigger-eval-result.v2",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/run_eval.ts",
    "sourceFieldOrLayout": "EvalOutput",
    "sourceEvidence": "interface EvalOutput{schema_version:\"2.0\"",
    "kind": "evaluation-artifact",
    "readVersionsOrRanges": [
      "2.0"
    ],
    "emittedVersion": "2.0",
    "versionField": "/schema_version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:trigger-eval-v2"
  },
  {
    "id": "skill.run-loop-result.unversioned",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/run_loop.ts",
    "sourceFieldOrLayout": "<results-dir>/<timestamp>/results.json",
    "sourceEvidence": "writeFileSync(join(resultsDir, \"results.json\")",
    "kind": "evaluation-artifact",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned run-loop result."
    },
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:run-loop-result"
  },
  {
    "id": "skill.run-loop-report.unversioned",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/run_loop.ts",
    "sourceFieldOrLayout": "<results-dir>/<timestamp>/report.html",
    "sourceEvidence": "writeFileSync(join(resultsDir, \"report.html\")",
    "kind": "review-artifact",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned run-loop report."
    },
    "migrationId": null,
    "artifactFormat": "html",
    "validatorId": "signature:html-document"
  },
  {
    "id": "skill.benchmark.unversioned",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/aggregate_benchmark.ts",
    "sourceFieldOrLayout": "skill.benchmark.unversioned",
    "sourceEvidence": "join(benchmarkDirArg, \"benchmark.json\")",
    "kind": "envelope",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned replacement."
    },
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:benchmark"
  },
  {
    "id": "skill.benchmark-markdown.unversioned",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/aggregate_benchmark.ts",
    "sourceFieldOrLayout": "benchmark.md",
    "sourceEvidence": "const outputMd = outputJson.replace(/\\.json$/, \".md\")",
    "kind": "evaluation-artifact",
    "artifactFormat": "markdown",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned benchmark report."
    },
    "migrationId": null,
    "validatorId": "signature:markdown-document"
  },
  {
    "id": "agent.benchmark.unversioned",
    "creator": "agent-creator",
    "sourceFile": "apps/agent-creator-cli/scripts/aggregate_benchmark.ts",
    "sourceFieldOrLayout": "agent.benchmark.unversioned",
    "sourceEvidence": "join(root,\"benchmark.json\")",
    "kind": "envelope",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned replacement."
    },
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:benchmark"
  },
  {
    "id": "agent.benchmark-markdown.unversioned",
    "creator": "agent-creator",
    "sourceFile": "apps/agent-creator-cli/scripts/aggregate_benchmark.ts",
    "sourceFieldOrLayout": "benchmark.md",
    "sourceEvidence": "out.replace(/\\.json$/,\".md\")",
    "kind": "evaluation-artifact",
    "artifactFormat": "markdown",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned benchmark report."
    },
    "migrationId": null,
    "validatorId": "signature:markdown-document"
  },
  {
    "id": "agent.run-summary.unversioned",
    "creator": "agent-creator",
    "sourceFile": "apps/agent-creator-cli/scripts/run_agent_eval.ts",
    "sourceFieldOrLayout": "agent.run-summary.unversioned",
    "sourceEvidence": "join(workspace, \"run_summary.json\")",
    "kind": "envelope",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned replacement."
    },
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:run-summary"
  },
  {
    "id": "workspace.skill-eval.current.v1",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/full_eval.ts",
    "sourceFieldOrLayout": "workspace.skill-eval.current.v1",
    "sourceEvidence": "for(const config of [\"with_skill\",baseline]){const configDir=join(ed,config);mkdirSync(configDir,{recursive:true});",
    "kind": "workspace-layout",
    "readVersionsOrRanges": [
      "1.0"
    ],
    "emittedVersion": "1.0",
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "layout",
    "validatorId": "shape:workspace-layout"
  },
  {
    "id": "workspace.skill-eval.legacy-runs.v0",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/validate_evaluation_receipt.ts",
    "sourceFieldOrLayout": "workspace.skill-eval.legacy-runs.v0",
    "sourceEvidence": "const legacyRoot = join(workspace, \"runs\")",
    "kind": "workspace-layout",
    "readVersionsOrRanges": [
      "0",
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "workspace.skill-eval.current.v1"
    },
    "migrationId": "workspace.skill-eval.runs-to-root.v1",
    "artifactFormat": "layout",
    "validatorId": "shape:workspace-layout"
  },
  {
    "id": "workspace.agent-eval.unversioned",
    "creator": "agent-creator",
    "sourceFile": "apps/agent-creator-cli/scripts/run_agent_eval.ts",
    "sourceFieldOrLayout": "workspace.agent-eval.unversioned",
    "sourceEvidence": "const runDir = flatLayout ? join(workspace",
    "kind": "workspace-layout",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned replacement."
    },
    "migrationId": null,
    "artifactFormat": "layout",
    "validatorId": "shape:workspace-layout"
  },
  {
    "id": "workspace.plugin-eval.unversioned",
    "creator": "plugin-creator",
    "sourceFile": "apps/plugin-creator-cli/scripts/full_eval.ts",
    "sourceFieldOrLayout": "workspace.plugin-eval.unversioned",
    "sourceEvidence": "workspace=resolve(options.workspace??join(evaluations,\"plugin\"))",
    "kind": "workspace-layout",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned replacement."
    },
    "migrationId": null,
    "artifactFormat": "layout",
    "validatorId": "shape:workspace-layout"
  },
  {
    "id": "workspace.eval-run-artifacts.unversioned",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/validate_evaluation_receipt.ts",
    "sourceFieldOrLayout": "workspace.eval-run-artifacts.unversioned",
    "sourceEvidence": "join(runDir, \"grading.json\")",
    "kind": "workspace-layout",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned replacement."
    },
    "migrationId": null,
    "artifactFormat": "layout",
    "validatorId": "shape:workspace-layout"
  },
  {
    "id": "plugin.manifest.v1",
    "creator": "plugin-creator",
    "sourceFile": "apps/plugin-creator-cli/scripts/schema_registry.ts",
    "sourceFieldOrLayout": "plugin.manifest.v1",
    "sourceEvidence": "DEFAULT_SCHEMA_VERSION = \"1.0.0\"",
    "kind": "schema-document",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/$schema",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:plugin-manifest"
  },
  {
    "id": "plugin.manifest.draft-v1.1",
    "creator": "plugin-creator",
    "sourceFile": "apps/plugin-creator-cli/scripts/schema_registry.ts",
    "sourceFieldOrLayout": "plugin.manifest.draft-v1.1",
    "sourceEvidence": "\"1.1.0\": registration(\"1.1.0\", \"draft\", false)",
    "kind": "schema-document",
    "readVersionsOrRanges": [],
    "emittedVersion": null,
    "versionField": "/$schema",
    "supportState": "unsupported",
    "deprecation": {
      "window": "Never activated; diagnostic recognition only.",
      "replacement": "plugin.manifest.v1"
    },
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:plugin-manifest"
  },
  {
    "id": "plugin.mcp.v1",
    "creator": "plugin-creator",
    "sourceFile": "apps/plugin-creator-cli/scripts/schema_registry.ts",
    "sourceFieldOrLayout": "plugin.mcp.v1",
    "sourceEvidence": "mcp: Object.freeze({ id: schemaId(version, \"mcp.schema.json\")",
    "kind": "schema-document",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/$schema",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:mcp-document"
  },
  {
    "id": "plugin.mcp.draft-v1.1",
    "creator": "plugin-creator",
    "sourceFile": "apps/plugin-creator-cli/scripts/schema_registry.ts",
    "sourceFieldOrLayout": "plugin.mcp.draft-v1.1",
    "sourceEvidence": "\"1.1.0\": registration(\"1.1.0\", \"draft\", false)",
    "kind": "schema-document",
    "readVersionsOrRanges": [],
    "emittedVersion": null,
    "versionField": "/$schema",
    "supportState": "unsupported",
    "deprecation": {
      "window": "Never activated; diagnostic recognition only.",
      "replacement": "plugin.mcp.v1"
    },
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:mcp-document"
  },
  {
    "id": "hook.document.current.unversioned",
    "creator": "hook-creator",
    "sourceFile": "apps/hook-creator-cli/scripts/init_hook.ts",
    "sourceFieldOrLayout": "hook.document.current.unversioned",
    "sourceEvidence": "doc={hooks:{}}",
    "kind": "schema-document",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:hook-document"
  },
  {
    "id": "hook.layout.legacy-root.v0",
    "creator": "hook-creator",
    "sourceFile": "apps/hook-creator-cli/scripts/hook_format.ts",
    "sourceFieldOrLayout": "hook.layout.legacy-root.v0",
    "sourceEvidence": "LEGACY_HOOKS_PATH = \"hooks/hooks.json\"",
    "kind": "workspace-layout",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned replacement."
    },
    "migrationId": null,
    "artifactFormat": "layout",
    "validatorId": "shape:workspace-layout"
  },
  {
    "id": "hook.layout.historical-namespace.v0",
    "creator": "hook-creator",
    "sourceFile": "apps/hook-creator-cli/scripts/hook_format.ts",
    "sourceFieldOrLayout": "hook.layout.historical-namespace.v0",
    "sourceEvidence": "HISTORICAL_HOOKS_PATH = \"extensions/io.github.block.goose/hooks.json\"",
    "kind": "workspace-layout",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned replacement."
    },
    "migrationId": null,
    "artifactFormat": "layout",
    "validatorId": "shape:workspace-layout"
  },
  {
    "id": "hook.layout.current.v1",
    "creator": "hook-creator",
    "sourceFile": "apps/hook-creator-cli/scripts/hook_format.ts",
    "sourceFieldOrLayout": "hook.layout.current.v1",
    "sourceEvidence": "CANONICAL_HOOKS_PATH = \"extensions/io.github.bioinfornatics.agent-plugins.goose/hooks.json\"",
    "kind": "workspace-layout",
    "readVersionsOrRanges": [
      "1"
    ],
    "emittedVersion": "1",
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "layout",
    "validatorId": "shape:workspace-layout"
  },
  {
    "id": "hook.extension-envelope.v1",
    "creator": "hook-creator",
    "sourceFile": "apps/hook-creator-cli/scripts/hook_format.ts",
    "sourceFieldOrLayout": "hook.extension-envelope.v1",
    "sourceEvidence": "extension.version !== GOOSE_ENVELOPE_VERSION",
    "kind": "envelope",
    "readVersionsOrRanges": [
      "1"
    ],
    "emittedVersion": "1",
    "versionField": "/version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:hook-extension"
  },
  {
    "id": "layout.skill-artifact.current",
    "creator": "skill-creator",
    "sourceFile": "skills/skill-creator/AGENTS.md",
    "sourceFieldOrLayout": "layout.skill-artifact.current",
    "sourceEvidence": ".agents/skills",
    "kind": "workspace-layout",
    "readVersionsOrRanges": [
      "1"
    ],
    "emittedVersion": "1",
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "layout",
    "validatorId": "shape:workspace-layout"
  },
  {
    "id": "layout.agent-artifact.current",
    "creator": "agent-creator",
    "sourceFile": "skills/agent-creator/AGENTS.md",
    "sourceFieldOrLayout": "layout.agent-artifact.current",
    "sourceEvidence": ".agents/agents",
    "kind": "workspace-layout",
    "readVersionsOrRanges": [
      "1"
    ],
    "emittedVersion": "1",
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "layout",
    "validatorId": "shape:workspace-layout"
  },
  {
    "id": "layout.plugin-artifact.current",
    "creator": "plugin-creator",
    "sourceFile": "skills/plugin-creator/AGENTS.md",
    "sourceFieldOrLayout": "layout.plugin-artifact.current",
    "sourceEvidence": ".agents/plugins",
    "kind": "workspace-layout",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "layout",
    "validatorId": "shape:workspace-layout"
  },
  {
    "id": "result.exit-family.skill",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/cli.ts",
    "sourceFieldOrLayout": "result.exit-family.skill",
    "sourceEvidence": "status === \"blocked\" ? 3 : 1",
    "kind": "status-exit-family",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:exit-family"
  },
  {
    "id": "result.exit-family.agent",
    "creator": "agent-creator",
    "sourceFile": "apps/agent-creator-cli/scripts/cli.ts",
    "sourceFieldOrLayout": "result.exit-family.agent",
    "sourceEvidence": "Exit codes: 0 success, 1 failure, 2 usage error, 3 blocked operation.",
    "kind": "status-exit-family",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:exit-family"
  },
  {
    "id": "result.exit-family.hook",
    "creator": "hook-creator",
    "sourceFile": "apps/hook-creator-cli/scripts/cli.ts",
    "sourceFieldOrLayout": "result.exit-family.hook",
    "sourceEvidence": "return usage?2:1",
    "kind": "status-exit-family",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:exit-family"
  },
  {
    "id": "result.exit-family.plugin",
    "creator": "plugin-creator",
    "sourceFile": "apps/plugin-creator-cli/scripts/cli.ts",
    "sourceFieldOrLayout": "result.exit-family.plugin",
    "sourceEvidence": "EXIT_SUCCESS=0, EXIT_FAILURE=1, EXIT_USAGE=2, EXIT_BLOCKED=3",
    "kind": "status-exit-family",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:exit-family"
  },
  {
    "id": "skill.post-evaluation-pattern-review.unversioned",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/full_eval.ts",
    "sourceFieldOrLayout": "post-evaluation-pattern-review.json",
    "sourceEvidence": "const path=join(workspace,\"post-evaluation-pattern-review.json\"),analysis=analyzeEvaluation(workspace,skill)",
    "kind": "evaluation-artifact",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned evaluation-analysis artifact."
    },
    "migrationId": null,
    "validatorId": "artifact:evaluation-analysis"
  },
  {
    "id": "agent.response-markdown.unversioned",
    "creator": "agent-creator",
    "sourceFile": "apps/agent-creator-cli/scripts/run_agent_eval.ts",
    "sourceFieldOrLayout": "eval-<id>/<configuration>/outputs/response.md",
    "sourceEvidence": "writeFileSync(join(outputs, \"response.md\")",
    "kind": "evaluation-artifact",
    "artifactFormat": "markdown",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned agent response artifact."
    },
    "migrationId": null,
    "validatorId": "signature:markdown-document"
  },
  {
    "id": "skill.paired-stream.unversioned",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/paired_execution.ts",
    "sourceFieldOrLayout": "eval-<id>/<configuration>/run-<n>/transcript.json",
    "sourceEvidence": "writeFileSync(join(runDir,\"transcript.json\"),",
    "kind": "evaluation-artifact",
    "artifactFormat": "jsonl",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": null,
    "versionField": null,
    "supportState": "legacy-readable",
    "deprecation": {
      "window": "Readable through compatibility policy 1.x and at least 2027-09-30; removal requires a 2.0 breaking release.",
      "replacement": "Future versioned paired stream envelope."
    },
    "migrationId": null,
    "validatorId": "artifact:paired-stream"
  },
  {
    "id": "skill.paired-events.v1",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/paired_execution.ts",
    "sourceFieldOrLayout": "eval-<id>/<configuration>/run-<n>/events.json",
    "sourceEvidence": "atomic(join(runDir,\"events.json\"),",
    "kind": "evaluation-artifact",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0"
    ],
    "emittedVersion": "1.0",
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "artifact:paired-events"
  },
  {
    "id": "skill.paired-failure.v1",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/paired_execution.ts",
    "sourceFieldOrLayout": "eval-<id>/<configuration>/run-<n>/execution-outcome.json",
    "sourceEvidence": "atomic(join(runDir,\"execution-outcome.json\"),",
    "kind": "evaluation-artifact",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0"
    ],
    "emittedVersion": "1.0",
    "versionField": "/schema_version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "artifact:paired-failure"
  },
  {
    "id": "agent.evidence-job.v1",
    "creator": "agent-creator",
    "sourceFile": "apps/agent-creator-cli/scripts/evidence_exchange.ts",
    "sourceFieldOrLayout": "portable evidence bundle/job.json",
    "sourceEvidence": "schema_version: JOB_SCHEMA",
    "kind": "evaluation-definition",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "agent-creator.evidence-job/v1"
    ],
    "emittedVersion": "agent-creator.evidence-job/v1",
    "versionField": "/schema_version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "artifact:evidence-job"
  },
  {
    "id": "agent.evidence-run.v1",
    "creator": "agent-creator",
    "sourceFile": "apps/agent-creator-cli/scripts/evidence_exchange.ts",
    "sourceFieldOrLayout": "portable run.example.json and imported evidence.json",
    "sourceEvidence": "schema_version: RUN_SCHEMA",
    "kind": "evaluation-artifact",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "agent-creator.evidence-run/v1"
    ],
    "emittedVersion": "agent-creator.evidence-run/v1",
    "versionField": "/schema_version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "artifact:evidence-run"
  },
  {
    "id": "plugin.component-evidence-receipt.v1",
    "creator": "plugin-creator",
    "sourceFile": "apps/plugin-creator-cli/scripts/component_evidence.ts",
    "sourceFieldOrLayout": "typed Skill, agent, hook, MCP, or integration receipt",
    "sourceEvidence": "schema_version: \"1.0\";",
    "kind": "receipt",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0"
    ],
    "emittedVersion": "1.0",
    "versionField": "/schema_version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "artifact:component-evidence-receipt"
  },
  {
    "id": "agent.eval-metadata.v2",
    "creator": "agent-creator",
    "sourceFile": "apps/agent-creator-cli/scripts/run_agent_eval.ts",
    "sourceFieldOrLayout": "eval-<id>/eval_metadata.json",
    "sourceEvidence": "schema_version: 2,",
    "kind": "evaluation-artifact",
    "readVersionsOrRanges": [
      "2"
    ],
    "emittedVersion": "2",
    "versionField": "/schema_version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:agent-eval-metadata-v2"
  },
  {
    "id": "agent.semantic-grading.v2",
    "creator": "agent-creator",
    "sourceFile": "apps/agent-creator-cli/scripts/grade_agent_eval.ts",
    "sourceFieldOrLayout": "eval-<id>/<configuration>/grading.json",
    "sourceEvidence": "schema_version:2,assertion_hash:meta.assertion_hash",
    "kind": "evaluation-artifact",
    "readVersionsOrRanges": [
      "2"
    ],
    "emittedVersion": "2",
    "versionField": "/schema_version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:semantic-grading"
  },
  {
    "id": "plugin.independent-review.v1",
    "creator": "plugin-creator",
    "sourceFile": "apps/plugin-creator-cli/scripts/independent_review.ts",
    "sourceFieldOrLayout": "runIndependentReview result / CLI JSON output",
    "sourceEvidence": "return{schemaVersion:1,runId:config.runId",
    "kind": "review-artifact",
    "readVersionsOrRanges": [
      "1"
    ],
    "emittedVersion": "1",
    "versionField": "/schemaVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:independent-review"
  },
  {
    "id": "hook.evaluation-run-manifest.v1",
    "creator": "hook-creator",
    "sourceFile": "apps/hook-creator-cli/scripts/evaluation_run_manifest.ts",
    "sourceFieldOrLayout": "eval-manifest create <spec.json> <manifest.json>",
    "sourceEvidence": "MANIFEST_VERSION=\"hook-evaluation-run-manifest/v1\"",
    "kind": "evaluation-artifact",
    "readVersionsOrRanges": [
      "hook-evaluation-run-manifest/v1"
    ],
    "emittedVersion": "hook-evaluation-run-manifest/v1",
    "versionField": "/schema_version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:evaluation-run-manifest"
  },
  {
    "id": "hook.production-approval.v1",
    "creator": "hook-creator",
    "sourceFile": "apps/hook-creator-cli/scripts/production_approval.ts",
    "sourceFieldOrLayout": "hook-production-approval/v1",
    "sourceEvidence": "export const APPROVAL_VERSION=\"hook-production-approval/v1\"",
    "kind": "evaluation-artifact",
    "readVersionsOrRanges": [
      "hook-production-approval/v1"
    ],
    "emittedVersion": "hook-production-approval/v1",
    "versionField": "/version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:production-approval"
  },
  {
    "id": "schema.hook-production-approval.v1",
    "creator": "hook-creator",
    "sourceFile": "skills/hook-creator/schemas/production-approval.schema.json",
    "sourceFieldOrLayout": "production-approval.schema.json",
    "sourceEvidence": "\"$id\": \"https://openplugins.dev/schemas/hook-production-approval-v1.json\"",
    "kind": "schema-document",
    "readVersionsOrRanges": [
      "https://openplugins.dev/schemas/hook-production-approval-v1.json"
    ],
    "emittedVersion": "https://openplugins.dev/schemas/hook-production-approval-v1.json",
    "versionField": "/$id",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "shape:production-approval-schema-document"
  },
  {
    "id": "contract.outcome-metrics-input.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/outcome-metrics-types.ts",
    "sourceFieldOrLayout": "OutcomeMetricsInput",
    "sourceEvidence": "export interface OutcomeMetricsInput {",
    "kind": "shared-contract",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/schemaVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "schema:outcome-metrics-input"
  },
  {
    "id": "api.compute-outcome-metrics.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/outcome-metrics.ts",
    "sourceFieldOrLayout": "computeOutcomeMetrics",
    "sourceEvidence": "export function computeOutcomeMetrics(value:unknown):OutcomeMetricsReport",
    "kind": "public-api",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "contract.outcome-metrics-report.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/outcome-metrics-types.ts",
    "sourceFieldOrLayout": "OutcomeMetricsReport",
    "sourceEvidence": "export interface OutcomeMetricsReport {",
    "kind": "shared-contract",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/schemaVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "artifact:outcome-metrics-report"
  },
  {
    "id": "schema.outcome-metrics.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/schema/outcome-metrics/1.0.0/outcome-productivity-metrics.schema.json",
    "sourceFieldOrLayout": "outcome-productivity-metrics.schema.json",
    "sourceEvidence": "\"$id\": \"https://agent-plugins.org/schemas/outcome-productivity-metrics/1.0.0/outcome-productivity-metrics.schema.json\"",
    "kind": "schema-document",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "shape:outcome-metrics-schema-document"
  },
  {
    "id": "contract.feedback-annotation.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/feedback-annotation-types.ts",
    "sourceFieldOrLayout": "FeedbackAnnotationV1",
    "sourceEvidence": "export interface FeedbackAnnotationV1 {",
    "kind": "shared-contract",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/schemaVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "schema:feedback-annotation"
  },
  {
    "id": "contract.feedback-interpretation.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/feedback-annotation-types.ts",
    "sourceFieldOrLayout": "FeedbackInterpretationV1",
    "sourceEvidence": "export interface FeedbackInterpretationV1 {",
    "kind": "shared-contract",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/schemaVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "artifact:feedback-interpretation"
  },
  {
    "id": "contract.feedback-proposal.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/feedback-annotation-types.ts",
    "sourceFieldOrLayout": "FeedbackProposalV1",
    "sourceEvidence": "export interface FeedbackProposalV1 {",
    "kind": "shared-contract",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/schemaVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "schema:feedback-proposal"
  },
  {
    "id": "contract.feedback-preview.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/feedback-annotation-types.ts",
    "sourceFieldOrLayout": "FeedbackPreviewV1",
    "sourceEvidence": "export interface FeedbackPreviewV1 {",
    "kind": "shared-contract",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/schemaVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "artifact:feedback-preview"
  },
  {
    "id": "contract.feedback-decision.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/feedback-annotation-types.ts",
    "sourceFieldOrLayout": "FeedbackDecisionV1",
    "sourceEvidence": "export interface FeedbackDecisionV1 {",
    "kind": "shared-contract",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/schemaVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "schema:feedback-decision"
  },
  {
    "id": "contract.feedback-revision.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/feedback-annotation-types.ts",
    "sourceFieldOrLayout": "FeedbackRevision",
    "sourceEvidence": "export interface FeedbackRevision {",
    "kind": "shared-contract",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "artifact:feedback-revision"
  },
  {
    "id": "contract.feedback-decision-result.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/feedback-annotation-types.ts",
    "sourceFieldOrLayout": "FeedbackDecisionResult",
    "sourceEvidence": "export interface FeedbackDecisionResult {",
    "kind": "shared-contract",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "schema:feedback-decision-result"
  },
  {
    "id": "schema.feedback-annotation.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/schema/feedback-annotation/1.0.0/feedback-annotation.schema.json",
    "sourceFieldOrLayout": "feedback-annotation.schema.json",
    "sourceEvidence": "\"$id\":\"https://agent-plugins.org/schemas/feedback-annotation/1.0.0/feedback-annotation.schema.json\"",
    "kind": "schema-document",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "shape:feedback-schema-document"
  },
  {
    "id": "schema.feedback-proposal.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/schema/feedback-annotation/1.0.0/feedback-proposal.schema.json",
    "sourceFieldOrLayout": "feedback-proposal.schema.json",
    "sourceEvidence": "\"$id\":\"https://agent-plugins.org/schemas/feedback-annotation/1.0.0/feedback-proposal.schema.json\"",
    "kind": "schema-document",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "shape:feedback-schema-document"
  },
  {
    "id": "schema.feedback-decision.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/schema/feedback-annotation/1.0.0/feedback-decision.schema.json",
    "sourceFieldOrLayout": "feedback-decision.schema.json",
    "sourceEvidence": "\"$id\":\"https://agent-plugins.org/schemas/feedback-annotation/1.0.0/feedback-decision.schema.json\"",
    "kind": "schema-document",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "shape:feedback-schema-document"
  },
  {
    "id": "schema.feedback-decision-result.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/schema/feedback-annotation/1.0.0/feedback-decision-result.schema.json",
    "sourceFieldOrLayout": "feedback-decision-result.schema.json",
    "sourceEvidence": "\"$id\":\"https://agent-plugins.org/schemas/feedback-annotation/1.0.0/feedback-decision-result.schema.json\"",
    "kind": "schema-document",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "shape:feedback-schema-document"
  },
  {
    "id": "api.feedback-annotation.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/feedback-annotation.ts",
    "sourceFieldOrLayout": "feedback annotation module",
    "sourceEvidence": "import {createHash} from \"node:crypto\";",
    "kind": "public-api",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "api.canonical-serialize-feedback.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/feedback-annotation.ts",
    "sourceFieldOrLayout": "canonicalSerializeFeedback",
    "sourceEvidence": "export function canonicalSerializeFeedback(value:unknown):string",
    "kind": "public-api",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "api.hash-feedback.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/feedback-annotation.ts",
    "sourceFieldOrLayout": "hashFeedback",
    "sourceEvidence": "export function hashFeedback(value:unknown):string",
    "kind": "public-api",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "api.validate-feedback-annotation.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/feedback-annotation.ts",
    "sourceFieldOrLayout": "validateFeedbackAnnotation",
    "sourceEvidence": "export function validateFeedbackAnnotation(value:unknown):FeedbackValidation",
    "kind": "public-api",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "api.create-feedback-annotation.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/feedback-annotation.ts",
    "sourceFieldOrLayout": "createFeedbackAnnotation",
    "sourceEvidence": "export function createFeedbackAnnotation(",
    "kind": "public-api",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "api.create-feedback-interpretation.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/feedback-annotation.ts",
    "sourceFieldOrLayout": "createFeedbackInterpretation",
    "sourceEvidence": "export function createFeedbackInterpretation(",
    "kind": "public-api",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "api.create-feedback-proposal.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/feedback-annotation.ts",
    "sourceFieldOrLayout": "createFeedbackProposal",
    "sourceEvidence": "export function createFeedbackProposal(",
    "kind": "public-api",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "api.preview-feedback-proposal.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/feedback-annotation.ts",
    "sourceFieldOrLayout": "previewFeedbackProposal",
    "sourceEvidence": "export function previewFeedbackProposal(",
    "kind": "public-api",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "api.decide-feedback-proposal.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/feedback-annotation.ts",
    "sourceFieldOrLayout": "decideFeedbackProposal",
    "sourceEvidence": "export function decideFeedbackProposal(",
    "kind": "public-api",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "api.compare-feedback-revisions.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/feedback-annotation.ts",
    "sourceFieldOrLayout": "compareFeedbackRevisions",
    "sourceEvidence": "export function compareFeedbackRevisions(",
    "kind": "public-api",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "contract.usage-cost-input.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/usage-cost-types.ts",
    "sourceFieldOrLayout": "UsageCostInput",
    "sourceEvidence": "export interface UsageCostInput {",
    "kind": "shared-contract",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/schemaVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "schema:usage-cost-input"
  },
  {
    "id": "contract.usage-cost-evidence.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/usage-cost-types.ts",
    "sourceFieldOrLayout": "UsageCostEvidence",
    "sourceEvidence": "export interface UsageCostEvidence {",
    "kind": "shared-contract",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/schemaVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:usage-cost-evidence"
  },
  {
    "id": "contract.usage-cost-delta.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/usage-cost-types.ts",
    "sourceFieldOrLayout": "UsageCostDelta",
    "sourceEvidence": "export interface UsageCostDelta {",
    "kind": "shared-contract",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/schemaVersion",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:usage-cost-delta"
  },
  {
    "id": "schema.usage-cost.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/schema/usage-cost/1.0.0/goose-usage-cost-evidence.schema.json",
    "sourceFieldOrLayout": "goose-usage-cost-evidence.schema.json",
    "sourceEvidence": "\"$id\": \"https://agent-plugins.org/schemas/goose-usage-cost-evidence/1.0.0/goose-usage-cost-evidence.schema.json\"",
    "kind": "schema-document",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": "/$id",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "shape:usage-cost-schema-document"
  },
  {
    "id": "api.validate-usage-cost-input.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/usage-cost.ts",
    "sourceFieldOrLayout": "validateUsageCostInput",
    "sourceEvidence": "export function validateUsageCostInput(value:unknown):UsageCostValidation",
    "kind": "public-api",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "api.compute-usage-cost-evidence.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/usage-cost.ts",
    "sourceFieldOrLayout": "computeUsageCostEvidence",
    "sourceEvidence": "export function computeUsageCostEvidence(value:unknown):UsageCostEvidence",
    "kind": "public-api",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "api.compute-paired-usage-cost-delta.v1",
    "creator": "shared",
    "sourceFile": "contracts/capability-contract/src/usage-cost.ts",
    "sourceFieldOrLayout": "computePairedUsageCostDelta",
    "sourceEvidence": "export function computePairedUsageCostDelta(baseline:UsageCostEvidence,candidate:UsageCostEvidence):UsageCostDelta",
    "kind": "public-api",
    "readVersionsOrRanges": [
      "1.0.0"
    ],
    "emittedVersion": "1.0.0",
    "versionField": null,
    "supportState": "unsupported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "unsupported:typescript-only"
  },
  {
    "id": "skill.evaluator-grading.v2",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/evaluator_grading.ts",
    "sourceFieldOrLayout": "gradeOutput return grading",
    "sourceEvidence": "grading: { schema_version: 2, authority: \"evaluator\"",
    "kind": "evaluation-artifact",
    "readVersionsOrRanges": [
      "2"
    ],
    "emittedVersion": "2",
    "versionField": "/schema_version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:evaluator-grading-v2"
  },
  {
    "id": "skill.deterministic-evidence.v1",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/paired_execution.ts",
    "sourceFieldOrLayout": "eval-<id>/<configuration>/run-<n>/deterministic-evidence.json",
    "sourceEvidence": "atomic(join(runDir,\"deterministic-evidence.json\")",
    "kind": "evaluation-artifact",
    "readVersionsOrRanges": [
      "1"
    ],
    "emittedVersion": "1",
    "versionField": "/schema_version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:deterministic-evidence-v1"
  },
  {
    "id": "skill.evidence-mode.v1",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/full_eval.ts",
    "sourceFieldOrLayout": "eval_metadata.json/evidence_mode",
    "sourceEvidence": "const evidence_mode={schema_version:1,",
    "kind": "evaluation-artifact",
    "readVersionsOrRanges": [
      "1"
    ],
    "emittedVersion": "1",
    "versionField": "/schema_version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:evidence-mode-v1"
  },
  {
    "id": "skill.trigger-run-outcome.v1",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/trigger_evaluation.ts",
    "sourceFieldOrLayout": "TriggerRunOutcome",
    "sourceEvidence": "export interface TriggerRunOutcome{schema_version:typeof TRIGGER_OUTCOME_SCHEMA_VERSION;",
    "kind": "evaluation-artifact",
    "readVersionsOrRanges": [
      "1.0"
    ],
    "emittedVersion": "1.0",
    "versionField": "/schema_version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:trigger-run-outcome-v1"
  },
  {
    "id": "skill.task-evidence.v1",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/task_evidence.ts",
    "sourceFieldOrLayout": "eval-<id>/<configuration>/run-<n>/outputs/task-evidence.json",
    "sourceEvidence": "TASK_EVIDENCE_PROTOCOL = \"task-artifacts-v1\"",
    "kind": "evaluation-artifact",
    "readVersionsOrRanges": [
      "task-artifacts-v1"
    ],
    "emittedVersion": "task-artifacts-v1",
    "versionField": "/protocol",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:task-evidence-v1"
  },
  {
    "id": "skill.capture-rejection.unversioned",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/task_evidence.ts",
    "sourceFieldOrLayout": "eval-<id>/<configuration>/run-<n>/outputs/capture-rejection.json",
    "sourceEvidence": "writeFileSync(join(runDir,\"outputs\",\"capture-rejection.json\"),",
    "kind": "evaluation-artifact",
    "artifactFormat": "json",
    "readVersionsOrRanges": [
      "unversioned"
    ],
    "emittedVersion": "unversioned",
    "versionField": null,
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "validatorId": "artifact:capture-rejection"
  },
  {
    "id": "skill.anytime-quality.v2",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/anytime_quality.ts",
    "sourceFieldOrLayout": "anytime-quality-decision.json",
    "sourceEvidence": "ANYTIME_QUALITY_ARTIFACT_VERSION = \"2.0\"",
    "kind": "evaluation-artifact",
    "readVersionsOrRanges": [
      "2.0"
    ],
    "emittedVersion": "2.0",
    "versionField": "/schema_version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:anytime-quality-v2"
  },
  {
    "id": "skill.adaptive-state.v1",
    "creator": "skill-creator",
    "sourceFile": "apps/skill-creator-cli/scripts/adaptive_scheduling.ts",
    "sourceFieldOrLayout": ".adaptive-scheduling.json",
    "sourceEvidence": "artifact: \"adaptive-scheduling-state\"",
    "kind": "evaluation-artifact",
    "readVersionsOrRanges": [
      "1.0"
    ],
    "emittedVersion": "1.0",
    "versionField": "/schema_version",
    "supportState": "supported",
    "deprecation": null,
    "migrationId": null,
    "artifactFormat": "json",
    "validatorId": "artifact:adaptive-state-v1"
  }
] as CompatibilityEntry[]).map(E)) as readonly CompatibilityEntry[];
export const RESULT_CONTRACT_REFERENCE=Object.freeze({version:RESULT_CONTRACT_VERSION,schemaId:RESULT_CONTRACT_SCHEMA_ID,mappingExport:"LEGACY_STATUS_MAPPINGS",classifierExport:"classifyResultExit"});
const D=(code:CompatibilityDiagnostic["code"],severity:CompatibilityDiagnostic["severity"],path:string,message:string,remediation:string):CompatibilityDiagnostic=>({code,severity,path,message,remediation});
function pointer(value:unknown,path:string):unknown{let out=value;for(const token of path.split("/").slice(1)){if(typeof out!=="object"||out===null)return undefined;out=(out as Record<string,unknown>)[token.replaceAll("~1","/").replaceAll("~0","~")];}return out;}
export function getCompatibilityEntry(id:string):CompatibilityEntry|undefined{return COMPATIBILITY_REGISTRY.find(item=>item.id===id);}
export function validateSurfaceShape(surfaceId:string,value:unknown):import("./compatibility-types.js").CompatibilityShapeValidationResult{
  const entry=getCompatibilityEntry(surfaceId);
  if(!entry)return{valid:false,validatorId:null,diagnostic:D("COMPATIBILITY_SURFACE_UNKNOWN","error","/","The requested public surface is not registered.","Select a registered public surface.")};
  if(entry.validatorId==="unsupported:typescript-only")return{valid:false,validatorId:entry.validatorId,diagnostic:D("COMPATIBILITY_SURFACE_NOT_SERIALIZED","error","/","This TypeScript helper has no standalone serialized document.","Use the containing serialized protocol envelope instead.")};
  try{return validateShapeById(surfaceId,entry.validatorId,value)?{valid:true,validatorId:entry.validatorId}:{valid:false,validatorId:entry.validatorId,diagnostic:D("COMPATIBILITY_SHAPE_INVALID","error","/","Payload does not match the registered public surface shape.","Supply the required discriminators and field types for "+entry.validatorId+".")};}
  catch{return{valid:false,validatorId:entry.validatorId,diagnostic:D("COMPATIBILITY_SHAPE_INVALID","error","/","Payload does not match the registered public surface shape.","Supply the required discriminators and field types for "+entry.validatorId+".")};}
}
export function readPublicSurface(input:string|Uint8Array,surfaceId?:string):CompatibilityReadResult{
  const text=typeof input==="string"?input:new TextDecoder().decode(input);
  if(!surfaceId)return{ok:false,surfaceId:null,supportState:"ambiguous",detectedVersion:null,diagnostics:[D("COMPATIBILITY_SURFACE_REQUIRED","error","/","A stable surface ID is required because legacy envelopes overlap structurally.","Select an ID from COMPATIBILITY_REGISTRY; never infer a producer from fields alone.")]};
  const found=getCompatibilityEntry(surfaceId);
  if(!found)return{ok:false,surfaceId,supportState:"unsupported",detectedVersion:null,diagnostics:[D("COMPATIBILITY_SURFACE_UNKNOWN","error","/","The requested public surface is not registered.","Select a registered public surface.")]};
  let value:unknown;
  try{
    if(found.artifactFormat==="json")value=JSON.parse(text);
    else if(found.artifactFormat==="jsonl"){const lines=text.split(/\r?\n/).filter(line=>line.trim());if(!lines.length)throw new Error("JSONL requires at least one record");value=lines.map(line=>JSON.parse(line));}
    else if(found.artifactFormat==="html"){if(!/^\s*<!doctype html>|^\s*<html[\s>]/i.test(text)||!/<\/html>\s*$/i.test(text))throw new Error("HTML document root is required");value=text;}
    else if(found.artifactFormat==="markdown"){if(!/^#{1,6}\s+\S/m.test(text))throw new Error("Markdown heading is required");value=text;}
    else {const layout=JSON.parse(text);if(typeof layout!=="object"||layout===null||!Array.isArray((layout as Record<string,unknown>).paths))throw new Error("Layout fixture requires a paths array");value=layout;}
  }catch(error){const code=found.artifactFormat==="jsonl"?"COMPATIBILITY_MALFORMED_JSONL":found.artifactFormat==="html"?"COMPATIBILITY_MALFORMED_HTML":found.artifactFormat==="markdown"?"COMPATIBILITY_MALFORMED_MARKDOWN":found.artifactFormat==="layout"?"COMPATIBILITY_MALFORMED_LAYOUT":"COMPATIBILITY_MALFORMED_JSON";return{ok:false,surfaceId,supportState:"unsupported",detectedVersion:null,entry:found,diagnostics:[D(code,"error","/","The input does not match the declared artifact format.","Preserve the original bytes and repair the declared format; infer nothing.")]};}
  if(found.validatorId==="unsupported:typescript-only"){const checked=validateSurfaceShape(surfaceId,value);return{ok:false,surfaceId,supportState:"unsupported",detectedVersion:null,entry:found,value,diagnostics:[checked.diagnostic!]};}
  if(found.supportState==="unsupported"||found.supportState==="ambiguous")return{ok:false,surfaceId,supportState:found.supportState,detectedVersion:null,entry:found,value,diagnostics:[D("COMPATIBILITY_SURFACE_AMBIGUOUS","error","/","This registered surface is not supported for reading.","Use its replacement and retain original evidence.")]};
  if(found.versionField){const raw=pointer(value,found.versionField);if(typeof raw!=="string"&&typeof raw!=="number")return{ok:false,surfaceId,supportState:"ambiguous",detectedVersion:null,entry:found,value,diagnostics:[D("COMPATIBILITY_VERSION_REQUIRED","error",found.versionField,"The declared version field is missing.","Do not infer a version; supply producer version.")]};let version=String(raw);if(found.versionField==="/$schema"||found.versionField==="/$id"){const match=version.match(/\/(\d+\.\d+\.\d+)\//);version=match?.[1]??version;}if(!found.readVersionsOrRanges.includes(version))return{ok:false,surfaceId,supportState:"unsupported",detectedVersion:version,entry:found,value,diagnostics:[D("COMPATIBILITY_VERSION_UNSUPPORTED","error",found.versionField,"The declared version is not supported for this public surface.","Retain original and use a registered migration or supported producer.")]};const shape=validateSurfaceShape(surfaceId,value);if(!shape.valid)return{ok:false,surfaceId,supportState:"unsupported",detectedVersion:version,entry:found,value,diagnostics:[shape.diagnostic!]};return{ok:true,surfaceId,supportState:found.supportState,detectedVersion:version,entry:found,value,diagnostics:[]};}
  const shape=validateSurfaceShape(surfaceId,value);if(!shape.valid)return{ok:false,surfaceId,supportState:"unsupported",detectedVersion:null,entry:found,value,diagnostics:[shape.diagnostic!]};
  return{ok:true,surfaceId,supportState:found.supportState,detectedVersion:found.readVersionsOrRanges[0]??null,entry:found,value,diagnostics:found.supportState==="legacy-readable"?[D("COMPATIBILITY_LEGACY_UNVERSIONED","warning","/","Legacy versionless evidence was read only under the explicit surface ID.","Preserve original bytes and write latest version for new evidence.")]:[]};
}
const hash=(data:Uint8Array):string=>createHash("sha256").update(data).digest("hex");
/** Maximum bytes inspected per file by migration preview. */
export const MIGRATION_PREVIEW_MAX_FILE_BYTES=8*1024*1024;
/** Maximum aggregate bytes accepted by migration preview before content inspection. */
export const MIGRATION_PREVIEW_MAX_TOTAL_BYTES=8*1024*1024;
/** Maximum file entries accepted by migration preview before any entry is inspected. */
export const MIGRATION_PREVIEW_MAX_FILE_ENTRIES=10_000;
const MIGRATION_FILE_TOO_LARGE_DIAGNOSTIC={code:"MIGRATION_ENTRY_UNSAFE",severity:"error",message:"A migration preview file exceeds the maximum permitted size.",remediation:"Provide a reviewed file no larger than the documented preview limit."} as const satisfies Omit<CompatibilityDiagnostic,"path">;
const MIGRATION_TOO_MANY_FILES_DIAGNOSTIC=Object.freeze({code:"MIGRATION_ENTRY_UNSAFE",severity:"error",path:"/files",message:"Migration preview exceeds the maximum permitted file-entry count.",remediation:"Provide a reviewed file list no larger than the documented preview limit."} as const satisfies CompatibilityDiagnostic);
const MIGRATION_FILES_ARRAY_UNSAFE_DIAGNOSTIC=Object.freeze({code:"MIGRATION_ENTRY_UNSAFE",severity:"error",path:"/files",message:"Migration preview files must be a dense plain array without additional properties.",remediation:"Provide a reviewed dense array containing only indexed migration file entries."} as const satisfies CompatibilityDiagnostic);
const MIGRATION_TOTAL_TOO_LARGE_DIAGNOSTIC=Object.freeze({code:"MIGRATION_ENTRY_UNSAFE",severity:"error",path:"/files",message:"Migration preview exceeds the maximum permitted aggregate byte size.",remediation:"Provide reviewed files whose combined size is no larger than the documented preview limit."} as const satisfies CompatibilityDiagnostic);
const MIGRATION_INPUT_UNREADABLE_DIAGNOSTIC=Object.freeze({code:"MIGRATION_ENTRY_UNSAFE",severity:"error",path:"/",message:"Migration preview input could not be safely inspected.",remediation:"Provide plain data properties and unproxied string or Uint8Array file content."} as const satisfies CompatibilityDiagnostic);
const CONTROL=/[\x00-\x1f\x7f]/;
function secretName(raw:string):boolean{return raw.replaceAll("\\","/").split("/").some(name=>{const words=name.replace(/([a-z0-9])([A-Z])/g,"$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),compact=words.join("");if(/(?:^|[^a-z0-9])(?:ghp_|github_pat_)/i.test(name))return true;if(["awsaccesskeyid","awssecretaccesskey","awssessiontoken","githubtoken","jsonwebtoken","jwt","privatekey"].some(x=>compact.includes(x)))return true;if(words.some(x=>["secret","secrets","token","tokens","credential","credentials","password","passwd","authorization","basic","bearer","jwt"].includes(x)))return true;return["api","access","auth","basic","bearer","client"].some(prefix=>words.includes(prefix)&&words.some(x=>["key","token","secret","auth","authorization"].includes(x)));});}
const SECRET_FIELD=/(?:^|[^A-Za-z0-9])(?:["']?(?:AWS[_-]?(?:ACCESS[_-]?KEY[_-]?ID|SECRET[_-]?ACCESS[_-]?KEY|SESSION[_-]?TOKEN)|aws(?:AccessKeyId|SecretAccessKey|SessionToken)|GitHubToken|githubToken|api[_-]?(?:Key|Token|Secret)|access[_-]?(?:Key|Token|Secret)|auth[_-]?(?:Key|Token|Secret)|client[_-]?(?:Key|Token|Secret)|private[_-]?Key|basic[_-]?Auth|bearer[_-]?Auth|password|passwd|secret|token|credential|authorization)["']?)\s*[:=]\s*["']?\s*(?:Basic\s+|Bearer\s+)?[^\s"']{4,}/i;
const SECRET_BYTES=/(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})|AKIA[0-9A-Z]{16}|\bAuthorization\s*:\s*(?:Bearer|Basic)\s+[^\s]{8,}|\b(?:Basic|Bearer)\s+[A-Za-z0-9._~+\/-]{8,}|\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b)/i;
const LEGACY_PATH=/^runs\/(eval-[1-9][0-9]*)\/(with_skill|old_skill|without_skill)\/(run-[1-9][0-9]*)\/(grading\.json|timing\.json|outputs\/[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*)$/;
const TARGET_PATH=/^(eval-[1-9][0-9]*)\/(with_skill|old_skill|without_skill)\/(run-[1-9][0-9]*)\/(grading\.json|timing\.json|outputs\/[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*)$/;
function classifyMigrationPath(raw:string):{path:string;source:boolean}|null{if(!raw||CONTROL.test(raw)||raw.includes("\\")||raw.startsWith("/")||/^[A-Za-z]:/.test(raw))return null;const segments=raw.split("/");if(segments.some(segment=>segment==="."||segment===".."||segment===""))return null;if(LEGACY_PATH.test(raw))return{path:raw,source:true};if(TARGET_PATH.test(raw))return{path:raw,source:false};return null;}
function decodeInterleaved(bytes:Uint8Array,offset:0|1):string{const compact=new Uint8Array(Math.ceil((bytes.length-offset)/2));let target=0;for(let index=offset;index<bytes.length;index+=2)compact[target++]=bytes[index];return new TextDecoder("latin1",{fatal:false}).decode(compact.subarray(0,target));}
function decodeSecretCandidates(bytes:Uint8Array):string[]{const values:string[]=[];const add=(value:string)=>{const normalized=value.replace(/^\uFEFF/,"");if(normalized&&!values.includes(normalized))values.push(normalized);};add(new TextDecoder("utf-8",{fatal:false}).decode(bytes));if(bytes.length>=2&&bytes[0]===0xff&&bytes[1]===0xfe)add(new TextDecoder("utf-16le",{fatal:false}).decode(bytes.subarray(2)));if(bytes.length>=2&&bytes[0]===0xfe&&bytes[1]===0xff){const swapped=new Uint8Array(bytes.length-2);for(let index=2;index+1<bytes.length;index+=2){swapped[index-2]=bytes[index+1];swapped[index-1]=bytes[index];}add(new TextDecoder("utf-16le",{fatal:false}).decode(swapped));}if(bytes.length>=4){const pairs=Math.floor(bytes.length/2);let evenZero=0,oddZero=0;for(let index=0;index<pairs*2;index+=2){if(bytes[index]===0)evenZero++;if(bytes[index+1]===0)oddZero++;}if(oddZero>=Math.max(2,Math.floor(pairs*.6)))add(decodeInterleaved(bytes,0));if(evenZero>=Math.max(2,Math.floor(pairs*.6)))add(decodeInterleaved(bytes,1));}return values;}
function containsLikelySecret(bytes:Uint8Array):boolean{return decodeSecretCandidates(bytes).some(text=>SECRET_BYTES.test(text)||SECRET_FIELD.test(text));}
const migrationError=(code:CompatibilityDiagnostic["code"],path:string,message:string,remediation:string)=>D(code,"error",path,message,remediation);
function densePlainArray(value:unknown):value is unknown[]{
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)return false;
 const keys=Reflect.ownKeys(value);if(keys.some(key=>typeof key!=="string"||key!=="length"&&!/^(0|[1-9][0-9]*)$/.test(key)))return false;
 const length=Object.getOwnPropertyDescriptor(value,"length")?.value;
 return Number.isSafeInteger(length)&&length>=0&&keys.length===length+1&&Array.from({length},(_,index)=>Object.hasOwn(value,index)).every(Boolean);
}
function assertDataOnly(value:unknown,seen=new WeakSet<object>()):void{
 if(typeof value!=="object"||value===null)return;if(seen.has(value))throw new TypeError("cyclic input");seen.add(value);
 if(value instanceof Uint8Array)return;
 for(const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))){if("get" in descriptor||"set" in descriptor)throw new TypeError("accessor input");if("value" in descriptor)assertDataOnly(descriptor.value,seen);}
}
function blockedMigration(migrationId:string,diagnostic:CompatibilityDiagnostic):MigrationPreview{return{policyVersion:COMPATIBILITY_POLICY_VERSION,migrationId,mode:"dry-run",status:"blocked",originalSha256:Object.freeze({}),operations:Object.freeze([]),diff:"",diagnostics:Object.freeze([diagnostic]),sourceMutated:false,originalsPreserved:true};}
function previewMigrationUnchecked(options:MigrationPreviewOptions):MigrationPreview{
 const value:unknown=options,record=typeof value==="object"&&value!==null?value as Record<string,unknown>:null,migrationId=typeof record?.migrationId==="string"?record.migrationId:"";const diagnostics:CompatibilityDiagnostic[]=[];const originals:Record<string,string>={};const files=new Map<string,{bytes:Uint8Array;source:boolean;index:number}>(),inputs=Array.isArray(record?.files)?record.files:null;
 if(!record)diagnostics.push(migrationError("MIGRATION_ENTRY_UNSAFE","/","Migration preview options must be an object.","Provide a migration ID and a files array."));else if(typeof record.migrationId!=="string")diagnostics.push(migrationError("MIGRATION_UNKNOWN","/migrationId","The migration ID must be a string.","Use a migration ID named by COMPATIBILITY_REGISTRY."));if(!inputs)diagnostics.push(migrationError("MIGRATION_ENTRY_UNSAFE","/files","Migration preview files must be an array.","Provide a reviewed array of migration input files."));
 const inputCount=inputs?.length??0;if(inputCount>MIGRATION_PREVIEW_MAX_FILE_ENTRIES)return blockedMigration(migrationId,MIGRATION_TOO_MANY_FILES_DIAGNOSTIC);if(inputs&&!densePlainArray(inputs))return blockedMigration(migrationId,MIGRATION_FILES_ARRAY_UNSAFE_DIAGNOSTIC);
 let totalBytes=0;if(inputs)for(const input of inputs){if(typeof input!=="object"||input===null||Array.isArray(input))continue;const bytes=(input as Record<string,unknown>).bytes;const size=typeof bytes==="string"?new TextEncoder().encode(bytes).byteLength:bytes instanceof Uint8Array?bytes.byteLength:0;if(size<=MIGRATION_PREVIEW_MAX_FILE_BYTES)totalBytes+=size;if(totalBytes>MIGRATION_PREVIEW_MAX_TOTAL_BYTES)return blockedMigration(migrationId,MIGRATION_TOTAL_TOO_LARGE_DIAGNOSTIC);}
 if(inputs)for(let index=0;index<inputCount;index++){const location="files/"+index,input=inputs[index];if(typeof input!=="object"||input===null||Array.isArray(input)){diagnostics.push(migrationError("MIGRATION_ENTRY_UNSAFE",location,"A migration file entry must be an object.","Provide a reviewed regular-file entry."));continue;}const item=input as Record<string,unknown>;if(typeof item.path!=="string"){diagnostics.push(migrationError("MIGRATION_PATH_UNSAFE",location+"/path","A migration file path must be a string.","Provide a safe relative workspace path."));continue;}if(item.entryType!=="regular-file"){diagnostics.push(migrationError("MIGRATION_ENTRY_UNSAFE",location+"/entryType","Migration preview accepts regular files only.","Provide a reviewed regular-file snapshot."));continue;}if(typeof item.bytes!=="string"&&!(item.bytes instanceof Uint8Array)){diagnostics.push(migrationError("MIGRATION_ENTRY_UNSAFE",location+"/bytes","Migration file bytes must be a string or byte array.","Provide a string or Uint8Array snapshot."));continue;}const content=typeof item.bytes==="string"?new TextEncoder().encode(item.bytes):new Uint8Array(item.bytes);if(content.byteLength>MIGRATION_PREVIEW_MAX_FILE_BYTES){diagnostics.push({...MIGRATION_FILE_TOO_LARGE_DIAGNOSTIC,path:location+"/bytes"});continue;}if(secretName(item.path)||containsLikelySecret(content)){diagnostics.push(migrationError("MIGRATION_SECRET_REJECTED",location,"A file classified as secret-bearing is not eligible for migration preview.","Remove or redact credentials before creating a preview."));continue;}const classified=classifyMigrationPath(item.path);if(!classified){diagnostics.push(migrationError("MIGRATION_PATH_UNSAFE",location+"/path","The path is outside the permitted migration layout or contains unsafe syntax.","Use an exact safe legacy source or corresponding root target path."));continue;}if(files.has(classified.path)){diagnostics.push(migrationError("MIGRATION_SOURCE_CONFLICT",location+"/path","A duplicate source path was provided.","Provide each original byte sequence once."));continue;}files.set(classified.path,{bytes:content,source:classified.source,index});originals[classified.path]=hash(content);}
 if(typeof record?.migrationId==="string"&&migrationId!=="workspace.skill-eval.runs-to-root.v1")diagnostics.push(migrationError("MIGRATION_UNKNOWN","/migrationId","The requested migration is not registered.","Use a migration ID named by COMPATIBILITY_REGISTRY."));const operations:MigrationCopyOperation[]=[];if(!diagnostics.some(d=>d.severity==="error"))for(const [from,file] of [...files].sort(([a],[b])=>a.localeCompare(b))){if(!file.source)continue;const to=from.slice(5),target=files.get(to);if(target){diagnostics.push(migrationError("MIGRATION_SOURCE_CONFLICT","files/"+target.index+"/path","The corresponding target already exists, so precedence is ambiguous.","Keep both originals and resolve the conflict explicitly."));continue;}operations.push({kind:"copy",from,to,sourceSha256:hash(file.bytes),preservesOriginal:true});}if(!operations.length&&!diagnostics.some(d=>d.severity==="error"))diagnostics.push(D("MIGRATION_NOT_APPLICABLE","info","/","No eligible legacy paths were present.","No migration is needed."));const blocked=diagnostics.some(d=>d.severity==="error"),safe=blocked?[]:operations;return{policyVersion:COMPATIBILITY_POLICY_VERSION,migrationId,mode:"dry-run",status:blocked?"blocked":safe.length?"ready":"not-applicable",originalSha256:Object.freeze(Object.fromEntries(Object.entries(originals).sort(([a],[b])=>a.localeCompare(b)))),operations:Object.freeze(safe),diff:safe.map(op=>"copy "+op.from+" -> "+op.to+" sha256:"+op.sourceSha256).join("\n"),diagnostics:Object.freeze(diagnostics),sourceMutated:false,originalsPreserved:true};}
export function previewMigration(options:MigrationPreviewOptions):MigrationPreview{
 try{const descriptor=typeof options==="object"&&options!==null?Object.getOwnPropertyDescriptor(options,"files"):undefined;const files=descriptor&&"value" in descriptor?descriptor.value:undefined;const migration=typeof options==="object"&&options!==null?Object.getOwnPropertyDescriptor(options,"migrationId"):undefined;const migrationId=migration&&"value" in migration&&typeof migration.value==="string"?migration.value:"";if(Array.isArray(files)){const length=Object.getOwnPropertyDescriptor(files,"length")?.value;if(typeof length==="number"&&length>MIGRATION_PREVIEW_MAX_FILE_ENTRIES)return blockedMigration(migrationId,MIGRATION_TOO_MANY_FILES_DIAGNOSTIC);if(!densePlainArray(files))return blockedMigration(migrationId,MIGRATION_FILES_ARRAY_UNSAFE_DIAGNOSTIC);}assertDataOnly(options);return previewMigrationUnchecked(structuredClone(options));}catch{return{policyVersion:COMPATIBILITY_POLICY_VERSION,migrationId:"",mode:"dry-run",status:"blocked",originalSha256:Object.freeze({}),operations:Object.freeze([]),diff:"",diagnostics:Object.freeze([MIGRATION_INPUT_UNREADABLE_DIAGNOSTIC]),sourceMutated:false,originalsPreserved:true};}
}
