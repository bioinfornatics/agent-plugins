#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { loadRuntimeDependency } from "./runtime-deps.js";
import { collectPackageFiles, sourceHash } from "./package_manifest.js";
import { validateAgentPluginSchema } from "./validate_agent_plugin_schema.js";
import { validate } from "./validate_goose_plugin.js";
import { assessEvidenceReceipt, discoverPluginComponents, evidenceSourceHash } from "./component_evidence.js";
import { productionBindings, verifyProductionApproval } from "./production_approval.js";
import { evaluateEfficiencyGate, writeEfficiencyViewer } from "./efficiency_gate.js";
const AdmZip = loadRuntimeDependency("adm-zip");
const PROFILES = new Set(["static", "evaluation", "release", "production"]);
const TEST_STATUSES = new Set(["pass", "fail", "blocked", "na"]);
const REVIEW_STATUSES = new Set(["pass", "pending", "na"]);
function isDirectory(path) {
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
function makeGate(status, required, checks, evidence, reason) { return { status, required, checks, evidence, ...(reason ? { reason } : {}) }; }
function assertOptions(options) {
    const profile = options.profile ?? "release";
    const testsStatus = options.testsStatus ?? (profile === "static" ? "na" : "blocked");
    const humanReview = options.humanReview ?? (profile === "static" ? "na" : "pending");
    const minPassRate = options.minPassRate ?? 0.8, minDelta = options.minDelta ?? 0;
    if (!PROFILES.has(profile))
        throw new Error("profile must be static, evaluation, release, or production");
    if (!TEST_STATUSES.has(testsStatus))
        throw new Error("tests-status must be pass, fail, blocked, or na");
    if (!REVIEW_STATUSES.has(humanReview))
        throw new Error("human-review must be pass, pending, or na");
    if (!Number.isFinite(minPassRate) || !Number.isFinite(minDelta))
        throw new Error("benchmark thresholds must be finite numbers");
    if (minPassRate < 0 || minPassRate > 1)
        throw new Error("min-pass-rate must be between 0 and 1");
    return { profile: profile, testsStatus: testsStatus, humanReview: humanReview, minPassRate, minDelta };
}
export function componentHash(pathArg) {
    // Compatibility helper: when handed a canonical component path, return the same
    // conservative whole-plugin freshness hash used by discovery.
    const path = resolve(pathArg), skillRoot = basename(dirname(path)) === "skills" ? dirname(dirname(path)) : null;
    if (skillRoot) {
        const component = discoverPluginComponents(skillRoot).find(value => value.path === path);
        if (component)
            return component.source_sha256;
    }
    return evidenceSourceHash(path);
}
function aggregate(gates) {
    const required = Object.values(gates).filter(gate => gate.required);
    if (required.some(gate => gate.status === "fail"))
        return "fail";
    if (required.some(gate => gate.status !== "pass"))
        return "blocked";
    return "pass";
}
function finiteRate(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null; }
function benchmarkGate(workspace, currentHash, minRate, minDelta) {
    if (!workspace)
        return { status: "blocked", reason: "integration workspace missing" };
    const benchmark = loadJson(join(workspace, "benchmark.json"));
    if (!benchmark)
        return { status: "blocked", reason: "benchmark.json missing or invalid" };
    if (benchmark.metadata?.evaluated_source_sha256 !== currentHash)
        return { status: "blocked", reason: "benchmark source hash missing or stale" };
    const summary = benchmark.run_summary;
    if (!summary || typeof summary !== "object")
        return { status: "blocked", reason: "benchmark run_summary missing" };
    const variants = Object.keys(summary).filter(key => !["delta", "paired", "efficiency_conclusions"].includes(key));
    const currentKey = variants.find(key => /with_(skill|agent)|candidate|current/i.test(key));
    const baseKey = variants.find(key => /old_(skill|agent)|without_(skill|agent)|baseline|control/i.test(key));
    const rate = finiteRate(currentKey ? summary[currentKey]?.pass_rate?.mean : undefined);
    const base = finiteRate(baseKey ? summary[baseKey]?.pass_rate?.mean : undefined);
    if (rate === null || base === null)
        return { status: "blocked", reason: "paired benchmark rates must be finite numbers between 0 and 1" };
    const delta = rate - base, pass = rate >= minRate && delta >= minDelta;
    return { status: pass ? "pass" : "fail", reason: `pass rate ${rate.toFixed(4)} (minimum ${minRate}); delta ${delta.toFixed(4)} (minimum ${minDelta})` };
}
function safeArchiveName(name) { return Boolean(name) && !name.includes("\\") && !name.startsWith("/") && !/^[A-Za-z]:/.test(name) && !name.split("/").some(part => part === ".." || part === ""); }
function distributionGate(root, rootName, archiveArg) {
    if (!archiveArg || !existsSync(resolve(archiveArg)))
        return { status: "blocked", reason: "archive missing" };
    const archive = resolve(archiveArg);
    try {
        const expected = new Map(collectPackageFiles(root, [archive]).map(file => [rootName + "/" + file.relative, file.sha256]));
        const actual = new Map();
        const seen = new Set();
        for (const entry of new AdmZip(archive).getEntries()) {
            const name = entry.entryName;
            if (!safeArchiveName(name))
                return { status: "fail", reason: "unsafe archive entry: " + name };
            if (seen.has(name))
                return { status: "fail", reason: "duplicate archive entry: " + name };
            seen.add(name);
            const unixType = (entry.attr >>> 16) & 0o170000;
            if (unixType === 0o120000)
                return { status: "fail", reason: "symbolic link archive entry: " + name };
            if (entry.isDirectory)
                continue;
            actual.set(name, createDigest(entry.getData()));
        }
        const mismatch = [...expected].find(([name, hash]) => actual.get(name) !== hash);
        const extra = [...actual.keys()].find(name => !expected.has(name));
        if (mismatch || extra || actual.size !== expected.size)
            return { status: "fail", reason: mismatch ? "archive content mismatch: " + mismatch[0] : extra ? "unexpected archive entry: " + extra : "archive file count mismatch" };
        return { status: "pass", reason: actual.size + " files match canonical package manifest" };
    }
    catch (error) {
        return { status: "fail", reason: "invalid archive: " + error.message };
    }
}
function createDigest(data) { return createHash("sha256").update(data).digest("hex"); }
export function verifyPlugin(options) {
    const parsed = assertOptions(options), root = resolve(options.pluginPath), strict = parsed.profile !== "static";
    const manifest = loadJson(join(root, "plugin.json")), name = manifest?.name ?? basename(root);
    const schema = validateAgentPluginSchema(root), operational = validate(root);
    const receiptList = (options.componentReceipts ?? []).map(path => ({ path: resolve(path), value: loadJson(resolve(path)) }));
    const receipts = new Map(), receiptKeys = [];
    for (const { value } of receiptList)
        if (value?.name && value?.artifact) {
            const key = value.artifact + ":" + value.name;
            receiptKeys.push(key);
            receipts.set(key, value);
        }
    const components = discoverPluginComponents(root), componentKeys = components.map(component => component.key);
    const fullPlugin = components.some(component => component.kind !== "skill");
    const componentProblems = [], componentAggregation = {};
    const allowedReceiptKeys = new Set([...componentKeys, "integration:" + name]);
    for (const key of receiptKeys)
        if (!allowedReceiptKeys.has(key))
            componentProblems.push("unknown component receipt key: " + key);
    for (const key of new Set(receiptKeys))
        if (receiptKeys.filter(candidate => candidate === key).length > 1)
            componentProblems.push("duplicate component receipt key: " + key);
    for (const component of components) {
        const receipt = receipts.get(component.key) ?? receiptList.find(entry => entry.value?.name === component.id && entry.value?.artifact === component.kind)?.value;
        if (!receipt) {
            componentProblems.push(component.key + ": receipt missing");
            componentAggregation[component.key] = { kind: component.kind, name: component.id, status: "blocked", applicable: true, reason: "receipt missing", source_sha256: component.source_sha256 };
            continue;
        }
        const assessment = assessEvidenceReceipt(receipt, component.kind, component.source_sha256);
        if (fullPlugin && !assessment.typed)
            assessment.problems.push("typed evidence envelope required for full plugin");
        const status = assessment.status;
        for (const problem of assessment.problems)
            componentProblems.push(component.key + ": " + problem);
        componentAggregation[component.key] = { kind: component.kind, name: component.id, status, applicable: receipt.applicability?.status !== "na", ...(receipt.applicability?.reason ? { reason: receipt.applicability.reason } : {}), source_sha256: component.source_sha256, receipt_source_sha256: receipt.source_sha256, fresh: receipt.source_sha256 === component.source_sha256, typed: assessment.typed, checks: receipt.checks ?? [] };
    }
    const componentStatuses = Object.values(componentAggregation).map((value) => value.status);
    const componentStatus = componentStatuses.includes("fail") ? "fail" : componentStatuses.includes("blocked") || componentProblems.length ? "blocked" : "pass";
    const integrationReceipt = receiptList.find(entry => entry.value?.artifact === "integration")?.value;
    const integrationAssessment = fullPlugin ? assessEvidenceReceipt(integrationReceipt, "integration", sourceHash(root), componentKeys) : null;
    const archive = options.archive ? resolve(options.archive) : undefined;
    const currentHash = sourceHash(root, archive ? [archive] : []);
    const benchmarkPath = options.integration ? join(resolve(options.integration), "benchmark.json") : "";
    const benchmarkDocument = benchmarkPath ? loadJson(benchmarkPath) : null;
    const benchmark = strict ? benchmarkGate(options.integration ? resolve(options.integration) : "", currentHash, parsed.minPassRate, parsed.minDelta) : { status: "na", reason: "not required" };
    const efficiency = strict && benchmarkDocument ? evaluateEfficiencyGate(benchmarkDocument, { max_regressions: options.maxEfficiencyRegressions, missing_telemetry: options.missingEfficiencyTelemetry }) : null;
    const efficiencyStatus = !strict ? "na" : !benchmarkDocument ? "blocked" : efficiency.status;
    const efficiencyViewer = efficiency && options.integration ? writeEfficiencyViewer(resolve(options.integration), efficiency) : null;
    let integrationStatus = benchmark.status;
    const integrationEvidence = [benchmark.reason];
    if (strict && fullPlugin) {
        if (!integrationAssessment) {
            integrationStatus = "blocked";
            integrationEvidence.push("typed integration receipt missing");
        }
        else {
            integrationEvidence.push(...integrationAssessment.problems.map(problem => "integration receipt: " + problem));
            if (integrationAssessment.status === "fail")
                integrationStatus = "fail";
            else if (integrationAssessment.status !== "pass" && integrationStatus !== "fail")
                integrationStatus = "blocked";
            else if (benchmark.status === "pass")
                integrationEvidence.push("typed integration coverage and handoffs verified");
        }
    }
    const distribution = strict ? distributionGate(root, name, archive) : { status: "na", reason: "not required" };
    let review = "na", reviewReason = "not required", approvalEvidence = [];
    const workspace = options.integration ? resolve(options.integration) : "";
    if (strict) {
        if (!workspace || !existsSync(join(workspace, "review.html"))) {
            review = "blocked";
            reviewReason = "integration review.html missing";
        }
        else if (parsed.profile !== "production") {
            review = parsed.humanReview === "pass" ? "pass" : "blocked";
            reviewReason = review === "pass" ? "human review complete" : "human review " + parsed.humanReview;
        }
        else if (!options.approval || !options.approvalTrustPolicy || !options.testEvidence || !archive) {
            review = "blocked";
            reviewReason = "production requires approval file, trust policy, test evidence, and exact bindings; --human-review cannot approve release";
        }
        else
            try {
                const expected = productionBindings(root, archive, workspace, options.testEvidence), verified = verifyProductionApproval(options.approval, options.approvalTrustPolicy, expected);
                review = "pass";
                reviewReason = "identity-bound production approval verified";
                approvalEvidence = ["request " + verified.request_id, "approval " + verified.approval_sha256, ...Object.entries(expected).map(([k, v]) => k + ": " + v)];
            }
            catch (error) {
                review = "blocked";
                reviewReason = error.message;
            }
    }
    const gates = {
        identity: makeGate(schema.valid && !operational.errors.length ? "pass" : "fail", true, ["Agent Plugins 1.0.0 schemas pass", "operational validation passes"], [...schema.errors.map(e => e.path + ": " + e.message), ...operational.errors, ...operational.warnings]),
        components: makeGate(componentStatus, true, ["every discovered component has applicable typed evidence", "component source hashes are current", "N/A has an explicit reason"], componentProblems.length ? componentProblems : [components.length + " component receipts verified"], componentStatus === "blocked" ? "missing, invalid, non-passing, or stale component evidence" : undefined),
        integration: makeGate(integrationStatus, strict, ["paired benchmark rates are valid", "plugin source hash is current", "all components have integration coverage", "cross-component handoffs are evidenced"], integrationEvidence, integrationStatus === "blocked" ? integrationEvidence.at(-1) : undefined),
        efficiency: makeGate(efficiencyStatus, strict, ["configured efficiency regressions pass", "missing telemetry follows explicit policy", "Pareto values, paired deltas, confidence intervals, and coverage are reported"], [efficiency?.reason ?? "benchmark telemetry unavailable"], efficiencyStatus === "blocked" ? "benchmark telemetry unavailable" : undefined),
        distribution: makeGate(distribution.status, strict, ["entries are safe and unique", "archive matches canonical package manifest"], [distribution.reason], distribution.status === "blocked" ? distribution.reason : undefined),
        regression: makeGate(parsed.testsStatus, strict, ["component and plugin tests pass", "offline smoke passes"], ["reported: " + parsed.testsStatus], parsed.testsStatus === "blocked" ? "test evidence missing" : undefined),
        review: makeGate(review, strict, ["viewer exists", "identity-bound production approval verifies exact release inputs"], [reviewReason, ...approvalEvidence], review === "blocked" ? reviewReason : undefined)
    };
    const status = aggregate(gates);
    return { schema_version: "1.0", artifact: "plugin", name, profile: parsed.profile, status, source_sha256: currentHash, generated_at: new Date().toISOString(), gates, critical_failures: Object.entries(gates).filter(([, gate]) => gate.required && gate.status === "fail").map(([gate]) => gate), release_eligible: (parsed.profile === "release" || parsed.profile === "production") && status === "pass", component_summary: { discovered: components.length, pass: Object.values(componentAggregation).filter((value) => value.status === "pass").length, fail: Object.values(componentAggregation).filter((value) => value.status === "fail").length, blocked: Object.values(componentAggregation).filter((value) => value.status === "blocked").length, na: Object.values(componentAggregation).filter((value) => value.status === "na").length }, components: componentAggregation, efficiency: efficiency?.pareto_report ?? null, integration_evidence: integrationReceipt ? { status: integrationAssessment?.status, source_sha256: integrationReceipt.source_sha256, covered_components: integrationReceipt.payload?.covered_components ?? [], handoffs: integrationReceipt.payload?.handoffs ?? [] } : null, artifacts: { plugin: root, ...(workspace ? { integration_workspace: workspace, benchmark: join(workspace, "benchmark.json"), review: join(workspace, "review.html"), ...(efficiencyViewer ? { efficiency_report: efficiencyViewer } : {}) } : {}), ...(archive ? { archive } : {}) } };
}
export function main() {
    try {
        const { positionals, values } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: { profile: { type: "string", default: "release" }, "component-receipt": { type: "string", multiple: true }, integration: { type: "string" }, archive: { type: "string" }, "tests-status": { type: "string" }, "human-review": { type: "string" }, approval: { type: "string" }, "approval-trust-policy": { type: "string" }, "test-evidence": { type: "string" }, "min-pass-rate": { type: "string", default: "0.8" }, "min-delta": { type: "string", default: "0" }, "max-p50-wall-latency-regression-ms": { type: "string" }, "max-p95-wall-latency-regression-ms": { type: "string" }, "max-turn-regression": { type: "string" }, "max-input-token-regression": { type: "string" }, "max-output-token-regression": { type: "string" }, "max-cached-token-regression": { type: "string" }, "max-reasoning-token-regression": { type: "string" }, "max-total-token-regression": { type: "string" }, "max-cost-regression": { type: "string" }, "missing-efficiency-telemetry": { type: "string", default: "ignore" }, output: { type: "string", short: "o" } } });
        if (!positionals[0])
            throw new Error("usage: verify_plugin_gates.js <plugin-dir> --component-receipt <receipt>... [options]");
        const receipt = verifyPlugin({ pluginPath: positionals[0], profile: values.profile, componentReceipts: values["component-receipt"], integration: values.integration, archive: values.archive, testsStatus: values["tests-status"], humanReview: values["human-review"], approval: values.approval, approvalTrustPolicy: values["approval-trust-policy"], testEvidence: values["test-evidence"], minPassRate: Number(values["min-pass-rate"]), minDelta: Number(values["min-delta"]), missingEfficiencyTelemetry: values["missing-efficiency-telemetry"], maxEfficiencyRegressions: Object.fromEntries([["p50_wall_latency_ms", values["max-p50-wall-latency-regression-ms"]], ["p95_wall_latency_ms", values["max-p95-wall-latency-regression-ms"]], ["actual_turns", values["max-turn-regression"]], ["tokens.input", values["max-input-token-regression"]], ["tokens.output", values["max-output-token-regression"]], ["tokens.cached", values["max-cached-token-regression"]], ["tokens.reasoning", values["max-reasoning-token-regression"]], ["tokens.total", values["max-total-token-regression"]], ["cost", values["max-cost-regression"]]].filter(([, v]) => v !== undefined).map(([k, v]) => [k, Number(v)])) });
        const json = JSON.stringify(receipt, null, 2) + "\n";
        if (values.output) {
            mkdirSync(dirname(resolve(values.output)), { recursive: true });
            writeFileSync(resolve(values.output), json);
        }
        console.log(json.trim());
        process.exit(receipt.status === "pass" ? 0 : 1);
    }
    catch (error) {
        console.error(error.message);
        process.exit(2);
    }
}
if (!import.meta.url.includes("/$bunfs/") && process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]))
    main();
