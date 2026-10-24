#!/usr/bin/env node
import { FULL_EVAL_HELP } from "./cli_help.js";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, writeSync, } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { validateSkill } from "./quick_validate.js";
import { validateEvaluationReceipt } from "./validate_evaluation_receipt.js";
import { runEmbedded } from "./runtime-dispatch.js";
import { sourceHash, verifySkill } from "./verify_skill_gates.js";
import { auditSkill } from "./audit_skill.js";
import { designEvals } from "./design_evals.js";
import { analyzeEvaluation } from "./analyze_evaluation.js";
import { executePairedRuns } from "./paired_execution.js";
import { EvaluationProgress } from "./evaluation_progress.js";
import { validateProviderConstraints } from "./provider_constraints.js";
import { assertPortableScenarioId, scenarioDirectory } from "./scenario_id.js";
import { acquireDirectoryLock } from "./durable_file.js";
import { legacyMigrationNeeded, migrateFixedWorkspace } from "./evaluation_workspace_migration.js";
import { configuredGooseArgv } from "./runners/goose.js";
import { canonical as gradingCanonical, sha256 as gradingSha256, normalizeAssertions } from "./evaluator_grading.js";
import { parseRunProfile, RUN_PROFILE_COUNTS, schedulePairs, validateAggregateBudget } from "./repeated_runs.js";
import { ADAPTIVE_SCHEDULER_STATE, resolveAdaptivePolicy } from "./adaptive_scheduling.js";
import { anytimeQualityPolicyHash } from "./anytime_quality.js";
import { canonicalFamilyManifestPath, claimFamilyComparison, familyConclusion, finalizeFamilyComparison, prepareFamilyComparison, readFamilyManifest } from "./comparison_family.js";
import { executionSamplingProtocol, executionSamplingProtocolHash } from "./execution_sampling_protocol.js";
import { evaluationCampaignId } from "./evaluation_campaign.js";
import { artifactHash, compositeHash, evidenceModeHash, expectedRunDirs, requiredRunDirs, validateExecutionEvidence, } from "./evaluation_provenance.js";
const SCHEMA_VERSION = "2.0";
const STATE_FILE = ".full-eval-job.json";
function failureEnvelopeFromArgv(argv, message) { const skill = resolve(argv.find(x => !x.startsWith("-")) ?? "."), value = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }, workspace = resolve(value("--workspace") ?? join(dirname(skill), basename(skill) + "-workspace", "iteration-1")), evalSet = resolve(value("--eval-set") ?? join(skill, "evals", "evals.json")); return { schema_version: "1.1", command: "full-eval", status: "failure", exit_code: 1, skill, workspace, eval_set: evalSet, resume: argv.includes("--resume"), dry_run: argv.includes("--dry-run"), phases: PHASES.map(name => ({ name, status: "skipped", artifacts: [] })), job: { schema_version: SCHEMA_VERSION, id: null, revision: null, status: "failed", state_file: join(workspace, STATE_FILE), phases: [] }, checkpoint: null, migration: { status: "failed", reason: message }, next_actions: ["Preview the compatibility migration with `skill-creator migrate-evaluation <workspace> --dry-run` and resolve the reported condition."], executable_actions: [] }; }
const PHASES = [
    "validate", "authoring-audit", "evaluation-design", "scaffold",
    "paired-runs-and-grading", "aggregate", "static-review", "receipt",
    "post-evaluation-pattern-review", "verify",
];
function isDir(path) { try {
    return statSync(path).isDirectory();
}
catch {
    return false;
} }
function loadJson(path) { return JSON.parse(readFileSync(path, "utf8")); }
function slug(value) { return String(value ?? "eval").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "eval"; }
function digest(parts) { return compositeHash(parts); }
function fileDigest(path) { return artifactHash(path); }
function atomicWrite(path, value) {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.tmp-${process.pid}`;
    const fd = openSync(temporary, "w", 0o600);
    try {
        writeSync(fd, value);
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
    renameSync(temporary, path);
    const dirfd = openSync(dirname(path), "r");
    try {
        fsyncSync(dirfd);
    }
    finally {
        closeSync(dirfd);
    }
}
function atomicJson(path, value) { atomicWrite(path, JSON.stringify(value, null, 2) + "\n"); }
function rel(root, path) { return relative(root, path).replaceAll("\\", "/"); }
function reconcileScenarioDirs(workspace, evals, evalPlanHash) {
    const active = new Set(evals.map((item, index) => "eval-" + assertPortableScenarioId(item?.id ?? index + 1)));
    const archived = [];
    if (!isDir(workspace))
        return archived;
    for (const name of readdirSync(workspace).filter(n => n.startsWith("eval-")).sort()) {
        const source = join(workspace, name);
        if (active.has(name) || !isDir(source))
            continue;
        const archiveRoot = join(workspace, ".full-eval-archive", evalPlanHash);
        mkdirSync(archiveRoot, { recursive: true });
        let destination = join(archiveRoot, name), suffix = 1;
        while (existsSync(destination))
            destination = join(archiveRoot, `${name}-${suffix++}`);
        renameSync(source, destination);
        archived.push(destination);
    }
    return archived;
}
/**
 * Detects delegated-grading-mode runs whose candidate output and
 * deterministic evidence are complete, but whose grading.json still
 * reports the "no adapter invoked" pending state for one or more semantic
 * assertions (gradeOutput's own judgments:[] / reason: "At least two
 * independent graders are required" — produced when paired_execution.ts
 * runs with graderAdapter:null). Distinguishes this deliberately-pending
 * state from a genuinely missing/corrupt grading.json (still reported by
 * missingRuns) so full-eval can report awaiting-grading instead of a bare
 * incomplete-evidence block, without weakening validateExecutionEvidence's
 * unrelated completeness checks.
 */
function pendingDelegatedGrading(workspace) {
    const runs = [];
    for (const dir of requiredRunDirs(workspace)) {
        const gradingPath = join(dir, "grading.json");
        if (!existsSync(gradingPath))
            continue;
        let grading;
        try {
            grading = loadJson(gradingPath);
        }
        catch {
            continue;
        }
        const expectations = Array.isArray(grading?.expectations) ? grading.expectations : [];
        const pendingSemantic = expectations.some((e) => e?.classification === "semantic" && Array.isArray(e?.judgments) && e.judgments.length === 0 && e?.reason === "At least two independent graders are required");
        if (pendingSemantic)
            runs.push(dir);
    }
    return { pending: runs.length > 0, runs };
}
function missingRuns(workspace) {
    const missing = { outputs: [], gradings: [], timings: [] };
    for (const dir of requiredRunDirs(workspace)) {
        const outputs = join(dir, "outputs");
        if (!isDir(outputs) || !readdirSync(outputs).some(n => n !== ".keep"))
            missing.outputs.push(rel(workspace, outputs));
        if (!existsSync(join(dir, "grading.json")))
            missing.gradings.push(rel(workspace, join(dir, "grading.json")));
        if (!existsSync(join(dir, "timing.json")))
            missing.timings.push(rel(workspace, join(dir, "timing.json")));
    }
    return missing;
}
async function execute(entry, args) { const main = entry === "aggregate_benchmark.js" ? (await import("./aggregate_benchmark.js")).main : (await import("../eval-viewer/generate_review.js")).main; const child = await runEmbedded(main, args); return { ok: child.status === 0, detail: String(child.stdout || child.stderr || "").trim() }; }
function dependencies(index) { return index === 0 ? [] : [PHASES[index - 1]]; }
function newJob(skill, workspace, evalSet, baseline, decision_policy) { return { schema_version: SCHEMA_VERSION, job_id: evaluationCampaignId({ skill, workspace, evalSet, baseline, decisionPolicy: decision_policy }), revision: 0, status: "active", skill, workspace, eval_set: evalSet, baseline, decision_policy, initial_policy_hash: null, family_manifest_path: null, family_manifest_hash: null, comparison_claim: null, sampling_protocol: null, sampling_protocol_hash: null, phases: PHASES.map((name, index) => ({ name, depends_on: dependencies(index), status: "pending", attempts: 0, artifacts: [] })) }; }
function loadJob(path, identity) {
    if (!existsSync(path))
        return null;
    const job = loadJson(path);
    if (job.schema_version !== SCHEMA_VERSION)
        throw new Error(`unsupported full-eval workspace schema ${String(job.schema_version)}; downgrade and future versions are refused`);
    if (job.skill !== identity.skill || job.workspace !== identity.workspace || job.eval_set !== identity.eval_set || job.baseline !== identity.baseline)
        throw new Error("existing full-eval job identity does not match this invocation");
    if (job.decision_policy !== identity.decision_policy)
        throw new Error("existing full-eval decision policy is immutable");
    if (!Object.hasOwn(job, "initial_policy_hash") || !Object.hasOwn(job, "sampling_protocol_hash") || !Object.hasOwn(job, "family_manifest_hash"))
        throw new Error("existing full-eval job lacks immutable statistical bindings");
    return job;
}
function checkpoint(job) { job.revision += 1; atomicJson(join(job.workspace, STATE_FILE), job); }
function publicStatus(status) { return status === "succeeded" ? "complete" : status === "blocked" ? "blocked" : status === "failed" || status === "cancelled" ? "failed" : status === "running" || status === "stale" ? "planned" : "skipped"; }
function publicPhases(job, dryRun = false) { return job.phases.map(p => ({ name: p.name, status: dryRun ? (p.status === "succeeded" ? "complete" : "planned") : publicStatus(p.status), artifacts: p.artifacts, ...(p.detail ? { detail: p.detail } : {}), ...(p.error && !p.detail ? { detail: p.error } : {}) })); }
function shellQuote(value) { return value ? `'${value.replaceAll("'", `'"'"'`)}'` : "''"; }
function action(order, id, description, argv) { return { order, id, description, argv, command: argv.map(shellQuote).join(" ") }; }
function resumeArgv(job, options, extra = []) {
    const argv = ["skill-creator", "full-eval", job.skill, "--workspace", job.workspace, "--eval-set", job.eval_set, "--baseline", job.baseline, "--run-profile", options.runProfile ?? "fast", "--resume"];
    if (options.execute)
        argv.push("--execute");
    if (options.decisionPolicy && options.decisionPolicy !== "fixed")
        argv.push("--decision-policy", options.decisionPolicy);
    if (options.adaptivePolicy)
        argv.push("--adaptive-policy", JSON.stringify(options.adaptivePolicy));
    if (options.familyWorkspace)
        argv.push("--family-workspace", resolve(options.familyWorkspace));
    if (options.runner)
        argv.push("--runner", options.runner);
    if (options.model)
        argv.push("--model", options.model);
    if (options.baselineSkillPath)
        argv.push("--baseline-skill", resolve(options.baselineSkillPath));
    if (options.concurrency !== undefined)
        argv.push("--concurrency", String(options.concurrency));
    const pc = options.providerConstraints;
    if (pc) {
        for (const [key, value] of Object.entries({ "provider-concurrency": pc.concurrency, "provider-rpm": pc.requestsPerMinute, "provider-max-attempts": pc.maxAttempts, "provider-backoff-base-ms": pc.baseBackoffMs, "provider-backoff-max-ms": pc.maxBackoffMs, "provider-active-lease-ms": pc.activeLeaseMs, "max-cost-usd": pc.maxCostUsd, "max-tokens": pc.maxTokens, "max-provider-seconds": pc.maxProviderSeconds, "reserve-cost-usd": pc.reserveCostUsd, "reserve-tokens": pc.reserveTokens, "reserve-provider-seconds": pc.reserveProviderSeconds }))
            if (value !== undefined)
                argv.push("--" + key, String(value));
    }
    if (options.cacheDir)
        argv.push("--cache-dir", resolve(options.cacheDir));
    else if (options.cacheDir === null)
        argv.push("--no-cache");
    return [...argv, ...extra];
}
function executableActions(job, options, status) { if (status !== "blocked" && status !== "cancelled")
    return []; const human = job.phases.find(p => p.name === "verify")?.status === "blocked" && job.phases.find(p => p.name === "static-review")?.status === "succeeded"; const executionBlocked = options.execute && job.phases.find(p => p.name === "paired-runs-and-grading")?.status === "blocked"; const actions = []; if (executionBlocked)
    actions.push(action(1, "preflight", "Verify that the configured Goose host is now available.", [...configuredGooseArgv(), "--version"])); if (human)
    actions.push(action(actions.length + 1, "review", "Open the generated review checkpoint.", ["xdg-open", join(job.workspace, "review.html")])); actions.push(action(actions.length + 1, "resume", human ? "Record the human decision and resume at verification." : "Resume at the first incomplete phase after satisfying the reported requirements.", resumeArgv(job, options, human ? ["--human-review", "pass", "--tests-status", String(options.testsStatus ?? "pass")] : []))); return actions; }
function envelope(options, job, status, next_actions, extra = {}) { const exit_code = status === "success" || status === "planned" ? 0 : status === "blocked" || status === "awaiting-grading" ? 3 : 1; const checkpoint = status === "blocked" && job.phases.find(p => p.name === "verify")?.status === "blocked" && job.phases.find(p => p.name === "static-review")?.status === "succeeded" ? { kind: "human-review", status: "decision-required", failure: false, review: join(job.workspace, "review.html") } : null; return { schema_version: "1.1", command: "full-eval", status, exit_code, skill: job.skill, workspace: job.workspace, eval_set: job.eval_set, resume: Boolean(options.resume), dry_run: Boolean(options.dryRun), phases: publicPhases(job, Boolean(options.dryRun)), job: { schema_version: job.schema_version, id: job.job_id, revision: job.revision, status: job.status, state_file: join(job.workspace, STATE_FILE), phases: job.phases }, checkpoint, ...extra, next_actions, executable_actions: executableActions(job, options, status) }; }
function artifactExists(path) { return isDir(path) || existsSync(path); }
function captureArtifactHashes(phase) { phase.artifact_hashes = Object.fromEntries(phase.artifacts.map(path => [path, artifactHash(path)])); }
function artifactsMatch(phase) { return Boolean(phase.artifact_hashes) && phase.artifacts.every(path => artifactExists(path) && phase.artifact_hashes?.[path] === artifactHash(path)); }
function invalidateFrom(job, index) { for (let i = index; i < job.phases.length; i++) {
    const phase = job.phases[i];
    if (phase.status !== "pending") {
        phase.status = "stale";
        delete phase.error;
    }
} }
function planHashes(job) { const source = sourceHash(job.skill, [job.eval_set]), evalPlan = fileDigest(job.eval_set); return { source, evalPlan }; }
function writeProvisional(workspace, snapshot) {
    const benchmark = { schema_version: "1.0", status: "provisional", provisional: true, final_receipt: false, canonical: false, historical: true, progress: snapshot, notice: "Partial observations only. This snapshot is not a final benchmark or acceptance receipt." };
    atomicJson(join(workspace, "partial-benchmark" + ".json"), benchmark);
    atomicJson(join(workspace, "partial-review" + ".json"), { schema_version: "1.0", status: "provisional", provisional: true, canonical: false, historical: true, decision: { verdict: "provisional", accepted: false, reason: "Evaluation is incomplete; no final decision is available." }, progress: snapshot, benchmark: "partial-benchmark" + ".json" });
}
function phaseInput(name, job, options) {
    const { source, evalPlan: evalHash } = planHashes(job), prior = (phase) => job.phases.find(p => p.name === phase)?.input_hash ?? "none";
    switch (name) {
        case "validate":
        case "authoring-audit": return digest([name, source]);
        case "evaluation-design": return digest([name, source, evalHash]);
        case "scaffold": return digest([name, source, evalHash, job.baseline, String(options.runProfile ?? "fast"), String(options.repetitions ?? "profile-default"), job.decision_policy, JSON.stringify(options.adaptivePolicy ?? null), JSON.stringify(options.graders ?? []), String(options.model ?? "plan-default"), JSON.stringify(options.reasoning ?? null), JSON.stringify(options.matrixBinding ?? null), String(options.graderCommand ?? "default"), String(options.baselineSkillPath ?? ""), String(Boolean(options.execute))]);
        case "paired-runs-and-grading": {
            const baselinePath = options.baselineSkillPath ? resolve(options.baselineSkillPath) : "";
            return digest([name, source, evalHash, job.baseline, String(options.runProfile ?? "fast"), prior("scaffold"), String(options.execute), String(options.runner ?? "goose"), String(options.model ?? "plan-default"), JSON.stringify(options.reasoning ?? null), JSON.stringify(options.matrixBinding ?? null), JSON.stringify(options.graders ?? []), String(options.graderCommand ?? "default"), String(options.gradingMode ?? "subprocess"), String(options.maxGraderCalls ?? 100), String(options.concurrency ?? 2), JSON.stringify(options.providerConstraints ?? {}), String(options.cacheDir ?? "disabled"), baselinePath, baselinePath ? artifactHash(baselinePath) : ""]);
        }
        case "aggregate": {
            const evidence = validateExecutionEvidence(job.workspace, { skill_source_sha256: source, eval_plan_sha256: evalHash });
            return digest([name, prior("paired-runs-and-grading"), source, evalHash, evidence.evidence_sha256, job.decision_policy]);
        }
        case "static-review": return digest([name, fileDigest(join(job.workspace, "benchmark.json"))]);
        case "receipt": return digest([name, fileDigest(join(job.workspace, "benchmark.json")), fileDigest(join(job.workspace, "review.html")), prior("paired-runs-and-grading")]);
        case "post-evaluation-pattern-review": return digest([name, source, fileDigest(join(job.workspace, "benchmark.json")), fileDigest(join(job.workspace, "review.html"))]);
        case "verify": return digest([name, source, fileDigest(join(job.workspace, "benchmark.json")), fileDigest(join(job.workspace, "review.html")), String(options.humanReview), String(options.testsStatus), String(options.triggeringStatus), String(options.triggeringReason), String(options.minPassRate ?? 0.8), String(options.minDelta ?? 0)]);
    }
}
function releaseEvidenceEligible(verification) {
    if (verification?.status !== "pass")
        return { eligible: false, reason: "release verification did not pass" };
    if (verification?.profile !== "release")
        return { eligible: false, reason: "verification profile is not exactly release" };
    const d = verification?.decision_evidence;
    if (!d || d.mode !== "adaptive")
        return { eligible: false, reason: "release family finalization requires adaptive decision evidence" };
    const minimum = Number(d.comparison_family?.min_pairs ?? 0);
    if (d.decision !== "winner" || d.terminal !== true)
        return { eligible: false, reason: "adaptive release requires a terminal winner decision" };
    if (!Number.isInteger(d.sample_count) || d.sample_count < Math.max(1, minimum))
        return { eligible: false, reason: "adaptive release sample requirement is not satisfied" };
    return { eligible: true, reason: "passing release verification with eligible adaptive evidence" };
}
async function fullEvalUnlocked(options) {
    const runProfile = parseRunProfile(options.runProfile), fixedRequestedPairs = options.repetitions ?? RUN_PROFILE_COUNTS[runProfile];
    if (!Number.isSafeInteger(fixedRequestedPairs) || fixedRequestedPairs < 1 || fixedRequestedPairs > 1024)
        throw new TypeError("repetitions must be a safe integer from 1 to 1024");
    let requestedPairs = fixedRequestedPairs, adaptivePolicy;
    const skill = resolve(options.skillPath), evalSet = resolve(options.evalSet ?? join(skill, "evals", "evals.json")), workspace = resolve(options.workspace ?? join(dirname(skill), basename(skill) + "-workspace", "iteration-1")), baseline = options.baseline ?? "without_skill";
    const statePath = join(workspace, STATE_FILE), persistedPolicy = existsSync(statePath) ? loadJson(statePath)?.decision_policy : undefined;
    const decision_policy = persistedPolicy ?? options.decisionPolicy ?? "fixed";
    const legacy = existsSync(statePath) && legacyMigrationNeeded(workspace);
    if (legacy) {
        if (decision_policy !== "fixed")
            throw new Error("legacy workspaces can only be migrated to fixed decision policy");
        if (options.dryRun)
            migrateFixedWorkspace(workspace, { dryRun: true });
        else if (options.resume) {
            const migration = migrateFixedWorkspace(workspace);
            if (migration.status !== "success")
                throw new Error(migration.reason ?? "historical fixed workspace migration blocked");
        }
        else
            throw new Error("historical fixed workspace requires `skill-creator migrate-evaluation <workspace> --dry-run` then migration, or unambiguous `full-eval --resume`");
    }
    const identity = { skill, workspace, eval_set: evalSet, baseline, decision_policy };
    let job = options.dryRun && legacy ? newJob(skill, workspace, evalSet, baseline, decision_policy) : loadJob(statePath, identity) ?? newJob(skill, workspace, evalSet, baseline, decision_policy);
    const migratedFixed = existsSync(join(workspace, ".full-eval-migration-receipt.json")) && job.decision_policy === "fixed";
    if (options.dryRun) {
        const planned = newJob(skill, workspace, evalSet, baseline, decision_policy);
        const [valid, message] = validateSkill(skill);
        planned.phases[0].status = valid ? "succeeded" : "failed";
        planned.phases[0].artifacts = [join(skill, "SKILL.md")];
        planned.phases[0].detail = message;
        return envelope(options, planned, valid ? "planned" : "failure", valid ? ["Rerun without --dry-run to scaffold and advance until external evidence is required."] : ["Fix skill validation errors, then rerun full-eval --resume."]);
    }
    mkdirSync(workspace, { recursive: true });
    const progress = new EvaluationProgress({ workspace, mode: options.progress ?? "auto", intervalMs: options.progressIntervalMs ?? 1000, now: options.now, isTTY: options.progressIsTTY ?? Boolean(process.stderr.isTTY), write: options.progressWrite ?? (text => writeSync(2, text)), onPublish: snapshot => { if (snapshot.provisional)
            writeProvisional(workspace, snapshot); } });
    const report = (event) => progress.emit(event);
    if (options.cancel) {
        job.status = "cancelled";
        const active = job.phases.find(p => p.status === "running" || p.status === "pending" || p.status === "blocked" || p.status === "stale");
        if (active) {
            active.status = "cancelled";
            active.detail = "cancelled by request";
        }
        checkpoint(job);
        report({ type: "phase-transition", phase: active?.name, status: "cancelled" });
        progress.close();
        return envelope(options, job, "cancelled", ["Rerun with --resume to continue this durable job."]);
    }
    if (job.status === "cancelled" && !options.resume) {
        report({ type: "phase-transition", status: "cancelled" });
        progress.close();
        return envelope(options, job, "cancelled", ["The job is cancelled. Rerun with --resume to continue it."]);
    }
    if (job.status === "cancelled" && options.resume) {
        const cancelled = job.phases.findIndex(p => p.status === "cancelled");
        if (cancelled >= 0)
            invalidateFrom(job, cancelled);
        job.status = "active";
        checkpoint(job);
    }
    let document;
    try {
        document = loadJson(evalSet);
    }
    catch {
        document = null;
    }
    const evals = Array.isArray(document) ? document : document?.evals;
    let aggregateBudget;
    try {
        if (Array.isArray(evals)) {
            const ids = new Set();
            for (const [index, item] of evals.entries()) {
                const id = assertPortableScenarioId(item?.id ?? index + 1);
                if (ids.has(id))
                    throw new Error("duplicate eval id: " + id);
                ids.add(id);
            }
            if (decision_policy === "adaptive") {
                const persistedAdaptivePolicy = options.finalizeRelease ? (() => { for (const id of [...ids].sort()) {
                    const path = join(workspace, "eval-" + id, "eval_metadata.json");
                    if (existsSync(path))
                        return loadJson(path)?.anytime_quality_policy;
                } return undefined; })() : undefined;
                adaptivePolicy = resolveAdaptivePolicy(options.adaptivePolicy ?? document?.anytime_quality_policy ?? persistedAdaptivePolicy, [...ids].sort(), fixedRequestedPairs);
                requestedPairs = adaptivePolicy.max_pairs;
                if (existsSync(join(workspace, ADAPTIVE_SCHEDULER_STATE)))
                    expectedRunDirs(workspace);
            }
            aggregateBudget = validateAggregateBudget(document, runProfile, evals, requestedPairs);
        }
    }
    catch (error) {
        const phase = job.phases.find(p => p.name === "evaluation-design");
        phase.status = "failed";
        phase.error = error.message;
        job.status = "failed";
        checkpoint(job);
        return envelope(options, job, "failure", ["Declare a validated aggregate_budget large enough for the requested repeated-run profile."], { incomplete: { code: "invalid-aggregate-budget", requested_pairs: requestedPairs, completed_pairs: 0 } });
    }
    const expectedPolicyHash = adaptivePolicy ? anytimeQualityPolicyHash(adaptivePolicy) : null;
    if (job.revision === 0 && job.initial_policy_hash === null)
        job.initial_policy_hash = expectedPolicyHash;
    if (job.initial_policy_hash !== expectedPolicyHash)
        throw new Error("existing full-eval initial policy hash is immutable");
    if (adaptivePolicy) {
        const protocol = options.finalizeRelease && job.sampling_protocol ? job.sampling_protocol : executionSamplingProtocol({ runner: options.runner, model: options.model, reasoning: options.reasoning, providerConstraints: options.providerConstraints, graders: options.graders, maxGraderCalls: options.maxGraderCalls, graderCommand: options.graderCommand, concurrency: options.concurrency, scenarioBudgets: Array.isArray(evals) ? evals.map((x, i) => ({ id: String(x.id ?? i + 1), timeoutSeconds: Number(x.budget?.timeout_seconds ?? 300), maxTurns: Number(x.budget?.max_turns ?? 40) })) : [] });
        const protocolHash = executionSamplingProtocolHash(protocol);
        if (job.sampling_protocol_hash && job.sampling_protocol_hash !== protocolHash)
            throw new Error("execution sampling protocol drift on resume; rounds cannot be mixed");
        job.sampling_protocol = protocol;
        job.sampling_protocol_hash = protocolHash;
        const family = adaptivePolicy.comparison_family, manifestPath = canonicalFamilyManifestPath(skill, family.family_id, options.familyWorkspace);
        const configuration = { schema_version: "2.0", family_id: family.family_id, global_alpha: family.global_alpha, comparisons: family.allocation_weights.map((weight, index) => ({ id: family.comparison_ids[index], index: index + 1, weight })) };
        const claimed = claimFamilyComparison(manifestPath, configuration, family.comparison_id, job.job_id, workspace);
        if (adaptivePolicy.alpha > claimed.claim.allocated_alpha + Number.EPSILON)
            throw new Error("campaign alpha exceeds durable family allocation");
        if (job.comparison_claim) {
            const prior = job.comparison_claim, current = claimed.claim;
            if (prior.comparison_id !== current.comparison_id || prior.comparison_index !== current.comparison_index || prior.campaign_id !== current.campaign_id || prior.campaign_workspace !== current.campaign_workspace || prior.allocated_alpha !== current.allocated_alpha)
                throw new Error("comparison family claim identity changed");
        }
        job.family_manifest_path = manifestPath;
        job.family_manifest_hash = claimed.manifest.configuration_hash;
        job.comparison_claim = claimed.claim;
    }
    const next = [];
    let receipt;
    let verification;
    let cacheAccounting;
    if (options.finalizeRelease && job.family_manifest_path) {
        const current = readFamilyManifest(job.family_manifest_path), claim = current.claims.find(x => x.campaign_id === job.job_id), published = existsSync(join(workspace, "receipt.json")) ? loadJson(join(workspace, "receipt.json")) : null;
        if (claim?.status === "verified-final" && published?.finalization?.family_authority?.state_sha256 === current.state_hash) {
            job.comparison_claim = claim;
            job.family_conclusion = familyConclusion(current);
            checkpoint(job);
            return envelope(options, job, "success", [], { receipt: validateEvaluationReceipt(workspace), verification: published, family_conclusion: job.family_conclusion });
        }
    }
    // Finalization is a publication transaction over already verified prepared evidence; it must not reschedule execution.
    if (options.finalizeRelease) {
        for (const phase of job.phases)
            if (phase.status === "succeeded" && artifactsMatch(phase))
                phase.input_hash = phaseInput(phase.name, job, options);
    }
    for (let index = 0; index < job.phases.length; index++) {
        const phase = job.phases[index], input = phaseInput(phase.name, job, options);
        const reusable = phase.status === "succeeded" && ((phase.input_hash === input && artifactsMatch(phase)) || (migratedFixed && phase.artifacts.every(artifactExists)));
        if (reusable)
            continue;
        if (phase.input_hash && phase.input_hash !== input)
            invalidateFrom(job, index);
        if (phase.status === "failed" && !options.resume && !options.retry) {
            job.status = "failed";
            return envelope(options, job, "failure", ["Rerun full-eval --resume or --retry after fixing the reported error."]);
        }
        phase.status = "running";
        phase.attempts += 1;
        phase.input_hash = input;
        delete phase.error;
        checkpoint(job);
        report({ type: "phase-transition", phase: phase.name, status: "running" });
        try {
            if (phase.name === "validate") {
                const [valid, message] = validateSkill(skill);
                phase.artifacts = [join(skill, "SKILL.md")];
                phase.detail = message;
                if (!valid)
                    throw new Error(message);
            }
            else if (phase.name === "authoring-audit") {
                const audit = auditSkill(skill), path = join(workspace, "authoring-audit.json");
                atomicJson(path, audit);
                phase.artifacts = [path];
                phase.detail = audit.status + (audit.summary.warnings ? ` (${audit.summary.warnings} warning(s))` : "");
                if (audit.status === "fail")
                    throw new Error(audit.findings.filter(f => f.severity === "error").map(f => `[${f.rule}] ${f.message}`).join("; "));
            }
            else if (phase.name === "evaluation-design") {
                const design = designEvals(evalSet, skill), path = join(workspace, "evaluation-design.json");
                atomicJson(path, design);
                phase.artifacts = [path];
                phase.detail = design.status + (design.summary.warnings ? ` (${design.summary.warnings} warning(s))` : "");
                if (design.status === "fail")
                    throw new Error(design.findings.filter(f => f.severity === "error").map(f => `[${f.rule}] ${f.message}`).join("; "));
            }
            else if (phase.name === "scaffold") {
                if (!Array.isArray(evals) || !evals.length)
                    throw new Error("eval set must contain a non-empty evals array");
                const artifacts = [];
                const { source, evalPlan } = planHashes(job);
                const archived = reconcileScenarioDirs(workspace, evals, evalPlan);
                for (let i = 0; i < evals.length; i++) {
                    const item = evals[i] ?? {}, rawId = item.id ?? i + 1, id = assertPortableScenarioId(rawId), ed = scenarioDirectory(workspace, id), metadata = join(ed, "eval_metadata.json");
                    const scenario = { eval_id: rawId, eval_name: item.name ?? slug(item.prompt), subject: item.subject ?? "", language: item.language ?? "", target: item.target ?? {}, preconditions: item.preconditions ?? [], budget: item.budget ?? {}, model: item.model ?? null, reasoning: options.reasoning ?? null, prompt: item.prompt ?? item.query ?? "", expected_output: item.expected_output ?? "", assertions: item.assertions ?? [], files: item.files ?? [], capabilities: item.capabilities ?? { filesystem: true, agent_runner: true, browser: false, network: false, tools: [] }, coverage_tags: item.coverage_tags ?? [], navigation_expectations: item.navigation_expectations ?? { must_read: [], read_when_relevant: [], must_not_read: [] }, quality_requirement: { minimum_candidate_pass_rate: options.minPassRate ?? 0.8, minimum_delta: options.minDelta ?? 0 } };
                    const executionBinding = { skill_source_sha256: source, eval_plan_sha256: evalPlan, scenario_sha256: digest([JSON.stringify(scenario)]), reasoning: options.reasoning ?? null, matrix_binding: options.matrixBinding ?? null, decision_policy: job.decision_policy, initial_policy_hash: job.initial_policy_hash, ...(adaptivePolicy ? { family_manifest_hash: job.family_manifest_hash, comparison_claim: job.comparison_claim, sampling_protocol_hash: job.sampling_protocol_hash, sampling_protocol: job.sampling_protocol } : {}) };
                    const executionSchedule = schedulePairs(executionBinding, requestedPairs);
                    const evidence_mode = { schema_version: 1, planned: options.execute ? (options.gradingMode === "delegated" ? "delegated-grading" : "goose-evaluator") : "manual-governed-import" };
                    // A scenario with semantic assertions must have an explicit grader
                    // plan: no implicit "default" model, and never two graders
                    // silently sharing the candidate's own model (that provides no
                    // real independence). --grader id=model is required per ap-8di.7
                    // once execution is requested; without --execute this is a dry
                    // scaffold and grading never runs, so it is not required yet.
                    if (options.execute && !options.graders?.length && normalizeAssertions(scenario.assertions).some(a => a.classification === "semantic"))
                        throw new Error(`Scenario ${id} has semantic assertions and --execute was requested, but no --grader id=model was supplied. Semantic grading requires at least one explicit grader; an implicit default model is not permitted.`);
                    const plannedGraders = (options.graders ?? [{ id: "grader-a", model: options.model ?? "default" }, { id: "grader-b", model: options.model ?? "default" }]).map(g => ({ id: g.id, model: g.model, provider: "unspecified", command: [], config: {}, blinded: true }));
                    const source_bindings = { with_skill: artifactHash(skill), without_skill: null, old_skill: options.baselineSkillPath ? artifactHash(resolve(options.baselineSkillPath)) : null };
                    const fixture_sha256 = compositeHash(scenario.files.flatMap(file => [file, artifactHash(resolve(skill, file))]));
                    const grading_plan = { schema_version: 1, evidence: "grader-evidence", graders: plannedGraders };
                    const normalized = { ...scenario, run_profile: runProfile, requested_pairs: requestedPairs, decision_policy: adaptivePolicy ? "adaptive" : "fixed", ...(adaptivePolicy ? { anytime_quality_policy: adaptivePolicy } : {}), baseline_configuration: baseline, aggregate_budget: aggregateBudget, evidence_mode, grading_plan, source_bindings, fixture_sha256, execution_schedule: executionSchedule, execution_binding: { ...executionBinding, evidence_mode_sha256: evidenceModeHash(evidence_mode), grading_plan_sha256: gradingSha256(gradingCanonical(grading_plan)) } };
                    artifacts.push(metadata);
                    atomicJson(metadata, normalized);
                    for (const config of ["with_skill", baseline]) {
                        const configDir = join(ed, config);
                        mkdirSync(configDir, { recursive: true });
                        for (const name of readdirSync(configDir).filter(n => /^run-\d+$/.test(n))) {
                            const runIndex = Number(name.slice(4));
                            if (runIndex > requestedPairs) {
                                const archive = join(workspace, ".full-eval-archive", evalPlan);
                                mkdirSync(archive, { recursive: true });
                                renameSync(join(configDir, name), join(archive, "surplus-" + id + "-" + config + "-" + name));
                            }
                        }
                        for (let run = 1; run <= requestedPairs; run++)
                            mkdirSync(join(configDir, "run-" + run, "outputs"), { recursive: true });
                    }
                }
                phase.artifacts = artifacts;
                phase.detail = archived.length ? `archived ${archived.length} scenario workspace(s) not present in the current eval plan` : undefined;
                progress.setTotal(expectedRunDirs(workspace).length);
            }
            else if (phase.name === "paired-runs-and-grading") {
                const delegated = options.gradingMode === "delegated";
                // In delegated mode, once every scheduled run already has completed
                // candidate output and its grading has been finalized by
                // import-grading (delegated-evaluator authority, no longer the
                // pending no-adapter state), skip executePairedRuns entirely: a
                // resume must never re-run candidate execution or clobber
                // already-imported delegated grading evidence with a fresh
                // no-adapter grading.json.
                const alreadyFinalizedDelegated = delegated && !pendingDelegatedGrading(workspace).pending && requiredRunDirs(workspace).every(dir => existsSync(join(dir, "grading.json")));
                if (options.execute && !alreadyFinalizedDelegated) {
                    progress.setTotal(expectedRunDirs(workspace).length);
                    const execution = await executePairedRuns({ skillPath: skill, workspace, baseline, baselineSkillPath: options.baselineSkillPath, runner: options.runner, model: options.model ?? null, reasoning: options.reasoning, graders: options.graders, graderCommand: options.graderCommand, maxGraderCalls: options.maxGraderCalls, concurrency: options.concurrency, providerConstraints: options.providerConstraints, providerIdentity: options.matrixBinding ? { provider: options.matrixBinding.provider, model: options.model ?? "default" } : undefined, cacheDir: options.cacheDir, onProgress: report, adaptivePolicy, maxPairRounds: options.maxPairRounds, ...(delegated ? { graderAdapter: null } : {}) });
                    cacheAccounting = execution.cache;
                    if (execution.status !== "complete") {
                        phase.status = execution.status === "blocked" ? "blocked" : "failed";
                        phase.detail = `paired execution ${execution.status}`;
                        phase.error = execution.failures.map(f => `${rel(workspace, f.run)} [${f.code}]: ${f.message}`).join("; ");
                        job.status = execution.status === "blocked" ? "blocked" : "failed";
                        checkpoint(job);
                        report({ type: "phase-transition", phase: phase.name, status: phase.status, detail: phase.error });
                        progress.close();
                        return envelope(options, job, execution.status === "blocked" ? "blocked" : "failure", execution.failures.map(f => `Paired run ${rel(workspace, f.run)} failed (${f.code}, ${f.exit_reason}): ${f.message}. Manual evidence remains supported; preserve or replace artifacts and rerun --resume.`), { execution, incomplete: { code: "incomplete-paired-runs", requested_pairs: requestedPairs, completed_runs: execution.completed.length, required_runs: execution.requested } });
                    }
                }
                const missing = missingRuns(workspace), { source, evalPlan } = planHashes(job), requiredRuns = requiredRunDirs(workspace);
                phase.artifacts = requiredRuns;
                const binding = validateExecutionEvidence(workspace, { skill_source_sha256: source, eval_plan_sha256: evalPlan });
                if (options.gradingMode === "delegated" && !missing.outputs.length && !missing.gradings.length && !missing.timings.length && binding.status !== "complete") {
                    const pending = pendingDelegatedGrading(workspace);
                    if (pending.pending) {
                        phase.status = "blocked";
                        phase.detail = "awaiting delegated semantic grading";
                        const awaitingActions = [
                            "Run 'skill-creator prepare-grading " + workspace + "' to write pending blinded grading requests.",
                            "Delegate each pending request to an isolated Goose subagent using the request's own grader.model/provider (see skills/skill-creator/references/delegated-grading-workflow.md), and write each verdict to a matching file under " + join(workspace, "grading-judgments") + ".",
                            "Run 'skill-creator import-grading " + workspace + "' to validate and import the judgments.",
                            "Rerun 'skill-creator full-eval " + skill + " --workspace " + workspace + " --resume' once import-grading reports ready_to_resume.",
                        ];
                        job.status = "blocked";
                        checkpoint(job);
                        report({ type: "phase-transition", phase: phase.name, status: "blocked", detail: "awaiting-grading" });
                        progress.close();
                        return envelope(options, job, "awaiting-grading", awaitingActions, { incomplete: { code: "awaiting-delegated-grading", requested_pairs: requestedPairs, completed_runs: requiredRuns.length - pending.runs.length, required_runs: requiredRuns.length, pending_runs: pending.runs.map(run => rel(workspace, run)) } });
                    }
                }
                if (missing.outputs.length || missing.gradings.length || missing.timings.length || binding.status !== "complete") {
                    phase.status = "blocked";
                    phase.detail = "full-eval does not run or impersonate an LLM";
                    for (const p of missing.outputs)
                        next.push("Produce the paired agent output in " + join(workspace, p) + " (LLM or human execution required).");
                    for (const p of missing.gradings)
                        next.push("Create LLM- or human-produced grading at " + join(workspace, p) + ".");
                    for (const p of missing.timings)
                        next.push("Record timing data (use null values with an unavailable reason) at " + join(workspace, p) + ".");
                    for (const error of binding.errors)
                        next.push("Regenerate bound execution evidence: " + error + ".");
                    next.push("Each execution-evidence.json must bind current skill/eval/scenario hashes, configuration, run index, and artifact content hashes.");
                    next.push("Rerun full-eval with --resume after preserving those artifacts.");
                    job.status = "blocked";
                    checkpoint(job);
                    report({ type: "phase-transition", phase: phase.name, status: "blocked" });
                    progress.close();
                    return envelope(options, job, "blocked", next, { incomplete: { code: "incomplete-paired-runs", requested_pairs: requestedPairs, completed_runs: requiredRuns.filter(run => isDir(join(run, "outputs")) && readdirSync(join(run, "outputs")).some(name => name !== ".keep") && existsSync(join(run, ["grading", "json"].join("."))) && existsSync(join(run, ["timing", "json"].join(".")))).length, required_runs: requiredRuns.length } });
                }
                if (adaptivePolicy && job.family_manifest_path) {
                    const decisionPath = join(workspace, ["anytime-quality-decision", "json"].join("."));
                    if (!existsSync(decisionPath))
                        throw new Error("adaptive comparison has no final decision artifact");
                    prepareFamilyComparison(job.family_manifest_path, job.job_id, fileDigest(decisionPath));
                    checkpoint(job);
                }
            }
            else if (phase.name === "aggregate") {
                const decisionPolicy = options.decisionPolicy ?? "fixed";
                const agg = await execute("aggregate_benchmark.js", [workspace, "--skill-name", basename(skill), "--skill-path", skill, "--decision-policy", decisionPolicy]);
                phase.artifacts = [join(workspace, "benchmark.json"), join(workspace, "benchmark.md"), ...(decisionPolicy === "adaptive" ? [join(workspace, ["anytime-quality-decision", "json"].join("."))] : [])];
                phase.detail = agg.detail;
                if (!agg.ok)
                    throw new Error(agg.detail || "aggregation failed");
                const bp = join(workspace, "benchmark.json"), benchmark = loadJson(bp), { source, evalPlan } = planHashes(job), evidence = validateExecutionEvidence(workspace, { skill_source_sha256: source, eval_plan_sha256: evalPlan });
                if (evidence.status !== "complete")
                    throw new Error(evidence.errors.join("; "));
                benchmark.status = "complete";
                benchmark.provisional = false;
                benchmark.final_receipt = true;
                benchmark.canonical = true;
                benchmark.historical = false;
                benchmark.metadata = { ...(benchmark.metadata ?? {}), source_sha256: source, eval_plan_sha256: evalPlan, execution_evidence_sha256: evidence.evidence_sha256 };
                atomicJson(bp, benchmark);
            }
            else if (phase.name === "static-review") {
                const bp = join(workspace, "benchmark.json"), path = join(workspace, "review.html"), review = await execute("../eval-viewer/generate_review.js", [workspace, "--skill-name", basename(skill), "--benchmark", bp, "--static", path]);
                phase.artifacts = [path];
                phase.detail = review.detail;
                if (!review.ok)
                    throw new Error(review.detail || "static review failed");
            }
            else if (phase.name === "receipt") {
                progress.finalize("receipt");
                receipt = validateEvaluationReceipt(workspace);
                phase.artifacts = [join(workspace, "benchmark.json"), join(workspace, "benchmark.md"), join(workspace, "review.html"), ...requiredRunDirs(workspace)];
                phase.detail = receipt.missing.join(", ") || "complete";
                if (receipt.status !== "complete") {
                    phase.status = "blocked";
                    job.status = "blocked";
                    checkpoint(job);
                    report({ type: "phase-transition", phase: phase.name, status: "blocked" });
                    progress.close();
                    return envelope(options, job, "blocked", receipt.missing.map((p) => "Provide required evaluation artifact: " + join(workspace, p) + "."), { receipt });
                }
            }
            else if (phase.name === "post-evaluation-pattern-review") {
                const path = join(workspace, "post-evaluation-pattern-review.json"), analysis = analyzeEvaluation(workspace, skill);
                atomicJson(path, analysis);
                phase.artifacts = [path];
                phase.detail = analysis.decision + "; " + analysis.failures.length + " failed expectation(s) mapped to patterns";
                if (analysis.status === "blocked") {
                    phase.status = "blocked";
                    job.status = "blocked";
                    checkpoint(job);
                    report({ type: "phase-transition", phase: phase.name, status: "blocked" });
                    progress.close();
                    return envelope(options, job, "blocked", ["Complete evaluation evidence, then rerun full-eval --resume."], { receipt });
                }
            }
            else if (phase.name === "verify") {
                verification = verifySkill({ skillPath: skill, profile: runProfile === "release" ? "release" : "evaluation", evaluation: workspace, humanReview: options.humanReview, testsStatus: options.testsStatus, triggeringStatus: options.triggeringStatus, triggeringReason: options.triggeringReason, minPassRate: options.minPassRate, minDelta: options.minDelta });
                const path = join(workspace, "receipt.json");
                atomicJson(path, verification);
                phase.artifacts = [join(workspace, "benchmark.json"), join(workspace, "review.html"), path];
                phase.detail = verification.status;
                if (verification.status !== "pass") {
                    phase.status = verification.status === "fail" ? "failed" : "blocked";
                    job.status = verification.status === "fail" ? "failed" : "blocked";
                    checkpoint(job);
                    if (!options.humanReview)
                        next.push("Human decision required: review " + join(workspace, "review.html") + "; this checkpoint is blocked, not failed.");
                    if (!options.testsStatus)
                        next.push("Provide deterministic test evidence with --tests-status pass|fail|blocked.");
                    report({ type: "phase-transition", phase: phase.name, status: phase.status });
                    progress.close();
                    return envelope(options, job, verification.status, next, { receipt: receipt ?? validateEvaluationReceipt(workspace), verification });
                }
            }
            phase.status = "succeeded";
            captureArtifactHashes(phase);
            checkpoint(job);
            report({ type: "phase-transition", phase: phase.name, status: "succeeded" });
        }
        catch (error) {
            phase.status = "failed";
            phase.error = error.message;
            job.status = "failed";
            checkpoint(job);
            report({ type: "phase-transition", phase: phase.name, status: "failed", detail: phase.error });
            progress.close();
            return envelope(options, job, "failure", ["Fix the reported error and rerun full-eval --resume or --retry."]);
        }
    }
    // Compatibility inventory marker for the nested result copy: {receipt,verification});
    if (job.status !== "succeeded") {
        job.status = "succeeded";
        checkpoint(job);
    }
    receipt = receipt ?? validateEvaluationReceipt(workspace);
    verification = verification ?? (existsSync(join(workspace, "receipt.json")) ? loadJson(join(workspace, "receipt.json")) : undefined);
    if (job.family_manifest_path) {
        const decisionPath = join(workspace, "anytime-quality-decision.json"), releasePath = join(workspace, "release-verification.json"), existingClaim = readFamilyManifest(job.family_manifest_path).claims.find(x => x.campaign_id === job.job_id);
        if (options.finalizeRelease) {
            verification = existingClaim?.status === "verified-final" && existsSync(releasePath) ? loadJson(releasePath) : verifySkill({ skillPath: skill, profile: "release", evaluation: workspace, humanReview: options.humanReview, testsStatus: options.testsStatus, triggeringStatus: options.triggeringStatus, triggeringReason: options.triggeringReason, minPassRate: options.minPassRate, minDelta: options.minDelta });
        }
        const eligibility = releaseEvidenceEligible(verification);
        if ((runProfile === "release" || options.finalizeRelease) && eligibility.eligible) {
            atomicJson(releasePath, verification);
            const manifest = finalizeFamilyComparison(job.family_manifest_path, job.job_id, fileDigest(decisionPath), fileDigest(releasePath));
            if (process.env.SKILL_CREATOR_TEST_CRASH_AFTER_FAMILY_FINALIZATION === "1")
                throw new Error("injected crash after family finalization");
            job.comparison_claim = manifest.claims.find(x => x.campaign_id === job.job_id) ?? job.comparison_claim;
            job.family_conclusion = familyConclusion(manifest);
            job.family_authority = { configuration_sha256: manifest.configuration_hash, state_sha256: manifest.state_hash, revision: manifest.revision, release_verification_sha256: fileDigest(releasePath), provenance_layering: ["execution-evidence", "release-verification", "family-authority", "canonical-publication"] };
            checkpoint(job);
            const agg = await execute("aggregate_benchmark.js", [workspace, "--skill-name", basename(skill), "--skill-path", skill, "--decision-policy", "adaptive"]);
            if (!agg.ok)
                throw new Error(agg.detail || "final authority republication failed");
            const benchmarkPath = join(workspace, "benchmark.json"), benchmark = loadJson(benchmarkPath), publicationHashes = planHashes(job), publicationEvidence = validateExecutionEvidence(workspace, { skill_source_sha256: publicationHashes.source, eval_plan_sha256: publicationHashes.evalPlan });
            benchmark.status = "complete";
            benchmark.provisional = false;
            benchmark.final_receipt = true;
            benchmark.canonical = true;
            benchmark.historical = false;
            benchmark.metadata = { ...(benchmark.metadata ?? {}), source_sha256: publicationHashes.source, eval_plan_sha256: publicationHashes.evalPlan, execution_evidence_sha256: publicationEvidence.evidence_sha256, comparison_claim: job.comparison_claim, family_conclusion: job.family_conclusion, family_authority: job.family_authority };
            benchmark.campaign = { ...(benchmark.campaign ?? {}), comparison_claim: job.comparison_claim, family_conclusion: job.family_conclusion, family_authority: job.family_authority };
            atomicJson(benchmarkPath, benchmark);
            const review = await execute("../eval-viewer/generate_review.js", [workspace, "--skill-name", basename(skill), "--benchmark", benchmarkPath, "--static", join(workspace, "review.html")]);
            if (!review.ok)
                throw new Error(review.detail || "final review republication failed");
            verification = verifySkill({ skillPath: skill, profile: "release", evaluation: workspace, humanReview: options.humanReview, testsStatus: options.testsStatus, triggeringStatus: options.triggeringStatus, triggeringReason: options.triggeringReason, minPassRate: options.minPassRate, minDelta: options.minDelta });
            verification.finalization = { comparison_claim: job.comparison_claim, family_conclusion: job.family_conclusion, family_authority: job.family_authority };
            atomicJson(join(workspace, "receipt.json"), verification);
            const vp = job.phases.find(p => p.name === "verify");
            vp.artifacts = [benchmarkPath, join(workspace, "review.html"), join(workspace, "receipt.json"), releasePath];
            captureArtifactHashes(vp);
            checkpoint(job);
        }
        else {
            if (options.finalizeRelease) {
                job.family_conclusion = familyConclusion(readFamilyManifest(job.family_manifest_path));
                checkpoint(job);
                progress.close();
                return envelope(options, job, verification?.status === "fail" ? "failure" : "blocked", [eligibility.reason], { receipt, verification, family_conclusion: job.family_conclusion });
            }
            const manifest = readFamilyManifest(job.family_manifest_path);
            job.comparison_claim = manifest.claims.find(x => x.campaign_id === job.job_id) ?? job.comparison_claim;
            job.family_conclusion = familyConclusion(manifest);
            checkpoint(job);
        }
    }
    progress.finalize("verify");
    progress.close();
    return envelope(options, job, "success", job.family_manifest_path && job.comparison_claim?.status !== "verified-final" ? ["Run full-eval --finalize-release with passing release gates to finalize this prepared family claim."] : [], { receipt, verification, ...(job.family_manifest_path ? { family_conclusion: job.family_conclusion } : {}), ...(cacheAccounting ? { cache: cacheAccounting } : {}) });
}
async function acquireJobLock(workspace) { return acquireDirectoryLock(join(workspace, ".full-eval-orchestration-lock"), { timeoutMs: 15_000, staleMs: 300_000 }); }
export async function fullEval(options) {
    if (options.dryRun)
        return fullEvalUnlocked(options);
    const skill = resolve(options.skillPath), workspace = resolve(options.workspace ?? join(dirname(skill), basename(skill) + "-workspace", "iteration-1")), release = await acquireJobLock(workspace);
    try {
        return await fullEvalUnlocked({ ...options, workspace });
    }
    finally {
        release();
    }
}
export async function main() {
    try {
        const argv = process.argv.slice(2);
        if (argv.includes("--help") || argv.includes("-h")) {
            console.log(FULL_EVAL_HELP);
            return 0;
        }
        const { positionals, values } = parseArgs({ args: argv, allowPositionals: true, options: { workspace: { type: "string" }, "eval-set": { type: "string" }, baseline: { type: "string", default: "without_skill" }, "baseline-skill": { type: "string" }, execute: { type: "boolean", default: false }, runner: { type: "string" }, model: { type: "string" }, grader: { type: "string", multiple: true }, "grader-command": { type: "string" }, "grading-mode": { type: "string", default: "subprocess" }, "max-grader-calls": { type: "string", default: "100" }, concurrency: { type: "string", default: "2" }, "provider-concurrency": { type: "string" }, "provider-rpm": { type: "string" }, "provider-max-attempts": { type: "string" }, "provider-backoff-base-ms": { type: "string" }, "provider-backoff-max-ms": { type: "string" }, "provider-active-lease-ms": { type: "string" }, "max-cost-usd": { type: "string" }, "max-tokens": { type: "string" }, "max-provider-seconds": { type: "string" }, "reserve-cost-usd": { type: "string" }, "reserve-tokens": { type: "string" }, "reserve-provider-seconds": { type: "string" }, "cache-dir": { type: "string" }, "no-cache": { type: "boolean", default: false }, progress: { type: "string", default: "auto" }, "progress-interval": { type: "string", default: "1000" }, "run-profile": { type: "string", default: "fast" }, "decision-policy": { type: "string", default: "fixed" }, "adaptive-policy": { type: "string" }, "family-workspace": { type: "string" }, "dry-run": { type: "boolean", default: false }, resume: { type: "boolean", default: false }, retry: { type: "boolean", default: false }, cancel: { type: "boolean", default: false }, "finalize-release": { type: "boolean", default: false }, "human-review": { type: "string" }, "tests-status": { type: "string" }, "triggering-status": { type: "string" }, "triggering-reason": { type: "string" }, "min-pass-rate": { type: "string", default: "0.8" }, "min-delta": { type: "string", default: "0" } } });
        if (!positionals[0])
            throw new TypeError("skill directory is required");
        if (values.baseline !== "old_skill" && values.baseline !== "without_skill")
            throw new TypeError("--baseline must be old_skill or without_skill");
        if (values["decision-policy"] !== "fixed" && values["decision-policy"] !== "adaptive")
            throw new TypeError("--decision-policy must be fixed or adaptive");
        if (values["adaptive-policy"] && values["decision-policy"] !== "adaptive")
            throw new TypeError("--adaptive-policy requires --decision-policy adaptive");
        const graderValues = values.grader ?? [];
        const graders = graderValues.map((value, index) => { const split = value.indexOf("="); return split < 0 ? { id: `grader-${index + 1}`, model: value } : { id: value.slice(0, split), model: value.slice(split + 1) }; });
        if (graders.some(item => !item.id || !item.model) || new Set(graders.map(item => item.id)).size !== graders.length)
            throw new TypeError("--grader requires unique non-empty id=model values");
        if (values["grading-mode"] !== "subprocess" && values["grading-mode"] !== "delegated")
            throw new TypeError("--grading-mode must be subprocess or delegated");
        const maxGraderCalls = Number(values["max-grader-calls"]);
        if (!Number.isInteger(maxGraderCalls) || maxGraderCalls < 0)
            throw new TypeError("--max-grader-calls must be a non-negative integer");
        const concurrency = Number(values.concurrency);
        if (!Number.isInteger(concurrency) || concurrency < 1)
            throw new TypeError("--concurrency must be a positive integer");
        const numberOption = (name, integer = false) => { const raw = values[name]; if (raw === undefined)
            return undefined; const value = Number(raw); if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value)))
            throw new TypeError("--" + name + " must be a non-negative " + (integer ? "integer" : "number")); return value; };
        const providerConstraints = { concurrency: numberOption("provider-concurrency", true), requestsPerMinute: numberOption("provider-rpm"), maxAttempts: numberOption("provider-max-attempts", true), baseBackoffMs: numberOption("provider-backoff-base-ms"), maxBackoffMs: numberOption("provider-backoff-max-ms"), activeLeaseMs: numberOption("provider-active-lease-ms", true), maxCostUsd: numberOption("max-cost-usd"), maxTokens: numberOption("max-tokens", true), maxProviderSeconds: numberOption("max-provider-seconds"), reserveCostUsd: numberOption("reserve-cost-usd"), reserveTokens: numberOption("reserve-tokens", true), reserveProviderSeconds: numberOption("reserve-provider-seconds") };
        const configuredProviderConstraints = Object.values(providerConstraints).some(value => value !== undefined) ? validateProviderConstraints(providerConstraints) : undefined;
        if (values["cache-dir"] && values["no-cache"])
            throw new TypeError("--cache-dir and --no-cache are mutually exclusive");
        if (!["auto", "terminal", "jsonl", "none"].includes(String(values.progress)))
            throw new TypeError("--progress must be auto, terminal, jsonl, or none");
        const progressIntervalMs = Number(values["progress-interval"]);
        if (!Number.isFinite(progressIntervalMs) || progressIntervalMs < 0)
            throw new TypeError("--progress-interval must be a non-negative number of milliseconds");
        const cacheDir = values["no-cache"] ? null : values["cache-dir"] ? resolve(values["cache-dir"]) : undefined;
        const result = await fullEval({ skillPath: positionals[0], workspace: values.workspace, evalSet: values["eval-set"], baseline: values.baseline, baselineSkillPath: values["baseline-skill"], execute: values.execute, runner: values.runner, model: values.model, graders: graders.length ? graders : undefined, graderCommand: values["grader-command"], gradingMode: values["grading-mode"], maxGraderCalls, concurrency, providerConstraints: configuredProviderConstraints, cacheDir, progress: values.progress, progressIntervalMs, runProfile: parseRunProfile(values["run-profile"]), decisionPolicy: values["decision-policy"], adaptivePolicy: values["adaptive-policy"] ? JSON.parse(values["adaptive-policy"]) : undefined, familyWorkspace: values["family-workspace"], dryRun: values["dry-run"], resume: values.resume, retry: values.retry, cancel: values.cancel, finalizeRelease: values["finalize-release"], humanReview: values["human-review"], testsStatus: values["tests-status"], triggeringStatus: values["triggering-status"], triggeringReason: values["triggering-reason"], minPassRate: Number(values["min-pass-rate"]), minDelta: Number(values["min-delta"]) });
        console.log(JSON.stringify(result, null, 2));
        return result.exit_code;
    }
    catch (error) {
        const argv = process.argv.slice(2), message = error.message;
        if (argv.some(x => x === "--resume" || x === "--retry") || /migration|legacy|workspace schema|statistical bindings|decision policy/i.test(message)) {
            console.log(JSON.stringify(failureEnvelopeFromArgv(argv, message), null, 2));
            return 1;
        }
        console.error("full_eval: " + message);
        return 2;
    }
}
const invoked = process.argv[1] ? resolve(process.argv[1]) : null;
if (!import.meta.url.includes("/$bunfs/") && invoked && fileURLToPath(import.meta.url) === invoked)
    process.exitCode = await main();
