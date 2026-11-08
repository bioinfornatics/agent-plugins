import { trustedReaderCommand } from "./reader-launch.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { validateJudgment } from "../../../domain/judgment.js";
import { isolatedEnvironment, parseInfo, prepareConfiguration, record, secretStrings } from "../hosts/goose/goose-configuration.js";
import { decodeGooseConversation } from "../hosts/goose/goose-conversation.js";
import { gooseProcess } from "../hosts/goose/goose-process.js";
import { privateDirectory } from "../hosts/goose/private-files.js";
import { judgmentPacket } from "./judgment-packet.js";
function successful(result, operation) {
    // Never include native stdout/stderr: they can contain credentials before discovery.
    if (result.timeout)
        throw new Error(`${operation} timed out`);
    if (result.overflow)
        throw new Error(`${operation} output overflow`);
    if (result.exitCode !== 0)
        throw new Error(`${operation} failed`);
}
class SanitizationFailure extends Error {
    reason;
    constructor(reason) { super(reason); this.reason = reason; }
}
function sanitizeDiagnostic(text, secrets) {
    let work = 0, tokens = 0;
    const ordered = [...secrets].filter(Boolean).sort((a, b) => b.length - a.length);
    function visit(value, depth) {
        work += Buffer.byteLength(value);
        if (depth > 16)
            throw new SanitizationFailure("depth-limit");
        if (work > 64 * 1024 * 1024)
            throw new SanitizationFailure("work-limit");
        // Decoded credentials may themselves contain quotes/backslashes as plain text,
        // not JSON. Remove known raw values before treating their contents as tokens.
        for (const secret of ordered)
            value = value.split(secret).join("[REDACTED]");
        // Linear token scan: a regex over multi-MiB JSON strings can exhaust V8's stack.
        let nested = "", start = 0;
        for (let i = 0; i < value.length; i++) {
            if (value[i] !== '"')
                continue;
            const begin = i++;
            let encoded = false;
            for (; i < value.length; i++) {
                if (value[i] === "\\") {
                    encoded = true;
                    i++;
                    continue;
                }
                if (value[i] === '"')
                    break;
            }
            if (i >= value.length) {
                // Encoded credentials can follow a plain-text/event prefix. If decoding
                // is impossible, never retain the token merely because the prefix is not JSON.
                // A decoded string is prose, even when it starts with { or [. Literal
                // unmatched quotes have no encoded secret to decode; encoded fragments
                // still fail closed (including fragments following a non-JSON prefix).
                if (encoded)
                    throw new SanitizationFailure("malformed-encoded");
                if (depth === 0 && /^\s*[[{]/.test(value))
                    throw new SanitizationFailure("malformed-json");
                break;
            }
            if (++tokens > 200000)
                throw new SanitizationFailure("token-limit");
            const token = value.slice(begin, i + 1);
            let decoded;
            try {
                decoded = JSON.parse(token);
            }
            catch {
                if (encoded)
                    throw new SanitizationFailure("malformed-encoded");
                if (depth === 0 && /^\s*[[{]/.test(value))
                    throw new SanitizationFailure("malformed-json");
                continue;
            }
            const safe = visit(String(decoded), depth + 1);
            nested += value.slice(start, begin) + (safe === decoded ? token : JSON.stringify(safe));
            start = i + 1;
        }
        nested += value.slice(start);
        let safe = nested;
        for (const secret of ordered) {
            safe = safe.split(secret).join("[REDACTED]");
            safe = safe.split(JSON.stringify(secret).slice(1, -1)).join("[REDACTED]");
        }
        return safe;
    }
    try {
        return { text: visit(text, 0), omission: null };
    }
    catch (error) {
        return { text: "[OMITTED: diagnostic sanitization limit]", omission: error instanceof SanitizationFailure ? error.reason : "internal-failure" };
    }
}
function redact(text, secrets) { return sanitizeDiagnostic(text, secrets).text; }
// Goose v1.57.0 (30bba951), message.rs MessageContentBlock uses camelCase tags.
// Never serialize an unrecognized tag or role: these are untrusted payload strings.
const terminalTypes = ["text", "image", "document", "toolRequest", "toolResponse", "toolConfirmationRequest", "actionRequired", "thinking", "redactedThinking", "systemNotification", "error"];
function terminalType(part) {
    if (!record(part) || typeof part.type !== "string")
        return "malformed";
    return terminalTypes.find(type => type === part.type) ?? "unknown";
}
function terminalStructure(data) {
    const conversation = record(data) ? data.conversation : undefined;
    const messages = record(data) && Array.isArray(data.messages) ? data.messages : Array.isArray(conversation) ? conversation : record(conversation) && Array.isArray(conversation.messages) ? conversation.messages : [];
    const last = messages.at(-1);
    const roles = ["assistant", "user", "system", "tool"];
    const role = !record(last) ? "missing" : roles.find(role => role === last.role) ?? "unknown";
    const parts = !record(last) ? [] : typeof last.content === "string" ? [{ type: "text" }] : Array.isArray(last.content) ? last.content : [null];
    const contentTypes = {};
    for (const part of parts.slice(0, 200000)) {
        const type = terminalType(part);
        contentTypes[type] = (contentTypes[type] ?? 0) + 1;
    }
    return { role, contentTypes, count: parts.length, truncated: parts.length > 200000 };
}
/** Only terminal assistant text is a response. Text accompanying a tool request is not final.
 * Valid thinking/redactedThinking are auxiliary only; their payloads never enter the answer.
 * Named export attribution is required; earlier JSON, tools, fences and latest sessions never qualify.
 */
function terminalResponse(data, prompt) {
    const { messages } = decodeGooseConversation(data, prompt);
    const last = messages.at(-1);
    if (!record(last) || last.role !== "assistant")
        throw new Error("Missing terminal assistant response");
    if (Object.keys(last).some(key => /tool[_-]?(?:calls?|requests?)/i.test(key) && last[key] !== undefined))
        throw new Error("Terminal response contains tool calls");
    if (typeof last.content === "string" && last.content.trim())
        return last.content;
    if (!Array.isArray(last.content) || !last.content.length)
        throw new Error("Missing terminal text");
    for (const part of last.content) {
        const type = terminalType(part);
        if (type !== "text" && type !== "thinking" && type !== "redactedThinking")
            throw new Error(`Unsupported terminal content: ${type}`);
        if (!record(part) || (type === "text" ? typeof part.text !== "string" : type === "thinking" ? typeof part.thinking !== "string" || typeof part.signature !== "string" : typeof part.data !== "string"))
            throw new Error(`Malformed terminal content: ${type}`);
    }
    const text = last.content.filter(part => part.type === "text").map(part => part.text).join("\n");
    if (!text.trim())
        throw new Error("Empty terminal response");
    return text;
}
/** Local/mock-ready Goose judge transport; importing performs no I/O.
 * HOME/XDG is discovery isolation, not a sandbox; unknown keyring/network secrets are not covered.
 */
export class GooseJudge {
    executable;
    env;
    tempRoot;
    instructionWriter;
    constructor(options = {}) {
        this.instructionWriter = options.instructionWriter;
        this.executable = options.executable ?? "goose";
        this.env = { ...(options.env ?? process.env) };
        this.tempRoot = options.tempRoot ?? tmpdir();
    }
    async judge(request) {
        const model = request.options?.model;
        const maxTurns = request.options?.maxTurns ?? 20, timeout = request.options?.timeout ?? 600;
        const provenance = { packetVersion: 2, host: { id: "goose" }, model: { ...(model === undefined ? {} : { requested: model }), source: model === undefined ? "configuration-default" : "override", effective: "unknown" }, limits: { maxTurns, timeout, preflightTimeout: 10, exportTimeout: 10, outputBytes: 16 * 1024 * 1024 } };
        const secrets = new Set();
        secretStrings(this.env, secrets);
        for (const [key, value] of Object.entries(this.env))
            if (value && key !== "GOOSE_DISABLE_KEYRING" && /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|PROXY/i.test(key))
                secrets.add(value);
        const diagnostics = { version: 1, stage: "validation", processes: {}, sanitization: {}, terminal: null };
        let diagnosticsRoot;
        const processOperation = async (operation, args, env, cwd, timeoutMs = 10000) => {
            diagnostics.processes[operation] = { unavailable: true };
            const result = await gooseProcess(this.executable, args, env, cwd, "", timeoutMs);
            diagnostics.processes[operation] = { exitCode: result.exitCode, timeout: result.timeout, overflow: result.overflow, stdoutBytes: result.stdoutBytes, stderrBytes: result.stderrBytes };
            return result;
        };
        const persistOutput = async (name, field, bytes) => {
            const sanitized = sanitizeDiagnostic(bytes.toString("utf8"), secrets);
            diagnostics.sanitization[field] = sanitized.omission;
            if (!diagnosticsRoot)
                throw new Error("Missing established judge artifact scope");
            await writeFile(join(diagnosticsRoot, name), sanitized.text, { flag: "wx", mode: 0o600 });
        };
        let root;
        let result;
        try {
            // Reject overrides/limits and malformed input before any host process, including info/help.
            if (model !== undefined && (typeof model !== "string" || !model.trim()))
                throw new Error("Blank judge model override");
            if (!Number.isSafeInteger(maxTurns) || maxTurns < 1 || !Number.isSafeInteger(timeout) || timeout < 0 || timeout > 2147483)
                throw new Error("Invalid judge execution limits");
            const packet = judgmentPacket(request);
            const location = request.instructionLocation === undefined ? undefined : structuredClone(request.instructionLocation);
            if (!location || !isAbsolute(location.path) || resolve(location.path) !== location.path || !this.instructionWriter)
                throw new Error("Persistent judge instruction destination and writer required");
            if ((redact(packet.instructions, secrets) !== packet.instructions || redact(packet.bundle.manifest, secrets) !== packet.bundle.manifest || packet.bundle.files.some(file => redact(file.text, secrets) !== file.text)) || redact(JSON.stringify(location), secrets) !== JSON.stringify(location) || (model !== undefined && redact(model, secrets) !== model))
                throw new Error("Judge packet contains known credentials");
            diagnostics.stage = "original-info";
            const originalResult = await processOperation("originalInfo", ["info"], this.env, this.tempRoot);
            successful(originalResult, "Goose info");
            const original = parseInfo(originalResult.stdout);
            diagnostics.stage = "isolation";
            root = await mkdtemp(join(this.tempRoot, "agent-plugin-judge-"));
            await privateDirectory(root);
            const env = isolatedEnvironment(this.env, root);
            for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR", "APPDATA", "LOCALAPPDATA", "TMPDIR"]) {
                if (env[key])
                    await privateDirectory(env[key]);
            }
            const workspace = join(root, "workspace");
            await privateDirectory(workspace);
            diagnostics.stage = "isolated-info";
            const infoResult = await processOperation("isolatedInfo", ["info"], env, workspace);
            successful(infoResult, "Goose info");
            const info = parseInfo(infoResult.stdout);
            diagnostics.stage = "configuration";
            await prepareConfiguration(original, info, root, secrets);
            if ((redact(packet.instructions, secrets) !== packet.instructions || redact(packet.bundle.manifest, secrets) !== packet.bundle.manifest || packet.bundle.files.some(file => redact(file.text, secrets) !== file.text)) || redact(JSON.stringify(location), secrets) !== JSON.stringify(location) || (model !== undefined && redact(model, secrets) !== model))
                throw new Error("Judge request contains known credentials");
            diagnostics.stage = "preflight";
            for (const [args, required] of [
                [["run", "--help"], ["--instructions", "--name", "--max-turns", "--quiet", "--output-format", "--model", "--with-extension", "--no-profile", "stream-json"]],
                [["session", "export", "--help"], ["--name", "--format", "json"]],
            ]) {
                const help = await processOperation(args[0] === "run" ? "runHelp" : "exportHelp", [...args], env, workspace);
                successful(help, "Goose CLI preflight");
                const text = help.stdout.toString("utf8") + help.stderr.toString("utf8");
                if (!required.every(flag => text.includes(flag)))
                    throw new Error("Unsupported Goose judge CLI");
            }
            provenance.host.version = info.version;
            const sessionName = `judge-${randomUUID()}`;
            provenance.sessionName = sessionName;
            // Validate parser representability before allocating any persistent instruction/evidence files.
            const readerCommand = trustedReaderCommand(join(dirname(location.path), "evidence"), createHash("sha256").update(packet.bundle.manifest).digest("hex"));
            diagnostics.stage = "instructions";
            const artifact = await this.instructionWriter.write(location, packet.instructions, packet.bundle);
            const hash = createHash("sha256").update(packet.instructions).digest("hex");
            if (artifact.path !== location.path || artifact.gradeId !== location.gradeId || artifact.campaignId !== location.campaignId || artifact.attemptId !== location.attemptId || artifact.sha256 !== hash)
                throw new Error("Judge instruction writer returned mismatched attribution");
            provenance.evidenceManifestSha256 = createHash("sha256").update(packet.bundle.manifest).digest("hex");
            provenance.instructionsSha256 = hash;
            provenance.instructionArtifact = artifact;
            // Only a successfully returned, attributed writer scope authorizes persistence.
            // Preallocation failures must not write into a caller-supplied/existing path.
            diagnosticsRoot = dirname(artifact.path);
            const args = ["run", "--no-profile", "--with-extension", readerCommand, "--instructions", artifact.path, "--name", sessionName, "--max-turns", String(maxTurns), "--quiet", "--output-format", "stream-json"];
            if (model !== undefined)
                args.push("--model", model);
            diagnostics.stage = "execution";
            const run = await processOperation("execution", args, env, workspace, timeout * 1000);
            await persistOutput("host-run.stdout", "runStdout", run.stdout);
            await persistOutput("host-run.stderr", "runStderr", run.stderr);
            successful(run, "Goose judge execution");
            diagnostics.stage = "export";
            const exported = await processOperation("export", ["session", "export", "--name", sessionName, "--format", "json"], env, workspace);
            await persistOutput("host-export.json", "exportStdout", exported.stdout);
            await persistOutput("host-export.stderr", "exportStderr", exported.stderr);
            successful(exported, "Goose named export");
            diagnostics.stage = "terminal";
            // Attribution AND evidence/domain validation use original bytes, never sanitized evidence.
            const conversation = JSON.parse(exported.stdout.toString("utf8"));
            diagnostics.terminal = terminalStructure(conversation);
            const text = terminalResponse(conversation, packet.instructions);
            diagnostics.stage = "outcome";
            const originalOutcome = packet.decode(JSON.parse(text));
            const sanitizedOutcome = sanitizeDiagnostic(JSON.stringify(originalOutcome), secrets);
            diagnostics.sanitization.outcome = sanitizedOutcome.omission;
            const outcome = JSON.parse(sanitizedOutcome.text);
            // Mapping restores original frozen IDs/text/paths. Never return credential-bearing source metadata.
            if (redact(JSON.stringify(outcome), secrets) !== JSON.stringify(outcome))
                throw new Error("Judge outcome contains known credentials");
            result = { outcome, provenance };
            diagnostics.stage = "complete";
        }
        catch (error) {
            // Parsing errors may echo raw model text. Only controlled errors from this adapter are safe;
            // generic technical failure is preferable to a native/parser credential leak.
            const message = error instanceof SyntaxError ? "Invalid Goose judge JSON" : error instanceof Error ? error.message : "Goose judge transport failed";
            result = { outcome: { status: "technical-error", message: redact(message, secrets) || "Goose judge transport failed" }, provenance };
        }
        finally {
            if (root) {
                try {
                    await rm(root, { recursive: true, force: true });
                }
                catch {
                    diagnostics.stage = "cleanup";
                    result = { outcome: { status: "technical-error", message: "Goose judge cleanup failed" }, provenance };
                }
            }
        }
        const sanitizedResult = sanitizeDiagnostic(JSON.stringify(result), secrets);
        diagnostics.sanitization.result = sanitizedResult.omission;
        const sanitized = sanitizedResult.text;
        const safe = sanitized.startsWith("[OMITTED:")
            ? { outcome: { status: "technical-error", message: "Judge result sanitization limit exceeded" }, provenance: { packetVersion: 2, host: { id: "goose" }, model: { source: "configuration-default", effective: "unknown" }, limits: { maxTurns: 20, timeout: 600, preflightTimeout: 10, exportTimeout: 10, outputBytes: 16 * 1024 * 1024 } } }
            : JSON.parse(sanitized);
        // Technical outcome shape stays canonical; provenance is deliberately outside the blinded packet.
        if (safe.outcome.status === "technical-error")
            safe.outcome = validateJudgment([], [], safe.outcome);
        if (diagnosticsRoot) {
            try {
                await writeFile(join(diagnosticsRoot, "host-diagnostics.json"), JSON.stringify(diagnostics), { flag: "wx", mode: 0o600 });
            }
            catch {
                safe.outcome = { status: "technical-error", message: "Judge structural diagnostics persistence failed" };
            }
        }
        return safe;
    }
}
