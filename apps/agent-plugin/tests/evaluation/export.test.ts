import type { CampaignOverviewHistory } from "../../src/application/ports/campaign-overview-history.ts";
import { SqliteEvaluationHistory } from "../../src/adapters/outbound/storage/sqlite-evaluation-history.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { main } from "../../src/main.ts";

test("export CLI advertises explicit required grading selectors and optional quality-only benchmark", async () => {
  let out = "", err = "";
  const code = await main(["export", "--help"], { writeOut: s => { out += s; }, writeErr: s => { err += s; } });
  assert.equal(code, 0); assert.equal(err, "");
  for (const flag of ["--grading", "--output", "--benchmark"]) assert.ok(out.includes(flag));
});

import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, rename, symlink, writeFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startNodeProcess } from "../helpers/subprocess.ts";
import { spawnSync } from "node:child_process";
import { exportCampaign, exportLimits, type ExportRun } from "../../src/application/use-cases/export-campaign.ts";
import type { VerifiedAttempt } from "../../src/application/ports/verified-attempt.ts";
import type { JudgmentRecord } from "../../src/application/ports/judgment-history.ts";
import { FilesystemExportWriter } from "../../src/adapters/outbound/reporting/filesystem-export-writer.ts";
import { qualityBenchmark } from "../../src/domain/quality-benchmark.ts";
import { FilesystemEvaluationSource } from "../../src/adapters/outbound/filesystem/filesystem-evaluation-source.ts";
import { prepareEvaluation } from "../../src/application/use-cases/prepare-evaluation.ts";
import { executeEvaluation } from "../../src/application/use-cases/execute-evaluation.ts";
import { SqliteEvaluationStore } from "../../src/adapters/outbound/storage/sqlite-evaluation-store.ts";
import { captureAttemptMetadata, evidenceDigest, SqliteVerifiedAttemptReader } from "../../src/adapters/outbound/storage/sqlite-verified-attempt.ts";
import { SqliteJudgmentStore } from "../../src/adapters/outbound/storage/sqlite-judgment-store.ts";
import { SqliteJudgmentHistory } from "../../src/adapters/outbound/storage/sqlite-judgment-history.ts";
import { Database } from "../../src/adapters/outbound/storage/sqlite-database.ts";
import { gradeAttempt } from "../../src/application/use-cases/grade-attempt.ts";
import type { JudgeRequest, JudgeResult } from "../../src/application/ports/judge.ts";
const now = () => "2026-11-06T09:00:00.000Z";
const campaignId = "00000000-0000-0000-0000-000000000001";
const bytes = Buffer.from('{"messages":[{"role":"assistant","content":"<script>evil()</script>"}]}');
const sha = createHash("sha256").update(bytes).digest("hex");
function required<T>(value: T | undefined | null): T { assert.ok(value !== undefined && value !== null); return value; }
function fake(repetition = 1, condition: "with" | "without" = "with", scenario = "skill/eval-1"): ExportRun {
  const attempt: VerifiedAttempt = { campaignId, attemptId: randomUUID(), trialId: randomUUID(), manifestDigest: "a".repeat(64), evidenceDigest: "b".repeat(64),
    request: { task: "task <script>", criteria: [{ id: "criterion-1", text: "good" }], artifacts: [{ path: "goose/conversation.json", sha256: sha, kind: "text", text: bytes.toString() }] },
    artifacts: [{ path: "goose/conversation.json", sha256: sha, content: bytes }], metadata: {
      profile: { id: "profile", name: "composed", revision: "revision" }, scenario: { id: scenario, sourceId: 1, skill: "/source/skill", suite: "/source/skill/evals/evals.json", source: { skillName: "skill" } },
      agent: "goose", condition, repetition, pairId: `${scenario}/${repetition}`, options: { agents: ["goose"], model: "requested", repetitions: 2, maxTurns: 5, timeout: 0, parallelism: 1 },
      receipt: { status: "completed", exitCode: 0, sessionName: "session", collection: "complete", startedAt: now(), finishedAt: now(), host: { id: "goose", version: "fake" }, limitations: [] }, protectedRoots: [],
    } };
  const grade: JudgmentRecord = { campaignId, attemptId: attempt.attemptId, trialId: attempt.trialId, id: randomUUID(), createdAt: now(), manifestDigest: attempt.manifestDigest, evidenceDigest: attempt.evidenceDigest, requestDigest: "c".repeat(64), status: "completed",
    outcome: { status: "completed", judgments: [{ id: "criterion-1", text: "good", verdict: condition === "with" ? "pass" : "fail", rationale: "inspected", evidence: [{ path: "goose/conversation.json", sha256: sha, quote: bytes.toString() }] }] },
    provenance: { host: { id: "goose", version: "fake" }, model: { source: "configuration-default", effective: "unknown" }, limits: { maxTurns: 5, timeout: 0, preflightTimeout: 1, exportTimeout: 1, outputBytes: 1024 } }, verification: { storedBindings: "validated", archives: "not-reverified" } };
  return { attempt, grade, evalId: 1, grading: { expectations: [{ text: "good", passed: condition === "with", evidence: "inspected" }], summary: { passed: condition === "with" ? 1 : 0, failed: condition === "with" ? 0 : 1, total: 1, pass_rate: condition === "with" ? 1 : 0 } } };
}
function memory(runs: ExportRun[]) {
  let publication: { files: { path: string; content: Uint8Array }[]; roots: string[] } | undefined;
  return { overviewHistory: { overview: async () => {
    const first = required(runs[0]).attempt;
    return { campaignId: first.campaignId, profile: first.metadata.profile, options: first.metadata.options,
      trials: [...new Map(runs.map(run => [run.attempt.trialId, run.attempt])).values()].map((attempt, sequence) => ({ trialId: attempt.trialId, sequence, scenarioId: attempt.metadata.scenario.id, source: attempt.metadata.scenario.source, agent: attempt.metadata.agent, repetition: attempt.metadata.repetition, pairId: attempt.metadata.pairId, condition: attempt.metadata.condition, status: "finalized", attemptId: attempt.attemptId, attemptStatus: attempt.metadata.receipt.status })) };
  } } as CampaignOverviewHistory, history: { list: async () => runs.map(run => run.grade) }, reader: { readAttempt: async (s: { attemptId: string }) => {
    const run = runs.find(run => run.attempt.attemptId === s.attemptId); if (!run) throw new Error("missing"); return structuredClone(run.attempt);
  } }, writer: { publish: async (_output: string, files: { path: string; content: Uint8Array }[], roots: string[]) => { publication = { files, roots }; } }, now,
  published: () => publication };
}
function selection(runs: ExportRun[], benchmark = false) { return { campaignId, gradingIds: runs.map(run => run.grade.id), output: "/new-output", benchmark }; }
function decoded(deps: ReturnType<typeof memory>, path: string) {
  const file = deps.published()?.files.find(file => file.path === path); assert.ok(file); return JSON.parse(Buffer.from(file.content).toString());
}

test("workspace preserves explicit older grade, exact false grading and safe original artifact paths with numeric composed-source mapping", async () => {
  const older = fake(2, "without", "z/eval-1"), newer = structuredClone(older); newer.grade.id = randomUUID(); newer.grade.outcome = { status: "technical-error", message: "new failure" }; newer.grade.status = "technical-error";
  const other = fake(1, "with", "a/eval-1");
  const deps = memory([newer, other, older]);
  assert.deepEqual(await exportCampaign(selection([older, other]), deps), { kind: "workspace", runs: 2 });
  const grade = decoded(deps, "iteration-1/eval-2/without_skill/run-2/grading.json");
  assert.equal(grade.expectations[0].passed, false); assert.deepEqual(grade.summary, { passed: 0, failed: 1, total: 1, pass_rate: 0 });
  assert.equal(decoded(deps, "iteration-1/eval-2/eval_metadata.json").eval_id, 2);
  assert.equal(decoded(deps, "iteration-1/eval-2/without_skill/run-2/eval_metadata.json").prompt, "task <script>");
  const manifest = decoded(deps, "export-manifest.json");
  assert.deepEqual(manifest.benchmark, { availability: "absent", reason: "not-requested" });
  assert.deepEqual(manifest.runs.map((r: { scenario: { sourceId: number; id: string } }) => r.scenario.sourceId), [1, 1]);
  assert.equal(manifest.runs[1].gradeId, older.grade.id);
  assert.deepEqual(manifest.runs[1].scenario.source, { skillName: "skill" });
  assert.deepEqual(decoded(deps, "iteration-1/eval-2/eval_metadata.json").source, { skillName: "skill" });
  assert.ok(!deps.published()?.files.some(f => f.path.endsWith("benchmark.json")));
  const original = deps.published()?.files.find(f => f.path.endsWith("without_skill/run-2/outputs/artifacts/goose/conversation.json"));
  assert.deepEqual(Buffer.from(original?.content ?? []), bytes);
  assert.ok(deps.published()?.files.some(f => f.path.endsWith("outputs/transcript.json")));
});

test("overview keeps every planned status and all grade metadata without fallback, raw failures or candidate/judge confusion", async () => {
  const run = fake(), later = structuredClone(run), inconclusive = structuredClone(run), unselected = fake(2);
  later.grade.id = randomUUID(); later.grade.status = "technical-error";
  later.grade.outcome = { status: "technical-error", message: "SECRET-technical-diagnostic" };
  later.grade.provenance = null;
  inconclusive.grade.id = randomUUID();
  if (inconclusive.grade.outcome.status === "completed") required(inconclusive.grade.outcome.judgments[0]).verdict = "inconclusive";
  const deps = memory([run, later, inconclusive, unselected]);
  const snapshot = await deps.overviewHistory.overview(campaignId);
  for (const [index, status] of ["pending", "running", "uncertain"].entries()) snapshot.trials.push({ ...required(snapshot.trials[0]), trialId: `ungraded-${index}`, sequence: snapshot.trials.length,
    status, attemptId: status === "pending" ? null : randomUUID(), attemptStatus: status === "pending" ? null : status === "running" ? "running" : "interrupted" });
  deps.overviewHistory.overview = async () => snapshot;
  await exportCampaign(selection([run]), deps);
  const overview = decoded(deps, "overview.json");
  assert.deepEqual(Object.keys(overview).sort(), ["campaignId", "candidateModel", "profile", "schemaVersion", "trials"]);
  assert.equal(overview.schemaVersion, 1); assert.equal(overview.campaignId, campaignId);
  assert.deepEqual(overview.candidateModel, { source: "override", requested: "requested", effective: "unknown" });
  assert.deepEqual(overview.profile, run.attempt.metadata.profile);
  assert.deepEqual(overview.trials.map((t: { status: string }) => t.status), ["finalized", "finalized", "pending", "running", "uncertain"]);
  assert.deepEqual(overview.trials[0], { ...snapshot.trials[0], selectedGradeId: run.grade.id,
    grades: [{ id: run.grade.id, attemptId: run.attempt.attemptId, status: "completed", outcomeClass: "decisive", judge: run.grade.provenance },
      { id: later.grade.id, attemptId: run.attempt.attemptId, status: "technical-error", outcomeClass: "technical-error", judge: null },
      { id: inconclusive.grade.id, attemptId: run.attempt.attemptId, status: "completed", outcomeClass: "inconclusive", judge: inconclusive.grade.provenance }],
    score: { passed: 1, failed: 0, total: 1, passRate: 1 } });
  for (const trial of overview.trials.slice(1)) { assert.equal(trial.selectedGradeId, null); assert.equal(trial.score, null); }
  assert.equal(overview.trials[1].grades[0].outcomeClass, "decisive");
  assert.ok(!JSON.stringify(overview).includes("SECRET"));
  assert.equal(decoded(deps, "export-manifest.json").overview, "overview.json");
});

test("overview refuses mismatched frozen selected coordinates and malformed nonselected grade bindings before writing", async () => {
  for (const field of ["attemptId", "attemptStatus", "scenarioId", "agent", "pairId", "repetition", "condition"] as const) {
    const run = fake(), deps = memory([run]), snapshot = await deps.overviewHistory.overview(campaignId);
    Object.assign(required(snapshot.trials[0]), { [field]: field === "repetition" ? 2 : "wrong" });
    deps.overviewHistory.overview = async () => snapshot;
    await assert.rejects(exportCampaign(selection([run]), deps), /frozen overview bindings/); assert.equal(deps.published(), undefined);
  }
  const run = fake(), other = fake(2); other.grade.trialId = "missing";
  const deps = memory([run, other]);
  await assert.rejects(exportCampaign(selection([run]), deps), /overview grade binding/); assert.equal(deps.published(), undefined);
});

test("selection and verified canonical boundaries reject unknown/duplicate/trial/digest/criteria/inconclusive/technical/empty before publication", async () => {
  for (const mutation of [
    (r: ExportRun) => { r.grade.manifestDigest = "d".repeat(64); },
    (r: ExportRun) => { r.grade.evidenceDigest = "d".repeat(64); },
    (r: ExportRun) => { r.grade.trialId = "wrong"; },
    (r: ExportRun) => { r.grade.outcome = { status: "technical-error", message: "failed" }; },
    (r: ExportRun) => { if (r.grade.outcome.status === "completed" && r.grade.outcome.judgments[0]) r.grade.outcome.judgments[0].verdict = "inconclusive"; },
    (r: ExportRun) => { r.attempt.request.criteria = []; r.grade.outcome = { status: "completed", judgments: [] }; },
    (r: ExportRun) => { if (r.grade.outcome.status === "completed" && r.grade.outcome.judgments[0]) required(r.grade.outcome.judgments[0].evidence[0]).quote = "invented"; },
  ]) {
    const run = fake(); mutation(run); const deps = memory([run]);
    await assert.rejects(exportCampaign(selection([run]), deps)); assert.equal(deps.published(), undefined);
  }
  const run = fake(), duplicate = structuredClone(run); duplicate.grade.id = randomUUID();
  const deps = memory([run, duplicate]);
  for (const ids of [[], [randomUUID()], [run.grade.id, run.grade.id], [run.grade.id, duplicate.grade.id], ["bad"], Array.from({ length: 1001 }, randomUUID)]) {
    await assert.rejects(exportCampaign({ ...selection([run]), gradingIds: ids }, deps));
  }
  assert.equal(deps.published(), undefined);
  await assert.rejects(exportCampaign(selection([run]), { ...deps, now: () => "invalid" }), /timestamp/);
});

test("quality-only benchmark statistics use independent n-1 reference, actual repetitions, delta and no unavailable metrics", async () => {
  const runs = [fake(1, "with"), fake(1, "without"), fake(2, "with"), fake(2, "without")];
  required(runs[2]).grading.summary = { passed: 1, failed: 1, total: 2, pass_rate: 0.5 };
  required(runs[3]).grading.summary = { passed: 1, failed: 1, total: 2, pass_rate: 0.5 };
  const benchmark = qualityBenchmark(runs, now());
  assert.deepEqual(benchmark.run_summary.with_skill.pass_rate, { mean: 0.75, stddev: 0.3536, min: 0.5, max: 1 });
  assert.deepEqual(benchmark.run_summary.without_skill.pass_rate, { mean: 0.25, stddev: 0.3536, min: 0, max: 0.5 });
  assert.deepEqual(benchmark.run_summary.delta, { pass_rate: "+0.5000" });
  assert.equal(benchmark.metadata.runs_per_configuration, 2); assert.equal(benchmark.metadata.analyzer_model, null);
  assert.deepEqual(Object.keys(benchmark.run_summary.with_skill), ["pass_rate"]);
  assert.deepEqual(Object.keys(required(benchmark.runs[0]).result).sort(), ["failed", "pass_rate", "passed", "total"]);
  const singleton = qualityBenchmark(runs.slice(0, 2), now());
  assert.equal(singleton.run_summary.with_skill.pass_rate.stddev, 0);
  assert.equal(singleton.metadata.runs_per_configuration, 1);
});

test("benchmark accepts distinct judge instruction packet hashes and retains each in the manifest", async () => {
  const pair = [fake(1, "with"), fake(1, "without")];
  required(required(pair[0]).grade.provenance).instructionsSha256 = "d".repeat(64);
  required(required(pair[1]).grade.provenance).instructionsSha256 = "e".repeat(64);
  const deps = memory(pair);
  assert.deepEqual(await exportCampaign(selection(pair, true), deps), { kind: "quality-only-benchmark", runs: 2 });
  assert.deepEqual(decoded(deps, "iteration-1/benchmark.json").run_summary.delta, { pass_rate: "+1.0000" });
  assert.deepEqual(decoded(deps, "export-manifest.json").runs.map((run: { judge: { instructionsSha256: string } }) => run.judge.instructionsSha256), ["d".repeat(64), "e".repeat(64)]);
});

test("benchmark refuses partial pairs, nonrectangular repetitions and mixed requested/judge configurations, workspace allows decisive failed processes", async () => {
  const pair = [fake(1, "with"), fake(1, "without")];
  assert.throws(() => qualityBenchmark(pair.slice(0, 1), now()), /pairs/);
  assert.throws(() => qualityBenchmark([...pair, fake(2, "with"), fake(2, "without"), fake(1, "with", "other"), fake(1, "without", "other")].map(r => ({ ...r, evalId: r.attempt.metadata.scenario.id === "other" ? 2 : 1 })), now()), /rectangular/);
  for (const mutate of [
    (r: ExportRun) => { r.attempt.metadata.options.model = "different"; },
    (r: ExportRun) => { r.attempt.metadata.agent = "codex"; },
    (r: ExportRun) => { required(r.grade.provenance).limits.timeout = 99; },
    (r: ExportRun) => { required(r.grade.provenance).model.requested = "other"; },
    (r: ExportRun) => { r.attempt.metadata.receipt.collection = "partial"; },
    (r: ExportRun) => { r.attempt.metadata.receipt.status = "nonzero"; },
    (r: ExportRun) => { r.attempt.metadata.pairId = "different"; },
  ]) {
    const changed = structuredClone(pair); mutate(required(changed[1])); assert.throws(() => qualityBenchmark(changed, now()));
  }
  required(pair[0]).attempt.metadata.receipt.status = "nonzero";
  assert.equal((await exportCampaign(selection(pair.slice(0, 1)), memory(pair))).kind, "workspace");
  await assert.rejects(exportCampaign(selection(pair, true), memory(pair)));
  const clash = fake(); clash.attempt.metadata.agent = "codex";
  await assert.rejects(exportCampaign(selection([required(pair[0]), clash]), memory([required(pair[0]), clash])), /collide/);
});

const payload = [{ path: "iteration-1/data.json", content: Buffer.from("{}") }, { path: "export-manifest.json", content: Buffer.from('{"schemaVersion":1}') }];
test("filesystem exclusive publication preserves any existing object, source ancestry and symlink parents; hashes actual sorted bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "export-files-"));
  try {
    const writer = new FilesystemExportWriter(join(root, "registry", "db"));
    for (const kind of ["dir", "file", "link"] as const) {
      const dest = join(root, kind);
      if (kind === "dir") await mkdir(dest); else if (kind === "file") await writeFile(dest, "sentinel"); else await symlink(join(root, "file"), dest);
      await assert.rejects(writer.publish(dest, payload, []), /already exists/);
      if (kind === "file") assert.equal(await readFile(dest, "utf8"), "sentinel");
    }
    await symlink(root, join(root, "ancestor"));
    await assert.rejects(writer.publish(join(root, "ancestor", "new"), payload, []), /Unsafe/);
    await mkdir(join(root, "source"));
    await assert.rejects(writer.publish(join(root, "source", "new"), payload, [join(root, "source")]), /overlaps/);
    await assert.rejects(writer.publish(join(root, "registry", "new"), payload, []));
    await assert.rejects(writer.publish(join(root, "missing", "new"), payload, []));
    const dest = join(root, "complete"); await writer.publish(dest, payload, []);
    const manifest = JSON.parse(await readFile(join(dest, "export-manifest.json"), "utf8"));
    assert.equal(manifest.status, "complete");
    assert.deepEqual(manifest.files, [{ path: "iteration-1/data.json", bytes: 2, sha256: createHash("sha256").update("{}").digest("hex") }]);
    assert.deepEqual(await readdir(dest), ["export-manifest.json", "iteration-1"]);
    for (const bad of ["../escape", "a/../b", "a\\b", "/absolute"]) await assert.rejects(writer.publish(join(root, "bad"), [{ path: bad, content: bytes }, required(payload[1])], []), /Unsafe/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("staging failure removes disposable residue, preserves sibling sentinel and competing destination", async () => {
  const root = await mkdtemp(join(tmpdir(), "export-race-"));
  try {
    const dest = join(root, "race");
    const race = new FilesystemExportWriter(join(root, "registry", "db"), async path => {
      assert.equal((await lstat(path)).size, 0); await mkdir(dest); await writeFile(join(dest, "foreign"), "sentinel");
    });
    await assert.rejects(race.publish(dest, payload, []), /EEXIST/);
    assert.equal(await readFile(join(dest, "foreign"), "utf8"), "sentinel");
    await writeFile(join(root, "sentinel"), "sibling stays intact");
    const fail = new FilesystemExportWriter(join(root, "registry", "db"), async path => {
      await writeFile(path, "partial");
      await writeFile(join(path, "../scratch"), "temporary residue");
      throw new Error("injected write failure");
    });
    await assert.rejects(fail.publish(join(root, "failure"), payload, []), /injected/);
    assert.deepEqual(await readdir(root), ["race", "sentinel"]);
    assert.equal(await readFile(join(root, "sentinel"), "utf8"), "sibling stays intact");
    await assert.rejects(lstat(join(root, "failure")), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("publication write failure removes only owned files, retains foreign sentinel and no complete manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "export-publication-fail-"));
  try {
    const dest = join(root, "failed");
    const writer = new FilesystemExportWriter(join(root, "registry", "db"), undefined, async path => {
      if (path.endsWith("data.json")) { await writeFile(join(dest, "foreign"), "preserve"); throw new Error("publication failure"); }
    });
    await assert.rejects(writer.publish(dest, payload, []), /publication failure/);
    assert.deepEqual(await readdir(dest), ["foreign"]);
    assert.equal(await readFile(join(dest, "foreign"), "utf8"), "preserve");
  } finally { await rm(root, { recursive: true, force: true }); }
});

function judged(request: JudgeRequest, fail = false): JudgeResult {
  const artifact = required(request.artifacts[0]);
  return { outcome: { status: "completed", judgments: request.criteria.map(criterion => ({ ...criterion, verdict: fail ? "fail" : "pass", rationale: "inspected", evidence: [{ path: artifact.path, sha256: artifact.sha256, quote: artifact.kind === "text" ? artifact.text : "" }] })) },
    provenance: { host: { id: "goose", version: "fixture" }, model: { source: "configuration-default", effective: "unknown" }, limits: { maxTurns: request.options?.maxTurns ?? 50, timeout: request.options?.timeout ?? 0, preflightTimeout: 1, exportTimeout: 1, outputBytes: 1024 } } };
}
async function sqliteFixture(kind: "standalone" | "plugin" | "combined" = "standalone", ownerFault?: "missing" | "ambiguous", model?: string) {
  const root = await mkdtemp(join(tmpdir(), "sqlite-export-"));
  const skill = join(root, "skill"); await mkdir(join(skill, "evals"), { recursive: true });
  await writeFile(join(skill, "SKILL.md"), "skill");
  await writeFile(join(skill, "evals", "evals.json"), JSON.stringify({ evals: [{ id: 1, prompt: "task", expectations: ["works"] }] }));
  const plugin = join(root, "checkout-folder");
  if (kind !== "standalone") {
    await mkdir(join(plugin, "skills"), { recursive: true });
    await cp(skill, join(plugin, "skills", "child"), { recursive: true });
    await writeFile(join(plugin, "plugin.json"), JSON.stringify({ name: "declared-plugin" }));
  }
  const plan = await prepareEvaluation({ skills: kind === "plugin" ? [] : [skill], plugins: kind === "standalone" ? [] : [plugin], profileName: "export fixture", ...(model === undefined ? {} : { model }), agents: ["goose"], repetitions: 1, maxTurns: 5, timeout: 0, parallelism: 1 }, new FilesystemEvaluationSource());
  if (ownerFault) {
    const component = required(plan.profile.components[0]);
    if (ownerFault === "missing") component.skillRoots = [`${component.root}-prefix-match-only`];
    else plan.profile.components.push(structuredClone(component));
  }
  const registry = join(root, "registry", "db.sqlite");
  let calls = 0;
  const result = await executeEvaluation(plan, new Map([["goose", { preflight: async () => {}, run: async () => {
    calls++; return { status: "completed" as const, collection: "complete" as const, exitCode: 0, sessionName: "fixture", startedAt: now(), finishedAt: now(), host: { id: "goose", version: "fixture" }, limitations: [],
      artifacts: [{ path: "goose/conversation.json", content: bytes }, { path: "workspace/subdir/file.txt", content: Buffer.from("exact original") }] };
  } }]]), new SqliteEvaluationStore(join(root, "evidence"), registry), randomUUID);
  const db = new Database(registry, { readonly: true });
  const attempts = db.query<{ id: string; condition: string }, []>("SELECT id,condition FROM trials ORDER BY condition").all(); db.close();
  const reader = new SqliteVerifiedAttemptReader(registry), store = new SqliteJudgmentStore(registry);
  const grades = [];
  for (const attempt of ownerFault ? [] : attempts) grades.push(await gradeAttempt({ campaignId: result.id, attemptId: attempt.id }, { reader, store, newId: randomUUID, judge: { judge: async request => judged(request, attempt.condition === "without") } }));
  return { root, skill, registry, result, attempts, grades, reader, store, calls: () => calls, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("frozen exact scenario owner projects standalone and declared plugin names across plugin-only and combined exports without regrading", async () => {
  for (const kind of ["standalone", "plugin", "combined"] as const) {
    const f = await sqliteFixture(kind);
    try {
      const before = await readFile(f.registry);
      // Remove mutable sources: export identity must come entirely from the frozen plan.
      await rm(f.skill, { recursive: true });
      if (kind !== "standalone") await rm(join(f.root, "checkout-folder"), { recursive: true });
      const db = new Database(f.registry, { readonly: true });
      const first = required(f.attempts[0]);
      const captured = captureAttemptMetadata(db, { campaignId: f.result.id, attemptId: first.id });
      db.close();
      assert.deepEqual(Object.keys(captured), ["campaign", "retained", "attempt", "logical", "request", "manifest"]);
      assert.equal("source" in captured.request.scenario, false, "do not extend hashed capture metadata");
      const record = required((await new SqliteJudgmentHistory(f.registry).list({ campaignId: f.result.id })).find(grade => grade.attemptId === first.id));
      assert.equal(evidenceDigest(captured), record.evidenceDigest);
      const deps = { overviewHistory: new SqliteEvaluationHistory(f.registry), history: new SqliteJudgmentHistory(f.registry), reader: f.reader, writer: new FilesystemExportWriter(f.registry), now };
      for (const name of ["first-export", "reexport-existing-grades"]) {
        const destination = join(f.root, name);
        await exportCampaign({ campaignId: f.result.id, gradingIds: f.grades.map(grade => grade.id), output: destination, benchmark: false }, deps);
        const manifest = JSON.parse(await readFile(join(destination, "export-manifest.json"), "utf8"));
        const actual = new Map<string, object>();
        for (const run of manifest.runs) {
          const expected = run.scenario.skill.endsWith("/child") ? { skillName: "child", pluginName: "declared-plugin" } : { skillName: "skill" };
          assert.deepEqual(run.scenario.source, expected);
          actual.set(run.scenario.source.skillName, expected);
          const runMetadata = JSON.parse(await readFile(join(destination, run.path, "eval_metadata.json"), "utf8"));
          assert.deepEqual(runMetadata.source, expected);
          const scenarioMetadata = JSON.parse(await readFile(join(destination, "iteration-1", `eval-${run.evalId}`, "eval_metadata.json"), "utf8"));
          assert.deepEqual(scenarioMetadata.source, expected);
        }
        assert.deepEqual([...actual.keys()].sort(), kind === "combined" ? ["child", "skill"] : [kind === "plugin" ? "child" : "skill"]);
      }
      assert.equal(f.calls(), kind === "combined" ? 4 : 2);
      assert.deepEqual(await readFile(f.registry), before, "no regrading or registry updates during reexport");
    } finally { await f.cleanup(); }
  }
});

test("real verified reader refuses missing or multiple frozen owners rather than guessing a source prefix", async () => {
  for (const fault of ["missing", "ambiguous"] as const) {
    const f = await sqliteFixture("standalone", fault);
    try {
      const before = await readFile(f.registry);
      await assert.rejects(f.reader.readAttempt({ campaignId: f.result.id, attemptId: required(f.attempts[0]).id }), /Missing or ambiguous frozen scenario source owner/);
      assert.deepEqual(await readFile(f.registry), before);
    } finally { await f.cleanup(); }
  }
});

test("export refuses missing, unsafe or conflicting explicit source identities before publishing", async () => {
  for (const source of [undefined, {}, { skillName: "" }, { skillName: "skill", pluginName: "" }, { skillName: "wrong/path" }, { skillName: "skill", pluginName: "bad:name" }]) {
    const run = fake();
    Object.assign(run.attempt.metadata.scenario, { source });
    const deps = memory([run]);
    await assert.rejects(exportCampaign(selection([run]), deps), /Invalid scenario source metadata/);
    assert.equal(deps.published(), undefined);
  }
  const pair = [fake(1, "with"), fake(1, "without")];
  required(pair[1]).attempt.metadata.scenario.source = { skillName: "skill", pluginName: "other-owner" };
  const deps = memory(pair);
  await assert.rejects(exportCampaign(selection(pair), deps), /Ambiguous scenario source metadata/);
  assert.equal(deps.published(), undefined);
});

test("real SQLite explicit CLI export is readonly, selects older grade, revalidates corrupt evidence and authenticates extended snapshot metadata", async () => {
  const f = await sqliteFixture();
  try {
    const firstAttempt = required(f.attempts[0]);
    const view = await f.reader.readAttempt({ campaignId: f.result.id, attemptId: firstAttempt.id });
    assert.equal(view.metadata.profile.name, "export fixture"); assert.equal(view.metadata.repetition, 1);
    assert.deepEqual(view.metadata.scenario.source, { skillName: "skill" });
    const untouched = structuredClone(view);
    view.metadata.scenario.source.pluginName = "forged-owner";
    await assert.rejects(f.store.appendJudgment(randomUUID(), view, judged(view.request)), /modified/);
    delete view.metadata.scenario.source.pluginName;
    view.metadata.profile.name = "forged";
    await assert.rejects(f.store.appendJudgment(randomUUID(), view, judged(view.request)), /modified/);
    await gradeAttempt({ campaignId: f.result.id, attemptId: firstAttempt.id }, { reader: f.reader, store: f.store, newId: randomUUID, judge: { judge: async request => judged(request, true) } });
    const beforeDB = await readFile(f.registry), beforeSource = await readFile(join(f.skill, "SKILL.md"));
    const dest = join(f.root, "export"); let out = "", err = "";
    const args = ["export", f.result.id, "--registry", f.registry, "--output", dest, "--benchmark", ...f.grades.flatMap(grade => ["--grading", grade.id])];
    assert.equal(await main(args, { writeOut: s => { out += s; }, writeErr: s => { err += s; } }), 0, err);
    assert.match(out, /quality-only-benchmark; 2 selected runs/); assert.equal(err, "");
    assert.equal(f.calls(), 2);
    const manifest = JSON.parse(await readFile(join(dest, "export-manifest.json"), "utf8"));
    assert.deepEqual(manifest.selection.gradingIds, f.grades.map(g => g.id));
    const benchmark = JSON.parse(await readFile(join(dest, "iteration-1", "benchmark.json"), "utf8"));
    assert.deepEqual(benchmark.run_summary.delta, { pass_rate: "+1.0000" });
    assert.equal(benchmark.metadata.executor_model, null);
    for (const file of manifest.files) assert.equal(createHash("sha256").update(await readFile(join(dest, file.path))).digest("hex"), file.sha256);
    assert.equal(await readFile(join(dest, "iteration-1/eval-1/with_skill/run-1/outputs/artifacts/workspace/subdir/file.txt"), "utf8"), "exact original");
    assert.deepEqual(await readFile(f.registry), beforeDB); assert.deepEqual(await readFile(join(f.skill, "SKILL.md")), beforeSource);
    assert.equal(await main(args, { writeOut: () => assert.fail("no successful output"), writeErr: () => {} }), 1);
    const proof = join(f.result.output, "artifacts", untouched.attemptId, "goose/conversation.json"); await writeFile(proof, "corruption");
    const invalid = join(f.root, "invalid");
    await assert.rejects(exportCampaign({ campaignId: f.result.id, gradingIds: f.grades.map(g => g.id), output: invalid, benchmark: false }, { reader: f.reader, overviewHistory: new SqliteEvaluationHistory(f.registry), history: new SqliteJudgmentHistory(f.registry), writer: new FilesystemExportWriter(f.registry), now }), /integrity/);
    await assert.rejects(lstat(invalid), /ENOENT/); assert.deepEqual(await readFile(f.registry), beforeDB);
  } finally { await f.cleanup(); }
});

test("contained copied installed launcher exports explicit SQLite grades without app or module fallback", async () => {
  const f = await sqliteFixture();
  try {
    const sourceRoot = process.env.SKILL_CREATOR_SKILL_ROOT ?? fileURLToPath(new URL("../../../../skills/skill-creator/", import.meta.url));
    const installed = join(f.root, "installed skill");
    // Build gates must generate this closure before tests; a missing/stale mirror
    // is a failure, not a skip or permission to rebuild while consumers run.
    await cp(sourceRoot, installed, { recursive: true });
    await lstat(join(installed, "runtime/dist/index.js"));
    await assert.rejects(lstat(join(f.root, "apps")), /ENOENT/);
    await gradeAttempt({ campaignId: f.result.id, attemptId: required(f.attempts.find(attempt => attempt.condition === "with")).id },
      { reader: f.reader, store: f.store, newId: randomUUID, judge: { judge: async request => judged(request, true) } });
    async function snapshot(directory: string): Promise<{ path: string; sha256: string }[]> {
      const files: { path: string; sha256: string }[] = [];
      for (const item of await readdir(directory, { withFileTypes: true })) {
        if (item.isDirectory()) for (const child of await snapshot(join(directory, item.name))) files.push({ ...child, path: join(item.name, child.path) });
        else files.push({ path: item.name, sha256: createHash("sha256").update(await readFile(join(directory, item.name))).digest("hex") });
      }
      return files.sort((a, b) => a.path.localeCompare(b.path));
    }
    const protectedPaths = [join(f.root, "registry"), f.skill, f.result.output, installed];
    const before = await Promise.all(protectedPaths.map(snapshot));
    const dest = join(f.root, "installed export");
    const env: NodeJS.ProcessEnv = { PATH: "", HOME: f.root, XDG_CONFIG_HOME: f.root,
      XDG_DATA_HOME: f.root, XDG_STATE_HOME: f.root, XDG_CACHE_HOME: f.root };
    const result = await startNodeProcess([join(installed, "scripts/skill-creator.mjs"), "export", f.result.id,
      "--registry", f.registry, "--output", dest, "--benchmark", ...f.grades.flatMap(grade => ["--grading", grade.id])], { cwd: f.root, env }).completed;
    assert.equal(result.exitCode, 0, result.stdout + result.stderr); assert.equal(result.signal, null);
    assert.equal(result.stdout, "Export complete: quality-only-benchmark; 2 selected runs\n");
    assert.equal(f.calls(), 2);
    assert.deepEqual(await Promise.all(protectedPaths.map(snapshot)), before);
    const manifest = JSON.parse(await readFile(join(dest, "export-manifest.json"), "utf8"));
    assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.status, "complete");
    await assert.rejects(lstat(join(dest, ".export-pending")), /ENOENT/);
    assert.equal(manifest.campaignId, f.result.id);
    assert.deepEqual(manifest.selection, { gradingIds: f.grades.map(grade => grade.id), strategy: "explicit-one-grade-per-logical-trial" });
    assert.deepEqual(manifest.runs.map((run: { gradeId: string }) => run.gradeId).sort(), f.grades.map(grade => grade.id).sort());
    assert.deepEqual(manifest.runs.map((run: { path: string }) => run.path), ["iteration-1/eval-1/with_skill/run-1", "iteration-1/eval-1/without_skill/run-1"]);
    assert.deepEqual(await readdir(dest), ["export-manifest.json", "iteration-1", "overview.json"]);
    assert.equal(manifest.overview, "overview.json");
    assert.ok(manifest.files.some((file: { path: string }) => file.path === "overview.json"));
    for (const file of manifest.files) {
      const bytes = await readFile(join(dest, file.path));
      assert.equal(bytes.length, file.bytes);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
    }
    for (const [condition, rate] of [["with_skill", 1], ["without_skill", 0]] as const) {
      const dir = join(dest, "iteration-1/eval-1", condition, "run-1");
      const grading = JSON.parse(await readFile(join(dir, "grading.json"), "utf8"));
      assert.deepEqual(grading.summary, { passed: rate, failed: 1-rate, total: 1, pass_rate: rate });
      assert.deepEqual(grading.expectations, [{ text: "works", passed: rate === 1,
        evidence: `inspected\ngoose/conversation.json (sha256: ${sha}): ${JSON.stringify(bytes.toString())}` }]);
      assert.deepEqual(await readFile(join(dir, "outputs/transcript.json")), bytes);
      assert.equal(await readFile(join(dir, "outputs/artifacts/workspace/subdir/file.txt"), "utf8"), "exact original");
    }
    const benchmark = JSON.parse(await readFile(join(dest, "iteration-1/benchmark.json"), "utf8"));
    assert.deepEqual(benchmark.run_summary.delta, { pass_rate: "+1.0000" });
    assert.equal(benchmark.metadata.quality_only, true); assert.equal(benchmark.metadata.executor_model, null);
    assert.deepEqual(Object.keys(benchmark.run_summary.with_skill), ["pass_rate"]);
  } finally { await f.cleanup(); }
});

test("two exported model campaigns retain candidate override/default separately from judge provenance and authenticate overview bytes", async () => {
  for (const model of [undefined, "candidate-only-model"]) {
    const f = await sqliteFixture("combined", undefined, model);
    try {
      const before = await readFile(f.registry), dest = join(f.root, "overview-export");
      const code = await main(["export", f.result.id, ...f.grades.flatMap(g => ["--grading", g.id]), "--output", dest, "--registry", f.registry], { writeOut: () => {}, writeErr: () => {} });
      assert.equal(code, 0);
      const overviewBytes = await readFile(join(dest, "overview.json")), overview = JSON.parse(overviewBytes.toString()), manifest = JSON.parse(await readFile(join(dest, "export-manifest.json"), "utf8"));
      assert.equal(overview.trials.length, 4);
      assert.deepEqual(overview.candidateModel, model === undefined ? { source: "configuration-default", effective: "unknown" } : { source: "override", requested: model, effective: "unknown" });
      for (const trial of overview.trials) { assert.deepEqual(trial.grades[0].judge.model, { source: "configuration-default", effective: "unknown" });assert.ok(trial.score); }
      assert.deepEqual(overview.trials.map((t: { source: unknown }) => t.source), [{ skillName: "child", pluginName: "declared-plugin" }, { skillName: "child", pluginName: "declared-plugin" }, { skillName: "skill" }, { skillName: "skill" }]);
      assert.equal(manifest.overview, "overview.json");
      assert.deepEqual(manifest.files.find((file: { path: string }) => file.path === "overview.json"), { path: "overview.json", sha256: createHash("sha256").update(overviewBytes).digest("hex"), bytes: overviewBytes.length });
      assert.deepEqual(await readFile(f.registry), before);
    } finally { await f.cleanup(); }
  }
});

test("readonly judgment history still rejects malformed JSON and structurally invalid stored plans", async () => {
  const f = await sqliteFixture();
  try {
    for (const plan of ["{", "{}"]) {
      const db = new Database(f.registry);
      db.query("UPDATE experiments SET plan_json=? WHERE id=?").run(plan, f.result.id);
      db.close();
      const before = await readFile(f.registry);
      await assert.rejects(new SqliteJudgmentHistory(f.registry).list({ campaignId: f.result.id }), /invalid registry or grading bindings/);
      assert.deepEqual(await readFile(f.registry), before);
    }
  } finally { await f.cleanup(); }
});

test("projection byte bounds are explicit and refuse oversize JSON before writer", async () => {
  assert.deepEqual(exportLimits, { selectedGrades: 1000, totalBytes: 536870912, jsonBytes: 16777216 });
  const run = fake(); run.attempt.request.task = "x".repeat(exportLimits.jsonBytes);
  const deps = memory([run]); await assert.rejects(exportCampaign(selection([run]), deps), /JSON byte/); assert.equal(deps.published(), undefined);
});

const upstream = process.env.ANTHROPIC_SKILL_CREATOR_ROOT;
test("optional checksum-pinned real upstream find_runs/build_run and quality renderer omit absent time/tokens", { skip: !upstream }, async () => {
  assert.ok(upstream);
  const source = join(upstream, "eval-viewer/generate_review.py"), viewer = join(upstream, "eval-viewer/viewer.html");
  assert.equal(createHash("sha256").update(await readFile(source)).digest("hex"), "fc9d1b9243fe5ab6012ebd579bd76d0035de1b79fd3b969de114defab26478fb");
  assert.equal(createHash("sha256").update(await readFile(viewer)).digest("hex"), "a53213426ee1100441d701a3a0d49cda7a842f992d2c36463f4d3cc0258575fa");
  const f = await sqliteFixture();
  try {
    const dest = join(f.root, "export");
    await exportCampaign({ campaignId: f.result.id, gradingIds: f.grades.map(g => g.id), output: dest, benchmark: true }, { reader: f.reader, overviewHistory: new SqliteEvaluationHistory(f.registry), history: new SqliteJudgmentHistory(f.registry), writer: new FilesystemExportWriter(f.registry), now });
    const python = spawnSync("python3", ["-c", `import importlib.util,json,sys\nfrom pathlib import Path\nspec=importlib.util.spec_from_file_location('review',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nr=m.find_runs(Path(sys.argv[2]));assert len(r)==2;assert all(x['eval_id']==1 and x['prompt']=='task' for x in r);assert all(any(o['name']=='transcript.json' and o['type']=='text' for o in x['outputs']) for x in r);assert sorted(x['grading']['summary']['pass_rate'] for x in r)==[0,1];print('find_runs/build_run PASS')`, source, dest], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
    assert.equal(python.status, 0, python.stderr);
    const html = await readFile(viewer, "utf8");
    const start = html.indexOf("    function renderBenchmark()"), end = html.indexOf("\n    }", start) + 6;
    const benchmark = JSON.parse(await readFile(join(dest, "iteration-1/benchmark.json"), "utf8"));
    let rendered = "";
    const node = { style: {}, set innerHTML(value: string) { rendered = value; } };
    // Execute the actual pinned renderer with a tiny DOM boundary, not a copied algorithm.
    const render = new Function("EMBEDDED_DATA", "document", "escapeHtml", `${html.slice(start, end)}\nrenderBenchmark();`);
    render({ benchmark }, { getElementById: () => node }, (text: string) => text.replaceAll("<", "&lt;").replaceAll(">", "&gt;"));
    assert.match(rendered, /QUALITY-ONLY/); assert.match(rendered, /Pass Rate/); assert.ok(!rendered.includes("Time (seconds)")); assert.ok(!rendered.includes("Tokens"));
    assert.match(rendered, /100% \(1\/1\)/); assert.match(rendered, /0% \(0\/1\)/);
  } finally { await f.cleanup(); }
});

test("aggregate output bytes (including repeated source copies) reject before publication without huge allocations", async () => {
  const run = fake(), content = new Uint8Array(1024 * 1024);
  run.attempt.artifacts = Array.from({ length: 513 }, (_, index) => ({ path: `files/${index}.bin`, sha256: sha, content }));
  const deps = memory([run]);
  await assert.rejects(exportCampaign(selection([run]), deps), /total byte/); assert.equal(deps.published(), undefined);
});

test("staged byte corruption cannot publish a complete export and copied executable content remains data", async () => {
  const root = await mkdtemp(join(tmpdir(), "export-stage-integrity-"));
  try {
    const dest = join(root, "corrupt");
    const stagedPayload = [...payload, { path: "iteration-1/z.json", content: Buffer.from("{}") }];
    const writer = new FilesystemExportWriter(join(root, "registry", "db"), async path => {
      if (path.endsWith("z.json")) await writeFile(join(path, "../data.json"), "corrupt");
    });
    await assert.rejects(writer.publish(dest, stagedPayload, []), /Staged export bytes changed/);
    await assert.rejects(lstat(dest), /ENOENT/);
    const valid = join(root, "valid");
    const run = fake(), memoryDeps = memory([run]); await exportCampaign(selection([run]), memoryDeps);
    await new FilesystemExportWriter(join(root, "registry", "db")).publish(valid, required(memoryDeps.published()).files, []);
    const info = await lstat(join(valid, "iteration-1/eval-1/with_skill/run-1/outputs/artifacts/goose/conversation.json"));
    assert.equal(info.mode & 0o111, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("caller mutation after publish starts cannot change frozen paths, bytes or manifest metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "export-snapshot-"));
  try {
    const files = payload.map(file => ({ path: file.path, content: Buffer.from(file.content) }));
    const dest = join(root, "ready");
    const publication = new FilesystemExportWriter(join(root, "registry", "db")).publish(dest, files, []);
    required(files[0]).path = "redirected.json"; required(files[0]).content.fill(120);
    required(files[1]).content.fill(120); files.length = 0;
    await publication;
    assert.equal(await readFile(join(dest, "iteration-1/data.json"), "utf8"), "{}");
    const manifest = JSON.parse(await readFile(join(dest, "export-manifest.json"), "utf8"));
    assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.status, "complete");
    assert.deepEqual(manifest.files, [{ path: "iteration-1/data.json", bytes: 2, sha256: createHash("sha256").update("{}").digest("hex") }]);
    await assert.rejects(lstat(join(dest, ".export-pending")), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("caller root mutation after publish starts cannot remove source protection", async () => {
  const root = await mkdtemp(join(tmpdir(), "export-root-snapshot-"));
  try {
    const source = join(root, "source"); await mkdir(source);
    const roots = [source], dest = join(source, "export");
    const publication = new FilesystemExportWriter(join(root, "registry", "db")).publish(dest, payload, roots);
    roots[0] = join(root, "unrelated"); roots.length = 0;
    await assert.rejects(publication, /overlaps/);
    assert.deepEqual(await readdir(source), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("later publication hook corruption of an already written payload refuses readiness and cleans owned files", async () => {
  const root = await mkdtemp(join(tmpdir(), "export-final-integrity-"));
  try {
    const dest = join(root, "refused");
    const writer = new FilesystemExportWriter(join(root, "registry", "db"), undefined, async path => {
      if (path.endsWith("export-manifest.json")) await writeFile(join(dest, "iteration-1/data.json"), "xx");
    });
    await assert.rejects(writer.publish(dest, payload, []), /Published export bytes changed/);
    await assert.rejects(lstat(dest), /ENOENT/); assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("published payload inode replacement refuses readiness without deleting the foreign replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "export-final-identity-"));
  try {
    const dest = join(root, "refused"), foreign = join(dest, "iteration-1/data.json");
    const writer = new FilesystemExportWriter(join(root, "registry", "db"), undefined, async path => {
      if (path.endsWith("export-manifest.json")) {
        // Create the foreign inode before removing the owned one, avoiding inode reuse.
        const replacement = join(dest, "replacement"); await writeFile(replacement, "foreign");
        await rm(foreign); await rename(replacement, foreign);
      }
    });
    await assert.rejects(writer.publish(dest, payload, []), /Export file identity changed/);
    assert.equal(await readFile(foreign, "utf8"), "foreign");
    await assert.rejects(lstat(join(dest, "export-manifest.json")), /ENOENT/);
    await assert.rejects(lstat(join(dest, ".export-pending")), /ENOENT/);
    assert.deepEqual(await readdir(dest), ["iteration-1"]);
    assert.deepEqual(await readdir(root), ["refused"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

