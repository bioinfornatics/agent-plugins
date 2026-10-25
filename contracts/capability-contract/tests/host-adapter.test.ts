import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { FakeHostAdapter, HOST_ADAPTER_PROTOCOL_VERSION, HostAdapterError, createFakeCapabilityReport, evaluationPlanId, isRfc3339Timestamp, negotiateHostCapabilities, sha256, validateArtifactDescriptor, validateHostEventSequence } from "../dist/index.js";
import type { EvaluationPlanV1, HostEventEnvelope, HostRunRequest } from "../dist/index.js";
const root = process.cwd();
const fixture = (name: string) => JSON.parse(readFileSync(join(root, "fixtures", "host-adapter", name), "utf8"));
const plan = fixture("evaluation-plan.json") as EvaluationPlanV1;
function request(runId = "run-success"): HostRunRequest { const requestPlan = structuredClone(plan); return { protocolVersion: HOST_ADAPTER_PROTOCOL_VERSION, host: { name: "fake-host", version: "1.0.0", adapterVersion: "1.0.0" }, identity: { runId, planId: evaluationPlanId(requestPlan), scenarioId: "scenario-1", configurationId: "candidate", attempt: 1 }, plan: requestPlan, scenario: requestPlan.scenarios[0], workspace: { root: "/workspace", cwd: "/workspace/project", files: [{ path: "/workspace/project/input.txt", sha256: "0".repeat(64), mediaType: "text/plain", size: 0, access: "read" }] }, tools: ["read"], environment: { names: ["CI"], credentials: [{ name: "model-provider", reference: "vault://model-provider" }] }, model: "fake-model", budget: requestPlan.configurations[0].budget, capabilities: { required: [{ capability: "isolation", value: "process" }, { capability: "streaming" }, { capability: "model", value: "fake-model" }, { capability: "tools", value: ["read"] }, { capability: "filesystem" }], optional: [{ capability: "browser" }] }, idempotency: { key: "idempotency:" + runId } }; }
async function collect(stream: AsyncIterable<HostEventEnvelope>) { const events: HostEventEnvelope[] = []; for await (const event of stream) events.push(event); return events; }
function code(caught: unknown) { assert.ok(caught instanceof HostAdapterError); return caught.data.code; }
function createProtocolAjv() { const ajv = new Ajv2020({ allErrors: true, strict: false }); ajv.addFormat("date-time", { type: "string", validate: isRfc3339Timestamp }); ajv.addSchema(JSON.parse(readFileSync(join(root, "schema", "1.0.0", "evaluation-plan.schema.json"), "utf8"))); ajv.addSchema(JSON.parse(readFileSync(join(root, "schema", "1.0.0", "result-contract.schema.json"), "utf8"))); return ajv; }

test("wire schemas compile and validate capability, request, and every JSONL event fixture", () => { const ajv = createProtocolAjv(); const protocolSchema = fixture("../../schema/1.0.0/host-execution-adapter.schema.json"); const eventSchema = fixture("../../schema/1.0.0/host-execution-event.schema.json"); assert.equal(ajv.validateSchema(protocolSchema), true); assert.equal(ajv.validateSchema(eventSchema), true); const validateProtocol = ajv.compile(protocolSchema); assert.equal(validateProtocol(fixture("capability-report.json")), true); assert.equal(validateProtocol(fixture("run-request.json")), true, JSON.stringify(validateProtocol.errors)); assert.equal(validateProtocol(fixture("cancellation-request.json")), true, JSON.stringify(validateProtocol.errors)); assert.equal(validateProtocol(fixture("resume-request.json")), true, JSON.stringify(validateProtocol.errors)); assert.equal(validateProtocol(fixture("negotiation-optional-degradation.json")), true, JSON.stringify(validateProtocol.errors)); assert.equal(validateProtocol(fixture("negotiation-version-mismatch.json")), true, JSON.stringify(validateProtocol.errors)); const validateEvent = ajv.compile(eventSchema); const lines = readFileSync(join(root, "fixtures", "host-adapter", "successful-stream.jsonl"), "utf8").trim().split("\n"); assert.ok(lines.length >= 5); for (const line of lines) assert.equal(validateEvent(JSON.parse(line)), true, JSON.stringify(validateEvent.errors)); });

test("capability negotiation blocks required gaps and reports optional degradation", async () => { const adapter = new FakeHostAdapter(); const degraded = await adapter.discover(fixture("negotiation-optional-degradation.json")); assert.equal(degraded.compatible, true); if (degraded.compatible) assert.deepEqual(degraded.degradations.map((item) => item.capability), ["browser"]); const blocked = await adapter.discover({ supportedProtocolVersions: ["1.0.0"], capabilities: { required: [{ capability: "browser" }], optional: [] } }); assert.equal(blocked.compatible, false); if (!blocked.compatible) assert.equal(blocked.errors[0].code, "REQUIRED_CAPABILITY_MISSING"); });

test("successful stream is ordered, versioned, resumable, and exchanges a contained verified artifact", async () => { const adapter = new FakeHostAdapter(); const events = await collect(adapter.submit(request())); validateHostEventSequence(events); assert.deepEqual(events.map((event) => event.type), ["accepted", "started", "progress", "artifact", "completed"]); assert.equal(events[0].host.adapterVersion, "1.0.0"); assert.deepEqual((events[0].data as any).degradations.map((item: any) => item.capability), ["browser"]); const replay = await collect(adapter.resume(fixture("resume-request.json"))); assert.deepEqual(replay.map((event) => event.sequence), [3, 4, 5]); const artifact = await adapter.exchangeArtifact({ protocolVersion: "1.0.0", host: adapter.report.host, runId: "run-success", artifactId: "result" }); const bytes = Buffer.from(artifact.content, "base64"); assert.equal(bytes.byteLength, artifact.artifact.size); assert.equal(sha256(bytes), artifact.artifact.sha256); assert.ok(artifact.artifact.path.startsWith("/workspace/")); });

test("missing required capability blocks before started", async () => { const item = fixture("run-request-blocked.json") as HostRunRequest; const events = await collect(new FakeHostAdapter().submit(item)); assert.deepEqual(events.map((event) => event.type), ["accepted", "blocked"]); assert.equal((events[1].data as any).error.code, "REQUIRED_CAPABILITY_MISSING"); });

test("cancellation is observed as a terminal event and repeat requests are idempotent", async () => { const adapter = new FakeHostAdapter(); const iterator = adapter.submit(request("run-cancel"))[Symbol.asyncIterator](); assert.equal((await iterator.next()).value?.type, "accepted"); const cancel = fixture("cancellation-request.json"); assert.equal((await adapter.cancel(cancel)).status, "cancel-requested"); const rest: HostEventEnvelope[] = []; for (;;) { const next = await iterator.next(); if (next.done) break; rest.push(next.value); } assert.equal(rest.at(-1)?.type, "cancelled"); assert.equal((await adapter.cancel(cancel)).status, "already-cancelled"); });

test("version mismatch and stale or invalid resume are typed", async () => { const adapter = new FakeHostAdapter(); const mismatch = await adapter.discover(fixture("negotiation-version-mismatch.json")); assert.equal(mismatch.compatible, false); if (!mismatch.compatible) assert.equal(mismatch.errors[0].code, "PROTOCOL_VERSION_UNSUPPORTED"); const events = await collect(adapter.submit(request("run-resume"))); await assert.rejects(async () => collect(adapter.resume({ protocolVersion: "1.0.0", host: adapter.report.host, runId: "run-resume", resumeToken: "stale", afterSequence: 1 })), (caught) => code(caught) === "RESUME_STALE"); await assert.rejects(async () => collect(adapter.resume({ protocolVersion: "1.0.0", host: adapter.report.host, runId: "missing", resumeToken: "x", afterSequence: 0 })), (caught) => code(caught) === "RESUME_INVALID"); assert.equal(events.at(-1)?.type, "completed"); });

test("security rejects traversal, undeclared tools/environment, credential values, and secret events", async () => { const mutations: [string, (item: any) => void][] = [["FILE_BOUNDARY_VIOLATION", (item) => item.workspace.files[0].path = "/outside/input"], ["TOOL_NOT_ALLOWED", (item) => item.tools = ["shell"]], ["ENVIRONMENT_NOT_ALLOWED", (item) => item.environment.names = ["HOME"]], ["CREDENTIAL_VALUE_FORBIDDEN", (item) => item.environment.credentials[0].reference = "API_KEY=secret"]]; for (const [expected, mutate] of mutations) { const adapter = new FakeHostAdapter(); const item: any = expected === "FILE_BOUNDARY_VIOLATION" ? fixture("security-file-traversal.json") : request("security-" + expected); if (expected !== "FILE_BOUNDARY_VIOLATION") mutate(item); await assert.rejects(async () => collect(adapter.submit(item)), (caught) => code(caught) === expected); } const events = await collect(new FakeHostAdapter().submit(request("secret-events"))); (events[2].data as any).apiKey = "leak"; assert.throws(() => validateHostEventSequence(events), (caught) => code(caught) === "SECRET_IN_EVENT"); });

test("event conformance rejects duplicate/out-of-order events and artifacts outside workspace", async () => { const adapter = new FakeHostAdapter(); const events = await collect(adapter.submit(request("ordering"))); const duplicate = structuredClone(events); duplicate[2].sequence = 2; assert.throws(() => validateHostEventSequence(duplicate), (caught) => code(caught) === "EVENT_SEQUENCE_INVALID"); const afterTerminal = [...events, { ...events[2], sequence: 6 } as HostEventEnvelope]; assert.throws(() => validateHostEventSequence(afterTerminal), (caught) => code(caught) === "EVENT_SEQUENCE_INVALID"); const artifact = structuredClone((events[3].data as any).artifact); artifact.path = "/outside/result.txt"; assert.throws(() => validateArtifactDescriptor(artifact, "/workspace"), (caught) => code(caught) === "ARTIFACT_INVALID"); });

test("capability report explicitly exposes every required host dimension", () => { const report = createFakeCapabilityReport(); for (const key of ["isolation", "streaming", "cancellation", "resume", "supportedModels", "supportedTools", "filesystem", "network", "browser", "metrics"]) assert.ok(key in report, key); });

test("verifier regressions enforce canonical paths, strict timestamps, and accepted event parity", async () => {
  const adapter = new FakeHostAdapter();
  const events = await collect(adapter.submit(request("verifier-event-parity")));
  const regressions = fixture("verifier-event-regressions.json");
  for (const timestamp of regressions.invalidTimestamps) {
    const invalid = structuredClone(events); invalid[0].timestamp = timestamp;
    assert.throws(() => validateHostEventSequence(invalid), (caught) => code(caught) === "EVENT_SEQUENCE_INVALID");
  }
  const schemaOnlyAjv = new Ajv2020({ allErrors: true, strict: false, logger: false }); schemaOnlyAjv.addSchema(JSON.parse(readFileSync(join(root, "schema", "1.0.0", "result-contract.schema.json"), "utf8")));
  const validateEventSchema = schemaOnlyAjv.compile(fixture("../../schema/1.0.0/host-execution-event.schema.json"));
  for (const timestamp of regressions.invalidTimestamps) { const invalid = structuredClone(events[0]); invalid.timestamp = timestamp; assert.equal(validateEventSchema(invalid), false, timestamp); }
  const missing = structuredClone(events); delete (missing[0].data as any).degradations;
  assert.equal(validateEventSchema(missing[0]), false);
  assert.throws(() => validateHostEventSequence(missing), (caught) => code(caught) === "EVENT_SEQUENCE_INVALID");
  const malformed = structuredClone(events); (malformed[0].data as any).degradations = {};
  assert.equal(validateEventSchema(malformed[0]), false);
  assert.throws(() => validateHostEventSequence(malformed), (caught) => code(caught) === "EVENT_SEQUENCE_INVALID");
  const temporary = mkdtempSync(join(tmpdir(), "host-adapter-containment-"));
  try {
    const workspace = join(temporary, "workspace"); const outside = join(temporary, "outside");
    mkdirSync(workspace); mkdirSync(outside); writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(outside, join(workspace, "escape"), process.platform === "win32" ? "junction" : "dir");
    const escapedCwd = request("verifier-symlink-cwd"); escapedCwd.workspace = { root: workspace, cwd: join(workspace, "escape"), files: [] };
    await assert.rejects(async () => collect(new FakeHostAdapter().submit(escapedCwd)), (caught) => code(caught) === "WORKSPACE_BOUNDARY_VIOLATION");
    const escaped = request("verifier-symlink-file"); escaped.workspace = { root: workspace, cwd: workspace, files: [{ path: join(workspace, "escape", "secret.txt"), sha256: "0".repeat(64), mediaType: "text/plain", size: 6, access: "read" }] };
    await assert.rejects(async () => collect(new FakeHostAdapter().submit(escaped)), (caught) => code(caught) === "FILE_BOUNDARY_VIOLATION");
    const escapedArtifact = { artifactId: "escape", path: join(workspace, "escape", "artifact.txt"), sha256: "0".repeat(64), mediaType: "text/plain", size: 0 };
    assert.throws(() => validateArtifactDescriptor(escapedArtifact, workspace), (caught) => code(caught) === "ARTIFACT_INVALID");
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("verifier regressions bind plan ID and require a positive integer attempt in runtime and schema", async () => {
  const valid = request("verifier-binding");
  assert.equal(valid.identity.planId, evaluationPlanId(valid.plan));
  for (const mutation of fixture("verifier-run-binding-regressions.json").mutations) {
    const invalid: any = structuredClone(valid); invalid.identity[mutation.field] = mutation.value;
    await assert.rejects(async () => collect(new FakeHostAdapter().submit(invalid)), (caught) => code(caught) === "RUN_REQUEST_INVALID");
  }
  const validate = createProtocolAjv().compile(fixture("../../schema/1.0.0/host-execution-adapter.schema.json"));
  for (const mutation of fixture("verifier-run-binding-regressions.json").mutations) {
    const invalid: any = fixture("run-request.json"); invalid.identity[mutation.field] = mutation.value;
    assert.equal(validate(invalid), mutation.schemaValid, mutation.field + "=" + mutation.value);
  }
});

test("verifier regressions keep completed cancellation terminal and negotiate report version and streaming transport values", async () => {
  const adapter = new FakeHostAdapter(); await collect(adapter.submit(request("verifier-terminal-cancel")));
  const cancellation = { protocolVersion: HOST_ADAPTER_PROTOCOL_VERSION, host: adapter.report.host, runId: "verifier-terminal-cancel", reason: "too late", idempotencyKey: "terminal-cancel" } as const;
  assert.equal((await adapter.cancel(cancellation)).status, "already-terminal");
  assert.equal((await adapter.cancel(cancellation)).status, "already-terminal");
  const mismatchedReport = { ...createFakeCapabilityReport(), protocolVersion: "9.9.9" as any };
  const mismatched = negotiateHostCapabilities(mismatchedReport, { supportedProtocolVersions: ["1.0.0"], capabilities: { required: [], optional: [] } });
  assert.equal(mismatched.compatible, false); if (!mismatched.compatible) assert.equal(mismatched.errors[0].code, "PROTOCOL_VERSION_UNSUPPORTED");
  const unsupportedRequired = await adapter.discover({ supportedProtocolVersions: ["1.0.0"], capabilities: { required: [{ capability: "streaming", value: "websocket" }], optional: [] } });
  assert.equal(unsupportedRequired.compatible, false); if (!unsupportedRequired.compatible) assert.equal(unsupportedRequired.errors[0].code, "REQUIRED_CAPABILITY_MISSING");
  const unsupportedOptional = await adapter.discover({ supportedProtocolVersions: ["1.0.0"], capabilities: { required: [], optional: [{ capability: "streaming", value: ["jsonl", "websocket"] }] } });
  assert.equal(unsupportedOptional.compatible, true); if (unsupportedOptional.compatible) assert.deepEqual(unsupportedOptional.degradations.map((item) => item.capability), ["streaming"]);
  const supported = await adapter.discover({ supportedProtocolVersions: ["1.0.0"], capabilities: { required: [{ capability: "streaming", value: ["iterator", "jsonl"] }], optional: [] } });
  assert.equal(supported.compatible, true);
});


test("premium verifier regressions reject all six schema-invalid event payload mismatches at runtime", async () => {
  const events = await collect(new FakeHostAdapter().submit(request("premium-event-payloads")));
  const ajv = createProtocolAjv();
  const validateEventSchema = ajv.compile(fixture("../../schema/1.0.0/host-execution-event.schema.json"));
  const regressions = fixture("verifier-event-payload-regressions.json");
  assert.equal(regressions.cases.length, 6);
  for (const regression of regressions.cases) {
    const invalid: any = structuredClone(events);
    for (const change of regression.changes) {
      let target = invalid[regression.eventIndex];
      for (const segment of change.path.slice(0, -1)) target = target[segment];
      const key = change.path.at(-1);
      if (change.operation === "delete") delete target[key]; else target[key] = change.value;
    }
    assert.equal(validateEventSchema(invalid[regression.eventIndex]), false, regression.name + " must be schema-invalid");
    assert.throws(() => validateHostEventSequence(invalid), (caught) => code(caught) === "EVENT_SEQUENCE_INVALID", regression.name);
  }
});

test("every event payload branch is closed and enforces branch-specific structure", async () => {
  const success = await collect(new FakeHostAdapter().submit(request("premium-all-branches")));
  const blocked = await collect(new FakeHostAdapter().submit(fixture("run-request-blocked.json")));
  const heartbeat = structuredClone(success); heartbeat.splice(3, 0, { ...heartbeat[2], sequence: 4, type: "heartbeat", data: {} } as any); heartbeat[4].sequence = 5; heartbeat[5].sequence = 6;
  const failed = structuredClone(blocked); (failed[1] as any).type = "failed"; (failed[1].data as any).result.operation.state = "failed";
  const cancelled = structuredClone(success); cancelled[4] = { ...cancelled[4], type: "cancelled", data: { reason: "stopped" } } as any;
  for (const stream of [success, blocked, heartbeat, failed, cancelled]) validateHostEventSequence(stream);
  const samples = new Map<string, HostEventEnvelope>();
  for (const stream of [success, blocked, heartbeat, failed, cancelled]) for (const event of stream) samples.set(event.type, event);
  assert.deepEqual([...samples.keys()].sort(), ["accepted", "artifact", "blocked", "cancelled", "completed", "failed", "heartbeat", "progress", "started"]);
  const validateEventSchema = createProtocolAjv().compile(fixture("../../schema/1.0.0/host-execution-event.schema.json"));
  for (const [type, sample] of samples) {
    const invalidEvent: any = structuredClone(sample); invalidEvent.data.extra = true;
    assert.equal(validateEventSchema(invalidEvent), false, type + " payload must be closed in schema");
    const stream = type === "accepted" ? structuredClone(success) : [{ ...success[0] }, { ...invalidEvent, sequence: 2 } as any];
    if (type === "accepted") (stream[0].data as any).extra = true;
    assert.throws(() => validateHostEventSequence(stream), (caught) => code(caught) === "EVENT_SEQUENCE_INVALID", type + " payload must be closed at runtime");
  }
  const progressBounds = structuredClone(success); (progressBounds[2].data as any).completed = 2; (progressBounds[2].data as any).total = 1;
  assert.throws(() => validateHostEventSequence(progressBounds), (caught) => code(caught) === "EVENT_SEQUENCE_INVALID");
  const negativeProgress = structuredClone(success); (negativeProgress[2].data as any).total = -1;
  assert.throws(() => validateHostEventSequence(negativeProgress), (caught) => code(caught) === "EVENT_SEQUENCE_INVALID");
  const openDegradation = structuredClone(success); (openDegradation[0].data as any).degradations[0].extra = true;
  assert.throws(() => validateHostEventSequence(openDegradation), (caught) => code(caught) === "EVENT_SEQUENCE_INVALID");
  const blankHeartbeat = structuredClone(heartbeat); (blankHeartbeat[3].data as any).message = "   ";
  assert.throws(() => validateHostEventSequence(blankHeartbeat), (caught) => code(caught) === "EVENT_SEQUENCE_INVALID");
  for (const [field, value] of [["path", ""], ["mediaType", ""], ["size", -1], ["size", 0.5]] as const) {
    const invalid = structuredClone(success); (invalid[3].data as any).artifact[field] = value;
    assert.throws(() => validateHostEventSequence(invalid), (caught) => code(caught) === "EVENT_SEQUENCE_INVALID", "artifact " + field);
  }
  const openArtifact = structuredClone(success); (openArtifact[3].data as any).artifact.extra = true;
  assert.throws(() => validateHostEventSequence(openArtifact), (caught) => code(caught) === "EVENT_SEQUENCE_INVALID");
  for (const mutation of [{ metrics: { inputTokens: -1 } }, { metrics: { totalTokens: 1, extra: 0 } }]) {
    const invalid = structuredClone(success); Object.assign(invalid[4].data as any, mutation);
    assert.throws(() => validateHostEventSequence(invalid), (caught) => code(caught) === "EVENT_SEQUENCE_INVALID");
  }
  const completedWithoutResult = structuredClone(success); delete (completedWithoutResult[4].data as any).result;
  assert.throws(() => validateHostEventSequence(completedWithoutResult), (caught) => code(caught) === "EVENT_SEQUENCE_INVALID");
  for (const terminal of [blocked, failed]) {
    for (const required of ["result", "error"]) {
      const invalid = structuredClone(terminal); delete (invalid[1].data as any)[required];
      assert.throws(() => validateHostEventSequence(invalid), (caught) => code(caught) === "EVENT_SEQUENCE_INVALID");
    }
    const openError = structuredClone(terminal); (openError[1].data as any).error.extra = true;
    assert.throws(() => validateHostEventSequence(openError), (caught) => code(caught) === "EVENT_SEQUENCE_INVALID");
  }
});

test("evaluation plan binding is recursively key-order independent and malformed plans become typed host errors", async () => {
  const reverseObjectKeys = (value: any): any => Array.isArray(value) ? value.map(reverseObjectKeys) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseObjectKeys(child)])) : value;
  const reordered = reverseObjectKeys(plan) as EvaluationPlanV1;
  assert.equal(evaluationPlanId(reordered), evaluationPlanId(plan));
  const reorderedRequest = request("premium-reordered-plan"); reorderedRequest.plan = reordered;
  assert.equal((await collect(new FakeHostAdapter().submit(reorderedRequest))).at(-1)?.type, "completed");
  const malformed: any = request("premium-malformed-plan"); malformed.plan.computed.totalRuns += 1;
  await assert.rejects(async () => collect(new FakeHostAdapter().submit(malformed)), (caught: unknown) => {
    assert.equal(code(caught), "RUN_REQUEST_INVALID");
    assert.equal((caught as HostAdapterError).message, "EvaluationPlan normalization or hashing failed.");
    const diagnostics = (caught as HostAdapterError).data.details?.diagnostics;
    assert.ok(Array.isArray(diagnostics));
    assert.ok(diagnostics.some((item: any) => item.code === "EVALUATION_BUDGET_CONTRADICTORY" && item.path === "/computed"));
    assert.equal(JSON.stringify((caught as HostAdapterError).data).includes("premium-malformed-plan"), false);
    return true;
  });
});

test("submit validates before blocked and binds cached replay to the complete canonical request", async () => {
  const malformedBlocked: any = request("final-malformed-blocked");
  malformedBlocked.plan.computed.totalRuns += 1;
  malformedBlocked.capabilities.required = [{ capability: "browser" }];
  await assert.rejects(async () => collect(new FakeHostAdapter().submit(malformedBlocked)), (caught) => code(caught) === "RUN_REQUEST_INVALID");

  const adapter = new FakeHostAdapter();
  const original = request("final-cache-binding");
  const first = await collect(adapter.submit(original));
  assert.equal(first.at(-1)?.type, "completed");
  const mutations: [string, (item: any) => void][] = [
    ["normalized plan", (item) => { item.plan.thresholds = [{ metric: "cost", operator: "<=", value: 1 }]; item.identity.planId = evaluationPlanId(item.plan); }],
    ["planId", (item) => { item.identity.planId = "sha256:" + "f".repeat(64); }],
    ["scenario", (item) => { item.scenario.source = "fixtures/other.json"; }],
    ["configuration", (item) => { item.identity.configurationId = "other"; }],
    ["attempt", (item) => { item.identity.attempt = 2; }],
    ["host", (item) => { item.host.version = "2.0.0"; }],
    ["protocol", (item) => { item.protocolVersion = "2.0.0"; }],
    ["workspace root", (item) => { item.workspace.root = "/workspace-2"; item.workspace.cwd = "/workspace-2/project"; item.workspace.files[0].path = "/workspace-2/project/input.txt"; }],
    ["cwd", (item) => { item.workspace.cwd = "/workspace/other"; }],
    ["file", (item) => { item.workspace.files[0].sha256 = "1".repeat(64); }],
    ["tool", (item) => { item.tools = ["write"]; }],
    ["environment name", (item) => { item.environment.names = ["LANG"]; }],
    ["credential reference", (item) => { item.environment.credentials[0].reference = "vault://other-provider"; }],
    ["credential value", (item) => { item.environment.credentials[0].reference = "API_KEY=secret"; }],
    ["model", (item) => { item.model = "other-model"; }],
    ["budget", (item) => { item.budget.maxTurns += 1; }],
    ["capabilities", (item) => { item.capabilities.optional = [{ capability: "costMetrics" }]; }],
    ["idempotency key", (item) => { item.idempotency.key = "other-key"; }],
    ["idempotency afterSequence", (item) => { item.idempotency.afterSequence = 1; }],
  ];
  for (const [name, mutate] of mutations) {
    const changed: any = structuredClone(original); mutate(changed);
    await assert.rejects(async () => collect(adapter.submit(changed)), (caught) => {
      const actual = code(caught);
      assert.ok(["RUN_REQUEST_INVALID", "PROTOCOL_VERSION_UNSUPPORTED", "REQUIRED_CAPABILITY_MISSING", "CREDENTIAL_VALUE_FORBIDDEN"].includes(actual), name + ": " + actual);
      return true;
    }, name + " must never replay cached events");
  }

  const reordered: any = (value: any): any => Array.isArray(value) ? value.map(reordered) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reordered(child)])) : value;
  assert.deepEqual(await collect(adapter.submit(reordered(original))), first, "property order must not change the canonical fingerprint");
  const ephemeralResume = structuredClone(original); ephemeralResume.idempotency.resumeToken = "new-ephemeral-token";
  assert.deepEqual(await collect(adapter.submit(ephemeralResume)), first, "ephemeral resumeToken is deliberately outside the submission fingerprint");
});

test("progress schema is structural while runtime additionally enforces completed not exceeding total", async () => {
  const events = await collect(new FakeHostAdapter().submit(request("final-progress-invariant")));
  const progress: any = structuredClone(events[2]); progress.data.completed = 2; progress.data.total = 1;
  const validateEventSchema = createProtocolAjv().compile(fixture("../../schema/1.0.0/host-execution-event.schema.json"));
  assert.equal(validateEventSchema(progress), true, "draft 2020-12 schema validates each numeric property structurally");
  const stream = structuredClone(events); stream[2] = progress;
  assert.throws(() => validateHostEventSequence(stream), (caught) => code(caught) === "EVENT_SEQUENCE_INVALID", "runtime enforces the additional cross-property semantic invariant");
  for (const [field, value] of [["completed", -1], ["total", 0.5]] as const) {
    const structurallyInvalid: any = structuredClone(events[2]); structurallyInvalid.data[field] = value;
    assert.equal(validateEventSchema(structurallyInvalid), false, field + " property constraint remains in schema");
  }
});
