import type { CandidateModelEvidence, ConfiguredCandidateModel } from "../../domain/candidate-model.ts";
import type { CampaignOverviewSnapshot } from "../ports/campaign-overview-history.ts";
import type { JudgmentRecord } from "../ports/judgment-history.ts";
import type { JudgeProvenance } from "../ports/judge.ts";
import type { ExportRun } from "./export-campaign.ts";

export interface CampaignOverview {
  schemaVersion: 1;
  campaignId: string;
  profile: CampaignOverviewSnapshot["profile"];
  candidateModel: { source: "override" | "configuration-default"; requested?: string; effective: "unknown"; configured?: Record<string, ConfiguredCandidateModel> };
  trials: (CampaignOverviewSnapshot["trials"][number] & {
    model?: CandidateModelEvidence;
    selectedGradeId: string | null;
    grades: { id: string; attemptId: string; status: "completed" | "technical-error";
      outcomeClass: "decisive" | "inconclusive" | "technical-error"; judge: JudgeProvenance | null }[];
    score: null | { passed: number; failed: number; total: number; passRate: number };
  })[];
}
/** Metadata-only grades never supply scores. Selected runs have already passed the
 * current verified reader and strict decisive grading projection in exportCampaign.
 * Model observations are selected receipt metadata, never history-derived backend proof. */
export function campaignOverview(snapshot: CampaignOverviewSnapshot, records: JudgmentRecord[], selected: ExportRun[]): CampaignOverview {
  const ids = new Set<string>();
  for (const record of records) {
    if (record.campaignId !== snapshot.campaignId || ids.has(record.id) || !snapshot.trials.some(t => t.trialId === record.trialId) || record.status !== record.outcome.status) throw new Error("Invalid overview grade binding");
    ids.add(record.id);
  }
  const trials = snapshot.trials.map(trial => {
    const run = selected.find(run => run.grade.trialId === trial.trialId);
    if (run) {
      const m = run.attempt.metadata;
      if (run.attempt.campaignId !== snapshot.campaignId || run.attempt.attemptId !== trial.attemptId || trial.status !== "finalized" || m.receipt.status !== trial.attemptStatus ||
        m.profile.id !== snapshot.profile.id || m.profile.name !== snapshot.profile.name || m.profile.revision !== snapshot.profile.revision ||
        m.scenario.id !== trial.scenarioId || m.scenario.source.skillName !== trial.source.skillName || m.scenario.source.pluginName !== trial.source.pluginName ||
        m.agent !== trial.agent || m.repetition !== trial.repetition || m.pairId !== trial.pairId || m.condition !== trial.condition || m.options.model !== snapshot.options.model || JSON.stringify(m.options.candidateModels ?? null) !== JSON.stringify(snapshot.options.candidateModels ?? null)) throw new Error("Selected run differs from frozen overview bindings");
    }
    const grades = records.filter(record => record.trialId === trial.trialId).map(record => ({
      id: record.id, attemptId: record.attemptId, status: record.status,
      outcomeClass: record.outcome.status === "technical-error" ? "technical-error" as const : record.outcome.judgments.length === 0 || record.outcome.judgments.some(j => j.verdict === "inconclusive") ? "inconclusive" as const : "decisive" as const,
      judge: record.provenance,
    }));
    const summary = run?.grading.summary;
    return { ...trial, ...(run?.attempt.metadata.receipt.model === undefined ? {} : { model: structuredClone(run.attempt.metadata.receipt.model) }), selectedGradeId: run?.grade.id ?? null, grades,
      score: summary ? { passed: summary.passed, failed: summary.failed, total: summary.total, passRate: summary.pass_rate } : null };
  });
  if (selected.some(run => !trials.some(t => t.selectedGradeId === run.grade.id))) throw new Error("Selected grade missing from frozen overview");
  return { schemaVersion: 1, campaignId: snapshot.campaignId, profile: snapshot.profile,
    candidateModel: { source: snapshot.options.model === undefined ? "configuration-default" : "override", ...(snapshot.options.model === undefined ? {} : { requested: snapshot.options.model }), effective: "unknown", ...(snapshot.options.candidateModels === undefined ? {} : { configured: structuredClone(snapshot.options.candidateModels) }) }, trials };
}
