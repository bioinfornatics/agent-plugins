import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import type { CliOutput } from "./cli-output.ts";

import type { EvaluationHandler } from "./handle-evaluation-command.ts";

function integer(value: string) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new InvalidArgumentError("Expected a nonnegative safe integer");
  return Number(value);
}

function collect(value: string, previous: string[]) { return [...previous, value]; }

export function createCli(output: CliOutput, handleEvaluation: EvaluationHandler) {
  const cli = new Command().name("agent-plugin")
    .description("Comparative Skill/Plugin evaluation CLI")
    .configureOutput(output).exitOverride();
  cli.command("evaluation")
    .description("Prepare or execute independent Goose with/without comparisons")
    .option("--skills <paths...>", "Skill directories; repeatable and combinable with --plugin", collect, [])
    .option("--plugin <paths...>", "Plugin directories; discover their immediate Skill suites", collect, [])
    .option("--model <name>", "Requested model identifier (free string)")
    .option("--agent <name>", "Host: goose, claude or codex; repeatable (default: goose)", collect, [])
    .option("--repetitions <count>", "Paired repetitions per scenario and host", integer, 3)
    .option("--max-turns <count>", "Requested maximum turns; enforcement depends on host", integer, 50)
    .option("--timeout <seconds>", "Requested timeout in seconds; 0 disables timeout", integer, 0)
    .option("--parallelism <count>", "Requested global concurrency", integer, 3)
    .option("--output <directory>", "Private campaign SQLite and evidence destination", ".artifacts/evaluations")
    .option("--dry-run", "Print the validated JSON matrix without host calls", false)
    .action(async (options, command) => {
      if (!options.skills.length && !options.plugin.length) command.error("Select --skills or --plugin");
      await handleEvaluation({  skills: options.skills, 
                                plugins: options.plugin,
                                agents: options.agent.length ? options.agent : ["goose"], 
                                model: options.model,
                                repetitions: options.repetitions, 
                                maxTurns: options.maxTurns,
                                timeout: options.timeout, 
                                parallelism: options.parallelism, 
                                output: options.output },
                             options.dryRun);
    });
  return cli;
}
