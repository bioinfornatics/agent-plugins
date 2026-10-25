import { createHash } from "node:crypto";
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function canonical(value) { if (Array.isArray(value))
    return "[" + value.map(canonical).join(",") + "]"; if (value && typeof value === "object")
    return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}"; return JSON.stringify(value); }
export function normalizeAssertion(input, index) {
    if (typeof input === "string") {
        const m = /^(contains|not-contains|regex):\s*(.+)$/is.exec(input.trim());
        return m ? { id: "assertion-" + (index + 1), version: 1, classification: "deterministic", criterion: input, checker: { kind: m[1].toLowerCase(), value: m[2] } } : { id: "assertion-" + (index + 1), version: 1, classification: "semantic", criterion: input };
    }
    if (!input || typeof input !== "object")
        throw new Error("Assertion " + (index + 1) + " must be a string or object");
    const v = input;
    if (typeof v.id !== "string" || !v.id.trim())
        throw new Error("Assertion " + (index + 1) + " requires id");
    if (!Number.isInteger(v.version) || v.version < 1)
        throw new Error("Assertion " + v.id + " requires a positive integer version");
    if (v.classification !== "deterministic" && v.classification !== "semantic")
        throw new Error("Assertion " + v.id + " classification must be deterministic or semantic");
    if (typeof v.criterion !== "string" || !v.criterion.trim())
        throw new Error("Assertion " + v.id + " requires criterion");
    if (v.classification === "deterministic") {
        const c = v.checker;
        if (!c || !["contains", "not-contains", "regex"].includes(c.kind) || typeof c.value !== "string")
            throw new Error("Assertion " + v.id + " requires a supported checker");
        if (c.flags !== undefined && typeof c.flags !== "string")
            throw new Error("Assertion " + v.id + " checker flags must be a string");
        return { id: v.id, version: v.version, classification: v.classification, criterion: v.criterion, checker: { kind: c.kind, value: c.value, ...(c.flags ? { flags: c.flags } : {}) } };
    }
    if (v.checker !== undefined)
        throw new Error("Semantic assertion " + v.id + " must not define a checker");
    return { id: v.id, version: v.version, classification: v.classification, criterion: v.criterion };
}
export function normalizeAssertions(values) { const a = values.map(normalizeAssertion), seen = new Set(); for (const x of a) {
    const k = x.id + "@" + x.version;
    if (seen.has(k))
        throw new Error("Duplicate assertion " + k);
    seen.add(k);
} return a; }
export function variantManifest(variants) { return Object.fromEntries(Object.entries(variants).sort(([a], [b]) => a.localeCompare(b)).map(([name, source]) => [name, { source_sha256: sha256(source) }])); }
export function assertionHashFromManifest(assertions, variants) { return sha256(canonical({ schema_version: 2, assertions, variants: Object.fromEntries(Object.entries(variants).sort(([a], [b]) => a.localeCompare(b)).map(([name, source]) => [name, { source_sha256: source.source_sha256 }])) })); }
export function assertionHash(assertions, variants) { return assertionHashFromManifest(assertions, variantManifest(variants)); }
export function runDeterministic(a, response) { if (a.classification !== "deterministic" || !a.checker)
    throw new Error("Not deterministic"); const { kind, value, flags } = a.checker; let start = -1, end = -1; if (kind === "contains" || kind === "not-contains") {
    start = response.toLowerCase().indexOf(value.toLowerCase());
    end = start < 0 ? -1 : start + value.length;
}
else {
    let re;
    try {
        re = new RegExp(value, flags ?? "m");
    }
    catch (e) {
        throw new Error("Invalid assertion regex '" + value + "': " + e.message);
    }
    const m = re.exec(response);
    if (m) {
        start = m.index;
        end = start + m[0].length;
    }
} const matched = start >= 0, passed = kind === "not-contains" ? !matched : matched; return { verdict: (passed ? "pass" : "fail"), evidence: { checker: a.checker, response_sha256: sha256(response), matched, span: matched ? { start, end, quote: response.slice(start, end) } : null } }; }
