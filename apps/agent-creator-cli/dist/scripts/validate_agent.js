#!/usr/bin/env node
import { fileURLToPath } from "node:url";
// Validate a Goose custom-agent Markdown file.
import { resolve, basename, extname } from "node:path";
import { parseArgs } from "node:util";
import { parseAgent, AgentFormatError } from "./agent_format.js";
export function main() {
    const { positionals, values } = parseArgs({
        args: process.argv.slice(2),
        allowPositionals: true,
        options: {
            "require-filename-match": { type: "boolean", default: false },
        },
    });
    const [agentFile] = positionals;
    if (!agentFile) {
        console.error("usage: validate_agent.js <agent_file> [--require-filename-match]");
        process.exit(2);
    }
    const path = resolve(agentFile);
    try {
        const agent = parseAgent(path);
        if (values["require-filename-match"]) {
            const stem = basename(path, extname(path));
            if (stem !== agent.name) {
                throw new AgentFormatError(`Agent filename '${basename(path)}' must match frontmatter name '${agent.name}.md'`);
            }
        }
        console.log(`OK: ${agent.name} (${path})`);
    }
    catch (error) {
        if (error instanceof AgentFormatError) {
            console.log(`ERROR: ${error.message}`);
            process.exit(1);
        }
        throw error;
    }
}
if (!import.meta.url.includes("/$bunfs/") && process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
    main();
