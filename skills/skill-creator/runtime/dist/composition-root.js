import { randomUUID } from "node:crypto";
import { createCli } from "./adapters/inbound/cli/create-cli.js";
import { createHistoryCommandHandler } from "./adapters/inbound/cli/handle-history-command.js";
import { SqliteEvaluationHistory } from "./adapters/outbound/storage/sqlite-evaluation-history.js";
import { createEvaluationCommandHandler } from "./adapters/inbound/cli/handle-evaluation-command.js";
import { FilesystemEvaluationSource } from "./adapters/outbound/filesystem/filesystem-evaluation-source.js";
import { GooseHost } from "./adapters/outbound/hosts/goose/goose-host.js";
import { resolveEvaluationLocations } from "./adapters/outbound/storage/evaluation-locations.js";
import { SqliteEvaluationStore } from "./adapters/outbound/storage/sqlite-evaluation-store.js";
/** Composition only: concrete dependencies and factories, no command execution policy. */
export function createApplication(output) {
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
