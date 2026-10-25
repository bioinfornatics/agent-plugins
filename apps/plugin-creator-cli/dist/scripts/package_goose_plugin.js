#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { loadRuntimeDependency } from "./runtime-deps.js";
import { collectPackageFiles } from "./package_manifest.js";
import { validateAgentPluginSchema } from "./validate_agent_plugin_schema.js";
import { validate } from "./validate_goose_plugin.js";
import { loadPortablePlugin } from "./portable_loader.js";
import { productionBindings, verifyProductionApproval } from "./production_approval.js";
const AdmZip = loadRuntimeDependency("adm-zip");
function isDirectory(path) {
    try {
        return statSync(path).isDirectory();
    }
    catch {
        return false;
    }
}
function validateOfflineSkills(root, profile) {
    const skillsRoot = join(root, "skills");
    if (!isDirectory(skillsRoot))
        return [];
    const missing = [];
    for (const skill of readdirSync(skillsRoot).sort()) {
        const skillRoot = join(skillsRoot, skill);
        const packagePath = join(skillRoot, "package.json");
        if (!isDirectory(skillRoot) || !existsSync(packagePath))
            continue;
        const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
        if (!pkg.offlineBundle)
            continue;
        if (!isDirectory(join(skillRoot, "dist")))
            missing.push(`skills/${skill}/dist/`);
        if (profile === "release") {
            const nativeNames = process.platform === "win32" ? [skill + ".exe", skill] : [skill, skill + ".exe"];
            if (!nativeNames.some((name) => existsSync(join(root, "bin", name))))
                missing.push(`bin/${nativeNames[0]}`);
            continue;
        }
        if (!existsSync(join(skillRoot, "vendor", "manifest.json")))
            missing.push(`skills/${skill}/vendor/manifest.json`);
        if (!existsSync(join(skillRoot, "THIRD_PARTY_NOTICES.md")))
            missing.push(`skills/${skill}/THIRD_PARTY_NOTICES.md`);
        for (const dependency of Object.keys(pkg.dependencies ?? {})) {
            if (!isDirectory(join(skillRoot, "vendor", "node_modules", dependency)))
                missing.push(`skills/${skill}/vendor/node_modules/${dependency}`);
        }
    }
    return missing;
}
function fail(message) { console.error("ERROR: " + message); process.exit(1); }
export function main() {
    const writer = process.env.PLUGIN_CREATOR_TEST_DETACHED_WRITER_PATH;
    if (writer) {
        const code = `const fs=require("fs"),p=process.argv[1];setInterval(()=>fs.appendFileSync(p,String(Date.now())+"\\n"),10)`;
        const child = spawn(process.execPath, ["-e", code, writer], { detached: true, stdio: "ignore" });
        child.unref();
        if (process.env.PLUGIN_CREATOR_TEST_DETACHED_PID_PATH)
            writeFileSync(process.env.PLUGIN_CREATOR_TEST_DETACHED_PID_PATH, String(child.pid));
    }
    const testDelay = Number(process.env.PLUGIN_CREATOR_TEST_PACKAGE_DELAY_MS ?? 0);
    if (Number.isFinite(testDelay) && testDelay > 0)
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, testDelay);
    const raw = process.argv.slice(2), positionals = raw.filter((v, i) => !v.startsWith("--") && (i === 0 || !["--approval", "--approval-trust-policy", "--integration", "--test-evidence", "--profile"].includes(raw[i - 1]))), [pluginDirArg, outputArg] = positionals;
    const profileIndex = raw.indexOf("--profile"), profileValue = profileIndex >= 0 ? raw[profileIndex + 1] : "authoring";
    if (profileValue !== "authoring" && profileValue !== "release")
        fail("--profile must be authoring or release");
    const profile = profileValue;
    if (!pluginDirArg) {
        console.error("usage: package_goose_plugin.js <plugin_dir> [output.zip] [--profile authoring|release] [--production --approval FILE --approval-trust-policy FILE --integration DIR --test-evidence FILE]");
        process.exit(2);
    }
    const root = resolve(pluginDirArg);
    if (!isDirectory(root) || lstatSync(root).isSymbolicLink())
        fail("plugin root must be a real directory");
    const missing = validateOfflineSkills(root, profile);
    if (missing.length)
        fail("Offline bundle is incomplete: " + missing.join(", "));
    const portable = loadPortablePlugin(root, "portable-load");
    const schema = validateAgentPluginSchema(root, "auto", "strict-authoring");
    if (!schema.valid) {
        for (const error of schema.errors)
            console.error(`SCHEMA ERROR: ${error.path}: ${error.message}`);
        console.error(`PORTABLE LOAD: ${portable.status}; release policy: failed`);
        process.exit(1);
    }
    if (portable.status !== "accepted") {
        console.error(`PORTABLE LOAD: ${portable.status}; release policy: failed`);
        process.exit(1);
    }
    const operational = validate(root);
    for (const warning of operational.warnings)
        console.error("WARNING: " + warning);
    if (operational.errors.length) {
        for (const error of operational.errors)
            console.error("ERROR: " + error);
        process.exit(1);
    }
    const output = outputArg ? resolve(outputArg) : join(dirname(root), basename(root) + ".zip");
    mkdirSync(dirname(output), { recursive: true });
    if (existsSync(output) && lstatSync(output).isSymbolicLink())
        fail("archive output cannot be a symbolic link");
    let files;
    try {
        files = collectPackageFiles(root, [output], profile);
    }
    catch (error) {
        fail(error.message);
    }
    const manifest = JSON.parse(readFileSync(join(root, "plugin.json"), "utf8"));
    const zip = new AdmZip();
    for (const file of files)
        zip.addFile(manifest.name + "/" + file.relative, readFileSync(file.absolute), "", file.mode);
    const production = process.argv.includes("--production");
    zip.writeZip(output);
    if (production) {
        const value = (name) => { const i = process.argv.indexOf(name), v = i >= 0 ? process.argv[i + 1] : undefined; if (!v)
            fail(name + " is required for production packaging"); return v; };
        try {
            verifyProductionApproval(value("--approval"), value("--approval-trust-policy"), productionBindings(root, output, value("--integration"), value("--test-evidence")));
        }
        catch (error) {
            rmSync(output, { force: true });
            fail(error.message);
        }
    }
    console.log(output);
}
if (!import.meta.url.includes("/$bunfs/") && process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]))
    main();
