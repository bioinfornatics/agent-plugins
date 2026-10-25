import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  EvidenceDiagnostic, JOB_SCHEMA, RUN_SCHEMA, canonicalJson, exportEvidenceJob, importEvidenceRun, sha256, validateEvidenceRun,
} from "../dist/scripts/evidence_exchange.js";
import { assertionHashFromManifest, normalizeAssertions } from "../dist/scripts/assertion_grading.js";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "evidence-exchange-"));
  const sources = join(root, "sources"), fixtures = join(sources, "fixtures");
  mkdirSync(fixtures, { recursive: true });
  const agent = join(sources, "reviewer.md"), evalSet = join(sources, "evals.json");
  writeFileSync(agent, "---\nname: reviewer\ndescription: Reviews changes\n---\n\nReview evidence.\n");
  writeFileSync(join(fixtures, "change.txt"), "unsafe input\n");
  writeFileSync(evalSet, JSON.stringify({ evals: [{ id: "risk", name: "risk review", prompt: "Review it", subject: "behavior", language: "en", target: { kind: "task" }, preconditions: [], files: ["fixtures/change.txt"], capabilities: {}, coverage_tags: ["risk"], assertions: ["contains: risk"] }] }));
  const bundle = join(root, "bundle");
  const job = exportEvidenceJob({ agentPath: agent, evalSetPath: evalSet, outputDir: bundle, fixtureRoot: sources, now: "2026-09-17T18:00:00Z" });
  return { root, bundle, job };
}

function runFor(job: any, overrides: Record<string, any> = {}) {
  const text = "Risk found.";
  return { schema_version: RUN_SCHEMA, job_id: job.job_id, run_id: "manual-1", eval_id: "risk", configuration: "with_agent",
    response: { text, sha256: sha256(text) }, timing: { total_duration_seconds: 12.5, total_tokens: 42 },
    provenance: { source: "manual", producer: "reviewer@example", captured_at: "2026-09-17T18:10:00Z" },
    trust: { level: "unverified", reason: "Direct manual import; not independently reviewed." }, ...overrides };
}

test("exports a portable job with immutable fixture references and canonical example", () => {
  const state = setup();
  try {
    assert.equal(state.job.schema_version, JOB_SCHEMA);
    assert.match(state.job.job_id, /^job_[a-f0-9]{64}$/);
    assert.deepEqual(state.job.fixtures.map(item => item.ref), ["fixtures/fixtures/change.txt"]);
    assert.equal(state.job.notice.includes("do not constitute CI attestation"), true);
    const schema = JSON.parse(readFileSync(join(state.bundle, "run.schema.json"), "utf-8"));
    assert.equal(schema.$id, RUN_SCHEMA);
    const example = JSON.parse(readFileSync(join(state.bundle, "run.example.json"), "utf-8"));
    assert.doesNotThrow(() => validateEvidenceRun(example, state.job));
  } finally { rmSync(state.root, { recursive: true, force: true }); }
});

test("imports canonical evidence into evaluation layout and duplicate import is idempotent", () => {
  const state = setup();
  try {
    const run = runFor(state.job), runPath = join(state.root, "run.json"), workspace = join(state.root, "workspace");
    writeFileSync(runPath, JSON.stringify(run));
    const first = importEvidenceRun({ jobPath: join(state.bundle, "job.json"), runPath, workspace });
    const second = importEvidenceRun({ jobPath: join(state.bundle, "job.json"), runPath, workspace });
    assert.equal(first.status, "imported");
    assert.equal(second.status, "duplicate");
    const evalDir = join(workspace, "eval-risk"), metadata = JSON.parse(readFileSync(join(evalDir, "eval_metadata.json"), "utf-8"));
    const independentlyComputed = assertionHashFromManifest(normalizeAssertions(metadata.assertions), metadata.variant_sources);
    assert.equal(metadata.schema_version, 2);
    assert.deepEqual(metadata.variants, ["with_agent", "without_agent_instructions"]);
    assert.equal(metadata.assertion_hash, independentlyComputed);
    assert.equal(readFileSync(join(evalDir, "with_agent", "assertion_hash.txt"), "utf-8"), independentlyComputed + "\n");
    assert.equal(readFileSync(join(evalDir, "with_agent", "outputs", "response.md"), "utf-8"), "Risk found.\n");
    assert.equal(JSON.parse(readFileSync(join(evalDir, "with_agent", "evidence.json"), "utf-8")).provenance.source, "manual");
  } finally { rmSync(state.root, { recursive: true, force: true }); }
});

test("export, import, grade, and aggregate preserve a string eval_id through an encoded directory", () => {
  const state = setup();
  try {
    const evalSetPath = join(state.root, "sources", "evals.json");
    const evalSet = JSON.parse(readFileSync(evalSetPath, "utf-8"));
    evalSet.evals[0].id = "group/risk";
    writeFileSync(evalSetPath, JSON.stringify(evalSet));

    const bundle = join(state.root, "encoded-bundle");
    const job = exportEvidenceJob({
      agentPath: join(state.root, "sources", "reviewer.md"), evalSetPath, outputDir: bundle,
      fixtureRoot: join(state.root, "sources"), now: "2026-09-17T18:00:00Z",
    });
    const runPath = join(state.root, "run.json"), workspace = join(state.root, "workspace");
    writeFileSync(runPath, JSON.stringify(runFor(job, { eval_id: "group/risk" })));
    importEvidenceRun({ jobPath: join(bundle, "job.json"), runPath, workspace });
    writeFileSync(runPath, JSON.stringify(runFor(job, { eval_id: "group/risk", run_id: "manual-2", configuration: "without_agent_instructions" })));
    importEvidenceRun({ jobPath: join(bundle, "job.json"), runPath, workspace });

    const evalDir = join(workspace, "eval-group%2Frisk");
    const importedMetadata = JSON.parse(readFileSync(join(evalDir, "eval_metadata.json"), "utf-8"));
    assert.equal(importedMetadata.eval_id, "group/risk");
    assert.equal(importedMetadata.eval_name, "risk review");

    const dist = fileURLToPath(new URL("../dist/scripts/", import.meta.url));
    execFileSync("node", [join(dist, "grade_agent_eval.js"), workspace], { encoding: "utf-8" });
    execFileSync("node", [join(dist, "aggregate_benchmark.js"), workspace], { encoding: "utf-8" });
    const benchmark = JSON.parse(readFileSync(join(workspace, "benchmark.json"), "utf-8"));
    assert.deepEqual(benchmark.metadata.evals_run, ["group/risk"]);
    assert.equal(benchmark.runs[0].eval_id, "group/risk");
    assert.equal(benchmark.runs[0].result.pass_rate, 1);
  } finally { rmSync(state.root, { recursive: true, force: true }); }
});

test("reports wrong-job, stale workspace, conflicting duplicates, and stale bundle diagnostics", () => {
  const state = setup();
  try {
    const workspace = join(state.root, "workspace"), runPath = join(state.root, "run.json"), jobPath = join(state.bundle, "job.json");
    writeFileSync(runPath, JSON.stringify(runFor(state.job, { job_id: "job_wrong" })));
    assert.throws(() => importEvidenceRun({ jobPath, runPath, workspace }), (e: any) => e instanceof EvidenceDiagnostic && e.code === "WRONG_JOB");
    mkdirSync(workspace); writeFileSync(join(workspace, "evidence_job.json"), JSON.stringify({ job_id: "job_old" }));
    writeFileSync(runPath, JSON.stringify(runFor(state.job)));
    assert.throws(() => importEvidenceRun({ jobPath, runPath, workspace }), (e: any) => e.code === "STALE_JOB");
    rmSync(workspace, { recursive: true });
    importEvidenceRun({ jobPath, runPath, workspace });
    const changed = runFor(state.job); changed.response = { text: "Different", sha256: sha256("Different") };
    writeFileSync(runPath, JSON.stringify(changed));
    assert.throws(() => importEvidenceRun({ jobPath, runPath, workspace }), (e: any) => e.code === "DUPLICATE_CONFLICT");
    writeFileSync(join(state.bundle, "fixtures", "fixtures", "change.txt"), "tampered\n");
    assert.throws(() => importEvidenceRun({ jobPath, runPath, workspace: join(state.root, "other") }), (e: any) => e.code === "STALE_BUNDLE");
  } finally { rmSync(state.root, { recursive: true, force: true }); }
});

test("rejects tampered canonical import metadata and run markers with typed stale-eval diagnostics", () => {
  for (const tamper of [
    (workspace: string) => {
      const path = join(workspace, "eval-risk", "eval_metadata.json"), document = JSON.parse(readFileSync(path, "utf-8"));
      document.assertions[0].criterion = "tampered while retaining copied hash";
      writeFileSync(path, JSON.stringify(document));
    },
    (workspace: string) => writeFileSync(join(workspace, "eval-risk", "with_agent", "assertion_hash.txt"), "0".repeat(64) + "\n"),
  ]) {
    const state = setup();
    try {
      const workspace = join(state.root, "workspace"), runPath = join(state.root, "run.json"), jobPath = join(state.bundle, "job.json");
      writeFileSync(runPath, JSON.stringify(runFor(state.job)));
      importEvidenceRun({ jobPath, runPath, workspace });
      tamper(workspace);
      assert.throws(() => importEvidenceRun({ jobPath, runPath, workspace }),
        (error: any) => error instanceof EvidenceDiagnostic && error.code === "STALE_EVAL");
    } finally { rmSync(state.root, { recursive: true, force: true }); }
  }
});

test("exports object assertions and reports malformed assertions as typed eval-set diagnostics", () => {
  const state = setup();
  try {
    const evalSetPath = join(state.root, "sources", "evals.json"), document = JSON.parse(readFileSync(evalSetPath, "utf-8"));
    document.evals[0].assertions = [{ id: "risk-found", version: 2, classification: "deterministic", criterion: "Names risk", checker: { kind: "contains", value: "risk" } }];
    writeFileSync(evalSetPath, JSON.stringify(document));
    const job = exportEvidenceJob({ agentPath: join(state.root, "sources", "reviewer.md"), evalSetPath,
      outputDir: join(state.root, "object-bundle"), fixtureRoot: join(state.root, "sources") });
    assert.equal((job.evals[0].assertions[0] as any).id, "risk-found");

    document.evals[0].assertions[0].version = 0;
    writeFileSync(evalSetPath, JSON.stringify(document));
    assert.throws(() => exportEvidenceJob({ agentPath: join(state.root, "sources", "reviewer.md"), evalSetPath,
      outputDir: join(state.root, "invalid-bundle"), fixtureRoot: join(state.root, "sources") }),
      (error: any) => error instanceof EvidenceDiagnostic && error.code === "INVALID_EVAL_SET" && /positive integer version/.test(error.message));
  } finally { rmSync(state.root, { recursive: true, force: true }); }
});

test("enforces provenance and reviewed trust identity without implying CI attestation", () => {
  const state = setup();
  try {
    assert.throws(() => validateEvidenceRun(runFor(state.job, { provenance: { source: "ci", producer: "pipeline", captured_at: "2026-01-01T00:00:00Z" } }), state.job), (e: any) => e.code === "INVALID_PROVENANCE");
    assert.throws(() => validateEvidenceRun(runFor(state.job, { trust: { level: "human-reviewed", reason: "Checked" } }), state.job), (e: any) => e.code === "INVALID_TRUST");
    assert.doesNotThrow(() => validateEvidenceRun(runFor(state.job, { trust: { level: "human-reviewed", reason: "Checked against transcript", reviewed_by: "A. Reviewer" } }), state.job));
  } finally { rmSync(state.root, { recursive: true, force: true }); }
});


test("runtime validation matches the closed exported schema and strict RFC3339 timestamps", () => {
  const state = setup();
  try {
    const mutations = [
      { extra: true },
      { response: { ...runFor(state.job).response, extra: true } },
      { timing: { total_duration_seconds: 1, extra: true } },
      { provenance: { ...runFor(state.job).provenance, extra: true } },
      { trust: { ...runFor(state.job).trust, extra: true } },
      { provenance: { ...runFor(state.job).provenance, captured_at: "2026-09-17 18:10:00Z" } },
      { provenance: { ...runFor(state.job).provenance, captured_at: "2026-02-30T18:10:00Z" } },
      { provenance: { ...runFor(state.job).provenance, captured_at: "2026-09-17T18:10:00" } },
    ];
    for (const mutation of mutations)
      assert.throws(() => validateEvidenceRun(runFor(state.job, mutation), state.job), (error: any) => error instanceof EvidenceDiagnostic);
    assert.doesNotThrow(() => validateEvidenceRun(runFor(state.job, {
      provenance: { ...runFor(state.job).provenance, captured_at: "2026-09-17T20:10:00+02:00" },
    }), state.job));
  } finally { rmSync(state.root, { recursive: true, force: true }); }
});

test("import recomputes job identity and rejects injected evals or configurations", () => {
  for (const inject of [
    (job: any) => job.evals.push({ ...job.evals[0], id: "injected", metadata_sha256: job.evals[0].metadata_sha256 }),
    (job: any) => job.configurations.push("injected"),
  ]) {
    const state = setup();
    try {
      const jobPath = join(state.bundle, "job.json"), document = JSON.parse(readFileSync(jobPath, "utf-8"));
      inject(document); writeFileSync(jobPath, JSON.stringify(document));
      const runPath = join(state.root, "run.json"); writeFileSync(runPath, JSON.stringify(runFor(state.job)));
      assert.throws(() => importEvidenceRun({ jobPath, runPath, workspace: join(state.root, "workspace") }),
        (error: any) => error instanceof EvidenceDiagnostic && error.code === "INVALID_JOB");
    } finally { rmSync(state.root, { recursive: true, force: true }); }
  }
});

test("manifest eval metadata is bound exactly to checksummed evals.json even when job_id is recomputed", () => {
  for (const mutate of [
    (job: any) => { job.evals[0].prompt = "Altered manifest prompt"; },
    (job: any) => { job.evals[0].metadata_sha256 = "0".repeat(64); },
    (job: any) => { job.evals[0].extra = "injected"; },
    (job: any) => { job.evals[0].id = "other"; },
  ]) {
    const state = setup();
    try {
      const jobPath = join(state.bundle, "job.json"), document = JSON.parse(readFileSync(jobPath, "utf-8"));
      mutate(document);
      const identity = { agent_sha256: document.agent.sha256, eval_set_sha256: document.eval_set.sha256,
        fixtures: [...document.fixtures].sort((a: any, b: any) => String(a.source).localeCompare(String(b.source))),
        configurations: document.configurations, evals: document.evals };
      document.job_id = "job_" + sha256(canonicalJson(identity));
      writeFileSync(jobPath, JSON.stringify(document));
      const runPath = join(state.root, "run.json"); writeFileSync(runPath, JSON.stringify(runFor(document)));
      assert.throws(() => importEvidenceRun({ jobPath, runPath, workspace: join(state.root, "workspace") }),
        (error: any) => error instanceof EvidenceDiagnostic && error.code === "INVALID_JOB");
    } finally { rmSync(state.root, { recursive: true, force: true }); }
  }
});

test("eval IDs are validated, encoded, and remain contained in the workspace", () => {
  const state = setup();
  try {
    const jobPath = join(state.bundle, "job.json"), document = JSON.parse(readFileSync(jobPath, "utf-8"));
    document.evals[0].id = "group/risk";
    const base = { ...document.evals[0] }; delete base.metadata_sha256;
    document.evals[0].metadata_sha256 = sha256(JSON.stringify(base, Object.keys(base).sort()));
    // Re-exporting is the supported way to derive identity; use canonical helpers through a fresh fixture.
    const evalSetPath = join(state.root, "sources", "evals.json");
    const evalSet = JSON.parse(readFileSync(evalSetPath, "utf-8")); evalSet.evals[0].id = "group/risk";
    writeFileSync(evalSetPath, JSON.stringify(evalSet));
    const bundle = join(state.root, "encoded-bundle");
    const encodedJob = exportEvidenceJob({ agentPath: join(state.root, "sources", "reviewer.md"), evalSetPath,
      outputDir: bundle, fixtureRoot: join(state.root, "sources"), now: "2026-09-17T18:00:00Z" });
    const runPath = join(state.root, "encoded-run.json");
    writeFileSync(runPath, JSON.stringify(runFor(encodedJob, { eval_id: "group/risk" })));
    const result = importEvidenceRun({ jobPath: join(bundle, "job.json"), runPath, workspace: join(state.root, "workspace") });
    assert.equal(result.destination.endsWith("eval-group%2Frisk/with_agent"), true);
    assert.equal(result.destination.startsWith(join(state.root, "workspace") + "/"), true);

    const badEvalSet = join(state.root, "bad-evals.json");
    writeFileSync(badEvalSet, JSON.stringify({ evals: [{ id: "bad\npath", prompt: "x" }] }));
    assert.throws(() => exportEvidenceJob({ agentPath: join(state.root, "sources", "reviewer.md"), evalSetPath: badEvalSet,
      outputDir: join(state.root, "bad-bundle"), fixtureRoot: state.root }), (error: any) => error.code === "INVALID_EVAL_ID");
  } finally { rmSync(state.root, { recursive: true, force: true }); }
});

test("rejects unpaired UTF-16 surrogates with a stable typed diagnostic before path encoding", () => {
  for (const id of ["bad\uD800id", "bad\uDC00id"]) {
    const state = setup();
    try {
      const evalSetPath = join(state.root, "sources", "evals.json");
      const document = JSON.parse(readFileSync(evalSetPath, "utf-8")); document.evals[0].id = id;
      writeFileSync(evalSetPath, JSON.stringify(document));
      assert.throws(() => exportEvidenceJob({ agentPath: join(state.root, "sources", "reviewer.md"), evalSetPath,
        outputDir: join(state.root, "surrogate-bundle"), fixtureRoot: join(state.root, "sources") }),
      (error: any) => error instanceof EvidenceDiagnostic && error.code === "INVALID_EVAL_ID" && !/URIError/.test(error.message));
    } finally { rmSync(state.root, { recursive: true, force: true }); }
  }
});

