import { createHash } from "node:crypto";
import { OUTCOME_METRIC_IDS, OUTCOME_METRICS_VERSION } from "./outcome-metrics-types.js";
const H = /^sha256:[a-f0-9]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EVENT_TYPES = new Set(["idea-recorded", "task-started", "task-completed", "creation-started", "creation-completed", "release-candidate-created", "intervention", "intervention-count-recorded", "review-started", "review-completed", "recovery-started", "recovery-completed", "cost-recorded"]);
const EVAL_KINDS = new Set(["task-success", "effectiveness", "improvement", "regression", "recovery", "confidence", "evidence-credibility", "safety", "human-approval"]);
const definition = (id, title, formula, population, exclusions, eventTypes, evaluationKinds, operator, value, unit, guardrail = false) => Object.freeze({ id, title, formula, population, exclusions: Object.freeze(exclusions), provenance: Object.freeze({ eventTypes: Object.freeze(eventTypes), evaluationKinds: Object.freeze(evaluationKinds), evidenceKinds: Object.freeze([...evaluationKinds]) }), target: Object.freeze({ operator, value, unit }), ...(guardrail ? { guardrail: true } : {}) });
export const OUTCOME_METRIC_DICTIONARY = Object.freeze(Object.fromEntries([
    definition("task-success-rate", "Task success", "passed task-success evaluations / candidate idea runs", "candidate runs with idea-recorded", ["opted-out records"], ["idea-recorded"], ["task-success"], ">=", .9, "ratio"),
    definition("time-savings-seconds", "Time savings", "mean(baseline task duration - candidate task duration) over exact matched pairs", "exact pairs with complete task intervals", ["incomplete intervals"], ["task-started", "task-completed"], [], ">=", 0, "seconds"),
    definition("intervention-savings", "Intervention savings", "mean(baseline observed intervention count - candidate observed intervention count) over exact matched pairs", "exact pairs with explicit count telemetry", ["missing count telemetry"], ["intervention-count-recorded"], [], ">=", 0, "interventions"),
    definition("creation-completion-rate", "Creation completion", "completed candidate creations / started candidate creations", "candidate creation attempts", ["completion without start"], ["creation-started", "creation-completed"], [], ">=", .9, "ratio"),
    definition("improvement-yield", "Improvement yield", "passed improvement evaluations / candidate idea runs", "candidate idea runs", ["opted-out records"], ["idea-recorded"], ["improvement"], ">=", .5, "ratio"),
    definition("regression-rate", "Regression rate", "failed regression evaluations / candidate idea runs", "candidate idea runs", ["opted-out records"], ["idea-recorded"], ["regression"], "<=", .05, "ratio", true),
    definition("recovery-rate", "Recovery", "completed recovery attempts with passing recovery evaluation / recovery starts", "candidate recovery attempts", ["opted-out records"], ["recovery-started", "recovery-completed"], ["recovery"], ">=", .9, "ratio"),
    definition("review-time-seconds", "Review time", "mean(review-completed - review-started)", "complete candidate review intervals", ["incomplete intervals"], ["review-started", "review-completed"], [], "<=", 1800, "seconds"),
    definition("confidence-score", "Confidence", "mean passing candidate confidence evaluation scores", "candidate idea runs", ["unscored confidence claims"], ["idea-recorded"], ["confidence"], ">=", .8, "ratio", true),
    definition("idea-to-release-candidate-credible-effectiveness", "Idea to release-candidate credible effectiveness improvement", "eligible exact matched pairs / all exact matched pairs", "exactly one baseline and one candidate run per pair", ["opted-out records; guardrail failures remain in denominator"], ["idea-recorded", "release-candidate-created", "cost-recorded", "intervention-count-recorded"], ["effectiveness", "improvement", "regression", "confidence", "evidence-credibility", "safety", "human-approval"], ">=", .8, "ratio", true)
].map(x => [x.id, x])));
const diag = (code, path, message, remediation) => ({ code, path, message, remediation });
const record = (v) => typeof v === "object" && v !== null && !Array.isArray(v), text = (v) => typeof v === "string" && v.length > 0 && v.trim() === v;
const keys = (v, allowed, path, d) => { for (const k of Object.keys(v).sort())
    if (!allowed.includes(k))
        d.push(diag("METRICS_UNKNOWN_FIELD", path + "/" + k, "Unknown field " + k + ".", "Remove the field; inputs are closed.")); };
const instant = (v) => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v) && Number.isFinite(Date.parse(v));
const validProv = (v) => record(v) && ["host-event", "evaluation-run", "human-record"].includes(v.sourceType) && text(v.sourceId) && ID.test(v.sourceId) && typeof v.digest === "string" && H.test(v.digest);
/** Descriptor walk rejects accessors/exotics without reading values. structuredClone then rejects even transparent proxies. */
function assertInert(v, depth = 0, seen = new Set()) { if (v === null || typeof v === "string" || typeof v === "boolean")
    return; if (typeof v === "number") {
    if (!Number.isFinite(v))
        throw 0;
    return;
} if (typeof v !== "object" || depth > 64 || seen.has(v))
    throw 0; seen.add(v); const p = Object.getPrototypeOf(v), ks = Reflect.ownKeys(v), ds = Object.getOwnPropertyDescriptors(v); if (ks.some(k => typeof k !== "string"))
    throw 0; const data = (x) => !!x && "value" in x && x.enumerable && x.writable && x.configurable; if (Array.isArray(v)) {
    if (p !== Array.prototype || ks.length !== v.length + 1)
        throw 0;
    for (let i = 0; i < v.length; i++) {
        const x = ds[String(i)];
        if (!data(x))
            throw 0;
        assertInert(x.value, depth + 1, seen);
    }
}
else {
    if (p !== Object.prototype && p !== null)
        throw 0;
    for (const k of ks) {
        if (["__proto__", "prototype", "constructor"].includes(k) || !data(ds[k]))
            throw 0;
        assertInert(ds[k].value, depth + 1, seen);
    }
} seen.delete(v); }
function snapshot(v) { assertInert(v); const clone = structuredClone(v); assertInert(clone); return clone; }
function validateInner(v) {
    const d = [];
    if (!record(v))
        return { valid: false, diagnostics: [diag("METRICS_INVALID", "/", "Metrics input must be an inert JSON object.", "Provide a plain JSON object.")] };
    keys(v, ["schemaVersion", "journey", "metricContract", "privacy", "budget", "events", "evidence", "evaluations"], "", d);
    if (v.schemaVersion !== OUTCOME_METRICS_VERSION)
        d.push(diag("METRICS_VERSION_UNSUPPORTED", "/schemaVersion", "Unsupported schema version.", "Use 1.0.0."));
    if (!record(v.journey) || !text(v.journey.id) || v.journey.golden !== true)
        d.push(diag("METRICS_CONTRACT_INCOMPLETE", "/journey", "A golden journey is mandatory.", "Provide id and golden: true."));
    else
        keys(v.journey, ["id", "golden"], "/journey", d);
    if (!record(v.metricContract) || v.metricContract.dictionaryVersion !== OUTCOME_METRICS_VERSION || v.metricContract.northStarMetricId !== OUTCOME_METRIC_IDS[9] || !Array.isArray(v.metricContract.requiredMetricIds) || v.metricContract.requiredMetricIds.length !== 10 || [...v.metricContract.requiredMetricIds].sort().join("\0") !== [...OUTCOME_METRIC_IDS].sort().join("\0"))
        d.push(diag("METRICS_CONTRACT_INCOMPLETE", "/metricContract", "Every dictionary metric and fixed north star are required.", "Use createGoldenJourneyMetricContract()."));
    else
        keys(v.metricContract, ["dictionaryVersion", "requiredMetricIds", "northStarMetricId"], "/metricContract", d);
    if (v.privacy !== undefined) {
        if (!record(v.privacy) || v.privacy.processing !== "local-only" || !["included", "opted-out"].includes(v.privacy.participation))
            d.push(diag("METRICS_INVALID", "/privacy", "Invalid privacy state.", "Use local-only and included or opted-out."));
        else
            keys(v.privacy, ["processing", "participation"], "/privacy", d);
    }
    if (!record(v.budget) || typeof v.budget.maxDurationSeconds !== "number" || v.budget.maxDurationSeconds <= 0 || typeof v.budget.maxCostUsd !== "number" || v.budget.maxCostUsd < 0 || !Number.isSafeInteger(v.budget.maxInterventions) || Number(v.budget.maxInterventions) < 0)
        d.push(diag("METRICS_INVALID", "/budget", "Finite duration, cost, and intervention budgets are required.", "Declare all budget bounds."));
    else
        keys(v.budget, ["maxDurationSeconds", "maxCostUsd", "maxInterventions"], "/budget", d);
    const opted = record(v.privacy) && v.privacy.participation === "opted-out";
    if (!Array.isArray(v.events) || !Array.isArray(v.evidence) || !Array.isArray(v.evaluations)) {
        d.push(diag("METRICS_INVALID", "/", "events, evidence, and evaluations must be arrays.", "Provide all registries."));
        return { valid: false, diagnostics: d };
    }
    if (opted && (v.events.length || v.evidence.length || v.evaluations.length))
        d.push(diag("METRICS_PRIVACY_VIOLATION", "/privacy/participation", "Opted-out input cannot contain records.", "Remove records."));
    if (v.events.length > 100000 || v.evidence.length > 100000 || v.evaluations.length > 100000)
        d.push(diag("METRICS_INVALID", "/", "Record limit exceeded.", "Split the report."));
    const ids = new Set(), runs = new Set(), binding = new Map(), pairRuns = new Map(), sem = new Set();
    v.events.forEach((x, i) => { const p = `/events/${i}`, ok = record(x) && text(x.id) && ID.test(x.id) && text(x.runId) && ID.test(x.runId) && text(x.pairId) && ID.test(x.pairId) && ["baseline", "candidate"].includes(x.variant) && EVENT_TYPES.has(x.type) && instant(x.occurredAt) && validProv(x.provenance) && (x.amount === undefined || (typeof x.amount === "number" && Number.isFinite(x.amount) && x.amount >= 0)); if (!ok) {
        d.push(diag("METRICS_EVENT_INVALID", p, "Malformed event.", "Provide a fully bound event."));
        return;
    } keys(x, ["id", "runId", "pairId", "variant", "type", "occurredAt", "amount", "provenance"], p, d); keys(x.provenance, ["sourceType", "sourceId", "digest"], p + "/provenance", d); const needsAmount = ["cost-recorded", "intervention-count-recorded"].includes(x.type); if (needsAmount !== (x.amount !== undefined) || (x.type === "intervention-count-recorded" && !Number.isSafeInteger(x.amount)))
        d.push(diag("METRICS_EVENT_INVALID", p + "/amount", "Usage telemetry requires a non-negative amount; lifecycle events forbid it.", "Record explicit cost/count, including zero.")); const b = `${x.pairId}\0${x.variant}`; if (binding.has(x.runId) && binding.get(x.runId) !== b)
        d.push(diag("METRICS_EVENT_INVALID", p + "/runId", "Run changed pair or variant.", "Keep immutable binding.")); binding.set(x.runId, b); const pr = pairRuns.get(x.pairId) ?? { baseline: new Set(), candidate: new Set() }; pr[x.variant].add(x.runId); pairRuns.set(x.pairId, pr); const s = `${x.runId}\0${x.type}`; if (sem.has(s) && x.type !== "intervention")
        d.push(diag("METRICS_DUPLICATE", p + "/type", "Singleton event duplicated.", "Emit once per run.")); sem.add(s); if (ids.has(x.id))
        d.push(diag("METRICS_DUPLICATE", p + "/id", "Record id duplicated.", "Use global unique ids.")); ids.add(x.id); runs.add(x.runId); });
    for (const [pairId, p] of pairRuns)
        if (p.baseline.size !== 1 || p.candidate.size !== 1)
            d.push(diag("METRICS_PAIR_INVALID", "/events", "Pair " + pairId + " must bind exactly one baseline and one candidate run.", "Split or complete ambiguous pairs."));
    const evidence = new Map();
    v.evidence.forEach((x, i) => { const p = `/evidence/${i}`, ok = record(x) && text(x.id) && ID.test(x.id) && text(x.runId) && ID.test(x.runId) && EVAL_KINDS.has(x.type) && validProv(x.provenance); if (!ok) {
        d.push(diag("METRICS_EVIDENCE_INVALID", p, "Malformed evidence registry record.", "Bind evidence to a run, evaluation type, and provenance."));
        return;
    } keys(x, ["id", "runId", "type", "provenance"], p, d); keys(x.provenance, ["sourceType", "sourceId", "digest"], p + "/provenance", d); if (!runs.has(x.runId))
        d.push(diag("METRICS_EVIDENCE_INVALID", p + "/runId", "Evidence references no event run.", "Bind it to a recorded run.")); if (ids.has(x.id))
        d.push(diag("METRICS_DUPLICATE", p + "/id", "Record id duplicated.", "Use global unique ids.")); ids.add(x.id); evidence.set(x.id, x); });
    const eventRecords = v.events;
    const evByRun = (r, t) => eventRecords.some((x) => x.runId === r && x.type === t);
    v.evaluations.forEach((x, i) => { const p = `/evaluations/${i}`, ok = record(x) && text(x.id) && ID.test(x.id) && text(x.runId) && ID.test(x.runId) && EVAL_KINDS.has(x.kind) && typeof x.passed === "boolean" && (x.score === undefined || (typeof x.score === "number" && x.score >= 0 && x.score <= 1)) && record(x.evaluator) && text(x.evaluator.id) && ID.test(x.evaluator.id) && ["automated", "human"].includes(x.evaluator.type) && Array.isArray(x.evidenceIds) && x.evidenceIds.length > 0 && x.evidenceIds.every(y => text(y) && ID.test(y)) && new Set(x.evidenceIds).size === x.evidenceIds.length && validProv(x.provenance); if (!ok) {
        d.push(diag("METRICS_EVALUATION_INVALID", p, "Malformed evaluation.", "Provide bounded, evidenced evaluation data."));
        return;
    } keys(x, ["id", "runId", "kind", "passed", "score", "evaluator", "evidenceIds", "provenance"], p, d); keys(x.evaluator, ["id", "type"], p + "/evaluator", d); keys(x.provenance, ["sourceType", "sourceId", "digest"], p + "/provenance", d); const s = `${x.runId}\0${x.kind}`; if (sem.has(s))
        d.push(diag("METRICS_DUPLICATE", p + "/kind", "Evaluation kind duplicated for run.", "Aggregate judgments.")); sem.add(s); if (!runs.has(x.runId))
        d.push(diag("METRICS_EVALUATION_INVALID", p + "/runId", "Unknown run.", "Bind evaluation to events.")); for (const id of x.evidenceIds) {
        const e = evidence.get(id);
        if (!e || e.runId !== x.runId || e.type !== x.kind)
            d.push(diag("METRICS_EVIDENCE_INVALID", p + "/evidenceIds", "Evidence must resolve to the same run and evaluation type.", "Register correctly bound evidence."));
    } if (["effectiveness", "confidence", "evidence-credibility"].includes(x.kind) && x.score === undefined)
        d.push(diag("METRICS_EVALUATION_INVALID", p + "/score", "This evaluation requires a score.", "Provide score 0..1.")); if (x.kind === "human-approval" && x.evaluator.type !== "human")
        d.push(diag("METRICS_GUARDRAIL_INVALID", p + "/evaluator/type", "Approval must be human.", "Use an identified human.")); if (x.kind === "recovery" && (!evByRun(x.runId, "recovery-started") || !evByRun(x.runId, "recovery-completed")))
        d.push(diag("METRICS_EVALUATION_INVALID", p + "/kind", "Recovery evaluation requires the complete recovery lifecycle.", "Record recovery start and completion.")); if (ids.has(x.id))
        d.push(diag("METRICS_DUPLICATE", p + "/id", "Record id duplicated.", "Use global unique ids.")); ids.add(x.id); });
    return { valid: d.length === 0, diagnostics: d };
}
export function validateOutcomeMetricsInput(value) { try {
    return validateInner(snapshot(value));
}
catch {
    return { valid: false, diagnostics: [diag("METRICS_INVALID", "/", "Input contains hostile or non-JSON runtime data.", "Provide inert plain JSON without proxies, accessors, symbols, cycles, sparse arrays, or exotic prototypes.")] };
} }
export class OutcomeMetricsValidationError extends Error {
    diagnostics;
    constructor(diagnostics) {
        super(diagnostics.map(x => x.code + " " + x.path + ": " + x.message).join("\n"));
        this.diagnostics = diagnostics;
        this.name = "OutcomeMetricsValidationError";
    }
}
export function createGoldenJourneyMetricContract() { return { dictionaryVersion: OUTCOME_METRICS_VERSION, requiredMetricIds: [...OUTCOME_METRIC_IDS], northStarMetricId: "idea-to-release-candidate-credible-effectiveness" }; }
const round = (n) => Math.round((n + Number.EPSILON) * 1e6) / 1e6, canonical = (v) => Array.isArray(v) ? v.map(canonical) : record(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
function result(id, value, n, den, prov, status) { const def = OUTCOME_METRIC_DICTIONARY[id], v = value === undefined ? undefined : round(value), s = status ?? (v === undefined ? "missing" : "computed"); return { id, status: s, ...(v === undefined ? {} : { value: v, met: def.target.operator === ">=" ? v >= def.target.value : v <= def.target.value }), unit: def.target.unit, target: { ...def.target }, ...(n === undefined ? {} : { numerator: n }), ...(den === undefined ? {} : { denominator: den }), provenanceIds: [...new Set(prov)].sort() }; }
export function computeOutcomeMetrics(value) {
    const validation = validateOutcomeMetricsInput(value);
    if (!validation.valid)
        throw new OutcomeMetricsValidationError(validation.diagnostics);
    const input = snapshot(value), opted = input.privacy?.participation === "opted-out", empty = OUTCOME_METRIC_IDS.map(id => result(id, undefined, undefined, undefined, [], opted ? "opted-out" : "missing"));
    if (opted)
        return finish(input, empty, false, [], []);
    const ev = [...input.events].sort((a, b) => a.id.localeCompare(b.id)), es = [...input.evaluations].sort((a, b) => a.id.localeCompare(b.id)), evidenceIds = (x) => x.evidenceIds, candidates = [...new Set(ev.filter(x => x.variant === "candidate" && x.type === "idea-recorded").map(x => x.runId))].sort(), by = (r, k) => es.find(x => x.runId === r && x.kind === k), events = (r, t) => ev.filter(x => x.runId === r && x.type === t), interval = (r, a, b) => { const x = events(r, a)[0], y = events(r, b)[0]; return x && y && Date.parse(y.occurredAt) >= Date.parse(x.occurredAt) ? (Date.parse(y.occurredAt) - Date.parse(x.occurredAt)) / 1000 : undefined; }, mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined, evalProv = (xs) => xs.flatMap(x => [x.id, ...evidenceIds(x)]);
    const taskE = candidates.map(r => by(r, "task-success")).filter(Boolean), task = result("task-success-rate", candidates.length ? taskE.filter(x => x.passed).length / candidates.length : undefined, taskE.filter(x => x.passed).length, candidates.length, evalProv(taskE));
    const starts = ev.filter(x => x.variant === "candidate" && x.type === "creation-started"), completed = new Set(ev.filter(x => x.variant === "candidate" && x.type === "creation-completed").map(x => x.runId)), creation = result("creation-completion-rate", starts.length ? starts.filter(x => completed.has(x.runId)).length / starts.length : undefined, starts.filter(x => completed.has(x.runId)).length, starts.length, ev.filter(x => starts.some(s => s.runId === x.runId) && ["creation-started", "creation-completed"].includes(x.type)).map(x => x.id));
    const pairIds = [...new Set(ev.map(x => x.pairId))].sort(), tv = [], iv = [], tp = [], ip = [];
    for (const p of pairIds) {
        const pe = ev.filter(x => x.pairId === p), br = pe.find(x => x.variant === "baseline").runId, cr = pe.find(x => x.variant === "candidate").runId, bd = interval(br, "task-started", "task-completed"), cd = interval(cr, "task-started", "task-completed"), bc = events(br, "intervention-count-recorded")[0], cc = events(cr, "intervention-count-recorded")[0];
        if (bd !== undefined && cd !== undefined) {
            tv.push(bd - cd);
            tp.push(...pe.filter(x => [br, cr].includes(x.runId) && ["task-started", "task-completed"].includes(x.type)).map(x => x.id));
        }
        if (bc && cc) {
            iv.push(bc.amount - cc.amount);
            ip.push(bc.id, cc.id);
        }
    }
    const time = result("time-savings-seconds", mean(tv), undefined, tv.length, tp), interventions = result("intervention-savings", mean(iv), undefined, iv.length, ip), imE = candidates.map(r => by(r, "improvement")).filter(Boolean), improvement = result("improvement-yield", candidates.length ? imE.filter(x => x.passed).length / candidates.length : undefined, imE.filter(x => x.passed).length, candidates.length, evalProv(imE)), regE = candidates.map(r => by(r, "regression")).filter(Boolean), regression = result("regression-rate", candidates.length ? (candidates.length - regE.filter(x => x.passed).length) / candidates.length : undefined, candidates.length - regE.filter(x => x.passed).length, candidates.length, evalProv(regE));
    const recoveryStarts = ev.filter(x => x.variant === "candidate" && x.type === "recovery-started"), recovered = recoveryStarts.filter(x => events(x.runId, "recovery-completed").length && by(x.runId, "recovery")?.passed), recE = recoveryStarts.map(x => by(x.runId, "recovery")).filter(Boolean), recovery = result("recovery-rate", recoveryStarts.length ? recovered.length / recoveryStarts.length : undefined, recovered.length, recoveryStarts.length, [...ev.filter(x => recoveryStarts.some(s => s.runId === x.runId) && ["recovery-started", "recovery-completed"].includes(x.type)).map(x => x.id), ...evalProv(recE)]), reviews = candidates.map(r => ({ r, n: interval(r, "review-started", "review-completed") })).filter(x => x.n !== undefined), review = result("review-time-seconds", mean(reviews.map(x => x.n)), undefined, reviews.length, ev.filter(x => reviews.some(r => r.r === x.runId) && ["review-started", "review-completed"].includes(x.type)).map(x => x.id)), confE = candidates.map(r => by(r, "confidence")).filter(Boolean), confidence = result("confidence-score", mean(confE.filter(x => x.passed && x.score !== undefined).map(x => x.score)), undefined, confE.length, evalProv(confE));
    const eligible = [], blocked = [], reasons = new Set(), nsProv = [];
    for (const p of pairIds) {
        const pe = ev.filter(x => x.pairId === p), br = pe.find(x => x.variant === "baseline").runId, cr = pe.find(x => x.variant === "candidate").runId, base = by(br, "effectiveness"), cand = by(cr, "effectiveness"), idea = events(cr, "idea-recorded")[0], release = events(cr, "release-candidate-created")[0], cost = events(cr, "cost-recorded")[0], count = events(cr, "intervention-count-recorded")[0], duration = idea && release ? (Date.parse(release.occurredAt) - Date.parse(idea.occurredAt)) / 1000 : undefined, needed = [base, cand, by(cr, "improvement"), by(cr, "regression"), by(cr, "confidence"), by(cr, "evidence-credibility"), by(cr, "safety"), by(cr, "human-approval")].filter(Boolean);
        nsProv.push(...pe.map(x => x.id), ...evalProv(needed));
        const checks = [["matched effectiveness missing or not improved", !!base?.passed && base.score !== undefined && !!cand?.passed && cand.score !== undefined && cand.score > base.score], ["improvement evaluation absent or failed", !!by(cr, "improvement")?.passed], ["regression guardrail absent or failed", !!by(cr, "regression")?.passed], ["confidence target not met", !!by(cr, "confidence")?.passed && (by(cr, "confidence")?.score ?? -1) >= OUTCOME_METRIC_DICTIONARY["confidence-score"].target.value], ["credible evidence below target", !!by(cr, "evidence-credibility")?.passed && (by(cr, "evidence-credibility")?.score ?? -1) >= .8], ["safety evaluation absent or failed", !!by(cr, "safety")?.passed], ["human approval absent or failed", !!by(cr, "human-approval")?.passed && by(cr, "human-approval")?.evaluator.type === "human"], ["duration telemetry missing or budget exceeded", duration !== undefined && duration >= 0 && duration <= input.budget.maxDurationSeconds], ["cost telemetry missing or budget exceeded", !!cost && cost.amount <= input.budget.maxCostUsd], ["intervention telemetry missing or budget exceeded", !!count && count.amount <= input.budget.maxInterventions]];
        if (checks.every(x => x[1]))
            eligible.push(cr);
        else {
            blocked.push(cr);
            checks.filter(x => !x[1]).forEach(x => reasons.add(x[0]));
        }
    }
    const ns = result("idea-to-release-candidate-credible-effectiveness", pairIds.length ? eligible.length / pairIds.length : undefined, eligible.length, pairIds.length, nsProv, blocked.length && pairIds.length ? "guardrail-blocked" : undefined);
    return finish(input, [task, time, interventions, creation, improvement, regression, recovery, review, confidence, ns], blocked.length === 0 && pairIds.length > 0 && ns.met === true, blocked, [...reasons]);
}
function finish(input, metrics, releaseEligible, blockedRunIds, reasons) { const body = { schemaVersion: OUTCOME_METRICS_VERSION, dictionaryVersion: OUTCOME_METRICS_VERSION, journeyId: input.journey.id, privacyStatus: (input.privacy?.participation === "opted-out" ? "opted-out" : "local-only"), metrics, northStar: metrics.find(x => x.id === OUTCOME_METRIC_IDS[9]), guardrails: { releaseEligible, blockedRunIds: [...blockedRunIds].sort(), reasons: [...reasons].sort() } }; return { ...body, computationHash: "sha256:" + createHash("sha256").update(JSON.stringify(canonical(body))).digest("hex") }; }
