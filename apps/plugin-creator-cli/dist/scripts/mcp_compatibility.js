import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MCP_SCHEMA_ID } from "./validate_agent_plugin_schema.js";
const object = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function json(path) { try {
    return JSON.parse(readFileSync(path, "utf8"));
}
catch {
    return undefined;
} }
function normalize(servers) { if (!object(servers))
    return null; const output = {}; for (const [id, value] of Object.entries(servers)) {
    if (!object(value))
        return null;
    if (typeof value.type === "string")
        output[id] = value;
    else if (typeof value.command === "string")
        output[id] = { type: "stdio", ...value };
    else
        return null;
} return output; }
/** Models Goose dd8de0196 document deserialization: unknown fields are ignored and command is required. */
export function assessGooseMcpDocument(value) { if (!object(value) || !object(value.mcpServers))
    return { loadable: false, serverIds: [], diagnostics: ["mcpServers must be an object"] }; const serverIds = [], diagnostics = []; for (const [id, server] of Object.entries(value.mcpServers)) {
    if (!object(server) || typeof server.command !== "string")
        diagnostics.push("MCP server '" + id + "' is not loadable: current Goose requires command and has no remote transport mapping");
    else if (!server.command.trim())
        diagnostics.push("MCP server '" + id + "' is not loadable: command must not be empty");
    else
        serverIds.push(id);
} return { loadable: diagnostics.length === 0, serverIds, diagnostics }; }
function pathSelection(value) { if (typeof value === "string")
    return { paths: [value], exclusive: false }; if (Array.isArray(value) && value.every(item => typeof item === "string"))
    return { paths: value, exclusive: false }; if (object(value) && Object.keys(value).every(key => key === "paths" || key === "exclusive")) {
    const raw = value.paths ?? [], paths = typeof raw === "string" ? [raw] : raw;
    if (!Array.isArray(paths) || !paths.every(item => typeof item === "string"))
        return null;
    return { paths, exclusive: value.exclusive === true };
} return null; }
export function gooseMcpPaths(manifestMcp) { const selection = pathSelection(manifestMcp); if (!selection)
    return manifestMcp === undefined ? ["./.mcp.json"] : []; return [...(selection.exclusive ? [] : ["./.mcp.json"]), ...selection.paths].filter((path, index, all) => all.indexOf(path) === index); }
export function inspectLegacyMcp(root) {
    const manifest = json(join(root, "plugin.json")), portable = json(join(root, "mcp.json")), dot = json(join(root, ".mcp.json"));
    const manifestMcp = object(manifest) ? manifest.mcpServers : undefined, selection = pathSelection(manifestMcp), inline = manifestMcp !== undefined && selection === null, sources = [];
    if (dot !== undefined)
        sources.push("dot-mcp");
    if (manifestMcp !== undefined)
        sources.push("inline-manifest");
    if (portable !== undefined && selection?.paths.includes("./mcp.json")) {
        if (!selection.exclusive && dot !== undefined)
            return { status: "blocked", sources, diagnostics: ["Goose would activate both default .mcp.json and selected mcp.json; use an approved exclusive path."] };
        return { status: "portable", sources, diagnostics: ["Portable mcp.json is explicitly selected for Goose; only stdio entries with command are loadable."] };
    }
    if (portable !== undefined && dot !== undefined && manifestMcp === undefined)
        return { status: "legacy-compatible", sources, diagnostics: ["Governed dual artifacts: portable clients discover mcp.json while Goose defaults exclusively to .mcp.json."] };
    if (portable !== undefined && selection?.exclusive && selection.paths.length === 1 && selection.paths[0] === "./.mcp.json")
        return { status: "legacy-compatible", sources, diagnostics: ["Governed dual artifacts: Goose explicitly selects only .mcp.json."] };
    if (portable !== undefined && manifestMcp !== undefined)
        return { status: "blocked", sources, diagnostics: ["Portable and host MCP declarations have no single unambiguous Goose activation path."] };
    if (sources.length > 1)
        return { status: "blocked", sources, diagnostics: ["Both .mcp.json and inline/path plugin.json:mcpServers may activate duplicate servers."] };
    if (portable !== undefined)
        return { status: "portable", sources: [], diagnostics: [] };
    if (!sources.length)
        return { status: "absent", sources: [], diagnostics: [] };
    const source = sources[0], raw = source === "dot-mcp" && object(dot) ? dot.mcpServers : inline ? manifestMcp : undefined, normalized = normalize(raw);
    if (!normalized)
        return { status: "blocked", sources, diagnostics: ["Legacy MCP declaration cannot be mapped safely to portable closed server variants."] };
    return { status: "migratable", sources, diagnostics: ["Legacy MCP is nonportable; write proposedMcp to root mcp.json after explicit approval."], proposedMcp: { $schema: MCP_SCHEMA_ID, mcpServers: normalized } };
}
