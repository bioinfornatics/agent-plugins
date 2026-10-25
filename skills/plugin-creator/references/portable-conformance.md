# Portable Conformance and Release Policy

Published Agent Plugins **1.0.0** is the sole active portable target. The vendored **1.1.0 Working Draft** is analysis evidence but inactive; schema similarity does not imply compatibility.

## Three decisions

| Decision | Question | Outcome |
|---|---|---|
| `portable-load` | What can a conformant 1.0.0 client load, ignore, or isolate? | `accepted`, `partial`, `rejected`, or `unsupported` with scoped diagnostics |
| `strict-authoring` | Should this creator accept the package for Goose? | success or failure after schema, semantic, operational, safety, and migration checks |
| release | May this exact artifact ship? | pass, fail, or blocked after strict validation, tests, evidence, identity, and review |

Portable-load success is not release approval.

## Portable-load

The portable core is root `plugin.json`, optional `skills/`, and optional root `mcp.json`. Fixed locations cannot be overridden or supplemented inline.

- A missing, unsupported, unreadable, or fatally invalid manifest rejects the plugin.
- Unknown top-level manifest fields are reported and ignored.
- A non-object `extensions` value is reported and ignored.
- Unknown extension namespaces are ignored without validating their contents.
- A wrong-kind or invalid component location disables that component type while independent valid types continue.
- Invalid MCP disables MCP, not valid Skills.
- An unsupported MCP transport skips that server; runtime failure remains scoped to that server.

The portable loader gives no meaning to Goose host `.mcp.json`, inline/path-based `plugin.json.mcpServers`, root `hooks/`, or custom-agent directories. Current Goose may use those MCP forms, but that host compatibility is separate from portable loading.

```bash
plugin-creator validate <plugin-directory> --mode portable-load --format json
```

Review component outcomes and warnings; do not reduce the report to an unqualified “valid.”

## Strict authoring

Strict authoring is the default. It rejects hazards portable loading may ignore or isolate, including unknown authoring data, inactive schemas, unsafe paths, malformed Skills, MCP semantic errors or likely packaged secrets, Goose extension errors, and ambiguous canonical/legacy sources.

```bash
plugin-creator validate <plugin-directory> --mode strict-authoring --format json
```

The unified command combines canonical schema and Goose operational validation. Use `validate_agent_plugin_schema.js` only for direct document-level schema diagnostics.

## Release

Release builds use strict authoring and may additionally require specialist component validation, executable and offline tests, behavioral receipts, integration benchmarks, archive identity, migration approval, and human review. Missing evidence produces blocked, never a weaker pass.

## Legacy boundary

| Legacy input | Canonical target | Rule |
|---|---|---|
| Goose root `.mcp.json` | portable root `mcp.json` | Propose a portable artifact only when every server maps safely; a separate host artifact may coexist under the governed selection rule below |
| Goose inline/path-based `plugin.json.mcpServers` | portable root `mcp.json` | Review explicitly; an explicit `./mcp.json` path can select a portable stdio-only document because Goose ignores unknown `type` and `$schema` fields |
| root `hooks/hooks.json` | `extensions/io.github.bioinfornatics.agent-plugins.goose/hooks.json` plus manifest envelope | Validate for the selected Goose target before translating |

Coexistence is allowed only with one governed Goose activation path: either Goose explicitly selects the canonical stdio-only `mcp.json`, or portable `mcp.json` coexists with a separate host `.mcp.json` that Goose alone selects by default or through an approved `exclusive: true` path. This replaces, and does not add to, the general no-co-ship default — dual-target coexistence is permitted only under this single governed selection rule, never as an unconditional exception. Fail ambiguous duplicate activation—for example, non-exclusive `./mcp.json` beside `.mcp.json`, or inline servers beside another active source. Never merge or invent precedence.

## Goose boundary

`io.github.bioinfornatics.agent-plugins.goose` is a distributor-owned adapter contract. Agent Plugins 1.0.0 transports its manifest object but assigns no portable semantics. A client that does not implement it may ignore it under portable rules; only the Goose adapter validates or executes it.

New hooks use `plugin.json.extensions["io.github.bioinfornatics.agent-plugins.goose"]` pointing to `extensions/io.github.bioinfornatics.agent-plugins.goose/hooks.json`. Do not describe hooks as portable core or claim upstream ratification.

## Native hook compatibility

Hooks are host-specific, not portable core. Native root hooks/hooks.json is not deprecated by the recorded Goose targets. See [Goose target compatibility](goose-target-compatibility.md). A structurally valid distributor adapter carries an activation warning, not proof of native loading. Never infer operational compatibility from portable-load acceptance.
