# Goose Plugin Format Reference

Use this reference when creating, porting, auditing, or packaging an Agent Plugin for Goose.

## Contract status

| Contract | Status | Meaning |
|---|---|---|
| Agent Plugins 1.0.0 | Published; active | The only portable generation and validation target |
| Agent Plugins 1.1.0 snapshot | Working Draft; inactive | Analysis only; its schema identifiers are unsupported |
| `io.github.bioinfornatics.agent-plugins.goose` | Repository-defined Goose adapter | Client behavior transported by 1.0.0 extensions; not portable semantics or claimed upstream ratification |

Never infer 1.1.0 support from schema similarity or semantic-version proximity.

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

Discover only immediate children of `skills/` containing a regular file named exactly `SKILL.md`. Do not recursively discover deeper descendants. Keep references and scripts inside that Skill directory. Frontmatter names remain unqualified even when Goose exposes a plugin-qualified load name.

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

### Current Goose host compatibility

At Goose commit `dd8de0196716db393fa1cd146d92a5f46e05d1a1`, the plugin MCP loader defaults to root `.mcp.json`; it does not auto-discover root `mcp.json`. The host also accepts inline `plugin.json.mcpServers` or path configuration, which may explicitly select `./mcp.json`. Each loaded server requires `command` and Goose converts it to a stdio extension. Its serde structs do not deny unknown fields, so server `type` and top-level `$schema` are ignored: an explicitly selected portable stdio-only `mcp.json` can load unchanged. Portable `streamable-http` and `sse` entries fail because `command` is required and the loader has no remote transport mapping, not because their `type` field exists.

One portable `mcp.json` may therefore serve both contracts when Goose selects it explicitly and all selected entries are stdio with `command`. A separate `.mcp.json` host compatibility artifact may instead coexist: portable clients discover `mcp.json`, while Goose defaults to `.mcp.json` (or selects one approved path with `exclusive: true`). Block configurations that can activate duplicate servers, such as non-exclusive `./mcp.json` beside `.mcp.json`; do not impose an unconditional no-co-ship rule. Validate the portable and Goose contracts separately and never invent precedence.

## Goose hooks

Hooks are host-specific and outside portable Agent Plugins 1.0.0 core. Both recorded native Goose targets load root hooks/hooks.json. New native output uses:

~~~text
my-plugin/
├── plugin.json
├── hooks/
│   └── hooks.json
└── scripts/
    └── handler.sh
~~~

The distributor namespace io.github.bioinfornatics.agent-plugins.goose is an adapter contract, not a native Goose loader contract. An extensions envelope does not activate its hooks on the recorded targets. Existing adapter documents retain structural validation with an activation warning; no native compatibility follows. Do not recommend moving native hooks into an unloaded namespace. Multiple layouts fail closed pending explicit activation review.

Read [Goose target compatibility](goose-target-compatibility.md) for exact revisions and event support. Commands use contained PLUGIN_ROOT references and require side-effect/security review.

## Runtime dependencies

Document required Goose capabilities, MCP support, external CLIs, APIs, and environment variables separately from package contents. Never encode secrets or imply portable metadata installs host capabilities.

## Validation

Run the unified CLI from the installed `plugin-creator` directory:

```bash
plugin-creator validate <plugin-directory> --mode portable-load --format json
plugin-creator validate <plugin-directory> --mode strict-authoring --format json
```

`portable-load` models normative 1.0.0 loading and isolation. `strict-authoring` is the default and combines schema with Goose operational and authoring-policy checks. See [portable-conformance.md](portable-conformance.md).

For direct document-level schema diagnostics only:

```bash
plugin-creator validate <file-or-directory> \
  --type auto --mode strict-authoring --format json
```

This lower-level validator discovers only `plugin.json` and portable `mcp.json`; it does not treat legacy MCP forms as portable. Prefer unified validation for normal authoring.

## Installation and scope

```bash
goose plugin install https://github.com/example/my-goose-plugin.git
goose plugin install --auto-update https://github.com/example/my-goose-plugin.git
goose plugin update my-plugin
```

Installed plugins live under `~/.agents/plugins/<name>/`; project-local plugins may live under `<project>/.agents/plugins/<name>/`. Standalone Skills in `.agents/skills/` and custom agents in `.agents/agents/` are separate surfaces. A bundled `agents/` directory is not portable or assumed auto-installed.

## Porting map

| Source | Target |
|---|---|
| Agent Skill | `skills/<name>/SKILL.md` |
| portable MCP | root `mcp.json` with explicit transport |
| Goose `.mcp.json` or inline/path MCP | separate host compatibility file or reviewed portable migration; explicit `./mcp.json` path only for a Goose-compatible stdio shape |
| Goose hook | native root hooks/hooks.json; selected host contract |
| root `hooks/hooks.json` | preserve native activation; no automatic namespace migration |
| custom agent | separate Goose custom-agent installation when requested |
| source-specific UI/tool | adapt or replace; do not claim portability |

Always distinguish portable file compatibility from target-host runtime compatibility.
