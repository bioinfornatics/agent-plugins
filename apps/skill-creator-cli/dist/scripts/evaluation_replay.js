/** Safe retained recipes and invocation receipts; never retains authentication homes or raw streams. */
import { existsSync, lstatSync, statSync, readdirSync, readFileSync, realpathSync, readlinkSync } from "node:fs";
import { resolve, join, dirname, delimiter, relative, extname, basename } from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { durableAtomicWrite } from "./durable_file.js";
import { runtimeClosure } from "./replay_evaluation.js";
import * as fsBuiltins from "node:fs";
import * as pathBuiltins from "node:path";
import * as cryptoBuiltins from "node:crypto";
const hash = (v) => createHash("sha256").update(v).digest("hex");
export function regular(input) {
    const path = resolve(input);
    for (let p = path;; p = dirname(p)) {
        if (existsSync(p) && lstatSync(p).isSymbolicLink())
            throw new Error("replay-unsafe-symlink");
        if (p === dirname(p))
            break;
    }
    return path;
}
export function inventory(root, safe = () => true) {
    regular(root);
    if (!safe(root))
        throw Error("replay-sensitive-inventory");
    const result = [];
    function walk(dir) {
        for (const n of readdirSync(dir).sort()) {
            const p = regular(join(dir, n)), s = lstatSync(p);
            if (s.isDirectory())
                walk(p);
            else if (s.isFile()) {
                const bytes = readFileSync(p);
                if (!safe(p) || !safe(bytes.toString("utf8")))
                    throw Error("replay-sensitive-inventory");
                result.push({ path: relative(root, p), sha256: hash(bytes), mode: s.mode & 0o111 });
            }
            else
                throw new Error("replay-unsafe-file");
        }
    }
    walk(root);
    return result;
}
export const replayFidelity = { level: "invocation+frozen-inputs", unbound: ["filesystem", "network", "auth", "native libraries"],
    guarantees_identical_result: false, benchmark_acceptance: false };
/** Screen before producing any public digest, including opaque binary strings and symlink targets. */
export function executableIdentity(command, env, cwd = process.cwd(), safe = () => true, safeBinary = bytes => safe(bytes.toString("utf8"))) {
    const usable = (p) => { try {
        const s = statSync(p);
        return s.isFile() && Boolean(s.mode & 0o111);
    }
    catch {
        return false;
    } };
    if (!safe(command))
        return { available: false, reason: "sensitive-executable-path" };
    const candidate = command.includes("/") ? resolve(cwd, command) : (env.PATH ?? "/usr/bin:/bin").split(delimiter).map(p => resolve(cwd, p || ".", command)).find(usable);
    if (!candidate || !existsSync(candidate))
        return { available: false, reason: "missing-executable" };
    try {
        const resolved = realpathSync(candidate), s = lstatSync(resolved);
        if (!safe(candidate) || !safe(resolved))
            return { available: false, reason: "sensitive-executable-path" };
        const seen = new Set();
        const screenLinks = (input) => {
            if (seen.has(input))
                return;
            seen.add(input);
            if (seen.size > 64)
                throw Error("unavailable-executable-symlink");
            for (let p = input;; p = dirname(p)) {
                if (!safe(p))
                    throw Error("sensitive-executable-path");
                if (lstatSync(p).isSymbolicLink()) {
                    const target = readlinkSync(p);
                    if (!safe(target))
                        throw Error("sensitive-executable-symlink");
                    screenLinks(resolve(dirname(p), target));
                }
                if (p === dirname(p))
                    break;
            }
        };
        screenLinks(candidate);
        if (!s.isFile() || !(s.mode & 0o111))
            return { available: false, reason: "not-executable" };
        const bytes = readFileSync(resolved);
        const magic = bytes.subarray(0, 4).toString("hex");
        const format = magic === "7f454c46" ? "elf" : ["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca"].includes(magic) ? "mach-o" : bytes.subarray(0, 2).toString() === "#!" ? "shebang" : "unknown";
        const native = format === "elf" || format === "mach-o";
        // Native protocol templates are not credentials. Known private bytes still fail
        // before hashing; strong token signatures remain a conservative additional gate.
        const strongToken = /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{12,})/.test(bytes.toString("utf8"));
        if (!(native ? safeBinary(bytes) && !strongToken : safe(bytes.toString("utf8"))))
            return { available: false, reason: "sensitive-executable-bytes" };
        return { available: true, requested: resolve(candidate), resolved, format,
            byte_screening: native ? "known-private-bytes+strong-token-signatures; generic protocol templates not confirmed credentials; no raw bytes retained" : "strict-source-heuristics+known-private-bytes",
            sha256: hash(bytes), executable_mode: s.mode & 0o111 };
    }
    catch (e) {
        const reason = e.message;
        return { available: false, reason: /^(?:sensitive|unavailable)-executable-[a-z-]+$/.test(reason) ? reason : "executable-identity-unavailable" };
    }
}
export function persist(path, value) {
    regular(path);
    durableAtomicWrite(path, JSON.stringify(value, null, 2) + "\n", 0o600);
}
const modulePath = fileURLToPath(import.meta.url);
/** Freeze the runtime and production dependency closure without executing candidate modules. */
function runtimeIdentity(safe = () => true, safeBinary) {
    const app = resolve(dirname(modulePath), "../..");
    const node = executableIdentity(process.execPath, process.env, process.cwd(), safe, safeBinary);
    if (!node.available)
        throw Error("replay-runtime-identity-unavailable");
    return { node, node_version: process.version,
        closure: runtimeClosure(app, fsBuiltins, pathBuiltins, cryptoBuiltins, safe) };
}
/** Bounded Node launcher closure, not a general JavaScript dependency interpreter.
 * Literal import/reexport/require edges, package manifests and complete runtime
 * package inventories are bound without importing code. Uncertain loaders fail safe.
 * Native bytes bind invocation only; external IO/auth/libraries remain explicitly unbound.
 * Shell and uncertain Node loaders remain unavailable, not automatic native launchers.
 */
function launcherClosure(launcher, safe = () => true, safeBinary) {
    const executable = executableIdentity(launcher[0], process.env, process.cwd(), safe, safeBinary);
    if (!executable.available)
        throw Error("replay-executable-identity-unavailable");
    if (process.platform === "win32")
        throw Error("replay-unsupported-platform");
    const node = executableIdentity(process.execPath, process.env, process.cwd(), safe, safeBinary);
    if (!node.available)
        throw Error("replay-runtime-identity-unavailable");
    if (executable.sha256 !== node.sha256) {
        if (["sh", "bash", "dash", "ash", "zsh", "ksh", "fish", "csh", "tcsh", "busybox"].includes(basename(String(executable.resolved))))
            throw Error("replay-unsupported-shell-launcher");
        if ((process.platform === "linux" && executable.format === "elf") || (process.platform === "darwin" && executable.format === "mach-o"))
            return { kind: "native-executable", policy: "executable bytes and format only; filesystem, network, auth and native libraries unbound" };
        throw Error("replay-unsupported-launcher");
    }
    const entry = launcher[1];
    if (!entry || entry.startsWith("-") || !/\.(?:mjs|cjs|js)$/.test(entry))
        throw Error("replay-unsupported-launcher");
    const files = new Map(), manifests = new Map(), packages = new Map(), resolutions = new Map();
    const builtins = new Set(builtinModules.map(n => n.replace(/^node:/, "")));
    const file = (input) => {
        const p = regular(input), stat = lstatSync(p);
        if (!stat.isFile())
            throw Error("replay-launcher-resource-not-file");
        const bytes = readFileSync(p);
        if (!safe(p) || !safe(bytes.toString("utf8")))
            throw Error("replay-sensitive-launcher-closure");
        files.set(p, { path: p, sha256: hash(bytes), mode: stat.mode & 0o111 });
        return p;
    };
    const bindParents = (input) => {
        for (let p = dirname(input);; p = dirname(p)) {
            const manifest = regular(join(p, "package.json"));
            if (!safe(manifest))
                throw Error("replay-sensitive-launcher-closure");
            if (existsSync(manifest))
                file(manifest);
            manifests.set(manifest, { path: manifest, sha256: existsSync(manifest) ? hash(readFileSync(manifest)) : null });
            if (p === dirname(p))
                break;
        }
    };
    const packageRoot = (name, from) => {
        if (!/^(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+$/.test(name))
            throw Error("replay-unsupported-package");
        for (let p = dirname(from);; p = dirname(p)) {
            const candidate = regular(join(p, "node_modules", name)), present = existsSync(candidate);
            if (!safe(candidate))
                throw Error("replay-sensitive-launcher-closure");
            resolutions.set(candidate, { path: candidate, present });
            if (present)
                return candidate;
            if (p === dirname(p))
                break;
        }
        throw Error("replay-missing-launcher-dependency");
    };
    const collectPackage = (name, from) => {
        const root = packageRoot(name, from);
        if (packages.has(root))
            return;
        const entries = inventory(root, safe);
        if (entries.some(entry => entry.path.endsWith(".node")))
            throw Error("replay-unsupported-native-addon");
        for (const entry of entries)
            file(join(root, entry.path));
        packages.set(root, { root, files: entries });
        const manifestPath = join(root, "package.json"), manifest = JSON.parse(readFileSync(file(manifestPath), "utf8"));
        bindParents(manifestPath);
        for (const child of Object.keys(manifest.dependencies ?? {}).sort())
            collectPackage(child, manifestPath);
        for (const child of Object.keys(manifest.optionalDependencies ?? {}).sort()) {
            try {
                collectPackage(child, manifestPath);
            }
            catch (e) {
                if (e.message !== "replay-missing-launcher-dependency")
                    throw e;
            }
        }
        // All package files are bound; module edges also bind external resolution and
        // undeclared dependencies. Unsupported package loaders make replay unavailable.
        for (const entry of entries)
            if (/\.(?:js|mjs|cjs)$/.test(entry.path))
                scan(join(root, entry.path));
    };
    const visited = new Set();
    const scan = (input) => {
        const p = regular(input);
        if (visited.has(p))
            return;
        visited.add(p);
        file(p);
        bindParents(p);
        if (extname(p) === ".json")
            return;
        if (!/\.(?:js|mjs|cjs)$/.test(p))
            throw Error("replay-unsupported-module");
        const source = readFileSync(p, "utf8");
        // Mask comments/string bodies while preserving offsets; inspect only code
        // loader keywords. Templates with interpolation are unsupported loader syntax.
        if (/`(?:\\.|[^`\\])*\$\{/.test(source))
            throw Error("replay-interpolated-template");
        const masked = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, m => " ".repeat(m.length));
        if (/\b(?:eval|createRequire|dlopen)\s*\(|\brequire\s*(?:\.|\[|=)|\bimport\s*\./.test(masked))
            throw Error("replay-unsupported-loader");
        for (const match of masked.matchAll(/\brequire\b/g)) {
            if (!/^\s*\(/.test(masked.slice(match.index + match[0].length)))
                throw Error("replay-unsupported-loader");
        }
        if (/\b(?:Function|module)\s*(?:\(|\.|\[)|\\u[0-9a-fA-F]{4}/.test(masked))
            throw Error("replay-unsupported-loader");
        const edges = [];
        for (const match of masked.matchAll(/\b(import|require)\s*\(/g)) {
            const suffix = source.slice(match.index + match[0].length), literal = suffix.match(/^\s*(['"])([^'"\\\r\n]+)\1\s*\)/);
            if (!literal)
                throw Error("replay-computed-module");
            edges.push(literal[2]);
        }
        for (const match of masked.matchAll(/\b(import|export)\b(?!\s*\()/g)) {
            const suffix = source.slice(match.index);
            const literal = suffix.match(/^(?:import\s*(['"])([^'"\\\r\n]+)\1|(?:import|export)\s+[^;]*?\bfrom\s*(['"])([^'"\\\r\n]+)\3)/);
            if (literal)
                edges.push(literal[2] ?? literal[4]);
            else if (match[1] === "import")
                throw Error("replay-unsupported-import");
        }
        for (const spec of edges) {
            if (builtins.has(spec.replace(/^node:/, "")))
                continue;
            if (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/")) {
                const target = resolve(dirname(p), spec);
                // Extensionless/directory resolution can shadow; fail closed instead.
                if (!/\.(?:mjs|cjs|js|json)$/.test(target))
                    throw Error("replay-unsupported-local-resolution");
                scan(target);
            }
            else {
                if (spec.startsWith("node:") || spec.includes(":") || spec.startsWith("#"))
                    throw Error("replay-unsupported-module");
                const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
                collectPackage(name, p);
            }
        }
    };
    scan(resolve(entry));
    const sorted = (map) => [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
    return { kind: "node-module-closure", policy: "literal-node-module-graph-and-package-inventory; computed loaders unsupported; filesystem, network, auth and native libraries unbound", files: sorted(files), manifests: sorted(manifests), packages: sorted(packages), resolutions: sorted(resolutions) };
}
export function retainRecipe(output, options, launcher, sourceHome, config, safe = () => true, safeBinary) {
    const executable = executableIdentity(launcher[0], process.env, process.cwd(), safe, safeBinary);
    if (!executable.available)
        return { available: false, reason: executable.reason, fidelity: replayFidelity };
    const argumentsFiles = launcher.slice(1).filter(p => p.includes("/") && existsSync(p)).map(p => {
        regular(p);
        const stat = lstatSync(p);
        if (!stat.isFile())
            throw new Error("replay-launcher-resource-not-file");
        const bytes = readFileSync(p);
        if (!safe(resolve(p)) || !safe(bytes.toString("utf8")))
            throw Error("replay-sensitive-launcher-resource");
        return { path: resolve(p), sha256: hash(bytes), mode: stat.mode & 0o111 };
    });
    let closure;
    try {
        closure = launcherClosure(launcher, safe, safeBinary);
    }
    catch (e) {
        const reason = e.message;
        return { available: false, reason: /^replay-[a-z-]+$/.test(reason) ? reason : "replay-launcher-closure-unavailable", fidelity: replayFidelity };
    }
    let runtime;
    try {
        runtime = runtimeIdentity(safe, safeBinary);
    }
    catch (e) {
        const reason = e.message;
        return { available: false, reason: /^replay-[a-z-]+$/.test(reason) ? reason : "replay-runtime-capture-unavailable", fidelity: replayFidelity };
    }
    const recipe = { fidelity: replayFidelity, launcher_closure: closure, arguments_files: argumentsFiles, schema_version: "isolated-replay-v1", original: output, options, source_home: sourceHome, config: config ?? null,
        launcher, executable, runtime, snapshots: inventory(join(output, "replay-inputs"), safe),
        authentication: "re-resolve current source configuration and inherited environment; only declared public runtime keys bound, other environment/auth/external dependencies unbound" };
    const path = join(output, "replay-recipe.json");
    if (!safe(path) || !safe(modulePath) || !safe(JSON.stringify(recipe)))
        throw Error("replay-sensitive-recipe");
    persist(path, recipe);
    const recipeDigest = hash(readFileSync(path));
    const cliPath = join(runtime.closure.app, "dist/scripts/cli.js");
    return { available: true, fidelity: replayFidelity, entrypoint: "skill-creator replay", cli_path: cliPath,
        command: "skill-creator replay --recipe " + JSON.stringify(path) + " --recipe-sha256 " + recipeDigest + " --format json",
        argv: ["skill-creator", "replay", "--recipe", path, "--recipe-sha256", recipeDigest, "--format", "json"],
        recipe: "replay-recipe.json", recipe_sha256: recipeDigest,
        module_hashes: runtime.closure.runtime.filter(f => f.path.startsWith("scripts/")).map(f => ({ path: f.path, sha256: f.sha256 })), authentication: recipe.authentication };
}
export async function replay(path, digest) {
    regular(path);
    const bytes = readFileSync(path);
    if (hash(bytes) !== digest)
        throw new Error("replay-recipe-drift");
    const r = JSON.parse(bytes.toString("utf8"));
    if (r.schema_version !== "isolated-replay-v1" || JSON.stringify(runtimeIdentity()) !== JSON.stringify(r.runtime))
        throw new Error("replay-runtime-drift");
    if (!r.executable.available || JSON.stringify(executableIdentity(r.launcher[0], process.env)) !== JSON.stringify(r.executable))
        throw new Error("replay-executable-drift");
    if (JSON.stringify(launcherClosure(r.launcher)) !== JSON.stringify(r.launcher_closure))
        throw new Error("replay-launcher-closure-drift");
    for (const file of r.arguments_files) {
        regular(file.path);
        const stat = lstatSync(file.path);
        if (!stat.isFile() || hash(readFileSync(file.path)) !== file.sha256 || (stat.mode & 0o111) !== file.mode)
            throw new Error("replay-launcher-resource-drift");
    }
    const inputs = join(regular(r.original), "replay-inputs");
    if (JSON.stringify(inventory(inputs)) !== JSON.stringify(r.snapshots))
        throw new Error("replay-snapshot-drift");
    regular(r.source_home);
    if (r.config)
        regular(r.config);
    const { runIsolatedEvaluation } = await import("./evaluation_isolated.js");
    return runIsolatedEvaluation({ ...r.options, sourceHome: r.source_home, config: r.config ?? undefined, targetHome: join(inputs, "home"), fixtures: r.options.fixtures ? join(inputs, "fixtures") : undefined,
        command: r.options.command, output: join(dirname(r.original), "replay-" + randomUUID()), runsPerQuery: 1, attemptKind: "replay", parent: { output: r.original, recipe_sha256: digest } });
}
