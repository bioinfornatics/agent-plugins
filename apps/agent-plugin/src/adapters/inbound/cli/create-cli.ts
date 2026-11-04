import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import type { CliOutput } from "./cli-output.ts";

import type { HistoryHandler } from "./handle-history-command.ts";
import type { EvaluationHandler } from "./handle-evaluation-command.ts";

function integer(value: string) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new InvalidArgumentError("Expected a nonnegative safe integer");
  return Number(value);
}

function collect(value: string, previous: string[]) { return [...previous, value]; }

export function createCli(output: CliOutput, handleEvaluation: EvaluationHandler, handleHistory?: HistoryHandler) {
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
    .option("--output <directory>", "Campaign evidence directory (default: beside the registry)")
    .option("--dry-run", "Print the validated JSON matrix without host calls", false)
    .action(async (options, command) => {
      if (!options.resume && !options.skills.length && !options.plugin.length) command.error("Select --skills or --plugin");
      if (options.resume && (options.skills.length || options.plugin.length || options.dryRun || options.profileName || options.output)) command.error("--resume uses its stored plan; selectors, name, output and dry-run are not allowed");
      if (options.retryUncertain && !options.resume) command.error("--retry-uncertain requires --resume");
      const explicit = ["agent", "model", "repetitions", "maxTurns", "timeout", "parallelism"];
      if (options.resume && explicit.some(name => command.getOptionValueSource(name) === "cli")) command.error("--resume uses stored execution parameters");
      await handleEvaluation({  skills: options.skills, 
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
                             options.dryRun, options.resume ? { id: options.resume, retryUncertain: options.retryUncertain } : undefined);
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
  return cli;
}
