import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { sourceHash } from "./package_manifest.js";
import { fullEval } from "./full_eval.js";
import { atomicCheckpoint } from "./execution_reliability.js";
import { LiveBudget } from "./usage_budget.js";
import { productionBindings, verifyProductionApproval } from "./production_approval.js";
import { isPathWithin, resolveContainedPath } from "./path_containment.js";
export const CI_EXIT = { success: 0, evaluationFailure: 1, invalidConfig: 2, blockedCapability: 3, pendingApproval: 4 };
class ConfigError extends Error {
}
const hash = (data) => createHash("sha256").update(data).digest("hex");
const stable = (value) => JSON.stringify(value, (_k, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const object = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const nonempty = (v, name) => { if (typeof v !== "string" || !v.trim() || v.includes("\0"))
    throw new ConfigError(name + " must be a non-empty string"); return v; };
const strings = (v, name) => { if (!Array.isArray(v) || v.some(x => typeof x !== "string" || !x.trim() || x.includes("\0")))
    throw new ConfigError(name + " must be an array of non-empty strings"); if (new Set(v).size !== v.length)
    throw new ConfigError(name + " must not contain duplicates"); return v; };
const integer = (v, name, min, max) => { if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max)
    throw new ConfigError(name + " is outside its allowed bound"); return v; };
const number = (v, name, min, max) => { if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    throw new ConfigError(name + " is outside its allowed bound"); return v; };
function keys(value, allowed, name) { const bad = Object.keys(value).filter(k => !allowed.includes(k)); if (bad.length)
    throw new ConfigError(name + " has unknown field(s): " + bad.join(", ")); }
function enumValue(v, values, name) { if (typeof v !== "string" || !values.includes(v))
    throw new ConfigError(name + " must be one of: " + values.join(", ")); return v; }
function safeGlob(value) { if (value.length > 200 || value.startsWith("/") || value.includes("\\") || value.split("/").some(p => p === "" || p === "." || p === "..") || /[\[\]{}!]/.test(value) || /^[A-Za-z]:/.test(value))
    throw new ConfigError("privacy.archive_globs contains an unsafe or unsupported pattern: " + value); if ((value.match(/\*\*/g) ?? []).length > 4)
    throw new ConfigError("privacy.archive_globs pattern is too complex: " + value); return value; }
export function loadCiEvalConfig(path) {
    let raw;
    try {
        raw = JSON.parse(readFileSync(path, "utf8"));
    }
    catch (e) {
        throw new ConfigError("cannot read CI config: " + e.message);
    }
    if (!object(raw))
        throw new ConfigError("CI config must be an object");
    keys(raw, ["schema_version", "plugin_path", "workspace", "host", "evaluation", "limits", "privacy", "cache"], "config");
    if (raw.schema_version !== "1.0")
        throw new ConfigError("schema_version must be 1.0");
    const plugin_path = nonempty(raw.plugin_path, "plugin_path"), workspace = nonempty(raw.workspace, "workspace");
    if (!object(raw.host))
        throw new ConfigError("host is required");
    keys(raw.host, ["command", "args", "required_credentials", "required_models", "required_capabilities", "environment"], "host");
    const command = nonempty(raw.host.command, "host.command"), args = strings(raw.host.args, "host.args"), required_credentials = strings(raw.host.required_credentials, "host.required_credentials"), required_models = strings(raw.host.required_models, "host.required_models"), required_capabilities = strings(raw.host.required_capabilities, "host.required_capabilities");
    for (const key of required_credentials)
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
            throw new ConfigError("host.required_credentials contains an invalid environment name");
    let environment;
    if (raw.host.environment !== undefined) {
        environment = strings(raw.host.environment, "host.environment");
        if (environment.some(k => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)))
            throw new ConfigError("host.environment must contain only valid environment names");
        const secretNames = environment.filter(k => required_credentials.includes(k) || /(?:^|_)(?:api_?key|token|secret|password|credential)(?:$|_)/i.test(k));
        if (secretNames.length)
            throw new ConfigError("credentials must be declared only in host.required_credentials");
    }
    const secretArgs = args.filter(v => /(?:bearer\s+|(?:api[_-]?key|token|secret|password)[=:]|gh[pousr]_|sk-[A-Za-z0-9])/i.test(v));
    if (secretArgs.length)
        throw new ConfigError("credentials and secret values must be supplied only through required_credentials environment names");
    if (!object(raw.limits))
        throw new ConfigError("limits is required");
    keys(raw.limits, ["timeout_ms", "max_output_bytes", "total_budget_ms", "max_runs", "max_turns", "max_wall_time_ms", "max_tokens", "max_cost", "currency", "missing_telemetry"], "limits");
    const optional = (v, n) => v === undefined ? undefined : integer(v, n, 0, Number.MAX_SAFE_INTEGER), limits = { timeout_ms: integer(raw.limits.timeout_ms, "limits.timeout_ms", 100, 3_600_000), max_output_bytes: integer(raw.limits.max_output_bytes, "limits.max_output_bytes", 1024, 16_777_216), total_budget_ms: integer(raw.limits.total_budget_ms, "limits.total_budget_ms", 100, 86_400_000), max_runs: optional(raw.limits.max_runs, "limits.max_runs"), max_turns: optional(raw.limits.max_turns, "limits.max_turns"), max_wall_time_ms: optional(raw.limits.max_wall_time_ms, "limits.max_wall_time_ms"), max_tokens: optional(raw.limits.max_tokens, "limits.max_tokens"), max_cost: raw.limits.max_cost === undefined ? undefined : Number(raw.limits.max_cost), currency: raw.limits.currency === undefined ? undefined : nonempty(raw.limits.currency, "limits.currency"), missing_telemetry: raw.limits.missing_telemetry === undefined ? undefined : enumValue(raw.limits.missing_telemetry, ["block", "allow"], "limits.missing_telemetry") };
    if (limits.max_cost !== undefined && (!Number.isFinite(limits.max_cost) || limits.max_cost < 0))
        throw new ConfigError("limits.max_cost must be finite and nonnegative");
    if (limits.total_budget_ms < limits.timeout_ms)
        throw new ConfigError("limits.total_budget_ms must be at least limits.timeout_ms");
    if (!object(raw.privacy))
        throw new ConfigError("privacy is required");
    keys(raw.privacy, ["transcripts", "archive_globs"], "privacy");
    const transcripts = enumValue(raw.privacy.transcripts, ["omit", "redact", "include"], "privacy.transcripts");
    let archive_globs;
    if (raw.privacy.archive_globs !== undefined) {
        archive_globs = strings(raw.privacy.archive_globs, "privacy.archive_globs");
        if (archive_globs.length > 64)
            throw new ConfigError("privacy.archive_globs may contain at most 64 patterns");
        archive_globs = archive_globs.map(safeGlob);
    }
    let evaluation;
    if (raw.evaluation !== undefined) {
        if (!object(raw.evaluation))
            throw new ConfigError("evaluation must be an object");
        keys(raw.evaluation, ["component_receipts", "integration", "archive", "tests_status", "human_review", "production", "approval", "approval_trust_policy", "test_evidence", "min_pass_rate", "min_delta", "efficiency"], "evaluation");
        evaluation = {};
        if (raw.evaluation.component_receipts !== undefined)
            evaluation.component_receipts = strings(raw.evaluation.component_receipts, "evaluation.component_receipts");
        if (raw.evaluation.integration !== undefined)
            evaluation.integration = nonempty(raw.evaluation.integration, "evaluation.integration");
        if (raw.evaluation.archive !== undefined)
            evaluation.archive = nonempty(raw.evaluation.archive, "evaluation.archive");
        if (raw.evaluation.tests_status !== undefined)
            evaluation.tests_status = enumValue(raw.evaluation.tests_status, ["pass", "fail", "blocked", "na"], "evaluation.tests_status");
        if (raw.evaluation.human_review !== undefined)
            evaluation.human_review = enumValue(raw.evaluation.human_review, ["pass", "pending", "na"], "evaluation.human_review");
        if (raw.evaluation.production !== undefined) {
            if (typeof raw.evaluation.production !== "boolean")
                throw new ConfigError("evaluation.production must be boolean");
            evaluation.production = raw.evaluation.production;
        }
        if (raw.evaluation.approval !== undefined)
            evaluation.approval = nonempty(raw.evaluation.approval, "evaluation.approval");
        if (raw.evaluation.approval_trust_policy !== undefined)
            evaluation.approval_trust_policy = nonempty(raw.evaluation.approval_trust_policy, "evaluation.approval_trust_policy");
        if (raw.evaluation.test_evidence !== undefined)
            evaluation.test_evidence = nonempty(raw.evaluation.test_evidence, "evaluation.test_evidence");
        if (raw.evaluation.min_pass_rate !== undefined)
            evaluation.min_pass_rate = number(raw.evaluation.min_pass_rate, "evaluation.min_pass_rate", 0, 1);
        if (raw.evaluation.min_delta !== undefined)
            evaluation.min_delta = number(raw.evaluation.min_delta, "evaluation.min_delta", -1, 1);
        if (raw.evaluation.efficiency !== undefined) {
            if (!object(raw.evaluation.efficiency))
                throw new ConfigError("evaluation.efficiency must be an object");
            keys(raw.evaluation.efficiency, ["max_regressions", "missing_telemetry"], "evaluation.efficiency");
            const policy = {};
            if (raw.evaluation.efficiency.missing_telemetry !== undefined)
                policy.missing_telemetry = enumValue(raw.evaluation.efficiency.missing_telemetry, ["block", "warn", "ignore"], "evaluation.efficiency.missing_telemetry");
            if (raw.evaluation.efficiency.max_regressions !== undefined) {
                if (!object(raw.evaluation.efficiency.max_regressions))
                    throw new ConfigError("evaluation.efficiency.max_regressions must be an object");
                const allowed = ["p50_wall_latency_ms", "p95_wall_latency_ms", "actual_turns", "tokens.input", "tokens.output", "tokens.cached", "tokens.reasoning", "tokens.total", "cost"];
                keys(raw.evaluation.efficiency.max_regressions, allowed, "evaluation.efficiency.max_regressions");
                policy.max_regressions = Object.fromEntries(Object.entries(raw.evaluation.efficiency.max_regressions).map(([k, v]) => [k, number(v, "evaluation.efficiency.max_regressions." + k, 0, Number.MAX_SAFE_INTEGER)]));
            }
            evaluation.efficiency = policy;
        }
    }
    let cache;
    if (raw.cache !== undefined) {
        if (!object(raw.cache))
            throw new ConfigError("cache must be an object");
        keys(raw.cache, ["enabled", "resume"], "cache");
        if (typeof raw.cache.enabled !== "boolean" || typeof raw.cache.resume !== "boolean")
            throw new ConfigError("cache.enabled and cache.resume must be booleans");
        if (raw.cache.resume && !raw.cache.enabled)
            throw new ConfigError("cache.resume requires cache.enabled");
        cache = { enabled: raw.cache.enabled, resume: raw.cache.resume };
    }
    return { schema_version: "1.0", plugin_path, workspace, host: { command, args, required_credentials, required_models, required_capabilities, ...(environment ? { environment } : {}) }, evaluation, limits, privacy: { transcripts, ...(archive_globs ? { archive_globs } : {}) }, cache };
}
function redact(text, credentials) { let out = text.replace(/(bearer\s+|(?:api[_-]?key|token|secret|password|credential)\s*[=:]\s*)\S+/gi, "$1[REDACTED]").replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{8,}|AKIA[A-Z0-9]{16})\b/g, "[REDACTED]"); for (const key of credentials) {
    const value = process.env[key];
    if (value)
        out = out.split(value).join("[REDACTED]");
} return out; }
function sanitized(value, credentials) { return JSON.parse(redact(JSON.stringify(value), credentials)); }
function safePath(root, candidate, name, kind = "any", mustExist = false) { const check = resolveContainedPath(root, candidate, { expectedKind: kind }); if (!check.contained)
    throw new ConfigError(name + " violates safe path policy (" + check.status + ")"); if (mustExist && check.kindOutcome !== "match")
    throw new ConfigError(name + " must be an existing " + kind); if (check.exists && lstatSync(check.lexicalPath).isSymbolicLink())
    throw new ConfigError(name + " must not be a symbolic link"); return check.resolvedPath; }
function validatePaths(configPath, c) { const checkout = realpathSync(dirname(configPath)); const plugin = safePath(checkout, c.plugin_path, "plugin_path", "directory", true); const workspace = safePath(checkout, c.workspace, "workspace", "any"); const evaluations = safePath(plugin, "evaluations", "any"); if (workspace === evaluations || !isPathWithin(evaluations, workspace))
    throw new ConfigError("workspace must be a subdirectory of plugin_path/evaluations"); if (existsSync(workspace) && !statSync(workspace).isDirectory())
    throw new ConfigError("workspace must be a directory"); const e = c.evaluation ?? {}; const integration = e.integration ? safePath(checkout, e.integration, "evaluation.integration", "any") : join(workspace, "integration"); if (!isPathWithin(workspace, integration))
    throw new ConfigError("evaluation.integration must be inside workspace"); const archive = e.archive ? safePath(checkout, e.archive, "evaluation.archive", "any") : join(workspace, basename(plugin) + ".zip"); if (!isPathWithin(workspace, archive) || archive === workspace)
    throw new ConfigError("evaluation.archive must be a file inside workspace"); if (existsSync(archive) && !statSync(archive).isFile())
    throw new ConfigError("evaluation.archive must be a file"); const receipts = (e.component_receipts ?? []).map((p, i) => safePath(checkout, p, "evaluation.component_receipts[" + i + "]", "file", true)), approval = e.approval ? safePath(checkout, e.approval, "evaluation.approval", "file", true) : undefined, approvalTrust = e.approval_trust_policy ? safePath(checkout, e.approval_trust_policy, "evaluation.approval_trust_policy", "file", true) : undefined, testEvidence = e.test_evidence ? safePath(checkout, e.test_evidence, "evaluation.test_evidence", "file", true) : undefined; return { checkout, plugin, workspace, integration, archive, receipts, approval, approvalTrust, testEvidence }; }
async function hostPhase(c, phase, cwd, request) { return await new Promise(resolveRun => { const inherited = {}; for (const key of ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SystemRoot", "ComSpec", "PATHEXT", "NODE_PATH", ...c.host.required_credentials, ...(c.host.environment ?? [])])
    if (process.env[key] !== undefined)
        inherited[key] = process.env[key]; let child; try {
    child = spawn(c.host.command, [...c.host.args, phase, "--request", request], { cwd, env: { ...inherited, CI: "true", NO_COLOR: "1", PLUGIN_CREATOR_NON_INTERACTIVE: "1" }, stdio: ["ignore", "pipe", "pipe"] });
}
catch (e) {
    return resolveRun({ code: 127, stdout: "", stderr: e.message });
} let stdout = "", stderr = "", size = 0, done = false; const finish = (code) => { if (done)
    return; done = true; clearTimeout(timer); resolveRun({ code, stdout, stderr }); }, collect = (target) => (chunk) => { size += chunk.length; if (size > c.limits.max_output_bytes) {
    child.kill("SIGKILL");
    stderr = "host output exceeded configured bound";
    return finish(1);
} target === "stdout" ? stdout += chunk : stderr += chunk; }; child.stdout.on("data", collect("stdout")); child.stderr.on("data", collect("stderr")); child.on("error", e => { stderr = e.message; finish(127); }); child.on("close", code => finish(code ?? 1)); const timer = setTimeout(() => { child.kill("SIGKILL"); stderr = "host command exceeded configured timeout"; finish(1); }, c.limits.timeout_ms); timer.unref(); }); }
function hostJson(run, phase) { if (run.code !== 0)
    throw new Error(phase + " host command failed: " + (run.stderr || run.stdout || "exit " + run.code)); let value; try {
    value = JSON.parse(run.stdout);
}
catch {
    throw new Error(phase + " host output must be one JSON object");
} if (!object(value))
    throw new Error(phase + " host output must be one JSON object"); const allowed = phase === "preflight" ? ["status", "capabilities", "models", "reason", "telemetry"] : ["status", "reason", "telemetry"]; keys(value, allowed, phase + " host output"); if (phase === "preflight") {
    enumValue(value.status, ["ready", "blocked"], "preflight status");
    strings(value.capabilities, "preflight capabilities");
    strings(value.models, "preflight models");
}
else
    enumValue(value.status, ["pass", "fail", "blocked"], "full_eval status"); if (value.reason !== undefined && typeof value.reason !== "string")
    throw new Error(phase + " host reason must be a string"); return value; }
function walkSafe(root, skip) { if (!existsSync(root))
    return []; const out = []; const canonical = realpathSync(root); function walk(dir) { for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (skip && resolve(p) === resolve(skip))
        continue;
    if (entry.isSymbolicLink())
        throw new Error("symbolic links are not allowed in evidence: " + relative(root, p));
    const checked = resolveContainedPath(canonical, p, { expectedKind: "any" });
    if (!checked.contained)
        throw new Error("evidence escapes workspace: " + relative(root, p));
    if (entry.isDirectory())
        walk(p);
    else if (entry.isFile())
        out.push(p);
    else
        throw new Error("unsupported evidence entry: " + relative(root, p));
} } walk(canonical); return out; }
function globRegex(glob) { let r = "^"; for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
        if (glob[i + 1] === "*") {
            i++;
            if (glob[i + 1] === "/") {
                i++;
                r += "(?:.*/)?";
            }
            else
                r += ".*";
        }
        else
            r += "[^/]*";
    }
    else if (c === "?")
        r += "[^/]";
    else
        r += c.replace(/[.*+?^$()|\[\]{}\\]/g, "\\$&");
} return new RegExp(r + "$"); }
function selectedEvidence(workspace, archive, globs) { const matchers = globs.map(globRegex); return walkSafe(workspace, archive).filter(p => matchers.some(re => re.test(relative(workspace, p).split(sep).join("/")))); }
function archiveEvidence(workspace, c, configHash, artifactHash, transcripts) {
    const archive = safePath(workspace, "ci-archive", "any");
    if (existsSync(archive) && !statSync(archive).isDirectory())
        throw new Error("ci archive path is not a directory");
    if (existsSync(archive))
        rmSync(archive, { recursive: true });
    mkdirSync(archive, { recursive: true });
    const guidance = join(archive, "guidance.md");
    writeFileSync(guidance, "# CI evaluation archive\n\nThis archive is evidence, not an approval. Verify inventory hashes before reuse. Transcript policy: **" + c.privacy.transcripts + "**.\n");
    if (c.privacy.transcripts !== "omit") {
        const dir = join(archive, "transcripts");
        mkdirSync(dir, { recursive: true });
        for (const [name, text] of Object.entries(transcripts))
            writeFileSync(join(dir, name + ".log"), redact(text, c.host.required_credentials));
    }
    const defaults = ["full-eval-events.jsonl", "**/benchmark.json", "**/review.html", "**/efficiency-report.html", "**/receipt.json"], globs = c.privacy.archive_globs ?? defaults, selected = selectedEvidence(workspace, archive, globs);
    if (selected.length > 1024)
        throw new Error("archive_globs selected more than 1024 files");
    for (const src of selected) {
        if (statSync(src).size > c.limits.max_output_bytes)
            throw new Error("archived evidence exceeds max_output_bytes: " + relative(workspace, src));
        const rel = relative(workspace, src).split(sep).join("/"), dst = join(archive, "evidence", ...rel.split("/"));
        mkdirSync(dirname(dst), { recursive: true });
        writeFileSync(dst, redact(readFileSync(src, "utf8"), c.host.required_credentials));
    }
    const manifest = { schema_version: "1.0", config_sha256: configHash, artifact_sha256: artifactHash, privacy: c.privacy, created_at: new Date().toISOString() };
    writeFileSync(join(archive, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    const inventory = walkSafe(archive).filter(p => basename(p) !== "inventory.json").map(p => ({ path: relative(archive, p).split(sep).join("/"), sha256: hash(readFileSync(p)), bytes: statSync(p).size })).sort((a, b) => a.path.localeCompare(b.path));
    writeFileSync(join(archive, "inventory.json"), JSON.stringify({ schema_version: "1.0", files: inventory }, null, 2) + "\n");
    return { archive, inventory, inventoryHash: hash(readFileSync(join(archive, "inventory.json"))) };
}
function outcomeFromEvidence(value) { if (!object(value) || !object(value.full_eval) || !Array.isArray(value.full_eval.jobs))
    return null; const status = value.full_eval.status, jobs = value.full_eval.jobs, review = jobs.find(j => j.phase === "review"); if (status === "success" && jobs.every(j => j.status === "succeeded"))
    return { status: "success", exit_code: 0, reason: "evaluation passed" }; if (status === "failure" && jobs.some(j => j.status === "failed"))
    return { status: "evaluation-failure", exit_code: 1, reason: "full-eval failed" }; if (status === "blocked" && review?.status === "blocked" && jobs.slice(0, jobs.indexOf(review)).every(j => j.status === "succeeded"))
    return { status: "pending-approval", exit_code: 4, reason: "evaluation evidence complete; human approval pending" }; if (status === "blocked")
    return { status: "blocked-capability", exit_code: 3, reason: "full-eval blocked" }; return null; }
function validCache(workspace, configHash, artifactHash, credentials, production) { try {
    const cachePath = safePath(workspace, "ci-result.json", "cache result", "file", true), v = JSON.parse(readFileSync(cachePath, "utf8"));
    if (!object(v) || v.schema_version !== "1.0" || !object(v.binding) || !object(v.result) || !Array.isArray(v.inventory) || typeof v.envelope_sha256 !== "string")
        return null;
    keys(v, ["schema_version", "binding", "archive", "inventory", "result", "envelope_sha256"], "cache envelope");
    const envelope = { schema_version: v.schema_version, binding: v.binding, archive: v.archive, inventory: v.inventory, result: v.result };
    if (hash(stable(envelope)) !== v.envelope_sha256)
        return null;
    const archive = safePath(workspace, "ci-archive", "cache archive", "directory", true);
    if (v.archive !== archive || v.binding.config_sha256 !== configHash || v.binding.artifact_sha256 !== artifactHash)
        return null;
    const inventoryPath = safePath(archive, "inventory.json", "inventory", "file", true), inventoryBytes = readFileSync(inventoryPath);
    if (hash(inventoryBytes) !== v.binding.inventory_sha256)
        return null;
    const inventoryDoc = JSON.parse(inventoryBytes.toString("utf8"));
    if (!object(inventoryDoc) || inventoryDoc.schema_version !== "1.0" || !Array.isArray(inventoryDoc.files) || stable(inventoryDoc.files) !== stable(v.inventory))
        return null;
    const files = walkSafe(archive).filter(p => basename(p) !== "inventory.json").map(p => relative(archive, p).split(sep).join("/")).sort(), listed = v.inventory.map(f => f.path).sort();
    if (stable(files) !== stable(listed))
        return null;
    for (const f of v.inventory) {
        if (!object(f) || typeof f.path !== "string" || !f.path || typeof f.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(f.sha256) || !Number.isSafeInteger(f.bytes) || f.bytes < 0)
            return null;
        const p = safePath(archive, f.path, "inventory file", "file", true);
        const bytes = readFileSync(p);
        if (bytes.length !== f.bytes || hash(bytes) !== f.sha256)
            return null;
    }
    if (hash(stable(v.result)) !== v.binding.result_sha256)
        return null;
    if (production && v.result.status === "success") {
        if (!production.approval || !production.trust || !production.testEvidence)
            return null;
        const expected = productionBindings(production.plugin, production.archive, production.integration, production.testEvidence);
        verifyProductionApproval(production.approval, production.trust, expected, new Date());
    }
    const derived = outcomeFromEvidence(v.result);
    if (!derived || v.result.status !== derived.status || v.result.exit_code !== derived.exit_code || v.result.reason !== derived.reason || v.result.archive !== archive || stable(v.result.inventory) !== stable(v.inventory))
        return null;
    return sanitized(v.result, credentials);
}
catch {
    return null;
} }
export async function runCiEval(configPath) {
    let c;
    try {
        c = loadCiEvalConfig(configPath);
    }
    catch (e) {
        return { schema_version: "1.0", command: "ci-eval", status: "invalid-config", exit_code: 2, reason: redact(e.message, []) };
    }
    const fail = (status, exit_code, reason) => sanitized({ schema_version: "1.0", command: "ci-eval", status, exit_code, reason: String(reason) }, c.host.required_credentials);
    let paths;
    try {
        paths = validatePaths(configPath, c);
        if (!existsSync(join(paths.plugin, "plugin.json")) || !statSync(join(paths.plugin, "plugin.json")).isFile())
            throw new ConfigError("plugin_path has no plugin.json");
    }
    catch (e) {
        return fail("invalid-config", 2, e.message);
    }
    const missing = c.host.required_credentials.filter(k => !process.env[k]?.trim());
    if (missing.length)
        return fail("blocked-capability", 3, "missing required credentials: " + missing.join(", "));
    let artifactHash;
    try {
        artifactHash = sourceHash(paths.plugin);
    }
    catch (e) {
        return fail("invalid-config", 2, e.message);
    }
    const configHash = hash(readFileSync(configPath));
    if (c.cache?.enabled && c.cache.resume) {
        const cached = validCache(paths.workspace, configHash, artifactHash, c.host.required_credentials, c.evaluation?.production ? { approval: paths.approval, trust: paths.approvalTrust, testEvidence: paths.testEvidence, plugin: paths.plugin, archive: paths.archive, integration: paths.integration } : undefined);
        if (cached)
            return cached;
    }
    try {
        mkdirSync(paths.workspace, { recursive: true });
    }
    catch (e) {
        return fail("invalid-config", 2, e.message);
    }
    const request = join(paths.workspace, "host-request.json"), budgetPath = join(paths.workspace, "ci-budget-state.json"), caps = { max_runs: c.limits.max_runs, max_turns: c.limits.max_turns, max_wall_time_ms: c.limits.max_wall_time_ms, max_tokens: c.limits.max_tokens, max_cost: c.limits.max_cost, currency: c.limits.currency, missing_telemetry: c.limits.missing_telemetry }, priorUsage = (() => { if (!c.cache?.resume || !existsSync(budgetPath))
        return []; try {
        return JSON.parse(readFileSync(budgetPath, "utf8")).usage_records ?? [];
    }
    catch {
        return [];
    } })(), live = new LiveBudget(caps, priorUsage), persistBudget = (stopReason) => atomicCheckpoint(budgetPath, { schema_version: "1.0", planned: caps, usage_records: live.all(), budget: live.snapshot(), stop_reason: stopReason ?? live.snapshot().stop_reason, availability: live.snapshot().availability, updated_at: new Date().toISOString() });
    writeFileSync(request, JSON.stringify({ schema_version: "1.0", non_interactive: true, network: "host-policy", plugin_path: paths.plugin, workspace: paths.workspace, required_models: c.host.required_models, required_capabilities: c.host.required_capabilities, limits: c.limits, budget: live.snapshot() }, null, 2) + "\n");
    let preRun, fullRun, stage = "preflight";
    try {
        if (!live.canStart().allowed) {
            persistBudget(live.canStart().reason ?? undefined);
            return fail("evaluation-failure", 1, live.canStart().reason);
        }
        preRun = await hostPhase(c, "preflight", paths.checkout, request);
        const pre = hostJson(preRun, "preflight"), capabilities = pre.capabilities, models = pre.models, absentCaps = c.host.required_capabilities.filter(x => !capabilities.includes(x)), absentModels = c.host.required_models.filter(x => !models.includes(x));
        if (pre.telemetry)
            live.add(pre.telemetry, "ci-preflight");
        persistBudget();
        if (pre.status !== "ready" || absentCaps.length || absentModels.length)
            return fail("blocked-capability", 3, pre.reason ?? ([absentCaps.length && "capabilities: " + absentCaps.join(", "), absentModels.length && "models: " + absentModels.join(", ")].filter(Boolean).join("; ") || "host preflight blocked"));
        if (!live.canStart().allowed) {
            persistBudget(live.canStart().reason ?? undefined);
            return fail("evaluation-failure", 1, live.canStart().reason);
        }
        stage = "full_eval";
        fullRun = await hostPhase(c, "full_eval", paths.checkout, request);
        const host = hostJson(fullRun, "full_eval");
        if (host.telemetry)
            live.add(host.telemetry, "ci-full-eval");
        persistBudget();
        if (host.status === "blocked")
            return fail("blocked-capability", 3, host.reason ?? "host evaluation blocked");
        if (host.status !== "pass")
            return fail("evaluation-failure", 1, host.reason ?? "host evaluation failed");
    }
    catch (e) {
        return fail(stage === "preflight" ? "blocked-capability" : "evaluation-failure", stage === "preflight" ? 3 : 1, e.message);
    }
    const e = c.evaluation ?? {}, opts = { pluginPath: paths.plugin, workspace: paths.workspace, componentReceipts: paths.receipts, integration: paths.integration, archive: paths.archive, testsStatus: e.tests_status, humanReview: e.human_review, approval: paths.approval, approvalTrustPolicy: paths.approvalTrust, testEvidence: paths.testEvidence, production: e.production, minPassRate: e.min_pass_rate, minDelta: e.min_delta, maxEfficiencyRegressions: e.efficiency?.max_regressions, missingEfficiencyTelemetry: e.efficiency?.missing_telemetry, reliability: { total_budget_ms: c.limits.total_budget_ms }, budgets: caps, telemetry: live.all(), resume: Boolean(c.cache?.resume) };
    let evaluated;
    try {
        evaluated = await fullEval(opts);
    }
    catch (error) {
        return fail("evaluation-failure", 1, error.message);
    }
    let archived;
    try {
        archived = archiveEvidence(paths.workspace, c, configHash, artifactHash, { preflight: preRun.stdout + preRun.stderr, full_eval: fullRun.stdout + fullRun.stderr });
    }
    catch (error) {
        return fail("evaluation-failure", 1, error.message);
    }
    const basis = { schema_version: "1.0", command: "ci-eval", archive: archived.archive, inventory: archived.inventory, full_eval: evaluated }, outcome = outcomeFromEvidence(basis);
    if (!outcome)
        return fail("evaluation-failure", 1, "full-eval returned inconsistent evidence");
    const result = sanitized({ ...basis, ...outcome }, c.host.required_credentials);
    if (c.cache?.enabled) {
        const binding = { config_sha256: configHash, artifact_sha256: artifactHash, inventory_sha256: archived.inventoryHash, result_sha256: hash(stable(result)) };
        const envelope = { schema_version: "1.0", binding, archive: archived.archive, inventory: archived.inventory, result };
        writeFileSync(join(paths.workspace, "ci-result.json"), JSON.stringify({ ...envelope, envelope_sha256: hash(stable(envelope)) }, null, 2) + "\n");
    }
    return result;
}
