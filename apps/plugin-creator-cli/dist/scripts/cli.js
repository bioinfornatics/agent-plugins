#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "./validate_goose_plugin.js";
import { validateAgentPluginSchema } from "./validate_agent_plugin_schema.js";
import { fullEval } from "./full_eval.js";
import { runCiEval } from "./ci_eval.js";
import { inspectGoldenEvidence, listGoldenJourneys, runGoldenJourney } from "./golden_journeys.js";
import { renderCiProgress, renderHistoricalReview, renderMachineJsonl, renderTerminalProgress } from "./progress_projections.js";
import { replayExecutionEvents } from "./execution_event_stream.js";
import { loadPortablePlugin } from "./portable_loader.js";
import { runEmbedded } from "./runtime-dispatch.js";
export const EXIT_SUCCESS = 0, EXIT_FAILURE = 1, EXIT_USAGE = 2, EXIT_BLOCKED = 3;
const HERE = dirname(fileURLToPath(import.meta.url));
const HELP = "Usage: plugin-creator <init|validate|migrate|verify|package|full-eval|ci-eval|independent-review|golden-e2e|decision-research> [options]\n\nCommon options:\n  --format text|json|jsonl|ci|review  Output format (default: text)\n  --mode portable-load|strict-authoring  Validation mode\n  --quiet             Suppress normal output\n  --help              Show help\n\nfull-eval options:\n  <plugin-dir> [--workspace DIR] [--component-receipt FILE ...]\n  [--integration DIR] [--archive ZIP] [--tests-status STATUS]\n  [--human-review pass|pending|na] [--approval FILE --approval-trust-policy FILE --test-evidence FILE] [--total-budget-ms MS] [--heartbeat-ms MS] [--stale-after-ms MS] [--lease-ms MS] [--cancellation-grace-ms MS]\n  [--production] [--dry-run] [--resume] [--cancel] [--progress quiet|normal|verbose]\n\nindependent-review options:\n  --config FILE --host COMMAND [--host-arg ARG ...]  Run isolated review branches\n\nci-eval options:\n  --config FILE        Provider-neutral, non-interactive CI configuration\n\ngolden-e2e options:\n  --list | --journey ID --workspace DIR [--profile novice|expert]\n  [--override key=value ...] [--resume] [--cancel] [--inspect] [--stale-after-ms MS]\n\ndecision-research options:\n  --input FILE        Analyze anonymous research sessions offline\n\nCI exit codes: 0 success, 1 evaluation failure, 2 invalid config, 3 blocked capability/evidence, 4 pending approval.";
function parseCommon(args) { let format = "text", mode = "strict-authoring", quiet = false, help = false; const rest = []; for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--quiet" || a === "-q")
        quiet = true;
    else if (a === "--help" || a === "-h")
        help = true;
    else if (a === "--mode") {
        const v = args[++i];
        if (!["portable-load", "strict-authoring"].includes(v))
            return "--mode must be portable-load or strict-authoring";
        mode = v;
    }
    else if (a.startsWith("--mode=")) {
        const v = a.slice(7);
        if (!["portable-load", "strict-authoring"].includes(v))
            return "--mode must be portable-load or strict-authoring";
        mode = v;
    }
    else if (a === "--format") {
        const v = args[++i];
        if (!["text", "json", "jsonl", "ci", "review"].includes(v))
            return "--format must be text, json, jsonl, ci, or review";
        format = v;
    }
    else if (a.startsWith("--format=")) {
        const v = a.slice(9);
        if (!["text", "json", "jsonl", "ci", "review"].includes(v))
            return "--format must be text, json, jsonl, ci, or review";
        format = v;
    }
    else
        rest.push(a);
} return { format, quiet, help, mode, args: rest }; }
function emit(value, text, o) { if (!o.quiet)
    console.log(o.format === "json" ? JSON.stringify(value, null, 2) : text); }
function usage(message) { if (message)
    console.error(message); console.error(HELP); return EXIT_USAGE; }
async function child(script, args) {
    if (script === "init_goose_plugin.js")
        return runEmbedded((await import("./init_goose_plugin.js")).main, args);
    if (script === "package_goose_plugin.js")
        return runEmbedded((await import("./package_goose_plugin.js")).main, args);
    if (script === "migrate_plugin.js")
        return runEmbedded((await import("./migrate_plugin.js")).main, args);
    if (script === "verify_plugin_gates.js")
        return runEmbedded((await import("./verify_plugin_gates.js")).main, args);
    throw new Error("unsupported embedded command: " + script);
}
async function wrapped(command, o) { if (!o.args.length)
    return usage(command + " requires a target"); const r = await child(command === "init" ? "init_goose_plugin.js" : "package_goose_plugin.js", o.args), out = (r.stdout ?? "").trim(), err = (r.stderr ?? "").trim(), code = r.status ?? 1; if (code) {
    console.error(err || out);
    return code === 2 ? 2 : 1;
} const output = out.split(/\r?\n/).filter(Boolean).at(-1) ?? ""; emit({ ok: true, command, output }, output, o); return 0; }
function runValidate(o) { if (o.args.length !== 1)
    return usage("validate requires exactly one plugin directory"); const target = resolve(o.args[0]); if (o.mode === "portable-load") {
    const outcome = loadPortablePlugin(target, o.mode);
    emit({ ok: outcome.status === "accepted", command: "validate", target, outcome }, "Portable load: " + outcome.status, o);
    return outcome.status === "accepted" ? 0 : 1;
} const schema = validateAgentPluginSchema(target, "auto", "strict-authoring"), structural = validate(target), ok = schema.valid && !structural.errors.length; const lines = [...schema.documents.map(d => (d.valid ? "VALID: " : "INVALID: ") + d.file + " (" + d.type + ")"), ...schema.errors.map(e => "SCHEMA ERROR: " + e.path + ": " + e.message), ...structural.warnings.map(w => "WARNING: " + w), ...structural.errors.map(e => "ERROR: " + e), ...(ok ? ["OK: " + target] : [])]; emit({ ok, command: "validate", target, schema, structural }, lines.join("\n"), o); return ok ? 0 : 1; }
async function runMigrate(o) { if (!o.args.length)
    return usage("migrate requires a plugin directory"); const r = await child("migrate_plugin.js", o.args), raw = (r.stdout ?? "").trim(); let report; try {
    report = JSON.parse(raw);
}
catch {
    console.error((r.stderr ?? raw).trim());
    return r.status === 2 ? 2 : 1;
} emit(report, "Migration: " + String(report.status).toUpperCase(), o); return report.status === "blocked" ? 3 : 0; }
async function runVerify(o) { if (!o.args.length)
    return usage("verify requires a plugin directory"); const r = await child("verify_plugin_gates.js", o.args), raw = (r.stdout ?? "").trim(); let receipt; try {
    receipt = JSON.parse(raw);
}
catch {
    console.error((r.stderr ?? raw).trim());
    return r.status === 2 ? 2 : 1;
} emit(receipt, "Plugin " + receipt.name + ": " + String(receipt.status).toUpperCase() + " (" + receipt.profile + ")", o); return receipt.status === "pass" ? 0 : receipt.status === "blocked" ? 3 : 1; }
async function runFullEval(o) {
    if (!o.args[0] || o.args[0].startsWith("-"))
        return usage("full-eval requires a plugin directory");
    const options = { pluginPath: o.args[0] }, receipts = [];
    let progressMode = o.quiet ? "quiet" : "normal";
    const value = new Set(["--workspace", "--component-receipt", "--integration", "--archive", "--tests-status", "--human-review", "--approval", "--approval-trust-policy", "--test-evidence", "--min-pass-rate", "--min-delta", "--max-p50-wall-latency-regression-ms", "--max-p95-wall-latency-regression-ms", "--max-turn-regression", "--max-input-token-regression", "--max-output-token-regression", "--max-cached-token-regression", "--max-reasoning-token-regression", "--max-total-token-regression", "--max-cost-regression", "--missing-efficiency-telemetry", "--total-budget-ms", "--heartbeat-ms", "--stale-after-ms", "--lease-ms", "--cancellation-grace-ms", "--progress"]);
    for (let i = 1; i < o.args.length; i++) {
        const a = o.args[i];
        if (a === "--production")
            options.production = true;
        else if (a === "--dry-run")
            options.dryRun = true;
        else if (a === "--resume")
            options.resume = true;
        else if (a === "--cancel")
            options.cancel = true;
        else if (value.has(a)) {
            const v = o.args[++i];
            if (!v || v.startsWith("--"))
                return usage(a + " requires a value");
            if (a === "--progress") {
                if (!["quiet", "normal", "verbose"].includes(v))
                    return usage("--progress must be quiet, normal, or verbose");
                progressMode = v;
            }
            else if (a === "--component-receipt")
                receipts.push(v);
            else if (a === "--workspace")
                options.workspace = v;
            else if (a === "--integration")
                options.integration = v;
            else if (a === "--archive")
                options.archive = v;
            else if (a === "--tests-status")
                options.testsStatus = v;
            else if (a === "--human-review")
                options.humanReview = v;
            else if (a === "--approval")
                options.approval = v;
            else if (a === "--approval-trust-policy")
                options.approvalTrustPolicy = v;
            else if (a === "--test-evidence")
                options.testEvidence = v;
            else if (a === "--min-pass-rate")
                options.minPassRate = Number(v);
            else if (a === "--min-delta")
                options.minDelta = Number(v);
            else if (a === "--missing-efficiency-telemetry")
                options.missingEfficiencyTelemetry = v;
            else if (a.startsWith("--max-") && a.endsWith("-regression") || a.endsWith("-regression-ms")) {
                const dimensions = { "--max-p50-wall-latency-regression-ms": "p50_wall_latency_ms", "--max-p95-wall-latency-regression-ms": "p95_wall_latency_ms", "--max-turn-regression": "actual_turns", "--max-input-token-regression": "tokens.input", "--max-output-token-regression": "tokens.output", "--max-cached-token-regression": "tokens.cached", "--max-reasoning-token-regression": "tokens.reasoning", "--max-total-token-regression": "tokens.total", "--max-cost-regression": "cost" };
                options.maxEfficiencyRegressions = { ...options.maxEfficiencyRegressions, [dimensions[a]]: Number(v) };
            }
            else if (a === "--total-budget-ms")
                options.reliability = { ...options.reliability, total_budget_ms: Number(v) };
            else if (a === "--heartbeat-ms")
                options.reliability = { ...options.reliability, heartbeat_ms: Number(v) };
            else if (a === "--stale-after-ms")
                options.reliability = { ...options.reliability, stale_after_ms: Number(v) };
            else if (a === "--lease-ms")
                options.reliability = { ...options.reliability, lease_ms: Number(v) };
            else
                options.reliability = { ...options.reliability, cancellation_grace_ms: Number(v) };
        }
        else
            return usage("Unknown full-eval option: " + a);
    }
    if (receipts.length)
        options.componentReceipts = receipts;
    try {
        const result = await fullEval(options);
        if (!o.quiet) {
            if (o.format === "json")
                console.log(JSON.stringify(result, null, 2));
            else {
                const events = options.dryRun ? [] : replayExecutionEvents(result.event_file).events, projection = o.format === "jsonl" ? renderMachineJsonl(events) : o.format === "ci" ? renderCiProgress(events) : o.format === "review" ? renderHistoricalReview(events) : renderTerminalProgress(events, progressMode);
                if (projection.output)
                    process.stdout.write(projection.output + (projection.output.endsWith("\n") ? "" : "\n"));
            }
        }
        return result.exit_code;
    }
    catch (error) {
        if (o.format === "jsonl")
            console.error(JSON.stringify({ kind: "full-eval-error", message: error.message }));
        else
            console.error(error.message);
        return 1;
    }
}
export async function runCli(argv) { const [command, ...raw] = argv; if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    return 0;
} if (!["init", "validate", "migrate", "verify", "package", "full-eval", "ci-eval", "independent-review", "golden-e2e", "decision-research"].includes(command))
    return usage("Unknown command: " + command); const o = parseCommon(raw); if (typeof o === "string")
    return usage(o); if (o.help) {
    console.log(HELP);
    return 0;
} if (command === "decision-research") {
    const i = o.args.indexOf("--input"), input = i >= 0 ? o.args[i + 1] : undefined;
    if (!input || o.args.length !== 2)
        return usage("decision-research requires --input FILE");
    try {
        const { analyzeDecisionResearchFile } = await import("./decision_comprehension.js");
        const result = analyzeDecisionResearchFile(input);
        emit(result, "Decision research: " + result.status, o);
        return result.status === "pass" ? EXIT_SUCCESS : EXIT_BLOCKED;
    }
    catch (error) {
        console.error(error.message);
        return EXIT_USAGE;
    }
} if (command === "golden-e2e") {
    try {
        if (o.args.includes("--list")) {
            const items = listGoldenJourneys();
            emit(items, items.map(x => x.id + " - " + x.title).join("\n"), o);
            return 0;
        }
        const val = (name) => { const i = o.args.indexOf(name); return i >= 0 ? o.args[i + 1] : undefined; }, journey = val("--journey"), workspace = val("--workspace"), profile = (val("--profile") ?? "novice");
        if (!journey || !workspace)
            return usage("golden-e2e requires --journey ID --workspace DIR");
        if (o.args.includes("--inspect")) {
            const result = inspectGoldenEvidence(workspace, new Date(), Number(val("--stale-after-ms") ?? 86400000));
            emit(result, "Golden evidence: " + result.status + "; activation denied", o);
            return result.status === "fresh" ? 3 : 1;
        }
        const overrides = {};
        for (let i = 0; i < o.args.length; i++)
            if (o.args[i] === "--override") {
                const pair = o.args[++i] ?? "", at = pair.indexOf("=");
                if (at < 1)
                    return usage("--override requires key=value");
                const raw = pair.slice(at + 1);
                overrides[pair.slice(0, at)] = raw === "true" ? true : raw === "false" ? false : Number.isFinite(Number(raw)) ? Number(raw) : raw;
            }
        const result = await runGoldenJourney({ journey, workspace, profile, overrides, resume: o.args.includes("--resume"), cancel: o.args.includes("--cancel") });
        emit(result, "Golden journey " + journey + ": " + result.status + "; activation denied", o);
        return result.status === "pending-production-approval" ? 4 : 3;
    }
    catch (error) {
        console.error(error.message);
        return 2;
    }
} if (command === "independent-review") {
    const ci = o.args.indexOf("--config"), hi = o.args.indexOf("--host"), configPath = ci >= 0 ? o.args[ci + 1] : undefined, host = hi >= 0 ? o.args[hi + 1] : undefined, hostArgs = [];
    for (let i = 0; i < o.args.length; i++)
        if (o.args[i] === "--host-arg") {
            if (!o.args[i + 1])
                return usage("--host-arg requires a value");
            hostArgs.push(o.args[++i]);
        }
    if (!configPath || !host)
        return usage("independent-review requires --config FILE --host COMMAND");
    try {
        const { runIndependentReview, commandBranchHost } = await import("./independent_review.js"), config = JSON.parse(readFileSync(resolve(configPath), "utf8")), result = await runIndependentReview(config, commandBranchHost(host, hostArgs));
        emit(result, "Independent review: " + result.runId + " (" + result.branches.filter(x => x.status === "succeeded").length + "/" + result.branches.length + " branches succeeded)", o);
        return result.branches.some(x => x.status !== "succeeded") ? EXIT_FAILURE : EXIT_SUCCESS;
    }
    catch (error) {
        console.error(error.message);
        return EXIT_USAGE;
    }
} if (command === "ci-eval") {
    const i = o.args.indexOf("--config"), path = i >= 0 ? o.args[i + 1] : undefined;
    if (!path || o.args.length !== 2)
        return usage("ci-eval requires --config FILE");
    const result = await runCiEval(resolve(path));
    if (!o.quiet)
        console.log(JSON.stringify(result, null, 2));
    return result.exit_code;
} if (command === "validate")
    return runValidate(o); if (command === "migrate")
    return await runMigrate(o); if (command === "verify")
    return await runVerify(o); if (command === "full-eval")
    return await runFullEval(o); return await wrapped(command, o); }
if (!import.meta.url.includes("/$bunfs/") && process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]))
    process.exitCode = await runCli(process.argv.slice(2));
