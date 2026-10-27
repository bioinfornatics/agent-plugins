/** Private Goose configuration transport; this is discovery isolation, not a sandbox.
 * Never serialize the capture in reports: privateConfig, files and secrets are sensitive.
 */
import { chmodSync, closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import yaml from "js-yaml";
import { EvaluationSensitiveCapture, containsSensitiveValue } from "./evaluation_privacy.js";
import type { EvaluationSensitiveValue } from "./evaluation_privacy.js";
export interface EvaluationConfigCapture {
    publicConfig: string;
    privateConfig: string;
    /** Paths are relative to .config/goose; all ancillary bytes are private. */
    files: Array<{
        path: string;
        bytes: Buffer;
        secret: boolean;
    }>;
    directories: string[];
    secrets: string[];
    sensitiveValues: EvaluationSensitiveValue[];
    sourceConfigRoot: string;
    sourceHome: string;
    binding: string;
    /** Exact config keys eligible for environment overrides, without a provider whitelist. */
    environmentKeys: string[];
}
type Mapping = Record<string, unknown>;
const MAX_FILES = 2048, MAX_DEPTH = 32, MAX_FILE = 4 * 1024 * 1024, MAX_TOTAL = 64 * 1024 * 1024;
const CONFIG_ROOT = "__EVALUATION_GOOSE_CONFIG_ROOT__";
const fail = (code: string): never => { throw new Error(code); };
const mapping = (value: unknown): value is Mapping => value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && !Buffer.isBuffer(value);
const normalized = (key: string) => key.replace(/[^a-z0-9]/gi, "").toLowerCase();
function secretKey(key: string): boolean {
    const k = normalized(key);
    if (/(?:maxtokens|maxoutputtokens|maxinputtokens|tokenlimit|tokenizer|contexttokens|tokenbudget|tokensperminute)$/.test(k) || k === "tokens")
        return false;
    return /key|token|secret|password|credential|authorization|authentication/.test(k);
}
function forbiddenKey(key: string): boolean {
    const k = normalized(key);
    // Filter host discovery/context fields, not similarly named provider tuning parameters.
    return /^(?:extensions?|plugins?|prompts?|hints?|recipes?|memory|moim|searchpaths?|contextfiles?|contextpaths?|contextdirs?|contextsearch|context|contexts|skills|hooks|agents|instructions|systemmessage|dbussessionbusaddress|contextfilenames)$/.test(k)
        || /^goose.*(?:extension|plugin|prompt|hint|recipe|memory|moim|searchpath|contextfile|contextpath|contextdir|contextsearch|instructions|systemmessage)/.test(k);
}
function excluded(name: string): boolean {
    const n = name.toLowerCase();
    return new Set([".agents", ".goose", ".claude", ".git", "skills", "hooks", "prompts", "memory", "recipes", "plugins", "extensions", "hints", "mcp-apps-cache", "mcp-hermit", "harness-rewrite-snapshots", "recipe.old", "adversary.md", "permission.yaml", "permission.yml", "context", "contexts", "agents.md", "claude.md", ".goosehints"]).has(n)
        || /^(?:settings(?:[.-].*)?\.json|config.*\.ya?ml(?:[.~].*)?)$/.test(n) && n !== "config.yaml"
        || /(?:^|[._-])(?:hints?|prompts?|contexts?)(?:[._-]|$)/.test(n);
}
const runtime = (name: string) => /(?:^|[._-])(?:lock|locks|socket|sock)(?:$|[._-])/.test(name.toLowerCase());
/** Inspect ancestors without following a symlink. Error messages never contain paths or bytes. */
function checked(input: string, missing = false): string {
    if (!input || input.includes("\0"))
        return fail("evaluation-config-invalid-path");
    const path = resolve(input), root = parse(path).root;
    let current = root;
    for (const part of relative(root, path).split(/[\\/]/).filter(Boolean)) {
        current = join(current, part);
        let stat;
        try {
            stat = lstatSync(current);
        }
        catch (error) {
            if (missing && (error as NodeJS.ErrnoException).code === "ENOENT")
                return path;
            return fail("evaluation-config-unreadable-path");
        }
        if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
            return fail("evaluation-config-unsafe-path");
        if (current !== path && !stat.isDirectory())
            return fail("evaluation-config-invalid-parent");
    }
    return path;
}
function bytesAt(path: string): Buffer {
    let fd: number | undefined;
    try {
        fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const stat = fstatSync(fd);
        if (!stat.isFile())
            return fail("evaluation-config-unsafe-file");
        if (stat.size > MAX_FILE)
            return fail("evaluation-config-file-limit");
        const bytes = readFileSync(fd);
        if (bytes.length > MAX_FILE)
            return fail("evaluation-config-file-limit");
        return bytes;
    }
    catch {
        return fail("evaluation-config-unreadable-file");
    }
    finally {
        if (fd !== undefined)
            closeSync(fd);
    }
}
function loadConfig(bytes: Buffer): Mapping {
    try {
        const value = yaml.load(bytes.toString("utf8"), { schema: yaml.JSON_SCHEMA });
        if (value === undefined || value === null)
            return Object.create(null) as Mapping;
        if (!mapping(value))
            return fail("evaluation-config-invalid-yaml");
        return value;
    }
    catch {
        return fail("evaluation-config-invalid-yaml");
    }
}
function collectSensitiveString(value: string, secrets: EvaluationSensitiveCapture, definite = true): void {
    if (!value) return;
    secrets.record(value, definite ? "credential" : "opaque", definite ? "credential-body" : "opaque-config");
    const bearer = value.match(/\bBearer\s+([^\s"']+)/i);
    if (bearer?.[1]) secrets.record(bearer[1], "credential", "credential-body");
    if (/-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|CERTIFICATE)-----/.test(value))
        for (const line of value.split(/\r?\n/).map(x => x.trim()).filter(Boolean)) secrets.record(line, "credential", "credential-body");
}
function collect(value: unknown, secrets: EvaluationSensitiveCapture, all = false, depth = 0, ancestors = new Set<object>(), definite = false): void {
    if (depth > MAX_DEPTH)
        return fail("evaluation-config-value-depth");
    if (typeof value === "string") {
        if (all && value)
            {
            collectSensitiveString(value, secrets, definite || /-----BEGIN |\b(?:sk-|gh[pousr]_|Bearer\s)/.test(value));
            if (definite) secrets.record(value, "credential", "secret-key");
        }
        return;
    }
    if (definite && (typeof value === "number" || typeof value === "boolean"))
        secrets.record(String(value), "credential", "secret-key");
    if (value === null || typeof value !== "object")
        return;
    if (ancestors.has(value))
        return fail("evaluation-config-cyclic-yaml");
    ancestors.add(value);
    if (Array.isArray(value))
        for (const child of value)
            collect(child, secrets, all, depth + 1, ancestors, definite);
    else
        for (const [key, child] of Object.entries(value))
            collect(child, secrets, all || secretKey(key), depth + 1, ancestors, definite || secretKey(key));
    ancestors.delete(value);
}
/** Provider metadata is public only at recognized schema positions. Unknown fields stay opaque. */
function collectProviderMetadata(value: unknown, secrets: EvaluationSensitiveCapture): void {
    if (!mapping(value)) { collect(value, secrets, true); return; }
    const rootFields = new Set(["name", "engine", "display_name", "base_url", "base_path", "fast_model", "model_doc_link",
        "timeout_seconds", "supports_streaming", "requires_auth", "dynamic_models", "skip_canonical_filtering", "emit_clear_thinking"]);
    const modelFields = new Set(["name", "context_limit", "input_token_cost", "output_token_cost", "currency", "supports_cache_control", "reasoning", "reasoning_effort"]);
    const metadata = (key: string, child: unknown, fields: Set<string>) => {
        if (!fields.has(key) || child !== null && typeof child === "object") collect(child, secrets, true, 0, new Set<object>(), secretKey(key));
        // Credential-shaped values must remain protected even under a metadata label.
        else if (typeof child === "string" && (/-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|CERTIFICATE)-----/.test(child) || /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{12,}|Bearer\s+[^\s"']+)/.test(child))) collectSensitiveString(child, secrets);
    };
    for (const [key, child] of Object.entries(value)) {
        if (key === "models" && Array.isArray(child)) {
            for (const model of child) {
                if (!mapping(model)) { collect(model, secrets, true); continue; }
                for (const [k, v] of Object.entries(model)) {
                    if (k === "request_params" && mapping(v))
                        for (const [param, setting] of Object.entries(v)) metadata(param, setting, new Set(["reasoning_effort", "temperature", "max_tokens", "max_output_tokens", "top_p"]));
                    else metadata(k, v, modelFields);
                }
            }
        } else if (key === "headers" && mapping(child)) {
            for (const [k, v] of Object.entries(child)) metadata(k.toLowerCase(), v, new Set(["content-type", "accept", "api-version"]));
        } else if (key === "auth" && mapping(child)) {
            for (const [k, v] of Object.entries(child)) {
                if (k === "command" && typeof v === "string") continue;
                if ((k === "args" || k === "arguments") && Array.isArray(v)) {
                    let credential = false;
                    for (const arg of v) {
                        if (typeof arg !== "string") continue;
                        if (arg.startsWith("-")) {
                            const [flag, ...rest] = arg.split("=");
                            credential = /^(?:--?(?:api[-_]?key|access[-_]?token|token|secret|password|credential|authorization))$/i.test(flag);
                            if (rest.length) { if (credential) secrets.record(rest.join("="), "credential", "auth-argument"); else collect(rest.join("="), secrets, true); credential = false; }
                        } else { secrets.record(arg, credential ? "credential" : "opaque", "auth-argument"); credential = false; }
                    }
                } else metadata(k, v, new Set(["refresh_interval", "timeout_seconds"]));
            }
        } else metadata(key, child, rootFields);
    }
}
function merge(base: Mapping, overlay: Mapping, depth = 0): Mapping {
    if (depth > MAX_DEPTH)
        return fail("evaluation-config-value-depth");
    const out: Mapping = Object.assign(Object.create(null), base);
    for (const [key, value] of Object.entries(overlay))
        out[key] = mapping(value) && mapping(out[key]) ? merge(out[key] as Mapping, value, depth + 1) : value;
    return out;
}
function sanitize(value: unknown, home: string, root: string, secrets: EvaluationSensitiveCapture, publicOnly: boolean, depth = 0, providerSettings = false): unknown {
    if (depth > MAX_DEPTH)
        return fail("evaluation-config-value-depth");
    if (publicOnly && (typeof value === "number" || typeof value === "boolean") && containsSensitiveValue(String(value), secrets.provenance.filter(item => item.kind === "credential")))
        return undefined;
    if (typeof value === "string") {
        if (publicOnly && containsSensitiveValue(value, secrets.provenance))
            return undefined;
        return relocateReference(value, home, root);
    }
    if (Array.isArray(value))
        return value.map(v => sanitize(v, home, root, secrets, publicOnly, depth + 1, providerSettings)).filter(v => v !== undefined);
    if (!mapping(value))
        return value;
    const out: Mapping = Object.create(null);
    for (const key of Object.keys(value).sort()) {
        if (!providerSettings && forbiddenKey(key) || publicOnly && (secretKey(key) || containsSensitiveValue(key, secrets.provenance)))
            continue;
        if (publicOnly && key.includes(home)) continue;
        if (!publicOnly && (key === "auth" || secretKey(key) && !/(?:file|path|directory|dir)$/i.test(key))) { out[key] = value[key]; continue; }
        const child = sanitize(value[key], home, root, secrets, publicOnly, depth + 1, providerSettings || depth === 0 && (key === "providers" || key === "custom_providers"));
        if (child !== undefined)
            out[key] = child;
    }
    return out;
}
function relocateReference(value: string, home: string, root: string): string {
    const relocated = value.replaceAll(root + "/", CONFIG_ROOT + "/");
    const result = relocated === root ? CONFIG_ROOT : relocated;
    // External references remain valid host dependencies; private HOME is discovery isolation, not a sandbox.
    return result;
}
function relocateProvider(value: unknown, home: string, root: string, target: string, depth = 0): unknown {
    if (depth > MAX_DEPTH) return fail("evaluation-config-value-depth");
    if (Array.isArray(value)) return value.map(v => relocateProvider(v, home, root, target, depth + 1));
    if (!mapping(value)) return value;
    const out: Mapping = Object.create(null);
    for (const [key, child] of Object.entries(value)) {
        if (depth === 0 && forbiddenKey(key)) continue;
        if (key === "auth") { out[key] = child; continue; }
        const pathKey = /(?:^|_)(?:path|file|dir|directory|filename)$|^(?:certificate|cert|ca_bundle)$/i.test(key);
        if (typeof child === "string" && pathKey)
            out[key] = relocateReference(child, home, root).replaceAll(CONFIG_ROOT, target);
        else if (!secretKey(key)) out[key] = relocateProvider(child, home, root, target, depth + 1);
        else out[key] = child;
    }
    return out;
}
function dump(value: unknown): string { return yaml.dump(value, { noRefs: true, sortKeys: true, lineWidth: -1 }); }
export function captureEvaluationConfig(sourceHome: string, override?: string): EvaluationConfigCapture {
    if (!sourceHome || !isAbsolute(sourceHome))
        return fail("evaluation-config-invalid-home");
    const home = resolve(sourceHome), root = checked(join(home, ".config", "goose"), true);
    const files: EvaluationConfigCapture["files"] = [], directories: string[] = [], secrets = new EvaluationSensitiveCapture();
    let total = 0, fileCount = 0, defaultBytes: Buffer | undefined;
    const add = (bytes: Buffer) => {
        if (++fileCount > MAX_FILES || (total += bytes.length) > MAX_TOTAL)
            return fail("evaluation-config-copy-limit");
    };
    const walk = (dir: string, depth: number): void => {
        if (depth > MAX_DEPTH)
            return fail("evaluation-config-directory-depth");
        for (const name of readdirSync(dir).sort()) {
            const path = join(dir, name), stat = lstatSync(path);
            if (stat.isSymbolicLink())
                return fail("evaluation-config-symlink");
            if (runtime(name) || stat.isSocket())
                continue;
            if (!stat.isFile() && !stat.isDirectory())
                return fail("evaluation-config-special-file");
            if (excluded(name))
                continue;
            const rel = relative(root, path).replaceAll("\\", "/");
            if (stat.isDirectory()) {
                if (directories.length >= MAX_FILES)
                    return fail("evaluation-config-directory-limit");
                directories.push(rel);
                walk(path, depth + 1);
                continue;
            }
            const bytes = bytesAt(path);
            add(bytes);
            if (rel === "config.yaml") {
                defaultBytes = bytes;
                continue;
            }
            files.push({ path: rel, bytes, secret: true });
            // All ancillary files remain private; metadata classification affects redaction only.
            const raw = bytes.toString("utf8");
            let parsed: unknown;
            try { parsed = yaml.load(raw, { schema: yaml.JSON_SCHEMA }); }
            catch { parsed = undefined; }
            if (/^custom_providers\/[^/]+\.json(?:\.disabled)?$/.test(rel) && mapping(parsed)) {
                relocateProvider(parsed, home, root, CONFIG_ROOT);
                collectProviderMetadata(parsed, secrets);
                if (raw) secrets.add(raw);
            } else {
                if (raw) {
                    collectSensitiveString(raw, secrets, /(?:^|[\/._-])(?:secrets?|credentials?)(?:[\/._-]|$)/i.test(rel));
                    for (const line of raw.split(/\r?\n/).map(x => x.trim()).filter(Boolean)) {
                        collectSensitiveString(line, secrets, /(?:^|[\/._-])(?:secrets?|credentials?)(?:[\/._-]|$)/i.test(rel));
                        const entry = line.match(/^[^=:]+[=:]\s*(.+)$/);
                        if (entry?.[1]) collectSensitiveString(entry[1].trim(), secrets, secretKey(line.split(/[=:]/)[0]));
                    }
                }
                collect(parsed, secrets, true, 0, new Set<object>(), /(?:^|[\/._-])(?:secrets?|credentials?)(?:[\/._-]|$)/i.test(rel));
            }
        }
    };
    let rootExists = true;
    try {
        if (!lstatSync(root).isDirectory())
            return fail("evaluation-config-invalid-root");
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
            rootExists = false;
        else
            return fail("evaluation-config-invalid-root");
    }
    if (rootExists) {
        try {
            walk(root, 0);
        }
        catch (error) {
            if (error instanceof Error && error.message.startsWith("evaluation-config-"))
                throw error;
            return fail("evaluation-config-unreadable-tree");
        }
    }
    let config = defaultBytes ? loadConfig(defaultBytes) : Object.create(null) as Mapping;
    collect(config, secrets);
    if (override !== undefined) {
        const bytes = bytesAt(checked(override));
        add(bytes);
        const overlay = loadConfig(bytes);
        collect(overlay, secrets);
        config = merge(config, overlay);
    }
    const privateValue = sanitize(config, home, root, secrets, false) as Mapping;
    const publicValue = sanitize(config, home, root, secrets, true) as Mapping;
    const extensions = Object.create(null) as Mapping;
    const allowed = new Set(["developer", "summon", "code_execution", "analyze", "skills"]);
    if (mapping(config.extensions)) for (const [id, entry] of Object.entries(config.extensions)) {
        if (mapping(entry) && typeof entry.name === "string" && allowed.has(entry.name)
            && (entry.type === "builtin" || entry.type === "platform")) extensions[id] = entry;
    }
    if (Object.keys(extensions).length) {
        privateValue.extensions = extensions;
        publicValue.extensions = sanitize(extensions, home, root, secrets, true, 1, true);
    }
    privateValue.plugins = Object.create(null);
    publicValue.plugins = Object.create(null);
    const publicConfig = dump(publicValue);
    return { publicConfig, privateConfig: dump(privateValue), files, directories, secrets: [...secrets].sort((a, b) => b.length - a.length),
        sensitiveValues: secrets.provenance, sourceConfigRoot: root, sourceHome: home,
        binding: createHash("sha256").update(publicConfig).digest("hex"),
        environmentKeys: Object.keys(privateValue).filter(key => /^[A-Z][A-Z0-9_]*$/.test(key)) };
}
function privateDirectory(path: string): void {
    checked(path, true);
    mkdirSync(path, { recursive: true, mode: 0o700 });
    checked(path);
    chmodSync(path, 0o700);
}
function safeRelative(path: string): string {
    if (!path || isAbsolute(path) || path.includes("\\") || path.includes("\0") || path.split("/").some(part => !part || part === "." || part === ".."))
        return fail("evaluation-config-invalid-relative-path");
    return path;
}
export function stageEvaluationConfig(capture: EvaluationConfigCapture, runHome: string, plugins: string[]): void {
    const home = checked(runHome, true);
    // GOOSE_PATH_ROOT takes precedence over XDG in Goose Paths::config_dir().
    // Keep the XDG copy for hosts without that override, with independent relocated paths.
    stageConfigRoot(capture, home, plugins, join(home, "config"));
    stageConfigRoot(capture, home, plugins, join(home, ".config", "goose"));
}
function stageConfigRoot(capture: EvaluationConfigCapture, home: string, plugins: string[], root: string): void {
    privateDirectory(home);
    privateDirectory(join(home, ".config"));
    privateDirectory(root);
    for (const dir of capture.directories ?? [])
        privateDirectory(join(root, safeRelative(dir)));
    for (const file of capture.files) {
        const rel = safeRelative(file.path);
        if (rel === "config.yaml" || rel.split("/").some(excluded))
            return fail("evaluation-config-forbidden-file");
        const target = join(root, rel);
        privateDirectory(dirname(target));
        checked(target, true);
        let bytes = file.bytes;
        if (/^custom_providers\/[^/]+\.json(?:\.disabled)?$/.test(rel)) {
            try {
                const parsed: unknown = JSON.parse(bytes.toString("utf8"));
                if (mapping(parsed)) bytes = Buffer.from(JSON.stringify(relocateProvider(parsed, capture.sourceHome, capture.sourceConfigRoot, root)));
            } catch (error) {
                if (error instanceof Error && error.message.startsWith("evaluation-config-")) throw error;
            }
        }
        writeFileSync(target, bytes, { mode: 0o600, flag: "wx" });
    }
    const config = loadConfig(Buffer.from(capture.privateConfig));
    const entries: Mapping = Object.create(null);
    for (const plugin of plugins) {
        const path = isAbsolute(plugin) ? resolve(plugin) : join(home, ".agents", "plugins", plugin);
        const rel = relative(join(home, ".agents", "plugins"), path);
        if (!rel || isAbsolute(rel) || rel.startsWith("..") || rel.split(/[\\/]/).length !== 1 || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(rel))
            return fail("evaluation-config-unsafe-plugin");
        checked(path, true);
        entries[path] = { enabled: true };
    }
    config.plugins = entries;
    const target = join(root, "config.yaml");
    checked(target, true);
    writeFileSync(target, dump(materializeConfig(config, root)), { mode: 0o600, flag: "wx" });
}

/** Placeholder expansion is structural, never a substitution over serialized secret bytes. */
function materializeConfig(value: unknown, root: string, depth = 0): unknown {
    if (depth > MAX_DEPTH) return fail("evaluation-config-value-depth");
    if (typeof value === "string") return value === CONFIG_ROOT ? root : value.replaceAll(CONFIG_ROOT + "/", root + "/");
    if (Array.isArray(value)) return value.map(v => materializeConfig(v, root, depth + 1));
    if (!mapping(value)) return value;
    const out: Mapping = Object.create(null);
    for (const [key, child] of Object.entries(value))
        out[key] = key === "auth" || secretKey(key) && !/(?:file|path|directory|dir)$/i.test(key) ? child : materializeConfig(child, root, depth + 1);
    return out;
}
