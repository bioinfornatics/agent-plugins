/**
 * Versioned, closed JSON contracts for host-delegated semantic grading
 * (ADR 0001: ../../../skills/skill-creator/references/adr/0001-host-delegated-semantic-grading.md).
 *
 * A GradingRequest is the blinded, deterministic unit Skill Creator prepares
 * for a single grader invocation slot; a GradingJudgment is the structured
 * verdict a delegated grader subagent returns. Both schemas reject unknown
 * fields and non-finite numeric data, and every cross-reference is bound by
 * SHA-256 so an import step can detect forgery, staleness, or replay without
 * trusting the delegating host's bookkeeping.
 *
 * This module defines and validates the contracts only. It does not invoke a
 * grader, orchestrate delegation, or persist durable import state — that is
 * scoped to ap-8di.3/ap-8di.4.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "./anytime_quality.js";

export const GRADING_REQUEST_SCHEMA_VERSION = "1.0" as const;
export const GRADING_REQUEST_KIND = "skill-creator-delegated-grading-request" as const;
export const GRADING_JUDGMENT_SCHEMA_VERSION = "1.0" as const;
export const GRADING_JUDGMENT_KIND = "skill-creator-delegated-grading-judgment" as const;

/** Configuration-revealing tokens a blinded candidate alias must never contain. */
const CONFIGURATION_TOKENS = [
  "with_skill", "without_skill", "with_agent", "without_agent",
  "new_skill", "old_skill", "candidate", "baseline",
  "pass", "fail", "grade", "verdict", "winner",
];

const MAX_INSTRUCTIONS_BYTES = 4096;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_PROMPT_BYTES = 64 * 1024;
const MAX_EVIDENCE_QUOTE_BYTES = 8192;
const MAX_RATIONALE_BYTES = 4096;
const SHA256_RE = /^[a-f0-9]{64}$/;
const INVOCATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ALIAS_RE = /^variant-[a-f0-9]{12}$/;

export interface GradingRequestAssertion {
  id: string;
  version: number;
  criterion: string;
}

export interface GradingRequestBindings {
  assertion_sha256: string;
  variant_sha256: string;
  output_sha256: string;
}

export interface GradingRequestGrader {
  model: string;
  provider: string;
}

/**
 * A single blinded grading request. Carries exactly one atomic assertion, an
 * anonymized candidate alias/output pair, deterministic bindings, and fixed
 * bounded instructions. Never carries a configuration label (`with_skill`,
 * `baseline`, etc.), another grader's identity, or any prior verdict.
 */
export interface GradingRequest {
  schema_version: "1.0";
  kind: "skill-creator-delegated-grading-request";
  invocation_id: string;
  prompt: string;
  candidate: { alias: string; output: string };
  assertion: GradingRequestAssertion;
  instructions: string;
  bindings: GradingRequestBindings;
  grader: GradingRequestGrader;
  request_sha256: string;
}

export interface GradingJudgmentGrader {
  id: string;
  model: string;
  provider: string;
}

/**
 * A single imported judgment. Every field required to re-derive trust is
 * present: the exact request it answers (`request_sha256`), the exact
 * evidence/assertion/variant/output it is bound to, and the grader identity
 * that produced it. `usage` is optional telemetry only and never affects
 * validity.
 */
export interface GradingJudgment {
  schema_version: "1.0";
  kind: "skill-creator-delegated-grading-judgment";
  invocation_id: string;
  request_sha256: string;
  bindings: GradingRequestBindings;
  grader: GradingJudgmentGrader;
  verdict: "pass" | "fail" | "inconclusive";
  evidence_quote: string;
  rationale: string;
  usage: Record<string, number> | null;
  judgment_sha256: string;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  const actual = Object.keys(value).sort().join("\0");
  const expected = [...keys].sort().join("\0");
  if (actual !== expected) throw new TypeError(`${label} has an invalid shape`);
}

function boundedString(value: unknown, label: string, maxBytes: number, { allowEmpty = false } = {}): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  if (!allowEmpty && value.length === 0) throw new TypeError(`${label} must not be empty`);
  if (Buffer.byteLength(value, "utf8") > maxBytes) throw new TypeError(`${label} exceeds the ${maxBytes}-byte bound`);
  return value;
}

function finiteInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive finite integer`);
  }
  return value;
}

function sha256Field(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256_RE.test(value)) throw new TypeError(`${label} must be a 64-character lowercase hex SHA-256`);
  return value;
}

function invocationId(value: unknown, label = "invocation_id"): string {
  if (typeof value !== "string" || !INVOCATION_ID_RE.test(value)) {
    throw new TypeError(`${label} must be a 1-128 character portable token`);
  }
  return value;
}

function assertNoConfigurationLeak(alias: string): void {
  const lowered = alias.toLowerCase();
  for (const token of CONFIGURATION_TOKENS) {
    if (lowered.includes(token)) {
      throw new TypeError(`candidate alias must not reveal configuration or grading state ("${token}" found)`);
    }
  }
}

function validateAssertion(value: unknown): GradingRequestAssertion {
  if (!isPlainObject(value)) throw new TypeError("assertion must be an object");
  exactKeys(value, ["id", "version", "criterion"], "assertion");
  const id = boundedString(value.id, "assertion.id", 256);
  const version = finiteInteger(value.version, "assertion.version");
  const criterion = boundedString(value.criterion, "assertion.criterion", 4096);
  return { id, version, criterion };
}

function validateBindings(value: unknown): GradingRequestBindings {
  if (!isPlainObject(value)) throw new TypeError("bindings must be an object");
  exactKeys(value, ["assertion_sha256", "variant_sha256", "output_sha256"], "bindings");
  return {
    assertion_sha256: sha256Field(value.assertion_sha256, "bindings.assertion_sha256"),
    variant_sha256: sha256Field(value.variant_sha256, "bindings.variant_sha256"),
    output_sha256: sha256Field(value.output_sha256, "bindings.output_sha256"),
  };
}

function validateRequestGrader(value: unknown): GradingRequestGrader {
  if (!isPlainObject(value)) throw new TypeError("grader must be an object");
  exactKeys(value, ["model", "provider"], "grader");
  return {
    model: boundedString(value.model, "grader.model", 256),
    provider: boundedString(value.provider, "grader.provider", 256),
  };
}

/**
 * Validates a prepared grading request against the closed v1.0 shape.
 * Rejects unknown fields, non-finite data, oversized bounded strings, and
 * any candidate alias that leaks a configuration label. Recomputes
 * `request_sha256` and rejects a stale or forged value.
 */
export function validateGradingRequest(value: unknown): GradingRequest {
  if (!isPlainObject(value)) throw new TypeError("grading request must be an object");
  exactKeys(value, [
    "schema_version", "kind", "invocation_id", "prompt", "candidate",
    "assertion", "instructions", "bindings", "grader", "request_sha256",
  ], "grading request");
  if (value.schema_version !== GRADING_REQUEST_SCHEMA_VERSION) throw new TypeError("grading request schema_version must be \"1.0\"");
  if (value.kind !== GRADING_REQUEST_KIND) throw new TypeError(`grading request kind must be "${GRADING_REQUEST_KIND}"`);
  const invocation_id = invocationId(value.invocation_id);
  const prompt = boundedString(value.prompt, "prompt", MAX_PROMPT_BYTES);
  if (!isPlainObject(value.candidate)) throw new TypeError("candidate must be an object");
  exactKeys(value.candidate, ["alias", "output"], "candidate");
  const alias = boundedString(value.candidate.alias, "candidate.alias", 64);
  if (!ALIAS_RE.test(alias)) throw new TypeError("candidate.alias must match \"variant-<12 hex chars>\"");
  assertNoConfigurationLeak(alias);
  const output = boundedString(value.candidate.output, "candidate.output", MAX_OUTPUT_BYTES, { allowEmpty: true });
  const assertion = validateAssertion(value.assertion);
  const instructions = boundedString(value.instructions, "instructions", MAX_INSTRUCTIONS_BYTES);
  const bindings = validateBindings(value.bindings);
  const grader = validateRequestGrader(value.grader);
  const request_sha256 = sha256Field(value.request_sha256, "request_sha256");
  const canonical: Omit<GradingRequest, "request_sha256"> = {
    schema_version: GRADING_REQUEST_SCHEMA_VERSION, kind: GRADING_REQUEST_KIND, invocation_id, prompt,
    candidate: { alias, output }, assertion, instructions, bindings, grader,
  };
  if (request_sha256 !== sha256(canonical)) throw new TypeError("request_sha256 does not match the canonical request contents");
  return { ...canonical, request_sha256 };
}

/**
 * Builds and self-hashes a grading request. Throws the same closed-shape
 * errors as `validateGradingRequest` if the constructed value would be
 * invalid (e.g. an alias accidentally carrying a configuration token).
 */
export function buildGradingRequest(input: {
  invocationId: string; prompt: string; candidateAlias: string; candidateOutput: string;
  assertion: GradingRequestAssertion; instructions: string; bindings: GradingRequestBindings; grader: GradingRequestGrader;
}): GradingRequest {
  const canonical: Omit<GradingRequest, "request_sha256"> = {
    schema_version: GRADING_REQUEST_SCHEMA_VERSION,
    kind: GRADING_REQUEST_KIND,
    invocation_id: input.invocationId,
    prompt: input.prompt,
    candidate: { alias: input.candidateAlias, output: input.candidateOutput },
    assertion: input.assertion,
    instructions: input.instructions,
    bindings: input.bindings,
    grader: input.grader,
  };
  return validateGradingRequest({ ...canonical, request_sha256: sha256(canonical) });
}

/**
 * Validates a bundle (array) of grading requests and rejects duplicate
 * `invocation_id` values within the bundle. This is the deterministic,
 * offline-checkable half of duplicate/replay rejection; cross-bundle replay
 * (an invocation_id reused across separate prepare-grading calls) must be
 * checked against durable prior-invocation state by the caller using
 * `assertNoInvocationReplay`.
 */
export function validateGradingRequestBundle(values: unknown): GradingRequest[] {
  if (!Array.isArray(values)) throw new TypeError("grading request bundle must be an array");
  const requests = values.map(validateGradingRequest);
  const seen = new Set<string>();
  for (const request of requests) {
    if (seen.has(request.invocation_id)) throw new TypeError(`duplicate invocation_id in bundle: ${request.invocation_id}`);
    seen.add(request.invocation_id);
  }
  return requests;
}

/**
 * Rejects a replayed invocation_id against an externally maintained set of
 * previously consumed IDs (durable import state owned by the caller). Adds
 * the ID to the set only after acceptance so a caller can process a bundle
 * transactionally.
 */
export function assertNoInvocationReplay(consumed: Set<string>, invocation_id: string): void {
  if (consumed.has(invocation_id)) throw new TypeError(`invocation_id has already been consumed: ${invocation_id}`);
}

function validateJudgmentGrader(value: unknown): GradingJudgmentGrader {
  if (!isPlainObject(value)) throw new TypeError("judgment grader must be an object");
  exactKeys(value, ["id", "model", "provider"], "judgment grader");
  return {
    id: boundedString(value.id, "grader.id", 256),
    model: boundedString(value.model, "grader.model", 256),
    provider: boundedString(value.provider, "grader.provider", 256),
  };
}

function validateUsage(value: unknown): Record<string, number> | null {
  if (value === null) return null;
  if (!isPlainObject(value)) throw new TypeError("usage must be an object or null");
  const result: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "number" || !Number.isFinite(item) || item < 0) throw new TypeError(`usage.${key} must be a non-negative finite number`);
    result[key] = item;
  }
  return result;
}

/**
 * Validates an imported grading judgment against the closed v1.0 shape and
 * recomputes `judgment_sha256`, rejecting any stale or forged value. Binding
 * to the originating request is verified separately by
 * `bindJudgmentToRequest`, since a judgment schema alone cannot know which
 * request it answers.
 */
export function validateGradingJudgment(value: unknown): GradingJudgment {
  if (!isPlainObject(value)) throw new TypeError("grading judgment must be an object");
  exactKeys(value, [
    "schema_version", "kind", "invocation_id", "request_sha256", "bindings",
    "grader", "verdict", "evidence_quote", "rationale", "usage", "judgment_sha256",
  ], "grading judgment");
  if (value.schema_version !== GRADING_JUDGMENT_SCHEMA_VERSION) throw new TypeError("grading judgment schema_version must be \"1.0\"");
  if (value.kind !== GRADING_JUDGMENT_KIND) throw new TypeError(`grading judgment kind must be "${GRADING_JUDGMENT_KIND}"`);
  const invocation_id = invocationId(value.invocation_id);
  const request_sha256 = sha256Field(value.request_sha256, "request_sha256");
  const bindings = validateBindings(value.bindings);
  const grader = validateJudgmentGrader(value.grader);
  if (!["pass", "fail", "inconclusive"].includes(value.verdict as string)) throw new TypeError("verdict must be pass, fail, or inconclusive");
  const verdict = value.verdict as GradingJudgment["verdict"];
  const evidence_quote = boundedString(value.evidence_quote, "evidence_quote", MAX_EVIDENCE_QUOTE_BYTES, { allowEmpty: true });
  const rationale = boundedString(value.rationale, "rationale", MAX_RATIONALE_BYTES, { allowEmpty: true });
  const usage = validateUsage(value.usage);
  const judgment_sha256 = sha256Field(value.judgment_sha256, "judgment_sha256");
  const canonical: Omit<GradingJudgment, "judgment_sha256"> = {
    schema_version: GRADING_JUDGMENT_SCHEMA_VERSION, kind: GRADING_JUDGMENT_KIND, invocation_id, request_sha256,
    bindings, grader, verdict, evidence_quote, rationale, usage,
  };
  if (judgment_sha256 !== sha256(canonical)) throw new TypeError("judgment_sha256 does not match the canonical judgment contents");
  return { ...canonical, judgment_sha256 };
}

/**
 * Builds and self-hashes a grading judgment.
 */
export function buildGradingJudgment(input: {
  invocationId: string; requestSha256: string; bindings: GradingRequestBindings; grader: GradingJudgmentGrader;
  verdict: "pass" | "fail" | "inconclusive"; evidenceQuote: string; rationale: string; usage?: Record<string, number> | null;
}): GradingJudgment {
  if (!["pass", "fail", "inconclusive"].includes(input.verdict)) throw new TypeError("verdict must be pass, fail, or inconclusive");
  const usage = validateUsage(input.usage ?? null);
  const canonical: Omit<GradingJudgment, "judgment_sha256"> = {
    schema_version: GRADING_JUDGMENT_SCHEMA_VERSION,
    kind: GRADING_JUDGMENT_KIND,
    invocation_id: input.invocationId,
    request_sha256: input.requestSha256,
    bindings: input.bindings,
    grader: input.grader,
    verdict: input.verdict,
    evidence_quote: input.evidenceQuote,
    rationale: input.rationale,
    usage,
  };
  return validateGradingJudgment({ ...canonical, judgment_sha256: sha256(canonical) });
}

/**
 * Binds an imported, independently validated judgment to the exact request
 * it claims to answer. Rejects a judgment whose `invocation_id`,
 * `request_sha256`, or any of `assertion_sha256`/`variant_sha256`/
 * `output_sha256` does not exactly match the request — this is the
 * mechanism that rejects a judgment answering a stale, different, or
 * forged request.
 */
export function bindJudgmentToRequest(request: GradingRequest, judgment: GradingJudgment): void {
  if (judgment.invocation_id !== request.invocation_id) throw new TypeError("judgment invocation_id does not match its request");
  if (judgment.request_sha256 !== request.request_sha256) throw new TypeError("judgment request_sha256 does not match its request");
  if (judgment.bindings.assertion_sha256 !== request.bindings.assertion_sha256
    || judgment.bindings.variant_sha256 !== request.bindings.variant_sha256
    || judgment.bindings.output_sha256 !== request.bindings.output_sha256) {
    throw new TypeError("judgment bindings do not match its request");
  }
}
