/** Local, offline registry of Agent Plugins schema versions. */
import { join } from "node:path";
import { PORTABLE_SKILL_ROOT } from "./resource_paths.js";
const schemaId = (version, file) => `https://agent-plugins.org/schemas/${version}/${file}`;
function registration(version, status, active, isDefault = false) {
    return Object.freeze({
        version,
        specification: `Agent Plugins ${version}`,
        status,
        activeForValidation: active,
        activeForGeneration: active,
        isDefault,
        snapshotDirectory: join(PORTABLE_SKILL_ROOT, "references", `agent-plugins-${version}`),
        schemas: Object.freeze({
            manifest: Object.freeze({ id: schemaId(version, "plugin.schema.json"), file: "plugin.schema.json" }),
            mcp: Object.freeze({ id: schemaId(version, "mcp.schema.json"), file: "mcp.schema.json" }),
        }),
    });
}
export const DEFAULT_SCHEMA_VERSION = "1.0.0";
/** Includes recognized inactive versions so callers can distinguish drafts from unknown identifiers. */
export const SCHEMA_VERSION_REGISTRY = Object.freeze({
    "1.0.0": registration("1.0.0", "published", true, true),
    "1.1.0": registration("1.1.0", "draft", false),
});
export const SCHEMA_REGISTRY = SCHEMA_VERSION_REGISTRY;
export function getSchemaVersion(version = DEFAULT_SCHEMA_VERSION) {
    return SCHEMA_VERSION_REGISTRY[version];
}
export function getDefaultSchemaVersion() {
    return SCHEMA_VERSION_REGISTRY[DEFAULT_SCHEMA_VERSION];
}
export function getActiveSchemaVersions() {
    return Object.values(SCHEMA_VERSION_REGISTRY).filter(entry => entry.activeForValidation);
}
export function findSchemaIdentifier(identifier) {
    for (const version of Object.values(SCHEMA_VERSION_REGISTRY)) {
        for (const type of ["manifest", "mcp"]) {
            const schema = version.schemas[type];
            if (schema.id === identifier)
                return { version, type, schema };
        }
    }
    return undefined;
}
export function getSchemaPath(version, type) {
    return join(version.snapshotDirectory, version.schemas[type].file);
}
