import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
function redact(text, secrets) {
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
        text = text.split(secret).join("[REDACTED]");
        const escaped = JSON.stringify(secret).slice(1, -1);
        if (escaped !== secret)
            text = text.split(escaped).join("[REDACTED]");
    }
    return text;
}
/** Only terminal assistant text is a response. Text accompanying a tool request is not final.
 * Named export attribution is required; earlier JSON, tools, fences and latest sessions never qualify.
 */
function terminalResponse(data, prompt) {
    const { messages } = decodeGooseConversation(data, prompt);
    // The most recent user turn must be our exact packet too: an older matching task
    // cannot attribute a later unrelated response to this judge request.
    const userIndex = messages.findLastIndex(message => record(message) && message.role === "user");
    decodeGooseConversation({ messages: messages.slice(userIndex) }, prompt);
    const last = messages.at(-1);
    if (!record(last) || last.role !== "assistant")
        throw new Error("Missing terminal assistant response");
    if (Object.keys(last).some(key => /tool[_-]?(?:calls?|requests?)/i.test(key) && last[key] !== undefined))
        throw new Error("Terminal response contains tool calls");
    if (typeof last.content === "string" && last.content.trim())
        return last.content;
    if (!Array.isArray(last.content) || !last.content.length || !last.content.every(part => record(part) && part.type === "text" && typeof part.text === "string"))
        throw new Error("Terminal response must contain only text");
    const text = last.content.map(part => part.text).join("\n");
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
    constructor(options = {}) {
        this.executable = options.executable ?? "goose";
        this.env = { ...(options.env ?? process.env) };
        this.tempRoot = options.tempRoot ?? tmpdir();
    }
    async info(env, cwd) {
        const result = await gooseProcess(this.executable, ["info"], env, cwd, "", 10000);
        successful(result, "Goose info");
        return parseInfo(result.stdout);
    }
    async judge(request) {
        const model = request.options?.model;
        const maxTurns = request.options?.maxTurns ?? 50, timeout = request.options?.timeout ?? 0;
        const provenance = { host: { id: "goose" }, model: { ...(model === undefined ? {} : { requested: model }), source: model === undefined ? "configuration-default" : "override", effective: "unknown" }, limits: { maxTurns, timeout, preflightTimeout: 10, exportTimeout: 10, outputBytes: 16 * 1024 * 1024 } };
        const secrets = new Set();
        secretStrings(this.env, secrets);
        for (const [key, value] of Object.entries(this.env))
            if (value && key !== "GOOSE_DISABLE_KEYRING" && /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|PROXY/i.test(key))
                secrets.add(value);
        let root;
        let result;
        try {
            // Reject overrides/limits and malformed input before any host process, including info/help.
            if (model !== undefined && (typeof model !== "string" || !model.trim()))
                throw new Error("Blank judge model override");
            if (!Number.isSafeInteger(maxTurns) || maxTurns < 1 || !Number.isSafeInteger(timeout) || timeout < 0 || timeout > 2147483)
                throw new Error("Invalid judge execution limits");
            const packet = judgmentPacket(request);
            if (redact(packet.instructions, secrets) !== packet.instructions || (model !== undefined && redact(model, secrets) !== model))
                throw new Error("Judge packet contains known credentials");
            const original = await this.info(this.env, this.tempRoot);
            root = await mkdtemp(join(this.tempRoot, "agent-plugin-judge-"));
            await privateDirectory(root);
            const env = isolatedEnvironment(this.env, root);
            for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR", "APPDATA", "LOCALAPPDATA", "TMPDIR"]) {
                if (env[key])
                    await privateDirectory(env[key]);
            }
            const workspace = join(root, "workspace");
            await privateDirectory(workspace);
            const info = await this.info(env, workspace);
            await prepareConfiguration(original, info, root, secrets);
            if (redact(packet.instructions, secrets) !== packet.instructions || (model !== undefined && redact(model, secrets) !== model))
                throw new Error("Judge request contains known credentials");
            for (const [args, required] of [
                [["run", "--help"], ["--instructions", "--name", "--max-turns", "--quiet", "--output-format", "--model", "stream-json"]],
                [["session", "export", "--help"], ["--name", "--format", "json"]],
            ]) {
                const help = await gooseProcess(this.executable, [...args], env, workspace, "", 10000);
                successful(help, "Goose CLI preflight");
                const text = help.stdout.toString("utf8") + help.stderr.toString("utf8");
                if (!required.every(flag => text.includes(flag)))
                    throw new Error("Unsupported Goose judge CLI");
            }
            provenance.host.version = info.version;
            const sessionName = `judge-${randomUUID()}`;
            provenance.sessionName = sessionName;
            provenance.instructionsSha256 = createHash("sha256").update(packet.instructions).digest("hex");
            const args = ["run", "--instructions", "-", "--name", sessionName, "--max-turns", String(maxTurns), "--quiet", "--output-format", "stream-json"];
            if (model !== undefined)
                args.push("--model", model);
            const run = await gooseProcess(this.executable, args, env, workspace, packet.instructions, timeout * 1000);
            successful(run, "Goose judge execution");
            const exported = await gooseProcess(this.executable, ["session", "export", "--name", sessionName, "--format", "json"], env, workspace, "", 10000);
            successful(exported, "Goose named export");
            // Attribution uses original bytes; redact only the terminal response before JSON/domain validation.
            const text = terminalResponse(JSON.parse(exported.stdout.toString("utf8")), packet.instructions);
            const outcome = packet.decode(JSON.parse(redact(text, secrets)));
            // Mapping restores original frozen IDs/text/paths. Never return credential-bearing source metadata.
            if (redact(JSON.stringify(outcome), secrets) !== JSON.stringify(outcome))
                throw new Error("Judge outcome contains known credentials");
            result = { outcome, provenance };
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
                    result = { outcome: { status: "technical-error", message: "Goose judge cleanup failed" }, provenance };
                }
            }
        }
        const safe = JSON.parse(redact(JSON.stringify(result), secrets));
        // Technical outcome shape stays canonical; provenance is deliberately outside the blinded packet.
        if (safe.outcome.status === "technical-error")
            safe.outcome = validateJudgment([], [], safe.outcome);
        return safe;
    }
}
