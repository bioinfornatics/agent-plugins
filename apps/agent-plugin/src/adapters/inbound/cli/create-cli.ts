import type { ValidateHandler } from "./handle-validate-command.ts";
import type { ExportHandler } from "./handle-export-command.ts";
import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import type { CliOutput } from "./cli-output.ts";
import { executeWithHeartbeat } from "./command-heartbeat.ts";

import type { GradingHandler, JudgmentsHandler } from "./handle-grading-command.ts";
import type { HistoryHandler } from "./handle-history-command.ts";
import type { EvaluationHandler } from "./handle-evaluation-command.ts";

function integer(value: string) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new InvalidArgumentError("Expected a nonnegative safe integer");
  return Number(value);
}

function collect(value: string, previous: string[]) { return [...previous, value]; }

export function createCli(output: CliOutput, handleEvaluation: EvaluationHandler, handleHistory?: HistoryHandler, handleGrading?: GradingHandler, handleJudgments?: JudgmentsHandler, handleExport?: ExportHandler, handleValidate?: ValidateHandler) {
  const cli = new Command().name("agent-plugin")
    .description("Comparative Skill/Plugin evaluation CLI")
    .configureOutput(output).exitOverride();
  cli.command("evaluation")
    .description("Prepare or execute a composed profile with/without comparison")
    .option("--skills <paths...>", "Skill directories; repeatable and combinable with --plugin", collect, [])
    .option("--plugin <paths...>", "Plugin directories; discover their immediate Skill suites", collect, [])
    .option("--profile-name <name>", "Optional profile label; identity is independent of its name")
    .option("--model <name>", "Requested model identifier (free string)")
    .option("--agent <name>", "Host: goose, claude or codex; repeatable (default: goose)", collect, [])
    .option("--repetitions <count>", "Paired repetitions per scenario and host", integer, 3)
    .option("--max-turns <count>", "Requested maximum turns; enforcement depends on host", integer, 50)
    .option("--timeout <seconds>", "Requested timeout in seconds; 0 disables timeout", integer, 0)
    .option("--parallelism <count>", "Requested global concurrency", integer, 3)
    .option("--resume <campaign-id>", "Resume the stored campaign without rereading selected sources")
    .option("--retry-uncertain", "Explicitly permit new attempts for uncertain trials on resume", false)
    .option("--registry <file>", "User-wide SQLite registry override")
    .option("--output <directory>", "Evidence root override (Hive profile/model/campaign; default: beside registry)")
    .option("--dry-run", "Print the validated JSON matrix without host calls", false)
    .option("-q, --quiet", "Disable periodic stderr heartbeat; retain results and errors", false)
    .action(async (options, command) => {
      if (!options.resume && !options.skills.length && !options.plugin.length) command.error("Select --skills or --plugin");
      if (options.resume && (options.skills.length || options.plugin.length || options.dryRun || options.profileName || options.output)) command.error("--resume uses its stored plan; selectors, name, output and dry-run are not allowed");
      if (options.retryUncertain && !options.resume) command.error("--retry-uncertain requires --resume");
      const explicit = ["agent", "model", "repetitions", "maxTurns", "timeout", "parallelism"];
      if (options.resume && explicit.some(name => command.getOptionValueSource(name) === "cli")) command.error("--resume uses stored execution parameters");
      await executeWithHeartbeat(output, options.resume ? "resume" : "evaluation", options.quiet || options.dryRun, async () => await handleEvaluation({  skills: options.skills, 
                                plugins: options.plugin,
                                profileName: options.profileName,
                                agents: options.agent.length ? options.agent : ["goose"], 
                                model: options.model,
                                repetitions: options.repetitions, 
                                maxTurns: options.maxTurns,
                                timeout: options.timeout, 
                                parallelism: options.parallelism, 
                                output: options.output,
                                registry: options.registry },
                             options.dryRun, options.resume ? { id: options.resume, retryUncertain: options.retryUncertain } : undefined));
    });
  if (handleHistory) {
    cli.command("history").description("List stored evaluation campaigns without execution")
      .option("--profile <id>", "Filter by exact profile identity")
      .option("--registry <file>", "Registry to read (never created or migrated)")
      .option("--json", "Structured JSON output", false)
      .action(options => handleHistory({ registry: options.registry, profile: options.profile, json: options.json }));
    cli.command("inspect").description("Inspect a stored campaign and its evidence locations")
      .argument("<campaign-id>")
      .option("--registry <file>", "Registry to read (never created or migrated)")
      .option("--json", "Structured JSON output", false)
      .action((campaign, options) => handleHistory({ campaign, registry: options.registry, json: options.json }));
  }
  if (handleGrading) for (const name of ["grading", "regrading"] as const) {
    cli.command(name).description("Append a fresh judgment of an explicit verified candidate attempt")
      .argument("<campaign-id>").requiredOption("--attempt <id>", "Explicit candidate attempt UUID")
      .option("--registry <file>", "Existing registry (never created)")
      .option("--agent <name>", "Judge host (only goose supported)", "goose")
      .option("--model <name>", "Optional Judge model override; native default otherwise")
      .option("--max-turns <count>", "Maximum Judge turns", integer, 20)
      .option("--timeout <seconds>", "Judge timeout; 0 disables timer", integer, 600)
      .option("--json", "Structured result including technical failures", false)
      .option("-q, --quiet", "Disable periodic stderr heartbeat; retain results and errors", false)
      .action((campaignId, options) => executeWithHeartbeat(output, name, options.quiet, async () => await handleGrading({ campaignId, attemptId: options.attempt, registry: options.registry, agent: options.agent, model: options.model, maxTurns: options.maxTurns, timeout: options.timeout, json: options.json })));
  }
  if (handleJudgments) cli.command("judgments").description("Read explicit judgment history without execution or archive access")
    .argument("<campaign-id>").option("--attempt <id>", "Filter by candidate attempt UUID")
    .option("--registry <file>", "Readonly registry (never created or migrated)")
    .option("--json", "Structured validated judgment records", false)
    .action((campaignId, options) => handleJudgments({ campaignId, attemptId: options.attempt, registry: options.registry, json: options.json }));
  if (handleExport) cli.command("export").description("Export explicitly selected decisive grades, without model calls")
    .argument("<campaign-id>").requiredOption("--grading <UUID>", "Explicit grade UUID; repeatable, one per logical trial", collect, [])
    .option("--output <NEWDIR>", "New exclusive directory; defaults to replaceable campaign report/export")
    .option("--registry <file>", "Readonly registry (never created or migrated)")
    .option("--benchmark", "Experimental quality-only benchmark of complete homogeneous selected pairs", false)
    .action((campaignId, options) => handleExport({ campaignId, gradingIds: options.grading, output: options.output, registry: options.registry, benchmark: options.benchmark }));
  if (handleValidate) cli.command("validate").description("Validate standalone Skill format only; no evaluation suite or execution")
    .argument("<skill-path>", "Existing Skill directory containing SKILL.md")
    .option("--json", "Structured format diagnostics and unvalidated extension names", false)
    .action((skillPath, options) => handleValidate(skillPath, options.json));
  return cli;
}
