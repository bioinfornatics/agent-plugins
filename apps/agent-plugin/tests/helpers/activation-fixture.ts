import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CandidateHost } from "../../src/application/ports/candidate-host.ts";
import type { TrialRequest, TrialResult } from "../../src/domain/execution.ts";
import { FilesystemEvaluationSource } from "../../src/adapters/outbound/filesystem/filesystem-evaluation-source.ts";
import { FilesystemActivationCaseSource } from "../../src/adapters/outbound/filesystem/activation-case-source.ts";
import { SqliteEvaluationStore } from "../../src/adapters/outbound/storage/sqlite-evaluation-store.ts";
import { SqliteEvaluationHistory } from "../../src/adapters/outbound/storage/sqlite-evaluation-history.ts";
import { SqliteVerifiedAttemptReader } from "../../src/adapters/outbound/storage/sqlite-verified-attempt.ts";
import { GooseActivationObserver } from "../../src/adapters/outbound/hosts/goose/goose-activation.ts";
import { FilesystemActivationResultWriter } from "../../src/adapters/outbound/reporting/activation-result-writer.ts";
import { prepareActivationTrials, type ActivationRunDependencies } from "../../src/application/use-cases/run-activation-trials.ts";

// Goose 1.57.0 export shapes, as in goose-activation.test.ts (product §31 exact loader header).
const BODY = "Draft the alpha capability plan before touching any repository file.\nVerify every alpha capability step against its acceptance evidence.";
export const SKILL_MD = `---\nname: alpha\ndescription: Alpha capability used by activation fixtures.\n---\n\n# Alpha\n\n${BODY}\n`;
export function conversation(scenarioId: string): unknown[] {
  if (!scenarioId.endsWith("/yes")) return [{ role: "assistant", content: [{ type: "text", text: "Answered directly; I used the alpha Skill." }] }];
  return [
    { role: "assistant", content: [{ type: "toolRequest", id: "call-1", toolCall: { status: "success", value: { name: "load_skill", arguments: { name: "alpha" } } } }] },
    { role: "user", content: [{ type: "toolResponse", id: "call-1", toolResult: { status: "success", value: { content: [{ type: "text", text: `# Loaded Skill: alpha (skill)\n\n${BODY}` }], isError: false } } }] },
  ];
}
export function trialResult(request: TrialRequest, status: TrialResult["status"] = "completed"): TrialResult {
  return { status, exitCode: status === "completed" ? 0 : null, collection: status === "completed" ? "complete" : "partial", sessionName: request.id,
    host: { id: "goose", version: "1.57.0-fake" }, startedAt: "start", finishedAt: "end", limitations: [],
    artifacts: [{ path: "goose/conversation.json", content: Buffer.from(JSON.stringify({ conversation: conversation(request.scenario.id) })) }] };
}
/** Scenario "yes" loads the Skill, "no" answers directly, "slow" times out. Records every request. */
export function fakeHost(requests: TrialRequest[], reject?: (request: TrialRequest) => boolean): CandidateHost {
  return { sandboxes: ["bubblewrap"], preflight: async () => {}, run: async request => {
    requests.push(structuredClone(request));
    if (reject?.(request)) throw new Error("host rejected");
    return trialResult(request, request.scenario.id.endsWith("/slow") ? "timeout" : "completed");
  } };
}

export const QUERIES = { cases: [
  { id: "yes", query: "Please plan the alpha capability for my repository", should_trigger: true },
  { id: "no", query: "What is the capital of France?", should_trigger: false },
  { id: "slow", query: "Draft an alpha plan slowly", should_trigger: true },
] };

export async function activationFixture(roots: string[], queries: unknown = QUERIES, repetitions = 1) {
  const root = await mkdtemp(join(tmpdir(), "activation-test-")); roots.push(root);
  const skill = join(root, "alpha");
  await mkdir(skill, { recursive: true });
  await writeFile(join(skill, "SKILL.md"), SKILL_MD);
  const queriesFile = join(root, "queries.json");
  await writeFile(queriesFile, JSON.stringify(queries));
  const registry = join(root, "registry", "evaluations.sqlite");
  const input = { skills: [skill], plugins: [], queries: queriesFile, agents: ["goose"], repetitions, maxTurns: 10, timeout: 300, parallelism: 2, sandbox: "bubblewrap" as const };
  const plan = await prepareActivationTrials(input, new FilesystemEvaluationSource(), new FilesystemActivationCaseSource());
  const dependencies = (host: CandidateHost): ActivationRunDependencies => ({ hosts: new Map([["goose", host]]), store: new SqliteEvaluationStore(join(root, "campaigns"), registry, "hive"),
    newAttemptId: randomUUID, history: new SqliteEvaluationHistory(registry), reader: new SqliteVerifiedAttemptReader(registry), observer: new GooseActivationObserver(), writer: new FilesystemActivationResultWriter() });
  return { root, skill, queriesFile, registry, input, plan, dependencies };
}
