---
name: agent-creator
description: Creates and reviews Goose custom-agent definitions. Use for reusable personas, delegated roles or .agents/agents, not Skills, hooks or plugin packaging.
---

# Agent Creator

## Current tooling boundary

These are authoring instructions, not a creator executable. The agent, hook and plugin creator CLIs are retired. The current distribution has no creator native executables and no creation, validation, packaging, grading or installation CLI.

The only distributed CLI entrypoint is `skills/skill-creator/scripts/skill-creator.mjs`, requiring Node.js **22.22.2 or newer**. It exposes `agent-plugin evaluation`, `agent-plugin history` and `agent-plugin inspect` through that launcher. Use the installed skill-creator root to resolve it; do not invoke application sources or retired launchers as a fallback. History and inspect are read-only; they do not grade results or generate review reports.

For evaluation, ask the user to choose supported Skill and/or Plugin source paths. Route to the available skill-creator instructions for the exact invocation and authorization. Standalone agents and hooks are not evaluation sources. Evaluating a Plugin is not a separate hook/agent benchmark, release approval or host-compatibility proof. Do not run a model campaign merely to finish authoring.

## Route only the requested work

On Goose, load an available specialist with `load_skill(name: "agent-plugins:skill-creator")` for Skill authoring, audit, improvement or evaluation. For a standalone installation, use `load_skill(name: "skill-creator")` only if available. Apply the same installed-name rule to other specialists below. These are host tool calls, not shell commands or portable metadata. Reuse available guidance; never reload this Skill recursively. On other hosts use a verified loading mechanism. If loading is unavailable, read available instructions directly and disclose that limitation; if instructions or execution capability are missing, report the affected blocker. Never guess a tool or force candidate activation in natural-activation tests.

Use this Skill for reusable roles, expertise, behavior and optional model preference. Route whole-plugin/MCP declaration, transport, environment or migration to `agent-plugins:plugin-creator`; repeatable steps, extension selection, parameters or scheduling to verified recipe tooling. Do not persist an agent for one ad-hoc delegated task unless requested.

## Select and execute

| Request | Next action | Stop condition |
|---|---|---|
| Create/modify agent | Read [custom-agent source](references/custom-agents.md); write the requested role and review its format manually | Deliver definition, source-review findings and usage limits |
| Validate/audit | Manually compare metadata, body and scope with the source; inspect requested policy boundaries | Deliver findings; do not author or install first |
| Evaluate/compare | Explain the standalone-agent source limitation; ask whether the user instead wants a supported Skill/Plugin evaluated | Do not relabel an agent as a Skill or claim paired agent results |
| Install | Consult the recorded source for destination/discovery; perform only explicitly authorized file placement | State location and whether discovery was observed; no creator install command |
| Migrate | Read custom-agent source; map only supported role metadata | Preserve original unless removal authorized; identify unmapped configuration |

## Authoring and installation guards

- Create project `<project>/.agents/agents/<name>.md` or explicitly requested user `~/.agents/agents/<name>.md`. Keep generated definitions in `.agents/agents`, not Skills, plugins or recipes.
- Support only `name` (required), `description` and `model` (optional strings). Use a meaningful role-focused body: objective, priorities, boundaries, evidence and useful output conventions. Keep task-specific inputs and full workflows out; do not duplicate AGENTS.md or Skill content.
- Never add MCP/tool/permission/extension/hook fields or `mcp.json`/`.mcp.json` to an agent directory. Session-enabled MCP can be used but is not declared by the agent file.
- Manually review YAML, unique non-empty name, `.md` extension, optional string types, non-empty body and absence of placeholders/unsupported keys. Closed-field, kebab-case and length checks are creator policy, not proof Goose rejects every violation.
- Refuse overwrites unless explicitly authorized. Test discovery in a new Goose session when feasible; loading adds context, delegation executes in isolation. Do not claim discovery from validation.
- For explicit bundled-agent requests, route to plugin-creator and require verified host/format installation support before generating a bundled component. Recorded Goose discovers project/user/compatibility paths, not plugin `agents/`; normal agent work needs no plugin scaffold.
- Before changing the public format contract, compare the vendored source with current Goose documentation/implementation; follow [snapshot refresh](references/UPSTREAM.md). Do not guess unsupported fields.

## Execution limits

- Execute only the requested branch; ask only for decisions blocking it. Preserve existing work and evidence.
- Review source format manually; identify the inspected files, findings and unverified behavior. Do not claim an automated validator, grading result, report generator or production approval.
- Read linked detail only for the applicable action. Historical command workflows are not current tools; do not revive their commands or imply they are pending features.
- Authoring does not authorize installation, credential changes, publication or paid campaigns. Any requested host operation needs current source-backed instructions and separate authority.
- On an error, report the exact blocker; do not weaken criteria or silently expand scope. Static conformance is not behavioral effectiveness or host compatibility.
