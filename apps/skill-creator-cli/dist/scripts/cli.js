#!/usr/bin/env node
/** Unified command-line interface for skill-creator workflows. */
import { runEmbedded } from "./runtime-dispatch.js";
import { AGGREGATE_HELP, FULL_EVAL_HELP } from "./cli_help.js";
const commands = {
    candidate: { entry: "idea_to_candidate.js", usage: "candidate <workspace> [--idea <plain-language idea>] [options]", required: (a) => Boolean(a[0] && !a[0].startsWith("-")) },
    validate: { entry: "quick_validate.js", usage: "validate <skill-directory>", required: (a) => Boolean(a[0] && !a[0].startsWith("-")) },
    audit: { entry: "audit_skill.js", usage: "audit <skill-directory> [-o audit.json]", required: (a) => Boolean(a[0] && !a[0].startsWith("-")) },
    "design-evals": { entry: "design_evals.js", usage: "design-evals <evals.json> [--skill-path <dir>] [--normalize <file>]", required: (a) => Boolean(a[0] && !a[0].startsWith("-")) },
    "freeze-evals": { entry: "freeze_eval_scenarios.js", usage: "freeze-evals <elicitation.json> [--draft] -o <frozen-plan.json>", required: (a) => Boolean(a[0] && !a[0].startsWith("-")) },
    analyze: { entry: "analyze_evaluation.js", usage: "analyze <evaluation-workspace> --skill-path <dir> [-o analysis.json]", required: (a) => Boolean(a[0] && !a[0].startsWith("-")) && hasValue(a, "--skill-path") },
    "evidence-loop": { entry: "evidence_improvement.js", usage: "evidence-loop <evaluation-workspace> --skill-path <dir> --loop <ledger-dir> [--proposal <json>|--approve <complete-plan-sha256>|--results <workspace>|--cancel] [budgets]", required: (a) => Boolean(a[0] && !a[0].startsWith("-")) && hasValue(a, "--skill-path") && hasValue(a, "--loop") },
    "full-eval": { entry: "full_eval.js", usage: "full-eval <skill-directory> [--workspace <dir>] [--eval-set <file>] [--execute] [--concurrency <n>] [--provider-concurrency <n>] [--provider-rpm <n>] [--provider-max-attempts <n>] [--max-cost-usd <n>] [--max-tokens <n>] [--max-provider-seconds <n>] [--cache-dir <dir>|--no-cache] [--progress auto|terminal|jsonl|none] [--progress-interval <ms>] [--model <id>] [--run-profile fast|standard|release] [--baseline-skill <dir>] [--dry-run] [--resume|--retry|--cancel] [--finalize-release] [options]", required: (a) => Boolean(a[0] && !a[0].startsWith("-")) },
    "migrate-evaluation": { entry: "evaluation_workspace_migration.js", usage: "migrate-evaluation <workspace> [--dry-run|--preview] | migrate-evaluation <workspace> --rollback --expected-original-sha256 <sha256>", required: (a) => Boolean(a[0] && !a[0].startsWith("-")) },
    "trigger-eval": { entry: "run_eval.js", usage: "trigger-eval --eval-set <file> --skill-path <dir> [options]", required: (a) => hasValue(a, "--eval-set") && hasValue(a, "--skill-path") },
    aggregate: { entry: "aggregate_benchmark.js", usage: "aggregate <benchmark-directory> [options]", required: (a) => Boolean(a[0] && !a[0].startsWith("-")) },
    review: { entry: "../eval-viewer/generate_review.js", usage: "review <workspace> [options]", required: (a) => Boolean(a[0] && !a[0].startsWith("-")) },
    verify: { entry: "verify_skill_gates.js", usage: "verify <skill-directory> [options]", required: (a) => Boolean(a[0] && !a[0].startsWith("-")) },
    package: { entry: "package_skill.js", usage: "package <skill-directory> [output-directory]", required: (a) => Boolean(a[0] && !a[0].startsWith("-")) },
    "usability-study": { entry: "usability_study.js", usage: "usability-study [--validate] <session.json|sessions-directory|sessions.json> [-o report.json]", required: (a) => a.some((value) => !value.startsWith("-")) },
    "screen-reader-acceptance": { entry: "screen_reader_acceptance.js", usage: "screen-reader-acceptance <records> [--attestations <receipts>] | --create-attestation-request <record> --issued-at <UTC> --expires-at <UTC> | --verify-attestation <receipt> --record <record> | --create-policy-signing-request <proposed-policy>", required: (a) => a.some((value) => !value.startsWith("-")) },
    "prepare-grading": { entry: "prepare_grading.js", usage: "prepare-grading <workspace>", required: (a) => Boolean(a[0] && !a[0].startsWith("-")) },
    "grading-status": { entry: "prepare_grading.js", usage: "grading-status <workspace>", required: (a) => Boolean(a[0] && !a[0].startsWith("-")) },
    "import-grading": { entry: "import_grading.js", usage: "import-grading <workspace> [--budget <n>]", required: (a) => Boolean(a[0] && !a[0].startsWith("-")) },
    "group-grading-batches": { entry: "batch_grading.js", usage: "group-grading-batches <workspace>", required: (a) => Boolean(a[0] && !a[0].startsWith("-")) },
    "apply-grading-batch": { entry: "batch_grading.js", usage: "apply-grading-batch <workspace> <batch-id> <results.json>", required: (a) => Boolean(a[0] && !a[0].startsWith("-") && a[1] && a[2]) },
};
function hasValue(args, option) {
    const index = args.indexOf(option);
    return index >= 0 && Boolean(args[index + 1] && !args[index + 1].startsWith("-"));
}
function help(command) {
    if (command === "full-eval")
        return FULL_EVAL_HELP;
    if (command === "aggregate")
        return AGGREGATE_HELP;
    if (command)
        return `Usage: skill-creator ${commands[command].usage}

Common options:
  --format text|json  Select output format (default: text)
  --quiet             Suppress successful text output
  --help              Show this help`;
    return `Usage: skill-creator <command> [options]

Commands:
  candidate     Turn an idea into an isolated, resumable Skill candidate
  validate      Validate Agent Skills format conformance
  audit         Audit authoring quality and recommend relevant patterns
  design-evals  Validate and normalize evaluation scenarios
  freeze-evals  Derive or freeze provenance-bound scenario suites
  analyze       Map evaluation evidence to authoring patterns
  evidence-loop Plan, challenge, approve, and measure isolated improvements
  full-eval     Orchestrate resumable behavioral evaluation
  migrate-evaluation  Preview, migrate, or roll back a historical fixed workspace
  trigger-eval  Run trigger-description evaluation
  aggregate     Aggregate behavioral benchmark runs
  review        Generate or serve the evaluation review viewer
  verify        Verify release gates
  package       Build a distributable .skill archive
  usability-study Validate or analyze governed anonymous study sessions
  screen-reader-acceptance Validate or analyze manual screen-reader records
  prepare-grading Prepare blinded host-delegated semantic grading requests
  grading-status  Report pending/completed/stale delegated grading requests
  import-grading  Import and verify delegated grader judgment envelopes
  group-grading-batches Group pending grading requests by run/grader for one delegate call each
  apply-grading-batch   Fan a batch's delegated results out into individual judgment files

Run "skill-creator <command> --help" for command usage.`;
}
function parseCommon(argv) {
    const args = [];
    let format = "text";
    let quiet = false;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--quiet")
            quiet = true;
        else if (argv[i] === "--format") {
            const value = argv[++i];
            if (value !== "text" && value !== "json")
                return { args, format, quiet, error: "--format must be text or json" };
            format = value;
        }
        else if (argv[i].startsWith("--format=")) {
            const value = argv[i].slice(9);
            if (value !== "text" && value !== "json")
                return { args, format, quiet, error: "--format must be text or json" };
            format = value;
        }
        else
            args.push(argv[i]);
    }
    return { args, format, quiet };
}
function maybeJson(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return value || null;
    }
}
async function embedded(command, args) {
    switch (command) {
        case "candidate": return runEmbedded((await import("./idea_to_candidate.js")).main, args);
        case "validate": return runEmbedded((await import("./quick_validate.js")).main, args);
        case "audit": return runEmbedded((await import("./audit_skill.js")).main, args);
        case "design-evals": return runEmbedded((await import("./design_evals.js")).main, args);
        case "freeze-evals": return runEmbedded((await import("./freeze_eval_scenarios.js")).main, args);
        case "analyze": return runEmbedded((await import("./analyze_evaluation.js")).main, args);
        case "evidence-loop": return runEmbedded((await import("./evidence_improvement.js")).main, args);
        case "full-eval": return runEmbedded((await import("./full_eval.js")).main, args, { passthroughStderr: true });
        case "migrate-evaluation": return runEmbedded((await import("./evaluation_workspace_migration.js")).main, args);
        case "trigger-eval": return runEmbedded((await import("./run_eval.js")).main, args);
        case "aggregate": return runEmbedded((await import("./aggregate_benchmark.js")).main, args);
        case "verify": return runEmbedded((await import("./verify_skill_gates.js")).main, args);
        case "package": return runEmbedded((await import("./package_skill.js")).main, args);
        case "usability-study": {
            const m = await import("./usability_study.js");
            return runEmbedded(() => m.main(args), []);
        }
        case "screen-reader-acceptance": {
            const m = await import("./screen_reader_acceptance.js");
            return runEmbedded(() => m.main(args), []);
        }
        case "review": return runEmbedded((await import("../eval-viewer/generate_review.js")).main, args);
        case "prepare-grading": return runEmbedded((await import("./prepare_grading.js")).mainPrepare, args);
        case "grading-status": return runEmbedded((await import("./prepare_grading.js")).mainStatus, args);
        case "import-grading": return runEmbedded((await import("./import_grading.js")).main, args);
        case "group-grading-batches": return runEmbedded((await import("./batch_grading.js")).mainGroup, args);
        case "apply-grading-batch": return runEmbedded((await import("./batch_grading.js")).mainApply, args);
    }
}
export async function runCli(argv = process.argv.slice(2)) {
    if (!argv.length || argv[0] === "--help" || argv[0] === "-h") {
        console.log(help());
        return 0;
    }
    const name = argv.shift();
    if (!(name in commands)) {
        console.error(`Unknown command: ${name}

${help()}`);
        return 2;
    }
    const parsed = parseCommon(argv);
    if (parsed.error) {
        console.error(`Error: ${parsed.error}

${help(name)}`);
        return 2;
    }
    if (parsed.args.includes("--help") || parsed.args.includes("-h")) {
        console.log(help(name));
        return 0;
    }
    const config = commands[name];
    if (!config.required(parsed.args)) {
        console.error(help(name));
        return 2;
    }
    const childArgs = name === "candidate" ? [...parsed.args, "--format", parsed.format] : parsed.args;
    const child = await embedded(name, childArgs);
    const rawCode = child.status;
    const stdout = child.stdout.trimEnd();
    const stderr = child.stderr.trimEnd();
    let code = rawCode === 0 ? 0 : rawCode === 2 ? 2 : 1;
    let payload = maybeJson(stdout);
    if ((name === "verify" || name === "full-eval" || name === "audit" || name === "design-evals" || name === "freeze-evals" || name === "analyze" || name === "evidence-loop" || name === "migrate-evaluation") && payload && typeof payload === "object" && "status" in payload) {
        const status = payload.status;
        code = status === "pass" || status === "warning" || status === "complete" || status === "success" || status === "planned" || status === "partial" || status === "draft" || status === "frozen" || status === "planning" || status === "proposal" || status === "preview" || status === "approval" || status === "results" || status === "awaiting-approval" || status === "awaiting-results" || status === "stopped" ? 0 : status === "blocked" ? 3 : 1;
    }
    else if (name === "trigger-eval" && rawCode !== 0 && /(command not found|unsupported runner|exited \d+|timed? out)/i.test(stderr)) {
        // A valid evaluation that cannot use its configured execution backend is blocked.
        code = 3;
    }
    if (name === "candidate" && parsed.format === "json" && payload && typeof payload === "object") {
        if (!parsed.quiet || code !== 0)
            console.log(JSON.stringify(payload, null, 2));
        if (stderr)
            console.error(stderr);
    }
    else if ((name === "full-eval") && payload && typeof payload === "object") {
        if (parsed.format === "json") {
            if (!parsed.quiet || code !== 0)
                console.log(JSON.stringify(payload, null, 2));
        }
        else if (!parsed.quiet || code !== 0) {
            const result = payload;
            console.log([`${name}: ${result.status}`, ...(result.phases ?? []).map((phase) => `[${phase.status}] ${phase.name}${phase.detail ? `: ${phase.detail}` : ""}`), ...(result.checkpoint ? [`checkpoint: ${result.checkpoint.kind} (${result.checkpoint.status})`] : []), ...(result.next_actions ?? []).map((action) => `NEXT: ${action}`), ...(result.executable_actions ?? []).map((action) => `RUN ${action.order}: ${action.command}`)].join("\n"));
        }
        // full-eval streams progress live on stderr through the embedded boundary.
    }
    else if (parsed.format === "json") {
        console.log(JSON.stringify({ command: name, status: code === 0 ? "success" : code === 3 ? "blocked" : code === 2 ? "usage" : "failure", exit_code: code, output: payload, stderr: stderr || null }, null, 2));
    }
    else {
        if (stdout && (!parsed.quiet || code !== 0))
            console.log(stdout);
        if (stderr)
            console.error(stderr);
    }
    return code;
}
if (import.meta.main || !import.meta.url.includes("/$bunfs/"))
    process.exitCode = await runCli();
