import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EMBEDDED_PROTOCOL } from "./embedded_resources.js";
import { portableSkillPath } from "./resource_paths.js";
export const JOURNEYS = ["validation-report", "evaluation-regression-report", "release-decision-report"];
export const DECISIONS = ["validation-failure", "evaluation-failure", "blocked", "approval-required"];
export const SEVERITIES = ["P0", "P1", "P2", "P3"];
const protocolBytes = import.meta.url.includes("/$bunfs/")
    ? Buffer.from(JSON.stringify(EMBEDDED_PROTOCOL, null, 2) + "\n")
    : readFileSync(portableSkillPath("assets/decision-comprehension/protocol.json"));
function loadProtocol(bytes) { let value; try {
    value = JSON.parse(bytes.toString("utf8"));
}
catch (error) {
    throw new Error("Invalid decision-comprehension protocol JSON: " + String(error));
} if (!object(value) || Object.keys(value).some(k => !["version", "tasks"].includes(k)) || typeof value.version !== "string" || !/^\d+\.\d+\.\d+$/.test(value.version) || !Array.isArray(value.tasks) || value.tasks.length === 0)
    throw new Error("Invalid decision-comprehension protocol shape"); const ids = new Set(); for (const task of value.tasks) {
    if (!object(task) || Object.keys(task).length !== 3 || Object.keys(task).some(k => !["id", "journey", "expected_decision"].includes(k)) || typeof task.id !== "string" || !task.id || !JOURNEYS.includes(task.journey) || !DECISIONS.includes(task.expected_decision) || ids.has(task.id))
        throw new Error("Invalid decision-comprehension protocol task shape");
    ids.add(task.id);
} return value; }
const protocol = loadProtocol(protocolBytes);
export const protocolIdentity = { version: protocol.version, sha256: createHash("sha256").update(protocolBytes).digest("hex") };
const canonical = new Map(protocol.tasks.map(t => [t.id, t]));
const allowed = { root: ["schema_version", "study", "sessions"], study: ["anonymous", "direct_identifiers_collected", "protocol"], protocol: ["version", "sha256"], session: ["session_id", "cohort", "synthetic", "consent", "retention", "facilitator", "tasks", "findings"], consent: ["informed", "recorded", "withdrawal_explained", "consented_at"], retention: ["policy_version", "delete_after"], facilitator: ["script_version", "neutral_prompts_only"], task: ["task_id", "journey", "completed_unassisted", "time_to_first_candidate_seconds", "facilitator_interventions", "selected_decision", "expected_decision", "decision_confidence", "missing_evidence_identified", "highest_regression_time_seconds", "highest_regression_accurate"], finding: ["code", "severity", "classification", "summary", "evidence"], evidence: ["locator", "observation"] };
const prohibitedKey = /(^|_)(name|email|phone|address|handle|username|employer|company|organization|organisation|ip|url|uri|home|path|recording|transcript|audio|video|contact)(_|$)/i;
const commonFirst = "(?:Alice|Alex|Anna|Anne|Carlos|Daniel|David|Emma|Fatima|James|Jean|John|José|Jose|Julia|Li|Maria|Marie|Michael|Mohamed|Muhammad|Priya|Robert|Sarah|Sofia|Wei)";
const commonLast = "(?:Anderson|Brown|Chen|Davis|Dubois|Garcia|García|Johnson|Jones|Kim|Kumar|Lee|Martin|Martinez|Martínez|Miller|Patel|Rodriguez|Rodríguez|Smith|Taylor|Thomas|Wang|Williams|Wilson)";
const pii = [["email", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i], ["URL", /\b(?:https?|git|ssh):\/\/|\bwww\.[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/i], ["home path", /(?:\/home\/[^\s/]+|\/Users\/[^\s/]+|[A-Z]:\\Users\\[^\s\\]+)/i], ["IP address", /(?<![A-F0-9:.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![A-F0-9:.])|(?<![A-F0-9:])(?=[A-F0-9:]{2,39}(?![A-F0-9:]))(?=[A-F0-9:]*(?:[A-F]|::))[A-F0-9:]*:[A-F0-9:]*/i], ["international phone", /(?<![\d+])(?:\+|00)\d{1,3}[ .()\/-]*(?:\d[ .()\/-]*){7,14}(?!\d)/], ["street address", /\b\d{1,6}[ ,-]+[\p{L}][\p{L}.'’-]*(?:[ -]+[\p{L}][\p{L}.'’-]*){0,5}[ ,]+(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Court|Ct|Place|Pl|Rue|Ruelle|Chemin|Route|Via|Calle|Straße|Strasse)\.?\b/iu], ["social handle", /(^|[^\p{L}\p{N}._%+-])@[\p{L}\p{N}_](?:[\p{L}\p{N}_.-]{0,28}[\p{L}\p{N}_])?(?![\p{L}\p{N}_.-]*@)/u], ["possible personal name", new RegExp("\\b(?:Mr|Mrs|Ms|Mx|Dr|Prof)\\.?\\s+[\\p{Lu}][\\p{L}'’-]+(?:\\s+[\\p{Lu}][\\p{L}'’-]+)+\\b|\\b" + commonFirst + "\\s+" + commonLast + "\\b", "iu")], ["possible organization", /\b(?:[\p{Lu}][\p{L}0-9&.'’-]*[ -]+){0,5}[\p{Lu}][\p{L}0-9&.'’-]*[ ,]+(?:Inc|LLC|Ltd|Limited|Corp|Corporation|Company|University|Institute|Association|Foundation|GmbH|SAS|SA|PLC|AG|BV|NV|Pty)\.?\b|\b(?:employer|company|organi[sz]ation|works? at|employed by)\s*(?::|is|=|at|by)?\s+[\p{Lu}][\p{L}0-9&.'’-]*(?:[ -]+[\p{Lu}][\p{L}0-9&.'’-]*){0,5}/iu]];
function object(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
function strict(v, keys, p, e) { for (const k of keys)
    if (!(k in v))
        e.push(p + "." + k + ": required"); for (const k of Object.keys(v))
    if (!keys.includes(k))
        e.push(p + "." + k + ": " + (prohibitedKey.test(k) ? "direct identifier field is prohibited" : "additional property is not allowed")); }
function scan(v, p, e) { if (typeof v === "string") {
    for (const [kind, re] of pii)
        if (re.test(v)) {
            e.push(p + ": " + kind + " is prohibited");
            break;
        }
}
else if (Array.isArray(v))
    v.forEach((x, i) => scan(x, p + "[" + i + "]", e));
else if (object(v))
    Object.entries(v).forEach(([k, x]) => scan(x, p + "." + k, e)); }
function timestamp(v) { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(v) && !Number.isNaN(Date.parse(v)); }
function date(v) { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v; }
function finite(v) { return typeof v === "number" && Number.isFinite(v) && v >= 0; }
function text(v, p, e, min = 1, max = 500) { if (typeof v !== "string" || v.trim().length < min || v.length > max)
    e.push(p + ": must contain " + min + "-" + max + " characters"); }
function evidence(v, p, e) { if (!object(v)) {
    e.push(p + ": must be structured evidence");
    return;
} strict(v, allowed.evidence, p, e); text(v.locator, p + ".locator", e, 4, 160); text(v.observation, p + ".observation", e, 12, 500); }
export function validateDecisionResearch(value) {
    const e = [];
    if (!object(value))
        return { valid: false, errors: ["$: must be an object"] };
    strict(value, allowed.root, "$", e);
    scan(value, "$", e);
    if (value.schema_version !== "1.0")
        e.push("$.schema_version: must equal 1.0");
    if (!object(value.study))
        e.push("$.study: must be an object");
    else {
        strict(value.study, allowed.study, "$.study", e);
        if (value.study.anonymous !== true)
            e.push("$.study.anonymous: must be true");
        if (value.study.direct_identifiers_collected !== false)
            e.push("$.study.direct_identifiers_collected: must be false");
        if (!object(value.study.protocol))
            e.push("$.study.protocol: required");
        else {
            strict(value.study.protocol, allowed.protocol, "$.study.protocol", e);
            if (value.study.protocol.version !== protocolIdentity.version)
                e.push("$.study.protocol.version: must equal canonical version");
            if (value.study.protocol.sha256 !== protocolIdentity.sha256)
                e.push("$.study.protocol.sha256: must equal canonical SHA-256");
        }
    }
    if (!Array.isArray(value.sessions))
        e.push("$.sessions: must be an array");
    else {
        if (value.sessions.length < 8)
            e.push("$.sessions: must contain at least 8 anonymous sessions");
        const ids = new Set();
        value.sessions.forEach((raw, i) => {
            const p = "$.sessions[" + i + "]";
            if (!object(raw)) {
                e.push(p + ": must be an object");
                return;
            }
            strict(raw, allowed.session, p, e);
            if (typeof raw.session_id !== "string" || !/^anon-[a-z0-9-]{4,64}$/.test(raw.session_id))
                e.push(p + ".session_id: must be an opaque anon-* token");
            else if (ids.has(raw.session_id))
                e.push(p + ".session_id: duplicate session ID");
            else
                ids.add(raw.session_id);
            if (!["developer", "nonexpert"].includes(String(raw.cohort)))
                e.push(p + ".cohort: invalid");
            if (typeof raw.synthetic !== "boolean")
                e.push(p + ".synthetic: must be boolean");
            let consentDate = null;
            if (!object(raw.consent))
                e.push(p + ".consent: required");
            else {
                strict(raw.consent, allowed.consent, p + ".consent", e);
                for (const k of ["informed", "recorded", "withdrawal_explained"])
                    if (raw.consent[k] !== true)
                        e.push(p + ".consent." + k + ": must be true");
                if (!timestamp(raw.consent.consented_at))
                    e.push(p + ".consent.consented_at: must be an RFC 3339 UTC timestamp");
                else {
                    consentDate = Date.parse(String(raw.consent.consented_at));
                    if (consentDate > Date.now())
                        e.push(p + ".consent.consented_at: must not be in the future");
                }
            }
            if (!object(raw.retention))
                e.push(p + ".retention: required");
            else {
                strict(raw.retention, allowed.retention, p + ".retention", e);
                text(raw.retention.policy_version, p + ".retention.policy_version", e, 1, 40);
                if (!date(raw.retention.delete_after))
                    e.push(p + ".retention.delete_after: must be YYYY-MM-DD");
                else if (consentDate !== null) {
                    const start = new Date(consentDate), day = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()), days = (Date.parse(String(raw.retention.delete_after) + "T00:00:00Z") - day) / 86400000;
                    if (days < 0)
                        e.push(p + ".retention.delete_after: before consent date");
                    if (days > 90)
                        e.push(p + ".retention.delete_after: more than 90 days after consent");
                }
            }
            if (!object(raw.facilitator))
                e.push(p + ".facilitator: required");
            else {
                strict(raw.facilitator, allowed.facilitator, p + ".facilitator", e);
                if (raw.facilitator.script_version !== protocolIdentity.version)
                    e.push(p + ".facilitator.script_version: must equal canonical protocol version");
                if (raw.facilitator.neutral_prompts_only !== true)
                    e.push(p + ".facilitator.neutral_prompts_only: must be true");
            }
            const seen = new Set();
            if (!Array.isArray(raw.tasks) || raw.tasks.length !== 3)
                e.push(p + ".tasks: must contain exactly 3 tasks");
            else
                raw.tasks.forEach((task, j) => { const q = p + ".tasks[" + j + "]"; if (!object(task)) {
                    e.push(q + ": must be an object");
                    return;
                } strict(task, allowed.task, q, e); const spec = typeof task.task_id === "string" ? canonical.get(task.task_id) : undefined; if (!spec)
                    e.push(q + ".task_id: is not canonical");
                else {
                    if (seen.has(spec.id))
                        e.push(q + ".task_id: duplicate task");
                    seen.add(spec.id);
                    if (task.journey !== spec.journey)
                        e.push(q + ".journey: must match canonical task");
                    if (task.expected_decision !== spec.expected_decision)
                        e.push(q + ".expected_decision: must match canonical task and cannot be self-declared");
                } if (typeof task.completed_unassisted !== "boolean")
                    e.push(q + ".completed_unassisted: must be boolean"); if (!finite(task.time_to_first_candidate_seconds))
                    e.push(q + ".time_to_first_candidate_seconds: invalid"); if (!Number.isInteger(task.facilitator_interventions) || Number(task.facilitator_interventions) < 0)
                    e.push(q + ".facilitator_interventions: invalid");
                else if (task.completed_unassisted === true && task.facilitator_interventions !== 0)
                    e.push(q + ".completed_unassisted: cannot be true when facilitator_interventions is nonzero"); if (!DECISIONS.includes(task.selected_decision))
                    e.push(q + ".selected_decision: invalid"); if (!Number.isInteger(task.decision_confidence) || Number(task.decision_confidence) < 1 || Number(task.decision_confidence) > 5)
                    e.push(q + ".decision_confidence: must be 1..5"); if (!Array.isArray(task.missing_evidence_identified) || !task.missing_evidence_identified.every(x => typeof x === "string" && x.trim()))
                    e.push(q + ".missing_evidence_identified: invalid"); const regression = spec?.journey === "evaluation-regression-report"; if (regression ? (!finite(task.highest_regression_time_seconds) || typeof task.highest_regression_accurate !== "boolean") : (task.highest_regression_time_seconds !== null || task.highest_regression_accurate !== null))
                    e.push(q + ": highest-regression fields belong only to evaluation-regression-report"); });
            for (const j of JOURNEYS)
                if (![...seen].some(id => canonical.get(id)?.journey === j))
                    e.push(p + ".tasks: missing golden journey " + j);
            if (!Array.isArray(raw.findings))
                e.push(p + ".findings: must be an array");
            else
                raw.findings.forEach((f, j) => { const q = p + ".findings[" + j + "]"; if (!object(f)) {
                    e.push(q + ": must be an object");
                    return;
                } strict(f, allowed.finding, q, e); if (typeof f.code !== "string" || !/^DC-[A-Z0-9-]{2,30}$/.test(f.code))
                    e.push(q + ".code: invalid"); if (!SEVERITIES.includes(f.severity))
                    e.push(q + ".severity: invalid"); if (!["comprehension", "productivity", "missing-evidence", "workflow"].includes(String(f.classification)))
                    e.push(q + ".classification: invalid"); text(f.summary, q + ".summary", e, 8); evidence(f.evidence, q + ".evidence", e); });
        });
    }
    return e.length ? { valid: false, errors: e } : { valid: true, errors: [], input: value };
}
function median(xs) { const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function command(f) { const priority = f.severity === "P0" ? 0 : 1; return 'bd create --type bug --priority ' + priority + ' --title "Decision research ' + f.severity + ': ' + f.code + '" --description "Review structured evidence in the decision-comprehension report."'; }
export function analyzeDecisionResearch(value) { const c = validateDecisionResearch(value); if (!c.valid)
    throw new Error(c.errors.join("\n")); const input = c.input, sessions = input.sessions.filter(s => !s.synthetic), tasks = sessions.flatMap(s => s.tasks), reg = tasks.filter(t => t.journey === "evaluation-regression-report"), findings = sessions.flatMap(s => s.findings), blockers = findings.filter(f => f.severity === "P0" || f.severity === "P1"), ratio = (n, d) => d ? n / d : 0, byCohort = Object.fromEntries(["developer", "nonexpert"].map(x => [x, sessions.filter(s => s.cohort === x).length])), byJourney = Object.fromEntries(JOURNEYS.map(j => [j, Object.fromEntries(["developer", "nonexpert"].map(c => [c, sessions.filter(s => s.cohort === c && s.tasks.some(t => t.journey === j)).length]))])), byDecision = Object.fromEntries(DECISIONS.map(d => [d, tasks.filter(t => canonical.get(t.task_id)?.expected_decision === d).length])), completion = ratio(tasks.filter(t => t.completed_unassisted && t.facilitator_interventions === 0).length, tasks.length), accuracy = ratio(tasks.filter(t => t.selected_decision === canonical.get(t.task_id)?.expected_decision).length, tasks.length), candidate = tasks.map(t => t.time_to_first_candidate_seconds), regTimes = reg.map(t => t.highest_regression_time_seconds), gates = []; const gate = (id, passed, actual, required) => gates.push({ id, passed, severity: passed ? "info" : "blocking", classification: "research-gate", actual, required, evidence: { source: "validated non-synthetic session records", session_count: sessions.length } }); gate("evidence-session-count", sessions.length >= 8, sessions.length, ">=8"); gate("unassisted-completion", completion >= .8, completion, ">=0.80"); gate("decision-accuracy", accuracy >= .9, accuracy, ">=0.90"); gate("median-highest-severity-regression", regTimes.length > 0 && median(regTimes) <= 120, regTimes.length ? median(regTimes) : null, "<=120 seconds"); gate("cohort-and-golden-journey-coverage", ["developer", "nonexpert"].every(c => JOURNEYS.every(j => byJourney[j][c] > 0)), byJourney, "every golden journey in both cohorts"); gate("decision-category-coverage", DECISIONS.every(d => byDecision[d] > 0), byDecision, "validation/evaluation/blocked/approval"); gate("unresolved-p0-p1", blockers.length === 0, blockers.map(f => f.code), "none"); const pass = gates.every(g => g.passed); return { schema_version: "1.0", protocol: protocolIdentity, status: pass ? "pass" : "blocked", evidence: { session_count: sessions.length, synthetic_sessions_excluded: input.sessions.length - sessions.length, task_count: tasks.length, notice: "Synthetic fixtures are validator data, not research evidence." }, metrics: { unassisted_completion_rate: completion, decision_accuracy: accuracy, decision_confidence_mean: tasks.length ? tasks.reduce((n, t) => n + t.decision_confidence, 0) / tasks.length : null, median_highest_severity_regression_seconds: regTimes.length ? median(regTimes) : null, median_time_to_first_candidate_seconds: candidate.length ? median(candidate) : null, highest_regression_accuracy: ratio(reg.filter(t => t.highest_regression_accurate).length, reg.length), facilitator_interventions: tasks.reduce((n, t) => n + t.facilitator_interventions, 0) }, coverage: { cohorts: byCohort, golden_journeys_by_cohort: byJourney, expected_decision_categories: byDecision }, research_findings: findings.map(f => ({ ...f, synthetic: false })), gate_findings: gates, suggested_bd_commands: blockers.sort((a, b) => a.severity.localeCompare(b.severity) || a.code.localeCompare(b.code)).map(command), commands_executed: false }; }
export function analyzeDecisionResearchFile(path) { return analyzeDecisionResearch(JSON.parse(readFileSync(resolve(path), "utf8"))); }
