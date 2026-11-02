import type { CliOutput } from "./adapters/inbound/cli/cli-output.ts";
import { createCli } from "./adapters/inbound/cli/create-cli.ts";
import { FilesystemEvaluationSource } from "./adapters/outbound/filesystem/filesystem-evaluation-source.ts";
import { GooseHost } from "./adapters/outbound/hosts/goose/goose-host.ts";
import { SqliteEvaluationStore } from "./adapters/outbound/storage/sqlite-evaluation-store.ts";
import { prepareEvaluation } from "./application/use-cases/prepare-evaluation.ts";
import { executeEvaluation } from "./application/use-cases/execute-evaluation.ts";
import { EvaluationError } from "./domain/evaluation.ts";

export function createApplication(output: CliOutput) {
  const source = new FilesystemEvaluationSource();
  return createCli(output, async (input, dryRun) => {
    const plan = await prepareEvaluation(input, source);
    if (dryRun) { output.writeOut(`${JSON.stringify(plan, null, 2)}\n`); return; }
    let result: Awaited<ReturnType<typeof executeEvaluation>>;
    try { result = await executeEvaluation(plan, new Map([["goose", new GooseHost()]]), new SqliteEvaluationStore(input.output ?? ".artifacts/evaluations")); }
    // Raw host/storage errors can contain credentials or configuration; keep this boundary sanitized.
    catch { throw new EvaluationError("Campaign preflight or storage failed; no raw configuration diagnostics are exposed"); }
    output.writeOut(`${JSON.stringify(result, null, 2)}\n`);
    if (result.failed) throw new EvaluationError(`${result.failed} trial(s) failed or had incomplete collection; inspect campaign receipts`);
  });
}
