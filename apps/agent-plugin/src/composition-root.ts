import { FilesystemJudgeInstructionWriter } from "./adapters/outbound/storage/judge-instruction-files.ts";
import { join } from "node:path";
import { FilesystemRetainedFixtureIO } from "./adapters/outbound/filesystem/retained-fixture-io.ts";
import { createValidateCommandHandler } from "./adapters/inbound/cli/handle-validate-command.ts";
import { FilesystemSkillFormatSource } from "./adapters/outbound/filesystem/filesystem-skill-format-source.ts";
import { createExportCommandHandler } from "./adapters/inbound/cli/handle-export-command.ts";
import { FilesystemExportWriter } from "./adapters/outbound/reporting/filesystem-export-writer.ts";
import { createGradingCommandHandler, createJudgmentsCommandHandler } from "./adapters/inbound/cli/handle-grading-command.ts";
import { GooseJudge } from "./adapters/outbound/judge/goose-judge.ts";
import { SqliteVerifiedAttemptReader } from "./adapters/outbound/storage/sqlite-verified-attempt.ts";
import { SqliteJudgmentStore } from "./adapters/outbound/storage/sqlite-judgment-store.ts";
import { SqliteJudgmentHistory } from "./adapters/outbound/storage/sqlite-judgment-history.ts";
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
    fixtureIO: new FilesystemRetainedFixtureIO(new FilesystemEvaluationSource(), locations => new SqliteEvaluationStore(join(locations.candidate, "campaigns"), join(locations.candidate, "registry/evaluations.sqlite")), randomUUID),
    newAttemptId: randomUUID,
    source: new FilesystemEvaluationSource(),
    createHosts: () => new Map([["goose", new GooseHost()]]),
    createStore: (output, registry) => {
      const locations = resolveEvaluationLocations(registry, output);
      return new SqliteEvaluationStore(locations.output, locations.registry, "hive");
    },
  });
  const handleHistory = createHistoryCommandHandler(output, registry => new SqliteEvaluationHistory(resolveEvaluationLocations(registry).registry));
  const handleGrading = createGradingCommandHandler(output, {
    createReader: registry => new SqliteVerifiedAttemptReader(resolveEvaluationLocations(registry).registry),
    createStore: registry => new SqliteJudgmentStore(resolveEvaluationLocations(registry).registry),
    createJudge: () => new GooseJudge({ instructionWriter: new FilesystemJudgeInstructionWriter() }), newId: randomUUID,
  });
  const handleJudgments = createJudgmentsCommandHandler(output, registry => new SqliteJudgmentHistory(resolveEvaluationLocations(registry).registry));
  const handleExport = createExportCommandHandler(output, {
    createOverviewHistory: registry => new SqliteEvaluationHistory(resolveEvaluationLocations(registry).registry),
    createHistory: registry => new SqliteJudgmentHistory(resolveEvaluationLocations(registry).registry),
    createReader: registry => new SqliteVerifiedAttemptReader(resolveEvaluationLocations(registry).registry),
    createWriter: registry => new FilesystemExportWriter(resolveEvaluationLocations(registry).registry),
    now: () => new Date().toISOString(),
  });
  const handleValidate = createValidateCommandHandler(output, new FilesystemSkillFormatSource());
  return createCli(output, handleEvaluation, handleHistory, handleGrading, handleJudgments, handleExport, handleValidate);
}
