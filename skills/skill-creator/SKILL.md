---
name: skill-creator
description: Authors and improves Agent Skills and compares Skill or Plugin profiles. Use when writing or reviewing SKILL.md, tuning activation instructions, preparing evaluation scenarios, or running and inspecting comparative evaluations.
---

# Skill Creator

## Select the next action

| Request | Action | Stop condition |
|---|---|---|
| Create or improve | Read [authoring checklist](references/authoring.md) and relevant [authoring patterns](references/skill-authoring-best-practices.md); write the scoped Skill and scenarios | Deliver files and static findings; evaluation is not implicit |
| Audit only | Inspect metadata, instructions, links, resource containment and requested behavior | Report findings; do not rewrite or launch models |
| Evaluate existing Skills or Plugins | Use the comparative CLI below with supplied suites | Report observed evidence and missingness; do not redesign first |
| Inspect retained results | Use read-only `history` or `inspect` | Report stored status and evidence locations, not invented scores |
| Create and evaluate | Finish authoring, freeze the candidate, then evaluate only under explicit execution authority | Deliver authoring and execution outcomes separately |

For rule-rich domains, conditionally read [domain coverage](references/domain-coverage.md).
Keep metadata and instructions English, descriptions concise and third-person, and
`SKILL.md` at most 500 lines. Scope standalone authoring to `.agents/skills`;
repository instructions belong in `AGENTS.md`. Review format and links directly:
there is no bundled validation or packaging command in this runtime.

## Runtime and supported commands

The existing `scripts/skill-creator.mjs` path now launches **agent-plugin**, not
the retired creator CLI. Use Node.js **>=22.22.2** and the whole contained Skill
directory; no end-user build or dependency installation is required. Resolve
`<skill-root>` to this loaded Skill's directory, not the candidate being evaluated.

```bash
node <skill-root>/scripts/skill-creator.mjs --help
node <skill-root>/scripts/skill-creator.mjs evaluation --skills /path/to/skill --dry-run
node <skill-root>/scripts/skill-creator.mjs evaluation --skills /path/to/skill --plugin /path/to/plugin --dry-run
node <skill-root>/scripts/skill-creator.mjs evaluation --skills /path/to/skill --model <model>
node <skill-root>/scripts/skill-creator.mjs history --json
node <skill-root>/scripts/skill-creator.mjs inspect <campaign-id> --json
node <skill-root>/scripts/skill-creator.mjs evaluation --resume <campaign-id>
```

Read [current command contract](README.md#command-contract) for options and defaults.
A normal evaluation executes bounded parallel Goose trials, comparing the composed
profile with its absence, in private HOME/XDG directories; these are **not an OS
sandbox**. Dry-run validates and prints the matrix without host calls. Registry
and campaign-isolated evidence are stored durably; history/inspect are read-only.
Model execution and native host compatibility require evidence, not a green mock.

## Suite and profile contract

- Discover a Skill suite silently and exactly at `evals/evals.json`. Missing cases
  are an input gap; author them only when authorized. Do not substitute historical
  suite formats, arbitrary eval-set paths or a custom harness.
- `--skills <paths...>` and `--plugin <paths...>` are repeatable and combinable.
  Compose one profile; deduplicate canonical roots and Skills already in a Plugin.
  `--profile-name` is optional; `--plugin` has no plural alias.
- Plugin discovery uses immediate `skills/*/SKILL.md` children. Skip missing child
  suites; fail if all suites are absent or any present suite is malformed. No
  root suite is required. Namespace scenario IDs by Skill directory.
- Every child scenario receives the **whole composed profile**, not just its source
  child. Source provenance never becomes an installation selector.
- Resume uses the frozen stored plan without rereading selected sources. Only
  `--registry` and explicit `--retry-uncertain` may accompany the campaign ID;
  no selectors, dry-run or parameter overrides. Retry permits new attempts for
  uncertain trials, never bypasses corruption checks or overwrites prior attempts.
- Read-only history filters by exact profile identity, not label. Inspection reports
  evidence presence, not hash verification or quality acceptance.

## Execution authority and evidence

Evaluate only on request or under an approved acceptance protocol. Before model
execution, freeze sources, fixtures, criteria, permitted actions, repetitions,
time limits and stopping rule. State the decision, distinct risks and cheapest valid
oracles. Disclose unknown prices: there is **no monetary budget cap** option.
Obtain authority for paid execution and any expansion; no automatic paid retries.
Prefer deterministic checks for deterministic properties. Preserve failures,
missing evidence and uncertainty; task self-reports are not independent proof.

Authoring does not authorize installation, credentials or publication. Preserve
existing files and evidence. On an error, apply one concrete authorized correction
and retry once, or report the exact blocker. Do not weaken criteria or expand scope.
Report files, actual commands, outcomes, missing proof and the next action.

## Migration boundary

The 0.6.0 candidate retires the old executable commands. No validation, packaging,
grading, scoring, HTML report, historical import, description-optimization command
or standalone native creator executable is supplied. Retained legacy workflow and
CLI references are historical, not active routing or executable instructions.
Do not invoke their commands or promise their artifacts.

The plugin retains five Skills but only this Skill has an executable runtime.
Agent, hook, whole-plugin and script-packaging authoring remain separate instruction
roles. Their old CLI references are migration-pending; disclose this before using
those instructions, and do not fabricate a replacement command or compatibility.
Goose is the verified reference host for plugin installation; that does not prove
native profile activation or model compatibility for every evaluation configuration.
