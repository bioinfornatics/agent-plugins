# Agent Creator

A dedicated creator for Goose custom-agent definitions stored under
`.agents/agents/`.

The source of truth is Goose's
`guides/context-engineering/custom-agents` documentation, vendored in
`references/custom-agents.md` for reproducible authoring and validation.

## Scope

| Asset | Location | Managed here? |
|---|---|---|
| Custom agents | `.agents/agents/`, `~/.agents/agents/` | Yes |
| Skills | `.agents/skills/`, `~/.agents/skills/` | No — use `skill-creator` |
| Plugins | `.agents/plugins/`, `~/.agents/plugins/` | No — use `plugin-creator` |
| Recipes | Goose recipe locations | No — use recipe tooling |

## Agent format

```markdown
---
name: code-reviewer
description: Reviews code for correctness, maintainability, and risk
---

You are a senior code reviewer...
```

Only `name` is required. `description` and `model` are optional. The
instruction body must be non-empty. These and the creator's name/body checks are
strict authoring policy; Goose runtime parsing can be more permissive.

## MCP boundary

Do not put `mcpServers`, `mcp`, or `extensions` in agent frontmatter, and do not
place `mcp.json` or `.mcp.json` under an agent directory. A custom agent may use
MCP extensions already enabled in its Goose session, but it cannot declare their
transport, command, environment, or credentials. Route MCP declaration,
transport, environment, packaging, and migration to
`agent-plugins:plugin-creator` (or standalone `plugin-creator`). Use recipe
tooling for a repeatable workflow that selects a known extension set. Never
silently manufacture plugin configuration from an Agent Creator request.

For the audited Goose revision, plugin `agents/` is a format marker only; custom
agents inside it are not installed or auto-discovered. Install custom agents in
a documented project, user, or compatibility agent path instead.

## Current tooling boundary

These are authoring instructions, not a creator executable. The agent, hook and plugin creator CLIs are retired. The current distribution has no creator native executables and no creation, validation, packaging, grading or installation CLI.

The only distributed CLI entrypoint is `skills/skill-creator/scripts/skill-creator.mjs`, requiring Node.js **22.22.2 or newer**. It exposes `agent-plugin evaluation`, `agent-plugin history` and `agent-plugin inspect` through that launcher. Use the installed skill-creator root to resolve it; do not invoke application sources or retired launchers as a fallback. History and inspect are read-only; they do not grade results or generate review reports.

For evaluation, ask the user to choose supported Skill and/or Plugin source paths. Route to the available skill-creator instructions for the exact invocation and authorization. Standalone agents and hooks are not evaluation sources. Evaluating a Plugin is not a separate hook/agent benchmark, release approval or host-compatibility proof. Do not run a model campaign merely to finish authoring.

## Manual creation and review

Read [custom-agent source](references/custom-agents.md) and [SKILL.md](SKILL.md). Write the role-focused Markdown definition in the explicitly requested project/user scope. Review YAML, required name, optional string fields, nonempty body, unsupported keys and overwrite consent manually. Discovery requires a separate observed host check; file review alone does not prove it.

## Historical material

Retained evaluation, privacy, telemetry and external-evidence references describe the retired creator generation. They are archival evidence, not current executable workflows or guarantees. Do not execute their commands or infer future availability.
