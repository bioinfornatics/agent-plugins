# Choose and use the creators

Choose the owner of your requested outcome before asking for implementation. A clear request names the **outcome, destination, constraints, and success criteria**.

## Select the smallest appropriate scope

| You want to… | Creator | Responsibility |
|---|---|---|
| Create, audit, improve, or evaluate one Skill | `agent-plugins:skill-creator` | Skill instructions, resources, and evaluation |
| Create or improve a delegated persona | `agent-plugins:agent-creator` | Goose custom-agent definitions |
| Add or test a lifecycle hook | `agent-plugins:hook-creator` | Hook behavior, scripts, and specialist checks |
| Assemble, migrate, validate, or package a plugin | `agent-plugins:plugin-creator` | Manifest, MCP, component coordination, integration, packaging |
| Design executable packaging | `agent-plugins:plugin-script-packaging` | Language-aware runtime and launcher guidance |

Use unqualified names such as `skill-creator` for standalone installations. Plugin Creator coordinates specialists; it does not replace their authoring logic. Script Packaging advises on executable design; Plugin Creator owns final whole-plugin validation and release approval.

## Create or improve one Skill

> Use `agent-plugins:skill-creator` to create `.agents/skills/api-review`. Review an OpenAPI diff for breaking changes and produce a concise Markdown report. Keep the Skill portable, add realistic evaluation cases, validate the result, and show the files and missing evidence.

**Check:** the output is a focused Skill directory, not an agent definition or a complete plugin. Confirm its activation conditions, limits, and supporting resource paths. For an existing Skill, preserve its baseline before requesting changes. See the [first Skill tutorial](../tutorials/first-skill.md) and [evaluation guide](evaluate.md).

## Create a custom agent

> Use `agent-plugins:agent-creator` to create a project-local code-reviewer agent focused on correctness, security, and regression tests. Explain its delegation boundaries, validate its definition, and show it before installation. Do not change enabled extensions or package a plugin.

**Check:** custom-agent output belongs under the documented `.agents/agents/` surface, not in a Skill directory. Evaluation should compare isolated delegated tasks with a neutral delegated baseline or an earlier agent version—not convert the agent into a Skill.

A custom agent may use MCP extensions already enabled in its Goose session. It cannot declare MCP transport, command, environment, or credentials in its own definition. Route that configuration to Plugin Creator. A bundled plugin `agents/` directory is not automatically installed or discovered as custom agents in the audited Goose revision. Consult the [Agent Creator guide](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/agent-creator/README.md) for the recorded contract rather than copying a frontmatter template here.

## Add a lifecycle hook safely

> Use `agent-plugins:hook-creator` to add a lifecycle hook to `./my-plugin` that records selected shell tool activity. Use a plugin-relative script, explain its side effects and failure behavior, validate the matcher and referenced files, and show the result before enabling it.

**Check:** begin with a valid plugin manifest; review what data is recorded and where it goes. Handler tests and host integration evidence are distinct. Blocking behavior, such as a PreToolUse policy, requires explicit failure-mode review.

The Hook Creator README contains a legacy root `hooks/hooks.json` layout. The current [Goose adapter reference](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/plugin-creator/references/goose-plugin-format.md) specifies namespaced extension output for new hooks. Do not copy the legacy layout into new output or combine both forms; have the creators validate migration explicitly. Hooks are not portable Agent Plugins 1.0.0 core behavior.

## Assemble a complete plugin

> Use `agent-plugins:plugin-creator` to create `./release-assistant` with a portable Skill for drafting release notes. Validate it in portable-load and strict-authoring modes, separate host-specific behavior, and show the package before making an archive.

**Check:** `plugin.json` is valid, bundled Skills are contained, MCP declarations are validated against both format and host, and integration evidence covers changed behavior. Packaging does not substitute for evaluation or approval.

Portable root `mcp.json` and Goose MCP loading differ. Do not guess precedence or remote transport support; use the [Plugin Creator guide](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/plugin-creator/README.md) and the recorded adapter checks.

## Package executable resources

> Use `agent-plugins:plugin-script-packaging` to plan a contained TypeScript CLI for this Skill, including the Git-installation runtime and native-release boundary. Explain dependencies and verification before changing launchers. Leave final plugin validation and release approval to Plugin Creator.

TypeScript is the default guidance branch; Rust and Python have conditional branches. This is not a blanket promise of bundled runtimes for every language or host. Read the [Script Packaging guide](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/plugin-script-packaging/README.md).

## Before accepting the result

Ask for changed files, exact validation outcomes, execution evidence, unresolved risks, and a next action. Never include secrets or silently enable executable behavior. If a capability or review is unavailable, keep it blocked rather than treating static checks as a behavioral pass.

**Next:** [Evaluate and improve](evaluate.md) or [Reference](../reference.md).
