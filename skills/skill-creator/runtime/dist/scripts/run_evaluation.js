#!/usr/bin/env node
/** Current-session activation evaluation. No model or agent is launched here. */
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve, parse } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { parseSkillMd } from "./utils.js";
import { acquireDirectoryLockSync, durableAtomicWrite } from "./durable_file.js";
import { sessionEvaluationHtml } from "./evaluation_report.js";
import { summarizeTriggerClassifications } from "./trigger_evaluation.js";
const outcomes = ["triggered", "not-triggered", "timeout", "host-failure", "malformed-stream", "unsupported-telemetry"];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export function regularPath(path, directory = false) {
    const absolute = resolve(path), root = parse(absolute).root;
    let current = root;
    for (const part of absolute.slice(root.length).split(/[\\/]/).filter(Boolean)) {
        current = join(current, part);
        if (!existsSync(current)) {
            try {
                lstatSync(current);
            }
            catch {
                continue;
            }
        }
        const stat = lstatSync(current);
        if (stat.isSymbolicLink())
            throw new Error("Symbolic links are not supported: " + current);
        if (current !== absolute && !stat.isDirectory())
            throw new Error("Parent must be a regular directory: " + current);
        if (current === absolute && (directory ? !stat.isDirectory() : !stat.isFile()))
            throw new Error("Expected regular " + (directory ? "directory: " : "file: ") + current);
    }
}
export function read(path) { regularPath(path); const bytes = readFileSync(path); if (bytes.length > 8 * 1024 * 1024)
    throw new Error("Input exceeds 8 MiB: " + path); return bytes; }
function cases(value) {
    if (!Array.isArray(value) || !value.length || value.length > 10000)
        throw new Error("eval.json must be a nonempty array of {query, should_trigger} (at most 10000 cases)");
    return value.map((v, i) => { if (!object(v) || typeof v.query !== "string" || !v.query.trim() || typeof v.should_trigger !== "boolean")
        throw new Error("Invalid query/should_trigger at case " + i); return { query: v.query, should_trigger: v.should_trigger }; });
}
function settings(runs, threshold) { if (!Number.isSafeInteger(runs) || runs < 1 || runs > 100)
    throw new Error("runs-per-query must be an integer from 1 to 100"); if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
    throw new Error("trigger-threshold must be between 0 and 1"); }
function observations(value, run) {
    if (!Array.isArray(value))
        throw new Error("Observations must be an array");
    const seen = new Set();
    return value.map(v => {
        if (!object(v) || !Number.isSafeInteger(v.case_index) || Number(v.case_index) < 0 || Number(v.case_index) >= run.cases.length || !Number.isSafeInteger(v.repetition) || Number(v.repetition) < 1 || Number(v.repetition) > run.runs_per_query || !outcomes.includes(v.outcome))
            throw new Error("Invalid observation case_index, repetition or outcome");
        if (!object(v.evidence) || typeof v.evidence.source !== "string" || !v.evidence.source.trim() || typeof v.evidence.reference !== "string" || !v.evidence.reference.trim())
            throw new Error("Observation requires host evidence source and reference; candidate self-report is not evidence");
        const key = v.case_index + ":" + v.repetition;
        if (seen.has(key))
            throw new Error("Duplicate observation: " + key);
        seen.add(key);
        return { case_index: Number(v.case_index), repetition: Number(v.repetition), outcome: v.outcome, evidence: { source: v.evidence.source, reference: v.evidence.reference } };
    });
}
function load(path) {
    const value = JSON.parse(read(path).toString("utf8"));
    if (!object(value) || value.schema_version !== "agent-activation-v1" || typeof value.run_id !== "string" || typeof value.skill_path !== "string" || typeof value.eval_set !== "string" || typeof value.skill_md_sha256 !== "string" || typeof value.eval_sha256 !== "string" || typeof value.skill_name !== "string" || typeof value.description !== "string" || typeof value.runs_per_query !== "number" || typeof value.trigger_threshold !== "number")
        throw new Error("Invalid run.json");
    settings(value.runs_per_query, value.trigger_threshold);
    const run = { ...value, cases: cases(value.cases) };
    run.observations = observations(value.observations, run);
    return run;
}
function result(run, output) {
    const pending = [];
    const results = run.cases.map((item, case_index) => {
        const observed = run.observations.filter(o => o.case_index === case_index);
        for (let repetition = 1; repetition <= run.runs_per_query; repetition++)
            if (!observed.some(o => o.repetition === repetition))
                pending.push({ case_index, repetition, query: item.query });
        const classes = observed.map(o => o.outcome === "triggered" ? true : o.outcome === "not-triggered" ? false : null);
        return { ...item, ...summarizeTriggerClassifications(classes, item.should_trigger, run.trigger_threshold, run.runs_per_query), outcomes: observed };
    });
    const passed = results.filter(r => r.pass === true).length, failed = results.filter(r => r.pass === false).length;
    return { schema_version: run.schema_version, run_id: run.run_id, output, skill_path: run.skill_path, eval_set: run.eval_set, skill_name: run.skill_name, description: run.description, status: pending.length ? "awaiting-observations" : results.some(r => r.pass === null) ? "inconclusive" : "complete", runs_per_query: run.runs_per_query, trigger_threshold: run.trigger_threshold, pending, results, summary: { total: results.length, passed, failed, inconclusive: results.length - passed - failed }, evidence_authority: "coordinator-reported host observations; references are not authenticated", input_binding: "SKILL.md and eval.json bytes only; resources and ambient host context are not frozen" };
}
export function runEvaluation(options) {
    const skill = resolve(options.skillPath), evalSet = resolve(options.evalSet ?? join(skill, "eval.json")), skillBytes = read(join(skill, "SKILL.md")), evalBytes = read(evalSet), items = cases(JSON.parse(evalBytes.toString("utf8"))), metadata = parseSkillMd(skill);
    if (options.observations && !options.resume)
        throw new Error("--observations requires --resume --output <run-directory>");
    if (options.resume && !options.output)
        throw new Error("--resume requires --output <run-directory>");
    const now = new Date(), date = [now.getDate(), now.getMonth() + 1, now.getFullYear() % 100].map(n => String(n).padStart(2, "0")).join("-"), id = randomUUID(), output = resolve(options.output ?? join(skill, "eval_result", date + "-" + id));
    regularPath(output, true);
    if (!options.resume && existsSync(output))
        throw new Error("Output already exists; use --resume for its bound run: " + output);
    if (options.resume && !existsSync(output))
        throw new Error("Run directory does not exist: " + output);
    let run;
    if (!options.resume) {
        settings(options.runsPerQuery ?? 3, options.triggerThreshold ?? .5);
        run = { schema_version: "agent-activation-v1", run_id: id, skill_path: skill, eval_set: evalSet, skill_md_sha256: hash(skillBytes), eval_sha256: hash(evalBytes), skill_name: metadata.name, description: metadata.description, runs_per_query: options.runsPerQuery ?? 3, trigger_threshold: options.triggerThreshold ?? .5, cases: items, observations: [] };
        mkdirSync(dirname(output), { recursive: true });
        mkdirSync(output, { mode: 0o700 });
    }
    else
        run = load(join(output, "run.json"));
    regularPath(join(output, ".lock"), true);
    const release = acquireDirectoryLockSync(join(output, ".lock"));
    try {
        if (options.resume)
            run = load(join(output, "run.json"));
        if (run.skill_path !== skill || run.eval_set !== evalSet || run.skill_md_sha256 !== hash(skillBytes) || run.eval_sha256 !== hash(evalBytes) || JSON.stringify(run.cases) !== JSON.stringify(items))
            throw new Error("Input drift: use a new evaluation run");
        if (options.runsPerQuery !== undefined && options.runsPerQuery !== run.runs_per_query || options.triggerThreshold !== undefined && options.triggerThreshold !== run.trigger_threshold)
            throw new Error("Run settings are frozen; use a new evaluation run");
        if (options.observations) {
            const imported = observations(JSON.parse(read(resolve(options.observations)).toString("utf8")), run);
            run.observations = observations([...run.observations, ...imported], run).sort((a, b) => a.case_index - b.case_index || a.repetition - b.repetition);
        }
        const report = result(run, output);
        regularPath(join(output, "run.json"));
        regularPath(join(output, "status.json"));
        regularPath(join(output, "results.json"));
        // run.json is authoritative; a resume rebuilds a stale derived results.json after interruption.
        durableAtomicWrite(join(output, "run.json"), JSON.stringify(run, null, 2) + "\n");
        durableAtomicWrite(join(output, "status.json"), JSON.stringify(report, null, 2) + "\n");
        if (report.status === "complete") {
            const compatible = { skill_name: run.skill_name, description: run.description, results: report.results.map(r => ({ query: r.query, should_trigger: r.should_trigger, trigger_rate: r.trigger_rate, triggers: r.triggers, runs: r.runs, pass: r.pass })), summary: { total: report.summary.total, passed: report.summary.passed, failed: report.summary.failed } };
            durableAtomicWrite(join(output, "results.json"), JSON.stringify(compatible, null, 2) + "\n");
        }
        const review = join(output, "review.html");
        regularPath(review);
        durableAtomicWrite(review, sessionEvaluationHtml("Activation", report.status, { skill_name: report.skill_name, summary: report.summary, results: report.results, pending: report.pending }));
        return { ...report, review };
    }
    catch (error) {
        if (!options.resume)
            rmSync(output, { recursive: true, force: true });
        throw error;
    }
    finally {
        release();
    }
}
export async function main() {
    try {
        const { values } = parseArgs({ args: process.argv.slice(2), options: { "grading-results": { type: "string" }, mode: { type: "string", default: "activation" }, "baseline-skill": { type: "string" }, iteration: { type: "string" }, "skill-path": { type: "string" }, "eval-set": { type: "string" }, output: { type: "string" }, resume: { type: "boolean" }, observations: { type: "string" }, "runs-per-query": { type: "string" }, "trigger-threshold": { type: "string" } } });
        if (!values["skill-path"])
            throw new Error("--skill-path is required");
        if (!["activation", "behavioral"].includes(values.mode))
            throw new Error("--mode must be activation or behavioral");
        if (values.mode === "behavioral") {
            if (values.observations || values["trigger-threshold"])
                throw new Error("Activation observation/threshold flags do not apply to behavioral mode");
            const { runBehavioralEvaluation } = await import("./evaluation_behavioral.js");
            console.log(JSON.stringify(await runBehavioralEvaluation({ gradingResults: values["grading-results"], skillPath: values["skill-path"], evalSet: values["eval-set"], output: values.output, resume: values.resume, baselineSkill: values["baseline-skill"], iteration: values.iteration === undefined ? undefined : Number(values.iteration), runsPerQuery: values["runs-per-query"] === undefined ? undefined : Number(values["runs-per-query"]) }), null, 2));
            return 0;
        }
        if (values["grading-results"] || values["baseline-skill"] || values.iteration)
            throw new Error("Baseline/iteration flags require --mode behavioral");
        const report = runEvaluation({ skillPath: values["skill-path"], evalSet: values["eval-set"], output: values.output, resume: values.resume, observations: values.observations, runsPerQuery: values["runs-per-query"] === undefined ? undefined : Number(values["runs-per-query"]), triggerThreshold: values["trigger-threshold"] === undefined ? undefined : Number(values["trigger-threshold"]) });
        console.log(JSON.stringify(report, null, 2));
        return 0;
    }
    catch (error) {
        console.log(JSON.stringify({ status: "invalid", reason: error.message }));
        return 2;
    }
}
if (!import.meta.url.includes("/$bunfs/") && import.meta.url === "file://" + process.argv[1])
    main().then(code => process.exit(code));
