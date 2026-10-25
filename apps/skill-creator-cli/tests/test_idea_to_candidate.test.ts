import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import yaml from "js-yaml";
const cli = resolve("dist/scripts/cli.js");
const run = (w: string, a: string[] = []) => spawnSync(process.execPath, [cli, "candidate", w, ...a], { encoding: "utf8" });
function json(r: ReturnType<typeof run>) { assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); }
function ready(w: string, idea = "draft checklists") { let s = json(run(w, ["--idea", idea, "--accept-defaults", "--format", "json"])); s = json(run(w, ["--confirm-contract", s.contractHash, "--format", "json"])); return json(run(w, ["--confirm-scenarios", s.scenarioHash, "--format", "json"])); }

test("novice flow is bounded, resumable, honest, and always reports final assumptions and risks", () => {
  const w = mkdtempSync(join(tmpdir(), "candidate-flow-")); let r = run(w, ["--idea", "summarize incident reports"]);
  assert.equal(r.status, 0); assert.doesNotMatch(r.stdout, /plugin-creator|agent-creator|\{"/); assert.ok((r.stdout.match(/^•/gm) || []).length <= 3);
  let s = json(run(w, ["--accept-defaults", "--format", "json"])); assert.equal(s.stage, "contract-preview");
  s = json(run(w, ["--confirm-contract", s.contractHash, "--format", "json"])); assert.equal(s.stage, "scenario-confirmation"); assert.equal(run(w, ["--confirm-scenarios", "wrong"]).status, 2);
  s = json(run(w, ["--confirm-scenarios", s.scenarioHash, "--format", "json"])); assert.equal(s.stage, "ready");
  const final = run(w, ["--launch", "--fake"]); assert.equal(final.status, 0, final.stderr); assert.match(final.stdout, /Assumptions:/); assert.match(final.stdout, /Risks:/); assert.match(final.stdout, /validation: not-run; evaluation: not-run/);
  const result = JSON.parse(readFileSync(join(w, "evaluation", "result.json"), "utf8")); assert.equal(result.status, "simulated"); assert.equal(result.validation, "not-run"); assert.equal(result.evaluation, "not-run");
});

test("safe YAML serialization handles adversarial scalar content", () => {
  const w = mkdtempSync(join(tmpdir(), "candidate-yaml-")); let s = json(run(w, ["--idea", "safe helper", "--mode", "expert", "--accept-defaults", "--override", "name=x", "--override", "purpose=ok\n---\nname: injected", "--format", "json"]));
  s = json(run(w, ["--confirm-contract", s.contractHash, "--format", "json"])); s = json(run(w, ["--confirm-scenarios", s.scenarioHash, "--format", "json"])); assert.equal(run(w, ["--launch", "--fake"]).status, 0);
  const source = readFileSync(join(w, "candidate", "SKILL.md"), "utf8"); const front = source.match(/^---\n([\s\S]*?)\n---\n/)?.[1]; assert.ok(front); const parsed = yaml.load(front!) as any; assert.equal(parsed.name, "x"); assert.match(parsed.description, /name: injected/); assert.equal((source.match(/^---$/gm) || []).length, 2);
});

test("expert scenario budget is operational and unsupported overrides are rejected", () => {
  const w = mkdtempSync(join(tmpdir(), "candidate-expert-")); let s = json(run(w, ["--idea", "check release notes", "--mode", "expert", "--accept-defaults", "--override", "budgets.scenarioCount=7", "--format", "json"]));
  s = json(run(w, ["--confirm-contract", s.contractHash, "--format", "json"])); assert.equal(s.scenarios.length, 7);
  assert.equal(run(mkdtempSync(join(tmpdir(), "candidate-bad-budget-")), ["--idea", "x", "--mode", "expert", "--accept-defaults", "--override", "budgets.validationRuns=2"]).status, 2);
  assert.match(run(mkdtempSync(join(tmpdir(), "candidate-bad-path-")), ["--idea", "x", "--mode", "expert", "--accept-defaults", "--override", "unknown.field=x"]).stderr, /Unsupported override/);
});

test("question is rendered before being recorded and unanswered questions remain revisitable", () => {
  const w = mkdtempSync(join(tmpdir(), "candidate-questions-")); const first = run(w, ["--idea", "triage reports"]); assert.match(first.stdout, /What should someone/);
  const state = JSON.parse(readFileSync(join(w, "conversation.json"), "utf8")); assert.ok(state.questionsAsked.includes("outcome"));
  const second = run(w); assert.match(second.stdout, /What should someone/); assert.equal(JSON.parse(readFileSync(join(w, "conversation.json"), "utf8")).revision, state.revision);
});

test("read-only resume does not mutate state", () => {
  const w = mkdtempSync(join(tmpdir(), "candidate-readonly-")); run(w, ["--idea", "draft checklists"]); const before = readFileSync(join(w, "conversation.json"), "utf8");
  assert.equal(run(w).status, 0); assert.equal(readFileSync(join(w, "conversation.json"), "utf8"), before);
});

test("tampered hashes and malformed state are rejected", () => {
  const w = mkdtempSync(join(tmpdir(), "candidate-tamper-")); const s = json(run(w, ["--idea", "draft checks", "--accept-defaults", "--format", "json"])); s.contract.purpose = "tampered"; writeFileSync(join(w, "conversation.json"), JSON.stringify(s)); assert.match(run(w).stderr, /hash mismatch/);
  const malformed = mkdtempSync(join(tmpdir(), "candidate-malformed-")); writeFileSync(join(malformed, "conversation.json"), JSON.stringify({ schemaVersion: 1 })); assert.match(run(malformed).stderr, /Invalid/);
});

test("symlink boundaries for generated directories are rejected", () => {
  const w = mkdtempSync(join(tmpdir(), "candidate-symlink-")); ready(w); const outside = mkdtempSync(join(tmpdir(), "candidate-outside-")); symlinkSync(outside, join(w, "candidate"));
  const r = run(w, ["--launch", "--fake"]); assert.equal(r.status, 2); assert.match(r.stderr, /Symlink boundary rejected/); assert.equal(existsSync(join(outside, "SKILL.md")), false);
});

test("existing lock rejects a concurrent mutation without changing revision", () => {
  const w = mkdtempSync(join(tmpdir(), "candidate-lock-")); const s = json(run(w, ["--idea", "draft checks", "--format", "json"])); writeFileSync(join(w, ".conversation.lock"), "other\n");
  const r = run(w, ["--answer", "outcome=new"]); assert.equal(r.status, 2); assert.match(r.stderr, /busy/); assert.equal(JSON.parse(readFileSync(join(w, "conversation.json"), "utf8")).revision, s.revision);
});

test("parallel writers serialize and preserve both answers", async () => {
  const w = mkdtempSync(join(tmpdir(), "candidate-concurrency-")); run(w, ["--idea", "draft checks"]);
  const invoke = (arg: string) => new Promise<number | null>(resolveDone => { const p = spawn(process.execPath, [cli, "candidate", w, "--answer", arg], { stdio: "ignore" }); p.on("close", resolveDone); });
  const statuses = await Promise.all([invoke("outcome=one"), invoke("users=two")]); assert.ok(statuses.includes(0)); assert.ok(statuses.every(x => x === 0 || x === 2));
  const state = JSON.parse(readFileSync(join(w, "conversation.json"), "utf8")); assert.ok(state.answers.outcome === "one" || state.answers.users === "two");
});
