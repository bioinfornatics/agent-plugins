#!/usr/bin/env node
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseSkillMd } from "./utils.js";
import { validateSkill } from "./quick_validate.js";

export type AuditSeverity = "error" | "warning" | "info";
export interface AuditFinding { severity: AuditSeverity; rule: string; message: string; path?: string; }
export interface PatternDecision { pattern: string; relevant: boolean; reason: string; apply_to: string; }
export interface SkillAudit {
  schema_version: "1.0";
  artifact: "skill-authoring-audit";
  status: "pass" | "warning" | "fail";
  skill: string;
  line_count: number;
  description: { characters: number; words: number };
  findings: AuditFinding[];
  pattern_review: PatternDecision[];
  summary: { errors: number; warnings: number; info: number };
}

function directory(path: string): boolean { try { return statSync(path).isDirectory(); } catch { return false; } }
function finding(findings: AuditFinding[], severity: AuditSeverity, rule: string, message: string, path?: string): void { findings.push({ severity, rule, message, ...(path ? { path } : {}) }); }
function bodyAfterFrontmatter(content: string): string { return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ""); }
function localMarkdownLinks(content: string): string[] { return [...content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1].trim().split("#")[0]).filter(Boolean).filter(p => !/^(?:https?:|mailto:|#)/i.test(p)); }
function wordCount(value: string): number { return value.trim().split(/\s+/).filter(Boolean).length; }
function hasNonEnglishSignals(value: string): boolean {
  return /\b(?:utilisez|utiliser|quand|fichiers?|competence|habilidad|cuando|archivos?|verwenden|wenn|dateien?)\b/i.test(value);
}

export function auditSkill(skillArg: string): SkillAudit {
  const skill = resolve(skillArg), findings: AuditFinding[] = [], skillMd = join(skill, "SKILL.md");
  const [valid, validationMessage] = validateSkill(skill);
  if (!valid) finding(findings, "error", "conformance", validationMessage, "SKILL.md");
  let content = "", description = "";
  try { const parsed = parseSkillMd(skill); content = parsed.content; description = parsed.description; }
  catch (error) { finding(findings, "error", "parse", (error as Error).message, "SKILL.md"); }
  const lines = content ? content.split(/\r?\n/) : [];
  const body = bodyAfterFrontmatter(content);

  if (description) {
    if (/[^\x00-\x7F]/.test(description) || hasNonEnglishSignals(description)) finding(findings, "error", "metadata-language", "Description must use English-only portable metadata; non-English text was detected.", "SKILL.md");
    if (description.length > 350) finding(findings, "warning", "description-concision", `Description has ${description.length} characters; prefer one or two concise discovery sentences.`, "SKILL.md");
    if (!/\bUse (?:when|for)\b/.test(description)) finding(findings, "warning", "description-activation", "Description should state when the Skill activates, typically with a concise 'Use when' or 'Use for' clause.", "SKILL.md");
    if (/^(?:I|You|We|Use\b)/i.test(description)) finding(findings, "error", "description-person", "Description must begin with a third-person statement of capability, not first/second person or an imperative.", "SKILL.md");
  }
  if (hasNonEnglishSignals(body)) finding(findings, "error", "instruction-language", "SKILL.md instructions must be written in English; non-English instructional text was detected.", "SKILL.md");
  if (lines.length > 500) finding(findings, "error", "entrypoint-line-budget", `SKILL.md has ${lines.length} lines; keep it at or below 500 and move conditional or deep detail into directly linked references.`, "SKILL.md");
  else if (lines.length > 450) finding(findings, "warning", "entrypoint-line-budget", `SKILL.md has ${lines.length} lines and is approaching the 500-line limit.`, "SKILL.md");
  if (/[A-Za-z0-9_.-]\\[A-Za-z0-9_.-]/.test(body)) finding(findings, "error", "portable-paths", "Use forward slashes in Skill paths; Windows-style backslash paths are not portable.", "SKILL.md");

  const links = localMarkdownLinks(content);
  for (const target of links) {
    if (isAbsolute(target) || target.startsWith("../")) finding(findings, "error", "self-contained-reference", `Reference must stay inside the Skill directory: ${target}`, target);
    else if (!existsSync(join(skill, target))) finding(findings, "error", "missing-reference", `Linked resource does not exist: ${target}`, target);
    else if (target.endsWith(".md")) {
      const reference = readFileSync(join(skill, target), "utf8"), referenceLines = reference.split(/\r?\n/).length;
      if (hasNonEnglishSignals(reference)) finding(findings, "error", "instruction-language", `Linked Skill instructions must be written in English: ${target}`, target);
      if (referenceLines > 300 && !/^## Contents$/m.test(reference)) finding(findings, "warning", "reference-table-of-contents", `${target} has ${referenceLines} lines and should include a Contents section.`, target);
      for (const nested of localMarkdownLinks(reference)) if (nested.endsWith(".md")) finding(findings, "warning", "deep-reference-chain", `${target} links to ${nested}; prefer linking required references directly from SKILL.md.`, target);
    }
  }

  const conditional = /\b(if|when|unless|depending on|otherwise)\b/i.test(body);
  const workflows = /\b(workflow|step 1|first,|then|before|after)\b/i.test(body);
  const validation = /\b(validate|verify|check|test)\b/i.test(body);
  const scripts = /(?:scripts\/|```(?:bash|sh|python|javascript|typescript))/i.test(body);
  const visual = /\b(image|visual|render|layout|screenshot|pdf|docx)\b/i.test(body);
  const template = /\b(template|output format|report structure)\b/i.test(body);
  const examples = /\bexample\b/i.test(body);
  const destructive = /\b(delete|remove|migrate|deploy|publish|release|overwrite|batch)\b/i.test(body);
  const dependencies = /\b(dependenc|package|install|CLI|MCP|tool)\b/i.test(body);
  const ruleRich = /\b(specification|protocol|compatibility|compliance|policy|schema|version|format|rule matrix|coverage matrix|deterministic rules?)\b/i.test(body);
  const domains = links.filter(p => p.startsWith("references/")).length > 1;
  const pattern_review: PatternDecision[] = [
    { pattern: "appropriate-degree-of-freedom", relevant: true, reason: "Every Skill must match instruction precision to task variability and risk.", apply_to: "instruction wording and scripts" },
    { pattern: "rule-rich-domain-coverage", relevant: ruleRich, reason: ruleRich ? "The Skill appears to depend on specifications, schemas, compatibility, policy, or deterministic rule categories." : "No substantial deterministic rule-space signal detected.", apply_to: "rule matrix, scripts, references, and coverage-tagged evals" },
    { pattern: "progressive-disclosure", relevant: lines.length > 300 || links.length > 0 || conditional, reason: lines.length > 300 ? "The entrypoint is substantial." : links.length ? "The Skill already uses bundled resources." : conditional ? "Conditional branches may need on-demand detail." : "The entrypoint is compact and has no substantial branches.", apply_to: "SKILL.md and references/" },
    { pattern: "domain-specific-organization", relevant: domains, reason: domains ? "Multiple references suggest separable domains or variants." : "No evidence of multiple substantial domains.", apply_to: "references/" },
    { pattern: "sequential-workflow", relevant: workflows, reason: workflows ? "Ordered task language is present." : "No substantial ordered workflow detected.", apply_to: "SKILL.md common path" },
    { pattern: "conditional-workflow", relevant: conditional, reason: conditional ? "Conditional task language is present." : "No conditional branch detected.", apply_to: "SKILL.md decision points and branch references" },
    { pattern: "feedback-loop", relevant: validation, reason: validation ? "Validation or verification is part of the task." : "No checkable quality loop detected.", apply_to: "verification steps" },
    { pattern: "template-pattern", relevant: template, reason: template ? "The Skill specifies an output shape." : "No output-shape requirement detected.", apply_to: "assets/ or output section" },
    { pattern: "examples-pattern", relevant: examples, reason: examples ? "Examples are already used or requested." : "No example-dependent behavior detected.", apply_to: "concise body examples or references/" },
    { pattern: "utility-scripts", relevant: scripts, reason: scripts ? "Executable or deterministic operations are present." : "No repeated deterministic operation detected.", apply_to: "scripts/" },
    { pattern: "visual-analysis", relevant: visual, reason: visual ? "Rendered or spatial artifacts may require inspection." : "No visual artifact signal detected.", apply_to: "render-and-inspect workflow" },
    { pattern: "plan-validate-execute", relevant: destructive, reason: destructive ? "Potentially destructive, batch, or release operations are present." : "No high-risk mutation signal detected.", apply_to: "workflow and intermediate artifacts" },
    { pattern: "dependency-and-mcp-guidance", relevant: dependencies, reason: dependencies ? "External tools or packages are mentioned." : "No external runtime requirement detected.", apply_to: "compatibility metadata and prerequisites" },
  ];
  const summary = { errors: findings.filter(f => f.severity === "error").length, warnings: findings.filter(f => f.severity === "warning").length, info: findings.filter(f => f.severity === "info").length };
  return { schema_version: "1.0", artifact: "skill-authoring-audit", status: summary.errors ? "fail" : summary.warnings ? "warning" : "pass", skill, line_count: lines.length, description: { characters: description.length, words: wordCount(description) }, findings, pattern_review, summary };
}

export function main(): void {
  try {
    const { positionals, values } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: { output: { type: "string", short: "o" } } });
    if (!positionals[0] || !directory(resolve(positionals[0]))) throw new TypeError("usage: audit_skill.js <skill-directory> [-o audit.json]");
    const result = auditSkill(positionals[0]), json = JSON.stringify(result, null, 2) + "\n";
    if (values.output) { mkdirSync(dirname(resolve(values.output)), { recursive: true }); writeFileSync(resolve(values.output), json); }
    console.log(json.trim());
    process.exit(result.status === "fail" ? 1 : 0);
  } catch (error) { console.error(`audit_skill: ${(error as Error).message}`); process.exit(2); }
}
const invoked = process.argv[1] ? resolve(process.argv[1]) : null;
if (!import.meta.url.includes("/$bunfs/") && invoked && fileURLToPath(import.meta.url) === invoked) main();
