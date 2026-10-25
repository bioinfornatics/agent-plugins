#!/usr/bin/env node
// Run paired custom-agent evaluations with Goose.
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, copyFileSync, cpSync, rmSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { normalizeAssertions, assertionHash, variantManifest } from "./assertion_grading.js";
import { parseAgent, renderAgent, type AgentDocument } from "./agent_format.js";
import { createExecutionHeartbeat, type ExecutionStatus } from "./execution_heartbeat.js";
import { parseRetentionPolicy, redactString, redactValue, type TranscriptRetention } from "./privacy_policy.js";
import { timingArtifact } from "./resource_telemetry.js";
import { evidenceSha256, parseAgentRunProfile, scheduleAgentPairs, type AgentPairSchedule, type AgentRunProfile, type PairEquivalence } from "./repeated_agent_runs.js";

const execFileAsync = promisify(execFile);

interface EvalCase {
  id: string | number;
  name?: string;
  subject?: string;
  language?: string;
  prompt: string;
  target?: Record<string, unknown>;
  preconditions?: string[];
  files?: string[];
  capabilities?: Record<string, unknown>;
  coverage_tags?: string[];
  assertions?: unknown[];
}

export function evalDirectoryName(id: string | number): string {
  return `eval-${encodeURIComponent(String(id))}`;
}

interface RunResult {
  eval_id: string | number;
  configuration: string;
  total_tokens: number | null;
  total_turns: number | null;
  total_duration_seconds: number;
  pair_index: number;
  seed: number;
  cost_usd: number | null;
}

export function extractAssistantText(document: any): string {
  const chunks: string[] = [];
  for (const message of document?.messages ?? []) {
    if (message?.role !== "assistant") continue;
    for (const item of message?.content ?? []) {
      if (item?.type === "text" && typeof item?.text === "string") {
        chunks.push(item.text);
      }
    }
  }
  return chunks.join("\n\n").trim();
}

function baselineAgent(agent: AgentDocument, name: string): string {
  const description = `Baseline role for comparison with ${agent.name}`;
  const body =
    "Complete the delegated task using your general capabilities. " +
    "Follow the user's request, but do not assume specialized role instructions " +
    "that are not present in the task itself.";
  return renderAgent(name, description, agent.model, body);
}

async function runCase(
  evalCase: EvalCase,
  configuration: string,
  agentPath: string,
  workspace: string,
  gooseCommand: string[],
  model: string | undefined,
  timeoutMs: number,
  maxTurns: number,
  fixtureRoot: string,
  transcriptRetention: TranscriptRetention,
  pair: AgentPairSchedule,
  equivalence: PairEquivalence,
  flatLayout: boolean
): Promise<RunResult> {
  const evalId = evalCase.id;
  // Preserve the historical one-run layout while repeated profiles use run-N directories.
  const runDir = flatLayout ? join(workspace, evalDirectoryName(evalId), configuration) : join(workspace, evalDirectoryName(evalId), configuration, `run-${pair.pair_index}`);
  const outputs = join(runDir, "outputs");
  mkdirSync(outputs, { recursive: true });

  const temporary = mkdtempSync(join(tmpdir(), "agent-eval-"));
  let document: any;
  let duration: number;
  try {
    const agent = parseAgent(agentPath);
    const installed = join(temporary, ".agents", "agents", `${agent.name}.md`);
    mkdirSync(dirname(installed), { recursive: true });
    copyFileSync(agentPath, installed);
    for (const relative of evalCase.files ?? []) {
      if (relative.startsWith("/") || relative.split(/[\\/]/).includes("..")) throw new Error(`Eval ${evalId} fixture path must stay inside the creator: ${relative}`);
      const source = resolve(fixtureRoot, relative), destination = join(temporary, relative);
      let sourceStat; try { sourceStat = statSync(source); } catch { throw new Error(`Eval ${evalId} fixture does not exist: ${relative}`); }
      mkdirSync(dirname(destination), { recursive: true });
      sourceStat.isDirectory() ? cpSync(source, destination, { recursive: true }) : copyFileSync(source, destination);
    }

    const context = JSON.stringify({ subject: evalCase.subject ?? null, language: evalCase.language ?? null, target: evalCase.target ?? null, preconditions: evalCase.preconditions ?? [], capabilities: evalCase.capabilities ?? null });
    const prompt =
      `Delegate this task to the custom agent named ${agent.name}. ` +
      "Return only the delegated agent's final task result, without discussing the delegation.\n\n" +
      `Evaluation context:\n${context}\n\nTask:\n${evalCase.prompt}`;

    const args = [
      "run",
      "--no-session",
      "--quiet",
      "--output-format",
      "json",
      "--max-turns",
      String(maxTurns),
      "--text",
      prompt,
    ];
    if (model) args.push("--model", model);

    const [command, ...baseArgs] = gooseCommand;
    const started = performance.now();
    let stdout: string;
    try {
      const result = await execFileAsync(command, [...baseArgs, ...args], {
        cwd: temporary,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024 * 64,
      });
      stdout = result.stdout;
    } catch {
      // Child stderr can contain model responses or credentials. Never reflect it.
      throw new Error(`Goose failed for eval ${evalId}/${configuration}; raw runner diagnostics withheld`);
    }
    duration = (performance.now() - started) / 1000;
    try {
      document = JSON.parse(stdout);
    } catch (error) {
      throw new Error(`Goose returned invalid JSON: ${(error as Error).message}`);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }

  const outputText = extractAssistantText(document);
  // Aggregate evidence is written independently below; transcript content is optional.
  writeFileSync(join(outputs, "response.md"), `${redactString(outputText)}\n`, "utf-8");
  if (transcriptRetention === "retain") writeFileSync(join(runDir, "transcript.json"), `${JSON.stringify(redactValue(document, { topLevel: false }), null, 2)}\n`, "utf-8");
  const metadata = document.metadata ?? {};
  const timing = timingArtifact({
    duration_seconds: Math.round(duration * 1000) / 1000,
    tokens: metadata.total_tokens,
    turns: metadata.total_turns,
    cost_usd: metadata.cost_usd,
    provider: metadata.provider ?? metadata.provider_name,
    model: metadata.model ?? metadata.model_name ?? model,
    goose_version: metadata.goose_version,
  } as any);
  writeFileSync(join(runDir, "timing.json"), `${JSON.stringify(timing, null, 2)}\n`, "utf-8");
  const evalMetadata = JSON.parse(readFileSync(join(workspace, evalDirectoryName(evalId), "eval_metadata.json"), "utf-8"));
  writeFileSync(join(runDir, "assertion_hash.txt"), `${evalMetadata.assertion_hash}\n`, "utf-8");
  writeFileSync(join(runDir, "execution_evidence.json"), `${JSON.stringify({ eval_id: evalId, configuration, pair_index: pair.pair_index, seed: pair.seed, order: pair.order, pair_equivalence: equivalence }, null, 2)}\n`, "utf-8");
  return { eval_id: evalId, configuration, total_tokens: timing.total_tokens, total_turns: timing.total_turns, total_duration_seconds: timing.total_duration_seconds!, cost_usd: timing.cost_usd, pair_index: pair.pair_index, seed: pair.seed };
}

export function validateEvalSet(document: any): EvalCase[] {
  if (typeof document !== "object" || document === null || !Array.isArray(document.evals)) {
    throw new Error("Eval set must be an object containing an 'evals' list");
  }
  const cases: EvalCase[] = document.evals;
  const seen = new Set<string | number>();
  for (const evalCase of cases) {
    if (typeof evalCase !== "object" || evalCase === null) {
      throw new Error("Each eval must be an object");
    }
    if (
      (typeof evalCase.id !== "string" && typeof evalCase.id !== "number") ||
      seen.has(evalCase.id)
    ) {
      throw new Error("Each eval must have a unique string or integer id");
    }
    seen.add(evalCase.id);
    if (typeof evalCase.prompt !== "string" || !evalCase.prompt.trim()) {
      throw new Error(`Eval ${evalCase.id} must have a non-empty prompt`);
    }
    for (const field of ["subject", "language"] as const) if (typeof evalCase[field] !== "string" || !evalCase[field]!.trim()) throw new Error(`Eval ${evalCase.id} must have a non-empty ${field}`);
    if (typeof evalCase.target !== "object" || evalCase.target === null || typeof evalCase.target.kind !== "string") throw new Error(`Eval ${evalCase.id} must have a target with kind`);
    if (!Array.isArray(evalCase.preconditions) || !evalCase.preconditions.every(item => typeof item === "string")) throw new Error(`Eval ${evalCase.id} preconditions must be a list of strings`);
    if (!Array.isArray(evalCase.files) || !evalCase.files.every(item => typeof item === "string")) throw new Error(`Eval ${evalCase.id} files must be a list of strings`);
    const assertions = evalCase.assertions ?? [];
    if (!Array.isArray(assertions)) throw new Error(`Eval ${evalCase.id} assertions must be a list`);
    normalizeAssertions(assertions);
  }
  return cases;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, workerId: string) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  async function worker(workerIndex: number) {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await fn(items[current], `worker-${workerIndex + 1}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, (_, workerIndex) => worker(workerIndex)));
  return results;
}

export async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      agent: { type: "string" },
      "eval-set": { type: "string" },
      workspace: { type: "string" },
      "baseline-agent": { type: "string" },
      "goose-cli": { type: "string", default: process.env.AGENT_CREATOR_GOOSE_CLI ?? "goose" },
      model: { type: "string" },
      timeout: { type: "string", default: "600" },
      "max-turns": { type: "string", default: "20" },
      workers: { type: "string", default: "2" },
      "heartbeat-interval": { type: "string", default: "30" },
      "no-heartbeat": { type: "boolean", default: false },
      "transcript-retention": { type: "string", default: "retain" },
      "run-profile": { type: "string", default: "fast" },
    },
  });

  if (!values.agent || !values["eval-set"] || !values.workspace) {
    console.error(
      "usage: run_agent_eval.js --agent <file> --eval-set <file> --workspace <dir> [options]"
    );
    process.exit(2);
  }

  const agentPath = resolve(values.agent as string);
  const evalSetPath = resolve(values["eval-set"] as string);
  const fixtureRoot = dirname(dirname(evalSetPath));
  const agent = parseAgent(agentPath);
  const cases = validateEvalSet(JSON.parse(readFileSync(evalSetPath, "utf-8")));
  const workspace = resolve(values.workspace as string);
  mkdirSync(workspace, { recursive: true });
  const retention = parseRetentionPolicy({ transcript_retention: values["transcript-retention"] });

  const temporary = mkdtempSync(join(tmpdir(), "agent-baseline-"));
  let baselineConfiguration: string;
  let baselinePath: string;
  try {
    if (values["baseline-agent"]) {
      baselinePath = resolve(values["baseline-agent"] as string);
      const baseline = parseAgent(baselinePath);
      if (!values.model && (baseline.model ?? null) !== (agent.model ?? null)) throw new Error("current and baseline agents must declare the same model for paired equivalence unless --model pins both runs");
      baselineConfiguration = "old_agent";
    } else {
      const baselineName = `${agent.name}-baseline`;
      baselinePath = join(temporary, `${baselineName}.md`);
      writeFileSync(baselinePath, baselineAgent(agent, baselineName), "utf-8");
      baselineConfiguration = "without_agent_instructions";
    }

    const variantDocuments: Record<string, string> = {
      with_agent: readFileSync(agentPath, "utf-8"),
      [baselineConfiguration]: readFileSync(baselinePath, "utf-8"),
    };
    const runProfile: AgentRunProfile = parseAgentRunProfile(values["run-profile"]);
    const timeoutSeconds = Number(values.timeout), maxTurns = Number(values["max-turns"]);
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0 || !Number.isInteger(maxTurns) || maxTurns <= 0) throw new Error("--timeout and --max-turns must be positive; max-turns must be an integer");
    const gooseCommand = (values["goose-cli"] as string).split(/\s+/).filter(Boolean);
    for (const evalCase of cases) {
      const assertions = normalizeAssertions(evalCase.assertions ?? []);
      const evalDir = join(workspace, evalDirectoryName(evalCase.id));
      mkdirSync(evalDir, { recursive: true });
      const fixtureManifest = (evalCase.files ?? []).map(relative => ({ path: relative, sha256: evidenceSha256(readFileSync(resolve(fixtureRoot, relative))) }));
      const equivalence: PairEquivalence = { model: values.model as string | undefined ?? agent.model ?? null, tools: Array.isArray((evalCase.capabilities as any)?.tools) ? [...(evalCase.capabilities as any).tools].map(String).sort() : [], fixture_sha256: evidenceSha256(fixtureManifest), timeout_seconds: timeoutSeconds, max_turns: maxTurns };
      const executionSchedule = scheduleAgentPairs({ eval_id: evalCase.id, assertion_hash: assertionHash(assertions, variantDocuments), equivalence }, baselineConfiguration, runProfile);
      writeFileSync(join(evalDir, "eval_metadata.json"), JSON.stringify(redactValue({
        schema_version: 2,
        eval_id: evalCase.id,
        eval_name: evalCase.name ?? String(evalCase.id),
        prompt: evalCase.prompt,
        subject: evalCase.subject ?? "",
        language: evalCase.language ?? "",
        target: evalCase.target ?? {},
        preconditions: evalCase.preconditions ?? [],
        files: evalCase.files ?? [],
        capabilities: evalCase.capabilities ?? {},
        coverage_tags: evalCase.coverage_tags ?? [],
        assertions,
        variants: Object.keys(variantDocuments).sort(),
        variant_sources: variantManifest(variantDocuments),
        assertion_hash: assertionHash(assertions, variantDocuments),
        run_profile: runProfile,
        requested_pairs: executionSchedule.length,
        execution_schedule: executionSchedule,
        pair_equivalence: equivalence,
      }, { topLevel: false }), null, 2) + "\n");
    }

    const jobs: Array<{ evalCase: EvalCase; configuration: string; path: string; pair: AgentPairSchedule; equivalence: PairEquivalence }> = [];
    for (const evalCase of cases) {
      const metadata = JSON.parse(readFileSync(join(workspace, evalDirectoryName(evalCase.id), "eval_metadata.json"), "utf-8"));
      for (const pair of metadata.execution_schedule as AgentPairSchedule[]) for (const configuration of pair.order) jobs.push({ evalCase, configuration, path: configuration === "with_agent" ? agentPath : baselinePath, pair, equivalence: metadata.pair_equivalence });
    }

    const workers = Number(values.workers);
    const timeoutMs = timeoutSeconds * 1000;

    const jobStates: ExecutionStatus[] = jobs.map(() => "pending");
    const jobWorkers: Array<string | undefined> = jobs.map(() => undefined);
    const heartbeatStartedAt = Date.now();
    let heartbeatUpdatedAt = heartbeatStartedAt;
    let executionStatus = "running";
    let consumedTokens = 0;
    let consumedTurns = 0;
    const heartbeatPath = join(workspace, "execution_heartbeats.jsonl");
    const heartbeatIntervalMs = Number(values["heartbeat-interval"]) * 1000;
    if (!Number.isFinite(heartbeatIntervalMs) || heartbeatIntervalMs <= 0) throw new Error("--heartbeat-interval must be a positive number of seconds");
    const heartbeat = values["no-heartbeat"] ? undefined : createExecutionHeartbeat(
      () => ({
        tasks: jobStates.map((status, index) => ({ status, ...(jobWorkers[index] ? { worker: jobWorkers[index] } : {}), ...(values.model ? { model: values.model as string } : {}) })),
        models: values.model ? [values.model as string] : [],
        startedAt: heartbeatStartedAt,
        updatedAt: heartbeatUpdatedAt,
        checkpoint: { artifact_ref: "run_summary.json", completed_runs: jobStates.filter(status => status === "completed").length },
        budgets: {
          runs: { consumed: jobStates.filter(status => status === "completed" || status === "failed").length, limit: jobs.length },
          turns: { consumed: consumedTurns, limit: jobs.length * maxTurns },
          tokens: { consumed: consumedTokens },
        },
        status: executionStatus,
      }),
      event => appendFileSync(heartbeatPath, JSON.stringify(redactValue(event, { topLevel: false, redactProtectedKeys: false })) + "\n", "utf-8"),
      { intervalMs: heartbeatIntervalMs }
    );

    let results: RunResult[];
    try {
      const indexed = jobs.map((job, index) => ({ ...job, index }));
      const pairJobs = Array.from({ length: Math.ceil(indexed.length / 2) }, (_, index) => indexed.slice(index * 2, index * 2 + 2));
      const groupedResults = await mapLimit(pairJobs, workers, async (pairJobs, workerId) => {
        const pairResults: RunResult[] = [];
        // A pair is the scheduling unit: variants within it must execute in recorded order.
        for (const job of pairJobs) {
          jobWorkers[job.index] = workerId;
          jobStates[job.index] = "running";
          heartbeatUpdatedAt = Date.now();
          try {
            const result = await runCase(
              job.evalCase,
              job.configuration,
              job.path,
              workspace,
              gooseCommand,
              values.model as string | undefined,
              timeoutMs,
              maxTurns,
              fixtureRoot,
              retention.transcriptRetention,
              job.pair,
              job.equivalence,
              runProfile === "fast"
            );
            if (result.total_tokens !== null) consumedTokens += result.total_tokens;
            if (result.total_turns !== null) consumedTurns += result.total_turns;
            jobStates[job.index] = "completed";
            pairResults.push(result);
            console.log(`Completed eval ${result.eval_id} / ${result.configuration} (${result.total_duration_seconds}s)`);
          } catch (error) {
            jobStates[job.index] = "failed";
            throw error;
          } finally {
            heartbeatUpdatedAt = Date.now();
          }
        }
        return pairResults;
      });
      results = groupedResults.flat();
      executionStatus = "completed";
    } catch (error) {
      executionStatus = "failed";
      throw error;
    } finally {
      heartbeatUpdatedAt = Date.now();
      heartbeat?.stop();
    }

    const summary = {
      agent: agent.name,
      agent_path: redactString(agentPath),
      eval_count: cases.length,
      configurations: ["with_agent", baselineConfiguration],
      runs: results.sort((a, b) =>
        String(a.eval_id) === String(b.eval_id)
          ? a.configuration.localeCompare(b.configuration)
          : String(a.eval_id).localeCompare(String(b.eval_id))
      ),
    };
    writeFileSync(join(workspace, "run_summary.json"), `${JSON.stringify(redactValue(summary, { topLevel: false }), null, 2)}\n`);
    console.log(workspace);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (!import.meta.url.includes("/$bunfs/") && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    // Emit only known application diagnostics; arbitrary thrown values may be raw responses.
    const message = error instanceof Error ? redactString(error.message) : "evaluation failed; raw diagnostics withheld";
    console.error(message);
    process.exit(1);
  });
}
