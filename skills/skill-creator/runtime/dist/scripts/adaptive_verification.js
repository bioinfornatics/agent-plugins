import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { readAdaptiveState } from "./adaptive_scheduling.js";
import { expectedRunDirs, validateExecutionEvidence, } from "./evaluation_provenance.js";
import { ANYTIME_QUALITY_POLICY_VERSION, anytimeQualityPolicyHash, canonicalJson, readAndVerifyAnytimeQualityArtifact, } from "./anytime_quality.js";
import { readTrustedJson } from "./trusted_snapshot.js";
function asObject(value, label) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new TypeError(label + " must be an object");
    return value;
}
function expectedMetadata(workspace) {
    return readdirSync(workspace)
        .filter((name) => name.startsWith("eval-"))
        .sort()
        .flatMap((name) => {
        const path = join(workspace, name, "eval_metadata.json");
        return existsSync(path)
            ? [
                asObject(readTrustedJson(workspace, path, "eval metadata"), "eval metadata"),
            ]
            : [];
    });
}
function deterministicRegressions(workspace, counted) {
    const failures = [];
    for (const pair of counted) {
        const candidate = resolve(workspace, String(pair.candidate_run)), baseline = resolve(workspace, String(pair.baseline_run)), a = asObject(readTrustedJson(workspace, join(candidate, "grading.json"), "adaptive candidate grading.json"), "adaptive candidate grading"), b = asObject(readTrustedJson(workspace, join(baseline, "grading.json"), "adaptive baseline grading.json"), "adaptive baseline grading"), candidateById = new Map((a.expectations ?? []).map((x) => [String(x.id ?? x.text), x]));
        for (const item of b.expectations ?? []) {
            const other = candidateById.get(String(item.id ?? item.text));
            if (item.classification === "deterministic" &&
                item.critical !== false &&
                item.passed === true &&
                other?.classification === "deterministic" &&
                other.critical !== false &&
                other.passed === false)
                failures.push(relative(workspace, candidate).replaceAll("\\", "/") +
                    "#" +
                    String(item.id ?? item.text));
        }
    }
    return [...new Set(failures)].sort();
}
/**
 * Verification invariant: every adaptive conclusion is recomputed from trusted,
 * bounded files and must agree across policy, scheduler, artifact, and receipt.
 */
export function verifyAdaptiveWorkspace(workspaceArg, benchmark) {
    const workspace = resolve(workspaceArg), jobPath = join(workspace, ".full-eval-job.json"), statePath = join(workspace, ".adaptive-scheduling.json"), artifactPath = join(workspace, "anytime-quality-decision.json"), declared = benchmark?.decision_evidence;
    let metadata = [], job = null;
    try {
        metadata = expectedMetadata(workspace);
        if (existsSync(jobPath))
            job = asObject(readTrustedJson(workspace, jobPath, "full-eval job"), "full-eval job");
    }
    catch (error) {
        return {
            adaptive: true,
            errors: [error.message],
            decision: null,
            critical_deterministic_regressions: [],
        };
    }
    const jobAdaptive = job?.decision_policy === "adaptive", predeclared = metadata.some((item) => item?.decision_policy === "adaptive"), signaled = jobAdaptive ||
        predeclared ||
        existsSync(statePath) ||
        existsSync(artifactPath) ||
        declared?.mode === "adaptive";
    if (!signaled)
        return {
            adaptive: false,
            errors: [],
            decision: null,
            critical_deterministic_regressions: [],
        };
    if (!job)
        return {
            adaptive: true,
            errors: [
                "adaptive verification requires trusted .full-eval-job.json campaign authority",
            ],
            decision: null,
            critical_deterministic_regressions: [],
        };
    if (job &&
        job.decision_policy !== "fixed" &&
        job.decision_policy !== "adaptive")
        return {
            adaptive: true,
            errors: ["full-eval job decision policy is invalid"],
            decision: null,
            critical_deterministic_regressions: [],
        };
    const modes = new Set(metadata.map((item) => item?.decision_policy ?? "fixed"));
    if (job &&
        metadata.some((item) => item?.execution_binding?.decision_policy !== job.decision_policy ||
            item?.execution_binding?.initial_policy_hash !==
                (job.initial_policy_hash ?? null)))
        return {
            adaptive: jobAdaptive,
            errors: [
                "evaluation execution binding disagrees with trusted full-eval job intent",
            ],
            decision: null,
            critical_deterministic_regressions: [],
        };
    if (modes.size > 1)
        return {
            adaptive: true,
            errors: ["evaluation metadata contains mixed decision-policy modes"],
            decision: null,
            critical_deterministic_regressions: [],
        };
    if (predeclared && declared && declared.mode !== "adaptive")
        return {
            adaptive: true,
            errors: [
                "predeclared adaptive decision policy cannot be downgraded by benchmark metadata",
            ],
            decision: null,
            critical_deterministic_regressions: [],
        };
    let allRuns = [];
    try {
        allRuns = expectedRunDirs(workspace, true);
    }
    catch (error) {
        return {
            adaptive: true,
            errors: [error.message],
            decision: null,
            critical_deterministic_regressions: [],
        };
    }
    const errors = [];
    let decision = null, critical = [];
    try {
        if (!existsSync(statePath) || !existsSync(artifactPath))
            throw new Error("adaptive evidence requires scheduling state and policy artifact");
        if (!allRuns.length)
            throw new Error("adaptive evidence requires a complete predeclared execution plan");
        const policies = allRuns.map((run) => asObject(readTrustedJson(workspace, join(dirname(dirname(run)), "eval_metadata.json"), "adaptive eval_metadata.json"), "adaptive eval metadata").anytime_quality_policy);
        if (policies.some((p) => !p) ||
            policies.some((p) => canonicalJson(p) !== canonicalJson(policies[0])))
            throw new Error("adaptive evidence requires one independently loaded predeclared policy");
        const policyHash = anytimeQualityPolicyHash(policies[0]), policy = readAndVerifyAnytimeQualityArtifact(artifactPath).policy;
        if (canonicalJson(policy) !== canonicalJson(policies[0]))
            throw new Error("adaptive evidence requires one independently loaded predeclared policy");
        if (jobAdaptive && job.initial_policy_hash !== policyHash)
            throw new Error("trusted full-eval job initial policy hash disagrees with evaluation metadata");
        if (job && job.decision_policy !== "adaptive")
            throw new Error("trusted full-eval job decision policy disagrees with adaptive evidence");
        const state = readAdaptiveState(statePath, policy, workspace, allRuns), artifact = readAndVerifyAnytimeQualityArtifact(artifactPath), evidence = validateExecutionEvidence(workspace);
        if (evidence.status !== "complete")
            errors.push(...evidence.errors);
        if (canonicalJson(artifact.policy) !== canonicalJson(policies[0]) ||
            artifact.result.policy_hash !== state.policy_hash ||
            canonicalJson(artifact.observations) !==
                canonicalJson(state.observations) ||
            canonicalJson(artifact.result.looks) !== canonicalJson(state.looks) ||
            artifact.result.decision !== state.decision)
            errors.push("adaptive policy artifact, independently recomputed trace, bounds, or scheduling state disagree");
        const active = new Set(expectedRunDirs(workspace).map((x) => resolve(x))), countedRuns = new Set(state.counted_pairs.flatMap((x) => [
            resolve(workspace, x.candidate_run),
            resolve(workspace, x.baseline_run),
        ]));
        for (const run of countedRuns)
            if (!active.has(run))
                errors.push("counted adaptive evidence is not in active verified membership: " +
                    relative(workspace, run));
        critical = deterministicRegressions(workspace, state.counted_pairs);
        const last = artifact.result.looks.at(-1) ?? null;
        decision = {
            mode: "adaptive",
            method: artifact.result.method,
            method_version: ANYTIME_QUALITY_POLICY_VERSION,
            policy_hash: artifact.result.policy_hash,
            decision: artifact.result.decision,
            terminal: artifact.result.terminal,
            stop_reason: artifact.result.terminal ? artifact.result.decision : null,
            looks: artifact.result.looks,
            sample_count: artifact.result.complete_pairs,
            confidence_sequence: last?.confidence_sequence ?? null,
            practical_superiority_delta: artifact.policy.practical_superiority_delta,
            regression_tolerance: artifact.policy.regression_tolerance,
            estimand: artifact.policy.estimand,
            assumptions: artifact.policy.assumptions,
            comparison_family: artifact.policy.comparison_family,
            scenario_weights: artifact.policy.scenarios,
            multiplicity_allocation: artifact.policy.multiplicity,
            counted_membership: state.counted_pairs,
            superseded_count: state.superseded_unstarted_tasks.length,
            artifact: "anytime-quality-decision.json",
        };
        if (benchmark?.metadata?.decision_policy !== "adaptive" ||
            benchmark?.metadata?.initial_policy_hash !== policyHash ||
            benchmark?.campaign?.decision_policy !== "adaptive" ||
            benchmark?.campaign?.initial_policy_hash !== policyHash)
            errors.push("benchmark campaign receipt does not match trusted adaptive intent and initial policy hash");
        if (declared && canonicalJson(declared) !== canonicalJson(decision))
            errors.push("benchmark adaptive decision evidence does not match the independently recomputed policy artifact and membership");
        if (decision.decision === "winner" &&
            (!last ||
                !(last.confidence_sequence.lower > decision.practical_superiority_delta)))
            errors.push("adaptive winner requires an anytime-valid lower bound beyond the declared practical threshold");
        if (decision.decision === "winner" && critical.length)
            errors.push("adaptive winner is blocked by critical deterministic regression: " +
                critical.join(", "));
    }
    catch (error) {
        errors.push(error.message);
    }
    return {
        adaptive: true,
        errors: [...new Set(errors)],
        decision,
        critical_deterministic_regressions: critical,
    };
}
