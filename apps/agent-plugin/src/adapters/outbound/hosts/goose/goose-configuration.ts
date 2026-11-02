import { chmod, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse, stringify } from "yaml";
import { contained, missing, privateDirectory, privateFile, regularFile, TREE_LIMIT } from "./private-files.ts";

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export interface GooseInfo { version: string; config: string; paths: string[]; logs?: string }
export function parseInfo(bytes: Buffer): GooseInfo {
  const text = bytes.toString("utf8").split(String.fromCharCode(27)).join("").replace(/\[[0-9;]*m/g, "");
  const version = text.match(/^\s*Version:\s*(\S+)\s*$/m)?.[1];
  const paths: string[] = [];
  let config: string | undefined;
  let configDirectory: string | undefined;
  let logs: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(Config (?:dir(?:ectory)?|yaml|file)|Sessions? (?:DB[^:]*|dir(?:ectory)?|storage)|Logs? (?:dir(?:ectory)?|file)):\s*(.*?)\s*$/i);
    if (!match) {
      const unknown = line.match(/^\s*[^:]+:\s*((?:\/|[A-Za-z]:[\\/]).*?)\s*$/);
      if (unknown?.[1]) paths.push(resolve(unknown[1].replace(/\s+missing\s*\(.*\)\s*$/, "").trim()));
      continue;
    }
    const label = match[1] ?? "";
    const path = (match[2] ?? "").replace(/\s+missing\s*\(.*\)\s*$/, "").trim();
    if (!isAbsolute(path)) throw new Error("Goose info reported an unsupported path");
    paths.push(resolve(path));
    if (/^Config (?:yaml|file)$/i.test(label)) config = resolve(path);
    if (/^Config dir/i.test(label)) configDirectory = resolve(path);
    if (/^Logs? dir/i.test(label)) logs = resolve(path);
  }
  if (!version || paths.length < 3 || (!config && !configDirectory)) throw new Error("Unsupported Goose info schema");
  return { version, config: config ?? join(configDirectory ?? "", "config.yaml"), paths, logs };
}
// Preserve functional auth/provider settings while removing ambient treatment/context and runtime overrides.
// These denylist filters do not exhaustively isolate inherited environment variables or OS access.
const contextKey = /hook|instruction|prompt|recipe|context|moim|slash_command|search_paths|allowlist|docs_root|extension.*(?:path|loader)|loaders?|path_root|^plugins$|^agents$|^skills$|^GOOSE_(?:EXTENSIONS|PROFILE|HINTS|ADDITIONAL_CONFIG_FILES|CONFIG.*|PLUGIN.*|AGENT.*)$/i;
const overrideKey = /^(?:HOME|USERPROFILE|XDG_.*|APPDATA|LOCALAPPDATA|TMPDIR|TMP|TEMP|NODE_OPTIONS|NODE_PATH|BUN_OPTIONS|BUN_PRELOAD|LD_.*|DYLD_.*|PYTHONPATH|PYTHONSTARTUP|RUBYOPT|PERL5OPT|ENV|BASH_ENV|ZDOTDIR)$/i;
const pathKey = /(?:^|_)(?:path|paths|file|files|dir|directory|root)(?:_|$)/i;
export function isolatedEnvironment(original: NodeJS.ProcessEnv, root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(original)) {
    if (contextKey.test(key) || overrideKey.test(key)) continue;
    if (/^GOOSE_/i.test(key) && pathKey.test(key)) continue;
    env[key] = value;
  }
  Object.assign(env, {
    HOME: join(root, "home"), USERPROFILE: join(root, "home"), XDG_CONFIG_HOME: join(root, "home", ".config"),
    XDG_DATA_HOME: join(root, "home", ".local", "share"), XDG_STATE_HOME: join(root, "home", ".local", "state"),
    XDG_CACHE_HOME: join(root, "cache"), XDG_RUNTIME_DIR: join(root, "runtime"),
    GOOSE_PATH_ROOT: join(root, "home"), APPDATA: join(root, "appdata"), LOCALAPPDATA: join(root, "localappdata"),
    TMPDIR: join(root, "tmp"), TMP: join(root, "tmp"), TEMP: join(root, "tmp"),
    CONTEXT_FILE_NAMES: "[]", GOOSE_DISABLE_SESSION_NAMING: "true",
  });
  return env;
}
export function secretStrings(value: unknown, destination: Set<string>, all = false): void {
  if (typeof value === "string" && all && value.length) destination.add(value);
  else if (Array.isArray(value)) for (const child of value) secretStrings(child, destination, all);
  else if (record(value)) for (const [key, child] of Object.entries(value)) {
    secretStrings(child, destination, all || /secret|token|password|credential|api[_-]?key|authorization|private[_-]?key/i.test(key));
  }
}
function rejectPaths(value: unknown, key = ""): void {
  if (contextKey.test(key)) return;
  if (pathKey.test(key)) throw new Error("Unsupported configuration path reference");
  if (typeof value === "string" && (/^(?:[~/\\]|[A-Za-z]:[\\/]|file:)/.test(value))) throw new Error("Unsupported configuration path reference");
  if (Array.isArray(value)) for (const child of value) rejectPaths(child);
  else if (record(value)) for (const [name, child] of Object.entries(value)) rejectPaths(child, name);
}
// Retained configuration cannot reference operator paths. Only known builtin/platform fields survive;
// reject unknown retained fields rather than silently importing a loader or external context.
function filterConfiguration(value: unknown): Record<string, unknown> {
  if (!record(value)) throw new Error("Goose configuration must be a mapping");
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (contextKey.test(key) || overrideKey.test(key)) continue;
    if (key === "extensions") {
      if (!record(item)) throw new Error("Unsupported extensions configuration");
      const extensions: Record<string, unknown> = {};
      for (const [name, extension] of Object.entries(item)) {
        if (!record(extension)) throw new Error("Unsupported extension configuration");
        if (extension.type !== "builtin" && extension.type !== "platform") continue;
        const safe: Record<string, unknown> = {};
        const fields = new Set(["type", "name", "enabled", "bundled", "timeout", "available_tools", "display_name", "description"]);
        for (const [field, child] of Object.entries(extension)) {
          if (contextKey.test(field)) continue;
          if (!fields.has(field)) throw new Error("Unsupported builtin/platform extension field");
          rejectPaths(child, field);
          safe[field] = child;
        }
        extensions[name] = safe;
      }
      result[key] = extensions;
    } else {
      rejectPaths(item, key);
      result[key] = stripContext(item);
    }
  }
  return result;
}
function stripContext(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripContext);
  if (!record(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !contextKey.test(key) && !overrideKey.test(key)).map(([key, child]) => [key, stripContext(child)]));
}
/** Explicit credential/config allowlist; no operator sessions, logs or prompt directories. */
export async function prepareConfiguration(source: GooseInfo, target: GooseInfo, root: string, secrets: Set<string>): Promise<void> {
  if (target.paths.some((path) => !contained(root, path)) || !contained(root, target.config)) throw new Error("Goose ignored private path overrides");
  const sourceDirectory = dirname(source.config);
  const targetDirectory = dirname(target.config);
  await privateDirectory(targetDirectory);
  let size = 0;
  for (const name of ["config.yaml", "secrets.yaml", "permission.yaml", "permissions/tool_permissions.json"]) {
    let bytes: Buffer;
    try { bytes = await regularFile(name === "config.yaml" ? source.config : join(sourceDirectory, name)); }
    catch (error) { if (missing(error)) continue; throw error; }
    size += bytes.length;
    if (size > TREE_LIMIT) throw new Error("Configuration size limit exceeded");
    let value: unknown;
    try { value = name.endsWith(".json") ? JSON.parse(bytes.toString("utf8")) : parse(bytes.toString("utf8"), { maxAliasCount: 50 }); }
    catch { throw new Error("Unable to parse private Goose configuration"); }
    // Register credentials before dropping config fields, so later evidence can still redact those values.
    // Only config.yaml is filtered; allowlisted secret/permission files retain their original bytes.
    secretStrings(value, secrets, name === "secrets.yaml");
    const output = name === "config.yaml" ? stringify(filterConfiguration(value)) : bytes;
    await privateFile(name === "config.yaml" ? target.config : join(targetDirectory, name), output);
  }
}

/** Explicitly enable the installed treatment; no operator plugin entries survive filtering. */
export async function enablePlugin(config: string, pluginRoot: string): Promise<void> {
  let value: unknown = {};
  try { value = parse((await regularFile(config)).toString("utf8"), { maxAliasCount: 50 }); }
  catch (error) { if (!missing(error)) throw error; }
  if (!record(value)) throw new Error("Unsupported private configuration");
  value.plugins = { [pluginRoot]: { enabled: true } };
  await writeFile(config, stringify(value), { mode: 0o600 });
  await chmod(config, 0o600);
}
