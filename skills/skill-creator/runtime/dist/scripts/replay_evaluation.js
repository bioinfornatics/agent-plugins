/** Trusted replay CLI boundary. Built-ins only: no candidate module imports before closure validation. */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
export function runtimeClosure(app, fs, path, crypto, safe = () => true) {
    const hashBytes = (b) => { if (!safe(b.toString("utf8")))
        throw Error("replay-sensitive-runtime-bytes"); return crypto.createHash("sha256").update(b).digest("hex"); };
    const regularPath = (p) => {
        if (!safe(p))
            throw Error("replay-sensitive-runtime-path");
        for (let x = path.resolve(p);; x = path.dirname(x)) {
            if (fs.existsSync(x) && fs.lstatSync(x).isSymbolicLink())
                throw Error("replay-unsafe-symlink");
            if (x === path.dirname(x))
                break;
        }
        return p;
    };
    const tree = (root) => {
        const entries = [];
        const walk = (p) => {
            regularPath(p);
            const s = fs.lstatSync(p);
            if (s.isDirectory())
                for (const n of fs.readdirSync(p).sort())
                    walk(path.join(p, n));
            else if (s.isFile())
                entries.push({ path: path.relative(root, p), sha256: hashBytes(fs.readFileSync(p)), mode: s.mode & 0o111 });
            else
                throw Error("replay-unsafe-file");
        };
        walk(root);
        return entries;
    };
    const manifests = [];
    for (let p = app;; p = path.dirname(p)) {
        const file = regularPath(path.join(p, "package.json"));
        manifests.push({ path: file, sha256: fs.existsSync(file) ? hashBytes(fs.readFileSync(file)) : null });
        if (p === path.dirname(p))
            break;
    }
    const manifestPath = regularPath(path.join(app, "package.json"));
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const modulesRoot = regularPath(path.join(app, "node_modules"));
    const names = fs.readdirSync(modulesRoot).sort();
    const declared = Object.keys(manifest.dependencies ?? {});
    // Installed projections omit the authoring dependency declaration: every contained module is production.
    const seeds = declared.length ? declared : names.filter(n => n !== ".bin" && !n.startsWith("."));
    const modules = [];
    const seen = new Set();
    const collect = (name, from) => {
        if (!/^(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+$/.test(name))
            throw Error("replay-unsafe-dependency");
        let candidate;
        for (let p = from;; p = path.dirname(p)) {
            const dir = path.join(p, "node_modules", name);
            if (fs.existsSync(dir)) {
                candidate = dir;
                break;
            }
            if (p === app || p === path.dirname(p))
                break;
        }
        if (!candidate || !candidate.startsWith(app + path.sep))
            throw Error("replay-missing-dependency");
        regularPath(candidate);
        if (seen.has(candidate))
            return;
        seen.add(candidate);
        const dependency = JSON.parse(fs.readFileSync(regularPath(path.join(candidate, "package.json")), "utf8"));
        modules.push({ root: candidate, files: tree(candidate) });
        for (const child of Object.keys(dependency.dependencies ?? {}).sort())
            collect(child, candidate);
        for (const child of Object.keys(dependency.optionalDependencies ?? {}).sort()) {
            // Optional modules may affect resolution; if present, they join the same closure.
            let present = false;
            for (let p = candidate;; p = path.dirname(p)) {
                if (fs.existsSync(path.join(p, "node_modules", child))) {
                    present = true;
                    break;
                }
                if (p === app || p === path.dirname(p))
                    break;
            }
            if (present)
                collect(child, candidate);
        }
    };
    for (const name of seeds.sort()) {
        if (name.startsWith("@") && !name.includes("/")) {
            for (const child of fs.readdirSync(regularPath(path.join(modulesRoot, name))).sort())
                collect(name + "/" + child, app);
        }
        else
            collect(name, app);
    }
    return { app, manifests, runtime: tree(path.join(app, "dist")), source: fs.existsSync(path.join(app, "scripts")) ? tree(path.join(app, "scripts")) : null,
        module_names: names, modules: modules.sort((a, b) => a.root.localeCompare(b.root)) };
}
export const REPLAY_USAGE = "Usage: skill-creator replay --recipe <file> --recipe-sha256 <expected digest> --format json\nReplay one frozen case pair into a fresh output; not a campaign, resume, or acceptance.";
export function replayExitCode(value) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 255)
        throw Error("replay-invalid-exit-code");
    return value;
}
export async function runReplayCli(args) {
    if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
        console.log(REPLAY_USAGE);
        return 0;
    }
    try {
        const values = {};
        for (let i = 0; i < args.length; i += 2) {
            const key = args[i], value = args[i + 1];
            if (!["--recipe", "--recipe-sha256", "--format"].includes(key) || key in values || !value || value.startsWith("--"))
                throw Error("replay-invalid-arguments");
            values[key] = value;
        }
        if (!values["--recipe"] || !/^[a-f0-9]{64}$/.test(values["--recipe-sha256"] ?? "") || (values["--format"] ?? "json") !== "json")
            throw Error("replay-invalid-arguments");
        if (process.env.NODE_OPTIONS || process.env.NODE_PATH)
            throw Error("replay-unsafe-runtime-environment");
        const regular = (p) => { for (let x = path.resolve(p);; x = path.dirname(x)) {
            if (fs.lstatSync(x).isSymbolicLink())
                throw Error("replay-unsafe-symlink");
            if (x === path.dirname(x))
                break;
        } return p; };
        const hash = (p) => crypto.createHash("sha256").update(fs.readFileSync(regular(p))).digest("hex");
        const recipePath = path.resolve(values["--recipe"]), digest = values["--recipe-sha256"];
        if (hash(recipePath) !== digest)
            throw Error("replay-recipe-drift");
        const recipe = JSON.parse(fs.readFileSync(recipePath, "utf8"));
        if (recipe.schema_version !== "isolated-replay-v1")
            throw Error("replay-invalid-recipe");
        const app = recipe.runtime.closure.app;
        const closure = runtimeClosure(app, fs, path, crypto);
        if (JSON.stringify(closure) !== JSON.stringify(recipe.runtime.closure) || process.version !== recipe.runtime.node_version || hash(process.execPath) !== recipe.runtime.node.sha256)
            throw Error("replay-runtime-drift");
        // Current launch code is trusted, but its static import closure must match the frozen CLI.
        // Candidate modules and dependencies are never evaluated until the full closure above matches.
        const current = path.dirname(fileURLToPath(import.meta.url));
        for (const name of ["cli.js", "cli_help.js", "runtime-dispatch.js", "replay_evaluation.js"]) {
            const entry = closure.runtime.find(f => f.path === "scripts/" + name);
            if (!entry || hash(path.join(current, name)) !== entry.sha256)
                throw Error("replay-cli-drift");
        }
        const module = await import(pathToFileURL(path.join(app, "dist/scripts/evaluation_replay.js")).href);
        const result = await module.replay(recipePath, digest);
        const code = replayExitCode(result.exit_code);
        console.log(JSON.stringify(result));
        return code;
    }
    catch (error) {
        const message = error?.message;
        const reason = /^replay-[a-z-]+$/.test(message) ? message : "replay-missing-prerequisite";
        console.error("Replay unavailable: " + reason);
        return 2;
    }
}
