import { type EvidenceEdge, type EvidenceGraphVerification, type EvidenceNode, type EvidenceVerificationPolicy } from "./evidence-graph-types.js";
/** Canonical hash for arbitrary JSON content. */
export declare function hashEvidenceContent(content: unknown): string;
/** Hashes the complete immutable node envelope, excluding the hash and its authenticity proof. */
export declare function hashEvidenceNodeEnvelope(node: Pick<EvidenceNode, "id" | "kind" | "schemaVersion" | "identity" | "issuedAt" | "expiresAt" | "content">): string;
/** Binds both endpoints, both envelope hashes and the dependency relation. */
export declare function hashEvidenceEdgeBinding(edge: Pick<EvidenceEdge, "from" | "to" | "relation" | "sourceEnvelopeHash" | "targetEnvelopeHash">): string;
export declare function hashEvidenceSubject(subject: string): string;
export declare function verifyTransitiveEvidenceGraph(input: unknown, policy: EvidenceVerificationPolicy): EvidenceGraphVerification;
