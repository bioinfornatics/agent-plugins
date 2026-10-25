import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sourceHash } from "./package_manifest.js";
const HEX = /^[a-f0-9]{64}$/;
export const APPROVAL_BINDINGS = ["artifact_sha256", "archive_sha256", "manifest_sha256", "benchmark_sha256", "test_sha256", "review_sha256"];
const hash = (x) => createHash("sha256").update(x).digest("hex");
const canonical = (x) => x === null ? "null" : typeof x === "string" ? JSON.stringify(x) : typeof x === "number" || typeof x === "boolean" ? String(x) : Array.isArray(x) ? "[" + x.map(canonical).join(",") + "]" : "{" + Object.keys(x).sort().map(k => JSON.stringify(k) + ":" + canonical(x[k])).join(",") + "}";
function fail(s) { throw Error(s); }
function object(x, n) { if (!x || typeof x !== "object" || Array.isArray(x))
    fail(n + " must be object"); return x; }
function text(x, n) { if (typeof x !== "string" || !x.trim())
    fail(n + " must be non-empty"); return x; }
function identity(x, n) { x = object(x, n); const id = text(x.id, n + ".id").trim(), role = text(x.role, n + ".role").trim(); if (id.toLowerCase() === "anonymous" || role.toLowerCase() === "anonymous")
    fail("anonymous identity cannot satisfy production approval"); }
function digest(x, n) { if (typeof x !== "string" || !HEX.test(x))
    fail(n + " must be SHA-256"); return x; }
function instant(x, n) { text(x, n); const time = Date.parse(x); if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(x) || Number.isNaN(time))
    fail(n + " must be UTC timestamp"); return time; }
function approvalCore(a) { const c = { ...a }; delete c.events; return c; }
function eventCore(e) { const c = { ...e }; delete c.signature; return c; }
function body(a, e) { return canonical({ approval: approvalCore(a), event: eventCore(e) }); }
function eventHash(a, e) { return hash(body(a, e) + "\n" + e.signature.value); }
export function productionBindings(rootArg, archive, integration, testEvidence) { const root = resolve(rootArg); return { artifact_sha256: sourceHash(root, [resolve(archive)]), archive_sha256: hash(readFileSync(resolve(archive))), manifest_sha256: hash(readFileSync(join(root, "plugin.json"))), benchmark_sha256: hash(readFileSync(join(resolve(integration), "benchmark.json"))), test_sha256: hash(readFileSync(resolve(testEvidence))), review_sha256: hash(readFileSync(join(resolve(integration), "review.html"))) }; }
export function verifyProductionApproval(approvalPath, trustPath, expected, now = new Date()) { const a = object(JSON.parse(readFileSync(resolve(approvalPath), "utf8")), "approval"), p = object(JSON.parse(readFileSync(resolve(trustPath), "utf8")), "trust policy"); if (a.version !== "hook-production-approval/v1" || p.version !== "hook-approval-trust-policy/v1" || !Array.isArray(p.reviewers) || !Array.isArray(a.events))
    fail("unsupported production approval or trust policy"); identity(a.requester, "requester"); const requested = instant(a.requested_at, "requested_at"), expires = instant(a.expires_at, "expires_at"), clock = now.getTime(); if (!(requested <= clock && clock < expires))
    fail("approval is outside requested_at <= now < expires_at"); if (a.automated_evidence?.status !== "pass")
    fail("automated evidence did not pass"); for (const k of APPROVAL_BINDINGS)
    if (digest(a.bindings?.[k], "bindings." + k) !== digest(expected[k], "expected." + k))
        fail("approval binding mismatch: " + k); let prior = "0".repeat(64), priorTime = requested, state = "pending"; for (let i = 0; i < a.events.length; i++) {
    const e = object(a.events[i], "event"), time = instant(e.timestamp, "event.timestamp");
    if (e.revision !== i + 1 || e.previous_event_sha256 !== prior)
        fail("approval event chain mismatch");
    if (time < priorTime || time > clock || time >= expires)
        fail("approval event chronology invalid");
    identity(e.reviewer, "reviewer");
    const trusted = p.reviewers.find((r) => r.id === e.reviewer.id && r.role === e.reviewer.role && r.keyid === e.signature?.keyid && Array.isArray(r.actions) && r.actions.includes(e.action));
    if (!trusted)
        fail("approval event reviewer is not trusted");
    identity(trusted, "trusted reviewer");
    const key = createPublicKey(text(trusted.public_key_pem, "trusted public key")), keyid = hash(key.export({ type: "spki", format: "der" }));
    if (key.asymmetricKeyType !== "ed25519" || keyid !== e.signature.keyid || !verify(null, Buffer.from(body(a, e)), key, Buffer.from(text(e.signature.value, "signature.value"), "base64")))
        fail("approval signature verification failed");
    if (e.action === "review" && state === "pending")
        state = "reviewed";
    else if (e.action === "approve" && (state === "pending" || state === "reviewed"))
        state = "approved";
    else if (e.action === "reject")
        state = "rejected";
    else if (e.action === "expire")
        state = "expired";
    else if (e.action === "supersede")
        state = "superseded";
    else
        fail("invalid approval state transition");
    priorTime = time;
    prior = eventHash(a, e);
} if (state !== "approved")
    fail("production approval is " + state); return { ok: true, request_id: text(a.request_id, "request_id"), approval_sha256: hash(canonical(a)), bindings: expected }; }
