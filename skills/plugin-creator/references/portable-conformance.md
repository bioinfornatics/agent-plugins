# Portable conformance and authoring review

Published Agent Plugins **1.0.0** is the sole active portable target. The recorded
1.1.0 Working Draft remains inactive. These are manual review distinctions, not
available creator CLI modes. Read the [recorded schemas](agent-plugins-1.0.0/README.md)
and [format/host contract](goose-plugin-format.md) before reviewing documents.

## Separate the decisions

| Decision | Question | Evidence |
|---|---|---|
| Tolerant portable loading | What must a conformant client load, ignore or isolate? | Source-backed component findings |
| Strict authoring | Is the authored package complete, unambiguous and safe for the intended target? | Schema comparison plus metadata, containment and safety review |
| Host activation | Does the selected host actually discover and execute it? | Version-bound observed host execution |
| Publication | May this exact artifact ship? | Separate current authorization and repository gates |

A tolerant client can ignore unknown manifest fields or extension namespaces,
ignore non-object extensions, and isolate a bad component without discarding
independent valid components. Invalid MCP disables MCP, not valid Skills; an
unsupported transport or runtime failure remains scoped to the affected server.
A missing, unsupported, unreadable or fatally invalid manifest rejects loading.
Fixed portable locations are root `plugin.json`, optional immediate `skills/*/SKILL.md`
and optional root `mcp.json`; inline components do not override them.

Strict document comparison is different: the recorded manifest schema requires
`$schema` and `name`, rejects additional fields, and leaves `version` optional.
A minimal manifest can therefore satisfy that schema while failing a useful
package authoring review for absent release metadata or installable components.
Unknown fields tolerated by a loader are not automatically acceptable authoring
output. Report each finding under its decision; never call a manual comparison
an observed validator result. There is no current plugin-creator validator.

## MCP migration and selection

Portable root `mcp.json` uses canonical `$schema`, `mcpServers` and explicit closed
`stdio`, `streamable-http` or `sse` variants. Keep secrets out of env/headers and
review path containment separately from JSON shape.

Goose's recorded loader defaults to `.mcp.json`, or uses inline/path
`plugin.json.mcpServers`. It does not auto-discover `mcp.json`. Explicitly selecting
a stdio-only `./mcp.json` can work because unknown `type`/`$schema` fields are
ignored; remote entries lack required `command` and have no transport mapping.

Co-shipped portable and host documents are permitted only with one governed Goose
activation path: default `.mcp.json`, or one approved exclusive path selection.
Block ambiguous duplicates such as non-exclusive `./mcp.json` beside `.mcp.json`;
do not merge, invent precedence or change selected paths without approval.
Host-only selection fields are not portable manifest fields.

## Hooks and custom agents

Native Goose hooks remain `hooks/hooks.json`, host-specific and outside portable
core. Preserve their activation when migrating; do not replace them with the
unloaded distributor adapter envelope. See [target compatibility](goose-target-compatibility.md)
before selecting events. Adapter structural findings are not activation proof;
multiple layouts block pending explicit reviewed selection.

A standalone custom agent is not a portable Plugin component. Route separately
requested agents to agent-creator and verify their host installation scope rather
than adding a portable `agents/` promise.

## Preservation and proof

Inventory source components as portable, adapt, replace or unsupported. Write to
a separate approved destination and retain originals and unmapped content unless
deletion is explicitly authorized. Archive contents, handler tests, source review,
evaluation results and host activation prove different things. None grants release
approval or automatically requires full-eval, typed receipts or obsolete tooling.

