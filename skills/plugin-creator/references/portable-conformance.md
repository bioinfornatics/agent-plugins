# Portable conformance and authoring review

Published Agent Plugins **1.0.0** is the sole active portable target. The recorded
1.1.0 Working Draft remains inactive. These are manual review distinctions, not
available creator CLI modes. Read the [recorded schemas](agent-plugins-1.0.0/README.md)
and [portable format](portable-plugin-format.md) before reviewing documents.

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

## Host boundary

Host activation is a separate conditional review, not a portable-format requirement.
When the target is Goose or existing Goose integration is being migrated/reviewed,
read [Goose integration](goose-plugin-format.md) before selecting/changing MCP or
hook activation. Preserve native sources and block ambiguous activation layouts;
route hook authoring to hook-creator. Host-only fields do not become portable
manifest fields. Standalone custom agents route separately to agent-creator.

## Preservation and proof

Inventory source components as portable, adapt, replace or unsupported. Write to
a separate approved destination and retain originals and unmapped content unless
deletion is explicitly authorized. Archive contents, handler tests, source review,
evaluation results and host activation prove different things. None grants release
approval or automatically requires full-eval, typed receipts or obsolete tooling.

