#!/usr/bin/env node
/** Strict privacy validation and deterministic analysis for manual screen-reader acceptance records. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { EMBEDDED_SCREEN_READER_PROTOCOL } from "./embedded_screen_reader_resources.js";
import { canonicalTrustPolicySha256, createPolicySigningRequest, createUnsignedRequest, verifyAttestation, verifyAttestationWithTestTrustPolicy } from "./screen_reader_attestation.js";
const taskIds = ["headings-landmarks", "filters-announcements", "deep-link-focus", "pagination", "disclosure", "feedback", "status-noncolor"];
const modes = ["static", "live"];
const protocolBytes = Buffer.from(EMBEDDED_SCREEN_READER_PROTOCOL);
const canonicalProtocol = JSON.parse(protocolBytes.toString("utf8"));
if (canonicalProtocol.governance.trust_policy_sha256 !== canonicalTrustPolicySha256)
    throw new Error("shipped reviewer trust policy does not match the SHA-256 pinned by protocol.json");
export const protocolIdentity = { version: canonicalProtocol.version, sha256: createHash("sha256").update(protocolBytes).digest("hex") };
const expected = new Map(canonicalProtocol.tasks.flatMap(t => modes.map(mode => [`${mode}:${t.id}`, t.expected_by_mode[mode]])));
const rootKeys = ["schema_version", "protocol", "record_id", "synthetic", "availability", "unavailable_reason", "reviewed_at", "reviewer_code", "privacy_reviewed", "retention", "environment", "tasks", "findings"];
const prohibitedKey = /(^|_)(name|email|phone|address|handle|username|employer|company|organization|organisation|ip|url|uri|recording|transcript|audio|video|contact)(_|$)/i;
const pii = [["email", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i], ["URL", /(?:https?|git|ssh):\/\//i], ["home path", /(?:\/home\/[^\s/]+|\/Users\/[^\s/]+|[A-Z]:\\Users\\[^\s\\]+)/i], ["IP address", /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/], ["possible full name", /\b(?:Mr|Mrs|Ms|Mx|Dr|Prof)\.?\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/]];
function object(v) { return Boolean(v) && typeof v === "object" && !Array.isArray(v); }
function strict(v, keys, p, e) { for (const k of keys)
    if (!(k in v))
        e.push(`${p}.${k}: required`); for (const k of Object.keys(v))
    if (!keys.includes(k))
        e.push(`${p}.${k}: ${prohibitedKey.test(k) ? "identifier or recording field is prohibited" : "additional property is not allowed"}`); }
function text(v, p, e, min = 1, max = 500) { if (typeof v !== "string" || v.trim().length < min || v.length > max)
    e.push(`${p}: must contain ${min}-${max} characters`); }
function scan(v, p, e) { if (typeof v === "string") {
    for (const [label, re] of pii)
        if (re.test(v)) {
            e.push(`${p}: ${label} is prohibited`);
            break;
        }
}
else if (Array.isArray(v))
    v.forEach((x, i) => scan(x, `${p}[${i}]`, e));
else if (object(v))
    Object.entries(v).forEach(([k, x]) => scan(x, `${p}.${k}`, e)); }
function date(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v; }
function version(v, p, e) { if (typeof v !== "string" || !/^\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(v))
    e.push(`${p}: must be a concrete semver-like version with at least major.minor`); }
function evidence(v, p, e) { if (!object(v)) {
    e.push(`${p}: must be structured locator/observation evidence`);
    return;
} strict(v, ["locator", "observation"], p, e); text(v.locator, `${p}.locator`, e, 5, 160); if (typeof v.locator === "string" && !/^(heading|landmark|control|status|dialog|table|row|cell|disclosure|evidence|scenario|page|focus|announcement):[A-Za-z0-9][A-Za-z0-9 ._#:[\]()>+~=-]*$/.test(v.locator))
    e.push(`${p}.locator: must be a bounded semantic or DOM locator`); text(v.observation, `${p}.observation`, e, 12, 500); if (typeof v.observation === "string" && (!/(?:focus|announc|heard|read|moved|expanded|collapsed|count|name|state|color|relationship|rendered|saving|saved|download|literal|heading|landmark|search|filter|control|evidence|scenario|disclosure|table|verdict|flag)/i.test(v.observation) || /^(?:pass(?:ed)?|works?|matched|as expected|no issues?)(?:\s+(?:successfully|correctly|fine))?[.!]?$/i.test(v.observation.trim())))
    e.push(`${p}.observation: claim-only evidence is not sufficient`); }
export function validateRecord(value) {
    const e = [];
    if (!object(value))
        return { valid: false, errors: ["$: must be an object"] };
    strict(value, rootKeys, "$", e);
    scan(value, "$", e);
    if (value.schema_version !== 1)
        e.push("$.schema_version: must equal 1");
    if (!object(value.protocol))
        e.push("$.protocol: must be an object");
    else {
        strict(value.protocol, ["version", "sha256"], "$.protocol", e);
        if (value.protocol.version !== protocolIdentity.version)
            e.push(`$.protocol.version: must equal canonical ${protocolIdentity.version}`);
        if (value.protocol.sha256 !== protocolIdentity.sha256)
            e.push("$.protocol.sha256: must equal the canonical protocol SHA-256");
    }
    ;
    if (typeof value.record_id !== "string" || !/^SR-[A-Z0-9]{8}$/.test(value.record_id))
        e.push("$.record_id: must match SR-[A-Z0-9]{8}");
    if (typeof value.synthetic !== "boolean")
        e.push("$.synthetic: must be boolean");
    if (!["performed", "unavailable"].includes(String(value.availability)))
        e.push("$.availability: must be performed or unavailable");
    if (typeof value.reviewer_code !== "string" || !/^REV-[A-Z0-9]{4,12}$/.test(value.reviewer_code))
        e.push("$.reviewer_code: must be an anonymous REV- pseudocode");
    if (value.privacy_reviewed !== true)
        e.push("$.privacy_reviewed: must be true");
    if (!object(value.retention))
        e.push("$.retention: must be an object");
    else {
        strict(value.retention, ["policy_version", "delete_after"], "$.retention", e);
        text(value.retention.policy_version, "$.retention.policy_version", e, 1, 40);
        if (typeof value.retention.delete_after !== "string" || !date(value.retention.delete_after))
            e.push("$.retention.delete_after: must be a valid YYYY-MM-DD date");
    }
    if (!object(value.environment))
        e.push("$.environment: must be an object");
    else {
        strict(value.environment, ["os", "assistive_technology", "browser", "report_build"], "$.environment", e);
        if (typeof value.environment.report_build !== "string" || !/^[a-f0-9]{64}$/.test(value.environment.report_build))
            e.push("$.environment.report_build: must be a lowercase SHA-256");
        for (const [key, names] of [["os", ["Windows", "macOS"]], ["assistive_technology", ["NVDA", "VoiceOver"]], ["browser", ["Firefox", "Chrome", "Safari"]]]) {
            const x = value.environment[key];
            if (!object(x))
                e.push(`$.environment.${key}: must be an object`);
            else {
                strict(x, ["name", "version"], `$.environment.${key}`, e);
                if (!names.includes(x.name))
                    e.push(`$.environment.${key}.name: unsupported value`);
                version(x.version, `$.environment.${key}.version`, e);
            }
        }
    }
    const performed = value.availability === "performed";
    let reviewed = null;
    if (performed) {
        if (value.unavailable_reason !== null)
            e.push("$.unavailable_reason: must be null for performed review");
        if (typeof value.reviewed_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value.reviewed_at) || Number.isNaN(Date.parse(value.reviewed_at)))
            e.push("$.reviewed_at: must be an RFC 3339 UTC timestamp");
        else {
            reviewed = new Date(value.reviewed_at);
            if (reviewed.getTime() > Date.now())
                e.push("$.reviewed_at: must not be in the future");
        }
    }
    else {
        text(value.unavailable_reason, "$.unavailable_reason", e, 1, 300);
        if (value.reviewed_at !== null)
            e.push("$.reviewed_at: must be null when unavailable");
    }
    if (reviewed && object(value.retention) && typeof value.retention.delete_after === "string" && date(value.retention.delete_after)) {
        const reviewDay = Date.UTC(reviewed.getUTCFullYear(), reviewed.getUTCMonth(), reviewed.getUTCDate()), deletion = Date.parse(`${value.retention.delete_after}T00:00:00Z`), days = (deletion - reviewDay) / 86400000;
        if (days < 0)
            e.push("$.retention.delete_after: must be on or after the review date");
        if (days > 90)
            e.push("$.retention.delete_after: must be no more than 90 days after the review date");
    }
    const seen = new Set();
    if (!Array.isArray(value.tasks))
        e.push("$.tasks: must be an array");
    else
        value.tasks.forEach((t, i) => { const p = `$.tasks[${i}]`; if (!object(t)) {
            e.push(`${p}: must be an object`);
            return;
        } strict(t, ["mode", "task_id", "expected", "observed", "pass", "evidence"], p, e); if (!modes.includes(t.mode))
            e.push(`${p}.mode: invalid`); if (!taskIds.includes(t.task_id))
            e.push(`${p}.task_id: invalid`); const key = `${t.mode}:${t.task_id}`; if (seen.has(key))
            e.push(`${p}: duplicate task`); seen.add(key); const exact = expected.get(key); if (typeof exact !== "string" || t.expected !== exact)
            e.push(`${p}.expected: must exactly match canonical protocol expectation for ${key}`); text(t.observed, `${p}.observed`, e, 12); evidence(t.evidence, `${p}.evidence`, e); if (typeof t.pass !== "boolean")
            e.push(`${p}.pass: must be boolean`); if (!performed && t.pass === true)
            e.push(`${p}.pass: unavailable review cannot pass`); if (value.synthetic === true && t.pass === true)
            e.push(`${p}.pass: synthetic records cannot pass or constitute evidence`); });
    if (performed)
        for (const mode of modes)
            for (const id of taskIds)
                if (!seen.has(`${mode}:${id}`))
                    e.push(`$.tasks: missing ${mode}:${id}`);
    if (!performed && Array.isArray(value.tasks) && value.tasks.length)
        e.push("$.tasks: must be empty when unavailable");
    if (!Array.isArray(value.findings))
        e.push("$.findings: must be an array");
    else
        value.findings.forEach((f, i) => { const p = `$.findings[${i}]`; if (!object(f)) {
            e.push(`${p}: must be an object`);
            return;
        } strict(f, ["code", "severity", "task_id", "mode", "summary", "evidence", "privacy_reviewed"], p, e); if (typeof f.code !== "string" || !/^SR-[A-Z0-9-]{2,30}$/.test(f.code))
            e.push(`${p}.code: invalid`); if (!["P0", "P1", "P2", "P3"].includes(String(f.severity)))
            e.push(`${p}.severity: invalid`); if (!taskIds.includes(f.task_id))
            e.push(`${p}.task_id: invalid`); if (!modes.includes(f.mode))
            e.push(`${p}.mode: invalid`); text(f.summary, `${p}.summary`, e, 1); evidence(f.evidence, `${p}.evidence`, e); if (f.privacy_reviewed !== true)
            e.push(`${p}.privacy_reviewed: must be true`); });
    return e.length ? { valid: false, errors: e } : { valid: true, errors: [], record: value };
}
function combo(r) { const x = r.environment; return x.os.name === "Windows" && x.assistive_technology.name === "NVDA" && ["Firefox", "Chrome"].includes(x.browser.name) ? "nvda-windows" : x.os.name === "macOS" && x.assistive_technology.name === "VoiceOver" && x.browser.name === "Safari" ? "voiceover-safari" : null; }
function analyze(records, receipts, now, verify) { for (const [i, r] of records.entries()) {
    const checked = validateRecord(r);
    if (!checked.valid)
        throw new Error(`record[${i}] invalid: ${checked.errors.join("; ")}`);
} const ids = new Set(); for (const r of records) {
    if (ids.has(r.record_id))
        throw new Error(`duplicate record_id: ${r.record_id}`);
    ids.add(r.record_id);
} const requirements = ["nvda-windows", "voiceover-safari"]; const coverage = Object.fromEntries(requirements.map(c => [c, records.filter(r => combo(r) === c).map(r => ({ record_id: r.record_id, availability: r.availability, browser: r.environment.browser.name, synthetic: r.synthetic }))])); const attestation_results = records.map(r => { const matches = receipts.map(receipt => verify(r, receipt, now)).filter(x => x.valid); return { record_id: r.record_id, valid: matches.length === 1, keyid: matches.length === 1 ? matches[0].keyid : null, reason: matches.length === 1 ? null : matches.length === 0 ? "no signature-valid trusted attestation for exact record digest" : "multiple valid attestations" }; }); const qualifying = records.filter(r => !r.synthetic && r.availability === "performed" && combo(r) && attestation_results.some(a => a.record_id === r.record_id && a.valid)); const builds = [...new Set(qualifying.map(r => r.environment.report_build))]; const covered = requirements.filter(c => qualifying.some(r => combo(r) === c)); const failed = qualifying.flatMap(r => r.tasks.filter(t => !t.pass).map(t => `${r.record_id}:${t.mode}:${t.task_id}`)); const blockers = qualifying.flatMap(r => r.findings.filter(f => f.severity === "P0" || f.severity === "P1").map(f => `${r.record_id}:${f.code}:${f.severity}`)); const missingTasks = qualifying.flatMap(r => modes.flatMap(mode => taskIds.filter(id => !r.tasks.some(t => t.mode === mode && t.task_id === id)).map(id => `${r.record_id}:${mode}:${id}`))); const pass = covered.length === requirements.length && builds.length === 1 && missingTasks.length === 0 && failed.length === 0 && blockers.length === 0; return { artifact: "manual-screen-reader-acceptance-analysis", status: pass ? "PASS" : "FAIL", protocol: protocolIdentity, evidence_notice: "Only actual, privacy-reviewed performed records with a current, exact-record-bound Ed25519 attestation from a reviewer qualified by the separate trust policy count. A signature proves the accountable attestor, not participant identity; a real session remains mandatory.", attestation_results, report_build: { sha256: builds.length === 1 ? builds[0] : null, consistent: builds.length === 1 }, requirements: { combinations: requirements, tasks: taskIds, modes, covered, missing: requirements.filter(x => !covered.includes(x)) }, coverage, qualifying_records: qualifying.map(r => r.record_id).sort(), missing_tasks: missingTasks.sort(), failed_tasks: failed.sort(), blocking_findings: blockers.sort() }; }
export function analyzeRecords(records, receipts = [], now = new Date()) { return analyze(records, receipts, now, verifyAttestation); }
/** Explicit test-only analyzer seam. Arbitrary policy is never accepted by the production analyzer or CLI. */
export function analyzeRecordsWithTestTrustPolicy(records, receipts, policy, now = new Date()) { return analyze(records, receipts, now, (record, receipt, clock) => verifyAttestationWithTestTrustPolicy(record, receipt, policy, clock)); }
function load(path) { const p = resolve(path); if (!existsSync(p))
    throw new Error(`input does not exist: ${path}`); if (statSync(p).isDirectory())
    return readdirSync(p).filter(n => n.endsWith(".json")).sort().map(n => JSON.parse(readFileSync(join(p, n), "utf8"))); const v = JSON.parse(readFileSync(p, "utf8")); return Array.isArray(v) ? v : [v]; }
export function main(argv = process.argv.slice(2)) { let input, out, attestationsPath, recordPath, issuedAt, expiresAt, validateOnly = false, createRequest = false, createPolicyRequest = false, verifyOnly = false; for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--trust-policy" || a.startsWith("--trust-policy="))
        throw new Error("--trust-policy is forbidden; production uses the policy pinned in protocol.json");
    else if (a === "--validate")
        validateOnly = true;
    else if (a === "--create-attestation-request")
        createRequest = true;
    else if (a === "--create-policy-signing-request")
        createPolicyRequest = true;
    else if (a === "--verify-attestation")
        verifyOnly = true;
    else if (a === "-o" || a === "--output" || a === "--attestations" || a === "--record" || a === "--issued-at" || a === "--expires-at") {
        const value = argv[++i];
        if (!value || value.startsWith("-"))
            throw new Error(`${a} requires a value`);
        if (a === "-o" || a === "--output")
            out = value;
        else if (a === "--attestations")
            attestationsPath = value;
        else if (a === "--record")
            recordPath = value;
        else if (a === "--issued-at")
            issuedAt = value;
        else
            expiresAt = value;
    }
    else if (a.startsWith("-"))
        throw new Error(`unknown option: ${a}`);
    else if (!input)
        input = a;
    else
        throw new Error(`unexpected argument: ${a}`);
} try {
    let result, code = 0;
    if (createPolicyRequest) {
        if (!input)
            throw new Error("policy signing request requires a proposed policy");
        const values = load(input);
        if (values.length !== 1)
            throw new Error("policy signing request requires exactly one policy");
        result = createPolicySigningRequest(values[0]);
    }
    else if (createRequest) {
        const path = recordPath ?? input;
        if (!path || !issuedAt || !expiresAt)
            throw new Error("request requires a record, --issued-at, and --expires-at");
        const values = load(path);
        if (values.length !== 1)
            throw new Error("request requires exactly one record");
        const checked = validateRecord(values[0]);
        if (!checked.valid)
            throw new Error(checked.errors.join("; "));
        result = createUnsignedRequest(checked.record, issuedAt, expiresAt);
    }
    else if (verifyOnly) {
        if (!input || !recordPath)
            throw new Error("verification requires receipt and --record");
        const records = load(recordPath), receipts = load(input);
        if (records.length !== 1 || receipts.length !== 1)
            throw new Error("verification requires exactly one record and receipt");
        result = { artifact: "manual-screen-reader-attestation-verification", ...verifyAttestation(records[0], receipts[0]) };
        code = result.valid ? 0 : 1;
    }
    else {
        if (!input)
            throw new Error("analysis requires a record input");
        const values = load(input), checked = values.map(validateRecord), errors = checked.flatMap((r, i) => r.errors.map(x => "record[" + i + "] " + x));
        if (errors.length) {
            result = { artifact: "manual-screen-reader-acceptance-validation", status: "INVALID", errors };
            code = 1;
        }
        else if (validateOnly)
            result = { artifact: "manual-screen-reader-acceptance-validation", status: "VALID", records: checked.length, protocol: protocolIdentity };
        else {
            const receipts = attestationsPath ? load(attestationsPath) : [];
            result = analyzeRecords(checked.map(x => x.record), receipts);
            code = result.status === "PASS" ? 0 : 1;
        }
    }
    const output = JSON.stringify(result, null, 2) + "\n";
    if (out)
        writeFileSync(resolve(out), output);
    else
        process.stdout.write(output);
    return code;
}
catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
} }
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname))
    process.exitCode = main();
