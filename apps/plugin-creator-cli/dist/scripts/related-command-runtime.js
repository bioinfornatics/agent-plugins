import { existsSync, lstatSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { portableSkillPath } from "./resource_paths.js";
const HERE = dirname(fileURLToPath(import.meta.url));
export const isNativeRuntime = import.meta.url.includes("/$bunfs/");
/** Resolve a generated related Node CLI without consulting PATH, NODE_PATH, or repository apps. */
export function resolveRelatedCommand(name) {
    if (isNativeRuntime)
        throw new Error("native runtime must dispatch related commands in-process");
    const emittedRuntimeRoot = resolve(HERE, "../..");
    const localSkillRuntime = portableSkillPath("runtime");
    const runtimeRoot = existsSync(join(emittedRuntimeRoot, "related-command-map.json")) ? emittedRuntimeRoot : localSkillRuntime;
    const mapPath = join(runtimeRoot, "related-command-map.json");
    if (!existsSync(mapPath))
        throw new Error(`Related-command map is missing at ${mapPath}. Regenerate or reinstall the plugin-creator Skill runtime.`);
    let value;
    try {
        value = JSON.parse(readFileSync(mapPath, "utf8"));
    }
    catch (error) {
        throw new Error(`Related-command map is invalid JSON at ${mapPath}: ${error.message}`);
    }
    const map = value;
    if (map.schemaVersion !== 1 || !map.commands || typeof map.commands !== "object" || Array.isArray(map.commands))
        throw new Error(`Related-command map at ${mapPath} has an unsupported shape or version.`);
    const mapped = map.commands[name];
    if (typeof mapped !== "string" || isAbsolute(mapped) || mapped.split(/[\\/]/).some(part => !part || part === "." || part === ".."))
        throw new Error(`Related command '${name}' is not mapped to a contained runtime entry in ${mapPath}.`);
    const entry = resolve(runtimeRoot, ...mapped.split("/")), rel = relative(runtimeRoot, entry);
    if (rel === "" || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
        throw new Error(`Related command '${name}' escapes the plugin-creator Skill runtime.`);
    const stat = lstatSync(entry, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.isSymbolicLink())
        throw new Error(`Related command '${name}' runtime is incomplete: expected a plain file at ${entry}. Regenerate or reinstall the Skill.`);
    return entry;
}
/** Native builds retain their in-process handler; source Node executes the contained mapped CLI. */
export function runRelatedCommand(name, args, nativeHandler) {
    if (isNativeRuntime)
        return nativeHandler();
    const entry = resolveRelatedCommand(name);
    const result = spawnSync(process.execPath, [entry, ...args], { encoding: "utf8", env: process.env });
    return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: (result.stderr ?? "") + (result.error ? result.error.message : "") };
}
