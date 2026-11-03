import { randomUUID } from "node:crypto";
import type { CliOutput } from "./adapters/inbound/cli/cli-output.ts";
import { createCli } from "./adapters/inbound/cli/create-cli.ts";
import { createHistoryCommandHandler } from "./adapters/inbound/cli/handle-history-command.ts";
import { SqliteEvaluationHistory } from "./adapters/outbound/storage/sqlite-evaluation-history.ts";
import { createEvaluationCommandHandler } from "./adapters/inbound/cli/handle-evaluation-command.ts";
import { FilesystemEvaluationSource } from "./adapters/outbound/filesystem/filesystem-evaluation-source.ts";
import { GooseHost } from "./adapters/outbound/hosts/goose/goose-host.ts";
import { resolveEvaluationLocations } from "./adapters/outbound/storage/evaluation-locations.ts";
import { SqliteEvaluationStore } from "./adapters/outbound/storage/sqlite-evaluation-store.ts";

/** Composition only: concrete dependencies and factories, no command execution policy. */
export function createApplication(output: CliOutput) {
  const handleEvaluation = createEvaluationCommandHandler(output, {
    newAttemptId: randomUUID,
    source: new FilesystemEvaluationSource(),
    createHosts: () => new Map([["goose", new GooseHost()]]),
    createStore: (output, registry) => {
      const locations = resolveEvaluationLocations(registry, output);
      return new SqliteEvaluationStore(locations.output, locations.registry);
    },
  });
  const handleHistory = createHistoryCommandHandler(output, registry => new SqliteEvaluationHistory(resolveEvaluationLocations(registry).registry));
  return createCli(output, handleEvaluation, handleHistory);
}
