import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_NAME = "agent-plugins";
const SKILLS = join(ROOT, "skills");
const APPS = join(ROOT, "apps");
const EXPECTED_SKILLS = new Set(["skill-creator", "agent-creator", "hook-creator", "plugin-creator", "plugin-script-packaging"]);
const EXECUTABLE_CREATORS = new Set(["skill-creator", "agent-creator", "hook-creator", "plugin-creator"]);

test("open plugins manifest", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf-8"));
  assert.equal(manifest.name, PLUGIN_NAME);
  assert.equal(manifest.extensions?.["io.github.bioinfornatics.agent-plugins.runtime"]?.mode, "node-bundled");
  assert.deepEqual(new Set(manifest.extensions?.["io.github.bioinfornatics.agent-plugins.runtime"]?.commands), EXECUTABLE_CREATORS);
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
  for (const name of ["skill-creator", "hook-creator", "agent-creator"]) {
    assert.ok(text.includes(`${PLUGIN_NAME}:${name}`));
    assert.ok(text.includes(`\`${name}\``));
  }
});

test("documentation prioritizes open-format adoption and a verified host integration", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf-8");
  const manifest = JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf-8"));
  assert.ok(readme.startsWith("[![Servier Powered]"), "Servier badge must be the first README element");
  assert.ok(readme.includes("**runtime-agnostic by format**"));
  assert.ok(readme.includes("Verified host integration"));
  assert.ok(readme.includes("Agentic AI Foundation"));
  for (const proof of ["## What you can do", "## See it in action", "paired A/B runs", "with_skill", "old_skill", "without_skill", "benchmark.json", "benchmark.md", "review.html"]) {
    assert.ok(readme.includes(proof), `README missing demonstrated value: ${proof}`);
  }
  assert.ok(readme.indexOf("## What you can do") < readme.indexOf("## Quick start"), "value must precede installation");
  assert.ok(readme.indexOf("## See it in action") < readme.indexOf("## Quick start"), "examples must precede installation");
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
  assert.ok(production.includes("https://github.com/bioinfornatics/agent-plugins/blob/develop/RELEASES.md"));
  assert.ok(!production.includes("](CONTRIBUTING.md)") && !production.includes("](RELEASES.md)"), "production must not link to excluded root development files");
  assert.ok(production.includes("## Quick start") && production.includes("## Troubleshooting"));
});

test("explicit skill evaluation requests use the progressively disclosed completion contract", () => {
  const entrypoint = readFileSync(join(ROOT, "skills", "skill-creator", "SKILL.md"), "utf-8");
  const workflow = readFileSync(join(ROOT, "skills", "skill-creator", "references", "evaluation-workflow.md"), "utf-8");
  const evaluationStep = entrypoint.split("4. **")[1]?.split("5. **")[0] ?? "";
  assert.ok(evaluationStep.includes("Before behavioral evaluation/comparison"));
  assert.ok(evaluationStep.includes("references/evaluation-workflow.md"));
  assert.ok(evaluationStep.includes("execute rather than merely plan, within capabilities and permission"));
  for (const required of [
    "Completion contract",
    "paired `with_skill`",
    "grading.json",
    "aggregate_benchmark.js",
    "eval-viewer/generate_review.js",
    "blocked",
    "does not replace behavioral evaluation",
  ]) assert.ok(workflow.includes(required), required);
});

test("explicit plugin evaluation requests require behavioral skill and integration evidence", () => {
  const text = readFileSync(join(ROOT, "skills", "plugin-creator", "SKILL.md"), "utf-8");
  for (const required of [
    "Behavioral Evaluation Contract",
    "complete evaluation receipt",
    "plugin-level integration scenarios",
    "combined benchmark",
    "review viewer",
    "evaluation: blocked",
  ]) assert.ok(text.includes(required), required);
});

test("creator implementation and build ownership is exclusively under apps", () => {
  assert.deepEqual(new Set(readdirSync(APPS).filter((entry) => entry.endsWith("-creator-cli"))), new Set([...EXECUTABLE_CREATORS].map((name) => `${name}-cli`)));
  for (const name of EXECUTABLE_CREATORS) {
    const skill = join(SKILLS, name);
    const app = join(APPS, `${name}-cli`);
    for (const required of ["package.json", "package-lock.json", "tsconfig.json", "scripts", "tests", "dist", "vendor"]) {
      assert.ok(existsSync(join(app, required)), `${name}: app must own ${required}`);
    }
    for (const relative of ["package.json", "package-lock.json", "tsconfig.json", "tests", "dist", "vendor"]) {
      assert.equal(existsSync(join(skill, relative)), false, `${name}: source Skill contains app artifact ${relative}`);
    }
    assert.ok(existsSync(join(skill, "runtime", "runtime-manifest.json")), `${name}: generated runtime`);
    const pending = readdirSync(skill, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "runtime")
      .map((entry) => join(skill, entry.name));
    while (pending.length) {
      const directory = pending.pop()!;
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = join(directory, entry.name);
        if (entry.isDirectory()) pending.push(absolute);
        else if (/\.tsx?$/.test(entry.name) || entry.name === "build.mjs") {
          assert.fail(`${name}: source Skill contains creator implementation artifact ${absolute.slice(skill.length + 1)}`);
        }
      }
    }
  }
});

test("every creator application ships a complete offline runtime bundle", () => {
  for (const name of EXECUTABLE_CREATORS) {
    const app = join(APPS, `${name}-cli`);
    const pkg = JSON.parse(readFileSync(join(app, "package.json"), "utf-8"));
    assert.equal(pkg.offlineBundle, true, `${name}: offlineBundle`);
    assert.ok(existsSync(join(app, "dist")), `${name}: dist`);
    assert.ok(existsSync(join(app, "vendor", "manifest.json")), `${name}: vendor manifest`);
    assert.ok(existsSync(join(SKILLS, name, "THIRD_PARTY_NOTICES.md")), `${name}: notices`);
    for (const dependency of Object.keys(pkg.dependencies ?? {})) {
      assert.ok(existsSync(join(app, "vendor", "node_modules", dependency, "package.json")), `${name}: ${dependency}`);
    }
  }
});

test("all creator evaluation sets are autonomous and fixture-backed", () => {
  const designCli = join(APPS, "skill-creator-cli", "dist", "scripts", "cli.js");
  for (const name of EXPECTED_SKILLS) {
    const skillRoot = join(SKILLS, name);
    const evalSet = join(skillRoot, "evals", "evals.json");
    assert.ok(existsSync(evalSet), `${name}: missing durable eval set`);
    const result = spawnSync(process.execPath, [designCli, "design-evals", evalSet, "--skill-path", skillRoot, "--format", "json"], { encoding: "utf8" });
    assert.equal(result.status, 0, `${name}: ${result.stderr || result.stdout}`);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.output.status, "pass", `${name}: ${JSON.stringify(envelope.output.findings)}`);
    assert.equal(envelope.output.summary.warnings, 0, name);
    const document = JSON.parse(readFileSync(evalSet, "utf8"));
    for (const scenario of document.evals) {
      assert.ok(scenario.subject, `${name}/${scenario.id}: subject`);
      assert.ok(scenario.language, `${name}/${scenario.id}: language`);
      assert.ok(scenario.target?.kind, `${name}/${scenario.id}: target.kind`);
      assert.match(scenario.target.execution, /^(explain|dry-run|execute|resume)$/, `${name}/${scenario.id}: execution`);
      assert.ok(scenario.preconditions?.length, `${name}/${scenario.id}: preconditions`);
      assert.ok(scenario.coverage_tags?.includes(`language:${scenario.language}`), `${name}/${scenario.id}: language coverage`);
    }
  }
});

test("root offline smoke uses app authoring code and staged release executables", () => {
  for (const relative of ["scripts/test-offline-bundle.mjs", "scripts/package-offline.mjs"]) {
    const source = readFileSync(join(ROOT, relative), "utf8");
    assert.doesNotMatch(source, /skills[\"', ]+[^\"', ]+[\"', ]+(?:dist|vendor)/, relative + ": obsolete Skill implementation path");
  }
  const packager = readFileSync(join(ROOT, "scripts", "package-offline.mjs"), "utf8");
  const smoke = readFileSync(join(ROOT, "scripts", "test-offline-bundle.mjs"), "utf8");
  assert.match(packager, /build-bun-executables\.mjs/);
  assert.match(packager, /release-manifest\.json/);
  assert.match(packager, /plugin-creator[\"'],[\"']scripts[\"']/);
  assert.match(smoke, /release-manifest\.json/);
  assert.match(smoke, /PATH:[\"'][\"']/);
  assert.doesNotMatch(packager, /join\(root,[\"']apps[\"']/);
  assert.doesNotMatch(smoke, /path\.join\(root,[\"']apps[\"']/);
});

test("application offline vendors contain production dependencies only", () => {
  for (const name of EXECUTABLE_CREATORS) {
    const app = join(APPS, `${name}-cli`);
    const pkg = JSON.parse(readFileSync(join(app, "package.json"), "utf-8"));
    const manifest = JSON.parse(readFileSync(join(app, "vendor", "manifest.json"), "utf-8"));
    const bundled = new Set(manifest.packages.map((item: { name: string }) => item.name));
    for (const dependency of Object.keys(pkg.dependencies ?? {})) assert.ok(bundled.has(dependency));
    for (const devDependency of Object.keys(pkg.devDependencies ?? {})) assert.ok(!bundled.has(devDependency), `${name}: bundled dev dependency ${devDependency}`);
  }
});

test("skill metadata and progressive disclosure follow repository policy", () => {
  for (const entry of readdirSync(SKILLS)) {
    const skillFile = join(SKILLS, entry, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    const text = readFileSync(skillFile, "utf8");
    const description = text.match(/^description:\s*["']?(.*?)["']?$/m)?.[1] ?? "";
    assert.ok(description.length > 0 && description.length <= 350, `${entry}: description must be concise`);
    assert.ok(!/[^\x00-\x7F]/.test(description), `${entry}: description must be English/ASCII metadata`);
    assert.match(description, /\bUse (?:when|for)\b/, `${entry}: description must state when to activate`);
    assert.ok(text.split(/\r?\n/).length <= 500, `${entry}: SKILL.md must use progressive disclosure above 500 lines`);
  }
  const creator = readFileSync(join(SKILLS, "skill-creator", "SKILL.md"), "utf8");
  const authoring = readFileSync(join(SKILLS, "skill-creator", "references", "authoring.md"), "utf8");
  assert.ok(creator.includes("references/authoring.md"));
  for (const question of ["What does the Skill do?", "When should the agent activate it?", "What instructions must the Skill give?", "In what order must they run?", "Are all instructions mandatory?", "Which instructions are conditional?"]) {
    assert.ok(authoring.includes(question), question);
  }
  assert.ok(authoring.includes("500 lines?"));
  for (const required of ["metadata for selection", "common workflow", "bundled resources", "references/"]) assert.ok(authoring.includes(required), required);
  assert.ok(!creator.includes("## Intent routing"));
  assert.ok(!creator.includes("## Ordered delivery checklist"));
  const steps = creator.split("## Ordered workflow")[1]?.split("## Command lookup")[0] ?? "";
  assert.deepEqual([...steps.matchAll(/^(\d+)\. \*\*/gm)].map(m => Number(m[1])), [1, 2, 3, 4, 5, 6, 7]);
  const links = [...steps.matchAll(/\[[^\]]*\]\((references\/[^)]+)\)/g)].map(m => m[1]);
  assert.equal(new Set(links).size, links.length);
  const finalStep = steps.split("7. **")[1] ?? "";
  for (const required of ["After investigation and verification", "immediately before writing", "blocked or no-change"]) assert.ok(finalStep.includes(required), required);
});

test("skill-creator applies the complete authoring pattern catalog at creation and improvement", () => {
  const creator = readFileSync(join(SKILLS, "skill-creator", "SKILL.md"), "utf8");
  const catalog = readFileSync(join(SKILLS, "skill-creator", "references", "skill-authoring-best-practices.md"), "utf8");
  const authoringStep = creator.split("3. **")[1]?.split("4. **")[0] ?? "";
  for (const required of ["Before creation or structural improvement", "references/skill-authoring-best-practices.md", "Decide relevance, reason and application site", "Before revising from real usage or evaluation findings", "references/improvement.md"]) assert.ok(authoringStep.includes(required), required);
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
