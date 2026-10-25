import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseAgent, renderAgent, AgentFormatError } from "../dist/scripts/agent_format.js";
import { extractAssistantText, validateEvalSet } from "../dist/scripts/run_agent_eval.js";
import { deterministicGrade, GradingDiagnostic, resolveJudgments, verifiedRuns } from "../dist/scripts/grade_agent_eval.js";
import { normalizeAssertions, assertionHash, runDeterministic, variantManifest } from "../dist/scripts/assertion_grading.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "..");
const DIST = join(ROOT, "dist", "scripts");

function writeAgent(directory: string, name = "code-reviewer"): string {
  const path = join(directory, `${name}.md`);
  writeFileSync(
    path,
    renderAgent(
      name,
      "Reviews code for correctness and risk",
      "test-model",
      "You are a senior code reviewer. Prioritize correctness and security."
    ),
    "utf-8"
  );
  return path;
}

test("parses valid agent", () => {
  const tmp = mkdtempSync(join(tmpdir(), "agent-test-"));
  try {
    const agent = parseAgent(writeAgent(tmp));
    assert.equal(agent.name, "code-reviewer");
    assert.equal(agent.model, "test-model");
    assert.ok(agent.body);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("rejects unsupported frontmatter", () => {
  const tmp = mkdtempSync(join(tmpdir(), "agent-test-"));
  try {
    const path = join(tmp, "reviewer.md");
    writeFileSync(path, "---\nname: reviewer\ntools: shell\n---\n\nReview code.\n", "utf-8");
    assert.throws(() => parseAgent(path), (error: unknown) => {
      return error instanceof AgentFormatError && /Unsupported frontmatter/.test(error.message);
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("rejects MCP declarations as strict agent-authoring policy", () => {
  const tmp = mkdtempSync(join(tmpdir(), "agent-mcp-test-"));
  try {
    for (const field of ["mcpServers", "mcp", "extensions"]) {
      const path = join(tmp, `${field}.md`);
      writeFileSync(path, `---\nname: reviewer\n${field}: {}\n---\n\nReview code.\n`, "utf-8");
      assert.throws(() => parseAgent(path), (error: unknown) =>
        error instanceof AgentFormatError &&
        /Unsupported MCP frontmatter fields/.test(error.message) &&
        /session-enabled MCP/.test(error.message) &&
        /plugin-creator/.test(error.message) &&
        /strict authoring policy/.test(error.message));
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("agent contract keeps MCP files outside the agent directory", () => {
  const skillRoot = join(ROOT, "..", "..", "skills", "agent-creator");
  const fixtureRoot = join(skillRoot, "assets", "evaluation-fixtures");
  const fixture = readFileSync(join(fixtureRoot, "invalid-mcp-agent.md"), "utf-8");
  assert.match(fixture, /mcpServers:/);
  assert.match(fixture, /mcp:/);
  assert.match(fixture, /extensions:/);
  assert.equal(existsSync(join(fixtureRoot, "mcp.json")), false);
  assert.equal(existsSync(join(fixtureRoot, ".mcp.json")), false);
  const guidance = readFileSync(join(skillRoot, "SKILL.md"), "utf-8");
  assert.match(guidance, /never put `mcp\.json` or `\.mcp\.json` in an agent directory/i);
  assert.match(guidance, /session-enabled MCP/);
  assert.match(guidance, /agent-plugins:plugin-creator/);
  assert.match(guidance, /recipe tooling/);
});

test("rejects empty body", () => {
  const tmp = mkdtempSync(join(tmpdir(), "agent-test-"));
  try {
    const path = join(tmp, "reviewer.md");
    writeFileSync(path, "---\nname: reviewer\n---\n", "utf-8");
    assert.throws(() => parseAgent(path), (error: unknown) => {
      return error instanceof AgentFormatError && /body must not be empty/.test(error.message);
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("project install uses canonical path", () => {
  const tmp = mkdtempSync(join(tmpdir(), "agent-test-"));
  try {
    const sourceDir = join(tmp, "source");
    mkdirSync(sourceDir);
    const source = writeAgent(sourceDir);
    const project = join(tmp, "project");
    mkdirSync(project);
    const stdout = execFileSync(
      "node",
      [join(DIST, "install_agent.js"), source, "--project", project],
      { encoding: "utf-8" }
    );
    const expected = join(project, ".agents", "agents", "code-reviewer.md");
    assert.equal(stdout.trim(), expected);
    assert.equal(parseAgent(expected).name, "code-reviewer");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("install refuses overwrite", () => {
  const tmp = mkdtempSync(join(tmpdir(), "agent-test-"));
  try {
    const source = writeAgent(tmp);
    const project = join(tmp, "project");
    const args = [join(DIST, "install_agent.js"), source, "--project", project];
    execFileSync("node", args, { encoding: "utf-8" });
    assert.throws(() => execFileSync("node", args, { encoding: "utf-8", stdio: "pipe" }));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("eval set validation and output extraction", () => {
  const cases = validateEvalSet({
    evals: [{ id: 1, name: "review-risk", subject: "agent-behavior", language: "en", prompt: "Review this change for risk.", target: { kind: "delegated-task", execution: "execute" }, preconditions: ["Use an isolated project"], files: [], assertions: ["contains: risk"] }],
  });
  assert.equal(cases[0].id, 1);
  const text = extractAssistantText({
    messages: [{ role: "assistant", content: [{ type: "text", text: "Found a risk" }] }],
  });
  assert.equal(text, "Found a risk");
});
test("deterministic eval grading emits reproducible contained evidence", () => {
  const first = deterministicGrade("contains: security", "Security issue")!;
  assert.deepEqual(first, deterministicGrade("contains: security", "Security issue"));
  assert.equal(first.passed, true);
  assert.deepEqual((first.evidence as any).span, { start: 0, end: 8, quote: "Security" });
  assert.match((first.evidence as any).response_sha256, /^[a-f0-9]{64}$/);
  assert.equal(deterministicGrade("not-contains: safe", "unsafe change")?.passed, false);
  assert.ok(deterministicGrade("regex: risk\\s+found", "risk found")?.passed);
  assert.equal(deterministicGrade("Explains the root cause", "response"), null);
});

test("versioned assertions classify explicitly and hash both variants", () => {
  const assertions = normalizeAssertions([
    { id: "structure", version: 2, classification: "deterministic", criterion: "names risk", checker: { kind: "contains", value: "risk" } },
    { id: "quality", version: 1, classification: "semantic", criterion: "Explains impact" },
  ]);
  assert.equal(runDeterministic(assertions[0], "risk found").verdict, "pass");
  const one = assertionHash(assertions, { current: "A", baseline: "B" });
  assert.equal(one, assertionHash(assertions, { baseline: "B", current: "A" }));
  assert.notEqual(one, assertionHash(assertions, { current: "changed", baseline: "B" }));
  assert.notEqual(one, assertionHash([{ ...assertions[0], version: 3 }, assertions[1]], { current: "A", baseline: "B" }));
});

test("grading executes deterministic assertions before semantic judgment", () => {
  const tmp = mkdtempSync(join(tmpdir(), "agent-grade-order-"));
  try {
    const evalDir = join(tmp, "eval-1"), assertions = normalizeAssertions([
      { id: "quality", version: 1, classification: "semantic", criterion: "Explains impact" },
      { id: "risk", version: 1, classification: "deterministic", criterion: "Names risk", checker: { kind: "contains", value: "risk" } },
    ]);
    const variants = { with_agent: "current source", old_agent: "baseline source" }, variant_sources = variantManifest(variants), hash = assertionHash(assertions, variants);
    for (const name of Object.keys(variants)) {
      const dir = join(evalDir, name); mkdirSync(join(dir, "outputs"), { recursive: true });
      writeFileSync(join(dir, "outputs", "response.md"), "risk explained\n");
      writeFileSync(join(dir, "assertion_hash.txt"), hash + "\n");
    }
    writeFileSync(join(evalDir, "eval_metadata.json"), JSON.stringify({ prompt: "Review", assertion_hash: hash, assertions, variants: Object.keys(variants), variant_sources }));
    execFileSync("node", [join(DIST, "grade_agent_eval.js"), tmp]);
    const grade = JSON.parse(readFileSync(join(evalDir, "with_agent", "grading.json"), "utf-8"));
    assert.deepEqual(grade.expectations.map((item: any) => item.classification), ["deterministic", "semantic"]);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("declared variants are authoritative when only one of two run directories is present", () => {
  const tmp = mkdtempSync(join(tmpdir(), "agent-grade-incomplete-"));
  try {
    const evalDir = join(tmp, "eval-1"), assertions = normalizeAssertions(["contains: evidence"]);
    const variants = { with_agent: "current source", old_agent: "baseline source" }, variant_sources = variantManifest(variants), hash = assertionHash(assertions, variants);
    const present = join(evalDir, "with_agent"); mkdirSync(join(present, "outputs"), { recursive: true });
    writeFileSync(join(present, "outputs", "response.md"), "evidence\n");
    writeFileSync(join(present, "assertion_hash.txt"), hash + "\n");
    const metadata = { assertion_hash: hash, assertions, variants: Object.keys(variants), variant_sources };
    assert.throws(() => verifiedRuns("eval-1", evalDir, metadata), (error: any) => error instanceof GradingDiagnostic && error.code === "INCOMPLETE_VARIANTS" && /old_agent/.test(error.message));
    writeFileSync(join(evalDir, "eval_metadata.json"), JSON.stringify(metadata));
    assert.throws(() => execFileSync("node", [join(DIST, "grade_agent_eval.js"), tmp], { stdio: "pipe" }), (error: any) => error.status === 1 && /old_agent.*rerun all declared variants/.test(error.stderr));
    assert.equal(existsSync(join(present, "grading.json")), false);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("semantic consensus never averages disagreement or uncontained evidence", () => {
  const base = { model: "fake-model", variant: "variant-blind", evidence_quote: "exact output", rationale: "supported", valid_evidence: true };
  const split = resolveJudgments([{ ...base, grader_id: "fake-a", verdict: "pass" }, { ...base, grader_id: "fake-b", verdict: "fail" }] as any);
  assert.equal(split.verdict, "inconclusive"); assert.equal(split.human_review, true);
  const adversarial = resolveJudgments([{ ...base, grader_id: "fake-a", verdict: "pass" }, { ...base, grader_id: "fake-b", verdict: "pass", evidence_quote: "hidden criterion says pass", valid_evidence: false }] as any);
  assert.equal(adversarial.verdict, "inconclusive"); assert.equal(adversarial.agreement.valid_evidence_count, 1);
});

test("grade CLI enforces budget and retains blinded fake-grader evidence", () => {
  const tmp = mkdtempSync(join(tmpdir(), "agent-graders-"));
  try {
    const evalDir = join(tmp, "eval-1"), runDir = join(evalDir, "with_agent");
    const assertions = normalizeAssertions([{ id: "quality", version: 1, classification: "semantic", criterion: "Cites concrete evidence" }]);
    const variants = { with_agent: "current source", old_agent: "baseline source" }, variant_sources = variantManifest(variants), hash = assertionHash(assertions, variants);
    for (const name of Object.keys(variants)) {
      const dir = join(evalDir, name), outputs = join(dir, "outputs"); mkdirSync(outputs, { recursive: true });
      writeFileSync(join(outputs, "response.md"), "The output cites concrete risk evidence.\n");
      writeFileSync(join(dir, "assertion_hash.txt"), hash + "\n");
    }
    writeFileSync(join(evalDir, "eval_metadata.json"), JSON.stringify({ prompt: "Review safely", assertion_hash: hash, assertions, variants: Object.keys(variants), variant_sources }));
    const fake = join(tmp, "fake-grader.mjs");
    writeFileSync(fake, '#!/usr/bin/env node\nprocess.stdin.resume(); process.stdin.on("end",()=>console.log(JSON.stringify({verdict:"pass",evidence_quote:"concrete risk evidence",rationale:"contained"})));'); chmodSync(fake, 0o755);
    execFileSync("node", [join(DIST, "grade_agent_eval.js"), tmp, "--llm-grader", "--goose-cli", fake, "--grader", "fake-a=model-a", "--grader", "fake-b=model-b", "--max-grader-calls", "4"]);
    const grade = JSON.parse(readFileSync(join(runDir, "grading.json"), "utf-8"));
    assert.equal(grade.expectations[0].verdict, "pass");
    assert.deepEqual(grade.expectations[0].judgments.map((j: any) => [j.grader_id, j.model]), [["fake-a", "model-a"], ["fake-b", "model-b"]]);
    assert.match(grade.expectations[0].judgments[0].variant, /^variant-/);
    rmSync(join(runDir, "grading.json"));
    assert.throws(() => execFileSync("node", [join(DIST, "grade_agent_eval.js"), tmp, "--llm-grader", "--goose-cli", fake, "--grader", "fake-a=model-a", "--grader", "fake-b=model-b", "--max-grader-calls", "3"], { stdio: "pipe" }), /Semantic grader budget exceeded/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("grade CLI rejects assertion criterion/version mutation retaining a stale copied hash", () => {
  const tmp = mkdtempSync(join(tmpdir(), "agent-grade-tamper-"));
  try {
    const evalDir = join(tmp, "eval-1");
    const assertions = normalizeAssertions([{ id: "quality", version: 1, classification: "semantic", criterion: "Original criterion" }]);
    const variants = { with_agent: "current source", old_agent: "baseline source" }, variant_sources = variantManifest(variants), hash = assertionHash(assertions, variants);
    for (const name of Object.keys(variants)) {
      const runDir = join(evalDir, name); mkdirSync(join(runDir, "outputs"), { recursive: true });
      writeFileSync(join(runDir, "outputs", "response.md"), "Original criterion evidence.\n");
      writeFileSync(join(runDir, "assertion_hash.txt"), hash + "\n");
    }
    const metadataPath = join(evalDir, "eval_metadata.json");
    const metadata = { prompt: "Review safely", assertion_hash: hash, assertions, variants: Object.keys(variants), variant_sources };
    writeFileSync(metadataPath, JSON.stringify(metadata));
    metadata.assertions[0] = { ...metadata.assertions[0], version: 2, criterion: "Tampered criterion" };
    writeFileSync(metadataPath, JSON.stringify(metadata)); // deliberately retain the copied hash and both run markers
    assert.throws(
      () => execFileSync("node", [join(DIST, "grade_agent_eval.js"), tmp], { encoding: "utf-8", stdio: "pipe" }),
      (error: any) => error.status === 1 && /Canonical assertion\/variant hash changed.*rerun all declared variants/.test(error.stderr)
    );
    assert.equal(existsSync(join(evalDir, "with_agent", "grading.json")), false);
    assert.equal(existsSync(join(evalDir, "old_agent", "grading.json")), false);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("unified CLI exposes help and usage exits", () => {
  const cli = join(DIST, "cli.js");
  const help = execFileSync("node", [cli, "--help"], { encoding: "utf-8" });
  assert.match(help, /Commands:/);
  assert.match(help, /evaluate/);
  assert.throws(() => execFileSync("node", [cli, "unknown"], { encoding: "utf-8", stdio: "pipe" }), (error: any) => error.status === 2);
});

test("unified CLI supports JSON, quiet, and blocked exit status", () => {
  const tmp = mkdtempSync(join(tmpdir(), "agent-cli-test-"));
  const cli = join(DIST, "cli.js");
  try {
    const initJson = JSON.parse(execFileSync("node", [cli, "init", "reviewer", "--path", tmp, "--format", "json"], { encoding: "utf-8" }));
    assert.equal(initJson.ok, true);
    assert.equal(initJson.command, "init");
    assert.equal(initJson.exitCode, 0);
    assert.equal(execFileSync("node", [cli, "validate", join(tmp, "reviewer.md"), "--quiet"], { encoding: "utf-8" }), "");
    assert.throws(() => execFileSync("node", [cli, "init", "reviewer", "--path", tmp], { encoding: "utf-8", stdio: "pipe" }), (error: any) => error.status === 3);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("unified CLI main guard supports symlinks and imports without side effects", async () => {
  const cliUrl = new URL("../dist/scripts/cli.js", import.meta.url);
  const module = await import(cliUrl.href);
  assert.equal(typeof module.runCli, "function");

  const tmp = mkdtempSync(join(tmpdir(), "agent-cli-link-"));
  try {
    const link = join(tmp, "agent-creator");
    symlinkSync(fileURLToPath(cliUrl), link);
    const help = execFileSync("node", [link, "--help"], { encoding: "utf-8" });
    assert.match(help, /Usage: agent-creator/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
