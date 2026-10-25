import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const cli = resolve("dist/scripts/cli.js");
function invoke(args: string[]) { return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" }); }
function skill(valid = true) {
  const root = mkdtempSync(join(tmpdir(), "skill-cli-"));
  const dir = join(root, "demo"); mkdirSync(dir);
  writeFileSync(join(dir, "SKILL.md"), valid ? "---\nname: demo\ndescription: Handles demo workflows. Use when testing demo behavior.\n---\n# Demo\n" : "# invalid\n");
  return dir;
}

test("top-level and command help are successful", () => {
  const top = invoke(["--help"]); assert.equal(top.status, 0); assert.match(top.stdout, /trigger-eval/);
  const command = invoke(["validate", "--help"]); assert.equal(command.status, 0); assert.match(command.stdout, /validate <skill-directory>/);
});

test("direct and unified adaptive help snapshots agree and disclose policy safety semantics", () => {
  for (const [command,direct] of [["full-eval","dist/scripts/full_eval.js"],["aggregate","dist/scripts/aggregate_benchmark.js"]] as const) {
    const unified=invoke([command,"--help"]),standalone=spawnSync(process.execPath,[resolve(direct),"--help"],{encoding:"utf8"});
    assert.equal(unified.status,0);assert.equal(standalone.status,0);assert.equal(unified.stdout,standalone.stdout);
    for(const text of ["--decision-policy fixed|adaptive","default: fixed","winner","regression","futility","inconclusive","continue","max_pairs","aggregate_budget","max_runs","max_turns","timeout_seconds","complete candidate/baseline pairs"])assert.ok(unified.stdout.includes(text),text);
  }
  const full=invoke(["full-eval","--help"]).stdout;for(const text of ["--adaptive-policy <JSON>","anytime_quality_policy","schema_version","method","min_pairs","alpha","quality_bounds","practical_superiority_delta","regression_tolerance","multiplicity","scenarios","futility","Provider-limited or budget-exhausted","--resume"])assert.ok(full.includes(text),text);
});

test("unknown command and missing arguments are usage errors", () => {
  assert.equal(invoke(["unknown"]).status, 2);
  assert.equal(invoke(["validate"]).status, 2);
  assert.equal(invoke(["--format", "yaml"]).status, 2);
});

test("adaptive policy cannot be silently ignored by fixed mode", () => {
  const skillPath = skill();
  const workspace = join(dirname(skillPath), "workspace");
  const direct = resolve("dist/scripts/full_eval.js");
  for (const [entry, prefix] of [[cli, ["full-eval"]], [direct, []]] as const) {
    const result = spawnSync(process.execPath, [entry, ...prefix, skillPath, "--workspace", workspace, "--adaptive-policy", "{}", "--dry-run"], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /--adaptive-policy requires --decision-policy adaptive/);
  }
  assert.equal(existsSync(workspace), false);
});

test("validate supports JSON output and failure exit codes", () => {
  const ok = invoke(["validate", skill(), "--format", "json"]); assert.equal(ok.status, 0);
  const body = JSON.parse(ok.stdout); assert.equal(body.command, "validate"); assert.equal(body.status, "success");
  const bad = invoke(["validate", skill(false), "--format=json"]); assert.equal(bad.status, 1); assert.equal(JSON.parse(bad.stdout).status, "failure");
});

test("quiet suppresses successful text output", () => {
  const result = invoke(["validate", skill(), "--quiet"]); assert.equal(result.status, 0); assert.equal(result.stdout, "");
});

test("every unified subcommand exposes help", () => {
  for (const command of ["candidate", "validate", "audit", "design-evals", "freeze-evals", "analyze", "evidence-loop", "full-eval", "migrate-evaluation", "trigger-eval", "aggregate", "review", "verify", "package", "usability-study", "screen-reader-acceptance"]) assert.equal(invoke([command, "--help"]).status, 0, command);
});

test("migration help requires the external rollback trust anchor",()=>{const output=invoke(["migrate-evaluation","--help"]).stdout;assert.match(output,/--rollback --expected-original-sha256 <sha256>/);});

test("verify maps an incomplete release pipeline to blocked", () => {
  const result = invoke(["verify", skill(), "--format", "json"]);
  assert.equal(result.status, 3);
  const body = JSON.parse(result.stdout);
  assert.equal(body.status, "blocked");
  assert.equal(body.exit_code, 3);
});

test("audit exposes stable authoring findings and pattern decisions", () => {
  const target = skill();
  const result = invoke(["audit", target, "--format", "json"]);
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.command, "audit");
  assert.equal(body.output.artifact, "skill-authoring-audit");
  assert.ok(Array.isArray(body.output.pattern_review));
});


test("screen-reader command fails closed on trust-policy injection and unknown options", () => {
  for (const args of [
    ["screen-reader-acceptance", "--trust-policy", "attacker.json", "records.json"],
    ["screen-reader-acceptance", "--trust-policy=attacker.json", "records.json"],
    ["screen-reader-acceptance", "records.json", "--unknown-option"],
  ]) {
    const result = invoke(args);
    assert.notEqual(result.status, 0, args.join(" "));
    assert.match(result.stderr, /(?:trust-policy.*forbidden|unknown option)/i);
  }
});