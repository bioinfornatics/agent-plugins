[![Servier Powered](https://raw.githubusercontent.com/servierhub/.github/main/badges/powered.svg)](https://servier.com/en/)

# Agent Plugins

**Turn a useful workflow into a reusable agent capability—and test whether it actually helps.**

Writing instructions is easy. Making them discoverable, portable, safe to distribute, and measurably useful is harder. Agent Plugins guides you from an idea to a validated Skill, custom agent, lifecycle hook, or complete plugin, with evidence to support improvements.

The portable core follows [Agent Skills](https://agentskills.io/specification) and [Agent Plugins](https://agent-plugins.org/) specifications: **runtime-agnostic by format**, with host-specific behavior clearly separated. [Goose](https://goose-docs.ai/), an open-source [Agentic AI Foundation](https://aaif.io/) project, is the verified reference host. Compatibility with other hosts depends on their implementation and is not claimed without testing.

[Quick start](#quick-start) · [Choose a creator](#choose-the-right-creator) · [Examples](#how-to-guides) · [Contribute](https://github.com/bioinfornatics/agent-plugins/blob/develop/CONTRIBUTING.md)

## What you can do

- **Create reusable capabilities:** turn a concrete need into focused instructions and only the supporting files it needs.
- **Avoid packaging mistakes:** validate metadata, references, manifests, safe paths, and runtime boundaries before sharing.
- **Measure usefulness:** use paired A/B runs on the same scenarios to compare a Skill with its previous version or with no Skill.
- **Improve from evidence:** inspect outputs, grading, timing, and regressions in a browser report instead of assuming a longer prompt is better.

Four creators cover authoring and validation; a fifth Skill helps package executable scripts.

| Status | Value |
|---|---|
| Distribution | `0.5.0` |
| Portable plugin target | Agent Plugins `1.0.0` |
| Verified host integration | Goose `1.47.0` |
| Git installation requirement | Node.js 22+; creator code and dependencies included |
| License | [CeCILL-C](LICENSE) |

## See it in action

Describe the outcome you want, not the file format you think you need:

> Use `agent-plugins:skill-creator` to create `.agents/skills/api-review`. It should review an OpenAPI diff for breaking changes and produce a concise Markdown report. Keep it portable, add realistic evaluation cases, validate the result, and show me the files and any missing evidence.

**What you get:** a focused `SKILL.md`, supporting resources where needed, and a validation result. Behavioral evaluation is reported separately: unavailable evidence is a blocker, not a pass.

Already have a Skill? Compare `with_skill` with `old_skill` or `without_skill` using the same cases. Evaluation can produce `benchmark.json`, `benchmark.md`, and a static HTML report such as `review.html`, so you can review outputs and grading side by side. Measured gains, regressions, and inconclusive results stay distinct.

## Quick start

### 1. Have a host and Node.js ready

Use Goose for the integration verified by this project, or a host that supports the relevant open format. For a Git installation, confirm **Node.js 22 or newer** is available:

```bash
node --version
```

You do **not** need to build the project, install npm dependencies, or install Bun to use the Git distribution. Each executable creator includes compiled code and production dependencies inside its own Skill directory.

### 2. Install the plugin

In a terminal:

```bash
goose plugin install https://github.com/bioinfornatics/agent-plugins.git
```

This installs the upstream production distribution from the generated `main` branch. Only install plugins you trust: instructions and executable resources can affect your local environment.

### 3. Confirm discovery

Run `goose skills list` and check the entries from this plugin: only the five creators listed below should appear, never fixture names such as `frontmatter-invalid` or `invoice-normalizer`.

Repository self-evaluation sets, conformance fixtures and synthetic study records are development-only and are not installed. Evaluation tooling, schemas, protocols and command-required golden journey inputs remain available to evaluate your own capabilities. For this project’s regression scenarios, use the [development checkout](https://github.com/bioinfornatics/agent-plugins/blob/develop/CONTRIBUTING.md).

Start a new Goose session and ask:

> Use `agent-plugins:skill-creator` to explain what information you need to create a Skill. Do not modify any files yet.

**Success:** Goose resolves the creator and explains the desired behavior, activation conditions, workflow, and evaluation needs.

### 4. Create your first Skill

From the project where you want to use it, ask:

> Use `agent-plugins:skill-creator` to create `.agents/skills/markdown-summary`. It should summarize one Markdown file into key decisions and open questions. Keep it simple and portable, validate it, and show me what was created and what still needs evaluation.

**Success:** `.agents/skills/markdown-summary/SKILL.md` exists, format validation is reported, and evaluation is either supported by evidence or explicitly blocked. Review the generated files before using them.

## Choose the right creator

| You want to… | Ask for | Output |
|---|---|---|
| Create, improve, or A/B evaluate one Skill | `agent-plugins:skill-creator` | Portable Agent Skill |
| Create or improve a custom agent | `agent-plugins:agent-creator` | Goose custom-agent definition |
| Create or validate a lifecycle hook | `agent-plugins:hook-creator` | Explicit Goose hook adapter |
| Create, validate, migrate, or package a complete plugin | `agent-plugins:plugin-creator` | Portable core with explicit host adapters |
| Package scripts for Git and native installations | `agent-plugins:plugin-script-packaging` | Contained runtime and executable packaging guidance |

For standalone installations, use the plain name, such as `skill-creator`. A useful request specifies **the outcome, destination, constraints, and success criteria**.

## Choose your path

- **New user:** follow the [quick start](#quick-start), then try one focused workflow.
- **Existing Skill author:** compare versions with the [evaluation example](#evaluate-and-improve-a-skill).
- **Plugin maintainer:** use `agent-plugins:plugin-creator` for package-level validation and release readiness.
- **Contributor:** read [CONTRIBUTING.md](https://github.com/bioinfornatics/agent-plugins/blob/develop/CONTRIBUTING.md) for source setup, builds, tests, and the branch lifecycle.

## How-to guides

### Create a complete plugin

> Use `agent-plugins:plugin-creator` to create `./release-assistant` with a portable Skill for drafting release notes. Validate it in portable-load and strict-authoring modes, separate any host-specific behavior, and show me the package before making an archive.

**Look for:** a valid `plugin.json`, independently contained components, and actionable validation diagnostics.

### Evaluate and improve a Skill

> Use `agent-plugins:skill-creator` to evaluate `.agents/skills/api-review` against its previous version on the same realistic scenarios. Preserve paired outputs, grade both variants using explicit evidence, generate the HTML review, identify regressions and trade-offs, and recommend only evidence-backed changes.

**Look for:** traceable comparisons, not a blanket claim of improvement. Format validation answers “does it conform?”; evaluation answers “does it help?” Missing execution, grading, timing, or human review must remain explicit.

### Add a lifecycle hook

> Use `agent-plugins:hook-creator` to add a safe lifecycle hook to `./my-plugin`. Use a plugin-relative script, explain its side effects, and validate the hook before enabling it.

**Look for:** an existing valid plugin manifest, contained script paths, and reviewed executable behavior. Hooks are host-specific, not part of the portable core.

## Installation and updates

### Enable automatic updates

Choose this instead of the manual-update installation above if you want Goose to check for updates automatically:

```bash
goose plugin install --auto-update https://github.com/bioinfornatics/agent-plugins.git
```

For a Git-backed installation, update on demand with:

```bash
goose plugin update agent-plugins
```

### Install just one Skill

If your host supports standalone Skills, copy the **whole Skill directory**, not only `SKILL.md`. For example, on Linux or macOS:

```bash
git clone https://github.com/bioinfornatics/agent-plugins.git
cd agent-plugins
mkdir -p ~/.agents/skills
cp -R skills/skill-creator ~/.agents/skills/skill-creator
```

Goose discovers global Skills in `~/.agents/skills/` and project Skills in `.agents/skills/`. Check other hosts’ documented discovery rules; there is no universal installation command.

### Prefer native executables?

Tagged releases provide platform-specific archives that do not require Node.js. Select the matching OS/architecture and verify `SHA256SUMS` **before extraction**. See [the release installation guide](https://github.com/bioinfornatics/agent-plugins/blob/develop/RELEASES.md) for filenames and commands. Goose’s Git installer does not automatically select native archives; manually copied installations are updated separately.

## Troubleshooting

| Problem | Next step |
|---|---|
| Creator not found | Start a new session. Use `agent-plugins:skill-creator` for a plugin install or `skill-creator` for a standalone install. |
| Git-installed creator will not launch | Check `node --version` and that the entire Skill directory, including `runtime/`, is present. |
| Installed runtime reports missing dependencies | Reinstall a complete distribution and report the defect; do not repair an installation with `npm install`. |
| Validation fails | Follow the diagnostic for the named file or field; do not bypass the authoring gate. |
| Evaluation is blocked | Supply the requested execution or review evidence, then resume. Blocked does not mean passed. |
| Native command is the wrong version | Check your PATH and archive architecture; do not mix native archives with old Node wrappers. |

Report reproducible defects in the [upstream issue tracker](https://github.com/bioinfornatics/agent-plugins/issues). The ServierHub fork does not maintain a separate issue queue.

## Formats, portability, and security

- **Skills** carry reusable instructions and resources; **plugins** package capabilities for distribution.
- The supported portable target is Agent Plugins **1.0.0**. Custom agents and hooks currently use explicitly identified Goose contracts.
- Review generated commands, file writes, credentials, and side effects before enabling executable behavior. Never package secrets.
- Validation is not a substitute for behavioral testing or human review. Missing evidence never becomes a positive result.

For details, see [portable conformance](skills/plugin-creator/references/portable-conformance.md) and the [Goose adapter reference](skills/plugin-creator/references/goose-plugin-format.md).

## Learn more and contribute

- **Component guides:** [Skill Creator](skills/skill-creator/README.md), [Agent Creator](skills/agent-creator/README.md), [Hook Creator](skills/hook-creator/README.md), [Plugin Creator](skills/plugin-creator/README.md), [Script Packaging](skills/plugin-script-packaging/README.md).
- **Development:** [CONTRIBUTING.md](https://github.com/bioinfornatics/agent-plugins/blob/develop/CONTRIBUTING.md) explains how source becomes a ready-to-install distribution. Feature PRs target `develop`; `main` is generated production, not a source merge.
- **Distribution:** [ServierHub fork](https://github.com/servierhub/agent-plugins). **Upstream source and issues:** [bioinfornatics/agent-plugins](https://github.com/bioinfornatics/agent-plugins). Publication status is repository-specific; the fork may carry its own presentation or release commits.
- **Host documentation:** [Goose Plugins](https://goose-docs.ai/docs/guides/context-engineering/plugins) and [Agent Skills](https://goose-docs.ai/docs/guides/context-engineering/using-skills).
- **License:** [CeCILL-C](LICENSE). **Manifest:** [plugin.json](plugin.json).
