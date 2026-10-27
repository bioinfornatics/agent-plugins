/** Paired discovery isolation, NOT an OS sandbox. Children can still access the host
 * filesystem/network. Authentication is transported only through whitelisted env.
 */
import { lstatSync, readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, chmodSync, rmSync, existsSync } from "node:fs";
import { resolve, join, relative, dirname, parse, isAbsolute } from "node:path";
import { tmpdir, homedir } from "node:os";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import yaml from "js-yaml";
import { captureEvaluationConfig, stageEvaluationConfig } from "./evaluation_config.js";
import { configuredGooseArgv } from "./runners/goose.js";
import { gooseFinalResponse } from "./goose_final_response.js";
import { snapshotTaskFiles, preserveTaskEvidence, renderTaskEvidence } from "./task_evidence.js";
import { normalizeExecutionEfficiency, isUsefulStreamEvent } from "./execution_efficiency.js";
class Invalid extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
    }
}
class ExecutionFailure extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
    }
}
const fail = (code) => { throw new Invalid(code); };
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v) ? v : {};
const safeName = (v) => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v) ? v : fail("unsafe-name");
function inside(parent, child) {
    const r = relative(parent, child);
    return !r || (!isAbsolute(r) && r !== ".." && !r.startsWith("../") && !r.startsWith("..\\"));
}
/** Check every existing ancestor: resolving a symlink before lstat would hide it. */
function checkedPath(input, kind, missing = false) {
    if (!input || input.includes("\0"))
        return fail("invalid-path");
    const path = resolve(input), root = parse(path).root;
    let current = root;
    for (const part of relative(root, path).split(/[\\/]/).filter(Boolean)) {
        current = join(current, part);
        let stat;
        try {
            stat = lstatSync(current);
        }
        catch (e) {
            if (missing && e.code === "ENOENT")
                return path;
            return fail("missing-path");
        }
        if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
            return fail("unsafe-path-type");
        if (current !== path && !stat.isDirectory())
            return fail("invalid-path-parent");
    }
    if (kind) {
        const stat = lstatSync(path);
        if (kind === "file" ? !stat.isFile() : !stat.isDirectory())
            return fail("invalid-path-type");
    }
    return path;
}
const excluded = (name) => name === ".git" || name === ".goose-plugin-install.json" || name === ".goose-plugin-update.json";
const forbiddenFixture = new Set([".agents", ".goose", ".claude", ".config", "agents.md", "claude.md", ".goosehints"]);
function filesIn(root, fixtures = false, omitConfig = false) {
    checkedPath(root, "dir");
    const files = [];
    const walk = (dir) => {
        for (const name of readdirSync(dir).sort()) {
            if (omitConfig && dir === root && [".config", "config"].includes(name))
                continue;
            const path = checkedPath(join(dir, name)), stat = lstatSync(path);
            if (fixtures && forbiddenFixture.has(name.toLowerCase()))
                return fail("fixture-discovery-context");
            if (name.toLowerCase() === "secrets.yaml")
                return fail("secret-file-not-permitted");
            if (!fixtures && excluded(name))
                continue;
            if (stat.isDirectory())
                walk(path);
            else {
                const data = readFileSync(path);
                files.push({ path: relative(root, path).replaceAll("\\", "/"), sha256: sha(data), bytes: data.length });
            }
        }
    };
    walk(root);
    return files;
}
function privateDir(path) { mkdirSync(path, { recursive: true, mode: 0o700 }); chmodSync(path, 0o700); }
/** Recheck bytes during copying; changes after selection fail rather than mix arms. */
function copyClosure(source, destination, files) {
    privateDir(destination);
    const copyDirectories = (dir) => {
        for (const name of readdirSync(dir).sort()) {
            const path = checkedPath(join(dir, name));
            if (lstatSync(path).isDirectory()) {
                // Excluded metadata is absent from closures, including empty .git trees.
                if (excluded(name) && !files.some(f => f.path.startsWith(relative(source, path).replaceAll("\\", "/") + "/")))
                    continue;
                privateDir(join(destination, relative(source, path)));
                copyDirectories(path);
            }
        }
    };
    copyDirectories(source);
    for (const file of files) {
        const from = checkedPath(join(source, file.path), "file"), data = readFileSync(from);
        if (sha(data) !== file.sha256)
            return fail("source-changed");
        const to = join(destination, file.path);
        privateDir(dirname(to));
        const mode = lstatSync(from).mode & 0o111 ? 0o700 : 0o600;
        writeFileSync(to, data, { flag: "wx", mode });
    }
}
/** Materialize host import names only in the owned private copy. Source bindings stay original. */
function qualifyPrivatePlugin(target, root) {
    const plugin = target.kind === "plugin" ? target.name : target.name.includes(":") ? target.name.split(":")[0] : undefined;
    if (!plugin)
        return target.files;
    for (const file of target.files.filter(f => /(^|\/)SKILL\.md$/.test(f.path))) {
        const path = checkedPath(join(root, file.path), "file"), raw = readFileSync(path, "utf8");
        const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
        if (!match)
            return fail("invalid-skill-frontmatter");
        const metadata = object(yaml.load(match[1])), declared = metadata.name;
        if (typeof declared !== "string")
            return fail("invalid-skill-frontmatter");
        const local = declared.startsWith(plugin + ":") ? declared.slice(plugin.length + 1) : declared;
        safeName(local);
        if (declared === plugin + ":" + local)
            continue;
        metadata.name = plugin + ":" + local;
        writeFileSync(path, "---\n" + yaml.dump(metadata, { lineWidth: -1 }) + "---\n" + raw.slice(match[0].length), { mode: 0o600 });
    }
    return filesIn(root);
}
function scanSkills(root, plugin) {
    if (!existsSync(root)) {
        checkedPath(root, undefined, true);
        return [];
    }
    checkedPath(root, "dir");
    const found = [];
    const walk = (dir) => {
        const names = readdirSync(dir).sort();
        if (names.includes("SKILL.md")) {
            const body = readFileSync(checkedPath(join(dir, "SKILL.md"), "file"), "utf8");
            const match = body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
            if (!match)
                return fail("invalid-skill-frontmatter");
            let metadata;
            try {
                metadata = object(yaml.load(match[1]));
            }
            catch {
                return fail("invalid-skill-frontmatter");
            }
            // Installed hosts may materialize the plugin namespace in frontmatter.
            const declared = metadata.name;
            const local = plugin && typeof declared === "string" && declared.startsWith(plugin + ":") ? declared.slice(plugin.length + 1) : declared;
            found.push({ name: safeName(local), path: dir, ...(plugin ? { plugin } : {}) });
        }
        for (const name of names) {
            const path = checkedPath(join(dir, name));
            if (!excluded(name) && lstatSync(path).isDirectory())
                walk(path);
        }
    };
    walk(root);
    return found;
}
function manifestName(root) {
    const candidates = ["plugin.json", ".plugin/plugin.json", ".goose-plugin/plugin.json"].map(p => join(root, p)).filter(p => existsSync(p));
    if (candidates.length !== 1)
        return fail("missing-or-ambiguous-plugin-manifest");
    try {
        return safeName(object(JSON.parse(readFileSync(checkedPath(candidates[0], "file"), "utf8"))).name);
    }
    catch (e) {
        if (e instanceof Invalid)
            throw e;
        return fail("invalid-plugin-manifest");
    }
}
function selectTargets(home, skills, plugins, pluginPaths = []) {
    const needsCatalog = skills.length > 0 || plugins.length > 0;
    const standalone = needsCatalog ? [".agents/skills", ".goose/skills", ".claude/skills", ".config/goose/skills"].flatMap(p => scanSkills(join(home, p))) : [];
    const pluginRoot = join(home, ".agents/plugins"), catalog = [];
    checkedPath(pluginRoot, undefined, true);
    if (needsCatalog && existsSync(pluginRoot))
        for (const entry of readdirSync(pluginRoot).sort()) {
            const path = checkedPath(join(pluginRoot, entry), "dir"), name = manifestName(path);
            catalog.push({ name, path, skills: scanSkills(join(path, "skills"), name) });
        }
    const targets = [], expected = [], whole = new Set();
    const unique = (items) => items.length === 1 ? items[0] : fail(items.length ? "ambiguous-selection" : "missing-selection");
    for (const value of plugins) {
        const name = safeName(value);
        if (whole.has(name))
            return fail("duplicate-selection");
        const plugin = unique(catalog.filter(p => p.name === name));
        whole.add(name);
        targets.push({ name, source: plugin.path, destination: ".agents/plugins/" + name, kind: "plugin", files: filesIn(plugin.path) });
        expected.push(...plugin.skills.map(s => name + ":" + s.name));
    }
    for (const input of pluginPaths) {
        const path = checkedPath(input, "dir"), name = manifestName(path);
        if (whole.has(name) || targets.some(t => inside(t.source, path) || inside(path, t.source)))
            return fail("overlapping-selection");
        whole.add(name);
        const localSkills = scanSkills(join(path, "skills"), name);
        targets.push({ name, source: path, destination: ".agents/plugins/" + name, kind: "plugin", files: filesIn(path) });
        expected.push(...localSkills.map(skill => name + ":" + skill.name));
    }
    for (const value of skills) {
        const parts = value.split(":");
        if (parts.length > 2)
            return fail("unsafe-name");
        parts.forEach(safeName);
        if (parts.length === 1) {
            const skill = unique(standalone.filter(s => s.name === value));
            targets.push({ name: value, source: skill.path, destination: ".agents/skills/" + value, kind: "skill", files: filesIn(skill.path) });
        }
        else {
            const plugin = unique(catalog.filter(p => p.name === parts[0]));
            if (whole.has(plugin.name))
                return fail("overlapping-selection");
            const skill = unique(plugin.skills.filter(s => s.name === parts[1]));
            targets.push({ name: value, source: skill.path, destination: ".agents/plugins/" + plugin.name + "/skills/" + skill.name, kind: "skill", files: filesIn(skill.path) });
        }
        expected.push(value);
    }
    for (let i = 0; i < targets.length; i++)
        for (let j = i + 1; j < targets.length; j++)
            if (inside(targets[i].source, targets[j].source) || inside(targets[j].source, targets[i].source))
                return fail("overlapping-selection");
    if (new Set(expected).size !== expected.length)
        return fail("duplicate-skill-name");
    // Nested SKILL.md files are discovery targets too, never silently injected siblings.
    for (const target of targets.filter(t => t.kind === "skill")) {
        if (target.files.filter(f => /(^|\/)SKILL\.md$/.test(f.path)).length !== 1)
            return fail("nested-selected-skill-discovery");
    }
    return { targets, expected: expected.sort() };
}
const allowedEnv = new Set([
    "DBUS_SESSION_BUS_ADDRESS", "GOOSE_DISABLE_KEYRING", "PATH", "LANG", "LC_ALL", "TZ", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy",
    "OPENAI_API_KEY", "OPENAI_HOST", "OPENAI_BASE_URL", "OPENAI_ORGANIZATION", "OPENAI_ORG_ID", "OPENAI_PROJECT_ID",
    "ANTHROPIC_API_KEY", "ANTHROPIC_HOST", "ANTHROPIC_BASE_URL", "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_KEY", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_API_VERSION", "AZURE_OPENAI_DEPLOYMENT_NAME",
    "GOOSE_PROVIDER", "GOOSE_MODEL", "AZURE_FOUNDRY_ENDPOINT", "AZURE_FOUNDRY_MODEL", "AZURE_FOUNDRY_API_VERSION", "AZURE_FOUNDRY_API_KEY", "AZURE_FOUNDRY_AD_TOKEN",
    "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_TENANT_ID", "AZURE_API_KEY", "AZURE_ENDPOINT",
    "GOOGLE_API_KEY", "GEMINI_API_KEY", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION",
    "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_REGION", "AWS_DEFAULT_REGION",
    "OPENROUTER_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "DEEPSEEK_API_KEY", "TOGETHER_API_KEY", "XAI_API_KEY", "OLLAMA_HOST"
]);
function environment(home, base, options) {
    const env = { ...base, HOME: home, USERPROFILE: home,
        XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local/share"), XDG_STATE_HOME: join(home, ".local/state"),
        XDG_CACHE_HOME: join(home, ".cache"), XDG_RUNTIME_DIR: join(home, ".runtime"), APPDATA: join(home, "AppData/Roaming"),
        LOCALAPPDATA: join(home, "AppData/Local"), GOOSE_PATH_ROOT: home,
        TMPDIR: join(home, "tmp"), TMP: join(home, "tmp"), TEMP: join(home, "tmp"), CONTEXT_FILE_NAMES: "[]" };
    if (options.provider)
        env.GOOSE_PROVIDER = options.provider;
    if (options.model)
        env.GOOSE_MODEL = options.model;
    for (const key of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR", "APPDATA", "LOCALAPPDATA", "GOOSE_PATH_ROOT", "TMPDIR"])
        privateDir(env[key]);
    return env;
}
function redact(text, base) {
    for (const [key, value] of Object.entries(base))
        if (value && /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTHORIZATION|AUTHENTICATION|PROXY/i.test(key))
            text = text.split(value).join("[REDACTED]");
    return text.replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{12,}|Bearer\s+[^\s"']+)/g, "[REDACTED]");
}
/** Closed safe diagnostic classification; raw child payload is never retained. */
function diagnostic(stdout, stderr, reason) {
    if (reason === "completed")
        return null;
    for (const [source, text] of [["stdout", stdout], ["stderr", stderr]]) {
        if (/(?:unexpected argument|unrecognized (?:argument|option)|unknown option|invalid value .*--output-format)/i.test(text))
            return { category: "cli", code: "invalid-cli-arguments", source };
        if (/(?:command not found|ENOENT|No such file or directory)/i.test(text))
            return { category: "launch", code: "missing-executable-or-resource", source };
        if (/(?:keyring|secret service).*(?:unavailable|failed|not found|locked)/i.test(text))
            return { category: "authentication", code: "credential-store-unavailable", source };
        const missing = text.match(/Configuration value not found:\s*(AZURE_FOUNDRY_ENDPOINT|AZURE_FOUNDRY_MODEL|GOOSE_PROVIDER|GOOSE_MODEL)\b/);
        if (missing)
            return { category: "configuration", code: "missing-configuration", parameter: missing[1], source };
        if (/(?:unauthorized|authentication failed|invalid api key|\b401\b)/i.test(text))
            return { category: "authentication", code: "authentication-failed", source };
    }
    return { category: reason === "launch-failed" ? "launch" : reason === "timeout" ? "timeout" : "execution", code: reason === "host-exit" ? "unknown-host-failure" : reason, source: "process" };
}
/** Bounded buffers and owned process groups. No stderr/provider payload is retained. */
async function subprocess(argv, cwd, env, stdin, timeout) {
    return new Promise(resolveResult => {
        const started = performance.now();
        let stdout = "", stderr = "", size = 0, reason = "completed", settled = false;
        const decoder = new TextDecoder("utf-8", { fatal: true }), errorDecoder = new TextDecoder("utf-8", { fatal: true });
        const child = spawn(argv[0], argv.slice(1), { cwd, env, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
        let escalation;
        const kill = (signal) => {
            try {
                if (process.platform !== "win32" && child.pid)
                    process.kill(-child.pid, signal);
                else
                    child.kill(signal);
            }
            catch { /* reaped */ }
        };
        const terminate = () => {
            kill("SIGTERM");
            if (!escalation)
                escalation = setTimeout(() => kill("SIGKILL"), 250);
        };
        const timer = setTimeout(() => { reason = "timeout"; terminate(); }, timeout * 1000);
        const finish = (code, signal = null) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (escalation)
                clearTimeout(escalation);
            kill("SIGKILL");
            resolveResult({ code, reason, signal, diagnostic: diagnostic(stdout, stderr, reason), stdout: reason === "completed" ? stdout : "", durationSeconds: (performance.now() - started) / 1000 });
        };
        child.stdout.on("data", (chunk) => {
            size += chunk.length;
            if (size > 16 * 1024 * 1024) {
                reason = "output-limit";
                terminate();
                return;
            }
            if (reason !== "completed")
                return;
            try {
                stdout += decoder.decode(chunk, { stream: true });
            }
            catch {
                reason = "invalid-utf8";
                terminate();
            }
        });
        child.stderr.on("data", (chunk) => {
            size += chunk.length;
            if (size > 16 * 1024 * 1024) {
                reason = "output-limit";
                terminate();
                return;
            }
            if (reason !== "completed")
                return;
            try {
                stderr += errorDecoder.decode(chunk, { stream: true });
            }
            catch {
                reason = "invalid-utf8";
                terminate();
            }
        });
        child.stdin.on("error", () => { });
        child.on("error", () => { reason = "launch-failed"; terminate(); finish(null); });
        child.on("exit", () => kill("SIGKILL"));
        child.on("close", (code, signal) => {
            if (reason === "completed")
                try {
                    stdout += decoder.decode();
                    stderr += errorDecoder.decode();
                }
                catch {
                    reason = "invalid-utf8";
                }
            if (code !== 0 && reason === "completed")
                reason = "host-exit";
            finish(code, signal);
        });
        child.stdin.end(stdin);
    });
}
function inventoryFrom(text) {
    const lines = text.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/), inventory = [];
    let header = false, locationIndex = -1;
    for (const line of lines) {
        if (!line.trim())
            continue;
        const cells = line.split("|").map(c => c.trim());
        if (cells[0] === "")
            cells.shift();
        if (cells.at(-1) === "")
            cells.pop();
        if (!header) {
            if (cells[0] === "Name" && cells.includes("Location")) {
                header = true;
                locationIndex = cells.indexOf("Location");
                continue;
            }
            throw new ExecutionFailure("unparseable-skills-inventory");
        }
        if (/^[\s|+:=-]+$/.test(line))
            continue;
        if (cells.length <= locationIndex || !cells[0] || !cells[locationIndex])
            throw new ExecutionFailure("unparseable-skills-inventory");
        const name = cells[0];
        try {
            name.split(":").forEach(safeName);
        }
        catch {
            throw new ExecutionFailure("unparseable-skills-inventory");
        }
        if (name.split(":").length > 2 || inventory.some(i => i.name === name))
            throw new ExecutionFailure("ambiguous-skills-inventory");
        inventory.push({ name, location: cells[locationIndex], builtin: cells[locationIndex].startsWith("builtin://") });
    }
    if (!header)
        throw new ExecutionFailure("unparseable-skills-inventory");
    return inventory.sort((a, b) => a.name.localeCompare(b.name));
}
function verifyInventory(actual, expected, home, targets) {
    if (JSON.stringify(actual.filter(i => !i.builtin).map(i => i.name).sort()) !== JSON.stringify(expected))
        throw new ExecutionFailure("discovery-target-mismatch");
    for (const item of actual.filter(i => !i.builtin)) {
        if (!isAbsolute(item.location))
            throw new ExecutionFailure("discovery-location-mismatch");
        const path = checkedPath(item.location);
        const target = targets.find(t => t.kind === "plugin" ? item.name.startsWith(t.name + ":") : item.name === t.name);
        if (!target || !inside(join(home, target.destination), path))
            throw new ExecutionFailure("discovery-location-mismatch");
    }
}
function observedLoads(events) {
    const loaded = new Set();
    for (const event of events) {
        const content = object(event.message).content;
        if (!Array.isArray(content))
            continue;
        for (const value of content) {
            const item = object(value);
            if (!["toolRequest", "tool_request", "tool_call"].includes(String(item.type)))
                continue;
            let call = object(item.toolCall ?? item.tool_call);
            call = object(call.Ok ?? call);
            call = object(call.value ?? call);
            if (typeof call.name !== "string" || call.name.split("__").at(-1) !== "load_skill")
                continue;
            let args = call.arguments ?? call.args;
            if (typeof args === "string") {
                try {
                    args = JSON.parse(args);
                }
                catch {
                    throw new ExecutionFailure("malformed-load-observation");
                }
            }
            const raw = object(args).name;
            if (typeof raw !== "string")
                throw new ExecutionFailure("malformed-load-observation");
            const parts = raw.split("/");
            const identity = parts.shift();
            if (!/^[A-Za-z0-9][A-Za-z0-9_-]*(?::[A-Za-z0-9][A-Za-z0-9_-]*)?$/.test(identity) || raw.includes("\\") || parts.some(p => !p || p === "." || p === ".."))
                throw new ExecutionFailure("malformed-load-observation");
            loaded.add(identity);
        }
    }
    return [...loaded].sort();
}
function finalResult(result, cwd, base, mode) {
    const events = [];
    let malformed = 0;
    for (const line of result.stdout.split(/\r?\n/).filter(l => l.trim())) {
        try {
            const event = JSON.parse(line);
            if (object(event) !== event)
                throw new Error();
            events.push(event);
        }
        catch {
            malformed++;
        }
    }
    const terminal = [...events].reverse().find(e => e.type === "complete");
    let reason = result.reason, output = null;
    if (reason === "completed") {
        if (malformed || events.some(e => ["error", "failed"].includes(String(e.type))) || !terminal || terminal.error || terminal.success === false ||
            (terminal.exit_code !== undefined && terminal.exit_code !== 0) ||
            (terminal.status !== undefined && !["success", "completed", "complete"].includes(String(terminal.status))) ||
            (terminal.exit_reason !== undefined && !["success", "completed", "complete"].includes(String(terminal.exit_reason))))
            reason = "invalid-response";
        else
            try {
                output = redact(gooseFinalResponse(events, terminal, malformed), base);
            }
            catch {
                if (mode === "behavioral")
                    reason = "invalid-response";
            }
    }
    if (mode === "activation" && reason === "completed" && !events.some(e => e.type === "message" && object(e.message).role === "assistant" && Array.isArray(object(e.message).content))) {
        reason = "unsupported-activation-telemetry";
    }
    const telemetry = normalizeExecutionEfficiency({ events, terminal, durationSeconds: result.durationSeconds,
        firstUsefulActionSeconds: null, failed: reason !== "completed", retries: 0, workspaceRoot: cwd, streamParseErrors: malformed });
    // Keep only closed numeric telemetry; even apparently safe locators may carry secrets.
    telemetry.observed_files = [];
    telemetry.observed_references = [];
    let requestedSkills = null;
    if (reason === "completed")
        try {
            requestedSkills = observedLoads(events);
        }
        catch {
            reason = "malformed-load-observation";
        }
    return { activation: { requested_skills: requestedSkills, evidence_scope: "observed requests; successful load/use not proven" }, status: reason === "completed" ? "succeeded" : "failure", exit_reason: reason, exit_code: result.code,
        signal: result.signal, diagnostic: result.diagnostic, duration_seconds: result.durationSeconds, output, tokens: telemetry.total_tokens.value, telemetry,
        useful_action_observed: events.some(isUsefulStreamEvent) };
}
/** Discovery-bearing additions are not harmless host runtime state. */
function discoveryFiles(home) {
    const roots = [".agents", ".goose", ".claude", ".config/goose/skills", ".config/goose/prompts", ".config/goose/settings.json", ".config/goose/settings.local.json", "config/skills", "config/prompts", "config/settings.json", "config/settings.local.json", "AGENTS.md", "CLAUDE.md", ".goosehints"];
    const files = [];
    for (const rel of roots) {
        const path = join(home, rel);
        if (!existsSync(path)) {
            checkedPath(path, undefined, true);
            continue;
        }
        checkedPath(path);
        const stat = lstatSync(path);
        if (stat.isDirectory())
            files.push(...filesIn(path).map(f => ({ ...f, path: rel + "/" + f.path })));
        else {
            const data = readFileSync(path);
            files.push({ path: rel, sha256: sha(data), bytes: data.length });
        }
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
}
/** Private only: includes secret hashes strictly in memory, excluded from reports/bindings. */
function privateConfigurationFiles(home) {
    const roots = [join(home, ".config/goose"), join(home, "config")], files = [];
    const walk = (dir) => {
        for (const name of readdirSync(dir).sort()) {
            const p = checkedPath(join(dir, name)), s = lstatSync(p);
            if (s.isDirectory())
                walk(p);
            else
                files.push({ path: relative(home, p), hash: sha(readFileSync(p)) });
        }
    };
    for (const root of roots)
        walk(root);
    return sha(JSON.stringify(files));
}
/** Public protocol must validate its outer workspace before any mutation. */
export function validateEvaluationOutput(outputInput, sourceHome, fixturesInputs = [], pluginPaths = []) {
    const home = checkedPath(sourceHome ?? process.env.HOME ?? homedir(), "dir"), output = checkedPath(outputInput, undefined, true);
    if (existsSync(output))
        return fail("output-already-exists");
    for (const installation of [".agents", ".goose", ".claude", ".config", ".local/share/goose", "goose"]) {
        if (inside(join(home, installation), output) || inside(output, join(home, installation)))
            return fail("output-overlaps-installations");
    }
    for (const input of pluginPaths) {
        const source = checkedPath(input, "dir");
        if (inside(source, output) || inside(output, source))
            return fail("output-overlaps-source");
    }
    for (const input of fixturesInputs) {
        const fixture = checkedPath(input, "dir");
        if (inside(fixture, output) || inside(output, fixture))
            return fail("output-overlaps-fixtures");
    }
    checkedPath(dirname(output), "dir");
}
export async function runIsolatedEvaluation(options) {
    const report = { schema_version: "1.0", status: "failure", exit_code: 2,
        isolation: "private-discovery-home-and-cwd; not an OS sandbox", runs: [], manifests: [] };
    let output, root, outputOwned = false;
    const execute = !options.dryRun;
    try {
        if (process.platform === "win32" && execute)
            return fail("unsupported-windows-process-lifecycle");
        if (options.mode !== undefined && !["activation", "behavioral"].includes(options.mode))
            return fail("invalid-mode");
        report.mode = options.mode ?? "behavioral";
        if (typeof options.prompt !== "string" || !options.prompt.trim())
            return fail("invalid-prompt");
        for (const values of [options.withSkills, options.withPlugins, options.pluginPaths])
            if (values !== undefined && (!Array.isArray(values) || values.some(v => typeof v !== "string")))
                return fail("invalid-selection-list");
        const timeout = options.timeoutSeconds ?? 300, repeats = options.runsPerQuery ?? 1;
        if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 86400 || !Number.isSafeInteger(repeats) || repeats < 1 || repeats > 100)
            return fail("invalid-run-budget");
        const home = checkedPath(options.sourceHome ?? process.env.HOME ?? homedir(), "dir");
        const fixtures = options.fixtures ? checkedPath(options.fixtures, "dir") : undefined;
        output = checkedPath(options.output, undefined, true);
        if (existsSync(output))
            return fail("output-already-exists");
        for (const installation of [".agents", ".goose", ".claude", ".config", ".local/share/goose", "goose"]) {
            if (inside(join(home, installation), output) || inside(output, join(home, installation)))
                return fail("output-overlaps-installations");
        }
        if (fixtures && (inside(fixtures, output) || inside(output, fixtures)))
            return fail("output-overlaps-fixtures");
        checkedPath(dirname(output), "dir");
        validateEvaluationOutput(output, home, fixtures ? [fixtures] : [], options.pluginPaths ?? []);
        const selected = selectTargets(home, options.withSkills ?? [], options.withPlugins ?? [], options.pluginPaths ?? []);
        mkdirSync(output, { mode: 0o700 });
        outputOwned = true;
        chmodSync(output, 0o700);
        const fixtureFiles = fixtures ? filesIn(fixtures, true) : [], config = captureEvaluationConfig(home, options.config);
        const argv = configuredGooseArgv(options.command), base = {};
        for (const key of allowedEnv)
            if (process.env[key] !== undefined)
                base[key] = process.env[key];
        // Exact config-key overrides are provider-agnostic. Goose resolves required settings/auth.
        // Session bus connectivity is shared, not credential material; HOME/discovery stay private.
        for (const key of config.environmentKeys)
            if (process.env[key] !== undefined)
                base[key] = process.env[key];
        const redactions = { ...base };
        config.secrets.forEach((value, index) => { redactions["SECRET_CONFIG_" + index] = value; });
        // Reject sensitive initial inputs before discovery or paid task execution.
        for (const file of fixtureFiles) {
            const text = readFileSync(checkedPath(join(fixtures, file.path), "file"), "utf8");
            if (redact(text, redactions) !== text || redact(file.path, redactions) !== file.path) {
                report.diagnostic = { stage: "input-validation", category: "privacy", code: "sensitive-input-fixture" };
                return fail("sensitive-input-fixture");
            }
        }
        if (options.provider !== undefined)
            safeName(options.provider);
        if (options.model !== undefined && (typeof options.model !== "string" || !options.model.trim() || /[\x00-\x1f]/.test(options.model)))
            return fail("invalid-model");
        root = mkdtempSync(join(checkedPath(tmpdir(), "dir"), "skill-isolated-"));
        chmodSync(root, 0o700);
        const staging = join(root, "staging");
        privateDir(staging);
        selected.targets.forEach((target, index) => copyClosure(target.source, join(staging, String(index)), target.files));
        const fixtureStage = join(staging, "fixtures");
        if (fixtures)
            copyClosure(fixtures, fixtureStage, fixtureFiles);
        report.manifests = selected.targets.map(t => ({ ...t, closure_sha256: sha(JSON.stringify(t.files)) }));
        report.fixtures = { files: fixtureFiles, closure_sha256: sha(JSON.stringify(fixtureFiles)) };
        report.prompt_sha256 = sha(options.prompt);
        report.config_sha256 = config.binding;
        // Explicit request identity; null means no CLI override, not an inferred host model.
        report.model = options.model ?? null;
        report.provider = options.provider ?? null;
        if (options.expectedBinding && (sha(JSON.stringify(report.manifests)) !== options.expectedBinding.manifests || sha(JSON.stringify(report.fixtures)) !== options.expectedBinding.fixtures || report.config_sha256 !== options.expectedBinding.config))
            return fail("frozen-input-drift");
        report.expected_targets = selected.expected;
        report.runs_per_query = repeats;
        const runs = report.runs;
        let builtinSignature;
        for (let repeat = 0; repeat < repeats; repeat++) {
            const order = repeat % 2 === 0 ? ["baseline", "with_targets"] : ["with_targets", "baseline"];
            const pair = [];
            // Both arms must pass discovery before either model run.
            for (const arm of order) {
                const runRoot = join(root, "run-" + repeat + "-" + arm), runHome = join(runRoot, "home"), cwd = join(runRoot, "cwd");
                privateDir(runHome);
                privateDir(cwd);
                if (fixtures)
                    copyClosure(fixtureStage, cwd, fixtureFiles);
                const env = environment(runHome, base, options);
                const armTargets = arm === "baseline" ? [] : selected.targets;
                armTargets.forEach((target, index) => copyClosure(join(staging, String(index)), join(runHome, target.destination), target.files));
                const adapted = new Map(armTargets.map(target => [target, qualifyPrivatePlugin(target, join(runHome, target.destination))]));
                for (const target of armTargets.filter(t => t.kind === "skill" && t.name.includes(":"))) {
                    const pluginName = target.name.split(":")[0], path = join(runHome, ".agents/plugins", pluginName, "plugin.json");
                    if (!existsSync(path))
                        writeFileSync(path, JSON.stringify({ name: pluginName }) + "\n", { mode: 0o600, flag: "wx" });
                }
                const selectedPlugins = [...new Set(armTargets.flatMap(t => t.kind === "plugin" ? [t.name] : t.name.includes(":") ? [t.name.split(":")[0]] : []))];
                stageEvaluationConfig(config, runHome, selectedPlugins);
                // Sensitive config consistency hashes live in memory only, never serialized.
                const privateInputs = privateConfigurationFiles(runHome);
                const record = { repeat: repeat + 1, arm, status: "prepared", expected_targets: arm === "baseline" ? [] : selected.expected,
                    installed_targets: armTargets.map(t => ({ name: t.name, destination: t.destination, files: adapted.get(t), source_closure_sha256: sha(JSON.stringify(t.files)), adaptation: t.kind === "plugin" || t.name.includes(":") ? "goose-plugin-namespace-v1" : null, closure_sha256: sha(JSON.stringify(adapted.get(t))) })),
                    installed_home_files: filesIn(runHome, false, true).filter(f => !f.path.startsWith(".config/")), discovery_sha256: sha(JSON.stringify(discoveryFiles(runHome))),
                    initial_fixture_sha256: sha(JSON.stringify(filesIn(cwd, true))), inventory: null };
                runs.push(record);
                pair.push({ record, home: runHome, cwd, env });
                if (execute) {
                    const preflight = await subprocess([...argv, "skills", "list"], cwd, env, "", timeout);
                    record.preflight = { stage: "discovery", exit_code: preflight.code, signal: preflight.signal, diagnostic: preflight.diagnostic, exit_reason: preflight.reason, duration_seconds: preflight.durationSeconds };
                    if (preflight.reason !== "completed")
                        throw new ExecutionFailure("inventory-" + preflight.reason);
                    if (sha(JSON.stringify(discoveryFiles(runHome))) !== record.discovery_sha256 || privateConfigurationFiles(runHome) !== privateInputs)
                        throw new ExecutionFailure("preflight-discovery-drift");
                    const actual = inventoryFrom(preflight.stdout);
                    record.inventory = actual.map(i => ({ ...i, location: i.builtin ? redact(i.location, redactions) : inside(runHome, resolve(i.location)) ? relative(runHome, i.location).replaceAll("\\", "/") : "[OUTSIDE-PRIVATE-HOME]" }));
                    verifyInventory(actual, arm === "baseline" ? [] : selected.expected, runHome, armTargets);
                    const signature = JSON.stringify(actual.filter(i => i.builtin));
                    if (builtinSignature !== undefined && signature !== builtinSignature)
                        throw new ExecutionFailure("builtin-inventory-difference");
                    builtinSignature = signature;
                    if (sha(JSON.stringify(filesIn(cwd, true))) !== sha(JSON.stringify(fixtureFiles)))
                        throw new ExecutionFailure("preflight-mutated-fixtures");
                    for (const target of armTargets) {
                        const installed = join(runHome, target.destination);
                        if (sha(JSON.stringify(filesIn(installed))) !== sha(JSON.stringify(adapted.get(target))))
                            throw new ExecutionFailure("preflight-mutated-targets");
                    }
                    const initialHome = record.installed_home_files;
                    // Goose may create runtime state, but may not alter supplied config/manifests.
                    for (const file of initialHome) {
                        const path = checkedPath(join(runHome, file.path), "file");
                        if (sha(readFileSync(path)) !== file.sha256)
                            throw new ExecutionFailure("preflight-mutated-inputs");
                    }
                }
            }
            if (execute)
                for (const arm of pair) {
                    const command = [...argv, "run", "--no-session", "--quiet", "--output-format", "stream-json", "--max-turns", "40", "--instructions", "-"];
                    if (options.model)
                        command.push("--model", options.model);
                    const mode = options.mode ?? "behavioral";
                    const before = mode === "behavioral" ? snapshotTaskFiles(arm.cwd) : null;
                    const result = finalResult(await subprocess(command, arm.cwd, arm.env, options.prompt, timeout), arm.cwd, redactions, mode);
                    Object.assign(arm.record, result, { stage: "task-execution" });
                    // Requested names outside this arm's inventory are a contamination/fidelity failure.
                    const allowed = arm.record.inventory.map(i => i.name);
                    const observed = object(result.activation).requested_skills;
                    if (Array.isArray(observed) && observed.some(n => !allowed.includes(n))) {
                        arm.record.status = "failure";
                        arm.record.exit_reason = "undeclared-skill-load";
                    }
                    if (mode === "behavioral" && before && typeof result.output === "string") {
                        const retained = join(output, arm.record.arm, "run-" + arm.record.repeat);
                        privateDir(retained);
                        try {
                            const after = snapshotTaskFiles(arm.cwd);
                            for (const [path, file] of Object.entries(after)) {
                                const text = Buffer.from(file.bytes_base64, "base64").toString("utf8");
                                if (redact(text, redactions) !== text || redact(path, redactions) !== path) {
                                    arm.record.diagnostic = { category: "privacy", code: "sensitive-task-artifact", location: redact(path, redactions) !== path ? "path" : "content", origin: before?.[path]?.sha256 === file.sha256 ? "initial" : before?.[path] ? "modified" : "created" };
                                    throw new ExecutionFailure("sensitive-task-artifact");
                                }
                            }
                            const context = preserveTaskEvidence(arm.cwd, retained, before, result.output, Number(result.exit_code ?? -1));
                            // Only redacted readable text is projected into grading packets; binary files stay uninterpreted.
                            arm.record.grading_output = redact(renderTaskEvidence(context), redactions);
                            arm.record.task_evidence = relative(output, join(retained, "outputs/task-evidence.json"));
                        }
                        catch (error) {
                            arm.record.status = "failure";
                            arm.record.exit_reason = "task-evidence-capture-rejected";
                            throw error;
                        }
                    }
                }
            for (const arm of pair)
                rmSync(dirname(arm.home), { recursive: true, force: true });
        }
        const failed = runs.some(r => r.status === "failure");
        report.status = execute ? (failed ? "failure" : "succeeded") : "prepared";
        report.exit_code = failed ? 1 : 0;
    }
    catch (e) {
        report.status = "failure";
        report.exit_code = e instanceof Invalid ? 2 : 1;
        report.failure = { category: e instanceof Invalid ? "invalid-input" : "execution", code: e instanceof Invalid || e instanceof ExecutionFailure ? e.code : "operation-failed" };
        for (const record of report.runs)
            if (record.status === "prepared" && execute)
                record.status = "blocked";
    }
    finally {
        if (root)
            try {
                rmSync(root, { recursive: true, force: true });
            }
            catch {
                report.status = "failure";
                report.exit_code = 1;
                report.cleanup_failed = true;
            }
        if (outputOwned && output) {
            // Never write into an existing output rejected during validation.
            try {
                checkedPath(output, "dir");
                if ((lstatSync(output).mode & 0o777) === 0o700) {
                    writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600, flag: "wx" });
                }
            }
            catch {
                report.report_write_failed = true;
                report.status = "failure";
                report.exit_code = 1;
            }
        }
    }
    return report;
}
