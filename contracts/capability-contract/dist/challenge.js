import { createHash } from "node:crypto";
import { normalizeCapabilityContract } from "./validation.js";
import { CHALLENGE_RISKS, CHALLENGE_ROLES, CONTRACT_SCENARIO_CHALLENGE_VERSION, } from "./challenge-types.js";
const OWN = Object.prototype.hasOwnProperty;
const ID = /^[a-z0-9](?:[a-z0-9._:-]{0,127})$/;
const HASH = /^[a-f0-9]{64}$/;
const POINTER = /^(?:\/(?:[^~/]|~0|~1)*)+$/;
const INVALID = "challenge request contains an inaccessible, accessor-backed, cyclic, or excessively nested value";
const MAX_DEPTH = 32, MAX_NODES = 10_000, MAX_SCENARIOS = 100, MAX_FINDINGS = 100, MAX_PER_ROLE = 25;
function snapshot(value) {
    const ancestors = new Set();
    let nodes = 0;
    const visit = (current, depth) => {
        if (current === null || typeof current === "string" || typeof current === "boolean")
            return current;
        if (typeof current === "number") {
            if (!Number.isFinite(current))
                throw new TypeError(INVALID);
            return current;
        }
        if (typeof current !== "object")
            throw new TypeError(INVALID);
        if (depth > MAX_DEPTH || ++nodes > MAX_NODES || ancestors.has(current))
            throw new TypeError(INVALID);
        if (!Array.isArray(current) && Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null)
            throw new TypeError(INVALID);
        ancestors.add(current);
        try {
            const descriptors = Object.getOwnPropertyDescriptors(current);
            const keys = Reflect.ownKeys(descriptors);
            if (Array.isArray(current)) {
                const length = descriptors.length;
                if (!length || !("value" in length) || !Number.isSafeInteger(length.value) || length.value < 0 || length.value > MAX_NODES)
                    throw new TypeError(INVALID);
                const out = new Array(length.value);
                for (const key of keys) {
                    if (key === "length")
                        continue;
                    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= length.value)
                        throw new TypeError(INVALID);
                    const d = descriptors[key];
                    if (!("value" in d))
                        throw new TypeError(INVALID);
                    Object.defineProperty(out, key, { value: visit(d.value, depth + 1), enumerable: true, writable: true, configurable: true });
                }
                return out;
            }
            const out = {};
            for (const key of keys) {
                if (typeof key !== "string" || key === "__proto__" || key === "prototype" || key === "constructor")
                    throw new TypeError(INVALID);
                const d = descriptors[key];
                if (!("value" in d))
                    throw new TypeError(INVALID);
                Object.defineProperty(out, key, { value: visit(d.value, depth + 1), enumerable: true, writable: true, configurable: true });
            }
            return out;
        }
        finally {
            ancestors.delete(current);
        }
    };
    try {
        return visit(value, 0);
    }
    catch {
        throw new TypeError(INVALID);
    }
}
const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function object(v, name, keys) { if (!record(v))
    throw new TypeError(`${name} must be an object`); for (const key of Object.keys(v))
    if (!keys.includes(key))
        throw new TypeError(`${name} has an unknown property: ${key}`); }
function text(v, name, max = 4000) { if (typeof v !== "string" || !v.trim() || v.length > max)
    throw new TypeError(`${name} must be a non-empty string of at most ${max} characters`); }
function id(v, name) { if (typeof v !== "string" || !ID.test(v))
    throw new TypeError(`${name} must be a lowercase portable identifier`); }
function dense(v, name) { for (let i = 0; i < v.length; i++)
    if (!OWN.call(v, i))
        throw new TypeError(`${name} must be dense`); }
function pointer(v, name) { if (typeof v !== "string" || v.length > 500 || !POINTER.test(v))
    throw new TypeError(`${name} must be a bounded JSON Pointer`); const parts = v.slice(1).split("/").map(unescapePointer); if (parts.some((p) => p === "__proto__" || p === "prototype" || p === "constructor"))
    throw new TypeError(`${name} contains a forbidden segment`); }
function unescapePointer(v) { return v.replace(/~1/g, "/").replace(/~0/g, "~"); }
function canonical(v) { if (Array.isArray(v))
    return v.map(canonical); if (!record(v))
    return v; return Object.fromEntries(Object.keys(v).sort().map((key) => [key, canonical(v[key])])); }
function assertJsonValue(value, name) {
    let nodes = 0;
    const visit = (v, depth, path) => {
        if (depth > MAX_DEPTH || ++nodes > MAX_NODES)
            throw new TypeError(name + " must be bounded JSON");
        if (v === null || typeof v === "string" || typeof v === "boolean")
            return;
        if (typeof v === "number" && Number.isFinite(v))
            return;
        if (Array.isArray(v)) {
            dense(v, path);
            for (let i = 0; i < v.length; i++)
                visit(v[i], depth + 1, path + "[" + i + "]");
            return;
        }
        if (record(v)) {
            for (const key of Object.keys(v))
                visit(v[key], depth + 1, path + "." + key);
            return;
        }
        throw new TypeError(name + " must contain only JSON values");
    };
    visit(value, 0, name);
}
function serialize(v) { return JSON.stringify(canonical(v)); }
function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function pointerExists(root, path) { let value = root; for (const part of path.slice(1).split("/").map(unescapePointer)) {
    if ((!record(value) && !Array.isArray(value)) || !OWN.call(value, part))
        return false;
    value = value[part];
} return true; }
function assertCitation(value, name, scenarioIds, contract) {
    if (!record(value) || (value.kind !== "contract-field" && value.kind !== "scenario"))
        throw new TypeError(`${name} is invalid`);
    if (value.kind === "contract-field") {
        object(value, name, ["kind", "path"]);
        pointer(value.path, `${name}.path`);
        if (!pointerExists(contract, value.path))
            throw new TypeError(`${name}.path must cite an existing contract field`);
    }
    else {
        object(value, name, ["kind", "scenarioId"]);
        id(value.scenarioId, `${name}.scenarioId`);
        if (!scenarioIds.has(value.scenarioId))
            throw new TypeError(`${name}.scenarioId must reference a declared scenario`);
    }
}
function assertRequest(value) {
    object(value, "request", ["version", "base", "scenarios", "scenarioHash", "reviews", "decisions"]);
    if (value.version !== CONTRACT_SCENARIO_CHALLENGE_VERSION)
        throw new TypeError("version must be 1.0.0");
    object(value.base, "base", ["revision", "contract"]);
    if (!Number.isSafeInteger(value.base.revision) || value.base.revision < 1)
        throw new TypeError("base.revision must be a positive safe integer");
    normalizeCapabilityContract(value.base.contract);
    const citedContract = value.base.contract;
    if (!Array.isArray(value.scenarios) || value.scenarios.length > MAX_SCENARIOS)
        throw new TypeError(`scenarios must contain at most ${MAX_SCENARIOS} items`);
    dense(value.scenarios, "scenarios");
    const scenarioIds = new Set();
    value.scenarios.forEach((s, i) => { object(s, `scenarios[${i}]`, ["id", "description"]); id(s.id, `scenarios[${i}].id`); text(s.description, `scenarios[${i}].description`); if (scenarioIds.has(s.id))
        throw new TypeError("scenarios contains a duplicate id"); scenarioIds.add(s.id); });
    if (typeof value.scenarioHash !== "string" || !HASH.test(value.scenarioHash))
        throw new TypeError("scenarioHash must be a lowercase SHA-256");
    if (value.scenarioHash !== hashChallengeScenarios(value.scenarios))
        throw new TypeError("scenarioHash does not match scenarios");
    if (!Array.isArray(value.reviews) || value.reviews.length > CHALLENGE_ROLES.length)
        throw new TypeError("reviews must contain at most four roles");
    dense(value.reviews, "reviews");
    const roles = new Set(), findingIds = new Set();
    let count = 0;
    value.reviews.forEach((r, ri) => {
        object(r, `reviews[${ri}]`, ["role", "findings"]);
        if (!CHALLENGE_ROLES.includes(r.role))
            throw new TypeError(`reviews[${ri}].role is invalid`);
        if (roles.has(r.role))
            throw new TypeError("reviews contains a duplicate role");
        roles.add(r.role);
        if (!Array.isArray(r.findings) || r.findings.length > MAX_PER_ROLE)
            throw new TypeError(`each role may submit at most ${MAX_PER_ROLE} findings`);
        dense(r.findings, `reviews[${ri}].findings`);
        count += r.findings.length;
        r.findings.forEach((f, fi) => { const n = `reviews[${ri}].findings[${fi}]`; object(f, n, ["id", "summary", "risk", "citation", "proposedChange"]); id(f.id, `${n}.id`); if (findingIds.has(f.id))
            throw new TypeError("finding ids must be globally unique"); findingIds.add(f.id); text(f.summary, `${n}.summary`); if (!CHALLENGE_RISKS.includes(f.risk))
            throw new TypeError(`${n}.risk is invalid`); assertCitation(f.citation, `${n}.citation`, scenarioIds, citedContract); if (OWN.call(f, "proposedChange")) {
            object(f.proposedChange, `${n}.proposedChange`, ["path", "value"]);
            pointer(f.proposedChange.path, `${n}.proposedChange.path`);
            if (!pointerExists(citedContract, f.proposedChange.path))
                throw new TypeError(`${n}.proposedChange.path must target an existing contract field`);
            if (!OWN.call(f.proposedChange, "value"))
                throw new TypeError(`${n}.proposedChange.value is required`);
            assertJsonValue(f.proposedChange.value, `${n}.proposedChange.value`);
        } });
    });
    if (count > MAX_FINDINGS)
        throw new TypeError(`reviews may contain at most ${MAX_FINDINGS} findings`);
    if (OWN.call(value, "decisions")) {
        if (!Array.isArray(value.decisions) || value.decisions.length > MAX_FINDINGS)
            throw new TypeError(`decisions must contain at most ${MAX_FINDINGS} items`);
        dense(value.decisions, "decisions");
        const decided = new Set();
        value.decisions.forEach((d, i) => { object(d, `decisions[${i}]`, ["findingId", "decision"]); id(d.findingId, `decisions[${i}].findingId`); if (!findingIds.has(d.findingId))
            throw new TypeError(`decisions[${i}] references an unknown finding`); if (decided.has(d.findingId))
            throw new TypeError("decisions contains a duplicate findingId"); decided.add(d.findingId); if (d.decision !== "accepted" && d.decision !== "rejected")
            throw new TypeError(`decisions[${i}].decision is invalid`); });
    }
}
export function hashChallengeScenarios(value) {
    const copy = snapshot(value);
    if (!Array.isArray(copy) || copy.length > MAX_SCENARIOS)
        throw new TypeError(`scenarios must contain at most ${MAX_SCENARIOS} items`);
    dense(copy, "scenarios");
    const ids = new Set();
    copy.forEach((s, i) => { object(s, `scenarios[${i}]`, ["id", "description"]); id(s.id, `scenarios[${i}].id`); text(s.description, `scenarios[${i}].description`); if (ids.has(s.id))
        throw new TypeError("scenarios contains a duplicate id"); ids.add(s.id); });
    return createHash("sha256").update(serialize([...copy].sort((a, b) => a.id < b.id ? -1 : 1))).digest("hex");
}
function setPointer(root, path, value) { const parts = path.slice(1).split("/").map(unescapePointer); let target = root; for (let i = 0; i < parts.length - 1; i++) {
    if (!record(target) && !Array.isArray(target))
        throw new TypeError(`accepted change path does not exist: ${path}`);
    const key = parts[i];
    if (!OWN.call(target, key))
        throw new TypeError(`accepted change path does not exist: ${path}`);
    target = target[key];
} const key = parts.at(-1); if ((!record(target) && !Array.isArray(target)) || !OWN.call(target, key))
    throw new TypeError(`accepted change path does not exist: ${path}`); target[key] = value; }
function citationKey(c) { return c.kind === "contract-field" ? `field:${c.path}` : `scenario:${c.scenarioId}`; }
/** Pure deterministic challenge consolidation and optional revision acceptance. */
export function challengeContractScenarios(input) {
    input = snapshot(input);
    assertRequest(input);
    const decisions = new Map(input.decisions?.map((d) => [d.findingId, d.decision]) ?? []);
    const groups = new Map();
    for (const review of input.reviews)
        for (const finding of review.findings) {
            const key = serialize({ summary: finding.summary.trim(), risk: finding.risk, citation: finding.citation, change: finding.proposedChange });
            const group = groups.get(key) ?? [];
            group.push({ finding, role: review.role });
            groups.set(key, group);
        }
    const preliminary = [...groups.values()].map((group) => {
        group.sort((a, b) => compare(a.finding.id, b.finding.id));
        const representative = group[0].finding;
        const ids = group.map(({ finding }) => finding.id);
        const states = ids.map((id) => decisions.get(id)).filter((state) => state !== undefined);
        const status = states.includes("accepted") && states.includes("rejected") ? "unresolved" : states.includes("accepted") ? "accepted" : states.length === ids.length && states.every((state) => state === "rejected") ? "rejected" : "unresolved";
        return { ...representative, summary: representative.summary.trim(), citation: { ...representative.citation }, ...(representative.proposedChange ? { proposedChange: { path: representative.proposedChange.path, value: representative.proposedChange.value } } : {}), roles: [...new Set(group.map(({ role }) => role))].sort(), sourceFindingIds: ids, status };
    });
    preliminary.sort((a, b) => compare(citationKey(a.citation), citationKey(b.citation)) || compare(a.summary, b.summary) || compare(a.id, b.id));
    const overlaps = (a, b) => a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
    const conflicts = new Map();
    const accepted = preliminary.filter((f) => f.status === "accepted" && f.proposedChange);
    for (let i = 0; i < accepted.length; i++)
        for (let j = i + 1; j < accepted.length; j++) {
            const a = accepted[i], b = accepted[j];
            if (overlaps(a.proposedChange.path, b.proposedChange.path) && serialize(a.proposedChange) !== serialize(b.proposedChange)) {
                conflicts.set(a.id, [...(conflicts.get(a.id) ?? []), b.id]);
                conflicts.set(b.id, [...(conflicts.get(b.id) ?? []), a.id]);
            }
        }
    const findings = preliminary.map((f) => {
        const ordinary = preliminary.filter((o) => o !== f && citationKey(o.citation) === citationKey(f.citation) && serialize({ summary: o.summary, change: o.proposedChange }) !== serialize({ summary: f.summary, change: f.proposedChange })).map((o) => o.id);
        const conflict = conflicts.has(f.id), status = conflict ? "unresolved" : f.status;
        return { ...f, status, blocking: conflict || (f.risk === "high" && status === "unresolved"), advisory: f.risk === "low" && !conflict, disagreementWith: [...new Set([...ordinary, ...(conflicts.get(f.id) ?? [])])].sort() };
    });
    const changed = findings.filter((f) => f.status === "accepted" && f.proposedChange);
    const contract = snapshot(input.base.contract);
    for (const f of changed.sort((a, b) => compare(a.proposedChange.path, b.proposedChange.path) || compare(a.id, b.id)))
        setPointer(contract, f.proposedChange.path, f.proposedChange.value);
    const normalized = normalizeCapabilityContract(contract), invalidated = changed.length > 0;
    const blockers = findings.filter((f) => f.blocking).map((f) => f.id).sort();
    return { version: CONTRACT_SCENARIO_CHALLENGE_VERSION, baseRevision: input.base.revision, findings, unknowns: [...blockers], blockers, canProceed: blockers.length === 0, revision: { revision: input.base.revision + (invalidated ? 1 : 0), contract: normalized }, scenario: { previousHash: input.scenarioHash, hash: invalidated ? null : input.scenarioHash, invalidated } };
}
