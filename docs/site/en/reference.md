# Reference

Use this page to look up recorded versions, paths, command boundaries, and source documents. For a guided introduction, start with [Concepts](concepts.md) and [Getting started](getting-started.md).

## Recorded targets and requirements

| Item | Recorded value or rule |
|---|---|
| Distribution | 0.9.0 |
| Portable plugin target | Agent Plugins 1.0.0 |
| 1.1.0 snapshot | Working Draft, inactive; not a supported target |
| Observed host integration | Goose 1.57.0 (see compatibility matrix), not a claim about other versions |
| Git-installed skill-creator runtime | Node.js >=22.22.2; compiled code and production dependencies included |
| Contributor tooling | Node.js >=22.22.2 and npm; routine CI pins Node.js 26.13.0 LTS |
| License | [CeCILL-C](https://github.com/bioinfornatics/agent-plugins/blob/develop/LICENSE) |

Verification of Goose does not establish compatibility with another host. See the [recorded Goose plugin reference](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/plugin-creator/references/goose-plugin-format.md) for revision-specific details.

## Names and installation surfaces

| Surface | Project | User | Notes |
|---|---|---|---|
| Standalone Skills | `.agents/skills/` | `~/.agents/skills/` | Use a plain creator name |
| Goose custom agents | `.agents/agents/` | `~/.agents/agents/` | Separate from bundled plugin Skills |
| Plugins | `.agents/plugins/<name>/` | `~/.agents/plugins/<name>/` | Plugin Skills use qualified names |
| Repository instructions | `AGENTS.md` | Host-dependent | Guidance, not an installed plugin component |

Qualified creator names are `agent-plugins:skill-creator`, `agent-plugins:agent-creator`, `agent-plugins:hook-creator`, `agent-plugins:plugin-creator`, and `agent-plugins:plugin-script-packaging`. [Creator selection](how-to/creators.md) explains their scopes.

The portable Skill file contract centers on the Skill directory and `SKILL.md`; the `.agents/skills` paths are a discovery convention. Do not assume every host uses them.

## Portable plugin files and host boundary

| File or directory | Meaning |
|---|---|
| Root `plugin.json` | Required portable manifest |
| `skills/<name>/SKILL.md` | Optional immediate bundled Skill; resources remain inside that Skill |
| Root `mcp.json` | Optional portable MCP declaration with explicit transport |
| Namespaced Goose extension | Repository-defined host adapter, not portable execution semantics |
| Root `hooks/hooks.json` | Native Goose hook path for the recorded targets; not portable core |
| Bundled `agents/` | Not portable 1.0.0 custom-agent installation; not auto-discovered by audited Goose |

Portable MCP supports the recorded `stdio`, `streamable-http`, and `sse` variants. The audited Goose plugin loader defaults to `.mcp.json` and converts stdio declarations. Explicit selection of a portable stdio-only `./mcp.json` may work under the recorded contract; do not infer remote transport support or allow duplicate activation. Consult [portable conformance](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/plugin-creator/references/portable-conformance.md) before migration.

## Stable command entrypoints

The Git distribution supplies one contained Node.js launcher, `skills/skill-creator/scripts/skill-creator.mjs`, which runs the current `agent-plugin` CLI. Installation does not add a PATH entry; prefix commands with `node <skill-root>/scripts/skill-creator.mjs`. The former agent, hook and plugin creator executables, native archives and their validators are retired; those Skills are instructions only.

| Operation | Documented example |
|---|---|
| Skill format validation | `validate /path/to/skill` |
| Evaluation preview | `evaluation --skills /path/to/skill --dry-run` |
| Evaluation run | `evaluation --skills /path/to/skill` (or `--plugin /path/to/plugin`) |
| Campaign history and details | `history --json`; `inspect <campaign-id> --json` |
| Grading and export | `grading <campaign-id> --attempt <attempt-id>`; `export <campaign-id> --grading <grade-id>` |
| HTML review | `node <skill-root>/scripts/generate-report.mjs --workspace <campaign>/report/export` |

Each command's `--help` is the lookup entrypoint; the [command reference](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/skill-creator/references/command-contract.md) records options and defaults. The CLI is not a substitute for a configured runner, model, grader, or actual human review. Plugin manifests, agents and hooks are reviewed manually against their recorded format sources.

## Source documents and installable resources

These are recorded repository references, not freshly verified upstream host documentation:

- [User README](https://github.com/bioinfornatics/agent-plugins/blob/develop/README.md), [CONTRIBUTING.md](https://github.com/bioinfornatics/agent-plugins/blob/develop/CONTRIBUTING.md), and [branch migration policy](https://github.com/bioinfornatics/agent-plugins/blob/develop/docs/branch-migration.md).
- Creator guides: [Skill](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/skill-creator/README.md), [Agent](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/agent-creator/README.md), [Hook](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/hook-creator/README.md), [Plugin](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/plugin-creator/README.md), [Script Packaging](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/plugin-script-packaging/README.md).
- Vendored host snapshots: [Goose plugin format](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/plugin-creator/references/goose-plugin-format.md), [custom agents](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/agent-creator/references/custom-agents.md), [hooks](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/hook-creator/references/hooks.md).
- Installable distribution: [manifest on main](https://github.com/servierhub/agent-plugins/blob/main/plugin.json) and [Skills on main](https://github.com/servierhub/agent-plugins/tree/main/skills).
- Public specifications: [Agent Skills](https://agentskills.io/specification) and [Agent Plugins](https://agent-plugins.org/).
- Defects and development discussion: [personal upstream issues](https://github.com/bioinfornatics/agent-plugins/issues).

## Evidence and safety vocabulary

**Validated** means the applicable structural checks passed. **Evaluated** requires behavioral evidence. **Blocked** names an unmet prerequisite. **Inconclusive** means the available evidence does not resolve the claim. **Approved** requires the applicable authorization; passing tests alone does not authorize production.

No manifest sandboxes executable code. Keep resources contained, document external dependencies, and never distribute secrets. For a decision workflow, use [Evaluate and improve](how-to/evaluate.md).
