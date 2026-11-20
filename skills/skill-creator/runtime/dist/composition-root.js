import { FilesystemJudgeInstructionWriter } from "./adapters/outbound/storage/judge-instruction-files.js";
import { join } from "node:path";
import { FilesystemRetainedFixtureIO } from "./adapters/outbound/filesystem/retained-fixture-io.js";
import { createValidateCommandHandler } from "./adapters/inbound/cli/handle-validate-command.js";
import { FilesystemSkillFormatSource } from "./adapters/outbound/filesystem/filesystem-skill-format-source.js";
import { createExportCommandHandler } from "./adapters/inbound/cli/handle-export-command.js";
import { FilesystemExportWriter } from "./adapters/outbound/reporting/filesystem-export-writer.js";
import { createGradingCommandHandler, createJudgmentsCommandHandler } from "./adapters/inbound/cli/handle-grading-command.js";
import { GooseJudge } from "./adapters/outbound/judge/goose-judge.js";
import { SqliteVerifiedAttemptReader } from "./adapters/outbound/storage/sqlite-verified-attempt.js";
import { SqliteJudgmentStore } from "./adapters/outbound/storage/sqlite-judgment-store.js";
import { SqliteJudgmentHistory } from "./adapters/outbound/storage/sqlite-judgment-history.js";
import { randomUUID } from "node:crypto";
import { createCli } from "./adapters/inbound/cli/create-cli.js";
import { createHistoryCommandHandler } from "./adapters/inbound/cli/handle-history-command.js";
import { SqliteEvaluationHistory } from "./adapters/outbound/storage/sqlite-evaluation-history.js";
import { createEvaluationCommandHandler } from "./adapters/inbound/cli/handle-evaluation-command.js";
import { FilesystemEvaluationSource } from "./adapters/outbound/filesystem/filesystem-evaluation-source.js";
import { GooseHost } from "./adapters/outbound/hosts/goose/goose-host.js";
import { SystemGooseKeyring } from "./adapters/outbound/hosts/goose/goose-keyring.js";
import { GooseActivationObserver } from "./adapters/outbound/hosts/goose/goose-activation.js";
import { resolveEvaluationLocations } from "./adapters/outbound/storage/evaluation-locations.js";
import { SqliteEvaluationStore } from "./adapters/outbound/storage/sqlite-evaluation-store.js";
import { createActivationCommandHandler } from "./adapters/inbound/cli/handle-activation-command.js";
import { FilesystemActivationCaseSource } from "./adapters/outbound/filesystem/activation-case-source.js";
import { FilesystemActivationResultWriter } from "./adapters/outbound/reporting/activation-result-writer.js";
/** Composition only: concrete dependencies and factories, no command execution policy. */
export function createApplication(output) {
    const handleEvaluation = createEvaluationCommandHandler(output, {
        fixtureIO: new FilesystemRetainedFixtureIO(new FilesystemEvaluationSource(), locations => new SqliteEvaluationStore(join(locations.candidate, "campaigns"), join(locations.candidate, "registry/evaluations.sqlite")), randomUUID),
        newAttemptId: randomUUID,
        source: new FilesystemEvaluationSource(),
        createHosts: () => new Map([["goose", new GooseHost({ keyring: new SystemGooseKeyring() })]]),
        createStore: (output, registry) => {
            const locations = resolveEvaluationLocations(registry, output);
            return new SqliteEvaluationStore(locations.output, locations.registry, "hive");
        },
    });
    const handleHistory = createHistoryCommandHandler(output, registry => new SqliteEvaluationHistory(resolveEvaluationLocations(registry).registry));
    const handleGrading = createGradingCommandHandler(output, {
        createReader: registry => new SqliteVerifiedAttemptReader(resolveEvaluationLocations(registry).registry),
        createStore: registry => new SqliteJudgmentStore(resolveEvaluationLocations(registry).registry),
        createJudge: () => new GooseJudge({ instructionWriter: new FilesystemJudgeInstructionWriter(), keyring: new SystemGooseKeyring() }), newId: randomUUID,
    });
    const handleJudgments = createJudgmentsCommandHandler(output, registry => new SqliteJudgmentHistory(resolveEvaluationLocations(registry).registry));
    const handleExport = createExportCommandHandler(output, {
        createOverviewHistory: registry => new SqliteEvaluationHistory(resolveEvaluationLocations(registry).registry),
        createHistory: registry => new SqliteJudgmentHistory(resolveEvaluationLocations(registry).registry),
        createReader: registry => new SqliteVerifiedAttemptReader(resolveEvaluationLocations(registry).registry),
        createWriter: registry => new FilesystemExportWriter(resolveEvaluationLocations(registry).registry),
        now: () => new Date().toISOString(),
        activation: new GooseActivationObserver(),
    });
    const handleValidate = createValidateCommandHandler(output, new FilesystemSkillFormatSource());
    const handleActivation = createActivationCommandHandler(output, {
        source: new FilesystemEvaluationSource(),
        caseSource: new FilesystemActivationCaseSource(),
        newAttemptId: randomUUID,
        createHosts: () => new Map([["goose", new GooseHost({ keyring: new SystemGooseKeyring() })]]),
        createStore: (output, registry) => {
            const locations = resolveEvaluationLocations(registry, output);
            return new SqliteEvaluationStore(locations.output, locations.registry, "hive");
        },
        createHistory: registry => new SqliteEvaluationHistory(resolveEvaluationLocations(registry).registry),
        createReader: registry => new SqliteVerifiedAttemptReader(resolveEvaluationLocations(registry).registry),
        observer: new GooseActivationObserver(),
        writer: new FilesystemActivationResultWriter(),
    });
    return createCli(output, handleEvaluation, handleHistory, handleGrading, handleJudgments, handleExport, handleValidate, handleActivation);
}
