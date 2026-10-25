# Reference

Use this page to look up recorded versions, paths, command boundaries, and source documents. For a guided introduction, start with [Concepts](concepts.md) and [Getting started](getting-started.md).

## Recorded targets and requirements

| Item | Recorded value or rule |
|---|---|
| Distribution | 0.5.0 |
| Portable plugin target | Agent Plugins 1.0.0 |
| 1.1.0 snapshot | Working Draft, inactive; not a supported target |
| Verified host integration | Goose 1.47.0, not a claim about latest Goose |
| Git-installed creator runtime | Node.js 22+; compiled code and production dependencies included |
| Native release runtime | Platform-specific Bun executable; no Node.js requirement |
| Contributor tooling | Node.js 22+ and pinned Bun 1.3.12; routine CI uses Node.js 22.22.2 |
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

The executable creators expose `skill-creator`, `agent-creator`, `hook-creator`, and `plugin-creator`. Native archives inject these into each Skill's `scripts/` directory, with `.exe` on Windows. The Git distribution uses contained Node launchers; installation does not imply a shell PATH entry. Use the appropriate installed launcher or native executable, not internal source paths.

| Operation | Documented example |
|---|---|
| Skill format validation | `skill-creator validate /path/to/skill` |
| Skill authoring audit | `skill-creator audit /path/to/skill --format json` |
| Evaluation preview | `skill-creator full-eval /path/to/skill --workspace /path/to/workspace --dry-run` |
| Static evaluation review | `skill-creator review /path/to/iteration-workspace --static review.html` |
| Portable plugin loading checks | `plugin-creator validate /path/to/plugin --mode portable-load --format json` |
| Strict plugin authoring checks | `plugin-creator validate /path/to/plugin --mode strict-authoring --format json` |
| Agent definition checks | `agent-creator validate /path/to/agent.md --require-filename-match` |
| Hook checks | `hook-creator validate /path/to/plugin` |

For Skill Creator, Agent Creator, and Plugin Creator, recorded exit codes are **0** success, **1** failure, **2** invalid usage, **3** blocked. Hook Creator's README documents **0**, **1**, and **2**; do not assume all creators have identical command or exit-code contracts. Each command's `--help` is the lookup entrypoint. The CLI is not a substitute for a configured runner, model, grader, or actual human review.

## Native archive lookup

| Platform | Asset |
|---|---|
| Linux x86-64 | `agent-plugins-creators-linux-x64.tar.gz` |
| Linux ARM64 | `agent-plugins-creators-linux-arm64.tar.gz` |
| macOS Intel | `agent-plugins-creators-darwin-x64.tar.gz` |
| macOS Apple silicon | `agent-plugins-creators-darwin-arm64.tar.gz` |
| Windows x86-64 | `agent-plugins-creators-win32-x64.tar.gz` |

Verify the archive against `SHA256SUMS` from the same release **before extraction**. A native archive contains four complete creator Skill trees, not a claim that every repository Skill is included. Never combine archives or add old Node runtime payloads. See [RELEASES.md](https://github.com/bioinfornatics/agent-plugins/blob/develop/RELEASES.md) for checksum commands and PATH checks. Asset availability and publication are repository-specific; confirm the release you download.

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
