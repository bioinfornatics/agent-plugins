/** Frozen criterion identity and wording belong to the evaluation plan, not the judge. */
export interface JudgmentCriterion { id: string; text: string }
/** Supplied source data: sha256 is a claimed binding, not a digest computed by this module.
 * A caller requiring integrity must verify bytes through its boundary before supplying text.
 */
export type JudgmentArtifact = { path: string; sha256: string; kind: "text"; text: string }
  | { path: string; sha256: string; kind: "nontext" };
export interface JudgmentEvidence { path: string; sha256: string; quote: string }
export type JudgmentVerdict = "pass" | "fail" | "inconclusive";
export interface CriterionJudgment extends JudgmentCriterion {
  verdict: JudgmentVerdict; rationale: string; evidence: JudgmentEvidence[];
}
export type JudgmentOutcome = { status: "completed"; judgments: CriterionJudgment[] }
  | { status: "technical-error"; message: string };
export interface AnthropicGrading {
  expectations: { text: string; passed: boolean; evidence: string }[];
  summary: { passed: number; failed: number; total: number; pass_rate: number };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function nonblank(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be nonempty text`);
  return value;
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}
function digest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-fA-F0-9]{64}$/.test(value)) throw new Error("sha256 must be a 64-character hexadecimal binding");
  return value;
}
function fields(value: Record<string, unknown>, allowed: string[], label: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error(`${label} contains unsupported fields`);
}
function frozenCriteria(value: unknown): JudgmentCriterion[] {
  const ids = new Set<string>();
  return array(value, "criteria").map((entry) => {
    const criterion = record(entry, "criterion");
    const id = nonblank(criterion.id, "criterion id"), text = nonblank(criterion.text, "criterion text");
    if (ids.has(id)) throw new Error("Duplicate frozen criterion id");
    ids.add(id);
    return { id, text };
  });
}
function suppliedArtifacts(value: unknown): Map<string, JudgmentArtifact> {
  const sources = new Map<string, JudgmentArtifact>();
  for (const entry of array(value, "artifacts")) {
    const artifact = record(entry, "artifact");
    const path = nonblank(artifact.path, "artifact path"), sha256 = digest(artifact.sha256);
    if (sources.has(path)) throw new Error("Duplicate artifact path");
    if (artifact.kind === "text" && typeof artifact.text === "string") sources.set(path, { path, sha256, kind: "text", text: artifact.text });
    else if (artifact.kind === "nontext") sources.set(path, { path, sha256, kind: "nontext" });
    else throw new Error("Artifact must be supplied text or explicit nontext");
  }
  return sources;
}
function matchedEvidence(value: unknown, sources: Map<string, JudgmentArtifact>): JudgmentEvidence[] {
  return array(value, "evidence").map((entry) => {
    const reference = record(entry, "evidence reference");
    fields(reference, ["path", "sha256", "quote"], "evidence reference");
    const path = nonblank(reference.path, "evidence path"), sha256 = digest(reference.sha256);
    const quote = reference.quote, source = sources.get(path);
    if (!source || source.sha256 !== sha256) throw new Error("Evidence path/sha256 does not match a supplied artifact");
    if (source.kind !== "text") throw new Error("Nontext evidence requires explicit observation, not a text citation");
    // Empty substring matches everything in JS; permit it only for an actually empty
    // inspected file. A fail may cite inspected text showing absence; semantics remain the judge's responsibility.
    if (typeof quote !== "string" || (quote === "" ? source.text !== "" : !source.text.includes(quote))) throw new Error("Evidence quote must be an exact excerpt of supplied text");
    return { path, sha256, quote };
  });
}

/** Validate untrusted judgment data against frozen criteria and supplied source bindings.
 * Does not parse/execute artifact content, calculate SHA digests, or verify semantic reasoning.
 * Completed means full criterion coverage, including inconclusive, not necessarily a passing grade.
 * Missing citations are allowed only for inconclusive. All returned data is detached from inputs.
 */
export function validateJudgment(criteria: unknown, artifacts: unknown, outcome: unknown): JudgmentOutcome {
  const frozen = frozenCriteria(criteria), sources = suppliedArtifacts(artifacts);
  const input = record(outcome, "judgment outcome");
  if (input.status === "technical-error") {
    fields(input, ["status", "message"], "technical-error outcome");
    return { status: "technical-error", message: nonblank(input.message, "technical-error message") };
  }
  if (input.status !== "completed") throw new Error("Unknown judgment outcome status");
  fields(input, ["status", "judgments"], "completed outcome");
  const byId = new Map<string, CriterionJudgment>();
  const criteriaById = new Map(frozen.map((criterion) => [criterion.id, criterion]));
  for (const entry of array(input.judgments, "judgments")) {
    const judgment = record(entry, "judgment");
    // Judge text is ignored; frozen text is authoritative. Booleans/metrics or other
    // protocol fields are not canonical verdicts and must not silently enter the result.
    fields(judgment, ["id", "text", "verdict", "rationale", "evidence"], "judgment");
    const id = nonblank(judgment.id, "judgment id"), criterion = criteriaById.get(id);
    if (!criterion) throw new Error("Judgment references a surplus criterion");
    if (byId.has(id)) throw new Error("Duplicate criterion judgment");
    const verdict = judgment.verdict;
    if (verdict !== "pass" && verdict !== "fail" && verdict !== "inconclusive") throw new Error("Invalid judgment verdict");
    const rationale = nonblank(judgment.rationale, "judgment rationale");
    const evidence = matchedEvidence(judgment.evidence === undefined && verdict === "inconclusive" ? [] : judgment.evidence, sources);
    if (verdict !== "inconclusive" && !evidence.length) throw new Error("Decisive judgment requires inspected text evidence");
    byId.set(id, { ...criterion, verdict, rationale, evidence });
  }
  const judgments = frozen.map((criterion) => {
    const judgment = byId.get(criterion.id);
    if (!judgment) throw new Error("Missing criterion judgment");
    return judgment;
  });
  return { status: "completed", judgments };
}

/** Strict readable Anthropic grading projection (references/schemas.md grading.json).
 * Revalidates at this public seam: forged canonical-looking objects cannot bypass checks.
 * No metrics/timing are manufactured; unavailable telemetry is simply not projected.
 */
export function toAnthropicGrading(criteria: unknown, artifacts: unknown, outcome: unknown): AnthropicGrading {
  const result = validateJudgment(criteria, artifacts, outcome);
  if (result.status === "technical-error") throw new Error(`Cannot project technical-error: ${result.message}`);
  if (!result.judgments.length) throw new Error("Cannot project grading with no criteria");
  if (result.judgments.some((judgment) => judgment.verdict === "inconclusive")) throw new Error("Cannot project grading with inconclusive judgments");
  const expectations = result.judgments.map((judgment) => ({
    text: judgment.text,
    passed: judgment.verdict === "pass",
    evidence: [judgment.rationale, ...judgment.evidence.map((reference) => `${reference.path} (sha256: ${reference.sha256}): ${JSON.stringify(reference.quote)}`)].join("\n"),
  }));
  const passed = expectations.filter((expectation) => expectation.passed).length, total = expectations.length;
  return { expectations, summary: { passed, failed: total - passed, total, pass_rate: passed / total } };
}
