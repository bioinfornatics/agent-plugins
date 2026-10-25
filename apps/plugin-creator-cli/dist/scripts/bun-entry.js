#!/usr/bin/env bun
// Static release imports make dependencies visible to Bun while source builds keep the offline loader.
import AdmZip from "adm-zip";
import Ajv2020Import from "ajv/dist/2020.js";
globalThis.__creatorDependencies = {
    "adm-zip": AdmZip,
    "ajv/dist/2020.js": Ajv2020Import,
};
const { runCli } = await import("./cli.js");
process.exitCode = await runCli(process.argv.slice(2));
