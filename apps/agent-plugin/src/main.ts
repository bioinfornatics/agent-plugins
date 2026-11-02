import { EvaluationError } from "./domain/evaluation.ts";
import { CommanderError } from "commander";
import { createApplication } from "./composition-root.ts";
import type { CliOutput } from "./adapters/inbound/cli/cli-output.ts";

/** Import-safe entrypoint: accepts user arguments, returns a process exit status. */
export async function main(argv: readonly string[], output: CliOutput): Promise<number> {
  const cli = createApplication(output);
  try {
    await cli.parseAsync([...argv], { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      // Commander already emitted help/parse diagnostics through the output port.
      return error.exitCode;
    }
    output.writeErr(error instanceof EvaluationError ? `error: ${error.message}\n` : "error: Unexpected CLI failure\n");
    return 1;
  }
}
