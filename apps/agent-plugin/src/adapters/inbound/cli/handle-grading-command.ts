import type { Judge } from "../../../application/ports/judge.ts";
import type { JudgmentHistory, JudgmentRecord } from "../../../application/ports/judgment-history.ts";
import type { JudgmentStore, StoredGrading } from "../../../application/ports/judgment-store.ts";
import type { VerifiedAttemptReader } from "../../../application/ports/verified-attempt.ts";
import { gradeAttempt } from "../../../application/use-cases/grade-attempt.ts";
import { EvaluationError } from "../../../domain/evaluation.ts";
import type { JudgmentOutcome } from "../../../domain/judgment.ts";
import type { CliOutput } from "./cli-output.ts";

export interface GradingInput { campaignId: string; attemptId: string; registry?: string; json: boolean; agent: string; model?: string; maxTurns: number; timeout: number }
export interface JudgmentsInput { campaignId: string; attemptId?: string; registry?: string; json: boolean }
export type GradingHandler = (input: GradingInput) => Promise<void>;
export type JudgmentsHandler = (input: JudgmentsInput) => Promise<void>;
function validateSelection(input: JudgmentsInput): void {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(input.campaignId) || (input.attemptId !== undefined && !uuid.test(input.attemptId))) throw new EvaluationError("Campaign and attempt selectors must be UUIDs");
}
function summary(outcome: JudgmentOutcome): string {
  if (outcome.status === "technical-error") return "technical-error";
  const counts = { pass: 0, fail: 0, inconclusive: 0 };
  for (const judgment of outcome.judgments) counts[judgment.verdict]++;
  return `completed; pass ${counts.pass}; fail ${counts.fail}; inconclusive ${counts.inconclusive}`;
}
/** Validate before dependency factories; gradeAttempt constructs Judge only after proof verification. */
export function createGradingCommandHandler(output: CliOutput, dependencies: {
  createReader: (registry?: string) => VerifiedAttemptReader;
  createStore: (registry?: string) => JudgmentStore;
  createJudge: () => Judge; newId: () => string;
}): GradingHandler {
  return async function handleGradingCommand(input) {
    validateSelection(input);
    if (!input.attemptId) throw new EvaluationError("An explicit attempt UUID is required");
    if (input.agent !== "goose") throw new EvaluationError("Unsupported grading agent; only goose is supported");
    if (input.model !== undefined && !input.model.trim()) throw new EvaluationError("Judge model must be nonblank");
    if (!Number.isSafeInteger(input.maxTurns) || input.maxTurns < 1 || !Number.isSafeInteger(input.timeout) || input.timeout < 0 || input.timeout > 2147483) throw new EvaluationError("Invalid Judge execution limits");
    let grading: StoredGrading;
    try {
      grading = await gradeAttempt(input, { reader: dependencies.createReader(input.registry), store: dependencies.createStore(input.registry), createJudge: dependencies.createJudge, newId: dependencies.newId },
        { ...(input.model === undefined ? {} : { model: input.model }), maxTurns: input.maxTurns, timeout: input.timeout });
    } catch { throw new EvaluationError("Unable to grade verified attempt; no raw storage diagnostics are exposed"); }
    const result = { id: grading.id, campaignId: input.campaignId, attemptId: input.attemptId, ...grading.result };
    output.writeOut(input.json ? `${JSON.stringify(result, null, 2)}\n` : `Grading ${grading.id}: ${summary(grading.result.outcome)}\n`);
    if (grading.result.outcome.status === "technical-error") throw new EvaluationError("Judge technical failure recorded");
  };
}
/** Readback uses a readonly port and has no Judge/candidate dependency. */
export function createJudgmentsCommandHandler(output: CliOutput, createHistory: (registry?: string) => JudgmentHistory): JudgmentsHandler {
  return async function handleJudgmentsCommand(input) {
    validateSelection(input);
    let records: JudgmentRecord[];
    try { records = await createHistory(input.registry).list(input); }
    catch { throw new EvaluationError("Unable to read stored judgments; no raw storage diagnostics are exposed"); }
    output.writeOut(input.json ? `${JSON.stringify(records, null, 2)}\n` : records.length ? `${records.map(record => `${record.id}\t${record.createdAt}\tattempt ${record.attemptId}\t${summary(record.outcome)}`).join("\n")}\n` : "No judgments found.\n");
  };
}
