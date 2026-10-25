#!/usr/bin/env bun
import yaml from "js-yaml";
import AdmZip from "adm-zip";
(globalThis as typeof globalThis & { __creatorDependencies?: Record<string, unknown> }).__creatorDependencies = { "js-yaml": yaml, "adm-zip": AdmZip };
const { runCli } = await import("./cli.js");
process.exitCode = await runCli(process.argv.slice(2));
