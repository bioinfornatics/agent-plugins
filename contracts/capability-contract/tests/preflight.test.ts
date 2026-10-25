import assert from "node:assert/strict";
import test from "node:test";
import {
  HOST_ADAPTER_PROTOCOL_VERSION,
  createFakeCapabilityReport,
  resolveHostCapabilityPreflight,
} from "../dist/index.js";
import type { HostPreflightJobInput } from "../dist/index.js";

const job = (overrides: Partial<HostPreflightJobInput> = {}): HostPreflightJobInput => ({
  jobId: "job-1",
  negotiation: {
    supportedProtocolVersions: [HOST_ADAPTER_PROTOCOL_VERSION],
    capabilities: { required: [{ capability: "model", value: "fake-model" }], optional: [] },
  },
  ...overrides,
});

test("preflight classifies runnable jobs before launch", () => {
  const result = resolveHostCapabilityPreflight({ report: createFakeCapabilityReport(), jobs: [job()] });
  assert.equal(result.status, "runnable");
  assert.equal(result.launchAllowed, true);
  assert.equal(result.jobs[0].status, "runnable");
  assert.equal(result.jobs[0].metrics.tokens.value, null);
  assert.equal(result.jobs[0].metrics.tokens.reason, null);
});

test("missing browser serving selects a user-visible static viewer fallback", () => {
  const result = resolveHostCapabilityPreflight({ report: createFakeCapabilityReport(), jobs: [job({ viewer: "live" })] });
  assert.equal(result.status, "downgraded");
  assert.equal(result.jobs[0].viewer.resolved, "static");
  assert.match(result.jobs[0].viewer.reason!, /static viewer/);
  assert.ok(result.jobs[0].consequences.some((item) => item.code === "STATIC_VIEWER_FALLBACK"));
});

test("unavailable requested metrics remain null and explain why", () => {
  const report = createFakeCapabilityReport();
  report.metrics = { tokens: false, cost: false };
  const result = resolveHostCapabilityPreflight({ report, jobs: [job({ metrics: { tokens: true, cost: true } })] });
  assert.equal(result.jobs[0].status, "downgraded");
  assert.deepEqual(result.jobs[0].metrics.tokens.value, null);
  assert.match(result.jobs[0].metrics.tokens.reason!, /requested/);
  assert.deepEqual(result.jobs[0].metrics.cost.value, null);
  assert.match(result.jobs[0].metrics.cost.reason!, /requested/);
});

test("absent concurrency produces sequential execution instead of a late failure", () => {
  const result = resolveHostCapabilityPreflight({ report: createFakeCapabilityReport(), requestedConcurrency: 4, jobs: [job(), job({ jobId: "job-2" })] });
  assert.equal(result.executionMode, "sequential");
  assert.equal(result.effectiveConcurrency, 1);
  assert.equal(result.status, "downgraded");
  assert.ok(result.jobs.every((item) => item.consequences.some((entry) => entry.code === "SEQUENTIAL_EXECUTION_FALLBACK")));
});

test("an additive concurrency report permits bounded concurrent execution", () => {
  const report = createFakeCapabilityReport();
  const result = resolveHostCapabilityPreflight({ report, concurrency: { supported: true, maxParallelJobs: 2 }, requestedConcurrency: 4, jobs: [job(), job({ jobId: "job-2" }), job({ jobId: "job-3" })] });
  assert.equal(result.executionMode, "concurrent");
  assert.equal(result.effectiveConcurrency, 2);
  assert.ok(result.jobs.every((item) => item.status === "downgraded"));
});

test("safety-required isolation and tools block and are never downgraded", () => {
  const report = createFakeCapabilityReport();
  const result = resolveHostCapabilityPreflight({ report, jobs: [job({
    negotiation: { supportedProtocolVersions: [HOST_ADAPTER_PROTOCOL_VERSION], capabilities: { required: [], optional: [{ capability: "isolation", value: "container" }, { capability: "tools", value: ["shell"] }] } },
    safety: { isolation: "container", tools: ["shell"] },
  })] });
  assert.equal(result.status, "blocked");
  assert.equal(result.launchAllowed, false);
  assert.equal(result.jobs[0].launchAllowed, false);
  assert.deepEqual(result.jobs[0].errors.map((item) => item.details?.capability), ["isolation", "tools"]);
  assert.equal(result.jobs[0].consequences.length, 0);
});

test("required filesystem write blocks on a read-only contained host", () => {
  const report = createFakeCapabilityReport();
  report.filesystem.modes = ["read"];
  const candidate = job({ negotiation: { supportedProtocolVersions: [HOST_ADAPTER_PROTOCOL_VERSION], capabilities: { required: [{ capability: "filesystem", value: "write" }], optional: [] } } });
  const result = resolveHostCapabilityPreflight({ report, jobs: [candidate] });
  assert.equal(result.invalidInput, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.launchAllowed, false);
  assert.equal(result.jobs[0].errors[0].details?.value, "write");
});

test("optional filesystem write degrades on a read-only contained host", () => {
  const report = createFakeCapabilityReport();
  report.filesystem.modes = ["read"];
  const candidate = job({ negotiation: { supportedProtocolVersions: [HOST_ADAPTER_PROTOCOL_VERSION], capabilities: { required: [], optional: [{ capability: "filesystem", value: "write" }] } } });
  const result = resolveHostCapabilityPreflight({ report, jobs: [candidate] });
  assert.equal(result.invalidInput, false);
  assert.equal(result.status, "downgraded");
  assert.equal(result.launchAllowed, true);
  assert.deepEqual(result.jobs[0].consequences.map((item) => item.capability), ["filesystem"]);
});

test("filesystem read-write requires both atomic host modes and remains contained", () => {
  const requirement = { capability: "filesystem", value: "read-write" } as const;
  const both = resolveHostCapabilityPreflight({ report: createFakeCapabilityReport(), jobs: [job({ negotiation: { supportedProtocolVersions: [HOST_ADAPTER_PROTOCOL_VERSION], capabilities: { required: [requirement], optional: [] } } })] });
  assert.equal(both.status, "runnable");

  const readOnlyReport = createFakeCapabilityReport();
  readOnlyReport.filesystem.modes = ["read"];
  const readOnly = resolveHostCapabilityPreflight({ report: readOnlyReport, jobs: [job({ negotiation: { supportedProtocolVersions: [HOST_ADAPTER_PROTOCOL_VERSION], capabilities: { required: [requirement], optional: [] } } })] });
  assert.equal(readOnly.status, "blocked");

  const uncontainedReport = createFakeCapabilityReport();
  uncontainedReport.filesystem.workspaceContained = false;
  const uncontained = resolveHostCapabilityPreflight({ report: uncontainedReport, jobs: [job({ negotiation: { supportedProtocolVersions: [HOST_ADAPTER_PROTOCOL_VERSION], capabilities: { required: [requirement], optional: [] } } })] });
  assert.equal(uncontained.status, "blocked");
});

test("a blocked job blocks aggregate launch while preserving every job classification", () => {
  const result = resolveHostCapabilityPreflight({ report: createFakeCapabilityReport(), jobs: [job(), job({ jobId: "blocked", negotiation: { supportedProtocolVersions: [HOST_ADAPTER_PROTOCOL_VERSION], capabilities: { required: [{ capability: "browser" }], optional: [] } } })] });
  assert.equal(result.launchAllowed, false);
  assert.deepEqual(result.jobs.map((item) => item.status), ["runnable", "blocked"]);
});

test("malformed top-level input fails closed without throwing", () => {
  for (const input of [null, [], {}, { report: createFakeCapabilityReport(), jobs: [] }, { report: createFakeCapabilityReport(), jobs: [job()], requestedConcurrency: 0 }]) {
    const result = resolveHostCapabilityPreflight(input as unknown);
    assert.equal(result.invalidInput, true);
    assert.equal(result.status, "blocked");
    assert.equal(result.launchAllowed, false);
    assert.equal(result.effectiveConcurrency, 0);
    assert.deepEqual(result.jobs, []);
    assert.ok(result.diagnostics.length > 0);
  }
});

test("verifier adversarial scalar substitutions never become runnable", () => {
  const cases: Array<[string, (input: any) => void]> = [
    ["viewer enum", (input) => { input.jobs[0].viewer = "dynamic"; }],
    ["report boolean", (input) => { input.report.browser.supported = "false"; }],
    ["job metric boolean", (input) => { input.jobs[0].metrics = { tokens: 1 }; }],
    ["concurrency boolean", (input) => { input.concurrency = { supported: "yes", maxParallelJobs: 2 }; }],
    ["concurrency limit", (input) => { input.concurrency = { supported: true, maxParallelJobs: 1.5 }; }],
    ["job id", (input) => { input.jobs[0].jobId = 7; }],
  ];
  for (const [label, mutate] of cases) {
    const input: any = { report: createFakeCapabilityReport(), jobs: [job()], requestedConcurrency: 2 };
    mutate(input);
    const result = resolveHostCapabilityPreflight(input);
    assert.equal(result.invalidInput, true, label);
    assert.equal(result.launchAllowed, false, label);
    assert.deepEqual(result.jobs, [], label);
  }
});

test("every report boolean and nested report collection is runtime-validated", () => {
  const mutations: Array<(report: any) => void> = [
    (r) => { r.isolation.supported = 1; },
    (r) => { r.streaming.supported = null; },
    (r) => { r.cancellation.supported = "true"; },
    (r) => { r.resume.supported = 0; },
    (r) => { r.filesystem.supported = {}; },
    (r) => { r.filesystem.workspaceContained = "yes"; },
    (r) => { r.network.supported = 1; },
    (r) => { r.network.allowlistEnforced = undefined; },
    (r) => { r.browser.supported = "false"; },
    (r) => { r.metrics.tokens = 1; },
    (r) => { r.metrics.cost = null; },
    (r) => { r.isolation.levels = ["process", "bogus"]; },
    (r) => { r.streaming.transports = ["websocket"]; },
    (r) => { r.filesystem.modes = ["execute"]; },
    (r) => { r.filesystem.modes = ["read-write"]; },
    (r) => { r.supportedModels = [""]; },
    (r) => { r.host.adapterVersion = " "; },
    (r) => { delete r.metrics; },
  ];
  for (const mutate of mutations) {
    const report: any = structuredClone(createFakeCapabilityReport());
    mutate(report);
    const result = resolveHostCapabilityPreflight({ report, jobs: [job()] });
    assert.equal(result.invalidInput, true);
    assert.equal(result.launchAllowed, false);
  }
});

test("malformed nested jobs, requirements, and metrics return path diagnostics", () => {
  const inputs: any[] = [];
  const add = (mutate: (input: any) => void) => { const input: any = { report: createFakeCapabilityReport(), jobs: [job()] }; mutate(input); inputs.push(input); };
  add((input) => { input.jobs = [null]; });
  add((input) => { input.jobs[0].negotiation = null; });
  add((input) => { input.jobs[0].negotiation.capabilities.required = [{ capability: "unknown" }]; });
  add((input) => { input.jobs[0].negotiation.capabilities.optional = [{ capability: "tools", value: ["read", "read"] }]; });
  add((input) => { input.jobs[0].negotiation.supportedProtocolVersions = [1]; });
  add((input) => { input.jobs[0].safety = { tools: [" "] }; });
  add((input) => { input.jobs[0].metrics = { cost: false, extra: true }; });
  add((input) => { input.jobs[0].extra = true; });
  for (const input of inputs) {
    const result = resolveHostCapabilityPreflight(input);
    assert.equal(result.invalidInput, true);
    assert.equal(result.launchAllowed, false);
    assert.ok(result.diagnostics.some((entry) => entry.path.startsWith("$.jobs")));
  }
});

test("invalid input is rejected before negotiation produces any per-job result", () => {
  const result = resolveHostCapabilityPreflight({ report: createFakeCapabilityReport(), jobs: [job({ viewer: "invalid" as any })] } as any);
  assert.equal(result.invalidInput, true);
  assert.equal(result.launchAllowed, false);
  assert.deepEqual(result.jobs, []);
  assert.ok(result.diagnostics.some((entry) => entry.path === "$.jobs[0].viewer"));
});


test("capability requirement values are validated against their report dimensions", () => {
  const invalidRequirements: any[] = [
    { capability: "isolation", value: "docker" },
    { capability: "streaming", value: "websocket" },
    { capability: "filesystem", value: "execute" },
    { capability: "model" },
    { capability: "model", value: [] },
    { capability: "tools" },
    { capability: "tools", value: [] },
    { capability: "browser", value: "live" },
    { capability: "network", value: ["true"] },
    { capability: "cancellation", value: "false" },
    { capability: "resume", value: "3600" },
    { capability: "tokenMetrics", value: "tokens" },
    { capability: "costMetrics", value: ["true"] },
  ];
  for (const requirement of invalidRequirements) {
    const candidate: any = job();
    candidate.negotiation.capabilities.required = [requirement];
    const result = resolveHostCapabilityPreflight({ report: createFakeCapabilityReport(), jobs: [candidate] });
    assert.equal(result.invalidInput, true, JSON.stringify(requirement));
    assert.deepEqual(result.jobs, [], JSON.stringify(requirement));
  }

  for (const requirement of [
    { capability: "isolation", value: ["process", "container"] },
    { capability: "streaming", value: "jsonl" },
    { capability: "filesystem", value: ["read", "write"] },
    { capability: "filesystem", value: "read-write" },
    { capability: "model", value: "fake-model" },
    { capability: "tools", value: ["read"] },
    { capability: "browser", value: "true" },
    { capability: "cancellation" },
    { capability: "resume", value: "true" },
    { capability: "tokenMetrics" },
    { capability: "costMetrics", value: "true" },
  ] as any[]) {
    const candidate: any = job();
    candidate.negotiation.capabilities.required = [requirement];
    const result = resolveHostCapabilityPreflight({ report: createFakeCapabilityReport(), jobs: [candidate] });
    assert.equal(result.invalidInput, false, JSON.stringify(requirement));
  }
});

test("hostile proxies and getters return one constant blocked diagnostic without leaking exceptions", () => {
  const hostileInputs: unknown[] = [
    new Proxy({}, { ownKeys() { throw new Error("OWN_KEYS_SECRET"); } }),
    Object.defineProperty({}, "report", { enumerable: true, get() { throw new Error("GETTER_SECRET"); } }),
    { get jobs() { throw "NON_ERROR_SECRET"; }, report: createFakeCapabilityReport() },
    (() => { const value: any = {}; value.self = value; return value; })(),
  ];
  for (const input of hostileInputs) {
    let result: ReturnType<typeof resolveHostCapabilityPreflight> | undefined;
    assert.doesNotThrow(() => { result = resolveHostCapabilityPreflight(input); });
    assert.deepEqual(result, {
      invalidInput: true,
      diagnostics: [{ code: "PREFLIGHT_INPUT_INVALID", path: "$", message: "input could not be safely read as a closed HostPreflightInput value" }],
      status: "blocked",
      launchAllowed: false,
      requestedConcurrency: null,
      effectiveConcurrency: 0,
      executionMode: "sequential",
      jobs: [],
    });
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  }
});

test("getter values are snapshotted once before validation and resolution", () => {
  const source: any = { report: createFakeCapabilityReport(), jobs: [job()] };
  let reads = 0;
  Object.defineProperty(source, "jobs", { enumerable: true, get() { reads += 1; return [job()]; } });
  const result = resolveHostCapabilityPreflight(source);
  assert.equal(result.invalidInput, false);
  assert.equal(reads, 1);
});
