#!/usr/bin/env bun
import { run } from "./cli.js";
process.exitCode = run(process.argv.slice(2));
