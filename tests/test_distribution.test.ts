import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { projectProduction, verifyProduction } from "../scripts/production.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_NAME = "agent-plugins";
const SKILLS = join(ROOT, "skills");
const APPS = join(ROOT, "apps");
const EXPECTED_SKILLS = new Set(["skill-creator", "agent-creator", "hook-creator", "plugin-creator", "plugin-script-packaging"]);

// Follow a specific consuming link, not a reference-directory scan: an orphaned
// or historical document must not satisfy an active instruction guarantee.
function activeLinkedReference(source: string, target: string): string {
  const text = readFileSync(source, "utf8");
  const links = [...text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(match => match[1]);
  assert.ok(links.includes(target), `${source}: missing active route to ${target}`);
  assert.ok(!target.split("/").includes("historical"), `${target}: historical route is not active`);
  const reference = readFileSync(join(dirname(source), target), "utf8");
  assert.doesNotMatch(reference, /^>[^\n]*(?:historical|inactive|retired)/im, `${target}: inactive reference`);
  return reference;
}


test("open plugins manifest", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf-8"));
  assert.equal(manifest.name, PLUGIN_NAME);
  assert.equal(manifest.extensions?.["io.github.bioinfornatics.agent-plugins.runtime"]?.mode, "node-bundled");
  assert.deepEqual(new Set(manifest.extensions?.["io.github.bioinfornatics.agent-plugins.runtime"]?.commands), new Set(["agent-plugin"]));
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.description.trim());
});

test("skills are self-contained and named by directory", () => {
  const found = new Set<string>();
  const skillsDir = join(ROOT, "skills");
  for (const entry of readdirSync(skillsDir).sort()) {
    const skillFile = join(skillsDir, entry, "SKILL.md");
    let text: string;
    try {
      text = readFileSync(skillFile, "utf-8");
    } catch {
      continue;
    }
    const match = /^name:\s*([^\n]+)$/m.exec(text);
    assert.ok(match, skillFile);
    const name = match![1].trim().replace(/^['"]|['"]$/g, "");
    assert.equal(name, entry);
    found.add(name);
  }
  assert.deepEqual(found, EXPECTED_SKILLS);
});

test("plugin-creator routes to qualified names with fallbacks", () => {
  const text = readFileSync(join(ROOT, "skills", "plugin-creator", "SKILL.md"), "utf-8");
  for (const name of ["skill-creator", "hook-creator", "agent-creator", "plugin-script-packaging"]) {
    assert.ok(text.includes(`${PLUGIN_NAME}:${name}`), `${name}: qualified specialist route`);
  }
  assert.match(text, /load_skill\(name: "agent-plugins:skill-creator"\)/);
  assert.match(text, /standalone installation[^\n]*load_skill\(name: "skill-creator"\)`? only if available/);
  assert.match(text, /Apply the same installed-name rule to other specialists/);
  assert.match(text, /If loading is unavailable, read available instructions directly and disclose that limitation/);
  assert.match(text, /instructions or execution capability are missing, report the affected blocker/);
  assert.match(text, /Missing specialists do not authorize guessed schemas or simulated handoffs/);
});

test("documentation prioritizes open-format adoption and a verified host integration", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf-8");
  const manifest = JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf-8"));
  assert.ok(readme.startsWith("[![Servier Powered]"), "Servier badge must be the first README element");
  assert.ok(readme.includes("**runtime-agnostic by format**"));
  assert.ok(readme.includes("Verified host integration"));
  assert.ok(readme.includes("Agentic AI Foundation"));
  for (const proof of ["## What you can do", "## Quick start"]) assert.ok(readme.includes(proof), proof);
  assert.ok(readme.includes(`Distribution | \`${manifest.version}\``), "README distribution version must match plugin.json");
  assert.ok(readme.includes("goose plugin install https://github.com/servierhub/agent-plugins.git"));
  assert.ok(!readme.split("\n").some((line) => line.includes("goose plugin install") && line.includes("bioinfornatics/agent-plugins")));
  for (const section of [
    "## Quick start",
    "## Choose your path",
    "## Choose the right creator",
    "## How-to guides",
    "## Installation and updates",
    "## Troubleshooting",
    "## Formats, portability, and security",
  ]) assert.ok(readme.includes(section), `README missing adoption section: ${section}`);
  for (const name of EXPECTED_SKILLS) assert.ok(readme.includes(`${PLUGIN_NAME}:${name}`));
  assert.ok(readme.includes("](CONTRIBUTING.md)"), "user documentation must link to contributor guidance");
  assert.ok(!readme.includes("make release"), "release build commands belong in contributor guidance");
});

test("contributor guidance is separate and production documentation has usable installation and source links", () => {
  const contributor = readFileSync(join(ROOT, "CONTRIBUTING.md"), "utf-8");
  const production = readFileSync(join(ROOT, "docs/production-README.md"), "utf-8");
  const sourceManifest = JSON.parse(readFileSync(join(ROOT, "config/reproducibility/source-manifest.json"), "utf-8"));
  assert.ok(sourceManifest.requiredFiles.includes("CONTRIBUTING.md"));
  for (const concept of ["feature/my-change", "develop", "production projection", "sole parent", "Never merge", "runtime/", "prepare-development.mjs", "test:production-ci"]) {
    assert.ok(contributor.includes(concept), `contributor guide missing lifecycle concept: ${concept}`);
  }
  assert.ok(production.includes("goose plugin install https://github.com/bioinfornatics/agent-plugins.git"));
  assert.ok(production.includes("https://github.com/bioinfornatics/agent-plugins/blob/develop/CONTRIBUTING.md"));
  for (const required of ["0.6.0 candidate", "not published", "22.22.2", "agent-plugin", "Skills"]) assert.ok(production.includes(required), required);
  assert.ok(!production.includes("](CONTRIBUTING.md)") && !production.includes("](RELEASES.md)"), "production must not link to excluded root development files");
  for (const section of ["## Distribution contract", "## Installation channel", "## Author a Skill", "## Compare and inspect", "## Learn more"]) assert.ok(production.includes(section), section);
});

test("Skill instructions expose the current evaluation contract and disclose retired commands", () => {
  const entrypoint = join(SKILLS, "skill-creator", "SKILL.md");
  const text = readFileSync(entrypoint, "utf8");
  const creation = activeLinkedReference(entrypoint, "references/create-workflow.md");
  const evaluation = activeLinkedReference(entrypoint, "references/evaluate-workflow.md");
  const retained = activeLinkedReference(entrypoint, "references/retained-campaigns.md");
  const review = activeLinkedReference(entrypoint, "references/review-viewer.md");
  // Detect missing installed-runtime/isolation guarantees in the common boundary,
  // and missing commands in the particular workflow that owns their execution.
  for (const required of ["agent-plugin", ">=22.22.2", "evaluation --skills", "--plugin", "--dry-run", "private HOME/XDG", "not an OS", "read-only"]) assert.ok(text.includes(required), required);
  assert.match(text, /retired creator CLI/);
  assert.match(creation, /standalone\s+`validate`/);
  assert.match(creation, /skill-creator\.mjs validate \/canonical\/path\/to\/candidate/);
  for (const required of ["history --json", "inspect <campaign-id>", "--resume"]) assert.ok(retained.includes(required), required);
  for (const required of ["grading <campaign-id>", "export <campaign-id>"]) assert.ok(evaluation.includes(required), required);
  assert.ok(review.includes("scripts/generate-report.mjs"));
});

test("Plugin instructions route supported sources without retired full-eval or report promises", () => {
  const text = readFileSync(join(SKILLS, "plugin-creator", "SKILL.md"), "utf8");
  for (const required of ["creator CLIs are retired", "agent-plugin evaluation", "agent-plugin history", "agent-plugin inspect", "History and inspect are read-only", "choose supported Skill and/or Plugin source paths", "Standalone agents and hooks are not evaluation sources", "not a separate hook/agent benchmark, release approval or host-compatibility proof", "Do not run a model campaign merely to finish authoring", "no full-eval orchestration or calibrated-quality promise"]) assert.ok(text.includes(required), required);
});

test("current app owns sources and only skill-creator is mapped as executable", () => {
  assert.ok(existsSync(join(APPS, "agent-plugin", "src/index.ts")));
  assert.deepEqual(readdirSync(APPS).filter(entry => entry.endsWith("-creator-cli")), []);
  const pkg = JSON.parse(readFileSync(join(APPS, "agent-plugin/package.json"), "utf8"));
  assert.equal(pkg.engines.node, ">=22.22.2");
  assert.ok(pkg.scripts.build); assert.ok(pkg.scripts["package:runtime"]);
  for (const name of EXPECTED_SKILLS) {
    const skill = join(SKILLS, name);
    for (const artifact of ["package.json", "package-lock.json", "tsconfig.json", "tests", "dist", "vendor"]) assert.equal(existsSync(join(skill, artifact)), false, `${name}: ${artifact}`);
    if (name === "skill-creator") {
      const manifest = JSON.parse(readFileSync(join(skill, "runtime/runtime-manifest.json"), "utf8"));
      assert.equal(manifest.app, "apps/agent-plugin"); assert.equal(manifest.runtimeEntry, "dist/index.js");
      assert.deepEqual(manifest.relatedCommands, {});
      assert.deepEqual(readdirSync(join(skill, "scripts")).filter(entry => entry !== "AGENTS.md").sort(), ["generate-report.mjs", "skill-creator.mjs"]);
      assert.ok(existsSync(join(skill, "assets/report-viewer.html")));
    } else {
      // Retired creators are instruction-only in source and distribution.
      assert.equal(existsSync(join(skill, "runtime")), false);
      assert.equal(existsSync(join(skill, "scripts")), false);
      const text = readFileSync(join(skill, "SKILL.md"), "utf8");
      if (name !== "plugin-script-packaging") assert.match(text, /retired/);

    }
  }
});

test("production closure binds only locked production dependencies, not development tooling", () => {
  const app = join(APPS, "agent-plugin");
  const pkg = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(app, "package-lock.json"), "utf8"));
  const runtime = join(SKILLS, "skill-creator/runtime");
  const manifest = JSON.parse(readFileSync(join(runtime, "runtime-manifest.json"), "utf8"));
  assert.deepEqual(manifest.productionDependencies.map((dep: any) => dep.name).sort(), Object.keys(pkg.dependencies).sort());
  for (const dep of manifest.productionDependencies) {
    assert.equal(dep.version, lock.packages[`node_modules/${dep.name}`].version);
    assert.equal(dep.integrity, lock.packages[`node_modules/${dep.name}`].integrity);
    assert.ok(existsSync(join(runtime, "node_modules", dep.name, "package.json")));
  }
  for (const dep of Object.keys(pkg.devDependencies)) assert.equal(existsSync(join(runtime, "node_modules", dep)), false, dep);
  assert.ok(existsSync(join(runtime, "THIRD_PARTY_NOTICES.md")));
});

// This gate checks file existence, not heading IDs: Markdown fragments are not filenames.
function linkedReferenceFileExists(skillRoot: string, link: string): boolean {
  return existsSync(join(skillRoot, link.split("#", 1)[0]));
}

test("reference file checks accept fragments without hiding missing files", () => {
  const temp = mkdtempSync(join(tmpdir(), "reference-link-"));
  try {
    writeFileSync(join(temp, "guide.md"), "## Section\n");
    assert.equal(linkedReferenceFileExists(temp, "guide.md"), true);
    assert.equal(linkedReferenceFileExists(temp, "guide.md#section"), true);
    assert.equal(linkedReferenceFileExists(temp, "missing.md"), false);
    assert.equal(linkedReferenceFileExists(temp, "missing.md#section"), false);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("skill metadata and progressive disclosure follow repository policy", () => {
  for (const entry of readdirSync(SKILLS)) {
    const skillFile = join(SKILLS, entry, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    const text = readFileSync(skillFile, "utf8");
    const description = text.match(/^description:\s*["']?(.*?)["']?$/m)?.[1] ?? "";
    assert.ok(description.length > 0 && description.length <= 350, `${entry}: description must be concise`);
    assert.ok(!/[^\x00-\x7F]/.test(description), `${entry}: description must be English/ASCII metadata`);
    assert.match(description, /\b(?:Use (?:when|for)|Activates (?:when|for))\b/, `${entry}: description must state when to activate`);
    assert.ok(text.split(/\r?\n/).length <= 500, `${entry}: SKILL.md must use progressive disclosure above 500 lines`);
  }
  const creator = readFileSync(join(SKILLS, "skill-creator", "SKILL.md"), "utf8");
  const authoring = readFileSync(join(SKILLS, "skill-creator", "references", "authoring.md"), "utf8");
  for (const question of ["What does the Skill do?", "When should the agent activate it?", "What instructions must the Skill give?", "In what order must they run?", "Are all instructions mandatory?", "Which instructions are conditional?"]) assert.ok(authoring.includes(question), question);
  for (const link of [...creator.matchAll(/\[[^\]]*\]\((references\/[^)]+)\)/g)].map(m => m[1])) assert.ok(linkedReferenceFileExists(join(SKILLS, "skill-creator"), link), link);
  assert.ok(authoring.includes("ceiling, not a target"));
  assert.ok(authoring.includes("loaded but unused"));
});

test("authoring instructions do not authorize campaigns or other operator side effects", () => {
  for (const name of EXPECTED_SKILLS) {
    const text = readFileSync(join(SKILLS, name, "SKILL.md"), "utf8");
    // Detect any omitted permission boundary, without requiring one exact sentence
    // or borrowing a prohibition from an unrelated/inactive reference.
    const policy = text.replace(/\s+/g, " ").match(/Authoring(?: or scenario design)? (?:does not (?:authorize|permit)|is not permission to)[^.]+\./)?.[0];
    assert.ok(policy, `${name}: authoring must explicitly deny side-effect authority`);
    for (const action of [/\binstall(?:ation| capabilities)\b/, /\bcredentials?\b/, /\bpublish(?:ing)?\b|\bpublication\b/, /\b(?:models?|(?:paid |model )?campaigns)\b/]) {
      assert.match(policy, action, `${name}: omitted authoring permission boundary ${action}`);
    }
    if (name === "skill-creator") {
      const evaluation = activeLinkedReference(join(SKILLS, name, "SKILL.md"), "references/evaluate-workflow.md");
      assert.match(evaluation, /explicit[^.]*execution authority/);
    }
  }
});

test("skill-creator applies the complete authoring pattern catalog at creation and improvement", () => {
  const entrypoint = join(SKILLS, "skill-creator", "SKILL.md");
  const creation = activeLinkedReference(entrypoint, "references/create-workflow.md");
  const improvement = activeLinkedReference(entrypoint, "references/improvement.md");
  const creationPath = join(SKILLS, "skill-creator", "references/create-workflow.md");
  const improvementPath = join(SKILLS, "skill-creator", "references/improvement.md");
  const authoring = activeLinkedReference(creationPath, "authoring.md");
  activeLinkedReference(improvementPath, "authoring.md");
  const catalog = activeLinkedReference(creationPath, "skill-authoring-best-practices.md");
  activeLinkedReference(improvementPath, "skill-authoring-best-practices.md");
  // Detect catalog links disconnected from pre-drafting and evidence-led revision,
  // or loss of selective application; merely retaining the catalog is insufficient.
  assert.match(creation, /Before drafting[^.]*\[authoring\]\(authoring\.md\)[^.]*\[patterns\]\(skill-authoring-best-practices\.md\)/);
  assert.match(improvement, /(?:Classify|Diagnose|Analyze)[^.]*failure[^.]*before[^.]*instructions[^]*?\[patterns\]\(skill-authoring-best-practices\.md\)/);
  assert.match(improvement, /(?:outputs|observed results)[^.]*user feedback[^.]*evidence/);
  assert.match(authoring, /(?:each|every)[^.]*pattern[^.]*applies[^.]*why[^.]*where/i);
  assert.match(authoring, /(?:smallest|select|choose)[^.]*useful[^.]*rather than[^.]*every pattern/i);
  assert.match(catalog, /Creation[\s\S]*before drafting[\s\S]*Improvement[\s\S]*after evaluation or observed usage/);
  for (const pattern of [
    "Concise is key",
    "Appropriate degree of freedom",
    "Test with all intended models",
    "Effective description",
    "High-level guide with references",
    "Domain-specific organization",
    "Conditional details",
    "Sequential workflow",
    "Feedback loop",
    "Plan-validate-execute",
    "Avoid time-sensitive information",
    "Consistent terminology",
    "Template pattern",
    "Examples pattern",
    "Conditional workflow",
    "Evaluation-driven development",
    "Expert-author / fresh-user loop",
    "Observe navigation behavior",
    "Solve, do not defer",
    "Utility scripts",
    "Visual analysis",
    "Verifiable intermediate outputs",
    "Package dependencies",
    "Fully qualified MCP tools",
    "Do not assume tools are installed",
    "Avoid too many options",
  ]) assert.ok(catalog.includes(pattern), `missing upstream authoring pattern: ${pattern}`);
  assert.match(catalog, /Is it relevant here\? Why\? Where should it be applied\?/);
});

// Detects omission of the independent helper/template or allowance of arbitrary scripts.
test("production delivers the exact report helper closure and rejects extra scripts", () => {
  const base = mkdtempSync(join(tmpdir(), "report-production-"));
  try {
    const destination = join(base, "candidate"), manifest = projectProduction(destination);
    const skill = join(destination, "skills/skill-creator");
    assert.deepEqual(readdirSync(join(skill, "scripts")).sort(), ["generate-report.mjs", "skill-creator.mjs"]);
    for (const resource of ["scripts/generate-report.mjs", "assets/report-viewer.html"]) {
      assert.deepEqual(readFileSync(join(skill, resource)), readFileSync(join(SKILLS, "skill-creator", resource)));
      assert.ok(manifest.files.some((file: any) => file.path === `skills/skill-creator/${resource}`));
    }
    writeFileSync(join(skill, "scripts/arbitrary.mjs"), "not approved");
    assert.throws(() => verifyProduction(destination), /inventory mismatch/);
    // Even a coherently sealed inventory must not authorize a third script.
    const bytes = Buffer.from("not approved");
    manifest.files.splice(manifest.files.findIndex((file: any) => file.path === "skills/skill-creator/scripts/generate-report.mjs"), 0, {path:"skills/skill-creator/scripts/arbitrary.mjs", mode:644, size:bytes.length,
      sha256:createHash("sha256").update(bytes).digest("hex")});
    manifest.inventorySha256 = createHash("sha256").update(JSON.stringify(manifest.files)).digest("hex");
    writeFileSync(join(destination, "distribution-manifest.json"), JSON.stringify(manifest));
    assert.throws(() => verifyProduction(destination), /wrong source launcher closure/);
  } finally { rmSync(base, {recursive:true, force:true}); }
});
