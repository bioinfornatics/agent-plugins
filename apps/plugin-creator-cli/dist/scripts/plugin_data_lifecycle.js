import { mkdirSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
function safe(id) { if (!/^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/.test(id) || id.includes("..") || id.includes("--"))
    throw new Error("invalid plugin id"); return id; }
export function preparePluginData(base, pluginId) { const path = join(resolve(base), safe(pluginId)), existed = existsSync(path); mkdirSync(path, { recursive: true, mode: 0o700 }); return { pluginId, path, created: !existed, preserved: existed }; }
export function authoritativeMcpEnvironment(inherited, configured, pluginRoot, pluginData) { const env = {}; for (const [k, v] of Object.entries(inherited))
    if (v !== undefined)
        env[k] = v; Object.assign(env, configured ?? {}); env.PLUGIN_ROOT = resolve(pluginRoot); env.PLUGIN_DATA = resolve(pluginData); return env; }
export function uninstallPluginData(base, pluginId, remove = false) { const path = join(resolve(base), safe(pluginId)); if (!remove || !existsSync(path))
    return false; rmSync(path, { recursive: true, force: true }); return true; }
export function assertPersistentWriteTarget(path, pluginRoot, pluginData) { const p = resolve(path), root = resolve(pluginRoot), data = resolve(pluginData); if (p === root || p.startsWith(root + requireSeparator()))
    throw new Error("persistent runtime data must not be written inside the plugin package"); if (!(p === data || p.startsWith(data + requireSeparator())))
    throw new Error("persistent runtime data must stay inside PLUGIN_DATA"); }
function requireSeparator() { return process.platform === "win32" ? "\\" : "/"; }
