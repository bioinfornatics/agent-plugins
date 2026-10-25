#!/usr/bin/env bun
import yaml from "js-yaml";
globalThis.__creatorDependencies = { "js-yaml": yaml };
const { runCli } = await import("./cli.js");
process.exitCode = await runCli(process.argv.slice(2));
