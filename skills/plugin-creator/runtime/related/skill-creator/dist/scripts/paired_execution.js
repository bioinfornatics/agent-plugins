// Execute every scaffolded current/baseline run in a fresh isolated workspace.
import { cpSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { artifactHash, compositeHash, expectedExecutionBinding, expectedRunDirs, runCoordinates } from "./evaluation_provenance.js";
import { createRunner } from "./runners/index.js";
import { CommandGraderAdapter, gradeOutput, sha256 as gradingSha256 } from "./evaluator_grading.js";
import { configuredGooseArgv } from "./runners/goose.js";
import { PairedExecutionError } from "./runners/paired.js";
import { ProviderScheduler, providerModelKey } from "./provider_constraints.js";
import { EvaluationRunStore, evaluationRunIdentity } from "./evaluation_run_store.js";
import { EvaluationArtifactCache, validatedCompleteArtifactDigest } from "./evaluation_artifact_cache.js";
import { EXECUTION_TELEMETRY_PARSER_PROTOCOL, EXECUTION_TELEMETRY_SCHEMA_VERSION } from "./execution_efficiency.js";
import { ADAPTIVE_SCHEDULER_STATE, acquireAdaptiveLock, adaptivePlanFromRuns, deriveSuperseded, persistAdaptiveState, readAdaptiveState, recordAdaptiveLook } from "./adaptive_scheduling.js";
import { executionSamplingProtocol, executionSamplingProtocolHash } from "./execution_sampling_protocol.js";
import { ANYTIME_QUALITY_ARTIFACT_FILE, persistAnytimeQualityResult } from "./anytime_quality.js";
function json(path) { return JSON.parse(readFileSync(path, "utf8")); }
function atomic(path, value) { const temp = `${path}.tmp-${process.pid}-${randomUUID()}`; writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 }); renameSync(temp, path); }
function contained(root, path) { const rel = relative(realpathSync(root), realpathSync(path)); return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)); }
function fixtureSources(metadata, evalDir, skillPath) { const files = Array.isArray(metadata.files) ? metadata.files.map(String) : []; return files.map((file) => { if (isAbsolute(file))
    throw new PairedExecutionError("invalid-plan", `Fixture path must be relative: ${file}`, "invalid-plan"); const roots = [skillPath, evalDir, dirname(evalDir)]; for (const root of roots) {
    const path = resolve(root, file);
    if (existsSync(path) && contained(root, path))
        return { source: path, target: file };
} throw new PairedExecutionError("invalid-plan", `Fixture is missing or escapes its scenario root: ${file}`, "invalid-plan"); }); }
function assertNoSymlinks(path) { if (lstatSync(path).isSymbolicLink())
    throw new PairedExecutionError("invalid-plan", `Fixture symlinks are not allowed: ${path}`, "invalid-plan"); if (lstatSync(path).isDirectory())
    for (const name of readdirSync(path))
        assertNoSymlinks(join(path, name)); }
function fixtureHash(fixtures) { return compositeHash(fixtures.flatMap(item => [item.target, artifactHash(item.source)])); }
function stage(source, skillName, fixtures) { const cwd = mkdtempSync(join(tmpdir(), "skill-paired-run-")); if (source) {
    mkdirSync(join(cwd, ".agents", "skills"), { recursive: true });
    cpSync(source, join(cwd, ".agents", "skills", skillName), { recursive: true, dereference: false });
} for (const fixture of fixtures) {
    assertNoSymlinks(fixture.source);
    const target = resolve(cwd, fixture.target);
    if (relative(cwd, target).startsWith(".."))
        throw new PairedExecutionError("invalid-plan", `Fixture target escapes workspace: ${fixture.target}`, "invalid-plan");
    mkdirSync(dirname(target), { recursive: true });
    cpSync(fixture.source, target, { recursive: true, dereference: false });
} mkdirSync(join(cwd, "outputs"), { recursive: true }); return cwd; }
function persistOutcome(runDir, evidence, plan, status, failureCode, message, provider) { mkdirSync(join(runDir, "outputs"), { recursive: true }); writeFileSync(join(runDir, "transcript.json"), evidence.transcript); atomic(join(runDir, "events.json"), evidence.events); atomic(join(runDir, "navigation" + ".json"), { schema_version: "1.0", read: evidence.telemetry.observed_references.map(item => item.reference), files_read: evidence.telemetry.observed_files.map(item => item.path), provenance: "execution_efficiency.runner-stream" }); atomic(join(runDir, "timing.json"), { total_duration_seconds: evidence.durationSeconds, tokens: null, total_tokens: null, token_availability_reason: "Execution did not complete", execution_efficiency: evidence.telemetry, host_version: evidence.hostVersion, exit_reason: evidence.exitReason, exit_code: evidence.exitCode, max_turns: plan.maxTurns ?? 40, timeout_seconds: plan.timeoutSeconds, seed: plan.seed, pair_index: plan.pairIndex, order_position: plan.orderPosition, status, failure_code: failureCode, message }); atomic(join(runDir, "execution-outcome.json"), { schema_version: "1.0", status, failure_code: failureCode, message, ...(provider ? { provider } : {}), host_version: evidence.hostVersion, exit_reason: evidence.exitReason, exit_code: evidence.exitCode, command: evidence.command, artifact_sha256: { "timing.json": artifactHash(join(runDir, "timing.json")), ["navigation" + ".json"]: artifactHash(join(runDir, "navigation" + ".json")), "transcript.json": artifactHash(join(runDir, "transcript.json")), "events.json": artifactHash(join(runDir, "events.json")) } }); }
async function writeEvidence(runDir, result, plan, source, metadata, graders, adapter, budget, bindingRunDir = runDir) { mkdirSync(join(runDir, "outputs"), { recursive: true }); writeFileSync(join(runDir, "outputs", "result.txt"), result.output); writeFileSync(join(runDir, "transcript.json"), result.transcript); atomic(join(runDir, "events.json"), result.events); atomic(join(runDir, "navigation" + ".json"), { schema_version: "1.0", read: result.telemetry.observed_references.map(item => item.reference), files_read: result.telemetry.observed_files.map(item => item.path), provenance: "execution_efficiency.runner-stream" }); const variantSha256 = gradingSha256(JSON.stringify({ configuration: plan.configuration, source_sha256: source ? artifactHash(source) : null, fixture_sha256: plan.fixtureSha256 })); const graded = await gradeOutput({ prompt: plan.prompt, output: result.output, assertions: plan.assertions, variantSha256, graders, adapter, budget, signal: plan.signal }); atomic(join(runDir, "deterministic-evidence.json"), { schema_version: 1, variant_sha256: variantSha256, output_sha256: graded.grading.output_sha256, assertions: graded.deterministic }); const graderDir = join(runDir, "grader-evidence"); mkdirSync(graderDir, { recursive: true }); for (const [index, item] of graded.graderEvidence.entries())
    atomic(join(graderDir, `${index + 1}-${item.grader_id}.json`), item); atomic(join(runDir, "grading.json"), graded.grading); atomic(join(runDir, "timing.json"), { total_duration_seconds: result.durationSeconds, tokens: result.tokens, total_tokens: result.tokens, token_availability_reason: result.tokenAvailabilityReason, execution_efficiency: result.telemetry, host_version: result.hostVersion, exit_reason: result.exitReason, exit_code: result.exitCode, max_turns: plan.maxTurns ?? 40, timeout_seconds: plan.timeoutSeconds, seed: plan.seed, pair_index: plan.pairIndex, order_position: plan.orderPosition, grader_usage: graded.graderEvidence.map(item => ({ grader_id: item.grader_id, model: item.model, usage: item.usage })) }); const binding = expectedExecutionBinding(bindingRunDir); if (!binding)
    throw new Error(`Missing execution binding for ${bindingRunDir}`); atomic(join(runDir, "execution-evidence.json"), { schema_version: "1.0", ...binding, pair_equivalence: { model: plan.model, reasoning: plan.reasoning ?? null, tools: plan.tools, fixture_sha256: plan.fixtureSha256, timeout_seconds: plan.timeoutSeconds, max_turns: plan.maxTurns ?? 40 }, grading_binding: { authority: "evaluator", assertion_set_sha256: graded.grading.assertion_set_sha256, variant_sha256: variantSha256, output_sha256: graded.grading.output_sha256, grader_identities: graders }, executor: { adapter: "goose", host_version: result.hostVersion, exit_reason: result.exitReason, command: result.command, seed: plan.seed, pair_index: plan.pairIndex, order_position: plan.orderPosition, executed_skill_sha256: source ? artifactHash(source) : null }, artifact_sha256: { outputs: artifactHash(join(runDir, "outputs")), "grading.json": artifactHash(join(runDir, "grading.json")), "timing.json": artifactHash(join(runDir, "timing.json")), ["navigation" + ".json"]: artifactHash(join(runDir, "navigation" + ".json")), "transcript.json": artifactHash(join(runDir, "transcript.json")), "events.json": artifactHash(join(runDir, "events.json")), "deterministic-evidence.json": artifactHash(join(runDir, "deterministic-evidence.json")), "grader-evidence": artifactHash(graderDir) } }); }
function clearGeneratedEvidence(runDir) { for (const name of ["outputs", "grader-evidence", "transcript" + ".json", "events" + ".json", "navigation" + ".json", "timing" + ".json", "execution-outcome" + ".json", "deterministic-evidence" + ".json", "grading" + ".json", "execution-evidence" + ".json", "run-identity" + ".json"])
    rmSync(join(runDir, name), { recursive: true, force: true }); mkdirSync(join(runDir, "outputs"), { recursive: true }); }
function orderedRunDirs(workspace) { return expectedRunDirs(workspace, true).sort((a, b) => { const am = json(join(dirname(dirname(a)), "eval_metadata.json")), bm = json(join(dirname(dirname(b)), "eval_metadata.json")); const ac = runCoordinates(a), bc = runCoordinates(b), ae = String(am.eval_id), be = String(bm.eval_id); if (ae !== be)
    return ae.localeCompare(be); if (ac.run_index !== bc.run_index)
    return ac.run_index - bc.run_index; const order = am.execution_schedule?.find((x) => x.pair_index === ac.run_index)?.order ?? ["with_skill", "baseline"]; const role = (c) => c === "with_skill" ? "with_skill" : "baseline"; return order.indexOf(role(ac.configuration)) - order.indexOf(role(bc.configuration)); }); }
function capabilities(value) { if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PairedExecutionError("capability-mismatch", "Scenario capabilities must be an object", "capability-mismatch"); return { filesystem: value.filesystem, agent_runner: value.agent_runner, browser: value.browser, network: value.network, tools: value.tools }; }
function runIdentity(metadata, plan, source, options, graders) {
    const runnerCommand = options.runner ?? "goose", samplingProtocol = metadata.execution_binding?.sampling_protocol ?? executionSamplingProtocol({ runner: options.runner, model: plan.model, reasoning: plan.reasoning, providerConstraints: options.providerConstraints, timeoutSeconds: plan.timeoutSeconds, maxTurns: plan.maxTurns, graders, maxGraderCalls: options.maxGraderCalls, graderCommand: options.graderCommand, concurrency: options.concurrency }), samplingProtocolHash = executionSamplingProtocolHash(samplingProtocol), graderCommand = options.graderCommand ?? process.env.SKILL_CREATOR_GRADER_COMMAND ?? "default";
    return evaluationRunIdentity({
        scenario: { id: metadata.eval_id, prompt: plan.prompt, assertions: plan.assertions, expected_output: metadata.expected_output ?? "", preconditions: metadata.preconditions ?? [], capabilities: metadata.capabilities ?? {} },
        variant: { configuration: String(plan.configuration), skill_source_sha256: source ? artifactHash(source) : null, source: metadata.source_bindings?.[String(plan.configuration)] ?? null },
        repetition: { seed: plan.seed ?? 0, index: plan.pairIndex ?? 0, order: metadata.execution_schedule?.find((item) => item.pair_index === plan.pairIndex)?.order ?? [] },
        inference: { model: plan.model, reasoning: plan.reasoning ?? metadata.reasoning ?? metadata.model_config?.reasoning ?? null },
        execution: { runner: { id: runnerCommand, command: configuredGooseArgv() }, telemetry: { schema_version: EXECUTION_TELEMETRY_SCHEMA_VERSION, parser_protocol: EXECUTION_TELEMETRY_PARSER_PROTOCOL }, host_environment: { platform: process.platform, arch: process.arch, node: process.version } },
        statistical_binding: { sampling_protocol: samplingProtocol, sampling_protocol_hash: samplingProtocolHash, anytime_policy_hash: options.adaptivePolicy ? JSON.stringify(options.adaptivePolicy) : null, comparison_family: options.adaptivePolicy?.comparison_family ?? null },
        resources: { tools: plan.tools, fixtures: { sha256: plan.fixtureSha256, files: metadata.files ?? [] }, budgets: { execution: { max_turns: plan.maxTurns ?? 40, timeout_seconds: plan.timeoutSeconds }, grading: { max_calls: options.maxGraderCalls ?? 100 } } },
        grading: { graders: graders.map(grader => ({ ...grader })), criteria_schema: { schema_version: metadata.grading_plan?.schema_version ?? 1, assertions: plan.assertions, grading_plan: metadata.grading_plan ?? null, command: graderCommand } },
    });
}
async function aggregateProviderAccounting(values) { const items = [...values.values()].map(value => value.accounting()); const sum = (field, kind) => items.reduce((n, item) => n + item[field][kind], 0); return { measured: { costUsd: sum("measured", "costUsd"), tokens: sum("measured", "tokens"), providerSeconds: sum("measured", "providerSeconds") }, reserved: { costUsd: sum("reserved", "costUsd"), tokens: sum("reserved", "tokens"), providerSeconds: sum("reserved", "providerSeconds") }, unavailable: { costUsd: sum("unavailable", "costUsd"), tokens: sum("unavailable", "tokens"), providerSeconds: sum("unavailable", "providerSeconds") }, attempts: items.reduce((n, x) => n + x.attempts, 0), retries: items.reduce((n, x) => n + x.retries, 0), delayedMs: items.reduce((n, x) => n + x.delayedMs, 0), policy: "retain-reservation", key: "aggregate" }; }
export async function executePairedRuns(options) {
    const concurrency = options.concurrency ?? 2;
    if (!Number.isInteger(concurrency) || concurrency < 1)
        throw new TypeError("concurrency must be a positive integer");
    const baseRunner = createRunner(options.runner);
    const providerSchedulers = new Map();
    const schedulerFor = (provider, model) => { const identityKey = providerModelKey(provider, model), key = options.providerConstraints?.accountingKey ?? identityKey; let value = providerSchedulers.get(key); if (!value && options.providerConstraints) {
        value = new ProviderScheduler({ ...options.providerConstraints, statePath: options.providerConstraints.statePath ?? join(resolve(options.workspace), "provider-accounting.json"), accountingKey: key });
        providerSchedulers.set(key, value);
    } return value; };
    if (options.providerConstraints && baseRunner.retryBehavior !== "none")
        throw new TypeError(baseRunner.retryBehavior ? "Nested retry policy is not allowed: " + baseRunner.retryBehavior : "Runner must declare retryBehavior before provider scheduling");
    const runner = { retryBehavior: "none", executePaired: (plan) => { const scheduler = schedulerFor(options.providerIdentity?.provider, options.providerIdentity?.model ?? plan.model); return scheduler ? scheduler.execute(leaseSignal => baseRunner.executePaired({ ...plan, signal: leaseSignal }), plan.signal) : baseRunner.executePaired(plan); } };
    const graders = options.graders ?? [{ id: "grader-a", model: options.model ?? "default" }, { id: "grader-b", model: options.model ?? "default" }];
    const rawAdapter = options.graderAdapter === null ? undefined : (options.graderAdapter ?? new CommandGraderAdapter(configuredGooseArgv(options.graderCommand ?? process.env.SKILL_CREATOR_GRADER_COMMAND)));
    if (rawAdapter && options.providerConstraints && rawAdapter.retryBehavior !== "none")
        throw new TypeError(rawAdapter.retryBehavior ? "Nested grader retry policy is not allowed: " + rawAdapter.retryBehavior : "Grader adapter must declare retryBehavior before provider scheduling");
    // In delegated grading mode (options.graderAdapter===null), no adapter is
    // ever constructed or invoked: gradeOutput's own "no adapter" branch already
    // produces pending/inconclusive semantic expectations with judgments:[], to
    // be completed later by prepare-grading / delegate / import-grading.
    const adapter = rawAdapter ? { retryBehavior: "none", grade: async (input) => { const scheduler = schedulerFor(input.identity.provider, input.identity.model); return scheduler ? scheduler.execute(leaseSignal => rawAdapter.grade({ ...input, signal: leaseSignal }), input.signal) : rawAdapter.grade(input); } } : undefined;
    const gradingBudget = { used: 0, limit: options.maxGraderCalls ?? 100 };
    const cache = new EvaluationArtifactCache(options.cacheDir);
    if (typeof runner.executePaired !== "function")
        return { status: "blocked", completed: [], requested: 0, failures: [{ run: "*", code: "unsupported-runner", message: "Runner does not support paired execution", exit_reason: "unsupported-runner" }], cache: cache.accounting };
    const workspace = resolve(options.workspace), runStore = new EvaluationRunStore(join(workspace, ".evaluation-runs"));
    let runDirs, requiredRuns;
    try {
        runDirs = orderedRunDirs(workspace);
        requiredRuns = [...runDirs];
    }
    catch (error) {
        return { status: "failed", completed: [], requested: 0, failures: [{ run: "*", code: "incomplete-paired-runs", message: error.message, exit_reason: "invalid-plan" }], cache: cache.accounting };
    }
    const absent = runDirs.filter(path => !existsSync(path));
    if (absent.length)
        return { status: "failed", completed: [], requested: runDirs.length, failures: absent.map(run => ({ run, code: "incomplete-paired-runs", message: "Scheduled run directory is missing", exit_reason: "incomplete" })), cache: cache.accounting };
    const skillName = basename(resolve(options.skillPath));
    const schedulerId = `${process.pid}:${randomUUID()}`, leaseMs = 30_000, pollMs = 25;
    const outcomes = new Array(runDirs.length);
    let nextIndex = 0, cancelled = false;
    const waitForClaim = async (runId, runDir, identity) => { while (true) {
        if (options.signal?.aborted)
            throw new PairedExecutionError("cancelled", "Paired execution cancelled", "cancelled");
        const claim = runStore.claim(runId, schedulerId, () => validatedCompleteArtifactDigest(runDir, runId, undefined, identity), leaseMs, Date.now(), { run_directory: relative(options.workspace, runDir) });
        if (claim.status !== "waiting")
            return claim;
        const remaining = Math.max(1, Math.min(pollMs, Date.parse(claim.lease_expires_at) - Date.now()));
        await new Promise((resolveWait, reject) => { const timer = setTimeout(resolveWait, remaining), abort = () => { clearTimeout(timer); reject(new PairedExecutionError("cancelled", "Paired execution cancelled", "cancelled")); }; options.signal?.addEventListener("abort", abort, { once: true }); if (options.signal?.aborted)
            abort(); });
    } };
    const executeCell = async (index) => {
        const runDir = runDirs[index], evalDir = dirname(dirname(runDir)), metadata = json(join(evalDir, "eval_metadata.json")), configuration = basename(dirname(runDir)), progressRun = relative(workspace, runDir), started = Date.now();
        options.onProgress?.({ type: "run-start", phase: "paired-runs-and-grading", run: progressRun, status: "running" });
        const source = configuration === "with_skill" ? resolve(options.skillPath) : options.baseline === "old_skill" ? (options.baselineSkillPath ? resolve(options.baselineSkillPath) : null) : null;
        if (configuration === "old_skill" && (!source || !existsSync(source))) {
            outcomes[index] = { failure: { run: runDir, code: "invalid-plan", message: "old_skill execution requires an existing baselineSkillPath", exit_reason: "invalid-plan" } };
            return;
        }
        let cwd = "", plan, runId, attemptId, attemptDir = "", ownershipLost = false, heartbeat;
        try {
            const declared = capabilities(metadata.capabilities), tools = declared.tools, fixtures = fixtureSources(metadata, evalDir, resolve(options.skillPath));
            cwd = stage(source, skillName, fixtures);
            const budget = metadata.budget ?? {}, coordinates = runCoordinates(runDir), scheduled = metadata.execution_schedule?.find((item) => item.pair_index === coordinates.run_index);
            if (metadata.execution_schedule && !scheduled)
                throw new PairedExecutionError("incomplete", "No scheduled pair for run " + coordinates.run_index, "incomplete");
            const leaseAbort = new AbortController(), combinedSignal = options.signal ? AbortSignal.any([options.signal, leaseAbort.signal]) : leaseAbort.signal;
            plan = { prompt: String(metadata.prompt ?? ""), assertions: Array.isArray(metadata.assertions) ? metadata.assertions : [], cwd, model: options.model ?? (metadata.model ? String(metadata.model) : null), reasoning: options.reasoning, tools, capabilities: declared, maxTurns: Number(budget.max_turns ?? 40), timeoutSeconds: Number(budget.timeout_seconds ?? 300), configuration, skillName, signal: combinedSignal, seed: scheduled?.seed, pairIndex: scheduled?.pair_index, orderPosition: scheduled ? scheduled.order.indexOf(configuration === "with_skill" ? "with_skill" : "baseline") + 1 : undefined, fixtureSha256: fixtureHash(fixtures) };
            const identity = runIdentity(metadata, plan, source, options, graders);
            runId = identity.sha256;
            const localDigest = validatedCompleteArtifactDigest(runDir, runId, undefined, identity);
            if (localDigest && runStore.isReusable(runId, localDigest)) {
                outcomes[index] = { completed: runDir };
                options.onProgress?.({ type: "run-complete", phase: "paired-runs-and-grading", run: progressRun, status: "succeeded", duration_seconds: (Date.now() - started) / 1000 });
                return;
            }
            let claim = await waitForClaim(runId, runDir, identity);
            while (claim.status === "reusable") {
                if (validatedCompleteArtifactDigest(runDir, runId, undefined, identity)) {
                    outcomes[index] = { completed: runDir };
                    options.onProgress?.({ type: "run-complete", phase: "paired-runs-and-grading", run: progressRun, status: "succeeded", duration_seconds: (Date.now() - started) / 1000 });
                    return;
                }
                runStore.append(runId, "evidence-invalidated", { reason: "complete-execution-binding-validation-failed" }, `binding-invalidated:${runId}:${Date.now()}:${randomUUID()}`);
                options.onProgress?.({ type: "cache", run: progressRun, cache: "invalidated" });
                claim = await waitForClaim(runId, runDir, identity);
                options.onProgress?.({ type: "retry", run: progressRun });
            }
            attemptId = claim.attempt_id;
            const ownedAttempt = attemptId;
            attemptDir = runStore.createAttemptStaging(runId, ownedAttempt, runDir);
            const beforeInvalidated = cache.accounting.invalidated, cached = cache.materialize(runId, attemptDir, runDir, identity);
            if (cache.accounting.invalidated > beforeInvalidated)
                options.onProgress?.({ type: "cache", run: progressRun, cache: "invalidated" });
            options.onProgress?.({ type: "cache", run: progressRun, cache: cached ? "hit" : "miss" });
            if (cached) {
                if (!runStore.publishOwned(runId, schedulerId, ownedAttempt, attemptDir, runDir, "completed", { source: "cross-campaign-cache", cache_provenance: cached.provenance }, cached.evidence_sha256))
                    throw new Error("run lease ownership was lost before cache materialization");
                attemptDir = "";
                outcomes[index] = { completed: runDir };
                options.onProgress?.({ type: "run-complete", phase: "paired-runs-and-grading", run: progressRun, status: "succeeded", duration_seconds: (Date.now() - started) / 1000 });
                return;
            }
            clearGeneratedEvidence(attemptDir);
            atomic(join(attemptDir, "run-identity" + ".json"), identity);
            if (options.signal?.aborted)
                throw new PairedExecutionError("cancelled", "Paired execution cancelled", "cancelled");
            heartbeat = setInterval(() => { if (!runStore.renew(runId, schedulerId, ownedAttempt, leaseMs)) {
                ownershipLost = true;
                leaseAbort.abort();
            } }, Math.max(10, Math.floor(leaseMs / 3)));
            heartbeat.unref();
            const result = await runner.executePaired(plan);
            if (ownershipLost)
                throw new Error("run lease ownership was lost during execution");
            await writeEvidence(attemptDir, result, plan, source, metadata, graders, adapter, gradingBudget, runDir);
            if (ownershipLost)
                throw new Error("run lease ownership was lost during evidence generation");
            const completedEvidence = artifactHash(join(attemptDir, "execution-evidence" + ".json"));
            clearInterval(heartbeat);
            heartbeat = undefined;
            if (!runStore.publishOwned(runId, schedulerId, ownedAttempt, attemptDir, runDir, "completed", {}, completedEvidence))
                throw new Error("run lease ownership was lost before evidence publication");
            attemptDir = "";
            cache.publish(runId, runDir, completedEvidence, workspace, identity);
            outcomes[index] = { completed: runDir };
            options.onProgress?.({ type: "run-complete", phase: "paired-runs-and-grading", run: progressRun, status: "succeeded", duration_seconds: (Date.now() - started) / 1000 });
        }
        catch (error) {
            if (heartbeat)
                clearInterval(heartbeat);
            const typed = error instanceof PairedExecutionError ? error : new PairedExecutionError("host-exit", error.message, "adapter-error");
            if (runId && attemptId && !ownershipLost) {
                if (plan && typed.evidence && attemptDir) {
                    persistOutcome(attemptDir, typed.evidence, plan, typed.code === "cancelled" ? "cancelled" : "failed", typed.code, typed.message, typed.provider);
                    if (runStore.publishOwned(runId, schedulerId, attemptId, attemptDir, runDir, typed.code === "cancelled" ? "cancelled" : "failed", { code: typed.code, message: typed.message, exit_reason: typed.exitReason, ...(typed.provider ? { provider: typed.provider } : {}) }))
                        attemptDir = "";
                }
                else
                    runStore.appendOwned(runId, typed.code === "cancelled" ? "cancelled" : "failed", schedulerId, attemptId, { code: typed.code, message: typed.message, exit_reason: typed.exitReason, ...(typed.provider ? { provider: typed.provider } : {}) });
            }
            outcomes[index] = { failure: { run: runDir, code: typed.code, message: typed.message, exit_reason: typed.exitReason, ...(typed.provider ? { provider: typed.provider } : {}) } };
            options.onProgress?.({ type: "run-complete", phase: "paired-runs-and-grading", run: progressRun, status: ["command-not-found", "unsupported-runner", "model-unavailable", "tool-unavailable", "capability-mismatch", "provider-limited", "budget-exhausted"].includes(typed.code) ? "blocked" : typed.code === "cancelled" ? "cancelled" : "failed", duration_seconds: (Date.now() - started) / 1000, detail: typed.message });
            if (typed.code === "cancelled")
                cancelled = true;
        }
        finally {
            if (runId && attemptId && attemptDir)
                runStore.cleanupAttemptStaging(runId, attemptId);
            if (cwd)
                rmSync(cwd, { recursive: true, force: true });
        }
    };
    let yielded = false, admittedUnits = 0;
    if (options.adaptivePolicy) {
        const releaseAdaptive = await acquireAdaptiveLock(workspace);
        try {
            const statePath = join(workspace, ADAPTIVE_SCHEDULER_STATE), allRuns = [...runDirs], state = readAdaptiveState(statePath, options.adaptivePolicy, workspace, allRuns);
            // Recover a crash after durable state publication but before decision publication.
            if (state.observations.length || existsSync(resolve(workspace, ANYTIME_QUALITY_ARTIFACT_FILE)))
                persistAnytimeQualityResult(resolve(workspace, ANYTIME_QUALITY_ARTIFACT_FILE), state.policy, state.observations);
            const knownRoundSet = new Set(state.admitted_rounds);
            for (let round = 1; round <= Math.max(0, ...state.admitted_rounds); round++)
                if (!knownRoundSet.has(round))
                    throw new Error("adaptive scheduling state admitted rounds must be a contiguous prefix");
            const completedPaths = new Set();
            for (const path of allRuns)
                if (existsSync(join(path, "execution-evidence.json")) && existsSync(join(path, "grading.json")))
                    completedPaths.add(resolve(path));
            if (state.stop_reason)
                deriveSuperseded(state, adaptivePlanFromRuns(workspace, allRuns));
            else
                for (let round = 1; round <= options.adaptivePolicy.max_pairs; round++) {
                    const roundIndexes = runDirs.map((path, index) => ({ path, index, coordinates: runCoordinates(path) })).filter(x => x.coordinates.run_index === round);
                    if (!roundIndexes.length)
                        throw new PairedExecutionError("invalid-plan", `Adaptive round ${round} is missing from the deterministic schedule`, "invalid-plan");
                    if (!state.admitted_rounds.includes(round)) {
                        state.admitted_rounds.push(round);
                        persistAdaptiveState(statePath, state);
                    }
                    else if (state.counted_pairs.filter(x => x.pair_index === round).length === options.adaptivePolicy.scenarios.length)
                        continue;
                    let cursor = 0;
                    const roundWorker = async () => { while (cursor < roundIndexes.length && !cancelled && !options.signal?.aborted) {
                        const item = roundIndexes[cursor++];
                        await executeCell(item.index);
                    } };
                    await Promise.all(Array.from({ length: Math.min(concurrency, roundIndexes.length) }, () => roundWorker()));
                    if (cancelled || options.signal?.aborted)
                        break;
                    const failuresInRound = roundIndexes.flatMap(x => outcomes[x.index]?.failure ? [outcomes[x.index].failure] : []);
                    if (failuresInRound.length)
                        break;
                    const pairs = [], observations = [];
                    for (const scenario of options.adaptivePolicy.scenarios) {
                        const matching = roundIndexes.map(x => x.path).filter(path => String(json(join(dirname(dirname(path)), "eval_metadata.json")).eval_id) === scenario.id), candidate = matching.find(path => basename(dirname(path)) === "with_skill"), baseline = matching.find(path => basename(dirname(path)) !== "with_skill");
                        if (!candidate || !baseline)
                            throw new PairedExecutionError("invalid-plan", `Adaptive round ${round} lacks a complete pair for scenario ${scenario.id}`, "invalid-plan");
                        const candidateGrade = json(join(candidate, "grading.json")), baselineGrade = json(join(baseline, "grading.json")), a = Number(candidateGrade?.summary?.pass_rate), b = Number(baselineGrade?.summary?.pass_rate);
                        if (!Number.isFinite(a) || !Number.isFinite(b))
                            throw new PairedExecutionError("incomplete", `Adaptive pair ${scenario.id}/${round} lacks validated quality`, "incomplete");
                        pairs.push({ scenario_id: scenario.id, pair_index: round, candidate_run: relative(workspace, candidate).replaceAll("\\", "/"), baseline_run: relative(workspace, baseline).replaceAll("\\", "/") });
                        observations.push({ scenario_id: scenario.id, pair_index: round, candidate: a, baseline: b });
                    }
                    recordAdaptiveLook(state, pairs, observations, workspace);
                    if (state.stop_reason)
                        deriveSuperseded(state, adaptivePlanFromRuns(workspace, allRuns));
                    persistAdaptiveState(statePath, state);
                    persistAnytimeQualityResult(resolve(workspace, ANYTIME_QUALITY_ARTIFACT_FILE), state.policy, state.observations);
                    const last = state.looks.at(-1);
                    options.onProgress?.({ type: "adaptive-look", event_id: "adaptive-look:" + round, phase: "paired-runs-and-grading", status: state.stop_reason ? "stopped" : "running", sequential: { mode: "adaptive", method: state.policy.method, method_version: state.policy.schema_version, policy_hash: state.policy_hash, decision: state.decision, stop_reason: state.stop_reason, looks: state.looks.length, sample_count: state.looks.length, confidence_sequence: last?.confidence_sequence ?? null, practical_superiority_delta: state.policy.practical_superiority_delta, regression_tolerance: state.policy.regression_tolerance, estimand: state.policy.estimand, assumptions: state.policy.assumptions, comparison_family: state.policy.comparison_family, scenario_weights: state.policy.scenarios, multiplicity_allocation: state.policy.multiplicity, counted_membership: state.counted_pairs, superseded_count: state.superseded_unstarted_tasks.length } });
                    if (state.stop_reason)
                        break;
                    admittedUnits++;
                    if (options.maxPairRounds !== undefined && admittedUnits >= options.maxPairRounds && round < options.adaptivePolicy.max_pairs) {
                        yielded = true;
                        break;
                    }
                }
            const superseded = new Set(state.superseded_unstarted_tasks);
            requiredRuns = allRuns.filter(path => !superseded.has(relative(workspace, path).replaceAll("\\", "/")));
        }
        finally {
            releaseAdaptive();
        }
    }
    else {
        const incompleteRounds = [...new Set(runDirs.filter(path => !existsSync(join(path, "execution-evidence.json"))).map(path => runCoordinates(path).run_index))].sort((a, b) => a - b);
        const selected = options.maxPairRounds === undefined ? runDirs : runDirs.filter(path => incompleteRounds.slice(0, options.maxPairRounds).includes(runCoordinates(path).run_index));
        let selectedCursor = 0;
        const worker = async () => { while (true) {
            if (cancelled || options.signal?.aborted) {
                cancelled = true;
                return;
            }
            const path = selected[selectedCursor++];
            if (!path)
                return;
            await executeCell(runDirs.indexOf(path));
        } };
        await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, () => worker()));
        yielded = options.maxPairRounds !== undefined && runDirs.some(path => !existsSync(join(path, "execution-evidence.json")));
    }
    const requiredSet = new Set(requiredRuns.map(path => resolve(path)));
    const completed = runDirs.filter((_, index) => requiredSet.has(resolve(runDirs[index])) && (outcomes[index]?.completed || existsSync(join(runDirs[index], "execution-evidence.json")))), failures = outcomes.flatMap(item => item?.failure ? [item.failure] : []);
    // In adaptive mode every admitted round is mandatory. Any preterminal cell failure blocks
    // inference and resume must complete that same round; it can never become a sampled skip.
    const blocked = Boolean(options.adaptivePolicy && failures.length) || failures.some(x => ["command-not-found", "unsupported-runner", "model-unavailable", "tool-unavailable", "capability-mismatch", "provider-limited", "budget-exhausted"].includes(x.code));
    const resumable = Boolean(options.adaptivePolicy && failures.length) || failures.some(x => ["provider-limited", "budget-exhausted"].includes(x.code));
    return { status: cancelled ? "cancelled" : failures.length ? (blocked ? "blocked" : "failed") : yielded ? "blocked" : "complete", completed, requested: requiredRuns.length, failures, cache: cache.accounting, ...(providerSchedulers.size ? { provider: await aggregateProviderAccounting(providerSchedulers) } : {}), ...(resumable || yielded ? { resumable: true } : {}) };
}
