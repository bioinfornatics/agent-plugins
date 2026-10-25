import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { sourceHash } from "./package_manifest.js";

export type EvidenceStatus = "pass" | "fail" | "blocked" | "na";
export type ComponentKind = "skill" | "agent" | "hook" | "mcp";
export type ReceiptKind = ComponentKind | "integration";

export interface EvidenceApplicability {
  status: "applicable" | "na";
  reason?: string;
}
export interface EvidenceCheck {
  id: string;
  status: EvidenceStatus;
  evidence: string[];
  reason?: string;
}
export interface CommonEvidenceEnvelope<K extends ReceiptKind, P> {
  schema_version: "1.0";
  artifact: K;
  name: string;
  status: EvidenceStatus;
  source_sha256: string;
  generated_at?: string;
  applicability: EvidenceApplicability;
  checks: EvidenceCheck[];
  payload: P;
}
export interface SkillEvidencePayload { evaluated_behaviors: string[]; }
export interface AgentEvidencePayload { evaluated_tasks: string[]; }
export interface HookEvidencePayload { events: string[]; safety_cases: string[]; }
export interface McpEvidencePayload { servers: string[]; capabilities: string[]; }
export interface IntegrationHandoff { from: string; to: string; scenario: string; evidence: string[]; }
export interface IntegrationScenario { id: string; covered_components: string[]; handoffs: Array<{ from: string; to: string }>; }
export interface IntegrationEvidencePayload {
  covered_components: string[];
  scenarios: IntegrationScenario[];
  handoffs: IntegrationHandoff[];
}
export type SkillEvidenceReceipt = CommonEvidenceEnvelope<"skill", SkillEvidencePayload>;
export type AgentEvidenceReceipt = CommonEvidenceEnvelope<"agent", AgentEvidencePayload>;
export type HookEvidenceReceipt = CommonEvidenceEnvelope<"hook", HookEvidencePayload>;
export type McpEvidenceReceipt = CommonEvidenceEnvelope<"mcp", McpEvidencePayload>;
export type IntegrationEvidenceReceipt = CommonEvidenceEnvelope<"integration", IntegrationEvidencePayload>;
export type TypedEvidenceReceipt = SkillEvidenceReceipt | AgentEvidenceReceipt | HookEvidenceReceipt | McpEvidenceReceipt | IntegrationEvidenceReceipt;

export interface PluginComponent {
  kind: ComponentKind;
  id: string;
  key: string;
  path: string;
  source_sha256: string;
}
export interface ReceiptAssessment {
  typed: boolean;
  status: EvidenceStatus;
  problems: string[];
}

const HASH_EXCLUDED = new Set([".git", ".hg", ".svn", ".beads", ".verification", "__pycache__"]);
const SHA256 = /^[a-f0-9]{64}$/;
const STATUS = new Set<EvidenceStatus>(["pass", "fail", "blocked", "na"]);
const KINDS = new Set<ReceiptKind>(["skill", "agent", "hook", "mcp", "integration"]);
function isDirectory(path: string): boolean { try { return statSync(path).isDirectory(); } catch { return false; } }
function isFile(path: string): boolean { try { return statSync(path).isFile(); } catch { return false; } }
function walk(root: string, current: string, out: string[]): void {
  for (const name of readdirSync(current).sort()) {
    const relativePath = relative(root, join(current, name)).replaceAll("\\", "/");
    if (HASH_EXCLUDED.has(name) || relativePath === "evaluations" || (name === "node_modules" && basename(current) !== "vendor")) continue;
    const path = join(current, name);
    isDirectory(path) ? walk(root, path, out) : isFile(path) && out.push(path);
  }
}
export function evidenceSourceHash(pathArg: string): string {
  const root = resolve(pathArg), files: string[] = [];
  if (isFile(root)) files.push(root); else if (isDirectory(root)) walk(root, root, files); else return "missing";
  const hash = createHash("sha256");
  for (const path of files) {
    hash.update(path === root ? basename(path) : relative(root, path).replaceAll("\\", "/"));
    hash.update("\0"); hash.update(readFileSync(path)); hash.update("\0");
  }
  return hash.digest("hex");
}
function componentSourceHash(root: string, kind: ComponentKind, id: string): string {
  // Component evidence is intentionally invalidated by every shipped source/runtime file.
  // This conservative boundary catches shared scripts, hook executables, agent resources,
  // and MCP server entrypoints (for example an mcp.json arg of "server.js"). Generated
  // evidence under evaluations/, VCS metadata, caches, and non-vendored node_modules are
  // excluded because they are not shipped runtime inputs and would create self-hashing.
  return createHash("sha256").update(kind + ":" + id + "\0" + sourceHash(root)).digest("hex");
}
function add(out: PluginComponent[], root: string, kind: ComponentKind, id: string, path: string): void {
  out.push({ kind, id, key: kind + ":" + id, path, source_sha256: componentSourceHash(root, kind, id) });
}
export function discoverPluginComponents(rootArg: string): PluginComponent[] {
  const root = resolve(rootArg), out: PluginComponent[] = [];
  const skills = join(root, "skills");
  if (isDirectory(skills)) for (const id of readdirSync(skills).sort()) {
    const path = join(skills, id);
    if (isDirectory(path) && isFile(join(path, "SKILL.md"))) add(out, root, "skill", id, path);
  }
  const agents = join(root, "agents");
  if (isDirectory(agents)) for (const file of readdirSync(agents).sort()) {
    const path = join(agents, file), extension = extname(file).toLowerCase();
    if (isFile(path) && [".md", ".yaml", ".yml", ".json"].includes(extension)) add(out, root, "agent", file.slice(0, -extension.length), path);
  }
  const canonicalHook = join(root, "extensions", "io.github.bioinfornatics.agent-plugins.goose", "hooks.json");
  const legacyHook = join(root, "hooks", "hooks.json");
  if (isFile(canonicalHook)) add(out, root, "hook", "goose-hooks", canonicalHook);
  else if (isFile(legacyHook)) add(out, root, "hook", "goose-hooks", legacyHook);
  const mcp = join(root, "mcp.json");
  if (isFile(mcp)) add(out, root, "mcp", "mcp", mcp);
  return out.sort((a, b) => a.key.localeCompare(b.key));
}
function nonEmptyStrings(value: unknown): value is string[] { return Array.isArray(value) && value.length > 0 && value.every(x => typeof x === "string" && x.trim().length > 0); }
function validChecks(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((x: any) => x && typeof x.id === "string" && x.id && STATUS.has(x.status) && nonEmptyStrings(x.evidence) && (x.status === "pass" || typeof x.reason === "string"));
}
function payloadProblems(kind: ReceiptKind, payload: any, expectedKeys: string[]): string[] {
  if (!payload || typeof payload !== "object") return ["payload missing"];
  if (kind === "skill" && !nonEmptyStrings(payload.evaluated_behaviors)) return ["payload.evaluated_behaviors missing"];
  if (kind === "agent" && !nonEmptyStrings(payload.evaluated_tasks)) return ["payload.evaluated_tasks missing"];
  if (kind === "hook" && (!nonEmptyStrings(payload.events) || !nonEmptyStrings(payload.safety_cases))) return ["payload.events and payload.safety_cases required"];
  if (kind === "mcp" && (!nonEmptyStrings(payload.servers) || !nonEmptyStrings(payload.capabilities))) return ["payload.servers and payload.capabilities required"];
  if (kind === "integration") {
    const problems: string[] = [];
    if (!nonEmptyStrings(payload.covered_components)) problems.push("payload.covered_components missing");
    const unknownCovered = Array.isArray(payload.covered_components) ? payload.covered_components.filter((key: unknown) => typeof key === "string" && !expectedKeys.includes(key)) : [];
    if (unknownCovered.length) problems.push("integration coverage has unknown component keys: " + unknownCovered.join(", "));
    if (!Array.isArray(payload.scenarios) || payload.scenarios.length === 0) problems.push("payload.scenarios missing");
    const scenarioIds = new Set<string>();
    if (Array.isArray(payload.scenarios)) for (const scenario of payload.scenarios) {
      if (!scenario || typeof scenario.id !== "string" || !scenario.id.trim() || scenarioIds.has(scenario.id)) { problems.push("payload.scenarios invalid or duplicate id"); continue; }
      scenarioIds.add(scenario.id);
      if (!nonEmptyStrings(scenario.covered_components)) problems.push("scenario " + scenario.id + " covered_components missing");
      else {
        const unknown = scenario.covered_components.filter((key: string) => !expectedKeys.includes(key));
        if (unknown.length) problems.push("scenario " + scenario.id + " has unknown component keys: " + unknown.join(", "));
      }
      if (!Array.isArray(scenario.handoffs)) problems.push("scenario " + scenario.id + " handoffs missing");
      else {
        if (!scenario.handoffs.every((h: any) => h && expectedKeys.includes(h.from) && expectedKeys.includes(h.to) && h.from !== h.to)) problems.push("scenario " + scenario.id + " handoffs invalid");
        if (Array.isArray(scenario.covered_components)) for (const handoff of scenario.handoffs) {
          if (!handoff || typeof handoff.from !== "string" || typeof handoff.to !== "string") continue;
          const outside = [handoff.from, handoff.to].filter(key => !scenario.covered_components.includes(key));
          if (outside.length) problems.push("scenario " + scenario.id + " handoff endpoints outside covered_components: " + outside.join(", "));
        }
      }
    }
    if (!Array.isArray(payload.handoffs)) problems.push("payload.handoffs missing");
    else if (!payload.handoffs.every((h: any) => h && expectedKeys.includes(h.from) && expectedKeys.includes(h.to) && h.from !== h.to && typeof h.scenario === "string" && scenarioIds.has(h.scenario) && nonEmptyStrings(h.evidence))) problems.push("payload.handoffs invalid or references undeclared scenario");
    if (Array.isArray(payload.scenarios) && Array.isArray(payload.handoffs)) for (const scenario of payload.scenarios) {
      if (!scenario || typeof scenario.id !== "string" || !Array.isArray(scenario.handoffs)) continue;
      const declared = payload.handoffs.filter((h: any) => h?.scenario === scenario.id);
      for (const handoff of declared) if (!scenario.handoffs.some((h: any) => h?.from === handoff.from && h?.to === handoff.to)) problems.push("scenario " + scenario.id + " does not identify handoff " + handoff.from + " -> " + handoff.to);
      for (const handoff of scenario.handoffs) if (!declared.some((h: any) => h?.from === handoff.from && h?.to === handoff.to)) problems.push("scenario " + scenario.id + " identifies undeclared handoff " + handoff.from + " -> " + handoff.to);
    }
    const uncovered = expectedKeys.filter(key => !payload.covered_components?.includes(key));
    if (uncovered.length) problems.push("integration coverage missing: " + uncovered.join(", "));
    for (const key of expectedKeys) if (Array.isArray(payload.scenarios) && !payload.scenarios.some((scenario: any) => scenario?.covered_components?.includes(key))) problems.push("integration scenarios do not cover: " + key);
    if (expectedKeys.length > 1 && payload.handoffs?.length === 0) problems.push("cross-component handoff evidence missing");
    return problems;
  }
  return [];
}
export function assessEvidenceReceipt(receipt: any, kind: ReceiptKind, sourceSha256: string, expectedComponentKeys: string[] = []): ReceiptAssessment {
  const legacy = kind === "skill" && receipt?.schema_version === "1.0" && receipt?.artifact === "skill" && receipt?.applicability === undefined && receipt?.checks === undefined && receipt?.payload === undefined;
  const problems: string[] = [];
  if (!receipt || typeof receipt !== "object") return { typed: false, status: "blocked", problems: ["receipt missing or invalid JSON"] };
  if (receipt.schema_version !== "1.0" || receipt.artifact !== kind || !KINDS.has(receipt.artifact)) problems.push("invalid schema or artifact kind");
  if (typeof receipt.name !== "string" || !receipt.name) problems.push("name missing");
  if (!STATUS.has(receipt.status)) problems.push("invalid status");
  if (!SHA256.test(receipt.source_sha256 ?? "")) problems.push("source_sha256 must be a SHA-256 digest");
  if (receipt.source_sha256 !== sourceSha256) problems.push("stale source hash");
  if (!legacy) {
    const applicability = receipt.applicability;
    if (!applicability || !["applicable", "na"].includes(applicability.status)) problems.push("applicability missing or invalid");
    if (applicability?.status === "na" && !(typeof applicability.reason === "string" && applicability.reason.trim())) problems.push("N/A applicability requires a reason");
    if (applicability?.status === "na" && receipt.status !== "na") problems.push("N/A applicability requires status na");
    if (applicability?.status === "applicable" && receipt.status === "na") problems.push("applicable evidence cannot have status na");
    if (!validChecks(receipt.checks)) problems.push("checks missing or invalid");
    problems.push(...payloadProblems(kind, receipt.payload, expectedComponentKeys));
  }
  const checkStatuses: EvidenceStatus[] = Array.isArray(receipt.checks) ? receipt.checks.map((check: any) => check?.status).filter((status: unknown): status is EvidenceStatus => STATUS.has(status as EvidenceStatus)) : [];
  if (receipt.status !== "pass" && receipt.status !== "na") problems.push("receipt status " + String(receipt.status));
  if (checkStatuses.includes("fail")) problems.push("one or more checks failed");
  else if (checkStatuses.includes("blocked")) problems.push("one or more checks blocked");
  const status: EvidenceStatus = receipt.status === "fail" || checkStatuses.includes("fail") ? "fail" : receipt.status === "blocked" || checkStatuses.includes("blocked") || problems.length ? "blocked" : receipt.status === "na" ? "na" : "pass";
  return { typed: !legacy, status, problems };
}
