#!/usr/bin/env node
/** Evidence-bound, approval-gated Skill improvement state machine. */
import { closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { analyzeEvaluation } from "./analyze_evaluation.js";
import { validateEvaluationReceipt } from "./validate_evaluation_receipt.js";
import { artifactHash, listRunDirs, validateExecutionEvidence } from "./evaluation_provenance.js";
import { sourceHash } from "./verify_skill_gates.js";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
function stable(value, seen = new Set()) { if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value); if (typeof value === "number") {
    if (!Number.isFinite(value))
        throw new Error("non-finite JSON number rejected");
    return JSON.stringify(value);
} if (typeof value !== "object" || seen.has(value))
    throw new Error("only finite acyclic JSON is accepted"); seen.add(value); const out = Array.isArray(value) ? "[" + value.map(v => stable(v, seen)).join(",") + "]" : "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + stable(value[k], seen)).join(",") + "}"; seen.delete(value); return out; }
const objectHash = (value) => sha(stable(value));
function signed(value, key = "integrity_sha256") { const body = { ...value }; delete body[key]; return { ...body, [key]: objectHash(body) }; }
function verifySigned(value, label, key = "integrity_sha256") { const body = { ...value }, actual = body[key]; delete body[key]; if (actual !== objectHash(body))
    throw new Error(label + " integrity mismatch"); }
function canonical(path) { const absolute = resolve(path); return existsSync(absolute) ? realpathSync(absolute) : realpathSync(dirname(absolute)) + sep + basename(absolute); }
function within(root, path) { const rel = relative(root, path); return rel === "" || (!rel.startsWith(".." + sep) && rel !== ".."); }
function assertSeparate(loop, skill) { if (within(skill, loop) || within(loop, skill))
    throw new Error("loop workspace and user-owned Skill must be separate"); }
function writeNew(path, value) { mkdirSync(dirname(path), { recursive: true }); const fd = openSync(path, "wx"); try {
    writeFileSync(fd, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
}
finally {
    closeSync(fd);
} }
function copyTree(source, target) { mkdirSync(target, { recursive: false }); for (const name of readdirSync(source)) {
    const from = join(source, name), to = join(target, name), s = lstatSync(from);
    if (s.isSymbolicLink())
        throw new Error(`symbolic links are not allowed in Skill snapshots: ${from}`);
    if (s.isDirectory())
        copyTree(from, to);
    else if (s.isFile())
        copyFileSync(from, to);
} }
function files(root, current = root) { return readdirSync(current).sort().flatMap(name => { const p = join(current, name), s = lstatSync(p); if (s.isSymbolicLink())
    throw new Error(`symbolic links are not allowed: ${p}`); return s.isDirectory() ? files(root, p) : [relative(root, p)]; }); }
function treeHash(root) { return sha(files(root).map(p => `${p}\0${sha(readFileSync(join(root, p)))}\n`).join("")); }
function safeRelative(value) { if (!value || isAbsolute(value) || value.split(/[\\/]/).includes(".."))
    throw new Error(`unsafe change path: ${value}`); return value.replaceAll("\\", "/"); }
function acquire(root) { mkdirSync(root, { recursive: true }); const p = join(root, ".improvement.lock"); let fd; try {
    fd = openSync(p, "wx");
}
catch {
    throw new Error("improvement loop is locked by another process");
} writeFileSync(fd, `${process.pid}\n`); return () => { closeSync(fd); rmSync(p, { force: true }); }; }
function benchmarkTradeoffs(benchmark, cost) { const summary = benchmark?.run_summary ?? {}, primary = summary.with_skill ?? Object.values(summary).find((x) => x?.pass_rate) ?? {}, delta = summary.delta ?? {}; return { effectiveness: { mean: primary?.pass_rate?.mean ?? null, delta: delta.pass_rate ?? null, paired_confidence_interval_95: delta?.paired?.pass_rate?.confidence_interval_95 ?? null }, variance: { pass_rate_stddev: primary?.pass_rate?.stddev ?? null, sample_count: primary?.pass_rate?.count ?? 0 }, time: { mean_seconds: primary?.time_seconds?.mean ?? null, delta_seconds: delta.time_seconds ?? null }, tokens: { mean: primary?.tokens?.mean ?? null, delta: delta.tokens ?? null }, cost: { usd: cost, unavailable_reason: cost === null ? "cost was not reported by the execution backend" : null } }; }
function failureId(f, index) { return `failure-${index + 1}-${sha(JSON.stringify([f.eval, f.configuration, f.assertion, f.evidence])).slice(0, 12)}`; }
function statePath(root) { return join(root, "state.json"); }
function saveState(root, state) { state = signed(state, "state_integrity_sha256"); const tmp = join(root, `.state-${randomUUID()}.tmp`); writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { flag: "wx" }); renameSync(tmp, statePath(root)); }
function scenarioIds(value) { const list = value?.evals ?? value?.scenarios ?? []; return list.map((x) => String(x.id ?? x.eval_id ?? x.name)); }
function loadState(root) { const state = readJson(statePath(root)); verifySigned(state, "state", "state_integrity_sha256"); return state; }
function finite(value, label) { if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error(label + " must be finite and non-negative"); return value; }
function budgetExhaustion(state, action, extraTokens = 0, extraCost = 0) { finite(state.usage.total_tokens, "usage.total_tokens"); finite(state.usage.total_cost_usd, "usage.total_cost_usd"); finite(extraTokens, action + " tokens"); finite(extraCost, action + " cost"); if (state.next_iteration > finite(state.budget.max_iterations, "budget.max_iterations"))
    return "iteration budget exhausted before " + action; if (state.budget.max_tokens !== null && state.usage.total_tokens + extraTokens >= finite(state.budget.max_tokens, "budget.max_tokens"))
    return "total token budget exhausted before " + action; if (state.budget.max_cost_usd !== null && state.usage.total_cost_usd + extraCost >= finite(state.budget.max_cost_usd, "budget.max_cost_usd"))
    return "cost budget exhausted before " + action; return null; }
function persistBudgetStop(root, state, action, extraTokens = 0, extraCost = 0) { const detail = budgetExhaustion(state, action, extraTokens, extraCost); if (!detail)
    return false; state.stop = stop("budget-exhaustion", detail); move(state, state.status, "stopped"); saveState(root, state); return true; }
function requireState(state, wanted, action) { if (state.status !== wanted)
    throw new Error(action + " requires state " + wanted + "; current state is " + state.status); }
function locateScenarios(workspace, skill) { for (const p of [join(workspace, "frozen-plan.json"), join(workspace, "evals.json"), join(skill, "evals", "evals.json")])
    if (existsSync(p))
        return { path: p, document: readJson(p) }; return { path: null, document: { evals: [] } }; }
function exactObject(v, required, optional, label) { if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error(label + " must be an object"); const allowed = new Set([...required, ...optional]); for (const k of required)
    if (!Object.hasOwn(v, k))
        throw new Error(label + "." + k + " is required"); for (const k of Object.keys(v))
    if (!allowed.has(k))
        throw new Error(label + "." + k + " is not allowed"); }
function validateChanges(input, failures, sourceHashValue, knownScenarios) {
    exactObject(input, ["builder_actor", "changes", "regression_scenarios", "challenge"], [], "proposal");
    if (typeof input.builder_actor !== "string" || !input.builder_actor.trim() || !Array.isArray(input.changes) || !input.changes.length)
        throw new Error("proposal requires builder_actor and non-empty changes");
    const known = new Map(failures.map((f, i) => [failureId(f, i), f]));
    for (const c of input.changes) {
        exactObject(c, ["path", "before", "after", "evidence_ids", "pattern", "rationale"], ["pattern_exception"], "change");
        safeRelative(c.path);
        if (typeof c.before !== "string" || typeof c.after !== "string" || c.before === c.after)
            throw new Error("each change requires different exact before and after text");
        if (!Array.isArray(c.evidence_ids) || !c.evidence_ids.length || c.evidence_ids.some((id) => !known.has(id)))
            throw new Error("each change must cite failed evidence from this analysis");
        const recommended = new Set(c.evidence_ids.flatMap((id) => known.get(id)?.recommended_patterns ?? []));
        if (!recommended.has(c.pattern)) {
            exactObject(c.pattern_exception, ["reason", "challenge_objection_id"], [], "pattern_exception");
            if (typeof c.pattern_exception.reason !== "string" || c.pattern_exception.reason.trim().length < 12)
                throw new Error("non-recommended pattern requires a substantive exception");
        }
        if (typeof c.rationale !== "string" || c.rationale.trim().length < 12)
            throw new Error("each change requires a substantive mechanism rationale");
    }
    if (!Array.isArray(input.regression_scenarios) || !input.regression_scenarios.length)
        throw new Error("proposal must add at least one regression scenario");
    const ids = new Set();
    for (const r of input.regression_scenarios) {
        exactObject(r, ["id", "name", "prompt", "assertions", "frozen", "provenance", "canonical_content_sha256"], [], "regression");
        if (typeof r.id !== "string" || !r.id || knownScenarios.has(r.id) || ids.has(r.id))
            throw new Error("regression scenario IDs must be unique and new");
        ids.add(r.id);
        if (r.frozen !== true || typeof r.prompt !== "string" || r.prompt.trim().length < 20 || !Array.isArray(r.assertions) || !r.assertions.length)
            throw new Error("regression scenarios must be strict and frozen");
        exactObject(r.provenance, ["source_failure_ids", "actor", "branch", "created_at"], [], "regression.provenance");
        if (!r.provenance.actor || !r.provenance.branch || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(r.provenance.created_at) || !Array.isArray(r.provenance.source_failure_ids) || r.provenance.source_failure_ids.some((id) => !known.has(id)))
            throw new Error("regression provenance must bind failed evidence, actor, branch, and UTC time");
        const body = { ...r };
        delete body.canonical_content_sha256;
        if (r.canonical_content_sha256 !== objectHash(body))
            throw new Error("regression scenario integrity mismatch: " + r.id);
    }
    const proposalBody = { builder_actor: input.builder_actor, changes: input.changes, regression_scenarios: input.regression_scenarios }, proposalHash = objectHash(proposalBody), ch = input.challenge;
    exactObject(ch, ["actor", "branch", "proposal_sha256", "source_revision_sha256", "verdict", "objections", "response", "integrity_sha256"], [], "challenge");
    verifySigned(ch, "challenge");
    if (!ch.actor || !ch.branch || ch.actor === input.builder_actor || ch.branch === "builder")
        throw new Error("challenge requires independent actor and branch provenance");
    if (ch.proposal_sha256 !== proposalHash || ch.source_revision_sha256 !== sourceHashValue)
        throw new Error("challenge must bind proposal and source revision");
    if (ch.verdict !== "accept" || !Array.isArray(ch.objections) || !ch.objections.length)
        throw new Error("challenge must accept after substantive objection");
    const objections = new Set();
    for (const o of ch.objections) {
        exactObject(o, ["id", "statement"], [], "objection");
        if (!o.id || typeof o.statement !== "string" || o.statement.trim().length < 12 || objections.has(o.id))
            throw new Error("challenge objections must be unique and substantive");
        objections.add(o.id);
    }
    exactObject(ch.response, ["actor", "items"], [], "challenge.response");
    if (!ch.response.actor || ch.response.actor === ch.actor || !Array.isArray(ch.response.items))
        throw new Error("challenge response must have independent response provenance");
    for (const item of ch.response.items) {
        exactObject(item, ["objection_id", "disposition", "rationale"], [], "challenge.response item");
        if (!objections.delete(item.objection_id) || !["accepted", "resolved", "rejected"].includes(item.disposition) || typeof item.rationale !== "string" || item.rationale.trim().length < 12)
            throw new Error("each objection requires one substantive disposition");
    }
    if (objections.size)
        throw new Error("challenge response omitted objections");
    for (const c of input.changes)
        if (c.pattern_exception) {
            const objectionId = c.pattern_exception.challenge_objection_id, response = ch.response.items.find((item) => item.objection_id === objectionId);
            if (!ch.objections.some((o) => o.id === objectionId) || !response || !["accepted", "resolved"].includes(response.disposition))
                throw new Error("pattern exception must link to an accepted or resolved objection response");
        }
    return { builder_actor: input.builder_actor, changes: input.changes, regression_scenarios: input.regression_scenarios, challenge: ch, proposal_content_sha256: proposalHash };
}
function preview(snapshot, changes) { return changes.map(c => { const path = safeRelative(c.path), full = join(snapshot, path); if (!within(snapshot, canonical(full)) || !existsSync(full) || lstatSync(full).isSymbolicLink())
    throw new Error(`change target is missing or unsafe: ${path}`); const content = readFileSync(full, "utf8"), matches = content.split(c.before).length - 1; if (matches !== 1)
    throw new Error(`change before text must match exactly once: ${path}`); return { path, before: c.before, after: c.after, evidence_ids: c.evidence_ids, pattern: c.pattern, rationale: c.rationale }; }); }
function stop(reason, detail) { return { stop: true, reason, detail }; }
function missingCapabilityFailures(failures) { return failures.filter(f => { const text = String(f.assertion) + " " + String(f.evidence); return /(?:tool|dependency|package|mcp|runner|browser|network|filesystem|capability)/i.test(text) && /(?:unavailable|not available|not installed|missing|absent|cannot access|can(?:not|'t) use|no access|unsupported|disabled)/i.test(text); }); }
function validateResultSet(resultDir, pending, required) {
    const validation = validateEvaluationReceipt(resultDir);
    if (validation.status !== "complete")
        throw new Error("evaluation receipt incomplete: " + validation.missing.join(", "));
    const receipt = readJson(join(resultDir, "receipt.json")), benchmark = readJson(join(resultDir, "benchmark.json")), source = pending.source_sha256;
    if (receipt.status !== "pass" || receipt.source_sha256 !== source || receipt.evaluation_provenance?.skill_source_sha256 !== source)
        throw new Error("evaluation receipt must pass and bind the approved pending source");
    if (benchmark.metadata?.source_sha256 !== source)
        throw new Error("benchmark must bind the approved pending source");
    const evidence = validateExecutionEvidence(resultDir, { skill_source_sha256: source });
    if (evidence.status !== "complete")
        throw new Error("execution evidence invalid: " + evidence.errors.join("; "));
    if (receipt.evaluation_provenance?.execution_evidence_sha256 !== evidence.evidence_sha256 || benchmark.metadata?.execution_evidence_sha256 !== evidence.evidence_sha256)
        throw new Error("receipt and benchmark must bind validated execution evidence");
    const ids = readdirSync(resultDir).filter(x => x.startsWith("eval-") && statSync(join(resultDir, x)).isDirectory()).map(x => String(readJson(join(resultDir, x, "eval_metadata.json")).eval_id)).sort(), wanted = [...required].sort();
    if (new Set(ids).size !== ids.length || stable(ids) !== stable(wanted))
        throw new Error("result scenario IDs must exactly equal preserved plus approved regressions");
    if (stable((receipt.scenario_ids ?? []).map(String).sort()) !== stable(wanted) || stable((benchmark.metadata?.scenario_ids ?? []).map(String).sort()) !== stable(wanted))
        throw new Error("receipt and benchmark must bind exact scenario IDs");
    const runs = listRunDirs(resultDir);
    if (runs.length !== evidence.bindings.length || receipt.run_count !== runs.length || benchmark.metadata?.run_count !== runs.length)
        throw new Error("receipt, evidence, and benchmark run counts must agree exactly");
    let tokens = 0, cost = 0, time = 0;
    for (const run of runs) {
        const t = readJson(join(run, "timing.json"));
        tokens += finite(t.total_tokens, "timing.total_tokens");
        cost += finite(t.cost_usd, "timing.cost_usd");
        time += finite(t.total_duration_seconds, "timing.total_duration_seconds");
    }
    const summary = benchmark.run_summary?.with_skill, mean = finite(summary?.pass_rate?.mean, "effectiveness mean");
    if (mean > 1)
        throw new Error("effectiveness mean must be <= 1");
    return { scenario_ids: ids, run_count: runs.length, total_tokens: tokens, total_cost_usd: cost, receipt_sha256: artifactHash(join(resultDir, "receipt.json")), benchmark_sha256: artifactHash(join(resultDir, "benchmark.json")), evidence_sha256: evidence.evidence_sha256, tradeoffs: { effectiveness: { mean, delta: benchmark.run_summary?.delta?.pass_rate ?? null, paired_confidence_interval_95: benchmark.run_summary?.delta?.paired?.pass_rate?.confidence_interval_95 ?? null }, variance: { pass_rate_stddev: summary?.pass_rate?.stddev ?? null, sample_count: summary?.pass_rate?.count ?? 0 }, time: { total_seconds: time }, tokens: { total: tokens }, cost: { total_usd: cost } } };
}
function verifyLedger(root, state) { if (treeHash(join(root, "original")) !== state.original_tree_sha256 || sourceHash(join(root, "original")) !== state.original_source_sha256)
    throw new Error("immutable original source changed"); if (sha(readFileSync(join(root, "baseline.json"))) !== state.baseline_sha256)
    throw new Error("immutable baseline changed"); for (const [p, h] of Object.entries(state.artifacts ?? {})) {
    const full = join(root, p);
    if (!existsSync(full) || sha(readFileSync(full)) !== h)
        throw new Error("immutable ledger artifact changed: " + p);
} for (const rev of [state.active_revision, state.pending_revision].filter(Boolean))
    if (treeHash(rev.path) !== rev.tree_sha256 || sourceHash(rev.path) !== rev.source_sha256)
        throw new Error("revision source integrity mismatch"); }
function move(state, from, to, hash) { if (state.status !== from)
    throw new Error("transition " + from + " -> " + to + " requires state " + from); finite(state.budget.max_iterations, "budget.max_iterations"); finite(state.usage.total_tokens, "usage.total_tokens"); finite(state.usage.total_cost_usd, "usage.total_cost_usd"); if (state.budget.max_tokens !== null)
    finite(state.budget.max_tokens, "budget.max_tokens"); if (state.budget.max_cost_usd !== null)
    finite(state.budget.max_cost_usd, "budget.max_cost_usd"); state.transitions.push({ sequence: state.transitions.length + 1, from, to, ...(hash ? { artifact_sha256: hash } : {}) }); state.status = to; }
export function runImprovement(options) {
    const workspace = canonical(options.workspace), skill = canonical(options.skillPath), root = canonical(options.loop);
    if (!statSync(workspace).isDirectory() || !existsSync(join(skill, "SKILL.md")))
        throw new Error("evaluation workspace or Skill is invalid");
    assertSeparate(root, skill);
    const release = acquire(root);
    try {
        let state;
        if (!existsSync(statePath(root))) {
            for (const [k, v] of Object.entries({ maxIterations: options.maxIterations, maxTokens: options.maxTokens ?? 0, maxCost: options.maxCost ?? 0, target: options.target, criticalDrop: options.criticalDrop }))
                finite(v, k);
            const analysis = analyzeEvaluation(workspace, skill), original = join(root, "original"), scenarios = locateScenarios(workspace, skill);
            copyTree(skill, original);
            const baseline = signed({ artifact: "improvement-baseline", workspace_sha256: treeHash(workspace), analysis, scenario_source: scenarios.path, scenario_source_sha256: scenarios.path ? artifactHash(scenarios.path) : null, scenario_ids: scenarioIds(scenarios.document) });
            writeNew(join(root, "baseline.json"), baseline);
            writeNew(join(root, "scenarios", "preserved.json"), scenarios.document);
            state = { schema_version: "2.0", artifact: "evidence-improvement-state", status: "proposal", original_tree_sha256: treeHash(original), original_source_sha256: sourceHash(original), baseline_sha256: sha(readFileSync(join(root, "baseline.json"))), active_revision: { path: original, tree_sha256: treeHash(original), source_sha256: sourceHash(original) }, next_iteration: 1, stagnant: 0, iterations: [], regression_scenario_ids: [], transitions: [{ sequence: 1, from: "created", to: "proposal" }], artifacts: { "scenarios/preserved.json": sha(readFileSync(join(root, "scenarios", "preserved.json"))) }, usage: { total_tokens: 0, total_cost_usd: 0 }, budget: { max_iterations: options.maxIterations, max_tokens: options.maxTokens ?? null, max_cost_usd: options.maxCost ?? null }, target: options.target, critical_drop: options.criticalDrop };
            saveState(root, state);
        }
        else
            state = loadState(root);
        verifyLedger(root, state);
        const baseline = readJson(join(root, "baseline.json"));
        verifySigned(baseline, "baseline");
        if (options.cancel) {
            const from = state.status;
            state.stop = stop("user-cancellation", "Cancellation was explicitly requested.");
            state.transitions.push({ sequence: state.transitions.length + 1, from, to: "stopped" });
            state.status = "stopped";
            saveState(root, state);
            return state;
        }
        if (state.status === "stopped")
            return state;
        const missing = missingCapabilityFailures(baseline.analysis.failures);
        if (missing.length) {
            state.stop = stop("missing-capability", "Failure evidence shows an unavailable required capability: " + missing.map((f) => f.evidence || f.assertion).join("; "));
            state.missing_capability_failure_ids = missing.map((f) => failureId(f, baseline.analysis.failures.indexOf(f)));
            state.classified_failures = missing.map((f) => ({ id: failureId(f, baseline.analysis.failures.indexOf(f)), failure: f, classification: "missing-capability" }));
            move(state, state.status, "stopped");
            saveState(root, state);
            return state;
        }
        if (state.status === "results" && !options.proposal && !options.approve && !options.results) {
            if (persistBudgetStop(root, state, "next proposal"))
                return state;
            move(state, "results", "proposal");
            saveState(root, state);
        }
        if (!options.results && persistBudgetStop(root, state, options.proposal ? "proposal" : options.approve ? "approval" : "read current state"))
            return state;
        const n = state.next_iteration;
        if (options.results) {
            requireState(state, "awaiting-results", "results");
            if (!state.pending_revision || !state.approval)
                throw new Error("results require an approved pending revision");
            const approval = readJson(join(root, state.approval.path));
            verifySigned(approval, "approval");
            if (approval.plan_integrity_sha256 !== state.approval.plan_integrity_sha256 || approval.pending_revision.source_sha256 !== state.pending_revision.source_sha256)
                throw new Error("approval does not bind pending revision");
            const required = [...new Set([...baseline.scenario_ids, ...state.regression_scenario_ids, ...state.pending_regressions].map(String))], checked = validateResultSet(canonical(options.results), state.pending_revision, required);
            if (persistBudgetStop(root, state, "results", checked.total_tokens, checked.total_cost_usd))
                return state;
            const previous = state.iterations.at(-1)?.tradeoffs?.effectiveness?.mean ?? baseline.analysis.benchmark.current, delta = typeof previous === "number" ? checked.tradeoffs.effectiveness.mean - previous : null, critical = typeof previous === "number" && previous - checked.tradeoffs.effectiveness.mean >= state.critical_drop, record = signed({ artifact: "improvement-results", iteration: n, approved_plan_sha256: approval.plan_integrity_sha256, approved_revision: state.pending_revision, results_workspace: canonical(options.results), ...checked, delta_from_previous: delta });
            const rp = "iterations/iteration-" + n + ".json";
            writeNew(join(root, rp), record);
            state.artifacts[rp] = sha(readFileSync(join(root, rp)));
            state.iterations.push({ iteration: n, result_integrity_sha256: record.integrity_sha256, tradeoffs: record.tradeoffs });
            state.usage.total_tokens += checked.total_tokens;
            state.usage.total_cost_usd += checked.total_cost_usd;
            state.stagnant = delta === null || delta <= 0 ? state.stagnant + 1 : 0;
            state.regression_scenario_ids = [...new Set([...state.regression_scenario_ids, ...state.pending_regressions])];
            state.active_revision = state.pending_revision;
            delete state.pending_revision;
            delete state.pending_regressions;
            delete state.current_plan;
            delete state.approval;
            state.next_iteration = n + 1;
            move(state, "awaiting-results", "results", record.integrity_sha256);
            let reason = null;
            if (checked.tradeoffs.effectiveness.mean >= state.target)
                reason = stop("target-success", "target met");
            else if (critical)
                reason = stop("critical-regression", "critical effectiveness regression");
            else if (state.stagnant >= 2)
                reason = stop("two-stagnant-iterations", "two stagnant iterations");
            else if (state.next_iteration > state.budget.max_iterations || state.budget.max_tokens !== null && state.usage.total_tokens >= state.budget.max_tokens || state.budget.max_cost_usd !== null && state.usage.total_cost_usd >= state.budget.max_cost_usd)
                reason = stop("budget-exhaustion", "configured total budget exhausted");
            if (reason) {
                state.stop = reason;
                move(state, "results", "stopped");
            }
            saveState(root, state);
            return { ...state, last_iteration: record };
        }
        if (options.approve) {
            requireState(state, "preview", "approval");
            const plan = readJson(join(root, state.current_plan.path));
            verifySigned(plan, "plan");
            if (options.approve !== plan.integrity_sha256 || state.current_plan.integrity_sha256 !== plan.integrity_sha256)
                throw new Error("approval must bind the complete current plan hash");
            if (treeHash(state.active_revision.path) !== plan.source_revision.tree_sha256 || sourceHash(state.active_revision.path) !== plan.source_revision.source_sha256)
                throw new Error("preview source changed");
            const revision = join(root, "revisions", "iteration-" + n), tmp = join(root, "revisions", ".iteration-" + n + "-" + randomUUID());
            mkdirSync(dirname(revision), { recursive: true });
            copyTree(state.active_revision.path, tmp);
            try {
                for (const c of plan.preview) {
                    const p = join(tmp, c.path), text = readFileSync(p, "utf8");
                    if (text.split(c.before).length - 1 !== 1)
                        throw new Error("approved mutation no longer exact");
                    writeFileSync(p, text.replace(c.before, c.after));
                }
                renameSync(tmp, revision);
            }
            catch (e) {
                rmSync(tmp, { recursive: true, force: true });
                throw e;
            }
            const pending = { path: revision, tree_sha256: treeHash(revision), source_sha256: sourceHash(revision) }, approval = signed({ artifact: "improvement-approval", iteration: n, plan_integrity_sha256: plan.integrity_sha256, proposal_content_sha256: plan.proposal_content_sha256, source_revision: plan.source_revision, pending_revision: pending, challenge_integrity_sha256: plan.challenge.integrity_sha256, regressions_sha256: objectHash(plan.regression_scenarios) }), ap = "approvals/iteration-" + n + ".json";
            writeNew(join(root, ap), approval);
            state.artifacts[ap] = sha(readFileSync(join(root, ap)));
            move(state, "preview", "approval", approval.integrity_sha256);
            state.approval = { path: ap, plan_integrity_sha256: plan.integrity_sha256 };
            state.pending_revision = pending;
            state.pending_regressions = plan.regression_scenario_ids;
            move(state, "approval", "awaiting-results", pending.tree_sha256);
            saveState(root, state);
            return { ...state, approved_revision: revision, approval };
        }
        if (options.proposal) {
            requireState(state, "proposal", "preview");
            const known = new Set([...baseline.scenario_ids, ...state.regression_scenario_ids].map(String)), input = validateChanges(readJson(canonical(options.proposal)), baseline.analysis.failures, state.active_revision.source_sha256, known), exact = preview(state.active_revision.path, input.changes), plan = signed({ schema_version: "2.0", artifact: "improvement-plan", status: "preview", iteration: n, source_revision: state.active_revision, evidence_source: { path: "baseline.json", sha256: state.baseline_sha256 }, proposal_content_sha256: input.proposal_content_sha256, builder_actor: input.builder_actor, preview: exact, challenge: input.challenge, regression_scenarios: input.regression_scenarios, regression_scenario_ids: scenarioIds({ evals: input.regression_scenarios }), notice: "Preview only; approve this complete plan integrity hash." }), pp = "plans/iteration-" + n + ".json";
            writeNew(join(root, pp), plan);
            state.artifacts[pp] = sha(readFileSync(join(root, pp)));
            state.current_plan = { path: pp, integrity_sha256: plan.integrity_sha256 };
            move(state, "proposal", "preview", plan.integrity_sha256);
            saveState(root, state);
            return plan;
        }
        if (state.status === "proposal")
            return { ...state, classified_failures: baseline.analysis.failures.map((f, i) => ({ id: failureId(f, i), failure: f, mechanism: { category: f.category, recommended_patterns: f.recommended_patterns } })), next_action: "Submit a source-bound independently challenged proposal." };
        if (state.status === "preview")
            return { ...state, next_action: "Approve complete plan hash " + state.current_plan.integrity_sha256 };
        return { ...state, next_action: "Run exact scenarios against approved pending revision and submit source-bound results." };
    }
    finally {
        release();
    }
}
export function main() { try {
    const { positionals, values } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: { "skill-path": { type: "string" }, loop: { type: "string" }, proposal: { type: "string" }, approve: { type: "string" }, results: { type: "string" }, cancel: { type: "boolean" }, "max-iterations": { type: "string", default: "5" }, "max-tokens": { type: "string" }, "max-cost": { type: "string" }, target: { type: "string", default: "1" }, "critical-drop": { type: "string", default: "0.2" } } });
    if (!positionals[0] || !values["skill-path"] || !values.loop)
        throw new Error("usage: evidence-loop <evaluation-workspace> --skill-path <dir> --loop <dir> [--proposal file|--approve id|--results dir|--cancel]");
    const num = (v, n) => { const x = Number(v); if (!Number.isFinite(x) || x < 0)
        throw new Error(`${n} must be a non-negative number`); return x; };
    const result = runImprovement({ workspace: positionals[0], skillPath: values["skill-path"], loop: values.loop, proposal: values.proposal, approve: values.approve, results: values.results, cancel: values.cancel, maxIterations: num(values["max-iterations"], "max-iterations"), maxTokens: values["max-tokens"] !== undefined ? num(values["max-tokens"], "max-tokens") : undefined, maxCost: values["max-cost"] !== undefined ? num(values["max-cost"], "max-cost") : undefined, target: num(values.target, "target"), criticalDrop: num(values["critical-drop"], "critical-drop") });
    console.log(JSON.stringify(result, null, 2));
}
catch (e) {
    console.error(`evidence_improvement: ${e.message}`);
    process.exit(2);
} }
const invoked = process.argv[1] ? resolve(process.argv[1]) : null;
if (!import.meta.url.includes("/$bunfs/") && invoked && fileURLToPath(import.meta.url) === invoked)
    main();
