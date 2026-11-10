# Conditional Goose Plugin integration

Read **before** selecting or changing integration when the target host is Goose,
or when existing Goose integration is being migrated/reviewed. Portable-only work
uses [portable format](portable-plugin-format.md), not this host branch. The authoring
harness running Goose does not itself make Goose the package target.

This reference preserves recorded host behavior, not portable semantics or a tested
claim about the running host. `io.github.bioinfornatics.agent-plugins.goose` is a
repository-defined distributor adapter, not upstream-ratified portable semantics.

## MCP activation

At Goose commit `dd8de0196716db393fa1cd146d92a5f46e05d1a1`, the plugin MCP loader defaults to root `.mcp.json`; it does not auto-discover root `mcp.json`. The host also accepts inline `plugin.json.mcpServers` or path configuration, which may explicitly select `./mcp.json`. Each loaded server requires `command` and Goose converts it to a stdio extension. Its serde structs do not deny unknown fields, so server `type` and top-level `$schema` are ignored: an explicitly selected portable stdio-only `mcp.json` can load unchanged. Portable `streamable-http` and `sse` entries fail because `command` is required and the loader has no remote transport mapping, not because their `type` field exists.

One portable `mcp.json` may therefore serve both contracts when Goose selects it explicitly and all selected entries are stdio with `command`. A separate `.mcp.json` host compatibility artifact may instead coexist: portable clients discover `mcp.json`, while Goose defaults to `.mcp.json` (or selects one approved path with `exclusive: true`). Block configurations that can activate duplicate servers, such as non-exclusive `./mcp.json` beside `.mcp.json`; do not impose an unconditional no-co-ship rule. Validate the portable and Goose contracts separately and never invent precedence.

## Native hooks

Hooks are host-specific and outside portable Agent Plugins 1.0.0 core. The recorded native Goose targets load root `hooks/hooks.json`. New native output uses:

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

## Consuming-step checks

- Before changing MCP selection, inventory portable and host files plus inline/path
  selections. Host-only selection fields are not portable manifest fields. Preserve
  selected paths without explicit approval; migrate only safely mapped closed variants.
- Before hook event/handler authoring, route to available hook-creator and read the
  [current hook contract](goose-target-compatibility.md). `PreToolUseResult` is
  observation-only. Review blocking behavior, command side effects and contained
  `${PLUGIN_ROOT}` references separately; structural adapter checks warn about
  activation, never prove it.
- Before installation commands, follow [installation review](installation-diagnostics.md)
  under separate authority and current official documentation. Document required Goose
  capabilities/CLIs/APIs/environment variables without secrets; metadata does not
  install them. Custom agents use separate `.agents/agents` installation when requested;
  bundled `agents/` is not portable or assumed auto-installed.
- Compare portable documents against [portable conformance](portable-conformance.md)
  separately from host constraints. Record exact observed versions and missing runtime
  evidence in the [compatibility matrix](compatibility-matrix.md), not guessed support.

## Migration map

| Existing source | Governed disposition |
|---|---|
| Goose `.mcp.json` or inline/path MCP | Preserve host compatibility or review portable migration; explicit `./mcp.json` only for compatible stdio shape |
| Native `hooks/hooks.json` | Preserve native activation; no automatic namespace migration |
| Distributor hook adapter | Preserve source; block adapter-only migration without reviewed activation evidence |
| Multiple MCP/hook layouts | Block pending explicit reviewed activation selection; never invent precedence |
| Custom agent | Route separate requested host installation to agent-creator |
| Source-specific UI/tool | Adapt/replace or mark unsupported; do not claim portability |
