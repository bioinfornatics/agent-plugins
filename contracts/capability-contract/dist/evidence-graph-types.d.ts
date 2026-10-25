export declare const EVIDENCE_GRAPH_VERSION: "1.0.0";
export declare const EVIDENCE_GRAPH_SCHEMA_ID: "https://agent-plugins.org/schemas/transitive-evidence-graph/1.0.0/transitive-evidence-graph.schema.json";
export type EvidenceNodeKind = "artifact" | "scenario" | "fixture" | "plan" | "output" | "grade" | "benchmark" | "test" | "archive" | "approval";
export interface EvidenceIdentity {
    issuer: string;
    subject: string;
}
export interface Ed25519Authenticity {
    method: "ed25519";
    keyId: string;
    signature: string;
}
export interface TrustedAnchorAuthenticity {
    method: "trusted-anchor";
    anchorDigest: string;
}
export type EvidenceAuthenticity = Ed25519Authenticity | TrustedAnchorAuthenticity;
export interface EvidenceNode {
    id: string;
    kind: EvidenceNodeKind;
    schemaVersion: string;
    identity: EvidenceIdentity;
    issuedAt: string;
    expiresAt?: string;
    content: unknown;
    envelopeHash: string;
    authenticity: EvidenceAuthenticity;
}
export interface EvidenceEdge {
    id: string;
    from: string;
    to: string;
    relation: "depends-on";
    sourceEnvelopeHash: string;
    targetEnvelopeHash: string;
    dependencyHash: string;
}
export interface TransitiveEvidenceGraphV1 {
    schemaVersion: typeof EVIDENCE_GRAPH_VERSION;
    graphId: string;
    nodes: EvidenceNode[];
    edges: EvidenceEdge[];
}
export interface TrustedEvidenceKey {
    id: string;
    algorithm: "ed25519";
    publicKey: string;
}
export interface TrustedEvidenceIssuer {
    id: string;
    schemaVersions: string[];
    trustedFrom: string;
    trustedUntil?: string;
    revokedAt?: string;
    keys?: TrustedEvidenceKey[];
    trustedAnchorDigests?: string[];
}
export interface EvidenceVerificationPolicy {
    now: string;
    issuers: TrustedEvidenceIssuer[];
    trustedApprovalSubjectDigests: string[];
}
export type EvidenceGraphDiagnosticCode = "EVIDENCE_GRAPH_INVALID" | "EVIDENCE_GRAPH_VERSION_UNSUPPORTED" | "EVIDENCE_GRAPH_DUPLICATE" | "EVIDENCE_GRAPH_MISSING_BLOCK" | "EVIDENCE_GRAPH_CYCLE" | "EVIDENCE_NODE_HASH_MISMATCH" | "EVIDENCE_NODE_SCHEMA_UNSUPPORTED" | "EVIDENCE_ISSUER_UNTRUSTED" | "EVIDENCE_ISSUER_REVOKED" | "EVIDENCE_AUTHENTICITY_INVALID" | "EVIDENCE_TIMESTAMP_INVALID" | "EVIDENCE_NODE_FUTURE_ISSUED" | "EVIDENCE_NODE_EXPIRED" | "EVIDENCE_EDGE_KIND_INVALID" | "EVIDENCE_DEPENDENCY_HASH_MISMATCH" | "EVIDENCE_IDENTITY_MISMATCH" | "EVIDENCE_TIMESTAMP_ORDER_INVALID" | "EVIDENCE_APPROVAL_STALE" | "EVIDENCE_APPROVAL_ANCHOR_INVALID";
export interface EvidenceGraphDiagnostic {
    code: EvidenceGraphDiagnosticCode;
    path: string;
    message: string;
    expected?: string;
    observed?: string;
}
export interface InvalidEvidenceNode {
    id: string;
    codes: EvidenceGraphDiagnosticCode[];
}
export interface InvalidEvidenceEdge {
    id: string;
    from: string;
    to: string;
    code: EvidenceGraphDiagnosticCode;
}
export interface EvidenceGraphVerification {
    valid: boolean;
    diagnostics: EvidenceGraphDiagnostic[];
    nodeInvalid: InvalidEvidenceNode[];
    firstInvalidEdge?: InvalidEvidenceEdge;
    affectedConclusions: string[];
}
