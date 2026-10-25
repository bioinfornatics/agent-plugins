#!/usr/bin/env node
/** Unified command line interface for the agent-creator toolchain. */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runEmbedded } from "./runtime-dispatch.js";
const COMMANDS = {
    init: { script: "init_agent.js", usage: "init <name> [--path <dir>] [--description <text>] [--model <name>] [--role <text>]" },
    validate: { script: "validate_agent.js", usage: "validate <agent-file> [--require-filename-match]" },
    evaluate: { script: "run_agent_eval.js", usage: "evaluate --agent <file> --eval-set <file> --workspace <dir> [options]" },
    grade: { script: "grade_agent_eval.js", usage: "grade <workspace> [--llm-grader --grader <id=model> --grader <id=model> --max-grader-calls <n>]" },
    aggregate: { script: "aggregate_benchmark.js", usage: "aggregate <workspace> [--agent-name <name>] [--agent-path <path>] [-o <output.json>]" },
    install: { script: "install_agent.js", usage: "install <agent-file> (--project <dir> | --global) [--force]" },
    privacy: { script: "privacy_policy.js", usage: "privacy <policy|redact|put|status|delete> [options]" },
};
const GENERAL_HELP = "Usage: agent-creator <command> [options]\n\nCommands:\n  init        Create an agent definition\n  validate    Validate an agent definition\n  evaluate    Run paired agent evaluations\n  grade       Grade evaluation outputs\n  aggregate   Aggregate benchmark results\n  install     Install an agent at project or user scope\n  privacy     Inspect policy, redact, or manage protected artifacts\n\nCommon options:\n  --format <text|json>  Select output format (default: text)\n  --quiet               Suppress successful text output\n  -h, --help            Show help\n\nExit codes: 0 success, 1 failure, 2 usage error, 3 blocked operation.";
function commandHelp(command) {
    return "Usage: agent-creator " + COMMANDS[command].usage + "\n\nCommon options: --format <text|json>, --quiet, -h, --help";
}
function parseCommon(argv) {
    let format = "text";
    let quiet = false;
    let help = false;
    const remaining = [];
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--quiet")
            quiet = true;
        else if (arg === "--help" || arg === "-h")
            help = true;
        else if (arg === "--format") {
            const value = argv[++index];
            if (value !== "text" && value !== "json")
                return { forwarded: [], format, quiet, help, error: "--format must be 'text' or 'json'" };
            format = value;
        }
        else if (arg.startsWith("--format=")) {
            const value = arg.slice("--format=".length);
            if (value !== "text" && value !== "json")
                return { forwarded: [], format, quiet, help, error: "--format must be 'text' or 'json'" };
            format = value;
        }
        else
            remaining.push(arg);
    }
    const candidate = remaining.shift();
    if (candidate && candidate in COMMANDS)
        return { command: candidate, forwarded: remaining, format, quiet, help };
    return { forwarded: remaining, format, quiet, help, error: candidate ? "unknown command '" + candidate + "'" : help ? undefined : "a command is required" };
}
function classifyExit(status, output) {
    if (status === 0)
        return 0;
    if (/refusing to overwrite|operation not permitted|permission denied|\bEACCES\b|\bEPERM\b/i.test(output))
        return 3;
    if (status === 2 || /ERR_PARSE_ARGS|unknown option|usage:/i.test(output))
        return 2;
    return 1;
}
async function dispatch(command, args) {
    switch (command) {
        case "init": return runEmbedded((await import("./init_agent.js")).main, args);
        case "validate": return runEmbedded((await import("./validate_agent.js")).main, args);
        case "evaluate": return runEmbedded((await import("./run_agent_eval.js")).main, args);
        case "grade": return runEmbedded((await import("./grade_agent_eval.js")).main, args);
        case "aggregate": return runEmbedded((await import("./aggregate_benchmark.js")).main, args);
        case "install": return runEmbedded((await import("./install_agent.js")).main, args);
        case "privacy": return runEmbedded((await import("./privacy_policy.js")).main, args);
    }
}
export async function runCli(argv = process.argv.slice(2)) {
    const parsed = parseCommon(argv);
    if (parsed.error) {
        if (parsed.format === "json")
            console.log(JSON.stringify({ ok: false, command: parsed.command ?? null, exitCode: 2, error: parsed.error }));
        else {
            console.error("error: " + parsed.error);
            console.error(GENERAL_HELP);
        }
        return 2;
    }
    if (!parsed.command) {
        if (parsed.format === "json")
            console.log(JSON.stringify({ ok: true, command: null, exitCode: 0, help: GENERAL_HELP }));
        else if (!parsed.quiet)
            console.log(GENERAL_HELP);
        return 0;
    }
    if (parsed.help) {
        const help = commandHelp(parsed.command);
        if (parsed.format === "json")
            console.log(JSON.stringify({ ok: true, command: parsed.command, exitCode: 0, help }));
        else if (!parsed.quiet)
            console.log(help);
        return 0;
    }
    const result = await dispatch(parsed.command, parsed.forwarded);
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    const spawnError = "";
    const exitCode = classifyExit(result.status, stdout + "\n" + stderr + "\n" + spawnError);
    if (parsed.format === "json") {
        console.log(JSON.stringify({ ok: exitCode === 0, command: parsed.command, exitCode, stdout: stdout.trimEnd(), stderr: [stderr.trimEnd(), spawnError].filter(Boolean).join("\n") }));
    }
    else {
        if (stdout && (!parsed.quiet || exitCode !== 0))
            process.stdout.write(stdout);
        if (stderr)
            process.stderr.write(stderr);
        if (spawnError)
            process.stderr.write("error: " + spawnError + "\n");
    }
    return exitCode;
}
function isMain() {
    if (import.meta.main)
        return true;
    if (!process.argv[1])
        return false;
    try {
        return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
    }
    catch {
        return false;
    }
}
if (!import.meta.url.includes("/$bunfs/") && isMain())
    process.exitCode = await runCli();
