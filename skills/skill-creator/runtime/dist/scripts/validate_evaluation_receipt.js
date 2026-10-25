#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { artifactHash, listRunDirs, requiredRunDirs, validateExecutionEvidence } from "./evaluation_provenance.js";
import { verifySkill } from "./verify_skill_gates.js";
import { verifyFixedWorkspace } from "./aggregate_benchmark.js";
import { verifyAdaptiveWorkspace } from "./adaptive_verification.js";
function isDir(path) {
    try {
        return statSync(path).isDirectory();
    }
    catch {
        return false;
    }
}
function loadJson(path) {
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return null;
    }
}
function listDirs(path, predicate) {
    if (!isDir(path))
        return [];
    return readdirSync(path)
        .filter((name) => predicate(name) && isDir(join(path, name)))
        .sort();
}
function isPassRate(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
const FINAL_STATUSES = new Set(["complete", "completed", "final", "succeeded", "success", "pass", "passed"]);
/** Optional finality metadata is backward compatible when absent, but authoritative when present. */
function validateFinalMetadata(value, label, missing) {
    if (!value || typeof value !== "object")
        return;
    const records = [value, value.metadata].filter((record) => record && typeof record === "object");
    for (const record of records) {
        if (record.provisional === true)
            missing.push(`${label} must not be provisional`);
        if (record.final_receipt === false)
            missing.push(`${label} final_receipt must not be false`);
        if (record.canonical === false)
            missing.push(`${label} must not be noncanonical`);
        if (record.historical === true)
            missing.push(`${label} must not be historical`);
        if (typeof record.status === "string" && !FINAL_STATUSES.has(record.status.toLowerCase())) {
            missing.push(`${label} status must be final`);
        }
    }
}
function loadReviewMetadata(path) {
    if (!existsSync(path))
        return null;
    const text = readFileSync(path, "utf8");
    try {
        return JSON.parse(text);
    }
    catch { }
    const match = text.match(/\bconst\s+REVIEW_IR\s*=\s*({.*?});\s*(?:\n|<\/script>)/s);
    if (!match)
        return null;
    try {
        return JSON.parse(match[1]);
    }
    catch {
        return null;
    }
}
function validateRun(workspace, runDir, missing, uncertainty) {
    const label = relative(workspace, runDir).replaceAll("\\", "/");
    const outputsDir = join(runDir, "outputs");
    if (!isDir(outputsDir) || !readdirSync(outputsDir).some((name) => name !== ".keep")) {
        missing.push(`${label}/outputs`);
    }
    const grading = loadJson(join(runDir, "grading.json"));
    if (!grading) {
        missing.push(`${label}/grading.json`);
    }
    else {
        if (!Array.isArray(grading.expectations) ||
            grading.expectations.some((item) => typeof item?.text !== "string" ||
                typeof item?.passed !== "boolean" ||
                !(typeof item?.evidence === "string" || (grading.schema_version === 2 && ((Array.isArray(item?.evidence) && item.evidence.every((quote) => typeof quote === "string")) || (item?.classification === "deterministic" && item?.evidence !== null && typeof item?.evidence === "object" && !Array.isArray(item.evidence))))))) {
            missing.push(`${label}/grading.json fields`);
        }
        const honestUncertain = grading.schema_version === 2 && (grading.summary?.pass_rate === null || isPassRate(grading.summary?.pass_rate)) && grading.summary?.inconclusive > 0 && !(grading.summary?.unavailable > 0) && grading.expectations?.some((item) => item.verdict === "inconclusive");
        if (honestUncertain)
            uncertainty.push(label + ": bound inconclusive grading; quality unavailable");
        if (!isPassRate(grading.summary?.pass_rate) && !honestUncertain) {
            missing.push(`${label}/grading.json pass_rate must be finite and in [0,1]`);
        }
    }
    if (!loadJson(join(runDir, "timing.json")))
        missing.push(`${label}/timing.json`);
}
export function validateEvaluationReceipt(workspaceArg) {
    const workspace = resolve(workspaceArg);
    const missing = [], uncertainty = [];
    const legacyRoot = join(workspace, "runs");
    const rootEvals = listDirs(workspace, (name) => name.startsWith("eval-"));
    const legacyEvals = listDirs(legacyRoot, (name) => name.startsWith("eval-"));
    const searchRoot = rootEvals.length ? workspace : legacyRoot;
    const evals = rootEvals.length ? rootEvals : legacyEvals;
    if (!evals.length)
        missing.push("at least one eval-* directory (at workspace root or runs/)");
    for (const evalName of evals) {
        const evalDir = join(searchRoot, evalName);
        const evalLabel = relative(workspace, evalDir).replaceAll("\\", "/");
        if (!loadJson(join(evalDir, "eval_metadata.json"))) {
            missing.push(`${evalLabel}/eval_metadata.json`);
        }
        const configs = listDirs(evalDir, (name) => name.includes("with_skill") ||
            name.includes("old_skill") ||
            name.includes("without_skill"));
        if (!configs.some((name) => name.includes("with_skill"))) {
            missing.push(`${evalLabel}/with_skill run`);
        }
        if (!configs.some((name) => name.includes("old_skill") || name.includes("without_skill"))) {
            missing.push(`${evalLabel}/old_skill or without_skill run`);
        }
        let required = null;
        if (existsSync(join(workspace, [".adaptive-scheduling", "json"].join("."))))
            try {
                required = new Set(requiredRunDirs(workspace).map(path => resolve(path)));
            }
            catch (error) {
                missing.push("adaptive verification: " + error.message);
                required = new Set();
            }
        for (const config of configs) {
            const configDir = join(evalDir, config);
            const runDirs = listDirs(configDir, (name) => /^run-\d+$/.test(name));
            if (runDirs.length) {
                for (const runName of runDirs) {
                    const runDir = join(configDir, runName);
                    if (!required || required.has(resolve(runDir)))
                        validateRun(workspace, runDir, missing, uncertainty);
                }
            }
            else if (!required || required.has(resolve(configDir))) {
                validateRun(workspace, configDir, missing, uncertainty);
            }
        }
    }
    const benchmark = loadJson(join(workspace, "benchmark.json"));
    if (!benchmark) {
        missing.push("benchmark.json");
    }
    else {
        validateFinalMetadata(benchmark, "benchmark.json", missing);
        for (const [configuration, summary] of Object.entries(benchmark.run_summary ?? {})) {
            if (configuration === "delta")
                continue;
            const honestUncertain = summary?.pass_rate?.mean === null && uncertainty.length > 0 && benchmark.run_summary?.delta?.sampling?.complete === false;
            if (!isPassRate(summary?.pass_rate?.mean) && !honestUncertain) {
                missing.push(`benchmark.json run_summary.${configuration}.pass_rate.mean must be finite and in [0,1]`);
            }
        }
    }
    if (!existsSync(join(workspace, "benchmark.md")))
        missing.push("benchmark.md");
    if (existsSync(join(workspace, ".full-eval-job.json")) || listRunDirs(workspace).some(run => existsSync(join(run, "execution-evidence.json")))) {
        const evidence = validateExecutionEvidence(workspace);
        if (evidence.status !== "complete")
            missing.push(...evidence.errors.map(error => "execution verification: " + error));
    }
    const adaptive = verifyAdaptiveWorkspace(workspace, benchmark);
    if (adaptive.adaptive)
        missing.push(...adaptive.errors.map(error => "adaptive verification: " + error));
    const fixed = !adaptive.adaptive ? verifyFixedWorkspace(workspace, benchmark) : null;
    if (fixed?.errors.length)
        missing.push(...fixed.errors.map(error => "fixed verification: " + error));
    const reviewPath = join(workspace, "review.html"), feedbackPath = join(workspace, "feedback.json");
    if (!existsSync(reviewPath) && !existsSync(feedbackPath)) {
        missing.push("review.html or feedback.json");
    }
    else {
        validateFinalMetadata(loadReviewMetadata(reviewPath), "review.html", missing);
        validateFinalMetadata(loadJson(feedbackPath), "feedback.json", missing);
    }
    validateFinalMetadata(loadJson(join(workspace, "progress.json")), "progress.json", missing);
    const releaseVerification = loadJson(join(workspace, "receipt.json"));
    let independentReleasePass = false;
    if (missing.length === 0 && uncertainty.length === 0 && (adaptive.adaptive || fixed?.independently_recomputed)) {
        try {
            const job = loadJson(join(workspace, ".full-eval-job.json"));
            // Receipt decisions are operator attestations, not authority for derived behavior.
            if (job?.skill)
                independentReleasePass = verifySkill({ skillPath: job.skill, evaluation: workspace, profile: "release", testsStatus: "pass", triggeringStatus: "pass", humanReview: "pass" }).status === "pass";
        }
        catch {
            independentReleasePass = false;
        }
    }
    return {
        status: missing.length ? "blocked" : "complete",
        evals: evals.length,
        workspace,
        missing,
        decision_evidence: adaptive.decision ?? fixed?.decision ?? benchmark?.decision_evidence ?? null,
        uncertainty,
        release_eligible: independentReleasePass && ["tests", "triggering", "review"].every(name => releaseVerification?.gates?.[name]?.status === "pass") && releaseVerification?.evaluation_provenance?.benchmark_sha256 === (benchmark ? artifactHash(join(workspace, "benchmark.json")) : null) && releaseVerification?.source_sha256 === benchmark?.metadata?.source_sha256 && releaseVerification?.profile === "release" && releaseVerification?.status === "pass" && Object.values(releaseVerification?.gates ?? {}).every((gate) => !gate.required || gate.status === "pass") && missing.length === 0 && uncertainty.length === 0 && (adaptive.adaptive ? adaptive.decision?.decision === "winner" : fixed?.independently_recomputed === true && fixed.errors.length === 0 && fixed.decision?.decision === "winner" && fixed.run_summary?.delta?.sampling?.complete === true && fixed.run_summary?.delta?.stable_improvement === true),
    };
}
function main() {
    const { positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true });
    const workspaceArg = positionals[0];
    if (!workspaceArg || !isDir(resolve(workspaceArg))) {
        console.error("usage: validate_evaluation_receipt.js <iteration-workspace>");
        process.exit(2);
    }
    const result = validateEvaluationReceipt(workspaceArg);
    const output = result;
    console[result.status === "complete" ? "log" : "error"](JSON.stringify(output, null, 2));
    process.exit(result.status === "complete" ? 0 : 1);
}
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (!import.meta.url.includes("/$bunfs/") && invokedPath && fileURLToPath(import.meta.url) === invokedPath)
    main();
