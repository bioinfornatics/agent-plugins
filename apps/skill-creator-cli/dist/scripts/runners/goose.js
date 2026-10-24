// Goose runner for trigger checks and isolated behavioral execution.
import { existsSync, statSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { RunnerError } from "./base.js";
import { PairedExecutionError } from "./paired.js";
import { isUsefulStreamEvent, normalizeExecutionEfficiency, safeLocator } from "../execution_efficiency.js";
export function commandArgv(command) { const argv = [], length = command.length; let value = "", started = false, quote = null; for (let i = 0; i < length; i++) {
    const char = command[i];
    if (quote === "'") {
        if (char === "'")
            quote = null;
        else
            value += char;
        started = true;
        continue;
    }
    if (quote === '\"') {
        if (char === '\"')
            quote = null;
        else if (char === "\\" && i + 1 < length && ['\"', '\\', '$', '`'].includes(command[i + 1]))
            value += command[++i];
        else
            value += char;
        started = true;
        continue;
    }
    if (/\s/.test(char)) {
        if (started) {
            argv.push(value);
            value = "";
            started = false;
        }
        continue;
    }
    if (char === "'" || char === '\"') {
        quote = char;
        started = true;
        continue;
    }
    if (char === "\\") {
        if (++i >= length)
            throw new RunnerError("Goose command ends with an incomplete escape");
        value += command[i];
        started = true;
        continue;
    }
    value += char;
    started = true;
} if (quote)
    throw new RunnerError("Goose command contains an unterminated quote"); if (started)
    argv.push(value); return argv; }
export function configuredGooseArgv(command) { const raw = command || process.env.SKILL_CREATOR_GOOSE_COMMAND || "goose", argv = commandArgv(raw); if (!argv.length)
    throw new RunnerError("SKILL_CREATOR_GOOSE_COMMAND cannot be empty"); return argv; }
function text(value) { if (typeof value === "string")
    return value; if (Array.isArray(value))
    return value.map(text).filter(Boolean).join("\n"); if (!value || typeof value !== "object")
    return ""; const item = value; return text(item.text ?? item.content ?? item.message ?? item.value ?? ""); }
function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
const CLOSED_EVENT_TYPES = new Set(["message", "complete", "progress", "error", "invalid-json", "unknown"]);
export function normalizedEvidenceEventType(value) { if (value === "message")
    return "message"; if (["complete", "completed", "final"].includes(String(value)))
    return "complete"; if (value === "progress")
    return "progress"; if (["error", "failed"].includes(String(value)))
    return "error"; return "unknown"; }
export function declaredEvidenceToolName(value, declaredTools) { if (typeof value !== "string")
    return null; for (const declared of declaredTools)
    if (value === declared || value.startsWith(declared + "__"))
        return declared; return null; }
export function validEvidenceEventType(value) { return typeof value === "string" && CLOSED_EVENT_TYPES.has(value); }
function projectEvent(event, observedAt, workspaceRoot, declaredTools) {
    const projection = { type: normalizedEvidenceEventType(event.type), observed_at_seconds: Math.max(0, observedAt), redactions: ["provider-payload-redacted"] };
    const content = record(event.message).content;
    if (!Array.isArray(content))
        return projection;
    const item = content.map(record).find(value => ["toolRequest", "tool_request", "tool_call"].includes(String(value.type)));
    if (!item)
        return projection;
    let call = record(item.toolCall ?? item.tool_call);
    call = record(call.Ok ?? call);
    call = record(call.value ?? call);
    const rawName = typeof call.name === "string" ? call.name : "", declaredName = declaredEvidenceToolName(rawName, declaredTools);
    projection.tool_name = declaredName ?? "[REDACTED]";
    projection.redactions.push(declaredName === null ? "tool-name-redacted" : "tool-name-declared", "tool-arguments-redacted");
    let args = call.arguments ?? call.args;
    try {
        if (typeof args === "string")
            args = JSON.parse(args);
    }
    catch {
        projection.redactions.push("malformed-tool-arguments");
        return projection;
    }
    const values = record(args);
    let raw = null;
    for (const key of ["path", "file", "file_path", "source", "name"])
        if (typeof values[key] === "string" && values[key]) {
            raw = values[key];
            break;
        }
    if (raw !== null) {
        const safe = safeLocator(raw, workspaceRoot), kind = rawName.split("__").pop() === "load_skill" ? "reference" : "file";
        projection.locator = { kind, value: safe, redacted: safe === null, reason: safe === null ? "unsafe-or-sensitive-locator" : null };
        if (safe === null)
            projection.redactions.push("locator-redacted");
    }
    return projection;
}
function projectionTranscript(events) { return JSON.stringify({ schema_version: "1.0", privacy: "sanitized-evidence-projection", events }, null, 2) + "\n"; }
function parseEvents(stdout) { const trimmed = stdout.trim(); if (!trimmed)
    return []; try {
    const whole = JSON.parse(trimmed);
    return Array.isArray(whole) ? whole : [whole];
}
catch {
    return trimmed.split(/\r?\n/).filter(Boolean).map(line => { try {
        return JSON.parse(line);
    }
    catch {
        return { type: "unparsed", raw: line };
    } });
} }
function classify(stderr, code) { const value = stderr.toLowerCase(); const statusMatch = value.match(/(?:status|http|code)[^0-9]{0,8}(408|409|425|429|5[0-9]{2})/), status = statusMatch ? Number(statusMatch[1]) : null; let retry = null; const line = stderr.split(String.fromCharCode(10)).find(item => item.trim().toLowerCase().startsWith("retry-after:")); if (line) {
    const raw = line.slice(line.indexOf(":") + 1).trim();
    if (/^\d+$/.test(raw) && Number.isFinite(Number(raw)))
        retry = Number(raw) * 1000;
    else {
        const date = Date.parse(raw);
        if (Number.isFinite(date) && date >= Date.now())
            retry = date - Date.now();
    }
} if (status !== null || /rate.?limit|temporar|overload|try again/.test(value))
    return { code: "host-exit", reason: "provider-transient", provider: { classification: "transient", status, code: status === 429 ? "rate-limit" : null, retryAfterMs: retry, retryOwner: "provider-scheduler" } }; if (/model/.test(value) && /(not found|unavailable|unknown|not configured)/.test(value))
    return { code: "model-unavailable", reason: "model-unavailable" }; if (/model/.test(value) && /(reject|denied|forbidden|unauthori[sz]ed)/.test(value))
    return { code: "model-rejected", reason: "model-rejected" }; if (/tool/.test(value) && /(not found|unavailable|unknown|not configured)/.test(value))
    return { code: "tool-unavailable", reason: "tool-unavailable" }; if (/tool/.test(value) && /(reject|denied|forbidden|unauthori[sz]ed|not allowed)/.test(value))
    return { code: "tool-rejected", reason: "tool-rejected" }; return { code: "host-exit", reason: "exit:" + (code ?? "unknown") }; }
function parseResponse(events) { const terminal = [...events].reverse().find(e => e.type === "complete") ?? events.at(-1) ?? {}, messages = events.filter(e => e.type === "message"); let output = text(terminal.output ?? terminal.response ?? terminal.message ?? terminal.result ?? ""); if (!output.trim())
    output = messages.map(event => text(event.message ?? event.output ?? event.response ?? event.result ?? "")).join(""); try {
    const nested = JSON.parse(output);
    if (nested && typeof nested === "object" && !Array.isArray(nested) && typeof nested.output === "string")
        output = nested.output;
}
catch { } if (!output.trim())
    throw new PairedExecutionError("invalid-response", "Goose stream contained no output", "invalid-response"); const telemetry = normalizeExecutionEfficiency({ events, terminal, durationSeconds: 0, firstUsefulActionSeconds: null, failed: false, retries: 0 }); return { output, tokens: telemetry.total_tokens.value, terminal }; }
export class GooseRunner {
    retryBehavior = "none";
    command;
    constructor(command) { this.command = configuredGooseArgv(command); }
    textCommand(model) { const command = [...this.command, "run", "--no-session", "--quiet", "--output-format", "text", "--instructions", "-"]; if (model)
        command.push("--model", model); return command; }
    streamCommand(query, model) { const command = [...this.command, "run", "--no-session", "--quiet", "--output-format", "stream-json", "--text", query]; if (model)
        command.push("--model", model); return command; }
    pairedCommand(plan) { const maxTurns = plan.maxTurns ?? 40; if (!Number.isInteger(maxTurns) || maxTurns <= 0 || !Number.isFinite(plan.timeoutSeconds) || plan.timeoutSeconds <= 0)
        throw new PairedExecutionError("invalid-plan", "Execution budget must specify positive max turns and timeout", "invalid-plan"); const command = [...this.command, "run", "--no-session", "--no-profile", "--quiet", "--output-format", "stream-json", "--max-turns", String(maxTurns), "--instructions", "-"]; if (plan.model)
        command.push("--model", plan.model); if (plan.reasoning) {
        const configured = plan.reasoning.adapterConfig?.argv;
        if (!Array.isArray(configured) || configured.some(x => typeof x !== "string") || configured.some(x => x.length > 256))
            throw new PairedExecutionError("invalid-plan", "Explicit reasoning requires bounded adapter_config.argv capability binding", "invalid-plan");
        command.push(...configured.map(String));
    } for (const tool of plan.tools)
        command.push("--with-builtin", tool); return command; }
    validateCapabilities(capabilities, tools) { if (!capabilities)
        throw new PairedExecutionError("capability-mismatch", "Scenario must declare filesystem, agent_runner, browser, network, and tools", "capability-mismatch"); for (const key of ["filesystem", "agent_runner", "browser", "network"])
        if (typeof capabilities[key] !== "boolean")
            throw new PairedExecutionError("capability-mismatch", `Capability '${key}' must be boolean`, "capability-mismatch"); if (!Array.isArray(capabilities.tools) || capabilities.tools.some(x => typeof x !== "string") || capabilities.tools.some((x, i, a) => !x || a.indexOf(x) !== i) || tools.length !== capabilities.tools.length || tools.some((x, i) => x !== capabilities.tools[i]))
        throw new PairedExecutionError("capability-mismatch", "Declared tools must be unique strings and match the execution plan", "capability-mismatch"); if (capabilities.agent_runner !== true || capabilities.filesystem !== true || capabilities.browser || capabilities.network)
        throw new PairedExecutionError("capability-mismatch", "Goose isolated execution supports filesystem and agent_runner only; browser/network must be false", "capability-mismatch"); }
    hostVersion() { const version = spawnSync(this.command[0], [...this.command.slice(1), "--version"], { encoding: "utf8", timeout: 5000 }); return String(version.stdout || version.stderr || "unknown").trim(); }
    async executePaired(plan) {
        let started = null, firstUsefulActionSeconds = null, hostVersion = "unknown", command = [];
        const events = [], projectedEvents = [];
        let stdout = "", stdoutRemainder = "", stderr = "", streamParseErrors = 0;
        const evidence = (exitReason, exitCode) => { const durationSeconds = started === null ? 0 : (performance.now() - started) / 1000; return { transcript: projectionTranscript(projectedEvents), events: projectedEvents, durationSeconds, hostVersion, exitReason, exitCode, command, telemetry: normalizeExecutionEfficiency({ events, durationSeconds, firstUsefulActionSeconds, failed: exitReason !== "completed", retries: 0, workspaceRoot: plan.cwd, streamParseErrors }) }; };
        hostVersion = this.hostVersion();
        try {
            this.validateCapabilities(plan.capabilities, plan.tools);
        }
        catch (error) {
            const typed = error;
            throw new PairedExecutionError(typed.code, typed.message, typed.exitReason, typed.exitCode, evidence(typed.exitReason, typed.exitCode));
        }
        try {
            command = this.pairedCommand(plan);
        }
        catch (error) {
            const typed = error;
            throw new PairedExecutionError(typed.code, typed.message, typed.exitReason, typed.exitCode, evidence(typed.exitReason, typed.exitCode));
        }
        try {
            if (!existsSync(plan.cwd) || !statSync(plan.cwd).isDirectory())
                throw new Error();
        }
        catch {
            throw new PairedExecutionError("invalid-cwd", `Execution cwd is not a directory: ${plan.cwd}`, "invalid-cwd", null, evidence("invalid-cwd", null));
        }
        const context = plan.configuration === "without_skill" ? "Complete the task without loading the evaluated Skill." : `The ${plan.skillName ?? "evaluated"} Skill is installed in this isolated workspace. Load and use it for the task.`;
        const reproducibility = plan.seed === undefined ? "" : `Evaluation seed: ${plan.seed}; paired repetition: ${plan.pairIndex}; order position: ${plan.orderPosition}.\n`;
        started = performance.now();
        const instruction = `${reproducibility}${context}\n\n${plan.prompt}\n\nReturn only the task result. Do not evaluate assertions, assign verdicts, or claim whether the task passed.`;
        return await new Promise((resolve, reject) => {
            const [bin, ...args] = command;
            let settled = false, timer, timedOut = false;
            let abort = () => { };
            const finish = (error, result) => { if (settled)
                return; settled = true; if (timer)
                clearTimeout(timer); plan.signal?.removeEventListener("abort", abort); error ? reject(error) : resolve(result); };
            let child;
            try {
                child = spawn(bin, args, { cwd: plan.cwd, stdio: ["pipe", "pipe", "pipe"] });
            }
            catch (error) {
                finish(new PairedExecutionError("command-not-found", `Goose command not found: ${bin}`, "command-not-found", null, evidence("command-not-found", null)));
                return;
            }
            abort = () => { child.kill("SIGTERM"); setTimeout(() => { if (child.exitCode === null)
                child.kill("SIGKILL"); }, 250).unref(); };
            plan.signal?.addEventListener("abort", abort, { once: true });
            if (plan.signal?.aborted)
                abort();
            timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, plan.timeoutSeconds * 1000);
            const parseStreamLines = (chunk, flush = false) => { stdoutRemainder += chunk; const lines = stdoutRemainder.split("\n"); const trailing = lines.pop() ?? ""; stdoutRemainder = flush ? "" : trailing; if (flush && trailing)
                lines.push(trailing); for (const line of lines) {
                const value = line.endsWith("\r") ? line.slice(0, -1) : line;
                if (!value)
                    continue;
                try {
                    const event = JSON.parse(value), observedAt = (performance.now() - started) / 1000;
                    events.push(event);
                    projectedEvents.push(projectEvent(event, observedAt, plan.cwd, plan.tools));
                    if (firstUsefulActionSeconds === null && isUsefulStreamEvent(event))
                        firstUsefulActionSeconds = observedAt;
                }
                catch {
                    streamParseErrors++;
                    projectedEvents.push({ type: "invalid-json", observed_at_seconds: (performance.now() - started) / 1000, redactions: ["malformed-stream-record-redacted"] });
                }
            } };
            child.stdout.on("data", chunk => { const value = String(chunk); stdout += value; parseStreamLines(value); });
            child.stderr.on("data", chunk => stderr += String(chunk));
            child.on("error", (error) => { const code = error.code === "ENOENT" ? "command-not-found" : "host-exit"; finish(new PairedExecutionError(code, error.message, code, null, evidence(code, null))); });
            child.on("close", (code, signal) => { parseStreamLines("", true); const duration = started === null ? 0 : (performance.now() - started) / 1000; if (plan.signal?.aborted) {
                finish(new PairedExecutionError("cancelled", "Goose execution cancelled", "cancelled", code, evidence("cancelled", code)));
                return;
            } if (timedOut && signal) {
                finish(new PairedExecutionError("timeout", `Goose exceeded ${plan.timeoutSeconds}s timeout`, "timeout", code, evidence("timeout", code)));
                return;
            } if (code !== 0) {
                const typed = classify(stderr, code);
                finish(new PairedExecutionError(typed.code, `Goose exited ${code}: ${stderr.trim()}`, typed.reason, code, evidence(typed.reason, code), typed.provider));
                return;
            } try {
                const parsed = parseResponse(events.length ? events : parseEvents(stdout));
                const ev = evidence("completed", code ?? 0);
                ev.telemetry = normalizeExecutionEfficiency({ events, terminal: parsed.terminal, durationSeconds: ev.durationSeconds, firstUsefulActionSeconds, failed: false, retries: 0, workspaceRoot: plan.cwd, streamParseErrors });
                finish(undefined, { output: parsed.output, tokens: ev.telemetry.total_tokens.value, ...ev, tokenAvailabilityReason: ev.telemetry.total_tokens.reason, exitCode: code ?? 0 });
            }
            catch (error) {
                const typed = error instanceof PairedExecutionError ? error : new PairedExecutionError("invalid-response", error.message, "invalid-response");
                finish(new PairedExecutionError(typed.code, typed.message, typed.exitReason, code, evidence(typed.exitReason, code)));
            } });
            child.stdin.write(instruction);
            child.stdin.end();
        });
    }
    async runText(prompt, model, timeout = 300, cwd) { const command = this.textCommand(model), [bin, ...args] = command; return new Promise((resolvePromise, reject) => { const child = spawn(bin, args, { cwd, timeout: timeout * 1000 }); let stdout = "", stderr = ""; child.stdout.on("data", chunk => (stdout += chunk)); child.stderr.on("data", chunk => (stderr += chunk)); child.on("error", (error) => reject(error.code === "ENOENT" ? new RunnerError(`Goose command not found: ${this.command[0]}`) : error)); child.on("close", code => code === 0 ? resolvePromise(stdout) : reject(new RunnerError(`Goose exited ${code}: ${command.join(" ")}\nstderr: ${stderr.trim()}`))); child.stdin.write(prompt); child.stdin.end(); }); }
    startStream(query, model, cwd) { const [bin, ...args] = this.streamCommand(query, model); try {
        return spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "ignore"] });
    }
    catch {
        throw new RunnerError(`Goose command not found: ${this.command[0]}`);
    } }
    eventLoadedSkill(event, skillName) { if (event.type === "complete" || event.type === "error")
        return false; if (event.type !== "message")
        return null; const content = (event.message ?? {}).content ?? []; for (const item of content) {
        if (!["toolRequest", "tool_request"].includes(item.type))
            continue;
        let call = (item.toolCall ?? item.tool_call ?? {});
        call = call?.Ok ?? call;
        call = call?.value ?? call;
        if (call?.name?.split("__").pop() !== "load_skill")
            continue;
        let values = call.arguments ?? {};
        try {
            if (typeof values === "string")
                values = JSON.parse(values);
        }
        catch {
            values = {};
        }
        const loaded = String(values?.name ?? "");
        return loaded === skillName || loaded.startsWith(`${skillName}/`);
    } return null; }
}
