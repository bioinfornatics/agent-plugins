#!/usr/bin/env node
/** Offline, registry-driven Agent Plugins manifest/MCP validator. */
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadRuntimeDependency } from "./runtime-deps.js";
import { resolveContainedPath } from "./path_containment.js";
import { findSchemaIdentifier, getActiveSchemaVersions, getDefaultSchemaVersion, getSchemaPath } from "./schema_registry.js";
import { EMBEDDED_SCHEMAS } from "./embedded_resources.js";
const AjvModule = loadRuntimeDependency("ajv/dist/2020.js");
const Ajv2020 = AjvModule.default ?? AjvModule;
const DEFAULT_SCHEMA = getDefaultSchemaVersion();
export const PLUGIN_SCHEMA_ID = DEFAULT_SCHEMA.schemas.manifest.id;
export const MCP_SCHEMA_ID = DEFAULT_SCHEMA.schemas.mcp.id;
const object = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function registration(type) { return { version: DEFAULT_SCHEMA, type, schema: DEFAULT_SCHEMA.schemas[type] }; }
function validator(r) { const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true }); const versions = EMBEDDED_SCHEMAS; return ajv.compile(versions[r.version.version][r.type]); }
function diagnostics(errors) { return (errors ?? []).map(e => ({ path: e.instancePath || "/", keyword: e.keyword, message: e.message ?? "schema violation", params: e.params, severity: "error" })); }
function infer(path, value, requested) { if (requested !== "auto")
    return requested; if (object(value) && typeof value.$schema === "string")
    return findSchemaIdentifier(value.$schema)?.type ?? (basename(path) === "mcp.json" ? "mcp" : "manifest"); return basename(path) === "mcp.json" ? "mcp" : "manifest"; }
function unsupported(identifier) { const supportedVersions = getActiveSchemaVersions().map(x => x.version), found = typeof identifier === "string" ? findSchemaIdentifier(identifier) : undefined; return found ? { path: "/$schema", keyword: "unsupported-version", message: "Agent Plugins schema version " + found.version.version + " is recognized as " + found.version.status + " but inactive; supported versions: " + supportedVersions.join(", "), params: { identifier, version: found.version.version, status: found.version.status, recognized: true, supportedVersions }, severity: "error" } : { path: "/$schema", keyword: "unsupported-version", message: "Unsupported Agent Plugins schema identifier: " + String(identifier) + "; supported versions: " + supportedVersions.join(", "), params: { identifier, recognized: false, supportedVersions }, severity: "error" }; }
function prepareManifest(value, mode) { if (mode !== "portable-load" || !object(value))
    return { value, ignored: [] }; const copy = { ...value }, ignored = []; const allowed = new Set(["$schema", "name", "version", "description", "author", "homepage", "repository", "license", "keywords", "extensions"]); for (const key of Object.keys(copy))
    if (!allowed.has(key)) {
        ignored.push({ path: "/" + key, keyword: "ignored-unknown-field", message: "Unknown top-level manifest field is ignored during portable loading", params: { field: key }, severity: "warning" });
        delete copy[key];
    } if ("extensions" in copy && !object(copy.extensions)) {
    ignored.push({ path: "/extensions", keyword: "ignored-invalid-extensions", message: "Non-object extensions field is ignored during portable loading", params: {}, severity: "warning" });
    delete copy.extensions;
} return { value: copy, ignored }; }
export function validateSchemaValue(value, type, file, mode = "strict-authoring") { const id = object(value) ? value.$schema : undefined, found = typeof id === "string" ? findSchemaIdentifier(id) : undefined, fallback = registration(type), schema = { id: fallback.schema.id, source: getSchemaPath(fallback.version, type) }; if (found && found.type !== type)
    return { file, type, valid: false, schema, ignored: [], errors: [{ path: "/$schema", keyword: "schema-type-mismatch", message: "Declared schema is for " + found.type + " but document was requested as " + type, params: { declaredType: found.type, requestedType: type }, severity: "error" }] }; if (id !== undefined && (!found || !found.version.activeForValidation))
    return { file, type, valid: false, schema, ignored: [], errors: [unsupported(id)] }; const selected = found ?? fallback, prepared = type === "manifest" ? prepareManifest(value, mode) : { value, ignored: [] }; const check = validator(selected), valid = Boolean(check(prepared.value)); return { file, type, valid, schema: { id: selected.schema.id, source: getSchemaPath(selected.version, type) }, errors: diagnostics(check.errors), ignored: prepared.ignored }; }
function readContained(target, type, root, mode = "strict-authoring") { const file = resolve(target), fallback = registration(type), schema = { id: fallback.schema.id, source: getSchemaPath(fallback.version, type) }; if (root) {
    const c = resolveContainedPath(root, file, { expectedKind: "file" });
    if (!c.contained || c.kindOutcome !== "match")
        return { file, type, valid: false, schema, ignored: [], errors: [{ path: "/", keyword: "filesystem-containment", message: "Document is missing, wrong-kind, or resolves outside plugin root (" + c.status + ")", params: { status: c.status, kind: c.kind }, severity: "error" }] };
} let value; try {
    value = JSON.parse(readFileSync(file, "utf8"));
}
catch (e) {
    return { file, type, valid: false, schema, ignored: [], errors: [{ path: "/", keyword: "parse", message: e.message, params: {}, severity: "error" }] };
} return validateSchemaValue(value, type, file, mode); }
export function validateAgentPluginSchema(targetArg, requested = "auto", mode = "strict-authoring") { const target = resolve(targetArg), files = []; const rootCheck = resolveContainedPath(target, target, { expectedKind: "directory" }); if (rootCheck.contained && rootCheck.kindOutcome === "match") {
    const root = rootCheck.resolvedPath;
    const manifest = resolve(root, "plugin.json"), mc = resolve(root, "mcp.json");
    for (const [path, type] of [[manifest, "manifest"], [mc, "mcp"]]) {
        const c = resolveContainedPath(root, path, { expectedKind: "file" });
        const missing = c.kind === "missing" && (c.kindOutcome === "missing" || c.status === "unresolved-parent");
        if (!missing)
            files.push({ path, type });
    }
    if (!files.length)
        return { valid: false, specification: DEFAULT_SCHEMA.specification, mode, documents: [], errors: [{ path: "/", keyword: "discovery", message: "No plugin.json or mcp.json found", params: { target }, severity: "error" }], warnings: [] };
    const documents = files.map(x => readContained(x.path, x.type, root, mode));
    return aggregate(documents, mode);
} const type = requested === "mcp" ? "mcp" : "manifest"; const direct = resolveContainedPath(resolve(target, ".."), target, { expectedKind: "file" }); if (!direct.contained || direct.kindOutcome !== "match")
    return { valid: false, specification: DEFAULT_SCHEMA.specification, mode, documents: [], errors: [{ path: "/", keyword: "filesystem", message: "Target does not exist or is not a regular contained file", params: { target }, severity: "error" }], warnings: [] }; let raw; try {
    raw = JSON.parse(readFileSync(direct.resolvedPath, "utf8"));
}
catch { } const inferred = raw === undefined ? type : infer(target, raw, requested); return aggregate([readContained(target, inferred, resolve(target, ".."), mode)], mode); }
function aggregate(documents, mode) { const errors = documents.flatMap(d => d.errors.map(e => ({ ...e, path: d.file + e.path }))), warnings = documents.flatMap(d => d.ignored.map(e => ({ ...e, path: d.file + e.path }))); return { valid: documents.every(d => d.valid), specification: DEFAULT_SCHEMA.specification, mode, documents, errors, warnings }; }
function text(r) { return [...r.documents.map(d => (d.valid ? "VALID: " : "INVALID: ") + d.file + " (" + d.type + ")"), ...r.warnings.map(e => "WARNING: " + e.path + ": " + e.message), ...r.errors.map(e => "ERROR: " + e.path + ": " + e.message)].join("\n"); }
function main() { const { positionals, values } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: { type: { type: "string", default: "auto" }, mode: { type: "string", default: "strict-authoring" }, format: { type: "string", default: "text" }, quiet: { type: "boolean", short: "q", default: false } } }); if (!positionals[0] || !["auto", "manifest", "mcp"].includes(String(values.type)) || !["portable-load", "strict-authoring"].includes(String(values.mode)) || !["text", "json"].includes(String(values.format))) {
    console.error("usage: validate_agent_plugin_schema.js <file-or-directory> [--type auto|manifest|mcp] [--mode portable-load|strict-authoring] [--format text|json] [--quiet]");
    process.exit(2);
} const r = validateAgentPluginSchema(positionals[0], values.type, values.mode); if (!values.quiet)
    console.log(values.format === "json" ? JSON.stringify(r, null, 2) : text(r)); process.exit(r.valid ? 0 : 1); }
if (!import.meta.url.includes("/$bunfs/") && process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]))
    main();
