import { createHash, createPublicKey, verify } from "node:crypto";
import { EVIDENCE_GRAPH_VERSION } from "./evidence-graph-types.js";
const KINDS = new Set(["artifact", "scenario", "fixture", "plan", "output", "grade", "benchmark", "test", "archive", "approval"]);
const MIDDLE = new Set(["scenario", "fixture", "plan"]);
const CONCLUSIONS = new Set(["output", "grade", "benchmark", "test", "archive"]);
const HASH = /^sha256:[a-f0-9]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const record = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v) => typeof v === "string" && v.length > 0 && v.trim() === v;
const instant = (v) => { if (typeof v !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v))
    return; const n = Date.parse(v); return Number.isFinite(n) && new Date(n).toISOString() === (v.includes(".") ? v : v.replace("Z", ".000Z")) ? n : undefined; };
/** Snapshot strict JSON data without invoking user code. Every own key must be an enumerable
 * string data property with ordinary JSON descriptor flags. Arrays additionally have only their
 * dense indices and the intrinsic length property. Symbols, functions and exotic descriptors fail. */
function inert(value, depth = 0, seen = new Set()) {
    if (depth > 64)
        throw new TypeError("maximum depth");
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new TypeError("non-finite number");
        return Object.is(value, -0) ? 0 : value;
    }
    if (typeof value !== "object")
        throw new TypeError("non-JSON value");
    if (seen.has(value))
        throw new TypeError("cycle");
    seen.add(value);
    const proto = Object.getPrototypeOf(value), keys = Reflect.ownKeys(value);
    if (keys.some(k => typeof k !== "string"))
        throw new TypeError("symbol key");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ordinary = (d) => !!d && "value" in d && d.enumerable === true && d.writable === true && d.configurable === true;
    if (Array.isArray(value)) {
        if (proto !== Array.prototype)
            throw new TypeError("exotic array");
        if (keys.length !== value.length + 1 || keys.some(k => k !== "length" && !/^(0|[1-9]\d*)$/.test(k)))
            throw new TypeError("array property");
        const length = descriptors.length;
        if (!length || !("value" in length) || length.value !== value.length || length.enumerable || length.writable !== true || length.configurable)
            throw new TypeError("array length descriptor");
        const out = [];
        for (let i = 0; i < value.length; i++) {
            const d = descriptors[String(i)];
            if (!ordinary(d))
                throw new TypeError("sparse or non-JSON array descriptor");
            out.push(inert(d.value, depth + 1, seen));
        }
        seen.delete(value);
        return out;
    }
    if (proto !== Object.prototype && proto !== null)
        throw new TypeError("non-plain object");
    const out = {};
    for (const key of keys.sort()) {
        if (key === "__proto__" || key === "prototype" || key === "constructor")
            throw new TypeError("unsafe key");
        const d = descriptors[key];
        if (!ordinary(d))
            throw new TypeError("non-JSON object descriptor");
        out[key] = inert(d.value, depth + 1, seen);
    }
    seen.delete(value);
    return out;
}
function canonical(value) { return JSON.stringify(inert(value)); }
const sha = (value) => "sha256:" + createHash("sha256").update(value, "utf8").digest("hex");
/** Canonical hash for arbitrary JSON content. */
export function hashEvidenceContent(content) { return sha(canonical(content)); }
/** Hashes the complete immutable node envelope, excluding the hash and its authenticity proof. */
export function hashEvidenceNodeEnvelope(node) {
    const value = { id: node.id, kind: node.kind, schemaVersion: node.schemaVersion, identity: node.identity, issuedAt: node.issuedAt };
    if (node.expiresAt !== undefined)
        value.expiresAt = node.expiresAt;
    value.content = node.content;
    return sha(canonical(value));
}
/** Binds both endpoints, both envelope hashes and the dependency relation. */
export function hashEvidenceEdgeBinding(edge) { return sha(canonical({ from: edge.from, relation: edge.relation, sourceEnvelopeHash: edge.sourceEnvelopeHash, targetEnvelopeHash: edge.targetEnvelopeHash, to: edge.to })); }
export function hashEvidenceSubject(subject) { return sha(subject); }
const diag = (code, path, message, expected, observed) => ({ code, path, message, ...(expected === undefined ? {} : { expected }), ...(observed === undefined ? {} : { observed }) });
const shapeKeys = (v, keys) => Object.keys(v).length === keys.length && keys.every(k => own(v, k));
const validKindEdge = (a, b) => (a === "artifact" && MIDDLE.has(b)) || (MIDDLE.has(a) && CONCLUSIONS.has(b)) || (CONCLUSIONS.has(a) && b === "approval");
const redacted = (v) => "[redacted:" + sha(v) + "]";
function verifyGraph(rawInput, rawPolicy) {
    const input = inert(rawInput), policy = inert(rawPolicy);
    const diagnostics = [], invalid = new Map();
    const fail = (c, p, m, e, o) => diagnostics.push(diag(c, p, m, e, o));
    const nodeFail = (id, c, p, m, e, o) => { fail(c, p, m, e, o); const s = invalid.get(id) ?? new Set(); s.add(c); invalid.set(id, s); };
    const empty = () => ({ valid: false, diagnostics, nodeInvalid: [], affectedConclusions: [] });
    if (!record(input) || !shapeKeys(input, ["schemaVersion", "graphId", "nodes", "edges"]) || !text(input.graphId) || !Array.isArray(input.nodes) || !Array.isArray(input.edges)) {
        fail("EVIDENCE_GRAPH_INVALID", "/", "Graph shape is invalid.");
        return empty();
    }
    if (input.schemaVersion !== EVIDENCE_GRAPH_VERSION)
        fail("EVIDENCE_GRAPH_VERSION_UNSUPPORTED", "/schemaVersion", "Graph schema version is unsupported.", EVIDENCE_GRAPH_VERSION, String(input.schemaVersion));
    if (!record(policy) || !shapeKeys(policy, ["now", "issuers", "trustedApprovalSubjectDigests"]) || instant(policy.now) === undefined || !Array.isArray(policy.issuers) || !Array.isArray(policy.trustedApprovalSubjectDigests) || policy.trustedApprovalSubjectDigests.some(x => !HASH.test(x))) {
        fail("EVIDENCE_GRAPH_INVALID", "/policy", "Verification policy is invalid.");
        return empty();
    }
    const issuerIds = new Set(), issuers = new Map();
    policy.issuers.forEach((v, i) => { const optional = [v.trustedUntil !== undefined ? "trustedUntil" : "", v.revokedAt !== undefined ? "revokedAt" : "", v.keys !== undefined ? "keys" : "", v.trustedAnchorDigests !== undefined ? "trustedAnchorDigests" : ""].filter(Boolean); const ok = record(v) && shapeKeys(v, ["id", "schemaVersions", "trustedFrom", ...optional]) && text(v.id) && ID.test(v.id) && !issuerIds.has(v.id) && Array.isArray(v.schemaVersions) && v.schemaVersions.length > 0 && v.schemaVersions.every(x => text(x) && VERSION.test(x)) && instant(v.trustedFrom) !== undefined && (v.trustedUntil === undefined || instant(v.trustedUntil) !== undefined) && (v.revokedAt === undefined || instant(v.revokedAt) !== undefined) && (v.trustedAnchorDigests === undefined || (Array.isArray(v.trustedAnchorDigests) && v.trustedAnchorDigests.every(x => typeof x === "string" && HASH.test(x)))) && (v.keys === undefined || (Array.isArray(v.keys) && v.keys.every(k => record(k) && shapeKeys(k, ["id", "algorithm", "publicKey"]) && text(k.id) && k.algorithm === "ed25519" && typeof k.publicKey === "string" && k.publicKey.length > 0))); if (!ok)
        fail("EVIDENCE_GRAPH_INVALID", `/policy/issuers/${i}`, "Issuer trust record is invalid.");
    else {
        issuerIds.add(v.id);
        issuers.set(v.id, v);
    } });
    if (input.nodes.length === 0 || input.nodes.length > 4096 || input.edges.length === 0 || input.edges.length > 16384)
        fail("EVIDENCE_GRAPH_INVALID", "/", "Graph exceeds evidence block bounds.");
    const nodes = new Map(), indexes = new Map(), identities = new Map();
    input.nodes.forEach((raw, i) => { const p = `/nodes/${i}`; const keys = record(raw) ? ["id", "kind", "schemaVersion", "identity", "issuedAt", ...(own(raw, "expiresAt") ? ["expiresAt"] : []), "content", "envelopeHash", "authenticity"] : []; const auth = record(raw) && record(raw.authenticity) ? raw.authenticity : undefined; const authOk = auth && ((auth.method === "ed25519" && shapeKeys(auth, ["method", "keyId", "signature"]) && text(auth.keyId) && typeof auth.signature === "string" && /^[A-Za-z0-9_-]{86}$/.test(auth.signature)) || (auth.method === "trusted-anchor" && shapeKeys(auth, ["method", "anchorDigest"]) && typeof auth.anchorDigest === "string" && HASH.test(auth.anchorDigest))); if (!record(raw) || !shapeKeys(raw, keys) || !text(raw.id) || !ID.test(raw.id) || !KINDS.has(raw.kind) || !text(raw.schemaVersion) || !VERSION.test(raw.schemaVersion) || !record(raw.identity) || !shapeKeys(raw.identity, ["issuer", "subject"]) || !text(raw.identity.issuer) || !text(raw.identity.subject) || !text(raw.envelopeHash) || !HASH.test(raw.envelopeHash) || instant(raw.issuedAt) === undefined || (raw.expiresAt !== undefined && instant(raw.expiresAt) === undefined) || !authOk) {
        if (record(raw) && text(raw.id) && ID.test(raw.id))
            nodeFail(raw.id, "EVIDENCE_GRAPH_INVALID", p, "Node shape is invalid.");
        else
            fail("EVIDENCE_GRAPH_INVALID", p, "Node shape is invalid.");
        return;
    } if (nodes.has(raw.id)) {
        nodeFail(raw.id, "EVIDENCE_GRAPH_DUPLICATE", p + "/id", "Duplicate node identifier.");
        return;
    } const identityKey = `${raw.identity.issuer}\0${raw.identity.subject}`, duplicateIdentity = identities.get(identityKey); if (duplicateIdentity) {
        nodeFail(raw.id, "EVIDENCE_IDENTITY_MISMATCH", p + "/identity", "Issuer and subject identity tuple must be unique across nodes.", undefined, `duplicate of ${duplicateIdentity}`);
    }
    else
        identities.set(identityKey, raw.id); nodes.set(raw.id, raw); indexes.set(raw.id, i); });
    const edges = [], edgeIds = new Set(), pairs = new Set();
    input.edges.forEach((raw, i) => { const p = `/edges/${i}`; if (!record(raw) || !shapeKeys(raw, ["id", "from", "to", "relation", "sourceEnvelopeHash", "targetEnvelopeHash", "dependencyHash"]) || ![raw.id, raw.from, raw.to].every(text) || !ID.test(raw.id) || raw.relation !== "depends-on" || ![raw.sourceEnvelopeHash, raw.targetEnvelopeHash, raw.dependencyHash].every(x => typeof x === "string" && HASH.test(x))) {
        fail("EVIDENCE_GRAPH_INVALID", p, "Edge shape is invalid.");
        return;
    } const id = raw.id, pair = raw.from + "\0" + raw.to; if (edgeIds.has(id) || pairs.has(pair)) {
        fail("EVIDENCE_GRAPH_DUPLICATE", p, "Duplicate edge identifier or dependency.");
        return;
    } edgeIds.add(id); pairs.add(pair); edges.push({ ...raw, index: i }); });
    const now = instant(policy.now);
    for (const [id, node] of [...nodes].sort(([a], [b]) => a.localeCompare(b))) {
        const i = indexes.get(id), issued = instant(node.issuedAt);
        let actual;
        try {
            actual = hashEvidenceNodeEnvelope(node);
        }
        catch {
            nodeFail(id, "EVIDENCE_GRAPH_INVALID", `/nodes/${i}`, "Node envelope is not canonical JSON.");
        }
        if (actual && actual !== node.envelopeHash)
            nodeFail(id, "EVIDENCE_NODE_HASH_MISMATCH", `/nodes/${i}/envelopeHash`, "Node envelope hash does not match canonical metadata and content.", node.envelopeHash, actual);
        const issuer = issuers.get(node.identity.issuer);
        if (!issuer) {
            nodeFail(id, "EVIDENCE_ISSUER_UNTRUSTED", `/nodes/${i}/identity/issuer`, "Node issuer is not trusted.");
            continue;
        }
        if (!issuer.schemaVersions.includes(node.schemaVersion))
            nodeFail(id, "EVIDENCE_NODE_SCHEMA_UNSUPPORTED", `/nodes/${i}/schemaVersion`, "Issuer does not support the node schema version.");
        const start = instant(issuer.trustedFrom), until = issuer.trustedUntil ? instant(issuer.trustedUntil) : undefined, revoked = issuer.revokedAt ? instant(issuer.revokedAt) : undefined;
        if (issued < start || (until !== undefined && issued > until))
            nodeFail(id, "EVIDENCE_ISSUER_UNTRUSTED", `/nodes/${i}/issuedAt`, "Node was issued outside the issuer trust interval.");
        if (revoked !== undefined && issued >= revoked)
            nodeFail(id, "EVIDENCE_ISSUER_REVOKED", `/nodes/${i}/identity/issuer`, "Node issuer was revoked when the node was issued.");
        if (issued > now)
            nodeFail(id, "EVIDENCE_NODE_FUTURE_ISSUED", `/nodes/${i}/issuedAt`, "Node issuance is in the future.");
        const expiry = node.expiresAt ? instant(node.expiresAt) : undefined;
        if (expiry !== undefined && (expiry < issued || expiry < now))
            nodeFail(id, "EVIDENCE_NODE_EXPIRED", `/nodes/${i}/expiresAt`, "Node is expired or has an invalid validity interval.");
        let authentic = false;
        if (node.authenticity.method === "trusted-anchor")
            authentic = node.authenticity.anchorDigest === node.envelopeHash && (issuer.trustedAnchorDigests ?? []).includes(node.authenticity.anchorDigest);
        else {
            const signed = node.authenticity;
            const key = issuer.keys?.find(k => k.id === signed.keyId);
            if (key)
                try {
                    authentic = verify(null, Buffer.from(node.envelopeHash, "utf8"), createPublicKey(key.publicKey), Buffer.from(signed.signature, "base64url"));
                }
                catch {
                    authentic = false;
                }
        }
        if (!authentic)
            nodeFail(id, "EVIDENCE_AUTHENTICITY_INVALID", `/nodes/${i}/authenticity`, "Node authenticity proof is invalid.");
        if (node.kind === "approval" && !policy.trustedApprovalSubjectDigests.includes(hashEvidenceSubject(node.identity.subject)))
            nodeFail(id, "EVIDENCE_APPROVAL_ANCHOR_INVALID", `/nodes/${i}/identity/subject`, "Approval subject is not anchored by a trusted external digest.", undefined, redacted(node.identity.subject));
    }
    const outgoing = new Map(), bad = [];
    const edgeFail = (e, c, path, msg, expected, observed) => { fail(c, path, msg, expected, observed); bad.push({ edge: e, code: c }); };
    for (const e of edges.slice().sort((a, b) => a.id.localeCompare(b.id))) {
        const p = `/edges/${e.index}`, from = nodes.get(e.from), to = nodes.get(e.to);
        if (!from || !to) {
            edgeFail(e, "EVIDENCE_GRAPH_MISSING_BLOCK", p, "Dependency endpoint is missing.");
            continue;
        }
        (outgoing.get(e.from) ?? outgoing.set(e.from, []).get(e.from)).push(e.to);
        const sourceCodes = invalid.get(e.from), targetCodes = invalid.get(e.to);
        for (const c of [...(sourceCodes ?? []), ...(targetCodes ?? [])].sort())
            edgeFail(e, c, p, "Dependency references an invalid evidence block.");
        if (!validKindEdge(from.kind, to.kind))
            edgeFail(e, "EVIDENCE_EDGE_KIND_INVALID", p, "Dependency kinds do not follow the evidence progression.");
        if (e.sourceEnvelopeHash !== from.envelopeHash || e.targetEnvelopeHash !== to.envelopeHash || e.dependencyHash !== hashEvidenceEdgeBinding(e))
            edgeFail(e, "EVIDENCE_DEPENDENCY_HASH_MISMATCH", p, "Dependency does not bind both endpoint envelopes and relation.");
        if (instant(from.issuedAt) > instant(to.issuedAt))
            edgeFail(e, to.kind === "approval" ? "EVIDENCE_APPROVAL_STALE" : "EVIDENCE_TIMESTAMP_ORDER_INVALID", p, "Conclusion predates its dependency.");
    }
    const incoming = new Map();
    for (const e of edges)
        incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
    for (const [id, n] of [...nodes].sort(([a], [b]) => a.localeCompare(b)))
        if (n.kind !== "artifact" && !incoming.has(id)) {
            nodeFail(id, "EVIDENCE_GRAPH_MISSING_BLOCK", `/nodes/${indexes.get(id)}`, "Evidence block has no dependency.");
        }
    const state = new Map();
    let cycle = false;
    const visit = (id) => { state.set(id, 1); for (const v of (outgoing.get(id) ?? []).sort()) {
        if (state.get(v) === 1)
            cycle = true;
        else if (!state.has(v))
            visit(v);
    } state.set(id, 2); };
    for (const id of [...nodes.keys()].sort())
        if (!state.has(id))
            visit(id);
    if (cycle)
        fail("EVIDENCE_GRAPH_CYCLE", "/edges", "Evidence graph contains a cycle.");
    // A release graph is complete only when every branch converges through valid dependencies on an
    // intrinsically valid terminal approval. Checking every node makes orphan side branches fail.
    const initiallyInvalid = new Set(invalid.keys()), badEdgeIds = new Set(bad.map(x => x.edge.id)), validOutgoing = new Map();
    for (const e of edges)
        if (!badEdgeIds.has(e.id) && !initiallyInvalid.has(e.from) && !initiallyInvalid.has(e.to))
            (validOutgoing.get(e.from) ?? validOutgoing.set(e.from, []).get(e.from)).push(e.to);
    const terminalApprovals = new Set([...nodes].filter(([id, n]) => n.kind === "approval" && !initiallyInvalid.has(id) && (outgoing.get(id)?.length ?? 0) === 0).map(([id]) => id));
    if (terminalApprovals.size === 0)
        fail("EVIDENCE_GRAPH_MISSING_BLOCK", "/nodes", "Graph has no valid terminal approval conclusion.");
    if (!cycle) {
        const reaches = new Map();
        const reachesApproval = (id) => { const cached = reaches.get(id); if (cached !== undefined)
            return cached; if (initiallyInvalid.has(id)) {
            reaches.set(id, false);
            return false;
        } const yes = terminalApprovals.has(id) || (validOutgoing.get(id) ?? []).some(reachesApproval); reaches.set(id, yes); return yes; };
        for (const id of [...nodes.keys()].sort())
            if (!reachesApproval(id))
                nodeFail(id, "EVIDENCE_GRAPH_MISSING_BLOCK", `/nodes/${indexes.get(id)}`, "Evidence branch has no directed path to a valid terminal approval conclusion.");
    }
    // Union descendants of every invalid node and every invalid edge, not merely the first failure.
    const roots = new Set([...invalid.keys()]);
    for (const x of bad)
        roots.add(x.edge.to);
    const affected = new Set(), seen = new Set(), q = [...roots].sort();
    while (q.length) {
        const id = q.shift();
        if (seen.has(id))
            continue;
        seen.add(id);
        const n = nodes.get(id);
        if (n && (CONCLUSIONS.has(n.kind) || n.kind === "approval"))
            affected.add(id);
        q.push(...(outgoing.get(id) ?? []).sort());
    }
    const first = bad.sort((a, b) => a.edge.id.localeCompare(b.edge.id) || a.code.localeCompare(b.code))[0];
    const nodeInvalid = [...invalid].sort(([a], [b]) => a.localeCompare(b)).map(([id, codes]) => ({ id, codes: [...codes].sort() }));
    return { valid: diagnostics.length === 0, diagnostics, nodeInvalid, ...(first ? { firstInvalidEdge: { id: first.edge.id, from: first.edge.from, to: first.edge.to, code: first.code } } : {}), affectedConclusions: [...affected].sort() };
}
export function verifyTransitiveEvidenceGraph(input, policy) { try {
    return verifyGraph(input, policy);
}
catch {
    return { valid: false, diagnostics: [diag("EVIDENCE_GRAPH_INVALID", "/", "Graph contains inaccessible or hostile runtime data.")], nodeInvalid: [], affectedConclusions: [] };
} }
