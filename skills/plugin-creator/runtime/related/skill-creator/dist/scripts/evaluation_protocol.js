/** Evaluation objectives above the common discovery-isolated execution engine. */
import { parseArgs } from "node:util";
import { join, resolve, dirname } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { runIsolatedEvaluation, validateEvaluationOutput } from "./evaluation_isolated.js";
import { read, regularPath } from "./evaluation_files.js";
import { prepareGradingRequest, importGradingResults, validateGradingResponse } from "./evaluation_grading.js";
import { renderIsolatedEvaluationReport, analyzeIsolatedEvaluationReport } from "./evaluation_report.js";
import { taskPath } from "./task_evidence.js";
import { durableAtomicWrite, acquireDirectoryLockSync } from "./durable_file.js";
const sha = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const name = (s) => typeof s === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]*(?::[A-Za-z0-9][A-Za-z0-9_-]*)?$/.test(s);
function strings(v, label, names = false) {
    if (!Array.isArray(v) || v.some(x => names ? !name(x) : typeof x !== "string" || !x.trim()) || new Set(v).size !== v.length)
        throw new Error("Invalid " + label);
    return [...v].sort();
}
function save(path, value) { regularPath(path); durableAtomicWrite(path, JSON.stringify(value, null, 2) + "\n"); }
function runDirectory(workspace, directory) {
    if (typeof directory !== "string" || !/^case-\d+\/(baseline|with_targets)\/run-\d+$/.test(directory))
        throw new Error("Unsafe retained run directory");
    return join(workspace, directory);
}
function stateDigest(state) { return sha(state); }
/** One atomic envelope: a crash cannot strand state between two binding files. */
function saveState(workspace, state) { save(join(workspace, "run.json"), { state, sha256: stateDigest(state) }); }
function loadState(workspace) {
    const envelope = JSON.parse(read(join(workspace, "run.json")).toString("utf8")), state = envelope.state;
    if (!state || state.schema_version !== "isolated-evaluation-v1" || !["activation", "behavioral"].includes(state.mode) || !Array.isArray(state.runs) || !Array.isArray(state.cases) || !Array.isArray(state.campaigns) || !Number.isInteger(state.runs_per_query) || state.runs_per_query < 1 || state.runs_per_query > 100)
        throw new Error("Invalid isolated run state");
    if (envelope.sha256 !== stateDigest(state))
        throw new Error("Frozen run state drift");
    return state;
}
function project(workspace, state) {
    const rows = [], activation = [], requests = [];
    for (const c of state.cases)
        for (const run of state.runs.filter((r) => r.case_id === c.id)) {
            if (state.mode === "activation") {
                const loaded = run.activation?.requested_skills ?? null, expected = run.arm === "baseline" ? [] : c.expectedSkills;
                const available = run.status === "succeeded" && Array.isArray(loaded);
                const observed = available ? loaded : null;
                const targetLoaded = available ? loaded.filter((n) => state.selected_targets.includes(n)) : null;
                activation.push({ case_id: c.id, repetition: run.repeat, arm: run.arm, query: c.prompt, expected_skills: expected, requested_skills: observed, target_requested_skills: targetLoaded, pass: available ? JSON.stringify(targetLoaded) === JSON.stringify(expected) : null, role: run.arm === "baseline" ? "contamination-control" : "activation-measure", evidence_scope: "load requests only; successful load/use not proven", execution_status: run.status });
                continue;
            }
            const runDir = runDirectory(workspace, run.directory);
            let grade = null;
            const packet = run.status === "succeeded" && c.expectations.length ? prepareGradingRequest(workspace, runDir, ["result.txt"], c.expectations) : null;
            if (packet && existsSync(join(runDir, "grading-response.json"))) {
                const response = JSON.parse(read(join(runDir, "grading-response.json")).toString("utf8"));
                const validated = validateGradingResponse(response, packet);
                if (existsSync(join(runDir, "grading.json"))) {
                    grade = JSON.parse(read(join(runDir, "grading.json")).toString("utf8"));
                    if (JSON.stringify(grade) !== JSON.stringify(validated))
                        throw new Error("Grading evidence drift or invalid binding");
                }
                else {
                    grade = validated;
                    save(join(runDir, "grading.json"), grade);
                }
            }
            else if (packet && existsSync(join(runDir, "grading.json"))) {
                throw new Error("Grading summary lacks bound independent response");
            }
            if (packet && !grade)
                requests.push({ request_id: packet.request_id, request_path: packet.request_path });
            const expectations = grade?.expectations ?? c.expectations.map(text => ({ text, passed: null, evidence: "", rationale: "Independent grading unavailable" }));
            rows.push({ eval_id: c.id, eval_name: "eval-" + c.id, configuration: run.arm === "baseline" ? "without_skill" : "with_skill", run_number: run.repeat, expectations, prompt: c.prompt, grading_status: grade ? grade.summary.inconclusive ? "inconclusive" : "complete" : "absent", result: { pass_rate: grade?.summary.pass_rate ?? null, time_seconds: run.duration_seconds ?? null, tokens: run.tokens ?? null }, execution_status: run.status });
        }
    const failed = Boolean(state.execution_failure) || state.runs.some((r) => r.status === "failure" || r.status === "blocked");
    const missingRuns = [];
    for (const c of state.cases)
        for (let repeat = 1; repeat <= state.runs_per_query; repeat++)
            for (const arm of ["baseline", "with_targets"]) {
                const matches = state.runs.filter((r) => r.case_id === c.id && r.repeat === repeat && r.arm === arm);
                if (matches.length > 1)
                    throw new Error("Duplicate frozen run slot");
                if (!matches.length)
                    missingRuns.push({ case_id: c.id, arm, repeat });
            }
    const campaignFailure = state.campaigns.some((c) => c.status === "failure");
    const completeCoverage = missingRuns.length === 0 && state.campaigns.length === state.cases.length;
    const ready = completeCoverage && state.runs.length > 0 && state.runs.every((r) => r.status === "succeeded");
    const report = { ...state, exit_code: failed || campaignFailure ? 1 : 0, status: failed || campaignFailure ? "failure" : !completeCoverage ? "incomplete" : state.dry_run ? "prepared" : state.mode === "activation" ? activation.some(r => r.pass === null) ? "inconclusive" : "complete" : !ready ? "failure" : requests.length || state.cases.some((c) => !c.expectations.length) ? "awaiting-grading" : rows.some(r => r.grading_status === "inconclusive") ? "inconclusive" : "complete", missing_runs: missingRuns, activation_results: activation, rows, grading_requests: requests, review: join(workspace, "review.html"), evidence_authority: "local host observations and imported independent judgments; not authenticated acceptance" };
    if (state.mode === "behavioral")
        report.comparison = analyzeIsolatedEvaluationReport(report);
    save(join(workspace, "report.json"), report);
    const html = renderIsolatedEvaluationReport(report);
    regularPath(report.review);
    durableAtomicWrite(report.review, html);
    return report;
}
/** Reporting/import only: never launch missing candidates during a resume. */
function resumeEvaluation(workspace, requestedMode, gradingResults) {
    const release = acquireDirectoryLockSync(join(workspace, ".lock"));
    try {
        const state = loadState(workspace);
        if (requestedMode && requestedMode !== state.mode)
            throw new Error("Mode drift");
        if (gradingResults && state.mode !== "behavioral")
            throw new Error("Grading only applies to behavioral mode");
        const packets = [];
        for (const c of state.cases)
            for (const run of state.runs.filter((r) => r.case_id === c.id && r.status === "succeeded")) {
                const dir = runDirectory(workspace, run.directory);
                regularPath(dir, true);
                if (sha(read(join(dir, "outputs/result.txt")).toString("utf8")) !== run.output_sha256)
                    throw new Error("Retained output drift");
                if (run.task_evidence_sha256) {
                    const bytes = read(join(dir, "outputs/task-evidence.json"));
                    if (sha(bytes.toString("utf8")) !== run.task_evidence_sha256)
                        throw new Error("Task evidence drift");
                    const context = JSON.parse(bytes.toString("utf8"));
                    for (const [path, value] of Object.entries(context.files)) {
                        taskPath(path);
                        if (createHash("sha256").update(read(join(dir, "outputs/artifacts", path))).digest("hex") !== value.sha256)
                            throw new Error("Retained artifact drift");
                    }
                }
                if (c.expectations.length && !existsSync(join(dir, "grading.json")))
                    packets.push(prepareGradingRequest(workspace, dir, ["result.txt"], c.expectations));
            }
        if (gradingResults)
            importGradingResults(resolve(gradingResults), packets);
        const report = project(workspace, state);
        console.log(JSON.stringify(report, null, 2));
        return report.exit_code;
    }
    finally {
        release();
    }
}
export async function main() {
    try {
        const { values: v } = parseArgs({ args: process.argv.slice(2), options: { mode: { type: "string" }, prompt: { type: "string" }, "eval-set": { type: "string" }, output: { type: "string" }, "with-skills": { type: "string", multiple: true }, "with-plugin": { type: "string", multiple: true }, "plugin-path": { type: "string", multiple: true }, "expected-skills": { type: "string" }, expectations: { type: "string" }, fixtures: { type: "string" }, "source-home": { type: "string" }, model: { type: "string" }, provider: { type: "string" }, config: { type: "string" }, "runs-per-query": { type: "string" }, timeout: { type: "string" }, "goose-command": { type: "string" }, "dry-run": { type: "boolean" }, resume: { type: "boolean" }, "grading-results": { type: "string" } } });
        if (!v.output)
            throw new Error("--output is required");
        const workspace = resolve(v.output);
        regularPath(workspace, true);
        if (v.resume) {
            if (Object.entries(v).some(([k, val]) => val !== undefined && !["output", "resume", "grading-results", "mode"].includes(k)))
                throw new Error("Resume only imports grading; frozen inputs cannot be overridden");
            return resumeEvaluation(workspace, v.mode, v["grading-results"]);
        }
        if (v["grading-results"])
            throw new Error("--grading-results requires --resume");
        if (v["eval-set"] && (v.expectations || v["expected-skills"]))
            throw new Error("Single-prompt criteria flags cannot override an eval-set");
        if ((v.mode ?? "behavioral") === "activation" && v.expectations)
            throw new Error("Behavioral expectations do not apply to activation");
        if ((v.mode ?? "behavioral") === "behavioral" && v["expected-skills"])
            throw new Error("Activation expected-skills do not apply to behavioral");
        const mode = v.mode ?? "behavioral";
        if (!["activation", "behavioral"].includes(mode))
            throw new Error("--mode must be activation or behavioral; isolation is mandatory");
        if (Boolean(v.prompt) === Boolean(v["eval-set"]))
            throw new Error("Provide exactly one --prompt or --eval-set");
        const selectedSkills = (v["with-skills"] ?? []).flatMap(s => s.split(",")), plugins = (v["with-plugin"] ?? []).flatMap(s => s.split(","));
        const pluginPaths = (v["plugin-path"] ?? []).map(p => resolve(p));
        if (new Set(pluginPaths).size !== pluginPaths.length)
            throw new Error("Duplicate plugin paths");
        strings(selectedSkills, "skills", true);
        strings(plugins, "plugins", true);
        if (!selectedSkills.length && !plugins.length && !pluginPaths.length)
            throw new Error("Select at least one skill or plugin");
        const repeats = v["runs-per-query"] === undefined ? 1 : Number(v["runs-per-query"]), timeout = v.timeout === undefined ? 300 : Number(v.timeout);
        if (!Number.isInteger(repeats) || repeats < 1 || repeats > 100 || !Number.isFinite(timeout) || timeout <= 0 || timeout > 86400)
            throw new Error("Invalid execution budget");
        let raw, base = process.cwd();
        if (v["eval-set"]) {
            const path = resolve(v["eval-set"]);
            base = dirname(path);
            const input = JSON.parse(read(path).toString("utf8"));
            raw = Array.isArray(input) ? input : input.evals;
        }
        else
            raw = [{ id: 0, prompt: v.prompt, expectations: v.expectations ? JSON.parse(v.expectations) : [], expected_skills: v["expected-skills"] === undefined ? undefined : v["expected-skills"] === "none" ? [] : v["expected-skills"].split(",") }];
        if (!Array.isArray(raw) || !raw.length || raw.length > 1000 || raw.length * repeats * 2 > 2048)
            throw new Error("Invalid evaluation set size");
        const ids = new Set();
        const cases = raw.map((x, i) => {
            const id = x?.id ?? i, prompt = x?.prompt ?? x?.query;
            if (!Number.isSafeInteger(id) || id < 0 || ids.has(id) || typeof prompt !== "string" || !prompt.trim())
                throw new Error("Invalid case identity/prompt");
            ids.add(id);
            if (x.files?.length)
                throw new Error("Use clean case fixtures directory, not Skill-relative files");
            if (x.expectations !== undefined && x.assertions !== undefined && JSON.stringify(x.expectations) !== JSON.stringify(x.assertions))
                throw new Error("Conflicting expectation aliases");
            let expected = x.expected_skills;
            if (mode === "activation" && expected !== undefined && typeof x.should_trigger === "boolean") {
                const alias = x.should_trigger ? [selectedSkills[0]] : [];
                if (selectedSkills.length !== 1 || plugins.length || pluginPaths.length || JSON.stringify(strings(expected, "expected_skills", true)) !== JSON.stringify(alias))
                    throw new Error("Conflicting activation aliases");
            }
            if (mode === "activation" && expected === undefined && typeof x.should_trigger === "boolean" && selectedSkills.length === 1 && !plugins.length && !pluginPaths.length)
                expected = x.should_trigger ? [selectedSkills[0]] : [];
            if (mode === "activation" && expected === undefined)
                throw new Error("Activation requires expected_skills per case; should_trigger supports one explicitly selected skill only");
            return { id, prompt, expectations: mode === "behavioral" ? strings(x.expectations ?? x.assertions ?? [], "expectations") : [], expectedSkills: mode === "activation" ? strings(expected, "expected_skills", true) : [], fixtures: x.fixtures ? resolve(base, x.fixtures) : v.fixtures ? resolve(v.fixtures) : undefined };
        });
        validateEvaluationOutput(workspace, v["source-home"], cases.flatMap(c => c.fixtures ? [c.fixtures] : []), pluginPaths);
        // Validate every case with the exact common engine, without model calls. Disposable reports stay outside inputs.
        const validationRoot = mkdtempSync(join(tmpdir(), "eval-validation-"));
        let targets = [];
        let sourceBinding;
        try {
            for (const c of cases) {
                const preflight = await runIsolatedEvaluation({ prompt: c.prompt, output: join(validationRoot, "case-" + c.id), fixtures: c.fixtures, withSkills: selectedSkills, withPlugins: plugins, pluginPaths, sourceHome: v["source-home"], config: v.config, model: v.model, provider: v.provider, dryRun: true, mode: mode });
                if (preflight.exit_code !== 0)
                    throw new Error("Input validation failed: " + JSON.stringify(preflight.failure));
                c.binding = { manifests: sha(preflight.manifests), fixtures: sha(preflight.fixtures), config: preflight.config_sha256 };
                targets = preflight.expected_targets;
                if (c.expectedSkills.some(n => !targets.includes(n)))
                    throw new Error("Expected activation skill is not selected");
                const binding = sha([preflight.manifests, preflight.config_sha256]);
                if (sourceBinding && binding !== sourceBinding)
                    throw new Error("Source drift between cases");
                sourceBinding = binding;
            }
        }
        finally {
            rmSync(validationRoot, { recursive: true, force: true });
        }
        mkdirSync(workspace, { mode: 0o700 });
        const state = { schema_version: "isolated-evaluation-v1", mode, runs_per_query: repeats, dry_run: Boolean(v["dry-run"]), model: v.model ?? null, provider: v.provider ?? null, selected_targets: targets, requested_skills: selectedSkills, requested_plugins: plugins, requested_plugin_paths: pluginPaths, cases, runs: [], campaigns: [] };
        const release = acquireDirectoryLockSync(join(workspace, ".lock"));
        try {
            for (const c of cases) {
                const dir = join(workspace, "case-" + c.id);
                const campaign = await runIsolatedEvaluation({ expectedBinding: c.binding, mode: mode, prompt: c.prompt, output: dir, fixtures: c.fixtures, withSkills: selectedSkills, withPlugins: plugins, pluginPaths, sourceHome: v["source-home"], config: v.config, model: v.model, provider: v.provider, dryRun: v["dry-run"], command: v["goose-command"], timeoutSeconds: timeout, runsPerQuery: repeats });
                if (sha([campaign.manifests, campaign.config_sha256]) !== sourceBinding && campaign.exit_code === 0)
                    throw new Error("Source drift during campaign");
                state.campaigns.push({ case_id: c.id, report: "case-" + c.id + "/report.json", status: campaign.status, manifests: campaign.manifests, fixtures: campaign.fixtures, failure: campaign.failure ?? null, diagnostic: campaign.diagnostic ?? null, recovery: campaign.recovery ?? null });
                for (const run of campaign.runs) {
                    const runDir = join(dir, run.arm, "run-" + run.repeat);
                    mkdirSync(join(runDir, "outputs"), { recursive: true, mode: 0o700 });
                    writeFileSync(join(runDir, "outputs/result.txt"), run.grading_output ?? run.output ?? "", { mode: 0o600 });
                    state.runs.push({ ...run, case_id: c.id, directory: "case-" + c.id + "/" + run.arm + "/run-" + run.repeat, task_evidence_sha256: existsSync(join(runDir, "outputs/task-evidence.json")) ? sha(read(join(runDir, "outputs/task-evidence.json")).toString("utf8")) : null, output_sha256: sha(run.grading_output ?? run.output ?? "") });
                }
                if (campaign.exit_code !== 0)
                    state.execution_failure = campaign.failure ?? true;
                saveState(workspace, state);
                if (campaign.exit_code !== 0)
                    break;
            }
            saveState(workspace, state);
            const report = project(workspace, state);
            console.log(JSON.stringify(report, null, 2));
            return report.exit_code;
        }
        finally {
            release();
        }
    }
    catch (error) {
        console.log(JSON.stringify({ status: "invalid", reason: error.message }));
        return 2;
    }
}
