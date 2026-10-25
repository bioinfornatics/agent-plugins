#!/usr/bin/env node
import { mkdirSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function fail(message) {
    console.error(message);
    process.exit(1);
    throw new Error("unreachable");
}
function titleCase(s) {
    return s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
export function main() {
    const { positionals, values } = parseArgs({
        args: process.argv.slice(2),
        allowPositionals: true,
        options: {
            path: { type: "string", default: "." },
            description: { type: "string" },
            version: { type: "string", default: "0.1.0" },
            skill: { type: "string", multiple: true, default: [] },
            "with-hooks": { type: "boolean", default: false },
        },
    });
    const [name] = positionals;
    if (!name)
        fail("usage: init_goose_plugin.js <name> [--path <dir>] [--description <text>] [--version <semver>] [--skill <name>]... [--with-hooks]");
    if (!NAME_RE.test(name)) {
        fail("Plugin name must be lowercase kebab-case");
    }
    const root = join(resolve(values.path), name);
    if (existsSync(root) && readdirSync(root).length > 0) {
        fail(`Refusing to overwrite non-empty directory: ${root}`);
    }
    mkdirSync(root, { recursive: true });
    const manifest = {
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        name,
        version: values.version,
        description: values.description || `Reusable goose workflows for ${name}`,
    };
    writeFileSync(join(root, "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
    const skillNames = values.skill.length ? values.skill : [name];
    for (const skillName of skillNames) {
        if (!NAME_RE.test(skillName)) {
            fail(`Invalid skill name: ${skillName}`);
        }
        const d = join(root, "skills", skillName);
        mkdirSync(d, { recursive: true });
        writeFileSync(join(d, "SKILL.md"), "---\n" +
            `name: ${skillName}\n` +
            `description: TODO describe what ${skillName} does and the concrete requests that should trigger it\n` +
            "---\n\n" +
            `# ${titleCase(skillName)}\n\n` +
            "1. TODO define the workflow.\n" +
            "2. TODO define verification steps.\n", "utf-8");
    }
    if (values["with-hooks"]) {
        mkdirSync(join(root, "hooks"), { recursive: true });
        mkdirSync(join(root, "scripts"), { recursive: true });
        writeFileSync(join(root, "hooks", "hooks.json"), `${JSON.stringify({ hooks: {} }, null, 2)}\n`, "utf-8");
    }
    console.log(root);
}
if (!import.meta.url.includes("/$bunfs/") && process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]))
    main();
