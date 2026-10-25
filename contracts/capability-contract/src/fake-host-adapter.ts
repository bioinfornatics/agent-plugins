import { HOST_ADAPTER_PROTOCOL_VERSION, HostAdapterError } from "./host-adapter-types.js";
import { assertHostIdentity, negotiateHostCapabilities, sha256, validateArtifactDescriptor, validateHostEventSequence, validateHostRunRequestBinding } from "./host-adapter.js";
import type { HostAdapterErrorData, HostArtifactExchange, HostArtifactRequest, HostCancellationRequest, HostCancellationResponse, HostCapabilityReport, HostEventDataByType, HostEventEnvelope, HostEventType, HostExecutionAdapter, HostNegotiationRequest, HostNegotiationResult, HostResumeRequest, HostRunRequest } from "./host-adapter-types.js";
import type { ResultContractV1 } from "./result-types.js";
import { normalizeEvaluationPlan } from "./evaluation.js";

const completedResult: ResultContractV1 = { schemaVersion: "1.0.0", operation: { state: "completed" }, evaluation: { applicable: true, verdict: "pass" }, evidence: { applicable: true, availability: "available" }, approval: { applicable: false, state: "not-applicable" } };
const blockedResult: ResultContractV1 = { schemaVersion: "1.0.0", operation: { state: "blocked", reasons: ["required capability unavailable"] }, evaluation: { applicable: true, verdict: "inconclusive" }, evidence: { applicable: true, availability: "unavailable" }, approval: { applicable: false, state: "not-applicable" } };
function failure(code: HostAdapterErrorData["code"], message: string): HostAdapterError { return new HostAdapterError({ code, message, retryable: false }); }
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
}
function requestFingerprint(request: HostRunRequest): string {
  const idempotency = { key: request.idempotency.key, ...(request.idempotency.afterSequence === undefined ? {} : { afterSequence: request.idempotency.afterSequence }) };
  const bound = {
    protocolVersion: request.protocolVersion, host: request.host,
    identity: request.identity, plan: normalizeEvaluationPlan(request.plan), scenario: request.scenario,
    workspace: request.workspace, tools: request.tools,
    environment: { names: request.environment.names, credentials: request.environment.credentials.map(({ name, reference }) => ({ name, reference })) },
    model: request.model, budget: request.budget, capabilities: request.capabilities, idempotency,
  };
  return "sha256:" + sha256(JSON.stringify(canonicalize(bound)));
}
interface StoredRun { readonly idempotencyKey: string; readonly requestFingerprint: string; events: HostEventEnvelope[]; resumeToken: string; cancelled: boolean; terminal: boolean; artifact?: HostArtifactExchange; }
export interface FakeHostAdapterOptions { report?: HostCapabilityReport; clock?: string; }
export function createFakeCapabilityReport(overrides: Partial<HostCapabilityReport> = {}): HostCapabilityReport {
  const base: HostCapabilityReport = { protocolVersion: HOST_ADAPTER_PROTOCOL_VERSION, supportedProtocolVersions: [HOST_ADAPTER_PROTOCOL_VERSION], host: { name: "fake-host", version: "1.0.0", adapterVersion: "1.0.0" }, isolation: { supported: true, levels: ["process"] }, streaming: { supported: true, transports: ["iterator", "jsonl"] }, cancellation: { supported: true }, resume: { supported: true, tokenTtlSeconds: 3600 }, supportedModels: ["fake-model"], supportedTools: ["read", "write"], filesystem: { supported: true, modes: ["read", "write"], workspaceContained: true }, network: { supported: false, allowlistEnforced: true }, browser: { supported: false }, metrics: { tokens: true, cost: true }, allowedEnvironmentNames: ["CI", "LANG"] };
  return { ...base, ...overrides };
}
export class FakeHostAdapter implements HostExecutionAdapter {
  readonly report: HostCapabilityReport; private readonly runs = new Map<string, StoredRun>(); private readonly clock: string;
  constructor(options: FakeHostAdapterOptions = {}) { this.report = options.report ?? createFakeCapabilityReport(); this.clock = options.clock ?? "2026-09-16T12:00:00.000Z"; }
  async discover(request: HostNegotiationRequest): Promise<HostNegotiationResult> { return negotiateHostCapabilities(this.report, request); }
  private event<T extends HostEventType>(runId: string, sequence: number, type: T, data: HostEventDataByType[T]): HostEventEnvelope<T> { return { protocolVersion: HOST_ADAPTER_PROTOCOL_VERSION, host: this.report.host, runId, sequence, timestamp: this.clock, type, data } as HostEventEnvelope<T>; }
  async *submit(request: HostRunRequest): AsyncIterable<HostEventEnvelope> {
    validateHostRunRequestBinding(request, this.report);
    const boundRequest = structuredClone(request);
    const fingerprint = requestFingerprint(boundRequest);
    const existing = this.runs.get(boundRequest.identity.runId);
    if (existing) {
      if (existing.idempotencyKey !== boundRequest.idempotency.key || existing.requestFingerprint !== fingerprint) throw failure("RUN_REQUEST_INVALID", "runId and idempotency key are already bound to a different validated request fingerprint.");
      yield* existing.events; return;
    }
    const negotiation = negotiateHostCapabilities(this.report, { supportedProtocolVersions: [boundRequest.protocolVersion], capabilities: boundRequest.capabilities });
    const run: StoredRun = { idempotencyKey: boundRequest.idempotency.key, requestFingerprint: fingerprint, events: [], resumeToken: "resume:" + boundRequest.identity.runId + ":1", cancelled: false, terminal: false };
    this.runs.set(boundRequest.identity.runId, run);
    if (!negotiation.compatible) {
      const accepted = this.event(boundRequest.identity.runId, 1, "accepted", { resumeToken: run.resumeToken, degradations: [] });
      const blocked = this.event(boundRequest.identity.runId, 2, "blocked", { result: blockedResult, error: negotiation.errors[0] });
      run.events.push(accepted, blocked); run.terminal = true; validateHostEventSequence(run.events); yield accepted; yield blocked; return;
    }
    const accepted = this.event(boundRequest.identity.runId, 1, "accepted", { resumeToken: run.resumeToken, degradations: negotiation.degradations }); run.events.push(accepted); yield accepted;
    await Promise.resolve();
    if (run.cancelled) { const cancelled = this.event(boundRequest.identity.runId, 2, "cancelled", { reason: "cancelled by caller" }); run.events.push(cancelled); run.terminal = true; validateHostEventSequence(run.events); yield cancelled; return; }
    const started = this.event(boundRequest.identity.runId, 2, "started", { message: "fake execution started" }); run.events.push(started); yield started;
    await Promise.resolve();
    if (run.cancelled) { const cancelled = this.event(boundRequest.identity.runId, 3, "cancelled", { reason: "cancelled by caller" }); run.events.push(cancelled); run.terminal = true; validateHostEventSequence(run.events); yield cancelled; return; }
    const progress = this.event(boundRequest.identity.runId, 3, "progress", { message: "fake execution complete", completed: 1, total: 1 });
    const content = new TextEncoder().encode("deterministic fake artifact\n"); const artifact = { artifactId: "result", path: boundRequest.workspace.root + "/artifacts/result.txt", sha256: sha256(content), mediaType: "text/plain", size: content.byteLength };
    validateArtifactDescriptor(artifact, boundRequest.workspace.root); run.artifact = { protocolVersion: HOST_ADAPTER_PROTOCOL_VERSION, host: this.report.host, runId: boundRequest.identity.runId, artifact, encoding: "base64", content: Buffer.from(content).toString("base64") };
    const artifactEvent = this.event(boundRequest.identity.runId, 4, "artifact", { artifact });
    const completed = this.event(boundRequest.identity.runId, 5, "completed", { result: completedResult, metrics: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001 } });
    run.events.push(progress, artifactEvent, completed); run.terminal = true; validateHostEventSequence(run.events); yield progress; yield artifactEvent; yield completed;
  }
  async cancel(request: HostCancellationRequest): Promise<HostCancellationResponse> {
    if (request.protocolVersion !== HOST_ADAPTER_PROTOCOL_VERSION) throw failure("PROTOCOL_VERSION_UNSUPPORTED", "Unsupported cancellation protocol version.");
    assertHostIdentity(this.report.host, request.host);
    if (!this.report.cancellation.supported) throw failure("CANCELLATION_UNSUPPORTED", "Host does not support cancellation.");
    const run = this.runs.get(request.runId); if (!run) throw failure("RUN_NOT_FOUND", "Run not found.");
    if (run.terminal) { const status = run.events.at(-1)?.type === "cancelled" ? "already-cancelled" : "already-terminal"; return { protocolVersion: HOST_ADAPTER_PROTOCOL_VERSION, host: this.report.host, runId: request.runId, status }; }
    if (run.cancelled) return { protocolVersion: HOST_ADAPTER_PROTOCOL_VERSION, host: this.report.host, runId: request.runId, status: "already-cancelled" };
    run.cancelled = true; return { protocolVersion: HOST_ADAPTER_PROTOCOL_VERSION, host: this.report.host, runId: request.runId, status: "cancel-requested" };
  }
  async *resume(request: HostResumeRequest): AsyncIterable<HostEventEnvelope> {
    if (request.protocolVersion !== HOST_ADAPTER_PROTOCOL_VERSION) throw failure("PROTOCOL_VERSION_UNSUPPORTED", "Unsupported resume protocol version.");
    assertHostIdentity(this.report.host, request.host);
    if (!this.report.resume.supported) throw failure("REQUIRED_CAPABILITY_MISSING", "Host does not support resume.");
    const run = this.runs.get(request.runId); if (!run) throw failure("RESUME_INVALID", "Unknown run cannot be resumed.");
    if (request.resumeToken !== run.resumeToken) throw failure("RESUME_STALE", "Resume token is invalid or stale.");
    if (!Number.isSafeInteger(request.afterSequence) || request.afterSequence < 0 || request.afterSequence > run.events.length) throw failure("RESUME_INVALID", "afterSequence is outside the retained stream.");
    for (const event of run.events) if (event.sequence > request.afterSequence) yield event;
  }
  async exchangeArtifact(request: HostArtifactRequest): Promise<HostArtifactExchange> { if (request.protocolVersion !== HOST_ADAPTER_PROTOCOL_VERSION) throw failure("PROTOCOL_VERSION_UNSUPPORTED", "Unsupported artifact exchange protocol version."); assertHostIdentity(this.report.host, request.host); const run = this.runs.get(request.runId); if (!run || !run.artifact || run.artifact.artifact.artifactId !== request.artifactId) throw failure("ARTIFACT_INVALID", "Artifact is unavailable for this run."); return run.artifact; }
}
