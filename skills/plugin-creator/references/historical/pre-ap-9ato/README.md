# Plugin Creator

Native Goose hooks use `hooks/hooks.json`. Read [Goose target compatibility](references/goose-target-compatibility.md) for exact source profiles, PreToolUseResult support and adapter activation limits before creating or validating hooks.

A dedicated creator for Goose/Open Plugins installed under `.agents/plugins/`.
It guides authoring, migration and manual source-format review of plugins containing skills,
hooks, MCP server declarations, or combinations of these components.

## Scope

| Asset | Location | Managed here? |
|---|---|---|
| Plugins | `.agents/plugins/`, `~/.agents/plugins/` | Yes |
| Standalone skills | `.agents/skills/`, `~/.agents/skills/` | No — use `agent-plugins:skill-creator` (or standalone `skill-creator`) |
| Standalone agents | `.agents/agents/`, `~/.agents/agents/` | No — use `agent-plugins:agent-creator` (or standalone `agent-creator`) |
| Repository guidance | `AGENTS.md` | No — instructions only |

Bundled skills under `<plugin>/skills/` are managed because they are plugin
components. This does not make the project a general-purpose skill creator.

## Component routing

- Bundled skills route to `agent-plugins:skill-creator` (or standalone `skill-creator`).
- Hooks and hook scripts route to `agent-plugins:hook-creator` (or standalone `hook-creator`).
- Standalone custom agents route to `agent-plugins:agent-creator` (or standalone `agent-creator`).
- Manifest, MCP, packaging, and whole-plugin validation stay in `agent-plugins:plugin-creator` (or standalone `plugin-creator`).

The current Goose custom-agent contract uses `.agents/agents`; do not package an
`agents/` directory unless the selected target format explicitly supports it.
For the audited Goose revision, plugin `agents/` is not auto-installed or
auto-discovered as custom agents.

## MCP: portable artifact versus Goose host

Portable Agent Plugins 1.0.0 defines root `mcp.json` with `$schema` and
`mcpServers`; this is the public artifact and supports the recorded closed
`stdio`, `streamable-http`, and `sse` variants. Current Goose does **not**
auto-discover that filename. Its plugin loader defaults to root `.mcp.json`,
accepts inline or path-based `plugin.json.mcpServers`, and can be pointed
explicitly to `./mcp.json`. Goose currently converts only stdio declarations (`command`, optional `args`,
`env`, and `cwd`) into extensions. Its serde model ignores unknown fields, so an
explicitly selected portable stdio-only `mcp.json` can load even with `type` and
top-level `$schema`. Portable `streamable-http` and `sse` entries fail because
`command` is required and this loader has no remote transport mapping. Validate
portability and Goose runtime compatibility separately.

## Current tooling boundary

These are authoring instructions, not a creator executable. The agent, hook and plugin creator CLIs are retired. The current distribution has no creator native executables and no creation, validation, packaging, grading or installation CLI.

The only distributed CLI entrypoint is `skills/skill-creator/scripts/skill-creator.mjs`, requiring Node.js **22.22.2 or newer**. It exposes `agent-plugin evaluation`, `agent-plugin history` and `agent-plugin inspect` through that launcher. Use the installed skill-creator root to resolve it; do not invoke application sources or retired launchers as a fallback. History and inspect are read-only; they do not grade results or generate review reports.

For evaluation, ask the user to choose supported Skill and/or Plugin source paths. Route to the available skill-creator instructions for the exact invocation and authorization. Standalone agents and hooks are not evaluation sources. Evaluating a Plugin is not a separate hook/agent benchmark, release approval or host-compatibility proof. Do not run a model campaign merely to finish authoring.

## Manual package review

Read [plugin format](references/goose-plugin-format.md), [portable conformance](references/portable-conformance.md) and [SKILL.md](SKILL.md). Author root `plugin.json` and only requested resources; compare canonical schema identifiers, metadata, paths and component documents manually with published Agent Plugins **1.0.0**. The 1.1.0 Working Draft is not an active supported contract.

Keep portable format, strict authoring policy, host activation, behavioral observations and publication authority distinct. Review component safety and executable closure with the relevant specialist. Never package secrets or claim release readiness from static findings.

## Historical material

Retained full-eval, CI orchestration, receipts, event-stream, diagnostics, research and release-verification references document retired workflows. They are historical evidence, not active commands, report generators or promised future capabilities. The current evaluator accepts Skill/Plugin sources; it does not provide typed agent/hook/MCP component grading or production approval.
