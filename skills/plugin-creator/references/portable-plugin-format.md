# Portable Plugin format

Read before authoring, migrating, auditing or packaging portable package documents.
This reference owns common format; it does not select or prove host integration.

## Contract status

Published Agent Plugins **1.0.0** is the sole active portable target. The retained
1.1.0 snapshot is an inactive Working Draft; never infer support from similarity
or version proximity. Compare against the [recorded canonical schemas](agent-plugins-1.0.0/README.md)
and [tolerant versus strict review](portable-conformance.md). No current plugin-creator
validator exists; shared Skill validation is not plugin manifest validation.

## Published portable core

```text
my-plugin/
├── plugin.json                    # required
├── skills/review/SKILL.md         # optional
└── mcp.json                       # optional
```

Agent Plugins 1.0.0 defines no portable hooks, agents, commands, recipes, or alternate MCP locations. The manifest cannot redirect fixed discovery or contain inline components.

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "my-plugin",
  "version": "0.1.0",
  "description": "Reusable workflows"
}
```

The schema requires `$schema` and `name`; strict authoring also expects useful release metadata.

## Skills

Discover only immediate children of `skills/` containing a regular file named exactly `SKILL.md`. Do not recursively discover deeper descendants. Keep references and scripts inside that Skill directory. Frontmatter names remain unqualified even when a host exposes a plugin-qualified load name.

## Portable MCP

Portable MCP exists only at root `mcp.json`:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "database": {
      "type": "stdio",
      "command": "node",
      "args": ["server.js"],
      "cwd": "./data"
    },
    "remote": {
      "type": "streamable-http",
      "url": "https://example.test/mcp"
    }
  }
}
```

Manifest and MCP schema versions must match. An empty `mcpServers` object is valid. Entries use an explicit closed `stdio`, `streamable-http`, or legacy HTTP+SSE `sse` variant. Do not package credentials in `env` or `headers`; keep paths contained. A declaration does not sandbox a process.

## Portable migration map

| Source | Portable disposition |
|---|---|
| Agent Skill | `skills/<name>/SKILL.md` |
| Portable MCP | Root `mcp.json` with explicit transport |
| Host-specific integration | Separate conditional target-host review; do not claim portability |

## Components and proof

Route bundled Skill content to skill-creator. A standalone custom agent is a
separate host surface, not a portable Plugin component; route it to agent-creator.
Route host-specific hook authoring to hook-creator and executable closure to
plugin-script-packaging. Document prerequisites separately from package contents;
portable metadata does not install host capabilities.

Inventory migrated components as portable/adapt/replace/unsupported, retain originals
and unmapped content, and write only to an approved separate destination. Source
format, archive integrity, behavior, observed host activation and publication
permission are separate decisions. None requires an unsolicited model campaign.
