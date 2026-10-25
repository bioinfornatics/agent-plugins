#!/usr/bin/env node
import { fileURLToPath } from "node:url";
// Create a minimal Goose custom-agent definition.
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { NAME_RE, renderAgent } from "./agent_format.js";
function fail(message) {
    console.error(`error: ${message}`);
    process.exit(2);
    throw new Error("unreachable");
}
export function main() {
    const { positionals, values } = parseArgs({
        args: process.argv.slice(2),
        allowPositionals: true,
        options: {
            path: { type: "string", default: "." },
            description: { type: "string" },
            model: { type: "string" },
            role: { type: "string" },
        },
    });
    const [name] = positionals;
    if (!name)
        fail("usage: init_agent.js <name> [--path <dir>] [--description <text>] [--model <name>] [--role <text>]");
    if (!NAME_RE.test(name) || name.length > 64) {
        fail("Agent name must be lowercase kebab-case and at most 64 characters");
    }
    const outputDir = resolve(values.path);
    mkdirSync(outputDir, { recursive: true });
    const output = join(outputDir, `${name}.md`);
    if (existsSync(output)) {
        fail(`Refusing to overwrite existing file: ${output}`);
    }
    const body = values.role ||
        `You are the ${name.replace(/-/g, " ")} specialist.\n\n` +
            "Define the role's priorities, boundaries, verification expectations, and output style.";
    writeFileSync(output, renderAgent(name, values.description ?? null, values.model ?? null, body), "utf-8");
    console.log(output);
}
if (!import.meta.url.includes("/$bunfs/") && process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
    main();
