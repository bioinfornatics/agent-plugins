[![Servier Powered](https://raw.githubusercontent.com/servierhub/.github/main/badges/powered.svg)](https://servier.com/en/)

# Agent Plugins

> Development branch: source and build tooling live here. The default main branch is a generated, ready-to-use distribution. Feature PRs target development; never merge this branch into main. See [migration, CI and rollback policy](docs/branch-migration.md). Routine cleanup preserves committed runtimes and evaluation evidence.

Build, improve, validate, evaluate, and package agent capabilities without tying their portable core to one runtime.

This distribution provides four guided creators for [Agent Skills](https://agentskills.io/specification), custom agents, hooks, and complete [Agent Plugins](https://agent-plugins.org/). Its portable outputs follow open Agent Skills and Agent Plugins specifications and are **runtime-agnostic by format**. Runtime-specific outputs are isolated and labeled explicitly. The integration suite is tested with [Goose](https://block.github.io/goose/), an open-source [Agentic AI Foundation](https://aaif.io/) project. Compatibility with another host depends on that host implementing the relevant specification and has not been verified by this repository unless stated.

| Status | Value |
|---|---|
| Distribution | `0.5.0` |
| Portable plugin target | Agent Plugins `1.0.0` |
| Portable skill target | Agent Skills |
| Verified host integration | Goose `1.47.0` |
| Creator runtime | Git/source: bundled Node.js `22+` runtime (`node-bundled`); release archives: native Bun executables (`native-bun`) |
| License | [CeCILL-C](LICENSE) |

## What you can do

Turn a concrete need into an agent capability, then prove whether it helps:

- **Create** portable Agent Skills and complete plugins from guided requirements instead of hand-writing fragile package structures.
- **Apply good practices** for concise instructions, progressive disclosure, safe paths, portable manifests, and explicit host adapters.
- **Validate** schemas, structure, references, packaging, and host-specific behavior before distribution.
- **Evaluate performance with paired A/B runs**: compare `with_skill` against an `old_skill` or `without_skill` baseline on the same scenarios.
- **Inspect a visual report** that combines outputs, grading evidence, timing, benchmark summaries, regressions, and reviewer feedback.
- **Improve from evidence**: revise weak instructions, rerun the same cases, and compare iterations without claiming gains that were not measured.

The goal is not merely to generate files. It is to produce maintainable capabilities with traceable evidence from idea to release.

## See it in action

### Create a Skill with good practices

> Use `agent-plugins:skill-creator` to create `.agents/skills/api-review`. It should review an OpenAPI diff for breaking changes and produce a concise Markdown report. Keep the Skill portable, apply progressive disclosure, add realistic evaluation cases, validate every reference, and show the resulting files.

**Expected outcome:** a valid `SKILL.md`, only the supporting resources the workflow needs, and explicit validation or evaluation gaps.

### Create and validate a complete plugin

> Use `agent-plugins:plugin-creator` to create `./release-assistant` with a portable Skill for drafting release notes. Keep the portable core compliant with Agent Plugins 1.0.0, isolate any host-specific behavior, validate in portable-load and strict-authoring modes, and show the package before writing a release archive.

**Expected outcome:** a valid `plugin.json`, portable components in fixed locations, separate host adapters when required, and a reviewable validation result before packaging.

### A/B test a Skill and understand improvements

> Use `agent-plugins:skill-creator` to evaluate `.agents/skills/api-review` against its previous version. Run the same realistic scenarios with the current Skill and the old Skill, grade both variants using explicit evidence, aggregate the benchmark, generate the static HTML review, identify regressions and trade-offs, and recommend only evidence-backed improvements.

The evaluation workspace preserves paired `with_skill` and `old_skill`/`without_skill` outputs. It produces `benchmark.json`, `benchmark.md`, and an HTML review such as `review.html`. Open the HTML file in a browser to inspect outputs and grading side by side. The analysis should explain:

- which assertions improved, regressed, or remained inconclusive;
- whether quality gains trade off against time or token use;
- which instruction or example likely caused each difference;
- what to change next and which unchanged scenarios must be rerun.

A complete report does not guarantee improvement: results remain `pass`, `fail`, `blocked`, or `na`, and missing evidence never becomes a positive claim.

## Contents

- [What you can do](#what-you-can-do)
- [See it in action](#see-it-in-action)
- [Choose your path](#choose-your-path)
- [Choose the right creator](#choose-the-right-creator)
- [Quick start](#quick-start)
- [How-to guides](#how-to-guides)
- [Installation and updates](#installation-and-updates)
- [Standalone Bun release assets](#standalone-bun-release-assets)
- [Validation and evaluation](#validation-and-evaluation)
- [Troubleshooting](#troubleshooting)
- [Formats, portability, and security](#formats-portability-and-security)
- [Component reference](#component-reference)
- [Contributing](#contributing)
- [Project information](#project-information)

## Choose your path

- **Create a portable Skill:** start with [Create a Skill with good practices](#create-a-skill-with-good-practices), then install `skill-creator` through a compatible host or as a standalone Skill.
- **Measure whether a Skill helps:** use [A/B test a Skill](#ab-test-a-skill-and-understand-improvements) to compare paired outputs and inspect the visual report.
- **Build or migrate a plugin:** use `plugin-creator` for manifests, MCP, packaging, integration evaluation, and release decisions.
- **Create host-specific behavior:** use `agent-creator` or `hook-creator`; these outputs are explicitly labeled as Goose-specific today.
- **Contribute to this repository:** follow [Contributing](#contributing).

## Choose the right creator

| I want to… | Creator | Output portability |
|---|---|---|
| Create, improve, or A/B evaluate one Agent Skill | `agent-plugins:skill-creator` | Open Agent Skills format |
| Create or evaluate a custom agent | `agent-plugins:agent-creator` | Goose custom-agent format |
| Create or validate a lifecycle hook | `agent-plugins:hook-creator` | Goose extension in a plugin |
| Design and verify scripts packaged for source and native plugin installs | `agent-plugins:plugin-script-packaging` | Host-explicit runtime guidance |
| Create, migrate, validate, evaluate, or release a plugin | `agent-plugins:plugin-creator` | Portable core plus explicit host adapters |

Use the unqualified names—such as `skill-creator`—when a creator is installed standalone. A productive request names one deliverable, its destination, user outcome, constraints, and success criteria.

## Quick start

### 1. Check the requirements

A Git/source checkout is directly runnable with Node.js 22 or later: each `skills/<name>/` contains `scripts/<name>.mjs` plus its generated, dependency-complete `runtime/`. The root `plugin.json` declares this `node-bundled` mode; no dependency install is required. TypeScript authoring remains under `apps/<creator>-cli/`. Tagged release staging explicitly excludes the source launcher, runtime, and any `node_modules`, then injects one native executable at `skills/<name>/scripts/<name>` (`<name>.exe` on Windows), so an installed release does not require Node.js or `npm install`. To load the Skills through an agent, use a host that implements the relevant Agent Skills or Agent Plugins specification.

Host discovery and installation commands differ. This repository verifies the complete integration with Goose. Other hosts may load the portable outputs when they implement the corresponding specification, but this repository does not claim untested host compatibility.

### 2. Install the ServierHub distribution with the verified Goose integration

```bash
goose plugin install --auto-update https://github.com/servierhub/agent-plugins.git
```

Omit `--auto-update` if you want to approve updates manually.

### 3. Verify discovery without creating files

Start a new Goose session and ask:

> Use `agent-plugins:skill-creator` to explain, without modifying files, what you need from me to create an Agent Skill.

Success means Goose resolves the qualified creator and asks for or explains the target behavior, activation conditions, workflow, and evaluation needs. If it cannot resolve the creator, see [Troubleshooting](#troubleshooting).

### 4. Create a first portable Skill

> Use `agent-plugins:skill-creator` to create `.agents/skills/markdown-summary`. It should summarize one Markdown file into key decisions and open questions. Keep the Skill portable, validate it, and show me the files created and any evidence still required.

A successful run creates at least `.agents/skills/markdown-summary/SKILL.md`, validates its format, and reports either completed evaluation evidence or an explicit `evaluation: blocked` state. Additional references, scripts, or evaluations are created only when the behavior needs them.

## How-to guides

Each guide identifies the request and the evidence of success. Exact supporting files depend on the requested behavior.

### How to create a portable Skill

**Use when:** you want repeatable instructions that compatible agents can discover through the Agent Skills format.

**Prompt:**

> Use `agent-plugins:skill-creator` to create `.agents/skills/api-review`. It should review an OpenAPI diff for breaking changes and produce a concise Markdown report. Include realistic evaluations, validate the result, and report any blocked evidence.

**Success:** `SKILL.md` has valid frontmatter and focused instructions; its directory name matches the Skill name; any referenced files exist; validation passes; behavioral evidence is reported separately.

### How to improve an existing custom agent

**Use when:** a Goose custom agent already exists under `.agents/agents/` and needs evidence-backed improvement.

**Prompt:**

> Use `agent-plugins:agent-creator` to evaluate `.agents/agents/security-reviewer.md` against its current baseline, improve only evidence-backed weaknesses, and report the benchmark delta.

**Success:** the custom-agent definition validates, paired evidence remains traceable, and the report distinguishes measured improvement from unavailable or blocked evidence.

### How to add a safe Goose hook

**Use when:** a plugin needs Goose lifecycle behavior. Hooks execute commands and are not part of the portable core.

**Prompt:**

> Use `agent-plugins:hook-creator` to add a safe `PostToolUse` hook to `./my-plugin`. Invoke a plugin-relative script, keep persistent writes inside plugin data, validate the hook, and explain its side effects.

**Success:** the plugin already has a valid `plugin.json`; the hook uses the canonical namespaced extension; referenced scripts exist and remain inside the plugin; executable behavior has been reviewed.

### How to validate or release a plugin

**Use when:** you need a conformance decision, migration, package, or release—not just one component.

**Prompt:**

> Use `agent-plugins:plugin-creator` to validate `./my-plugin` in strict-authoring mode, fix actionable errors, run applicable evaluations, and prepare a release only if every required gate has evidence.

**Success:** portable and host-specific resources are classified separately; strict validation passes; requested behavioral evidence and archive checks exist; missing evidence blocks rather than weakens a release gate.

From a source checkout of this repository, build the app first, then invoke its generated entrypoint directly:

```bash
(cd apps/plugin-creator-cli && bun install --no-save && bun run build)
node apps/plugin-creator-cli/dist/scripts/cli.js validate <plugin-directory> --mode portable-load --format json
node apps/plugin-creator-cli/dist/scripts/cli.js validate <plugin-directory> --mode strict-authoring --format json
```

## Installation and updates

### Complete plugin with Goose—verified integration

```bash
goose plugin install --auto-update https://github.com/servierhub/agent-plugins.git
```

For an installation without automatic updates:

```bash
goose plugin install https://github.com/servierhub/agent-plugins.git
goose plugin update agent-plugins
```

Goose 1.47.0 provides `plugin install` and `plugin update`, but no plugin uninstall subcommand. Use the removal procedure documented by your installed host version rather than deleting unknown runtime state manually.

### Other compatible hosts

Use the host's documented Agent Skills or Agent Plugins installation mechanism. There is intentionally no invented universal command: the file formats are open, while discovery and lifecycle management belong to each host. A host respecting a specification can consume the corresponding portable surface, but support must be verified per host and per component. Qualified creator names are a host presentation detail and may differ.

### One standalone creator from a source checkout

Clone the ServierHub distribution, then copy the self-contained creator directory:

```bash
git clone https://github.com/servierhub/agent-plugins.git
cd agent-plugins
mkdir -p ~/.agents/skills
cp -R skills/skill-creator ~/.agents/skills/skill-creator
test -f ~/.agents/skills/skill-creator/SKILL.md
```

The `.agents/skills` location is an emerging interoperability convention used by Goose and other compatible agents; confirm discovery rules in your host.

## Standalone Bun release assets

Tagged GitHub releases also provide native, runtime-only creator executables for supported Linux, macOS, and Windows architectures. See [Bun release assets](RELEASES.md) for the exact OS/architecture filename mapping and SHA-256 verification commands. Always verify the selected archive against the release's `SHA256SUMS` before extraction. The same guide covers PATH and direct invocation, avoiding mixed archives, and removing legacy Node/dist wrappers.

## Validation and evaluation

Validation answers “does the artifact conform?” Evaluation answers “does it improve behavior?”

- **`portable-load`:** models what an Agent Plugins 1.0.0 loader accepts, ignores, or isolates.
- **`strict-authoring`:** adds semantic, operational, migration, and safety policy; this is the authoring default.
- **Release:** additionally requires applicable tests, behavioral receipts, archive identity, and human review.

JSON commands return a stable envelope. Exit codes are `0` for success, `1` for failure, `2` for invalid usage, and `3` when required execution or evidence is blocked. A blocked evaluation is not a passed evaluation and is not necessarily a format failure.

```text
scenarios → paired isolated runs → grading → benchmark → review → release gates
```

## Troubleshooting

| Symptom | What to check |
|---|---|
| A creator is not found | Start a new host session after installation; try the qualified name for a plugin install and the plain name for a standalone install. |
| Goose cannot start a creator | Confirm Goose has a configured model provider and the plugin installation completed without errors. |
| An old Node or `dist/` wrapper runs | Remove that legacy wrapper from `PATH`, then install the matching archive described in [RELEASES.md](RELEASES.md). |
| An installed release reports a missing dependency | Treat it as an incomplete package; do not repair it with `npm install`. Reinstall a complete release and report the defect. |
| Validation fails | Read the structured diagnostics and correct the referenced path or field; do not bypass strict-authoring errors. |
| Evaluation reports `blocked` | Supply the requested model run, grading, timing, test, or human-review evidence, then resume the workflow. |
| Portable and Goose behavior seem inconsistent | Check whether the resource is portable core, a Goose-specific adapter, or a legacy migration input. |

Report reproducible defects in the [upstream issue tracker](https://github.com/bioinfornatics/agent-plugins/issues); the ServierHub fork does not maintain a separate issue queue.

## Formats, portability, and security

### Portable core

The active target is the published Agent Plugins 1.0.0 format:

```text
my-plugin/
├── plugin.json          # required
├── skills/review/       # optional Agent Skills
│   └── SKILL.md
└── mcp.json             # optional portable MCP configuration
```

`plugin.json`, direct children of `skills/`, and root `mcp.json` form the portable package surface. The vendored Agent Plugins 1.1.0 snapshot is an inactive Working Draft for analysis, not a supported target.

### Explicit host adapters

Custom-agent definitions and hooks currently target Goose contracts. New hooks live under `plugin.json.extensions["io.github.bioinfornatics.agent-plugins.goose"]` and point to `extensions/io.github.bioinfornatics.agent-plugins.goose/hooks.json`. Root `hooks/hooks.json`, root `.mcp.json`, and inline `plugin.json.mcpServers` are legacy migration inputs, not portable alternatives.

Hooks are executable behavior. Review generated commands, paths, credentials, blocking semantics, and side effects before enabling them. Never package secrets.

See [portable conformance](skills/plugin-creator/references/portable-conformance.md) and the [Goose adapter reference](skills/plugin-creator/references/goose-plugin-format.md) for normative detail.

## Component reference

- [Shared capability contracts](contracts/capability-contract/SPECIFICATION.md)—portable capability, evaluation, result, and [host execution adapter](contracts/capability-contract/HOST_ADAPTER_SPECIFICATION.md) protocols.
- [Skill Creator](skills/skill-creator/README.md)—portable Agent Skills authoring and evaluation.
- [Plugin Creator](skills/plugin-creator/README.md)—portable package boundaries, validation, migration, and release.
- [Plugin Script Packaging](skills/plugin-script-packaging/README.md)—contained Node runtimes and native executable release projections.
- [Agent Creator](skills/agent-creator/README.md)—Goose custom-agent definitions.
- [Hook Creator](skills/hook-creator/README.md)—Goose lifecycle hooks and executable safety.

## Contributing

### Root developer commands

Run `make help` for the Bun facade over canonical package scripts. `make clean` (canonical: `bun run clean`) removes only the generated root paths `bin/`, `dist/`, `release-staging/`, `release-assets/`, and `.agents/plugins/`; it preserves `.agents/skills/` and all other `.agents/` content, and never follows symlinks. `make test` runs all checks; `make bundle` stages the current OS/architecture runtime plugin under `release-staging/`; `make release OUTPUT=/path` builds all targets pinned in `bun-release.json`, validates each stage, then emits archives and `SHA256SUMS`. Release requires the pinned Bun plus `tar`, `gzip`, `zip`, and `sha256sum`.

`make install-plugin` independently installs the validated full plugin staging tree and accepts `SOURCE=/staged/path`; it defaults exactly to the current-target stage and the project-local `.agents/plugins/agent-plugins` destination. For the local build-and-install journey, `make bundle-install-plugin` finishes a fresh `bundle` before installing its default stage, even with `-j`; it intentionally ignores `SOURCE`. Both plugin install paths accept `DEST=/explicit/path`, `DRY_RUN=1`, and `FORCE=1`. Normal Make output is concise and leaves stderr empty on success; add `VERBOSE=1` for live compiler diagnostics or `LOG=/safe/path` to retain detailed diagnostics (no log is created by default). Existing destinations are refused unless forced; symlinked destinations or ancestors are always refused. Direct scripts keep JSON output by default for automation, while Make explicitly selects human output.

These commands install a **full plugin** under `.agents/plugins`; they are not standalone Skill installers. A standalone `.skill` artifact belongs under `.agents/skills`, using the host-specific mechanism described above.

Contributor dependency installation is separate from end-user installation. Creator application source, tests, and build output live in `apps/<creator>-cli/`. Git distributions intentionally include compiled JavaScript and production dependencies inside each `skills/<name>/runtime/`, with a launcher in `skills/<name>/scripts/`. Native release archives replace that launcher and Node.js runtime payload with a platform-specific executable in `skills/<name>/scripts/`. Installed Skills must remain self-contained and must not depend on repository-level development tooling. From the repository root, these copy/paste-safe subshell commands preserve the working directory:

```bash
(cd contracts/capability-contract && bun install --no-save && bun run build && bun run test) # capability, evaluation-plan, result-state, and host-adapter contracts
for app in apps/*-creator-cli; do (cd "$app" && bun install --no-save && bun run build && bun run test) || exit; done
```

Release assembly is a separate root operation. It copies the configured portable entries, compiles the app entrypoints, and atomically publishes an immutable target tree under `release-staging/<os>-<arch>/`; do not edit that tree by hand. Bun must match version `1.3.12`, pinned in both `package.json` and `bun-release.json`. The package scripts intentionally retain their internal `node` and `node --test` runners; Bun is the package-script facade and release compiler, not a blanket runtime rewrite.

```bash
bun run stage:release -- --target=bun-linux-x64-baseline
bun run test:executables
bun run package:release -- /path/to/matrix-artifacts /path/to/release-assets
```

Verify the complete offline distribution from the repository root:

```bash
bun run prepare:offline
bun run test
bun run test:offline
```

## Project information

- Servier Open Source Hub distribution: <https://github.com/servierhub/agent-plugins>
- Upstream source repository: <https://github.com/bioinfornatics/agent-plugins>
- Agent Skills open specification: <https://agentskills.io/specification>
- Agent Plugins open specification: <https://agent-plugins.org/>
- Agentic AI Foundation: <https://aaif.io/>
- Goose documentation: <https://goose-docs.ai/>
- Distribution manifest: [`plugin.json`](plugin.json)
- License: [CeCILL-C](LICENSE)

Install this Servier distribution from `servierhub/agent-plugins`. It is a public fork of the upstream source repository and may carry Servier-specific presentation or release commits.
