[![Servier Powered](https://raw.githubusercontent.com/servierhub/.github/main/badges/powered.svg)](https://servier.com/en/)

# Agent Plugins

Reusable authoring instructions and comparative Skill/Plugin evaluation.

**0.6.0 candidate — not published.** This document describes the new candidate,
not a claim that the current remote `main` or an existing installation contains it.
Goose is the verified reference host for plugin installation; other hosts and native
model/profile compatibility require separate evidence.

## Distribution contract

- Five Skills remain: `skill-creator`, `agent-creator`, `hook-creator`,
  `plugin-creator`, and `plugin-script-packaging`.
- Only `skill-creator` contains an executable runtime. Its existing
  `scripts/skill-creator.mjs` launches **agent-plugin** with `evaluation`, `history`
  and `inspect` commands, using **Node.js >=22.22.2**.
- The other Skills retain authoring instructions, but their old CLI references are
  **migration-pending**. They do not have bundled creator executables. Do not treat
  those references as working commands.
- Old validation, packaging, grading, score, HTML-report and historical-import
  commands are retired. No standalone native creator executable is provided.

## Installation channel

For the published Git-backed distribution, Goose supports:

```bash
goose plugin install https://github.com/bioinfornatics/agent-plugins.git
# Optional auto-update installation instead:
goose plugin install --auto-update https://github.com/bioinfornatics/agent-plugins.git
# Update an already installed Git-backed plugin:
goose plugin update agent-plugins
```

These commands consume the remote distribution; they do **not** publish or select
this unpublished candidate. Install trusted sources only. Goose imports namespaced
Skills such as `agent-plugins:skill-creator`. Manually copied plugins are discovered
but are not managed by the Git-backed update command.

A complete Git distribution needs no build, dependency installation, Bun or runtime
download. Retain the whole Skill directory when copying a standalone Skill, and
follow the host's documented discovery rules. A missing runtime is a distribution
defect, not an invitation to repair it with `npm install`.

## Author a Skill

> Use `agent-plugins:skill-creator` to write `.agents/skills/api-review` for reviewing
> OpenAPI changes. Keep metadata and instructions portable, add realistic scenarios,
> review the files, and report what remains unverified. Do not launch models.

Authoring and static review are instruction-driven; no bundled validation or
packaging CLI is promised. Custom agent, hook, plugin and script-packaging authoring
are separate Skill roles, subject to the migration warning above.

## Compare and inspect

Resolve `<skill-root>` to the installed `skill-creator` directory:

```bash
node <skill-root>/scripts/skill-creator.mjs evaluation --skills /path/to/skill --dry-run
node <skill-root>/scripts/skill-creator.mjs evaluation --skills /path/to/skill --plugin /path/to/plugin --dry-run
# Executes model trials; obtain explicit authority first:
node <skill-root>/scripts/skill-creator.mjs evaluation --skills /path/to/skill --model <model>
node <skill-root>/scripts/skill-creator.mjs history --json
node <skill-root>/scripts/skill-creator.mjs inspect <campaign-id> --json
node <skill-root>/scripts/skill-creator.mjs evaluation --resume <campaign-id>
```

Discover suites exactly at Skill `evals/evals.json`. Plugins use immediate
`skills/*/SKILL.md` children and their suites: skip missing suites, fail if all
are absent or any present suite is malformed. Repeated/combinable selectors form
one deduplicated profile; every scenario compares that **whole profile** with its
absence, not merely the scenario's source child.

Dry-run prepares a validated matrix without host calls. Normal execution stores
SQLite records and campaign-isolated evidence from bounded parallel Goose trials
in private HOME/XDG, which is not an OS sandbox. Defaults: 3 repetitions, 3 workers,
50 maximum turns, timeout 0 (disabled). There is no monetary budget cap. Model
compatibility and native activation remain unverified beyond explicitly recorded
evidence. History and inspect are read-only; they do not grade or verify evidence
hashes. Resume uses the frozen plan, with no selectors or parameter overrides;
`--retry-uncertain` explicitly permits new attempts without bypassing integrity.

See [Skill Creator command contract](skills/skill-creator/README.md#command-contract)
for supported parameters. Repository regression suites are development-only, not
installed user evaluation inputs. Missing evidence is unavailable, never a pass.

## Learn more

- [Goose Plugins](https://goose-docs.ai/docs/guides/context-engineering/plugins)
- [Agent Skills](https://agentskills.io/specification)
- [Contribution guide](https://github.com/bioinfornatics/agent-plugins/blob/develop/CONTRIBUTING.md)
- [Manifest](plugin.json) · [License](LICENSE)

`main` is generated installation material, not an authoring branch. Publication is
separate from source changes, local projection and verification.
