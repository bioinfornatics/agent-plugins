import { createHash } from "node:crypto";
import { USAGE_COST_EVIDENCE_VERSION } from "./usage-cost-types.js";
const CATS = ["input", "output", "cached", "reasoning"], MAX_SAFE_VALUE = Number.MAX_SAFE_INTEGER, USAGE_REASONS = new Set(["not-exposed", "not-applicable", "provider-omitted", "adapter-omitted"]), LATENCY_REASONS = new Set(["not-exposed", "not-applicable", "provider-omitted", "adapter-omitted"]), QUALITY_REASONS = new Set(["not-exposed", "not-applicable"]), ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, SECRET_KEY = /^(?:secret|token|password|credential|authorization|api[_-]?key|apiToken|accessToken|clientSecret|private[_-]?key)$/i, SECRET_VALUE = /(-----BEGIN .*PRIVATE KEY-----|\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}|\bAKIA[0-9A-Z]{16}|\bBearer\s+\S{8,})/i;
const rec = (v) => typeof v === "object" && v !== null && !Array.isArray(v), text = (v) => typeof v === "string" && v.length > 0 && v.trim() === v;
/** Strict UTC RFC 3339 profile with real calendar dates and optional fractional seconds. */
const instant = (v) => { if (typeof v !== "string" || v.startsWith("0000-"))
    return false; const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(v); if (!m)
    return false; const [, ys, mos, ds, hs, mis, ss] = m, year = +ys, month = +mos, day = +ds, hour = +hs, minute = +mis, second = +ss; if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59)
    return false; return day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate(); };
const diag = (code, path, message, remediation) => ({ code, path, message, remediation });
function inert(v, depth = 0, seen = new Set()) { if (v === null || typeof v === "boolean")
    return; if (typeof v === "number") {
    if (!Number.isFinite(v))
        throw 0;
    return;
} if (typeof v === "string") {
    if (SECRET_VALUE.test(v))
        throw 1;
    return;
} if (typeof v !== "object" || depth > 64 || seen.has(v))
    throw 0; seen.add(v); const proto = Object.getPrototypeOf(v), ds = Object.getOwnPropertyDescriptors(v), ks = Reflect.ownKeys(v); if (ks.some(k => typeof k !== "string"))
    throw 0; if (Array.isArray(v)) {
    if (proto !== Array.prototype || ks.length !== v.length + 1)
        throw 0;
    for (let i = 0; i < v.length; i++) {
        const x = ds[i];
        if (!x || !("value" in x) || !x.enumerable || !x.writable || !x.configurable)
            throw 0;
        inert(x.value, depth + 1, seen);
    }
}
else {
    if (proto !== Object.prototype && proto !== null)
        throw 0;
    for (const k of ks) {
        const x = ds[k];
        if (SECRET_KEY.test(k) || ["__proto__", "prototype", "constructor"].includes(k) || !x || !("value" in x) || !x.enumerable || !x.writable || !x.configurable)
            throw 1;
        inert(x.value, depth + 1, seen);
    }
} seen.delete(v); }
function snap(v) { inert(v); const x = structuredClone(v); inert(x); return x; }
const keys = (v, allow, p, d) => Object.keys(v).sort().forEach(k => { if (!allow.includes(k))
    d.push(diag("USAGE_UNKNOWN_FIELD", p + "/" + k, "Unknown or privacy-unsafe field.", "Remove the field; this contract is closed and contains no prompts, responses, or credentials.")); });
function metric(v, p, d, reasons, integer = false) { if (!rec(v)) {
    d.push(diag("USAGE_INVALID", p, "Metric must be an object.", "Provide value and unavailableReason."));
    return false;
} keys(v, ["value", "unavailableReason"], p, d); const value = v.value, reason = v.unavailableReason, ok = (value === null && typeof reason === "string" && reasons.has(reason)) || (typeof value === "number" && Number.isFinite(value) && value >= 0 && (!integer || (Number.isSafeInteger(value) && value <= MAX_SAFE_VALUE)) && reason === null); if (!ok)
    d.push(diag("USAGE_INVALID", p, "Exactly one finite non-negative value or availability reason is required.", "Use value with null reason, or null value with a defined reason.")); return ok; }
function tokens(v, p, d) { if (!rec(v)) {
    d.push(diag("USAGE_INVALID", p, "Token usage is required.", "Provide all token categories."));
    return false;
} keys(v, [...CATS, "total"], p, d); const ok = [...CATS, "total"].every(k => metric(v[k], p + "/" + k, d, USAGE_REASONS, true)); if (ok) {
    const xs = CATS.map(k => v[k].value), total = v.total.value;
    if (xs.every(x => x !== null)) {
        const sum = xs.reduce((a, b) => a + (b ?? 0), 0);
        if (total !== sum)
            d.push(diag("USAGE_CATEGORY_INCONSISTENT", p + "/total", "Token total must equal the four category values.", "Persist the provider categories without inference."));
    }
    else if (total !== null)
        d.push(diag("USAGE_CATEGORY_INCONSISTENT", p + "/total", "Total cannot be available while a category is unavailable.", "Use null total with an availability reason."));
} return ok; }
function observation(v, p, d) { if (!rec(v)) {
    d.push(diag("USAGE_INVALID", p, "Observation is required.", "Provide a closed usage observation."));
    return false;
} keys(v, ["tokens", "actualTurns", "latencyMs", "identity", "runtime"], p, d); let ok = tokens(v.tokens, p + "/tokens", d) && metric(v.actualTurns, p + "/actualTurns", d, USAGE_REASONS, true); if (!rec(v.latencyMs)) {
    d.push(diag("USAGE_INVALID", p + "/latencyMs", "Latency is required.", "Provide wall and model metrics."));
    ok = false;
}
else {
    keys(v.latencyMs, ["wall", "model"], p + "/latencyMs", d);
    ok = metric(v.latencyMs.wall, p + "/latencyMs/wall", d, LATENCY_REASONS) && metric(v.latencyMs.model, p + "/latencyMs/model", d, LATENCY_REASONS) && ok;
    const w = v.latencyMs.wall?.value, m = v.latencyMs.model?.value;
    if (w !== null && m !== null && typeof w === "number" && typeof m === "number" && m > w)
        d.push(diag("USAGE_CATEGORY_INCONSISTENT", p + "/latencyMs/model", "Model latency cannot exceed wall latency.", "Correct latency boundaries."));
} if (!rec(v.identity)) {
    d.push(diag("USAGE_INVALID", p + "/identity", "Model identity is required.", "Bind requested and resolved identity."));
    ok = false;
}
else {
    keys(v.identity, ["providerRequested", "modelRequested", "providerResolved", "modelResolved", "resolutionConfidence"], p + "/identity", d);
    if (![v.identity.providerRequested, v.identity.modelRequested, v.identity.providerResolved, v.identity.modelResolved].every(x => x === null || text(x)) || !["exact", "alias", "inferred", "unknown"].includes(v.identity.resolutionConfidence) || (v.identity.resolutionConfidence === "exact" && (!text(v.identity.providerResolved) || !text(v.identity.modelResolved)))) {
        d.push(diag("USAGE_INVALID", p + "/identity", "Identity fields or confidence are inconsistent.", "Provide explicit nullable requested/resolved identity and confidence."));
        ok = false;
    }
} if (!rec(v.runtime) || ![v.runtime.gooseVersion, v.runtime.adapterName, v.runtime.adapterVersion].every(text)) {
    d.push(diag("USAGE_INVALID", p + "/runtime", "Goose and adapter versions are required.", "Bind exact runtime versions."));
    ok = false;
}
else
    keys(v.runtime, ["gooseVersion", "adapterName", "adapterVersion"], p + "/runtime", d); return ok; }
function pricing(v, p, d) { if (!rec(v)) {
    d.push(diag("USAGE_PRICING_INVALID", p, "Pricing must be null or an object.", "Provide complete versioned pricing provenance."));
    return false;
} keys(v, ["source", "sourceVersion", "retrievedAt", "effectiveFrom", "effectiveTo", "currency", "provider", "model", "rates"], p, d); let ok = [v.source, v.sourceVersion, v.currency, v.provider, v.model].every(text) && instant(v.retrievedAt) && instant(v.effectiveFrom) && (v.effectiveTo === null || instant(v.effectiveTo)) && Array.isArray(v.rates) && v.rates.length === 4; if (!ok)
    d.push(diag("USAGE_PRICING_INVALID", p, "Pricing provenance is incomplete.", "Provide source/version/currency/model and effective dates with four rates.")); if (instant(v.effectiveFrom) && v.effectiveTo !== null && instant(v.effectiveTo) && Date.parse(v.effectiveTo) <= Date.parse(v.effectiveFrom)) {
    d.push(diag("USAGE_PRICING_INVALID", p + "/effectiveTo", "Pricing effective interval must be increasing.", "Set effectiveTo after effectiveFrom."));
    ok = false;
} if (Array.isArray(v.rates)) {
    const seen = new Set();
    v.rates.forEach((r, i) => { if (!rec(r)) {
        d.push(diag("USAGE_PRICING_INVALID", `${p}/rates/${i}`, "Rate must be an object.", "Provide a category and finite non-negative per-million-token rate."));
        ok = false;
        return;
    } keys(r, ["category", "perMillionTokens"], `${p}/rates/${i}`, d); if (!CATS.includes(r.category) || seen.has(r.category) || typeof r.perMillionTokens !== "number" || !Number.isFinite(r.perMillionTokens) || r.perMillionTokens < 0 || r.perMillionTokens > MAX_SAFE_VALUE) {
        d.push(diag("USAGE_PRICING_INVALID", `${p}/rates/${i}`, "Rate is invalid or duplicated.", "Provide one finite non-negative rate per category."));
        ok = false;
    } seen.add(r.category); });
} return ok; }
export function validateUsageCostInput(value) { try {
    const v = snap(value), d = [];
    if (!rec(v))
        return { valid: false, diagnostics: [diag("USAGE_INVALID", "/", "Input must be inert JSON.", "Provide a plain closed object.")] };
    keys(v, ["schemaVersion", "evidenceId", "observedAt", "executor", "grader", "pricing", "quality"], "", d);
    if (v.schemaVersion !== USAGE_COST_EVIDENCE_VERSION)
        d.push(diag("USAGE_VERSION_UNSUPPORTED", "/schemaVersion", "Unsupported version.", "Use 1.0.0."));
    if (!text(v.evidenceId) || !ID.test(v.evidenceId) || !instant(v.observedAt))
        d.push(diag("USAGE_INVALID", "/", "Evidence identity and observedAt are invalid.", "Provide a stable ID and UTC instant."));
    observation(v.executor, "/executor", d);
    observation(v.grader, "/grader", d);
    if (v.pricing !== null)
        pricing(v.pricing, "/pricing", d);
    metric(v.quality, "/quality", d, QUALITY_REASONS);
    return { valid: d.length === 0, diagnostics: d };
}
catch (e) {
    return { valid: false, diagnostics: [diag(e === 1 ? "USAGE_PRIVACY_VIOLATION" : "USAGE_INVALID", "/", e === 1 ? "Secret-like fields or values are forbidden." : "Hostile or non-JSON runtime data is forbidden.", "Provide inert telemetry only; omit prompts, responses, credentials, and provider payloads.")] };
} }
export class UsageCostValidationError extends Error {
    diagnostics;
    constructor(diagnostics) {
        super(diagnostics.map(x => `${x.code} ${x.path}: ${x.message}`).join("\n"));
        this.diagnostics = diagnostics;
        this.name = "UsageCostValidationError";
    }
}
const unavailable = (reason) => ({ value: null, unavailableReason: reason }), available = (value) => { const normalized = Object.is(value, -0) ? 0 : Number.isInteger(value) ? value : Math.round(value * 1e12) / 1e12; if (!Number.isFinite(value) || !Number.isFinite(normalized) || Math.abs(normalized) > MAX_SAFE_VALUE)
    throw new UsageCostValidationError([diag("USAGE_INVALID", "/computed", "Computed metric is non-finite or exceeds the safe normalized range.", "Reduce usage, pricing rates, or derived arithmetic before producing evidence.")]); return { value: normalized, unavailableReason: null }; }, canonical = (v) => Array.isArray(v) ? v.map(canonical) : rec(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v, hash = (v) => "sha256:" + createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex");
function cost(o, p, at) { if (!p)
    return unavailable("pricing-unavailable"); if (o.identity.providerResolved !== p.provider || o.identity.modelResolved !== p.model)
    return unavailable("pricing-incompatible"); const t = Date.parse(at), from = Date.parse(p.effectiveFrom), to = p.effectiveTo === null ? Infinity : Date.parse(p.effectiveTo); if (t < from || t >= to)
    return unavailable("pricing-incompatible"); if (CATS.some(k => o.tokens[k].value === null) || new Set(p.rates.map(x => x.category)).size !== 4)
    return unavailable("pricing-incomplete"); return available(CATS.reduce((sum, k) => sum + o.tokens[k].value * p.rates.find(r => r.category === k).perMillionTokens / 1_000_000, 0)); }
const copy = (m) => ({ ...m });
function assertCompleteComputedEvidence(metrics) { for (const m of metrics) {
    const availableValue = typeof m.value === "number" && Number.isFinite(m.value) && m.unavailableReason === null, unavailableValue = m.value === null && typeof m.unavailableReason === "string";
    if (!availableValue && !unavailableValue)
        throw new UsageCostValidationError([diag("USAGE_INVALID", "/computed", "Computed evidence violates the value/unavailable invariant.", "Return either a finite value with null reason or null with a defined reason.")]);
} }
const totalMetrics = (t) => [...CATS.map(k => t.tokens[k]), t.tokens.total, t.actualTurns, t.latencyMs.wall, t.latencyMs.model, t.monetaryCost];
function totals(o, p, at) { return { tokens: { input: copy(o.tokens.input), output: copy(o.tokens.output), cached: copy(o.tokens.cached), reasoning: copy(o.tokens.reasoning), total: copy(o.tokens.total) }, actualTurns: copy(o.actualTurns), latencyMs: { wall: copy(o.latencyMs.wall), model: copy(o.latencyMs.model) }, monetaryCost: cost(o, p, at), currency: p?.currency ?? null }; }
function combine(a, b) { const add = (x, y) => x.value !== null && y.value !== null ? available(x.value + y.value) : unavailable(x.unavailableReason ?? y.unavailableReason ?? "not-exposed"); return { tokens: { input: add(a.tokens.input, b.tokens.input), output: add(a.tokens.output, b.tokens.output), cached: add(a.tokens.cached, b.tokens.cached), reasoning: add(a.tokens.reasoning, b.tokens.reasoning), total: add(a.tokens.total, b.tokens.total) }, actualTurns: add(a.actualTurns, b.actualTurns), latencyMs: { wall: add(a.latencyMs.wall, b.latencyMs.wall), model: add(a.latencyMs.model, b.latencyMs.model) }, monetaryCost: a.currency === b.currency ? add(a.monetaryCost, b.monetaryCost) : unavailable("currency-incompatible"), currency: a.currency === b.currency ? a.currency : null }; }
export function computeUsageCostEvidence(value) { const check = validateUsageCostInput(value); if (!check.valid)
    throw new UsageCostValidationError(check.diagnostics); const v = snap(value), e = totals(v.executor, v.pricing, v.observedAt), g = totals(v.grader, v.pricing, v.observedAt), combined = combine(e, g), q = copy(v.quality), qpd = q.value !== null && combined.monetaryCost.value !== null && combined.monetaryCost.value > 0 ? available(q.value / combined.monetaryCost.value) : unavailable(combined.monetaryCost.value === 0 ? "zero-cost" : combined.monetaryCost.unavailableReason ?? q.unavailableReason ?? "not-exposed"), normalizedPricing = v.pricing ? { ...v.pricing, rates: [...v.pricing.rates].sort((a, b) => a.category.localeCompare(b.category)) } : null, body = { schemaVersion: USAGE_COST_EVIDENCE_VERSION, evidenceId: v.evidenceId, observedAt: v.observedAt, observations: { executor: v.executor, grader: v.grader }, pricing: normalizedPricing, executor: e, grader: g, combined, quality: q, qualityPerDollar: qpd }; assertCompleteComputedEvidence([...totalMetrics(e), ...totalMetrics(g), ...totalMetrics(combined), q, qpd]); return { ...body, evidenceHash: hash(body) }; }
function deltaTotals(a, b) { const sub = (x, y) => x.value !== null && y.value !== null ? available(y.value - x.value) : unavailable(x.unavailableReason ?? y.unavailableReason ?? "not-exposed"); return { tokens: { input: sub(a.tokens.input, b.tokens.input), output: sub(a.tokens.output, b.tokens.output), cached: sub(a.tokens.cached, b.tokens.cached), reasoning: sub(a.tokens.reasoning, b.tokens.reasoning), total: sub(a.tokens.total, b.tokens.total) }, actualTurns: sub(a.actualTurns, b.actualTurns), latencyMs: { wall: sub(a.latencyMs.wall, b.latencyMs.wall), model: sub(a.latencyMs.model, b.latencyMs.model) }, monetaryCost: a.currency === b.currency ? sub(a.monetaryCost, b.monetaryCost) : unavailable("currency-incompatible"), currency: a.currency === b.currency ? a.currency : null }; }
function normalizeEvidence(value, label) { try {
    const supplied = snap(value);
    if (!rec(supplied))
        throw 0;
    const input = { schemaVersion: supplied.schemaVersion, evidenceId: supplied.evidenceId, observedAt: supplied.observedAt, executor: supplied.observations?.executor, grader: supplied.observations?.grader, pricing: supplied.pricing, quality: supplied.quality };
    const recomputed = computeUsageCostEvidence(input);
    if (typeof supplied.evidenceHash !== "string" || supplied.evidenceHash !== recomputed.evidenceHash || JSON.stringify(canonical(supplied)) !== JSON.stringify(canonical(recomputed)))
        throw 0;
    return recomputed;
}
catch (e) {
    if (e instanceof UsageCostValidationError)
        throw e;
    throw new UsageCostValidationError([diag("USAGE_INVALID", "/" + label, "Evidence must be a complete normalized output with its recomputed SHA-256 hash.", "Recompute evidence with computeUsageCostEvidence; do not trust supplied totals or hashes.")]);
} }
export function computePairedUsageCostDelta(baseline, candidate) { const a = normalizeEvidence(baseline, "baseline"), b = normalizeEvidence(candidate, "candidate"), executor = deltaTotals(a.executor, b.executor), grader = deltaTotals(a.grader, b.grader), combined = deltaTotals(a.combined, b.combined), quality = a.quality.value !== null && b.quality.value !== null ? { value: b.quality.value - a.quality.value, unavailableReason: null } : unavailable(a.quality.unavailableReason ?? b.quality.unavailableReason ?? "not-exposed"), qualityPerDollar = a.qualityPerDollar.value !== null && b.qualityPerDollar.value !== null ? available(b.qualityPerDollar.value - a.qualityPerDollar.value) : unavailable(a.qualityPerDollar.unavailableReason ?? b.qualityPerDollar.unavailableReason ?? "not-exposed"), body = { schemaVersion: USAGE_COST_EVIDENCE_VERSION, baselineEvidenceHash: a.evidenceHash, candidateEvidenceHash: b.evidenceHash, executor, grader, combined, quality, qualityPerDollar }; assertCompleteComputedEvidence([...totalMetrics(executor), ...totalMetrics(grader), ...totalMetrics(combined), quality, qualityPerDollar]); return { ...body, deltaHash: hash(body) }; }
