/** External Ed25519 attestation for accountable manual screen-reader review. */
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { EMBEDDED_SCREEN_READER_TRUST_POLICY } from "./embedded_screen_reader_resources.js";
export const ATTESTATION_PAYLOAD_TYPE = "application/vnd.agent-skills.screen-reader-attestation.v1+json";
export const ATTEST_ACTION = "manual-screen-reader-attest";
const canonicalPolicyBytes = Buffer.from(EMBEDDED_SCREEN_READER_TRUST_POLICY);
// Keep the trust root inaccessible. Strings and exported digest scalars cannot be mutated in process.
const canonicalPolicyText = canonicalPolicyBytes.toString("utf8");
export const canonicalTrustPolicySha256 = createHash("sha256").update(canonicalPolicyBytes).digest("hex");
function freshCanonicalTrustPolicy() { return JSON.parse(canonicalPolicyText); }
function plain(v) { return Boolean(v) && typeof v === "object" && !Array.isArray(v); }
export function canonicalJson(value) { if (value === null || typeof value !== "object")
    return JSON.stringify(value); if (Array.isArray(value))
    return "[" + value.map(canonicalJson).join(",") + "]"; return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}"; }
export function digest(value) { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }
export function pae(payloadType, payload) { const part = (x) => Buffer.concat([Buffer.from(String(x.length)), Buffer.from(" "), x]); return Buffer.concat([Buffer.from("DSSEv1 "), part(Buffer.from(payloadType)), Buffer.from(" "), part(payload)]); }
export function makeAttestationPayload(record, issuedAt, expiresAt) { return { schema_version: 1, action: ATTEST_ACTION, protocol_sha256: record.protocol.sha256, record_sha256: digest(record), task_results_sha256: digest(record.tasks), environment_sha256: digest(record.environment), report_build: record.environment.report_build, session_code: record.record_id, reviewer_code: record.reviewer_code, issued_at: issuedAt, expires_at: expiresAt }; }
export function createPolicySigningRequest(policy) { if (!plain(policy))
    throw new Error("policy must be an object"); const bytes = Buffer.from(canonicalJson(policy)); return { artifact: "qualified-reviewer-policy-signing-request", payloadType: "application/vnd.agent-skills.reviewer-trust-policy.v1+json", payload: bytes.toString("base64"), proposed_policy_sha256: createHash("sha256").update(bytes).digest("hex"), current_policy_sha256: canonicalTrustPolicySha256, signature_algorithm: "Ed25519", notice: "Governance signs externally; this kit contains no private key. A signed approval does not activate the policy: a reviewed skill release must ship the policy and pin its exact file SHA-256 in protocol.json." }; }
export function createUnsignedRequest(record, issuedAt, expiresAt) { if (!plain(record))
    throw new Error("record must be an object"); const payload = makeAttestationPayload(record, issuedAt, expiresAt), bytes = Buffer.from(canonicalJson(payload)); return { artifact: "manual-screen-reader-attestation-request", payloadType: ATTESTATION_PAYLOAD_TYPE, payload: bytes.toString("base64"), payload_sha256: createHash("sha256").update(bytes).digest("hex"), signing_input: pae(ATTESTATION_PAYLOAD_TYPE, bytes).toString("base64"), signature_algorithm: "Ed25519", notice: "Sign the decoded signing_input with a qualified reviewer's external Ed25519 private key; no private key is accepted or stored by this kit." }; }
function instant(v) { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(v) && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null; }
function verifyAgainstPolicy(record, receipt, policy, now = new Date()) {
    const errors = [];
    if (!plain(record))
        return { valid: false, errors: ["record must be an object"] };
    if (!plain(receipt))
        return { valid: false, errors: ["receipt must be an object"] };
    if (receipt.payloadType !== ATTESTATION_PAYLOAD_TYPE)
        errors.push("receipt payloadType is not the screen-reader attestation type");
    if (typeof receipt.payload !== "string" || !Array.isArray(receipt.signatures) || receipt.signatures.length === 0)
        errors.push("receipt must contain a payload and at least one external signature");
    if (!plain(policy) || policy.schema_version !== 1 || !Array.isArray(policy.qualified_reviewers))
        errors.push("trust policy must contain qualified_reviewers");
    let bytes, payload;
    try {
        bytes = Buffer.from(String(receipt.payload), "base64");
        const text = bytes.toString("utf8");
        payload = JSON.parse(text);
        if (canonicalJson(payload) !== text)
            errors.push("receipt payload must use canonical JSON encoding");
    }
    catch {
        errors.push("receipt payload is not valid base64 canonical JSON");
    }
    if (payload) {
        const wanted = makeAttestationPayload(record, payload.issued_at, payload.expires_at);
        for (const k of ["schema_version", "action", "protocol_sha256", "record_sha256", "task_results_sha256", "environment_sha256", "report_build", "session_code", "reviewer_code"])
            if (payload[k] !== wanted[k])
                errors.push("attestation " + k + " does not match the exact record");
        for (const k of Object.keys(payload))
            if (!(k in wanted))
                errors.push("attestation has unexpected field " + k);
        const issued = instant(payload.issued_at), expires = instant(payload.expires_at), clock = now.getTime();
        if (issued === null)
            errors.push("attestation issued_at must be RFC 3339 UTC");
        else if (issued > clock)
            errors.push("attestation is not yet valid");
        if (expires === null)
            errors.push("attestation expires_at must be RFC 3339 UTC");
        else if (expires <= clock)
            errors.push("attestation is expired");
        if (issued !== null && expires !== null && expires <= issued)
            errors.push("attestation expiry must follow issuance");
    }
    if (bytes && plain(policy) && Array.isArray(policy.qualified_reviewers) && Array.isArray(receipt.signatures)) {
        for (const sig of receipt.signatures) {
            if (!plain(sig) || typeof sig.keyid !== "string" || typeof sig.sig !== "string")
                continue;
            const reviewer = policy.qualified_reviewers.find((r) => plain(r) && r.keyid === sig.keyid && r.reviewer_code === payload?.reviewer_code && Array.isArray(r.actions) && r.actions.includes(ATTEST_ACTION));
            if (!reviewer)
                continue;
            try {
                const key = createPublicKey(reviewer.public_key_pem);
                if (key.asymmetricKeyType !== "ed25519")
                    continue;
                if (verifySignature(null, pae(String(receipt.payloadType), bytes), key, Buffer.from(sig.sig, "base64")))
                    return errors.length ? { valid: false, errors } : { valid: true, errors: [], keyid: sig.keyid };
            }
            catch { }
        }
        errors.push("no signature is valid for a trusted reviewer qualified for this action");
    }
    return { valid: false, errors: [...new Set(errors)] };
}
/** Production verification always uses the immutable policy shipped by this skill. */
export function verifyAttestation(record, receipt, now = new Date()) { return verifyAgainstPolicy(record, receipt, freshCanonicalTrustPolicy(), now); }
/** Explicit test-only seam for ephemeral roots; production CLI never calls or exposes this. */
export function verifyAttestationWithTestTrustPolicy(record, receipt, policy, now = new Date()) { return verifyAgainstPolicy(record, receipt, policy, now); }
