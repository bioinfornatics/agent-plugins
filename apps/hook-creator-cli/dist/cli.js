#!/usr/bin/env node
import { realpathSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initHook, parseInitArgs, UsageError } from "./init_hook.js";
import { validateHook } from "./validate_hook.js";
import { verifyEvaluationRunManifest, writeEvaluationRunManifest } from "./evaluation_run_manifest.js";
import { verifyEvidenceAttestation, writeEvidenceAttestation } from "./evidence_attestation.js";
import { approvalSha, inspectApproval, updateApproval, writeApprovalRequest } from "./production_approval.js";
const HELP = `Usage: hook-creator [--format text|json] [--quiet] <command> [options]

Commands:
  init <plugin_dir> <event> <name> [--matcher <regex>] [--timeout <n>]
  validate <plugin_dir>
  eval-manifest create <spec.json> <manifest.json>
  eval-manifest verify <manifest.json> [receipt.json]
  attestation create <spec.json> <envelope.json> [--private-key <pem>]
  attestation verify <envelope.json> [--policy local|production] [--trust-policy <json>]
  approval request <spec.json> <approval.json>
  approval review|approve|reject|expire|supersede <approval.json> <decision.json> --private-key <pem>
  approval verify <approval.json> --trust-policy <json> [--bindings <json>]
  approval consume <approval.json> --purpose deploy|install --trust-policy <json> --bindings <json>

Common options:
  --format <text|json>  Select human-readable or JSON output (default: text)
  --quiet               Suppress successful output
  -h, --help            Show help
`;
function parseCommon(argv) { let format = "text", quiet = false, help = false; const rest = []; for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--format") {
        const value = argv[++i];
        if (value !== "text" && value !== "json")
            throw new UsageError("--format must be text or json");
        format = value;
    }
    else if (arg.startsWith("--format=")) {
        const value = arg.slice(9);
        if (value !== "text" && value !== "json")
            throw new UsageError("--format must be text or json");
        format = value;
    }
    else if (arg === "--quiet")
        quiet = true;
    else if (arg === "--help" || arg === "-h")
        help = true;
    else
        rest.push(arg);
} return { format, quiet, help, rest }; }
function output(value, format, quiet, lines) { if (quiet)
    return; if (format === "json")
    console.log(JSON.stringify(value));
else
    for (const line of lines)
        console.log(line); }
function failure(error, format, usage) { if (format === "json")
    console.log(JSON.stringify({ ok: false, error: error.message, usage }));
else
    console.error("error: " + error.message); return usage ? 2 : 1; }
export function run(argv) { let common; try {
    common = parseCommon(argv);
}
catch (error) {
    return failure(error, "text", true);
} const [command, ...args] = common.rest; if (common.help) {
    output({ ok: true, help: HELP }, common.format, false, [HELP.trimEnd()]);
    return 0;
} if (!command)
    return failure(new UsageError("a command is required; use --help"), common.format, true); try {
    if (command === "init") {
        const result = initHook(parseInitArgs(args));
        output({ ok: true, command, ...result }, common.format, common.quiet, [result.hooksPath, result.scriptPath]);
        return 0;
    }
    if (command === "approval") {
        const [action, ...raw] = args;
        if (action === "request") {
            if (raw.length !== 2)
                throw new UsageError("usage: hook-creator approval request <spec.json> <approval.json>");
            const a = writeApprovalRequest(raw[0], raw[1]);
            output({ ok: true, command, action, path: raw[1], state: "pending", approval_sha256: approvalSha(a) }, common.format, common.quiet, [raw[1], "pending"]);
            return 0;
        }
        if (["review", "approve", "reject", "expire", "supersede"].includes(action)) {
            const pos = [];
            let key;
            for (let i = 0; i < raw.length; i++)
                if (raw[i] === "--private-key")
                    key = raw[++i];
                else
                    pos.push(raw[i]);
            if (pos.length !== 2 || !key)
                throw new UsageError("approval transition requires <approval.json> <decision.json> --private-key <pem>");
            const spec = JSON.parse(readFileSync(pos[1], "utf8"));
            if (spec.action !== action)
                throw new UsageError("decision action does not match command");
            const a = updateApproval(pos[0], pos[1], key);
            output({ ok: true, command, action, path: pos[0], approval_sha256: approvalSha(a), revision: a.events.length }, common.format, common.quiet, [pos[0], action]);
            return 0;
        }
        if (action === "verify" || action === "consume") {
            const pos = [];
            let trust, bound, purpose;
            for (let i = 0; i < raw.length; i++) {
                const a = raw[i], v = raw[i + 1];
                if (a === "--trust-policy") {
                    trust = v;
                    i++;
                }
                else if (a === "--bindings") {
                    bound = v;
                    i++;
                }
                else if (a === "--purpose") {
                    purpose = v;
                    i++;
                }
                else
                    pos.push(a);
            }
            if (pos.length !== 1 || !trust || (action === "consume" && (!bound || !["deploy", "install"].includes(purpose))))
                throw new UsageError("approval verify/consume requires approval, trust policy, and consume also exact bindings and deploy|install purpose");
            const result = inspectApproval(JSON.parse(readFileSync(pos[0], "utf8")), { trustPolicy: JSON.parse(readFileSync(trust, "utf8")), expectedBindings: bound ? JSON.parse(readFileSync(bound, "utf8")) : undefined });
            output({ command, action, purpose, ...result }, common.format, common.quiet && result.ok, result.ok ? ["OK: approved for " + (purpose ?? "production")] : result.errors.map((x) => "ERROR: " + x));
            return result.ok ? 0 : 1;
        }
        throw new UsageError("usage: hook-creator approval request|review|approve|reject|expire|supersede|verify|consume ...");
    }
    if (command === "attestation") {
        const [action, ...raw] = args;
        if (action === "create") {
            let key;
            const pos = [];
            for (let i = 0; i < raw.length; i++) {
                if (raw[i] === "--private-key") {
                    key = raw[++i];
                    if (!key)
                        throw new UsageError("--private-key requires a path");
                }
                else
                    pos.push(raw[i]);
            }
            if (pos.length !== 2)
                throw new UsageError("usage: hook-creator attestation create <spec.json> <envelope.json> [--private-key <pem>]");
            const envelope = writeEvidenceAttestation(pos[0], pos[1], key);
            output({ ok: true, command, action, path: pos[1], signed: envelope.signatures.length === 1 }, common.format, common.quiet, [pos[1], envelope.signatures.length ? "CI signed" : "local unsigned"]);
            return 0;
        }
        if (action === "verify") {
            let policy = "local", trust, manual;
            const pos = [];
            for (let i = 0; i < raw.length; i++) {
                const a = raw[i], v = raw[i + 1];
                if (a === "--policy") {
                    if (v !== "local" && v !== "production")
                        throw new UsageError("--policy must be local or production");
                    policy = v;
                    i++;
                }
                else if (a === "--trust-policy") {
                    if (!v)
                        throw new UsageError("--trust-policy requires a path");
                    trust = v;
                    i++;
                }
                else if (a === "--tests-status") {
                    if (!v)
                        throw new UsageError("--tests-status requires a value");
                    manual = v;
                    i++;
                }
                else
                    pos.push(a);
            }
            if (pos.length !== 1)
                throw new UsageError("usage: hook-creator attestation verify <envelope.json> [options]");
            const result = verifyEvidenceAttestation(JSON.parse(readFileSync(pos[0], "utf8")), { policy, trustPolicy: trust ? JSON.parse(readFileSync(trust, "utf8")) : undefined, manualTestsStatus: manual });
            output(result, common.format, common.quiet && result.ok, result.ok ? ["OK: " + result.state] : result.errors.map(x => "ERROR: " + x));
            return result.ok ? 0 : 1;
        }
        throw new UsageError("usage: hook-creator attestation create|verify ...");
    }
    if (command === "eval-manifest") {
        const [action, manifestPath, receiptPath, extra] = args;
        if (action === "create" && manifestPath && receiptPath && !extra) {
            const result = writeEvaluationRunManifest(manifestPath, receiptPath);
            output({ ok: true, command, action, manifest: result }, common.format, common.quiet, [receiptPath, result.canonical_content_sha256]);
            return 0;
        }
        if (action === "verify" && manifestPath && !extra) {
            const manifest = JSON.parse(readFileSync(manifestPath, "utf8")), receipt = receiptPath ? JSON.parse(readFileSync(receiptPath, "utf8")) : undefined, result = verifyEvaluationRunManifest(manifest, receipt);
            output({ command, action, ...result }, common.format, common.quiet && result.ok, result.ok ? ["OK: " + manifestPath] : result.errors.map(x => "ERROR: " + x));
            return result.ok ? 0 : 1;
        }
        throw new UsageError("usage: hook-creator eval-manifest create <spec.json> <manifest.json> | verify <manifest.json> [receipt.json]");
    }
    if (command === "validate") {
        if (args.length !== 1)
            throw new UsageError("usage: hook-creator validate <plugin_dir>");
        const result = validateHook(args[0]), ok = result.errors.length === 0;
        output({ ok, command, ...result }, common.format, common.quiet && ok, [...result.warnings.map(x => "WARNING: " + x), ...result.errors.map(x => "ERROR: " + x), ...(ok ? ["OK: " + result.path] : [])]);
        return ok ? 0 : 1;
    }
    throw new UsageError("unknown command: " + command);
}
catch (error) {
    return failure(error, common.format, error instanceof UsageError);
} }
function isMain(metaUrl) { if (import.meta.main)
    return true; if (!process.argv[1])
    return false; try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(resolve(process.argv[1]));
}
catch {
    return false;
} }
if (isMain(import.meta.url))
    process.exitCode = run(process.argv.slice(2));
