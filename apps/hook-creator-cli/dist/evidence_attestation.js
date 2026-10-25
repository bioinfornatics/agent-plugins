import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { canonicalSerialize } from "./evaluation_run_manifest.js";
export const PAYLOAD_TYPE = "application/vnd.in-toto+json", STATEMENT_TYPE = "https://in-toto.io/Statement/v1", PREDICATE_TYPE = "https://openplugins.dev/attestation/hook-evidence/v1";
const HEX = /^[a-f0-9]{64}$/, plain = (x) => x !== null && typeof x === "object" && !Array.isArray(x) && (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null), sha = (x) => createHash("sha256").update(x).digest("hex");
function fail(x) { throw Error(x); }
function object(x, n, r, o = []) { if (!plain(x))
    fail(n + " must be object"); const a = new Set([...r, ...o]); for (const k of Object.keys(x))
    if (!a.has(k))
        fail(n + " unsupported " + k); for (const k of r)
    if (!(k in x))
        fail(n + " missing " + k); return x; }
function text(x, n) { if (typeof x !== "string" || !x.trim())
    fail(n + " must be non-empty"); return x; }
function digest(x, n) { if (typeof x !== "string" || !HEX.test(x))
    fail(n + " invalid SHA-256"); return x; }
const UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;
function instant(x, n) { text(x, n); const m = UTC.exec(x); if (!m)
    fail(n + " invalid UTC timestamp"); const ms = Date.parse(x), d = new Date(ms); if (Number.isNaN(ms) || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() + 1 !== +m[2] || d.getUTCDate() !== +m[3] || d.getUTCHours() !== +m[4] || d.getUTCMinutes() !== +m[5] || d.getUTCSeconds() !== +m[6])
    fail(n + " invalid UTC timestamp"); return x; }
function freshness(p, now) { const n = now.getTime(); if (!Number.isFinite(n))
    return { state: "invalid", error: "verification time is invalid" }; if (n < Date.parse(p.issued_at))
    return { state: "invalid", error: "attestation is not yet valid" }; if (n >= Date.parse(p.expires_at))
    return { state: "expired", error: "attestation expired" }; return null; }
function safe(root, v, n) { const p = resolve(root, text(v, n)), r = relative(root, p); if (r === ".." || r.startsWith(".." + sep))
    fail(n + " escapes base"); let c = root; for (const q of r.split(sep)) {
    if (!q || q === ".")
        continue;
    c = join(c, q);
    if (lstatSync(c).isSymbolicLink())
        fail("symlink rejected");
} return p; }
function hashPath(p) { const s = lstatSync(p); if (s.isFile())
    return sha(readFileSync(p)); if (!s.isDirectory())
    fail("unsupported input"); const e = []; const walk = (d) => { for (const n of readdirSync(d).sort()) {
    const f = join(d, n), z = lstatSync(f);
    if (z.isSymbolicLink())
        fail("symlink rejected");
    if (z.isDirectory())
        walk(f);
    else if (z.isFile())
        e.push({ path: relative(p, f).split(sep).join("/"), sha256: sha(readFileSync(f)) });
    else
        fail("unsupported input");
} }; walk(p); return sha(canonicalSerialize(e)); }
function b64(x, n) { if (typeof x !== "string" || !x.length || !/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(x))
    fail(n + " invalid base64"); const b = Buffer.from(x, "base64"); if (b.toString("base64") !== x)
    fail(n + " noncanonical base64"); return b; }
function pae(t, p) { return Buffer.concat([Buffer.from("DSSEv1 " + Buffer.byteLength(t) + " " + t + " " + p.length + " "), p]); }
function keyid(k) { return sha(k.export({ type: "spki", format: "der" })); }
function predicate(x) { x = object(x, "predicate", ["evidence_kind", "issuer", "source", "manifest", "result", "invocation", "issued_at", "expires_at"]); if (!["test", "evaluation"].includes(x.evidence_kind))
    fail("invalid evidence kind"); const i = object(x.issuer, "issuer", ["id", "environment"]); text(i.id, "issuer.id"); if (!["local", "ci"].includes(i.environment))
    fail("invalid issuer environment"); const s = object(x.source, "source", ["revision", "digest"]); text(s.revision, "source.revision"); digest(object(s.digest, "source.digest", ["sha256"]).sha256, "source digest"); if (x.manifest === null) {
    if (x.evidence_kind === "evaluation")
        fail("evaluation requires manifest hash");
}
else
    digest(object(x.manifest, "manifest", ["sha256"]).sha256, "manifest hash"); const r = object(x.result, "result", ["status", "sha256"]); if (!["pass", "fail"].includes(r.status))
    fail("invalid result"); digest(r.sha256, "result hash"); const v = object(x.invocation, "invocation", ["command", "exit_code", "cwd", "environment"]); if (!Array.isArray(v.command) || !v.command.length || v.command.some((q) => typeof q !== "string"))
    fail("command must be exact argv"); if (!Number.isInteger(v.exit_code))
    fail("exit code must be integer"); text(v.cwd, "cwd"); const env = object(v.environment, "environment", ["platform", "arch", "node", "variables"]); for (const k of ["platform", "arch", "node"])
    text(env[k], k); if (!plain(env.variables))
    fail("environment variables must be object"); for (const [k, val] of Object.entries(env.variables)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || typeof val !== "string")
        fail("invalid environment variable");
    if (/secret|token|password|credential|api[_-]?key|private/i.test(k))
        fail("secret environment variables forbidden");
} instant(x.issued_at, "issued_at"); instant(x.expires_at, "expires_at"); if (Date.parse(x.expires_at) <= Date.parse(x.issued_at))
    fail("expiry must follow issue time"); return x; }
export function validateEvidenceStatement(raw) { const x = object(raw, "statement", ["_type", "subject", "predicateType", "predicate"]); if (x._type !== STATEMENT_TYPE || x.predicateType !== PREDICATE_TYPE)
    fail("unsupported statement"); if (!Array.isArray(x.subject) || x.subject.length !== 1)
    fail("exactly one subject required"); const s = object(x.subject[0], "subject", ["name", "digest"]); text(s.name, "subject.name"); digest(object(s.digest, "subject.digest", ["sha256"]).sha256, "subject hash"); predicate(x.predicate); return x; }
export function validateEvidenceEnvelope(raw) { const e = object(raw, "envelope", ["payloadType", "payload", "signatures"]); if (e.payloadType !== PAYLOAD_TYPE)
    fail("unsupported payload type"); const p = b64(e.payload, "payload"); let s; try {
    s = JSON.parse(p.toString("utf8"));
}
catch {
    fail("payload is not JSON");
} validateEvidenceStatement(s); if (canonicalSerialize(s) !== p.toString("utf8"))
    fail("payload is not canonical JSON"); if (!Array.isArray(e.signatures) || e.signatures.length > 1)
    fail("zero or one signature required"); for (const q of e.signatures) {
    object(q, "signature", ["keyid", "sig"]);
    digest(q.keyid, "keyid");
    b64(q.sig, "signature");
} if (s.predicate.issuer.environment === "local" && e.signatures.length)
    fail("local evidence must be unsigned"); if (s.predicate.issuer.environment === "ci" && e.signatures.length !== 1)
    fail("CI evidence must be signed"); return { envelope: e, statement: s, payload: p }; }
export function createEvidenceAttestation(raw, root, opt = {}) { const x = object(raw, "spec", ["evidence_kind", "subject", "source", "result", "command", "exit_code", "environment", "issuer", "issued_at", "expires_at"], ["manifest"]), base = realpathSync(resolve(root)), subject = object(x.subject, "subject", ["name", "path"]), source = object(x.source, "source", ["revision", "path"]), result = object(x.result, "result", ["status", "path"]), issuer = object(x.issuer, "issuer", ["id", "environment"]); if (!["test", "evaluation"].includes(x.evidence_kind) || !["pass", "fail"].includes(result.status) || !["local", "ci"].includes(issuer.environment))
    fail("invalid evidence spec"); const manifest = x.manifest === undefined ? null : { sha256: hashPath(safe(base, x.manifest, "manifest")) }; if (x.evidence_kind === "evaluation" && !manifest)
    fail("evaluation requires manifest"); const statement = { _type: STATEMENT_TYPE, subject: [{ name: text(subject.name, "subject.name"), digest: { sha256: hashPath(safe(base, subject.path, "subject.path")) } }], predicateType: PREDICATE_TYPE, predicate: { evidence_kind: x.evidence_kind, issuer: { id: text(issuer.id, "issuer.id"), environment: issuer.environment }, source: { revision: text(source.revision, "source.revision"), digest: { sha256: hashPath(safe(base, source.path, "source.path")) } }, manifest, result: { status: result.status, sha256: hashPath(safe(base, result.path, "result.path")) }, invocation: { command: x.command, exit_code: x.exit_code, cwd: base, environment: x.environment }, issued_at: x.issued_at, expires_at: x.expires_at } }; validateEvidenceStatement(statement); const payload = Buffer.from(canonicalSerialize(statement)), envelope = { payloadType: PAYLOAD_TYPE, payload: payload.toString("base64"), signatures: [] }; if (issuer.environment === "ci") {
    if (!opt.privateKeyPem)
        fail("CI evidence requires private key");
    const k = createPrivateKey(opt.privateKeyPem);
    if (k.asymmetricKeyType !== "ed25519")
        fail("signing key must be Ed25519");
    const pub = createPublicKey(k);
    envelope.signatures = [{ keyid: keyid(pub), sig: sign(null, pae(PAYLOAD_TYPE, payload), k).toString("base64") }];
}
else if (opt.privateKeyPem)
    fail("local evidence cannot be signed"); return envelope; }
export function verifyEvidenceAttestation(raw, opt = {}) { const policy = opt.policy ?? "local"; if (policy === "production" && opt.manualTestsStatus !== undefined)
    return { ok: false, state: "invalid", trust: "none", errors: ["manual --tests-status cannot satisfy production policy"] }; let p; try {
    p = validateEvidenceEnvelope(raw);
}
catch (e) {
    return { ok: false, state: "invalid", trust: "none", errors: [e.message] };
} const pred = p.statement.predicate, f = freshness(pred, opt.now ?? new Date()); if (f)
    return { ok: false, state: f.state, trust: "none", errors: [f.error] }; if (pred.issuer.environment === "local") {
    const errors = [];
    if (policy === "production")
        errors.push("production requires trusted CI evidence");
    if (pred.result.status !== "pass" || pred.invocation.exit_code !== 0)
        errors.push("evidence did not pass with exit code 0");
    return { ok: !errors.length, state: "local", trust: "low", errors };
} let trust; try {
    trust = object(opt.trustPolicy, "trust policy", ["version", "issuers"]);
    if (trust.version !== "hook-attestation-trust-policy/v1" || !Array.isArray(trust.issuers))
        fail("unsupported trust policy");
    for (const q of trust.issuers)
        object(q, "trusted issuer", ["id", "keyid", "public_key_pem"]);
}
catch (e) {
    return { ok: false, state: "untrusted-issuer", trust: "none", errors: [e.message] };
} const sig = p.envelope.signatures[0], entry = trust.issuers.find((q) => q.id === pred.issuer.id && q.keyid === sig.keyid); if (!entry)
    return { ok: false, state: "untrusted-issuer", trust: "none", errors: ["issuer or key is untrusted"] }; try {
    const k = createPublicKey(text(entry.public_key_pem, "public key"));
    if (k.asymmetricKeyType !== "ed25519" || keyid(k) !== entry.keyid)
        fail("trusted key does not match keyid");
    if (!verify(null, pae(p.envelope.payloadType, p.payload), k, b64(sig.sig, "signature")))
        fail("signature verification failed");
}
catch (e) {
    return { ok: false, state: "invalid", trust: "none", errors: [e.message] };
} const errors = pred.result.status === "pass" && pred.invocation.exit_code === 0 ? [] : ["evidence did not pass with exit code 0"]; return { ok: !errors.length, state: "ci-attested", trust: "trusted", errors, issuer: pred.issuer.id, keyid: sig.keyid }; }
export function writeEvidenceAttestation(spec, out, key) { const e = createEvidenceAttestation(JSON.parse(readFileSync(spec, "utf8")), dirname(realpathSync(spec)), { privateKeyPem: key ? readFileSync(key, "utf8") : undefined }); writeFileSync(out, JSON.stringify(e, null, 2) + "\n", { flag: "wx", mode: 0o600 }); return e; }
