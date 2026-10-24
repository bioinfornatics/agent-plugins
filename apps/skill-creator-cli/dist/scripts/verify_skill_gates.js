#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { validateSkill } from "./quick_validate.js";
import { auditSkill } from "./audit_skill.js";
import { artifactHash, validateExecutionEvidence } from "./evaluation_provenance.js";
import { verifyAdaptiveWorkspace } from "./adaptive_verification.js";
import { readTrustedJson } from "./trusted_snapshot.js";
const PROFILES = new Set(["static", "evaluation", "release"]);
const GATE_STATUSES = new Set(["pass", "fail", "blocked", "na"]);
const HUMAN_REVIEW_STATUSES = new Set(["pass", "fail", "blocked"]);
const EXCLUDED = new Set([".git", ".verification", "dist", "node_modules", "vendor"]);
const ROOT_EVALUATION_CONTENT = new Set(["evals", "evaluation", "evaluations"]);
function isDir(path) {
    try {
        return statSync(path).isDirectory();
    }
    catch {
        return false;
    }
}
function walk(root, current, out, excludedPaths) {
    for (const name of readdirSync(current).sort()) {
        const isRootEvaluationContent = current === root && ROOT_EVALUATION_CONTENT.has(name);
        const path = join(current, name);
        if (EXCLUDED.has(name) || isRootEvaluationContent || excludedPaths.has(resolve(path)))
            continue;
        if (isDir(path))
            walk(root, path, out, excludedPaths);
        else
            out.push(path);
    }
}
export function sourceHash(rootArg, excluded = []) {
    const root = resolve(rootArg);
    const files = [];
    walk(root, root, files, new Set(excluded.map(path => resolve(path))));
    const hash = createHash("sha256");
    for (const path of files) {
        hash.update(relative(root, path).replaceAll("\\", "/"));
        hash.update("\0");
        hash.update(readFileSync(path));
        hash.update("\0");
    }
    return hash.digest("hex");
}
function gate(status, required, checks, evidence, reason) {
    return { status, required, checks, evidence, ...(reason ? { reason } : {}) };
}
function aggregate(gates) {
    const required = Object.values(gates).filter((item) => item.required);
    if (required.some((item) => item.status === "fail"))
        return "fail";
    if (required.some((item) => item.status !== "pass"))
        return "blocked";
    return "pass";
}
function loadJson(path) {
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return null;
    }
}
function requireChoice(label, value, allowed, fallback) {
    if (value === undefined)
        return fallback;
    if (!allowed.has(value)) {
        throw new TypeError(`${label} must be one of: ${[...allowed].join(", ")}`);
    }
    return value;
}
function requireFiniteRange(label, value, minimum, maximum) {
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new TypeError(`${label} must be a finite number in [${minimum}, ${maximum}]`);
    }
    return value;
}
function passRate(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
        ? value
        : null;
}
function benchmarkSummary(data) {
    const summary = data?.run_summary;
    if (!summary || typeof summary !== "object") {
        return { current: null, baseline: null, invalid: [] };
    }
    const keys = Object.keys(summary);
    const currentKey = keys.find((key) => key.includes("with_skill"));
    const baselineKey = keys.find((key) => key.includes("old_skill") || key.includes("without_skill"));
    const invalid = [];
    const readRate = (key, role) => {
        if (!key)
            return null;
        const raw = summary[key]?.pass_rate?.mean;
        const parsed = passRate(raw);
        if (parsed === null)
            invalid.push(`${role} pass rate must be finite and in [0,1]`);
        return parsed;
    };
    return {
        current: readRate(currentKey, "current"),
        baseline: readRate(baselineKey, "baseline"),
        invalid,
    };
}
function hashField(metadata, name) {
    const value = metadata?.[name];
    if (value === undefined)
        return { value: null, malformed: false };
    return { value: typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null, malformed: typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value) };
}
function benchmarkSourceHash(benchmark) {
    const metadata = benchmark?.metadata;
    if (!metadata || typeof metadata !== "object")
        return { value: null, malformed: false };
    const candidates = [metadata.source_sha256, metadata.skill_source_sha256, metadata.source_hash]
        .filter((value) => value !== undefined);
    if (!candidates.length)
        return { value: null, malformed: false };
    const value = candidates[0];
    return {
        value: typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null,
        malformed: typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value),
    };
}
export function verifySkill(options) {
    const profile = requireChoice("profile", options.profile, PROFILES, "release");
    const testsInput = requireChoice("tests status", options.testsStatus, GATE_STATUSES);
    const triggeringInput = requireChoice("triggering status", options.triggeringStatus, GATE_STATUSES);
    const humanReview = requireChoice("human review", options.humanReview, HUMAN_REVIEW_STATUSES);
    const minimum = requireFiniteRange("minimum pass rate", options.minPassRate ?? 0.8, 0, 1);
    const minDelta = requireFiniteRange("minimum delta", options.minDelta ?? 0, -1, 1);
    const root = resolve(options.skillPath);
    const name = basename(root);
    const strict = profile !== "static";
    const workspace = options.evaluation ? resolve(options.evaluation) : "";
    let job = null, jobError = null;
    if (workspace) {
        const path = join(workspace, ".full-eval-job.json");
        try {
            if (existsSync(path))
                job = readTrustedJson(workspace, path, "full-eval job");
        }
        catch (error) {
            jobError = error.message;
        }
    }
    const currentSourceHash = sourceHash(root, job?.eval_set ? [job.eval_set] : []);
    const [valid, message] = validateSkill(root);
    const authoringAudit = auditSkill(root);
    const pkg = loadJson(join(root, "package.json"));
    const offline = Boolean(pkg?.offlineBundle);
    const missing = [];
    if (offline) {
        for (const path of ["dist", "vendor/manifest.json", "THIRD_PARTY_NOTICES.md"]) {
            if (!existsSync(join(root, path)))
                missing.push(path);
        }
        for (const dependency of Object.keys(pkg.dependencies ?? {})) {
            const manifest = join(root, "vendor", "node_modules", dependency, "package.json");
            if (!existsSync(manifest))
                missing.push(`vendor/node_modules/${dependency}`);
        }
    }
    const tests = testsInput ?? (strict ? "blocked" : "na");
    const triggeringRequired = profile === "release";
    const triggering = triggeringInput ?? (triggeringRequired ? "blocked" : "na");
    const benchmark = workspace ? loadJson(join(workspace, "benchmark.json")) : null;
    const summary = benchmarkSummary(benchmark);
    const provenance = benchmarkSourceHash(benchmark);
    const evalPlan = hashField(benchmark?.metadata, "eval_plan_sha256");
    const evidenceProvenance = hashField(benchmark?.metadata, "execution_evidence_sha256");
    const declaredEvalPlan = job?.eval_set ? artifactHash(job.eval_set) : null;
    const evidence = workspace ? validateExecutionEvidence(workspace, { skill_source_sha256: currentSourceHash, ...(declaredEvalPlan ? { eval_plan_sha256: declaredEvalPlan } : {}) }) : null;
    const adaptive = workspace ? verifyAdaptiveWorkspace(workspace, benchmark) : { adaptive: false, errors: [], decision: null, critical_deterministic_regressions: [] };
    // Legacy direct gate callers only supplied source provenance. Require the stronger
    // eval-plan/evidence chain once any state or binding field declares that model.
    const hasBoundProvenance = Boolean(job || evalPlan.value || evalPlan.malformed || evidenceProvenance.value ||
        evidenceProvenance.malformed || evidence?.bindings.length);
    const delta = summary.current !== null && summary.baseline !== null
        ? summary.current - summary.baseline
        : null;
    let behavior = "na";
    let behaviorReason = "not required";
    if (strict) {
        if (!benchmark) {
            behavior = "blocked";
            behaviorReason = "paired benchmark missing";
        }
        else if (jobError) {
            behavior = "fail";
            behaviorReason = "trusted full-eval job is invalid: " + jobError;
        }
        else if (!job && evidence?.bindings.length) {
            behavior = "fail";
            behaviorReason = "bound evaluation evidence requires the trusted .full-eval-job.json campaign authority";
        }
        else if (summary.invalid.length) {
            behavior = "fail";
            behaviorReason = summary.invalid.join("; ");
        }
        else if (summary.current === null || summary.baseline === null) {
            behavior = "blocked";
            behaviorReason = "paired benchmark missing";
        }
        else if (provenance.malformed) {
            behavior = "fail";
            behaviorReason = "benchmark source provenance is malformed";
        }
        else if (!provenance.value) {
            behavior = "blocked";
            behaviorReason = "benchmark source provenance missing";
        }
        else if (provenance.value !== currentSourceHash) {
            behavior = "fail";
            behaviorReason = "benchmark source hash does not match current skill sources";
        }
        else if (hasBoundProvenance && (evalPlan.malformed || evidenceProvenance.malformed)) {
            behavior = "fail";
            behaviorReason = "benchmark execution provenance is malformed";
        }
        else if (hasBoundProvenance && (!evalPlan.value || !evidenceProvenance.value || !declaredEvalPlan)) {
            behavior = "blocked";
            behaviorReason = "benchmark eval-plan or execution-evidence provenance missing";
        }
        else if (hasBoundProvenance && evalPlan.value !== declaredEvalPlan) {
            behavior = "fail";
            behaviorReason = "benchmark eval-plan hash does not match the current eval plan";
        }
        else if (hasBoundProvenance && (!evidence || evidence.status !== "complete" || evidence.evidence_sha256 !== evidenceProvenance.value)) {
            behavior = "fail";
            behaviorReason = evidence?.errors.join("; ") || "benchmark execution evidence hash does not match current evidence";
        }
        else if (profile === "release") {
            if (adaptive.adaptive) {
                if (adaptive.errors.length) {
                    behavior = "fail";
                    behaviorReason = "adaptive release verification failed: " + adaptive.errors.join("; ");
                }
                else if (adaptive.decision?.decision !== "winner") {
                    behavior = "fail";
                    behaviorReason = "adaptive release requires a final anytime-valid winner; observed " + String(adaptive.decision?.decision ?? "missing");
                }
                else if (adaptive.critical_deterministic_regressions.length) {
                    behavior = "fail";
                    behaviorReason = "adaptive release is blocked by critical deterministic regressions: " + adaptive.critical_deterministic_regressions.join(", ");
                }
                else {
                    behavior = summary.current >= minimum && delta >= minDelta ? "pass" : "fail";
                    behaviorReason = `anytime-valid winner; pass rate ${summary.current.toFixed(4)} (minimum ${minimum}); delta ${delta.toFixed(4)} (minimum ${minDelta})`;
                }
            }
            else {
                const paired = benchmark?.run_summary?.delta?.paired?.pass_rate, n = paired?.count, ci = paired?.confidence_interval_95;
                const validN = Number.isFinite(n) && Number.isInteger(n) && n >= 2;
                const validCi = ci && typeof ci === "object" && Number.isFinite(ci.lower) && Number.isFinite(ci.upper) && ci.lower <= ci.upper;
                if (!validN || paired?.statistically_valid !== true || !validCi) {
                    behavior = "fail";
                    behaviorReason = "release requires finite integer paired sample count >= 2, statistically_valid true, and a finite ordered 95% confidence interval";
                }
                else {
                    behavior = summary.current >= minimum && delta >= minDelta ? "pass" : "fail";
                    behaviorReason = `pass rate ${summary.current.toFixed(4)} (minimum ${minimum}); delta ${delta.toFixed(4)} (minimum ${minDelta})`;
                }
            }
        }
        else {
            behavior = summary.current >= minimum && delta >= minDelta ? "pass" : "fail";
            behaviorReason =
                `pass rate ${summary.current.toFixed(4)} (minimum ${minimum}); ` +
                    `delta ${delta.toFixed(4)} (minimum ${minDelta})`;
        }
    }
    let review = "na";
    let reviewReason = "not required";
    if (strict) {
        if (!workspace || !existsSync(join(workspace, "review.html"))) {
            review = "blocked";
            reviewReason = "review.html missing";
        }
        else if (!humanReview) {
            review = "blocked";
            reviewReason = "human review pending";
        }
        else {
            review = humanReview;
            reviewReason = humanReview === "pass" ? "human review complete" : `human review ${humanReview}`;
        }
    }
    const gates = {
        structure: gate(valid ? "pass" : "fail", true, ["valid frontmatter", "name matches directory"], [message]),
        authoring: gate(authoringAudit.status === "fail" ? "fail" : "pass", true, ["English discovery metadata", "entrypoint line budget", "portable references", "authoring pattern review"], authoringAudit.findings.length
            ? authoringAudit.findings.map((item) => `[${item.rule}] ${item.message}`)
            : [`authoring audit ${authoringAudit.status}; ${authoringAudit.pattern_review.filter((item) => item.relevant).length} relevant pattern(s)`], authoringAudit.status === "fail" ? "error-level authoring audit findings" : undefined),
        portability: gate(missing.length ? "fail" : "pass", true, ["self-contained", "offline bundle complete"], [missing.length ? `missing: ${missing.join(", ")}` : "complete"]),
        tests: gate(tests, strict, ["build and deterministic tests pass"], [`reported: ${tests}`], tests !== "pass" && strict ? "passing test evidence missing" : undefined),
        triggering: gate(triggering, triggeringRequired, ["positive and difficult-negative routing thresholds pass", "sibling overlap checked"], [options.triggeringReason ?? `reported: ${triggering}`], triggering !== "pass" && triggeringRequired ? "passing trigger evidence missing" : undefined),
        behavior: gate(behavior, strict, ["paired runs exist", "pass rates are valid", "source hash matches", "thresholds pass"], [behaviorReason], behavior !== "pass" && strict ? behaviorReason : undefined),
        review: gate(review, strict, ["viewer exists", "human review complete"], [reviewReason], review !== "pass" && strict ? reviewReason : undefined),
    };
    const status = aggregate(gates);
    return {
        schema_version: "1.0",
        artifact: "skill",
        name,
        source_sha256: currentSourceHash,
        profile,
        status,
        generated_at: new Date().toISOString(),
        gates,
        decision_evidence: adaptive.adaptive ? adaptive.decision : benchmark?.decision_evidence ?? null,
        decision_verification: adaptive.adaptive ? { independently_recomputed: true, errors: adaptive.errors, critical_deterministic_regressions: adaptive.critical_deterministic_regressions } : { independently_recomputed: false, mode: "legacy-fixed" },
        evaluation_provenance: workspace ? {
            skill_source_sha256: currentSourceHash,
            eval_plan_sha256: evalPlan.value,
            execution_evidence_sha256: evidenceProvenance.value,
            benchmark_sha256: existsSync(join(workspace, "benchmark.json")) ? artifactHash(join(workspace, "benchmark.json")) : null,
            benchmark_markdown_sha256: existsSync(join(workspace, "benchmark.md")) ? artifactHash(join(workspace, "benchmark.md")) : null,
            review_sha256: existsSync(join(workspace, "review.html")) ? artifactHash(join(workspace, "review.html")) : null,
            analysis_sha256: existsSync(join(workspace, "post-evaluation-pattern-review.json")) ? artifactHash(join(workspace, "post-evaluation-pattern-review.json")) : null,
        } : null,
        critical_failures: Object.entries(gates)
            .filter(([, item]) => item.required && item.status === "fail")
            .map(([gateName]) => gateName),
        artifacts: {
            skill: root,
            authoring_audit: {
                status: authoringAudit.status,
                findings: authoringAudit.findings,
                pattern_review: authoringAudit.pattern_review,
            },
            ...(workspace
                ? {
                    evaluation_workspace: workspace,
                    benchmark: join(workspace, "benchmark.json"),
                    benchmark_markdown: join(workspace, "benchmark.md"),
                    review: join(workspace, "review.html"),
                    analysis: join(workspace, "post-evaluation-pattern-review.json"),
                }
                : {}),
        },
    };
}
export function main() {
    try {
        const { positionals, values } = parseArgs({
            args: process.argv.slice(2),
            allowPositionals: true,
            options: {
                profile: { type: "string", default: "release" },
                evaluation: { type: "string" },
                "tests-status": { type: "string" },
                "triggering-status": { type: "string" },
                "triggering-reason": { type: "string" },
                "human-review": { type: "string" },
                "min-pass-rate": { type: "string", default: "0.8" },
                "min-delta": { type: "string", default: "0" },
                output: { type: "string", short: "o" },
            },
        });
        if (!positionals[0])
            throw new TypeError("skill directory is required");
        const receipt = verifySkill({
            skillPath: positionals[0],
            profile: values.profile,
            evaluation: values.evaluation,
            testsStatus: values["tests-status"],
            triggeringStatus: values["triggering-status"],
            triggeringReason: values["triggering-reason"],
            humanReview: values["human-review"],
            minPassRate: Number(values["min-pass-rate"]),
            minDelta: Number(values["min-delta"]),
        });
        const json = JSON.stringify(receipt, null, 2) + "\n";
        if (values.output) {
            mkdirSync(dirname(resolve(values.output)), { recursive: true });
            writeFileSync(resolve(values.output), json);
        }
        console.log(json.trim());
        process.exit(receipt.status === "pass" ? 0 : 1);
    }
    catch (error) {
        console.error(`verify_skill_gates: ${error.message}`);
        process.exit(2);
    }
}
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (!import.meta.url.includes("/$bunfs/") && invokedPath && fileURLToPath(import.meta.url) === invokedPath)
    main();
