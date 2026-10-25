// Shared validation for Goose/Open Plugins hooks.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { directoryOrMissing, regularFile } from "./containment.js";
export const GOOSE_NAMESPACE = "io.github.bioinfornatics.agent-plugins.goose";
export const GOOSE_ENVELOPE_VERSION = 1;
export const CANONICAL_HOOKS_PATH = "extensions/io.github.bioinfornatics.agent-plugins.goose/hooks.json";
export const LEGACY_HOOKS_PATH = "hooks/hooks.json";
export const HISTORICAL_GOOSE_NAMESPACE = "io.github.block.goose";
export const HISTORICAL_HOOKS_PATH = "extensions/io.github.block.goose/hooks.json";
export const GOOSE_NAMESPACE_ALIASES = new Set([HISTORICAL_GOOSE_NAMESPACE, "goose", "block.goose", "com.block.goose"]);
export const HOOK_EVENTS = new Set([
    "SessionStart",
    "SessionEnd",
    "Stop",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "BeforeReadFile",
    "AfterFileEdit",
    "BeforeShellExecution",
    "AfterShellExecution",
]);
export const BLOCKING_EVENTS = new Set(["PreToolUse", "Stop"]);
function loadJson(path, errors) {
    try {
        return JSON.parse(readFileSync(path, "utf-8"));
    }
    catch (error) {
        errors.push(`${path}: invalid JSON: ${error.message}`);
        return null;
    }
}
export function referencedPluginFile(command) {
    const marker = "${PLUGIN_ROOT}/";
    const index = command.indexOf(marker);
    if (index === -1)
        return null;
    const rest = command.slice(index + marker.length);
    const token = rest.split(/\s/)[0];
    return token.replace(/^['"]|['"]$/g, "");
}
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isValidRegex(pattern) {
    try {
        new RegExp(pattern);
        return true;
    }
    catch {
        return false;
    }
}
export function locateHooks(pluginRoot) {
    const errors = [];
    const warnings = [];
    let canonical, legacy, historical, hasCanonical, hasLegacy, hasHistorical;
    try {
        const c = regularFile(pluginRoot, CANONICAL_HOOKS_PATH, "Canonical hooks"), l = regularFile(pluginRoot, LEGACY_HOOKS_PATH, "Legacy hooks"), h = regularFile(pluginRoot, HISTORICAL_HOOKS_PATH, "Historical Goose hooks");
        canonical = c.path;
        legacy = l.path;
        historical = h.path;
        hasCanonical = c.exists;
        hasLegacy = l.exists;
        hasHistorical = h.exists;
    }
    catch (error) {
        errors.push(error.message);
        return { path: null, legacy: false, errors, warnings };
    }
    if ([hasCanonical, hasLegacy, hasHistorical].filter(Boolean).length > 1) {
        errors.push(`Ambiguous Goose hooks: multiple canonical or legacy layouts exist`);
        return { path: null, legacy: false, errors, warnings };
    }
    if (hasCanonical) {
        let mf;
        try {
            mf = regularFile(pluginRoot, "plugin.json", "plugin.json");
            if (!mf.exists)
                throw new Error("plugin.json: manifest is missing");
        }
        catch (error) {
            errors.push(error.message);
            return { path: canonical, legacy: false, errors, warnings };
        }
        const manifest = loadJson(mf.path, errors);
        const extension = isPlainObject(manifest) && isPlainObject(manifest.extensions)
            ? manifest.extensions[GOOSE_NAMESPACE] : undefined;
        if (!isPlainObject(extension) || Object.keys(extension).some(key => !["version", "hooks"].includes(key)) || extension.version !== GOOSE_ENVELOPE_VERSION || extension.hooks !== CANONICAL_HOOKS_PATH) {
            errors.push(`plugin.json: extensions.${GOOSE_NAMESPACE} must declare version ${GOOSE_ENVELOPE_VERSION} and hooks '${CANONICAL_HOOKS_PATH}'`);
        }
        if (isPlainObject(manifest) && isPlainObject(manifest.extensions)) {
            for (const alias of GOOSE_NAMESPACE_ALIASES)
                if (alias in manifest.extensions)
                    errors.push(`plugin.json: unsupported Goose namespace alias '${alias}'`);
        }
        return { path: canonical, legacy: false, errors, warnings };
    }
    if (hasHistorical) {
        const manifestFile = regularFile(pluginRoot, "plugin.json", "plugin.json");
        const manifest = manifestFile.exists ? loadJson(manifestFile.path, errors) : null;
        const extension = isPlainObject(manifest) && isPlainObject(manifest.extensions)
            ? manifest.extensions[HISTORICAL_GOOSE_NAMESPACE] : undefined;
        if (!isPlainObject(extension) || extension.version !== GOOSE_ENVELOPE_VERSION || extension.hooks !== HISTORICAL_HOOKS_PATH) {
            errors.push(`plugin.json: invalid historical ${HISTORICAL_GOOSE_NAMESPACE} extension envelope`);
        }
        warnings.push(`Historical Goose namespace detected at ${HISTORICAL_GOOSE_NAMESPACE}; migrate to ${GOOSE_NAMESPACE}`);
        return { path: historical, legacy: true, errors, warnings };
    }
    if (hasLegacy) {
        warnings.push(`Legacy Goose hooks detected at ${LEGACY_HOOKS_PATH}; migrate to ${CANONICAL_HOOKS_PATH}`);
        return { path: legacy, legacy: true, errors, warnings };
    }
    errors.push(`Missing hook configuration: ${CANONICAL_HOOKS_PATH}`);
    return { path: null, legacy: false, errors, warnings };
}
export function validateHooks(pluginRoot) {
    const located = locateHooks(pluginRoot);
    const errors = [...located.errors];
    const warnings = [...located.warnings];
    if (!located.path)
        return { errors, warnings };
    const path = located.path;
    const document = loadJson(path, errors);
    if (!isPlainObject(document)) {
        return { errors, warnings };
    }
    const documentKeys = Object.keys(document);
    if (documentKeys.length !== 1 || documentKeys[0] !== "hooks") {
        errors.push(`${path}: document must contain only the top-level 'hooks' field`);
    }
    const hooks = document.hooks;
    if (!isPlainObject(hooks) || Object.keys(hooks).length === 0) {
        errors.push(`${path}: 'hooks' must be a non-empty object`);
        return { errors, warnings };
    }
    for (const [event, rules] of Object.entries(hooks)) {
        if (!HOOK_EVENTS.has(event)) {
            errors.push(`Unsupported hook event: ${event}`);
        }
        if (!Array.isArray(rules) || rules.length === 0) {
            errors.push(`Event '${event}' must map to a non-empty list`);
            continue;
        }
        rules.forEach((rule, index) => {
            const context = `${event}[${index}]`;
            if (!isPlainObject(rule)) {
                errors.push(`${context}: rule must be an object`);
                return;
            }
            const unknownRule = Object.keys(rule).filter((k) => !["matcher", "hooks"].includes(k));
            if (unknownRule.length) {
                errors.push(`${context}: unsupported fields: ${unknownRule.sort().join(", ")}`);
            }
            const matcher = rule.matcher;
            if (matcher === "*") {
                errors.push(`${context}: matcher '*' is invalid regex; omit it or use '.*'`);
            }
            if (matcher !== undefined && matcher !== null) {
                if (typeof matcher !== "string") {
                    errors.push(`${context}: matcher must be a string`);
                }
                else if (!isValidRegex(matcher)) {
                    errors.push(`${context}: invalid matcher regex`);
                }
            }
            const actions = rule.hooks;
            if (!Array.isArray(actions) || actions.length === 0) {
                errors.push(`${context}: hooks must be a non-empty list`);
                return;
            }
            actions.forEach((action, actionIndex) => {
                const actionContext = `${context}.hooks[${actionIndex}]`;
                if (!isPlainObject(action)) {
                    errors.push(`${actionContext}: action must be an object`);
                    return;
                }
                const unknownAction = Object.keys(action).filter((k) => !["type", "command", "timeout"].includes(k));
                if (unknownAction.length) {
                    errors.push(`${actionContext}: unsupported fields: ${unknownAction.sort().join(", ")}`);
                }
                if ((action.type ?? "command") !== "command") {
                    errors.push(`${actionContext}: Goose currently supports only command actions`);
                }
                const command = action.command;
                if (typeof command !== "string" || !command.trim()) {
                    errors.push(`${actionContext}: command must be a non-empty string`);
                }
                else {
                    const relative = referencedPluginFile(command);
                    if (relative) {
                        try {
                            const rf = regularFile(pluginRoot, relative, actionContext);
                            if (!rf.exists)
                                errors.push(actionContext + ": referenced file does not exist: " + relative);
                        }
                        catch (error) {
                            errors.push(error.message);
                        }
                    }
                }
                const timeout = action.timeout;
                if (timeout !== undefined &&
                    timeout !== null &&
                    (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout <= 0)) {
                    errors.push(`${actionContext}: timeout must be a positive integer`);
                }
            });
        });
    }
    let scriptsDir = null;
    try {
        const checked = directoryOrMissing(pluginRoot, "scripts", "scripts directory");
        if (checked.exists)
            scriptsDir = checked.path;
    }
    catch (error) {
        errors.push(error.message);
    }
    if (scriptsDir) {
        for (const entry of readdirSync(scriptsDir)) {
            const scriptPath = join(scriptsDir, entry);
            let checked;
            try {
                const rf = regularFile(pluginRoot, "scripts/" + entry, "Hook script");
                if (!rf.exists)
                    continue;
                checked = rf.path;
            }
            catch (error) {
                errors.push(error.message);
                continue;
            }
            const suffix = entry.includes(".") ? entry.slice(entry.lastIndexOf(".")) : "";
            if ([".sh", ".bash", ".py"].includes(suffix)) {
                const text = readFileSync(checked, "utf-8");
                if (text.includes("TODO")) {
                    errors.push(`${scriptPath}: unresolved TODO placeholder`);
                }
                if ([".sh", ".bash"].includes(suffix) && !text.includes("cat")) {
                    warnings.push(`${scriptPath}: hook script may not read the JSON payload from stdin`);
                }
            }
        }
    }
    return { errors, warnings };
}
