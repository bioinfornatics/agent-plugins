import type { CliOutput } from "./adapters/inbound/cli/cli-output.ts";
import { createCli } from "./adapters/inbound/cli/create-cli.ts";
import { createEvaluationCommandHandler } from "./adapters/inbound/cli/handle-evaluation-command.ts";
import { FilesystemEvaluationSource } from "./adapters/outbound/filesystem/filesystem-evaluation-source.ts";
import { GooseHost } from "./adapters/outbound/hosts/goose/goose-host.ts";
import { resolveEvaluationLocations } from "./adapters/outbound/storage/evaluation-locations.ts";
import { SqliteEvaluationStore } from "./adapters/outbound/storage/sqlite-evaluation-store.ts";

/** Composition only: concrete dependencies and factories, no command execution policy. */
export function createApplication(output: CliOutput) {
  const handleEvaluation = createEvaluationCommandHandler(output, {
    source: new FilesystemEvaluationSource(),
    createHosts: () => new Map([["goose", new GooseHost()]]),
    createStore: (output, registry) => {
      const locations = resolveEvaluationLocations(registry, output);
      return new SqliteEvaluationStore(locations.output, locations.registry);
    },
  });
  return createCli(output, handleEvaluation);
}
