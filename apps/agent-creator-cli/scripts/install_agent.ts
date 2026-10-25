#!/usr/bin/env node
import { fileURLToPath } from "node:url";
// Install a validated Goose custom agent at project or user scope.
import { mkdirSync, existsSync, copyFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { parseAgent, AgentFormatError } from "./agent_format.js";

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(2);
  throw new Error("unreachable");
}

export function main() {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      project: { type: "string" },
      global: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
    },
  });

  const [agentFile] = positionals;
  if (!agentFile) {
    fail("usage: install_agent.js <agent_file> (--project <dir> | --global) [--force]");
  }
  if (Boolean(values.project) === Boolean(values.global)) {
    fail("exactly one of --project <dir> or --global is required");
  }

  const source = resolve(agentFile);
  let agent;
  try {
    agent = parseAgent(source);
  } catch (error) {
    if (error instanceof AgentFormatError) fail(error.message);
    throw error;
  }

  const destinationDir = values.global
    ? join(homedir(), ".agents", "agents")
    : join(resolve(values.project as string), ".agents", "agents");
  mkdirSync(destinationDir, { recursive: true });
  const destination = join(destinationDir, `${agent.name}.md`);

  if (existsSync(destination) && !values.force) {
    fail(`Refusing to overwrite existing agent: ${destination}; pass --force to replace it`);
  }
  copyFileSync(source, destination);
  console.log(destination);
}

if (!import.meta.url.includes("/$bunfs/") && process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
