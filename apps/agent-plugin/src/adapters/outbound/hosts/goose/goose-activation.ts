import { parseDocument } from "yaml";
import { classifyActivation, type ActivationObservation } from "../../../../domain/activation.ts";
import type { ActivationAssessment, ActivationObserver, ActivationTreatment } from "../../../../application/ports/activation-observer.ts";
import { record } from "./goose-configuration.ts";

/** Same bounds as the judge tool-event index (AGENTS.md ap-3mwp); exceeding them yields `capped`. */
export const activationLimits = { sourceBytes: 64 * 1024 * 1024, locations: 200_000, decodeDepth: 4 } as const;
const MIN_FINGERPRINT = 24, MAX_FINGERPRINTS = 400;

interface ProfileSkill { name: string; directory: string; unqualified?: string; fingerprints: string[] }

function frontmatter(raw: string): { name?: string; body: string } {
  const match = /^\s*---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if (!match) return { body: raw };
  try {
    const value: unknown = parseDocument(match[1] ?? "", { uniqueKeys: true }).toJS({ maxAliasCount: 50 });
    return { ...(record(value) && typeof value.name === "string" && value.name ? { name: value.name } : {}), body: raw.slice(match[0].length) };
  } catch { return { body: raw.slice(match[0].length) }; }
}

/** Goose-visible Skill names: standalone frontmatter name (else directory); Plugin children are
 * namespaced `plugin:name` exactly like namespaceSkillContent (Goose open_plugins.rs). */
export function gooseProfileSkills(treatment: ActivationTreatment): ProfileSkill[] {
  const parsed: (Omit<ProfileSkill, "fingerprints"> & { lines: string[] })[] = [];
  for (const component of treatment.components) for (const file of component.skillFiles) {
    const child = component.kind === "plugin" ? /^skills\/([^/]+)\/SKILL\.md$/.exec(file.path)?.[1] : file.path === "SKILL.md" ? component.installationName : undefined;
    if (!child) continue;
    const { name: declared = child, body } = frontmatter(file.content);
    const prefix = `${component.installationName}:`;
    const name = component.kind === "plugin" && !declared.startsWith(prefix) ? `${prefix}${declared}` : declared;
    // Body lines, not the description: descriptions also appear in host catalogs and listings.
    // Headings and table rules are generic; a line needs enough letters to identify prose.
    const lines = body.split(/\r?\n/).map(line => line.trim()).filter(line => line.length >= MIN_FINGERPRINT && !line.startsWith("#") && !line.startsWith("|") && !line.startsWith("```") && (line.match(/[A-Za-z]/g)?.length ?? 0) >= MIN_FINGERPRINT / 2);
    parsed.push({ name, directory: child, ...(component.kind === "plugin" ? { unqualified: name.slice(prefix.length) } : {}), lines });
  }
  // A line shared with another profile Skill (common tables, contracts) cannot attribute a read.
  return parsed.map(({ lines, ...skill }) => ({ ...skill,
    fingerprints: lines.filter(line => !parsed.some(other => other.name !== skill.name && other.lines.includes(line))).slice(0, MAX_FINGERPRINTS) }));
}

class Budget {
  bytes = 0; locations = 0; capped = false;
  text(value: string): boolean {
    this.bytes += value.length;
    if (this.bytes > activationLimits.sourceBytes) this.capped = true;
    return !this.capped;
  }
  location(): boolean {
    if (++this.locations > activationLimits.locations) this.capped = true;
    return !this.capped;
  }
}

/** Code-mode results are JSON-escaped (`Result: "..."`, arrays, nested objects or doubly encoded
 * strings). Decode bounded copies only; never evaluate recorded code. */
function decodedStrings(text: string, budget: Budget): string[] {
  const out = [text];
  const visit = (value: unknown, depth: number): void => {
    if (depth > activationLimits.decodeDepth || budget.capped) return;
    if (typeof value === "string") {
      if (!budget.text(value)) return;
      out.push(value);
      const trimmed = value.trim();
      if (/^["[{]/.test(trimmed)) { try { visit(JSON.parse(trimmed), depth + 1); } catch { /* plain text */ } }
    } else if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); }
    else if (record(value)) { for (const item of Object.values(value)) visit(item, depth + 1); }
  };
  const result = /^Result: ([\s\S]*)$/.exec(text)?.[1];
  if (result !== undefined) { try { visit(JSON.parse(result), 1); } catch { /* non-JSON result */ } }
  return out;
}

function responseText(result: unknown): { text: string; error: boolean } | undefined {
  if (!record(result)) return undefined;
  const value = result.value;
  if (result.status !== "success") return { text: typeof result.error === "string" ? result.error : "", error: true };
  if (!record(value) || !Array.isArray(value.content)) return undefined;
  const text = value.content.filter((part: unknown) => record(part) && part.type === "text" && typeof part.text === "string").map((part: { text: string }) => part.text).join("\n");
  return { text, error: value.isError === true };
}

const toolName = (name: unknown, base: string) => typeof name === "string" && (name === base || name.endsWith(`__${base}`));
const LOADED = /# Loaded Skill: ([^\s()]+) \((?:builtin )?skill\)/g;
const RESOURCE = /# Loaded: ([^\s/]+)\/\S+/g;
const NOT_FOUND = /Tool load_skill failed: "?Skill '([^']+)' not found/g;

/** Structural Goose activation oracle over a decoded named-session export (product §31). */
export function observeGooseActivation(messages: unknown, treatment: ActivationTreatment): ActivationObservation {
  const skills = gooseProfileSkills(treatment), budget = new Budget();
  const exact = new Map(skills.map(skill => [skill.name, skill]));
  const target = (name: string) => exact.get(name) ?? skills.find(skill => skill.unqualified === name);
  const loaded = new Set<string>(), failed = new Set<string>(), resources = new Set<string>(), reads = new Set<string>(), probes = new Set<string>();
  let unresolved = 0;
  const empty = (scan: ActivationObservation["scan"]): ActivationObservation => ({ version: 1, scan, loaded: [], failedLoads: [], resourceLoads: [], fileReads: [], fileProbes: [], unresolved: 0 });
  if (!Array.isArray(messages)) return empty("unsupported");
  const requests = new Map<string, { name: unknown; arguments: unknown }>(), duplicate = new Set<string>();
  const responses: { id: string; result: unknown }[] = [];
  for (const message of messages) {
    if (!budget.location()) return empty("capped");
    if (!record(message) || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (!budget.location()) return empty("capped");
      if (!record(part) || typeof part.id !== "string") continue;
      if (part.type === "toolRequest") {
        const call = record(part.toolCall) && part.toolCall.status === "success" && record(part.toolCall.value) ? part.toolCall.value : undefined;
        if (requests.has(part.id)) duplicate.add(part.id);
        requests.set(part.id, { name: call?.name, arguments: call?.arguments });
      } else if (part.type === "toolResponse") responses.push({ id: part.id, result: part.toolResult });
    }
  }
  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Whole-identifier / whole-path-segment matching: `lifecycle/SKILL.md` is not `cycle` (review finding).
  const mentions = (text: string, name: string) => new RegExp(`(^|[^A-Za-z0-9_.:-])${escapeRegExp(name)}($|[^A-Za-z0-9_-])`).test(text);
  const pathProbe = (text: string, directory: string) => new RegExp(`(^|[\\\\/\\s"'=:])${escapeRegExp(directory)}/SKILL\\.md`).test(text);
  const mentionsProfile = (text: string) => skills.some(skill => [skill.name, skill.directory, skill.unqualified].some(name => name !== undefined && mentions(text, name)));
  // A read needs two distinct unique body lines (or every line of a short body) so one generic
  // sentence also present in repository files or inputs cannot label a baseline contaminated.
  const bodyMatches = (strings: string[]) => skills.filter(skill => {
    const found = skill.fingerprints.filter(line => strings.some(text => text.includes(line))).length;
    return found > 0 && found >= Math.min(2, skill.fingerprints.length);
  }).map(skill => skill.name);
  const responseCounts = new Map<string, number>();
  for (const { id } of responses) responseCounts.set(id, (responseCounts.get(id) ?? 0) + 1);
  const isLoader = (request: { name: unknown; arguments: unknown }) => {
    const args = record(request.arguments) ? request.arguments : {};
    if (toolName(request.name, "load_skill")) return typeof args.name === "string" && target(args.name.split("/")[0] ?? "") !== undefined;
    if (toolName(request.name, "load")) return typeof args.source === "string" && target(args.source) !== undefined;
    return toolName(request.name, "execute_javascript") && typeof args.code === "string" && args.code.includes("load_skill") && mentionsProfile(args.code);
  };
  // Profile-targeted calls that never received a unique response cannot prove either outcome.
  for (const [id, request] of requests) if ((duplicate.has(id) || (responseCounts.get(id) ?? 0) !== 1) && isLoader(request)) unresolved++;
  for (const { id, result } of responses) {
    const request = requests.get(id);
    const response = responseText(result);
    if (response && !budget.text(response.text)) return empty("capped");
    const strings = response ? decodedStrings(response.text, budget) : [];
    if (budget.capped) return empty("capped");
    const matches = (pattern: RegExp) => [...new Set(strings.flatMap(text => [...text.matchAll(pattern)].map(match => match[1] ?? "")))];
    const delivered = response && !response.error ? bodyMatches(strings) : [];
    // Duplicate/orphan identifiers never establish access (ap-3mwp); profile content carried by
    // them is ambiguous, not absent, so it makes the verdict inconclusive instead of clean.
    if (!request || duplicate.has(id) || responseCounts.get(id) !== 1) {
      if (delivered.length || matches(LOADED).some(name => target(name))) unresolved++;
      continue;
    }
    const args = record(request.arguments) ? request.arguments : {};
    // Names whose body this response delivered through the host loader itself.
    const viaLoader = new Set<string>();
    if (toolName(request.name, "load_skill")) {
      const requested = typeof args.name === "string" ? args.name : undefined;
      const skill = requested === undefined ? undefined : target(requested.split("/")[0] ?? "");
      if (!response) { if (skill) unresolved++; continue; }
      const header = matches(LOADED), resource = matches(RESOURCE);
      if (!response.error && header.length === 1 && requested !== undefined && header[0] === requested && exact.has(requested)) { loaded.add(requested); viaLoader.add(requested); }
      else if (!response.error && requested?.includes("/") && skill && resource.includes(skill.name)) resources.add(skill.name);
      else if (response.error && skill) failed.add(skill.name);
      else if (skill) unresolved++;
    } else if (toolName(request.name, "load")) {
      // Goose summon `load({source})` resolves recipes/agents, not Skills; a profile-named source is
      // an activation attempt whose success cannot be attributed to the profile Skill.
      const skill = typeof args.source === "string" ? target(args.source) : undefined;
      if (skill && response?.error) failed.add(skill.name);
      else if (skill) unresolved++;
    } else if (toolName(request.name, "execute_javascript") && typeof args.code === "string" && args.code.includes("load_skill")) {
      const code = args.code;
      // Guard against literal header text in recorded code only; a header assembled at run time is
      // not detectable without executing code, which is forbidden (documented limit, product §31).
      if (!response || /Loaded Skill|# Loaded:/.test(code)) { if (mentionsProfile(code)) unresolved++; }
      else {
        const header = matches(LOADED), resource = matches(RESOURCE), missing = matches(NOT_FOUND);
        for (const name of header) { if (exact.has(name)) { loaded.add(name); viaLoader.add(name); } else if (target(name)) unresolved++; }
        for (const name of resource) { if (exact.has(name)) resources.add(name); }
        for (const name of missing) { const skill = target(name.split("/")[0] ?? ""); if (skill) failed.add(skill.name); }
        // Unrelated loader calls (e.g. Goose builtins) must not make a profile verdict inconclusive.
        if (!header.length && !resource.length && !missing.length && mentionsProfile(code)) unresolved++;
      }
    } else {
      const argumentText = JSON.stringify(args);
      for (const skill of skills) if (!delivered.includes(skill.name) && pathProbe(argumentText, skill.directory)) probes.add(skill.name);
    }
    // Any tool, loaders and wrappers included: frozen SKILL.md body that this response did not
    // deliver through a confirmed load of that Skill is consumed content, whatever path, copy or
    // concurrent trial HOME served it (ap-wxvu).
    for (const name of delivered) if (!viaLoader.has(name)) reads.add(name);
  }
  // A failed attempt superseded by a later success is not a failure; a read is not a probe.
  for (const name of loaded) failed.delete(name);
  for (const name of reads) probes.delete(name);
  const sorted = (values: Set<string>) => [...values].sort();
  return { version: 1, scan: "complete", loaded: sorted(loaded), failedLoads: sorted(failed), resourceLoads: sorted(resources), fileReads: sorted(reads), fileProbes: sorted(probes), unresolved };
}

/** Goose implementation of the application observer; other hosts are not attributable yet. */
export class GooseActivationObserver implements ActivationObserver {
  observe(input: Parameters<ActivationObserver["observe"]>[0]): ActivationAssessment | undefined {
    if (input.agent !== "goose") return undefined;
    const artifact = input.artifacts.find(a => a.path === "goose/conversation.json");
    let observation: ActivationObservation;
    if (!artifact) observation = observeGooseActivation(undefined, input.treatment);
    else if (artifact.content.length > activationLimits.sourceBytes) observation = { ...observeGooseActivation([], input.treatment), scan: "capped" };
    else {
      let data: unknown;
      try { data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(artifact.content)); } catch { data = undefined; }
      const conversation = record(data) ? data.conversation : undefined;
      const messages = record(data) && Array.isArray(data.messages) ? data.messages : Array.isArray(conversation) ? conversation : record(conversation) ? conversation.messages : undefined;
      observation = observeGooseActivation(messages, input.treatment);
    }
    return { class: classifyActivation(input.condition, observation), observation };
  }
}
