import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditSkill } from "../dist/scripts/audit_skill.js";

function fixture(description: string, body = "# Demo\n\nFollow the workflow, then validate the output.\n") {
  const root = mkdtempSync(join(tmpdir(), "audit-skill-")), skill = join(root, "demo");
  mkdirSync(skill);
  writeFileSync(join(skill, "SKILL.md"), "---\nname: demo\ndescription: " + description + "\n---\n\n" + body);
  return { root, skill };
}

test("authoring audit passes concise discovery metadata and emits pattern decisions", () => {
  const f = fixture("Processes demo files. Use when the user requests demo processing.");
  try {
    const result = auditSkill(f.skill);
    assert.equal(result.status, "pass");
    assert.equal(result.summary.errors, 0);
    assert.ok(result.pattern_review.some((p) => p.pattern === "feedback-loop" && p.relevant));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("authoring audit fails non-English metadata, nonportable paths, missing references, and oversized entrypoints", () => {
  const body = "# Demo\n\nTraite les fichiers quand nécessaire. Read [details](references/missing.md). Use scripts\\helper.py.\n" + "Required step.\n".repeat(505);
  const f = fixture("Traite les fichiers. Utilisez-le quand nécessaire.", body);
  try {
    const result = auditSkill(f.skill);
    assert.equal(result.status, "fail");
    for (const rule of ["metadata-language", "instruction-language", "entrypoint-line-budget", "portable-paths", "missing-reference"]) assert.ok(result.findings.some((x) => x.rule === rule), rule);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
