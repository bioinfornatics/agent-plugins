import { StreamCliOutput } from "./adapters/inbound/cli/stream-cli-output.js";
import { main } from "./main.js";
// Runtime boundary only. Importing the library entrypoints has no process effects.
if (import.meta.main) {
    const output = new StreamCliOutput(process.stdout, process.stderr);
    process.exitCode = await main(process.argv.slice(2), output);
}
