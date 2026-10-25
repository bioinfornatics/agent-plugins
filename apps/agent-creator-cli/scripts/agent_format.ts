// Shared parsing and validation for Goose custom-agent files.
import { readFileSync } from "node:fs";
import type yamlType from "js-yaml";
import { loadRuntimeDependency } from "./runtime-deps.js";

const yaml = loadRuntimeDependency<typeof yamlType>("js-yaml");

export const ALLOWED_FIELDS = new Set(["name", "description", "model"]);
export const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface AgentDocument {
  name: string;
  description: string | null;
  model: string | null;
  body: string;
}

export class AgentFormatError extends Error {}

export function parseAgent(path: string): AgentDocument {
  if (!path.toLowerCase().endsWith(".md")) {
    throw new AgentFormatError("Agent file must use the .md extension");
  }
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (error) {
    throw new AgentFormatError(`Cannot read agent file: ${(error as Error).message}`);
  }

  const lines = text.split(/\r?\n/);
  if (!lines.length || lines[0].trim() !== "---") {
    throw new AgentFormatError("Agent file must start with YAML frontmatter");
  }
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    throw new AgentFormatError("Agent frontmatter is not closed with ---");
  }

  let metadata: unknown;
  try {
    metadata = yaml.load(lines.slice(1, end).join("\n"));
  } catch (error) {
    throw new AgentFormatError(`Invalid YAML frontmatter: ${(error as Error).message}`);
  }
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new AgentFormatError("Agent frontmatter must be a YAML mapping");
  }
  const meta = metadata as Record<string, unknown>;

  const unknown = Object.keys(meta).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unknown.length) {
    const sorted = unknown.sort();
    const mcpFields = sorted.filter((key) => ["mcpServers", "mcp", "extensions"].includes(key));
    if (mcpFields.length) {
      throw new AgentFormatError(
        `Unsupported MCP frontmatter fields: ${mcpFields.join(", ")}. Custom agents may use session-enabled MCP but cannot declare it; route MCP configuration to plugin-creator (strict authoring policy)`
      );
    }
    throw new AgentFormatError(`Unsupported frontmatter fields: ${sorted.join(", ")} (strict authoring policy)`);
  }

  const rawName = meta.name;
  if (typeof rawName !== "string" || !rawName.trim()) {
    throw new AgentFormatError("Frontmatter field 'name' must be a non-empty string");
  }
  const name = rawName.trim();
  if (!NAME_RE.test(name)) {
    throw new AgentFormatError("Agent name must be lowercase kebab-case");
  }
  if (name.length > 64) {
    throw new AgentFormatError("Agent name must not exceed 64 characters");
  }

  let description: string | null = null;
  if (meta.description !== undefined && meta.description !== null) {
    if (typeof meta.description !== "string" || !meta.description.trim()) {
      throw new AgentFormatError(
        "Frontmatter field 'description' must be a non-empty string when present"
      );
    }
    description = meta.description.trim();
  }

  let model: string | null = null;
  if (meta.model !== undefined && meta.model !== null) {
    if (typeof meta.model !== "string" || !meta.model.trim()) {
      throw new AgentFormatError(
        "Frontmatter field 'model' must be a non-empty string when present"
      );
    }
    model = meta.model.trim();
  }

  const body = lines.slice(end + 1).join("\n").trim();
  if (!body) {
    throw new AgentFormatError("Agent instruction body must not be empty");
  }
  if (body.includes("TODO")) {
    throw new AgentFormatError("Agent instruction body contains an unresolved TODO");
  }

  return { name, description, model, body };
}

export function renderAgent(
  name: string,
  description: string | null,
  model: string | null,
  body: string
): string {
  const metadata: Record<string, string> = { name };
  if (description) metadata.description = description;
  if (model) metadata.model = model;
  const frontmatter = yaml.dump(metadata, { sortKeys: false }).trim();
  return `---\n${frontmatter}\n---\n\n${body.trim()}\n`;
}
