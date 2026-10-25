#!/usr/bin/env node
// Validate a Goose/Open Plugins directory without installing it.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, isAbsolute, sep } from "node:path";
import { resolveContainedPath } from "./path_containment.js";
import { fileURLToPath } from "node:url";
const NAME_RE = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const HOOK_EVENTS = new Set([
    "SessionStart", "SessionEnd", "Stop", "UserPromptSubmit",
    "PreToolUse", "PostToolUse", "PostToolUseFailure",
    "BeforeReadFile", "AfterFileEdit", "BeforeShellExecution", "AfterShellExecution",
]);
const MANIFEST_KEYS = new Set(["$schema", "name", "version", "description", "author", "homepage", "repository", "license", "keywords", "extensions", "skills", "mcpServers"]);
const GOOSE_NAMESPACE = "io.github.bioinfornatics.agent-plugins.goose";
const CANONICAL_HOOKS_PATH = "extensions/io.github.bioinfornatics.agent-plugins.goose/hooks.json";
const HISTORICAL_GOOSE_NAMESPACE = "io.github.block.goose";
const HISTORICAL_HOOKS_PATH = "extensions/io.github.block.goose/hooks.json";
const PLACEHOLDER_LINE_RE = /^(?:\s*(?:#|\/\/|\/\*|\*)\s*)?(?:TODO|FIXME|TBD)\b(?:\s*[:—-]|\s+\S)/i;
const PLACEHOLDER_VALUE_RE = /^\s*(?:["']?[\w.-]+["']?\s*[:=]\s*["']?)(?:TODO|FIXME|TBD)\b/i;
const PLACEHOLDER_LIST_RE = /^\s*[-*+]\s+(?:TODO|FIXME|TBD)\b/i;
function containsUnresolvedPlaceholder(text) {
    return text.split(/\r?\n/).some((line) => PLACEHOLDER_LINE_RE.test(line) || PLACEHOLDER_VALUE_RE.test(line) || PLACEHOLDER_LIST_RE.test(line));
}
function pushOnce(errors, message) {
    if (!errors.includes(message))
        errors.push(message);
}
function containmentDiagnostic(label, result, expectedKind) {
    if (result.status === "unresolved-parent" && result.kind === "missing")
        return `${label}: missing`;
    if (!result.contained)
        return `${label}: path escapes plugin root (${result.status})`;
    if (result.kindOutcome === "missing")
        return `${label}: missing`;
    return `${label}: expected ${expectedKind} but found ${result.kind}`;
}
function discover(root, path, expectedKind, errors, label = path, reportMissing = false) {
    const result = resolveContainedPath(root, path, { expectedKind });
    const absent = result.kind === "missing" && (result.kindOutcome === "missing" || result.status === "unresolved-parent");
    if (absent && !reportMissing)
        return null;
    if (!result.contained || result.kindOutcome === "mismatch" || (reportMissing && absent)) {
        pushOnce(errors, containmentDiagnostic(label, result, expectedKind));
        return null;
    }
    return absent ? null : result;
}
function discoveredFile(root, path, errors, label = path, reportMissing = false) {
    const result = discover(root, path, "file", errors, label, reportMissing);
    return result?.resolvedPath ?? null;
}
function discoveredDirectory(root, path, errors, label = path, reportMissing = false) {
    const result = discover(root, path, "directory", errors, label, reportMissing);
    return result?.resolvedPath ?? null;
}
function readDiscoveredText(root, path, errors, label = path) {
    const resolved = discoveredFile(root, path, errors, label, true);
    if (!resolved)
        return null;
    try {
        return readFileSync(resolved, "utf-8");
    }
    catch (error) {
        pushOnce(errors, `${label}: could not read: ${error.message}`);
        return null;
    }
}
function loadJson(root, path, errors, label = path) {
    const text = readDiscoveredText(root, path, errors, label);
    if (text === null)
        return null;
    try {
        return JSON.parse(text);
    }
    catch (error) {
        errors.push(`${path}: invalid JSON: ${error.message}`);
        return null;
    }
}
function validName(name) {
    return NAME_RE.test(name) && !name.includes("--") && !name.includes("..") && name.length <= 64;
}
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validateComponentPath(value, context, errors) {
    if (!value.startsWith("./")) {
        errors.push(`${context}: component path must start with './': ${value}`);
    }
    const normalized = value.split(/[\\/]/);
    if (isAbsolute(value) || normalized.includes("..")) {
        errors.push(`${context}: component path must stay within the plugin: ${value}`);
    }
}
function componentPaths(value, context, errors) {
    if (value === null || value === undefined)
        return [];
    let values;
    if (typeof value === "string") {
        values = [value];
    }
    else if (Array.isArray(value)) {
        values = value;
    }
    else if (isPlainObject(value) && Object.keys(value).every((k) => ["paths", "exclusive"].includes(k))) {
        const raw = value.paths ?? [];
        values = typeof raw === "string" ? [raw] : raw;
        if (!Array.isArray(values) || !values.every((v) => typeof v === "string")) {
            errors.push(`${context}: paths must be a string or list of strings`);
            return [];
        }
        if ("exclusive" in value && typeof value.exclusive !== "boolean") {
            errors.push(`${context}: exclusive must be a boolean`);
        }
    }
    else {
        errors.push(`${context}: expected a path, list of paths, or paths/exclusive object`);
        return [];
    }
    if (!values.every((v) => typeof v === "string")) {
        errors.push(`${context}: component paths must be strings`);
        return [];
    }
    for (const item of values) {
        validateComponentPath(item, context, errors);
    }
    return values;
}
function parseFrontmatter(root, path, errors) {
    const text = readDiscoveredText(root, path, errors);
    if (text === null)
        return {};
    const lines = text.split(/\r?\n/);
    if (!lines.length || lines[0].trim() !== "---") {
        errors.push(`${path}: missing YAML frontmatter`);
        return {};
    }
    let end = -1;
    for (let i = 1; i < lines.length; i += 1) {
        if (lines[i].trim() === "---") {
            end = i;
            break;
        }
    }
    if (end === -1) {
        errors.push(`${path}: unclosed YAML frontmatter`);
        return {};
    }
    const data = {};
    let index = 1;
    while (index < end) {
        const line = lines[index];
        if (!line.trim() || line.trimStart().startsWith("#")) {
            index += 1;
            continue;
        }
        if (!line.includes(":")) {
            errors.push(`${path}: unsupported frontmatter line: ${line}`);
            index += 1;
            continue;
        }
        const colonIdx = line.indexOf(":");
        const key = line.slice(0, colonIdx).trim();
        let value = line.slice(colonIdx + 1).trim();
        if ([">", "|", ">-", "|-"].includes(value)) {
            const continuation = [];
            index += 1;
            while (index < end && /^( {2,}|\t)/.test(lines[index])) {
                continuation.push(lines[index].trim());
                index += 1;
            }
            data[key] = continuation.join(" ");
            continue;
        }
        data[key] = value.replace(/^["']|["']$/g, "");
        index += 1;
    }
    return data;
}
function validateSkill(root, path, errors) {
    const frontmatter = parseFrontmatter(root, path, errors);
    const name = frontmatter.name ?? "";
    const description = frontmatter.description ?? "";
    const parentDir = path.split(sep).slice(-2, -1)[0];
    if (!validName(name)) {
        errors.push(`${path}: name must be a valid lowercase plugin component name`);
    }
    else if (parentDir !== name) {
        errors.push(`${path}: directory '${parentDir}' must match skill name '${name}'`);
    }
    if (!description) {
        errors.push(`${path}: missing frontmatter description`);
    }
    if (description.length > 1024) {
        errors.push(`${path}: description exceeds 1024 characters`);
    }
    const text = readDiscoveredText(root, path, errors);
    if (text !== null && containsUnresolvedPlaceholder(text)) {
        errors.push(`${path}: unresolved placeholder (TODO, FIXME, or TBD)`);
    }
}
function validateMcpServer(name, server, context, root, errors) {
    if (!isPlainObject(server)) {
        errors.push(`${context}: MCP server '${name}' must be an object`);
        return;
    }
    const transport = server.type ?? ("command" in server ? "stdio" : undefined);
    if (!["stdio", "streamable-http", "sse"].includes(transport)) {
        errors.push(`${context}: MCP server '${name}' has an invalid transport type`);
        return;
    }
    if (transport === "stdio") {
        const command = server.command, args = server.args ?? [], env = server.env ?? {};
        if (typeof command !== "string" || !command.trim())
            errors.push(`${context}: MCP server '${name}' command must be non-empty for stdio`);
        if (!Array.isArray(args) || !args.every(a => typeof a === "string"))
            errors.push(`${context}: MCP server '${name}' args must be a list of strings`);
        if (!isPlainObject(env) || !Object.values(env).every(v => typeof v === "string"))
            errors.push(`${context}: MCP server '${name}' env must map strings to strings`);
        if ("cwd" in server && typeof server.cwd !== "string")
            errors.push(`${context}: MCP server '${name}' cwd must be a string`);
        if (typeof command === "string" && command.startsWith("${PLUGIN_ROOT}/")) {
            const relative = command.slice("${PLUGIN_ROOT}/".length).split(/\s/)[0];
            if (!discoveredFile(root, join(root, relative), errors, `${context}: MCP server '${name}' command`))
                errors.push(`${context}: MCP server '${name}' command does not exist: ${relative}`);
        }
        return;
    }
    const url = server.url;
    if (typeof url !== "string" || !url.trim())
        errors.push(`${context}: MCP server '${name}' url must be non-empty for ${transport}`);
    else
        try {
            const parsed = new URL(url);
            if (!["http:", "https:"].includes(parsed.protocol))
                throw new Error("must use http or https");
        }
        catch (error) {
            errors.push(`${context}: MCP server '${name}' url is invalid: ${error.message}`);
        }
    const headers = server.headers ?? {};
    if (!isPlainObject(headers) || !Object.values(headers).every(v => typeof v === "string"))
        errors.push(`${context}: MCP server '${name}' headers must map strings to strings`);
}
function validateMcpDocument(value, context, root, errors) {
    if (!isPlainObject(value)) {
        errors.push(`${context}: document must be an object`);
        return;
    }
    const servers = value.mcpServers;
    if (!isPlainObject(servers) || !Object.keys(servers).length) {
        errors.push(`${context}: mcpServers must be a non-empty object`);
        return;
    }
    for (const [name, server] of Object.entries(servers)) {
        validateMcpServer(name, server, context, root, errors);
    }
}
function validateManifestMcp(value, root, errors) {
    if (isPlainObject(value) && !Object.keys(value).every((k) => ["paths", "exclusive"].includes(k))) {
        for (const [name, server] of Object.entries(value)) {
            validateMcpServer(name, server, "plugin.json:mcpServers", root, errors);
        }
        return;
    }
    componentPaths(value, "plugin.json:mcpServers", errors);
}
function validateHooks(path, root, errors) {
    const document = loadJson(root, path, errors);
    if (!isPlainObject(document))
        return;
    const hooks = document.hooks;
    if (!isPlainObject(hooks)) {
        errors.push("hooks/hooks.json: top-level 'hooks' must be an object");
        return;
    }
    for (const [event, rules] of Object.entries(hooks)) {
        if (!HOOK_EVENTS.has(event)) {
            errors.push(`hooks/hooks.json: unsupported event '${event}'`);
        }
        if (!Array.isArray(rules)) {
            errors.push(`hooks/hooks.json: event '${event}' must map to a list`);
            continue;
        }
        rules.forEach((rule, index) => {
            const context = `hooks/hooks.json: ${event}[${index}]`;
            if (!isPlainObject(rule)) {
                errors.push(`${context} must be an object`);
                return;
            }
            const matcher = rule.matcher;
            if (matcher === "*") {
                errors.push(`${context}: matcher '*' is invalid regex; use '.*' or omit it`);
            }
            if (matcher !== undefined && matcher !== null) {
                if (typeof matcher !== "string") {
                    errors.push(`${context}: matcher must be a string`);
                }
                else {
                    try {
                        new RegExp(matcher);
                    }
                    catch (error) {
                        errors.push(`${context}: invalid matcher: ${error.message}`);
                    }
                }
            }
            const actions = rule.hooks;
            if (!Array.isArray(actions) || !actions.length) {
                errors.push(`${context}.hooks must be a non-empty list`);
                return;
            }
            actions.forEach((action, actionIndex) => {
                const actionContext = `${context}.hooks[${actionIndex}]`;
                if (!isPlainObject(action)) {
                    errors.push(`${actionContext} must be an object`);
                    return;
                }
                if ((action.type ?? "command") !== "command") {
                    errors.push(`${actionContext}: only command hooks are supported`);
                }
                const command = action.command;
                if (typeof command !== "string" || !command.trim()) {
                    errors.push(`${actionContext}: command must be a non-empty string`);
                }
                else if (command.includes("${PLUGIN_ROOT}/")) {
                    const relative = command.split("${PLUGIN_ROOT}/")[1].split(/\s/)[0].replace(/^["']|["']$/g, "");
                    if (!discoveredFile(root, join(root, relative), errors, `${actionContext}: referenced file`)) {
                        errors.push(`${actionContext}: referenced file does not exist: ${relative}`);
                    }
                }
                const timeout = action.timeout;
                if (timeout !== undefined && timeout !== null && (typeof timeout !== "number" || timeout <= 0)) {
                    errors.push(`${actionContext}: timeout must be a positive integer`);
                }
            });
        });
    }
}
function readDiscoveredDirectory(root, path, errors, label = path) {
    const resolved = discoveredDirectory(root, path, errors, label);
    if (!resolved)
        return null;
    try {
        return { path: resolved, names: readdirSync(resolved).sort() };
    }
    catch (error) {
        pushOnce(errors, `${label}: could not traverse: ${error.message}`);
        return null;
    }
}
function globSkillFiles(root, errors) {
    const listing = readDiscoveredDirectory(root, join(root, "skills"), errors, "skills");
    if (!listing)
        return [];
    const results = [];
    for (const entry of listing.names) {
        const skillMd = join(listing.path, entry, "SKILL.md");
        if (discoveredFile(root, skillMd, errors, `skills/${entry}/SKILL.md`))
            results.push(skillMd);
    }
    return results;
}
function walkFiles(root, current, out, errors, visited = new Set()) {
    const listing = readDiscoveredDirectory(root, current, errors);
    if (!listing || visited.has(listing.path))
        return;
    visited.add(listing.path);
    for (const entry of listing.names) {
        if ([".agents", ".beads", ".git", "__pycache__", "node_modules", "vendor", "evaluations"].includes(entry) || (entry.startsWith(".") && entry !== ".vscode"))
            continue;
        const full = join(listing.path, entry);
        const result = discover(root, full, "any", errors, full);
        if (!result)
            continue;
        if (result.kind === "directory")
            walkFiles(root, full, out, errors, visited);
        else if (result.kind === "file" && result.resolvedPath)
            out.push(result.resolvedPath);
    }
}
export function validate(root) {
    const errors = [];
    const warnings = [];
    const rootCheck = resolveContainedPath(root, root, { expectedKind: "directory" });
    if (!rootCheck.contained || rootCheck.kindOutcome !== "match") {
        return { errors: [`Not a directory: ${root}`], warnings };
    }
    root = rootCheck.resolvedPath;
    const manifestPath = join(root, "plugin.json");
    let manifest = null;
    if (!discoveredFile(root, manifestPath, errors, "plugin.json")) {
        errors.push("Missing plugin.json at plugin root");
    }
    else {
        manifest = loadJson(root, manifestPath, errors);
        if (isPlainObject(manifest)) {
            const unknown = Object.keys(manifest).filter((k) => !MANIFEST_KEYS.has(k));
            if (unknown.length) {
                warnings.push(`plugin.json: unrecognized fields preserved: ${unknown.sort().join(", ")}`);
            }
            for (const key of ["name", "version", "description"]) {
                if (typeof manifest[key] !== "string" || !manifest[key].trim()) {
                    errors.push(`plugin.json: ${key} must be a non-empty string`);
                }
            }
            const name = manifest.name ?? "";
            if (name && !validName(name)) {
                errors.push("plugin.json: name must be lowercase and contain only letters, numbers, dashes, and periods");
            }
            const rootName = root.split(sep).filter(Boolean).pop() ?? "";
            if (name && rootName !== name) {
                warnings.push(`Directory name '${rootName}' differs from plugin name '${name}'`);
            }
            const version = manifest.version ?? "";
            if (version && !SEMVER_RE.test(version)) {
                warnings.push("plugin.json: version does not look like semantic versioning");
            }
            if ("skills" in manifest) {
                componentPaths(manifest.skills, "plugin.json:skills", errors);
            }
            if ("mcpServers" in manifest) {
                validateManifestMcp(manifest.mcpServers, root, errors);
            }
        }
    }
    const skills = globSkillFiles(root, errors);
    for (const skill of skills) {
        validateSkill(root, skill, errors);
    }
    const legacyHooksPath = join(root, "hooks", "hooks.json");
    const canonicalHooksPath = join(root, ...CANONICAL_HOOKS_PATH.split("/"));
    const historicalHooksPath = join(root, ...HISTORICAL_HOOKS_PATH.split("/"));
    const hasLegacyHooks = Boolean(discoveredFile(root, legacyHooksPath, errors, "hooks/hooks.json"));
    const hasCanonicalHooks = Boolean(discoveredFile(root, canonicalHooksPath, errors, CANONICAL_HOOKS_PATH));
    const hasHistoricalHooks = Boolean(discoveredFile(root, historicalHooksPath, errors, HISTORICAL_HOOKS_PATH));
    const extensions = isPlainObject(manifest) && isPlainObject(manifest.extensions) ? manifest.extensions : {};
    const hasCanonicalEnvelope = GOOSE_NAMESPACE in extensions;
    const hasHistoricalEnvelope = HISTORICAL_GOOSE_NAMESPACE in extensions;
    if ([hasLegacyHooks, hasCanonicalHooks, hasHistoricalHooks].filter(Boolean).length > 1 || (hasCanonicalEnvelope && hasHistoricalEnvelope))
        errors.push("Ambiguous Goose hooks: multiple canonical or legacy layouts exist");
    else if (hasCanonicalHooks) {
        const extension = extensions[GOOSE_NAMESPACE];
        if (!isPlainObject(extension) || Object.keys(extension).some(key => !["version", "hooks"].includes(key)) || extension.version !== 1 || extension.hooks !== CANONICAL_HOOKS_PATH)
            errors.push(`plugin.json: invalid ${GOOSE_NAMESPACE} extension envelope`);
        else
            validateHooks(canonicalHooksPath, root, errors);
    }
    else if (hasHistoricalHooks) {
        const extension = extensions[HISTORICAL_GOOSE_NAMESPACE];
        if (!isPlainObject(extension) || extension.version !== 1 || extension.hooks !== HISTORICAL_HOOKS_PATH)
            errors.push(`plugin.json: invalid historical ${HISTORICAL_GOOSE_NAMESPACE} extension envelope`);
        warnings.push(`Historical Goose namespace ${HISTORICAL_GOOSE_NAMESPACE} detected; migrate to ${GOOSE_NAMESPACE}`);
        validateHooks(historicalHooksPath, root, errors);
    }
    else if (hasLegacyHooks) {
        warnings.push(`Legacy Goose hooks detected at hooks/hooks.json; migrate to ${CANONICAL_HOOKS_PATH}`);
        validateHooks(legacyHooksPath, root, errors);
    }
    else if (hasCanonicalEnvelope || hasHistoricalEnvelope) {
        errors.push("plugin.json declares a Goose hooks extension but its hooks document is missing");
    }
    const mcpPaths = [join(root, ".mcp.json"), join(root, "mcp.json")].filter((path) => discoveredFile(root, path, errors, path.slice(root.length + 1)));
    for (const mcpPath of mcpPaths)
        validateMcpDocument(loadJson(root, mcpPath, errors), mcpPath.slice(root.length + 1), root, errors);
    const manifestHasMcp = isPlainObject(manifest) && "mcpServers" in manifest;
    if (!skills.length && !hasLegacyHooks && !hasCanonicalHooks && !hasHistoricalHooks && !mcpPaths.length && !manifestHasMcp) {
        errors.push("Plugin contains no skills, hooks, or MCP servers");
    }
    const allFiles = [];
    walkFiles(root, root, allFiles, errors);
    const ignoredSuffixes = new Set([".png", ".jpg", ".jpeg", ".gif", ".zip", ".pyc"]);
    for (const path of allFiles) {
        const suffix = path.includes(".") ? path.slice(path.lastIndexOf(".")).toLowerCase() : "";
        if (ignoredSuffixes.has(suffix))
            continue;
        if (path.split(sep).pop() === "SKILL.md")
            continue;
        let text = "";
        try {
            const discovered = readDiscoveredText(root, path, errors);
            if (discovered === null)
                continue;
            text = discovered;
        }
        catch {
            continue;
        }
        if (containsUnresolvedPlaceholder(text)) {
            const relative = path.slice(root.length + 1);
            warnings.push(`Possible unresolved placeholder: ${relative}`);
        }
    }
    return { errors, warnings };
}
function main() {
    const [pluginDir] = process.argv.slice(2);
    if (!pluginDir) {
        console.error("usage: validate_goose_plugin.js <plugin_dir>");
        process.exit(2);
    }
    const root = resolve(pluginDir);
    const { errors, warnings } = validate(root);
    for (const warning of warnings)
        console.log(`WARNING: ${warning}`);
    if (errors.length) {
        for (const error of errors)
            console.log(`ERROR: ${error}`);
        process.exit(1);
    }
    console.log(`OK: ${root}`);
}
if (!import.meta.url.includes("/$bunfs/") && process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
    main();
}
