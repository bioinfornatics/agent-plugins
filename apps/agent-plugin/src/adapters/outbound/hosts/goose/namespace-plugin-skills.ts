import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Document, isMap, parseDocument } from "yaml";
import type { SnapshotFile } from "../../../../domain/evaluation.ts";
import { FILE_LIMIT, regularFile } from "./private-files.ts";

/** Native installation prefixes frontmatter names (Goose open_plugins.rs).
 * Already installed inputs retain their matching prefix: evaluation must not double it.
 * Only the private restored files change; frozen source bytes/revision stay untouched.
 */
export function namespaceSkillContent(raw: string, pluginName: string, directoryName: string): string {
  const match = /^(\s*)---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/.exec(raw);
  if (!match) {
    if (raw.trimStart().startsWith("---")) throw new Error("Invalid Plugin Skill frontmatter");
    return `---\nname: ${pluginName}:${directoryName}\n---\n${raw}`;
  }
  const metadata = parseDocument(match[2] ?? "", { uniqueKeys: true });
  if (metadata.errors.length || (metadata.contents !== null && !isMap(metadata.contents))) throw new Error("Invalid Plugin Skill frontmatter");
  let resolved: Record<string, unknown>;
  try { resolved = metadata.toJS({ maxAliasCount: 50 }) ?? {}; }
  catch { throw new Error("Invalid Plugin Skill frontmatter aliases"); }
  const value: unknown = resolved.name;
  if (value !== undefined && value !== null && typeof value !== "string") throw new Error("Invalid Plugin Skill name");
  const name = typeof value === "string" && value.length ? value : directoryName;
  const namespaced = name.startsWith(`${pluginName}:`) ? name : `${pluginName}:${name}`;
  if (value === namespaced) return raw;
  // Editing an anchored scalar in place would also change aliases in other fields.
  // Resolve aliases before replacement so only name changes (anchored-name regression).
  resolved.name = namespaced;
  const rewritten = new Document(resolved);
  // The body is sliced from original bytes, not parsed or normalized as YAML/Markdown.
  return `${match[1] ?? ""}---\n${rewritten.toString()}---${raw.slice(match[0].length)}`;
}

/** Match the product's immediate skills/* discovery, including children without eval suites. */
export async function namespacePluginSkills(destination: string, pluginName: string, files: readonly SnapshotFile[]): Promise<void> {
  for (const file of files) {
    const match = /^skills\/([^/]+)\/SKILL\.md$/.exec(file.path);
    if (!match) continue;
    const path = join(destination, file.path);
    const bytes = await regularFile(path);
    const raw = bytes.toString("utf8");
    if (!Buffer.from(raw).equals(bytes)) throw new Error("Invalid Plugin Skill UTF-8");
    const content = namespaceSkillContent(raw, pluginName, match[1] ?? "");
    if (Buffer.byteLength(content) > FILE_LIMIT) throw new Error("Namespaced Plugin Skill exceeds file bound");
    if (content !== raw) await writeFile(path, content);
  }
}
