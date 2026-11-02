import { createCli } from "./adapters/inbound/cli/create-cli.ts";
import type { CliOutput } from "./adapters/inbound/cli/cli-output.ts";
import { FilesystemEvaluationSource } from "./adapters/outbound/filesystem/filesystem-evaluation-source.ts";
import { prepareEvaluation } from "./application/use-cases/prepare-evaluation.ts";
import { EvaluationError } from "./domain/evaluation.ts";

export function createApplication(output: CliOutput) {
  const source = new FilesystemEvaluationSource();
  return createCli(output, async (input, dryRun) => {
    const plan = await prepareEvaluation(input, source);
    if (!dryRun) throw new EvaluationError("Evaluation execution is unavailable; use --dry-run to prepare the validated matrix without host calls");
    output.writeOut(`${JSON.stringify(plan, null, 2)}\n`);
  });
}
