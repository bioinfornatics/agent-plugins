import type { JudgmentHistory, JudgmentRecord } from "../ports/judgment-history.ts";
import type { VerifiedAttempt, VerifiedAttemptReader } from "../ports/verified-attempt.ts";
import { exportLimits, type ExportWriter } from "../ports/export-writer.ts";
import { toAnthropicGrading, type AnthropicGrading } from "../../domain/judgment.ts";
import { qualityBenchmark } from "../../domain/quality-benchmark.ts";

export { exportLimits } from "../ports/export-writer.ts";
export interface ExportSelection { campaignId: string; gradingIds: string[]; output: string; benchmark: boolean }
export interface ExportRun { attempt: VerifiedAttempt; grade: JudgmentRecord; grading: AnthropicGrading; evalId: number }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateExportSelection(input: ExportSelection): void {
  if (!uuid.test(input.campaignId) || !input.gradingIds.length || input.gradingIds.length > exportLimits.selectedGrades ||
    input.gradingIds.some(id => !uuid.test(id)) || new Set(input.gradingIds).size !== input.gradingIds.length) throw new Error("Explicit unique campaign/grading UUIDs required (maximum 1000 grades)");
  if (!input.output.trim()) throw new Error("New export output directory required");
}
/** Readonly orchestration: history authenticates stored bindings; every selected
 * corresponding archive is reverified, never a latest-attempt/latest-grade fallback. */
export async function exportCampaign(input: ExportSelection, dependencies: {
  history: JudgmentHistory; reader: VerifiedAttemptReader; writer: ExportWriter; now: () => string;
}): Promise<{ kind: "workspace" | "quality-only-benchmark"; runs: number }> {
  input = structuredClone(input);
  validateExportSelection(input);
  const timestamp = dependencies.now();
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(timestamp) || new Date(timestamp).toISOString() !== timestamp) throw new Error("Invalid export timestamp");
  const records = await dependencies.history.list({ campaignId: input.campaignId });
  const runs: ExportRun[] = [], trials = new Set<string>();
  let retained = 0;
  for (const id of input.gradingIds) {
    const matches = records.filter(record => record.id === id);
    if (matches.length !== 1) throw new Error("Unknown or ambiguous selected grade");
    const grade = matches[0];
    if (!grade || grade.campaignId !== input.campaignId || trials.has(grade.trialId)) throw new Error("Select one grade per logical trial");
    trials.add(grade.trialId);
    const attempt = await dependencies.reader.readAttempt({ campaignId: input.campaignId, attemptId: grade.attemptId });
    if (attempt.campaignId !== grade.campaignId || attempt.attemptId !== grade.attemptId || attempt.trialId !== grade.trialId ||
      attempt.manifestDigest !== grade.manifestDigest || attempt.evidenceDigest !== grade.evidenceDigest) throw new Error("Selected grade differs from verified attempt bindings");
    for (const artifact of attempt.artifacts) retained += artifact.content.length;
    if (retained > exportLimits.totalBytes) throw new Error("Export total byte bound exceeded");
    const grading = toAnthropicGrading(attempt.request.criteria, attempt.request.artifacts, grade.outcome);
    runs.push({ attempt, grade, grading, evalId: 0 });
  }
  const scenarioIds = [...new Set(runs.map(run => run.attempt.metadata.scenario.id))].sort();
  const layouts = new Set<string>();
  for (const run of runs) {
    run.evalId = scenarioIds.indexOf(run.attempt.metadata.scenario.id) + 1;
    const m = run.attempt.metadata;
    if (!Number.isSafeInteger(m.repetition) || m.repetition < 1 || !["with", "without"].includes(m.condition)) throw new Error("Invalid run metadata");
    const layout = `${run.evalId}/${m.condition}/${m.repetition}`;
    if (layouts.has(layout)) throw new Error("Selected agents collide in workspace layout; export separately");
    layouts.add(layout);
  }
  runs.sort((a, b) => a.evalId - b.evalId || (a.attempt.metadata.condition === b.attempt.metadata.condition ? a.attempt.metadata.repetition - b.attempt.metadata.repetition : a.attempt.metadata.condition === "with" ? -1 : 1));
  const benchmark = input.benchmark ? qualityBenchmark(runs, timestamp) : undefined;
  const files: { path: string; content: Uint8Array }[] = [];
  let total = 0;
  const encoder = new TextEncoder();
  function add(path: string, content: Uint8Array) {
    total += content.length;
    if (total > exportLimits.totalBytes) throw new Error("Export total byte bound exceeded");
    files.push({ path, content });
  }
  function json(path: string, value: unknown) {
    const bytes = encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
    if (bytes.length > exportLimits.jsonBytes) throw new Error("Export JSON byte bound exceeded");
    add(path, bytes);
  }
  const mapping = [];
  for (const run of runs) {
    const { attempt, grade, evalId, grading } = run, m = attempt.metadata;
    const scenarioRoot = `iteration-1/eval-${evalId}`;
    const root = `${scenarioRoot}/${m.condition === "with" ? "with_skill" : "without_skill"}/run-${m.repetition}`;
    const metadata = { eval_id: evalId, prompt: attempt.request.task, expectations: attempt.request.criteria.map(c => c.text), ...m.scenario };
    if (!files.some(file => file.path === `${scenarioRoot}/eval_metadata.json`)) json(`${scenarioRoot}/eval_metadata.json`, metadata);
    json(`${root}/eval_metadata.json`, metadata);
    json(`${root}/grading.json`, grading);
    // Preserve original safe paths. A top-level JSON transcript is accessible in the
    // shallow upstream viewer; do not infer a final answer from arbitrary trace text.
    const conversation = attempt.artifacts.find(a => a.path === "goose/conversation.json");
    if (conversation) add(`${root}/outputs/transcript.json`, conversation.content);
    else json(`${root}/outputs/artifact-index.json`, { note: "No named conversation available; original artifacts preserved under artifacts/", paths: attempt.artifacts.map(a => a.path) });
    for (const artifact of attempt.artifacts) add(`${root}/outputs/artifacts/${artifact.path}`, artifact.content);
    mapping.push({ evalId, path: root, campaignId: attempt.campaignId, trialId: attempt.trialId, attemptId: attempt.attemptId, gradeId: grade.id,
      manifestDigest: attempt.manifestDigest, evidenceDigest: attempt.evidenceDigest, requestDigest: grade.requestDigest,
      ...m, judge: grade.provenance, gradeCreatedAt: grade.createdAt });
  }
  if (benchmark) {
    json("iteration-1/benchmark.json", benchmark);
    add("iteration-1/benchmark.md", encoder.encode(`# Quality-only benchmark\n\n${benchmark.notes.join("\n\n")}\n\nWith profile pass rate: ${benchmark.run_summary.with_skill.pass_rate.mean}\n\nWithout profile pass rate: ${benchmark.run_summary.without_skill.pass_rate.mean}\n\nDelta (with minus without): ${benchmark.run_summary.delta.pass_rate}\n`));
  }
  // Writer hashes sorted actual bytes and writes this manifest last, before removing pending.
  json("export-manifest.json", { schemaVersion: 1, method: "agent-plugin-explicit-quality-v1", timestamp, campaignId: input.campaignId,
    kind: benchmark ? "quality-only-benchmark" : "workspace", benchmark: benchmark ? { availability: "quality-only" } : { availability: "absent", reason: "not-requested" },
    selection: { gradingIds: input.gradingIds, strategy: "explicit-one-grade-per-logical-trial" }, limits: exportLimits,
    limitations: ["Experimental projection; effective candidate and judge models unknown", "No duration/token/cost/tool-call/error telemetry inferred", "Readiness requires parseable complete manifest and absent pending marker; pending marker signals incomplete export after interruption; no crash atomicity or automatic cleanup promised", "Original nested artifacts retained; shallow viewer sees transcript or artifact index"], runs: mapping });
  await dependencies.writer.publish(input.output, files, [...new Set(runs.flatMap(run => run.attempt.metadata.protectedRoots))]);
  return { kind: benchmark ? "quality-only-benchmark" : "workspace", runs: runs.length };
}
