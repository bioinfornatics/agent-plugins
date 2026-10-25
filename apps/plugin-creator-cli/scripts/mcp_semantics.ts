import { accessSync, constants, realpathSync } from "node:fs";
import { validateHeaderName, validateHeaderValue } from "node:http";
import { resolve } from "node:path";
import { resolveContainedPath, type PathContainmentResult } from "./path_containment.js";

export type McpSemanticCategory = "semantic" | "strict-policy";

export interface McpSemanticFinding {
  serverId: string;
  path: string;
  code: string;
  rule: string;
  severity: "error";
  category: McpSemanticCategory;
  message: string;
  remediation: string;
  details?: Record<string, unknown>;
}

export interface McpSemanticOptions {
  pluginRoot: string;
  pluginData: string;
  /** Override host behavior when validating manifests intended for Windows. */
  windowsSemantics?: boolean;
}

export interface ExpandedStdioConfiguration {
  args?: string[];
  env?: Record<string, string>;
  cwd: string;
}

export interface McpServerSemanticResult {
  serverId: string;
  type?: string;
  valid: boolean;
  policyValid: boolean;
  semanticFindings: McpSemanticFinding[];
  strictPolicyFindings: McpSemanticFinding[];
  /** Expanded runtime fields. Command is deliberately never expanded. */
  expanded?: ExpandedStdioConfiguration;
}

export interface McpSemanticResult {
  valid: boolean;
  policyValid: boolean;
  servers: McpServerSemanticResult[];
}

const PLUGIN_ROOT = "${PLUGIN_ROOT}";
const PLUGIN_DATA = "${PLUGIN_DATA}";
const RECOGNIZED_PLACEHOLDER = /\$\{(PLUGIN_ROOT|PLUGIN_DATA)\}/g;

/** Performs one non-recursive pass. Unknown placeholder-like text stays literal. */
export function expandPluginPlaceholders(value: string, pluginRoot: string, pluginData: string): string {
  return value.replace(RECOGNIZED_PLACEHOLDER, (_match, name: string) => name === "PLUGIN_ROOT" ? pluginRoot : pluginData);
}

function diagnostic(serverId: string, path: string, code: string, rule: string, message: string,
  remediation: string, category: McpSemanticCategory = "semantic", details?: Record<string, unknown>): McpSemanticFinding {
  return { serverId, path, code, rule, severity: "error", category, message, remediation, ...(details ? { details } : {}) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containmentDiagnostic(serverId: string, path: string, field: string, result: PathContainmentResult): McpSemanticFinding {
  return diagnostic(serverId, path, "mcp.path.not-contained", "Agent Plugins 1.1 §§4.1, 7.2.1",
    `${field} is not safely contained in its required root (${result.status}).`,
    `Keep ${field} inside the selected root and remove traversals or escaping filesystem links.`, "semantic", { containment: result });
}

function commandFindings(serverId: string, value: unknown, pluginRoot: string): McpSemanticFinding[] {
  const path = `/mcpServers/${serverId}/command`;
  if (typeof value !== "string" || value.length === 0) return [diagnostic(serverId, path, "mcp.stdio.command-invalid", "Agent Plugins 1.1 §7.2.1",
    "stdio command must be a non-empty executable token.", "Use one bare executable name or a path beginning with './'.")];
  if (/\$\{|\$\(/.test(value) || value.includes("`")) return [diagnostic(serverId, path, "mcp.stdio.command-expansion-forbidden", "Agent Plugins 1.1 §7.2.1",
    "Expansion syntax is forbidden in command.", "Use './path/to/executable' or a bare name; put variable text in args.")];
  if (/\s|[;&|<>"'\u0000-\u001f]/u.test(value)) return [diagnostic(serverId, path, "mcp.stdio.command-not-single-token", "Agent Plugins 1.1 §7.2.1",
    "stdio command contains shell or token separators.", "Move arguments to args and keep command as one executable token.")];
  if (value.startsWith("./")) {
    const result = resolveContainedPath(pluginRoot, value.slice(2), { expectedKind: "file" });
    if (!result.contained) return [containmentDiagnostic(serverId, path, "command", result)];
    if (result.kindOutcome !== "match" || !result.resolvedPath) return [diagnostic(serverId, path, "mcp.stdio.command-not-file", "Agent Plugins 1.1 §7.2.1",
      "Plugin-relative command does not resolve to an existing file.", "Package the executable file beneath the plugin root.", "semantic", { containment: result })];
    if (process.platform !== "win32") {
      try { accessSync(result.resolvedPath, constants.X_OK); }
      catch { return [diagnostic(serverId, path, "mcp.stdio.command-not-executable", "Agent Plugins 1.1 §7.2.1",
        "Plugin-relative command is not executable.", "Set the executable file mode on the bundled command.")]; }
    }
    return [];
  }
  if (value.includes("/") || value.includes("\\") || value === "." || value === "..") return [diagnostic(serverId, path, "mcp.stdio.command-invalid-form", "Agent Plugins 1.1 §7.2.1",
    "stdio command is neither a bare name nor a './' plugin-relative path.", "Use a bare name or prefix a bundled path with './'.")];
  return [];
}

function cwdResult(serverId: string, value: unknown, pluginRoot: string, pluginData: string): { findings: McpSemanticFinding[]; expanded: string } {
  const path = `/mcpServers/${serverId}/cwd`;
  if (value === undefined) return { findings: [], expanded: pluginRoot };
  const invalid = () => diagnostic(serverId, path, "mcp.stdio.cwd-invalid-form", "Agent Plugins 1.1 §7.2.1",
    "cwd is not plugin-relative, PLUGIN_ROOT-rooted, or PLUGIN_DATA-rooted.", "Use './...', '${PLUGIN_ROOT}/...', or '${PLUGIN_DATA}/...'.");
  if (typeof value !== "string") return { findings: [invalid()], expanded: pluginRoot };
  let root: string;
  let expanded: string;
  if (value.startsWith("./")) { root = pluginRoot; expanded = resolve(pluginRoot, value.slice(2)); }
  else if (value === PLUGIN_ROOT || value.startsWith(PLUGIN_ROOT + "/")) { root = pluginRoot; expanded = expandPluginPlaceholders(value, pluginRoot, pluginData); }
  else if (value === PLUGIN_DATA || value.startsWith(PLUGIN_DATA + "/")) { root = pluginData; expanded = expandPluginPlaceholders(value, pluginRoot, pluginData); }
  else return { findings: [invalid()], expanded: value };
  const result = resolveContainedPath(root, expanded, { expectedKind: "directory" });
  if (!result.contained) return { findings: [containmentDiagnostic(serverId, path, "cwd", result)], expanded };
  if (result.kindOutcome !== "match") return { findings: [diagnostic(serverId, path, "mcp.stdio.cwd-not-directory", "Agent Plugins 1.1 §7.2.1",
    "cwd does not resolve to an existing directory.", "Create the working directory inside the selected root before launch.", "semantic", { containment: result })], expanded };
  return { findings: [], expanded: result.resolvedPath ?? expanded };
}

function reservedEnvFindings(serverId: string, env: unknown, windows: boolean): McpSemanticFinding[] {
  if (!isObject(env)) return [];
  const reserved = new Set(["PLUGIN_ROOT", "PLUGIN_DATA"]);
  return Object.keys(env).flatMap(name => {
    if (!reserved.has(windows ? name.toUpperCase() : name)) return [];
    return [diagnostic(serverId, `/mcpServers/${serverId}/env/${name}`, "mcp.stdio.reserved-env", "Agent Plugins 1.1 §§9.1–9.2",
      `Configured env must not define reserved name ${name}.`, "Remove it; the client supplies PLUGIN_ROOT and PLUGIN_DATA.")];
  });
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") return true;
  const octets = host.split(".");
  return octets.length === 4 && octets.every(part => /^\d+$/.test(part) && Number(part) <= 255) && Number(octets[0]) === 127;
}

function remoteFindings(serverId: string, server: Record<string, unknown>): McpSemanticFinding[] {
  const findings: McpSemanticFinding[] = [];
  const path = `/mcpServers/${serverId}/url`;
  if (typeof server.url !== "string") return [diagnostic(serverId, path, "mcp.remote.url-invalid", "Agent Plugins 1.1 §7.2.1", "Remote MCP URL must be a string.", "Set an absolute HTTP or HTTPS URL.")];
  let url: URL;
  try { url = new URL(server.url); } catch { return [diagnostic(serverId, path, "mcp.remote.url-invalid", "Agent Plugins 1.1 §7.2.1", "Remote MCP URL is not absolute and valid.", "Set an absolute HTTP or HTTPS URL.")]; }
  if (url.protocol !== "http:" && url.protocol !== "https:") findings.push(diagnostic(serverId, path, "mcp.remote.url-scheme", "Agent Plugins 1.1 §7.2.1", "Remote MCP URL must use HTTP or HTTPS.", "Use HTTPS, or HTTP only for loopback."));
  if (url.username || url.password) findings.push(diagnostic(serverId, path, "mcp.remote.url-userinfo", "Agent Plugins 1.1 §7.2.1", "Remote MCP URL must not contain user information.", "Remove URL credentials and use client-managed authorization."));
  if (url.hash) findings.push(diagnostic(serverId, path, "mcp.remote.url-fragment", "Agent Plugins 1.1 §7.2.1", "Remote MCP URL must not contain a fragment.", "Remove the fragment."));
  if (url.protocol === "http:" && !isLoopback(url.hostname)) findings.push(diagnostic(serverId, path, "mcp.remote.http-non-loopback", "Agent Plugins 1.1 §7.2.1", "Plain HTTP is allowed only for localhost or an IPv4/IPv6 loopback literal.", "Use HTTPS for non-loopback endpoints."));
  if (server.headers !== undefined && isObject(server.headers)) {
    const seen = new Map<string, string>();
    for (const [name, value] of Object.entries(server.headers)) {
      const headerPath = `/mcpServers/${serverId}/headers/${name}`;
      let validName = true;
      try { validateHeaderName(name); } catch { validName = false; findings.push(diagnostic(serverId, headerPath, "mcp.remote.header-name-invalid", "Agent Plugins 1.1 §7.2.1", "Invalid HTTP header name.", "Use an RFC-compatible HTTP field name.")); }
      if (typeof value !== "string") findings.push(diagnostic(serverId, headerPath, "mcp.remote.header-value-invalid", "Agent Plugins 1.1 §7.2.1", "HTTP header value must be a string.", "Use a valid HTTP field value string."));
      else try { validateHeaderValue(validName ? name : "x-header", value); } catch { findings.push(diagnostic(serverId, headerPath, "mcp.remote.header-value-invalid", "Agent Plugins 1.1 §7.2.1", "Invalid HTTP header value.", "Remove invalid control characters.")); }
      const folded = name.toLowerCase();
      const previous = seen.get(folded);
      if (previous !== undefined) findings.push(diagnostic(serverId, headerPath, "mcp.remote.header-duplicate", "Agent Plugins 1.1 §7.2.1", `Header duplicates ${previous} under case-insensitive comparison.`, "Keep only one spelling of each header name."));
      else seen.set(folded, name);
    }
  }
  return findings;
}

const LIKELY_SECRET_NAME = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|apikey|token|access-token|secret|client-secret|password)$/i;

/** Non-portable strict authoring policy, kept separate from semantic conformance. */
export function validateMcpStrictPolicy(serverId: string, server: unknown): McpSemanticFinding[] {
  if (!isObject(server)) return [];
  const fields: Array<["env" | "headers", unknown]> = [["env", server.env], ["headers", server.headers]];
  return fields.flatMap(([field, entries]) => !isObject(entries) ? [] : Object.keys(entries).flatMap(name => !LIKELY_SECRET_NAME.test(name) ? [] : [
    diagnostic(serverId, `/mcpServers/${serverId}/${field}/${name}`, "mcp.policy.likely-fixed-secret", "Agent Plugins 1.1 §§7.2.1, 9.2 (strict authoring policy)",
      `Fixed ${field} entry '${name}' is likely to contain a secret.`, "Remove packaged credentials and use client-managed authorization or secret storage.", "strict-policy"),
  ]));
}

export function validateMcpServerSemantics(serverId: string, server: unknown, options: McpSemanticOptions): McpServerSemanticResult {
  const semanticFindings: McpSemanticFinding[] = [];
  const type = isObject(server) && typeof server.type === "string" ? server.type : undefined;
  let expanded: ExpandedStdioConfiguration | undefined;
  if (!isObject(server)) semanticFindings.push(diagnostic(serverId, `/mcpServers/${serverId}`, "mcp.server.invalid", "Agent Plugins 1.1 §7.2.1", "MCP server entry must be an object.", "Replace it with a valid transport configuration."));
  else if (type === "stdio") {
    const unknown = Object.keys(server).filter(key => !["type", "command", "args", "env", "cwd"].includes(key));
    if (unknown.length) semanticFindings.push(diagnostic(serverId, `/mcpServers/${serverId}`, "mcp.server.unknown-fields", "Agent Plugins 1.1 §7.2.1", `Unknown stdio fields: ${unknown.join(", ")}.`, "Remove fields outside the closed stdio variant."));
    if (server.args !== undefined && (!Array.isArray(server.args) || !server.args.every(value => typeof value === "string"))) semanticFindings.push(diagnostic(serverId, `/mcpServers/${serverId}/args`, "mcp.stdio.args-invalid", "Agent Plugins 1.1 §7.2.1", "args must be an array of strings.", "Use a string array."));
    if (server.env !== undefined && (!isObject(server.env) || !Object.values(server.env).every(value => typeof value === "string"))) semanticFindings.push(diagnostic(serverId, `/mcpServers/${serverId}/env`, "mcp.stdio.env-invalid", "Agent Plugins 1.1 §7.2.1", "env must map names to string values.", "Use an object of strings."));
    semanticFindings.push(...commandFindings(serverId, server.command, options.pluginRoot));
    semanticFindings.push(...reservedEnvFindings(serverId, server.env, options.windowsSemantics ?? process.platform === "win32"));
    const cwd = cwdResult(serverId, server.cwd, options.pluginRoot, options.pluginData);
    semanticFindings.push(...cwd.findings);
    expanded = {
      ...(Array.isArray(server.args) && server.args.every(value => typeof value === "string") ? { args: server.args.map(value => expandPluginPlaceholders(value, options.pluginRoot, options.pluginData)) } : {}),
      ...(isObject(server.env) && Object.values(server.env).every(value => typeof value === "string") ? { env: Object.fromEntries(Object.entries(server.env).map(([name, value]) => [name, expandPluginPlaceholders(value as string, options.pluginRoot, options.pluginData)])) } : {}),
      cwd: cwd.expanded,
    };
  } else if (type === "streamable-http" || type === "sse") {
    const unknown = Object.keys(server).filter(key => !["type", "url", "headers"].includes(key));
    if (unknown.length) semanticFindings.push(diagnostic(serverId, `/mcpServers/${serverId}`, "mcp.server.unknown-fields", "Agent Plugins 1.1 §7.2.1", `Unknown remote fields: ${unknown.join(", ")}.`, "Remove fields outside the closed remote variant."));
    if (server.headers !== undefined && !isObject(server.headers)) semanticFindings.push(diagnostic(serverId, `/mcpServers/${serverId}/headers`, "mcp.remote.headers-invalid", "Agent Plugins 1.1 §7.2.1", "headers must be an object of string values.", "Use an object of HTTP fields."));
    semanticFindings.push(...remoteFindings(serverId, server));
  }
  else semanticFindings.push(diagnostic(serverId, `/mcpServers/${serverId}/type`, "mcp.server.unsupported-type", "Agent Plugins 1.1 §7.2.1", "Unknown MCP transport type.", "Use stdio, streamable-http, or sse."));
  const strictPolicyFindings = validateMcpStrictPolicy(serverId, server);
  return { serverId, type, valid: semanticFindings.length === 0, policyValid: strictPolicyFindings.length === 0, semanticFindings, strictPolicyFindings, ...(expanded ? { expanded } : {}) };
}

/** Validates every server independently and returns structured per-server findings. */
export function validateMcpSemantics(configuration: unknown, options: McpSemanticOptions): McpSemanticResult {
  const normalized = { ...options, pluginRoot: realpathSync(options.pluginRoot), pluginData: realpathSync(options.pluginData) };
  const entries = isObject(configuration) && isObject(configuration.mcpServers) ? configuration.mcpServers : {};
  const servers = Object.entries(entries).map(([id, server]) => validateMcpServerSemantics(id, server, normalized));
  return { valid: servers.every(server => server.valid), policyValid: servers.every(server => server.policyValid), servers };
}

export const validateMcpSemanticConfiguration = validateMcpSemantics;
