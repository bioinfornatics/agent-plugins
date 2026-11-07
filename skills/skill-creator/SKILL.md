---
name: skill-creator
description: Authors, audits and improves Agent Skills and designs comparative Skill or Plugin evaluations. Activates for Skill instructions, discovery metadata, scenario design, campaign inspection, grading, export and evaluation report review.
---

# Skill Creator

## Select the user outcome

The agent selects only the requested workflow; a short natural request is enough.
It reads supplied inputs before asking decision-blocking questions. It does not
make users recite internal commands, safeguards or acceptance answers.

| User need | Workflow | Completion boundary |
|---|---|---|
| Author a Skill or turn an idea into one | [Authoring](references/create-workflow.md) | Candidate, useful scenarios and actual static checks |
| Audit an existing Skill | [Audit](references/audit-workflow.md) | Source-linked findings; no unsolicited rewrite |
| Improve a Skill or its activation | [Improvement](references/improvement.md) | Evidence-linked correction, preserved behavior and regression criteria |
| Design scenarios | [Scenario design](references/evaluation-design.md) | Natural requests, supplied inputs and independently checkable criteria |
| Evaluate Skills, Plugins or a combined profile | [Evaluation](references/evaluate-workflow.md) | Prepared matrix or authorized observed trials, according to the request |
| Find or inspect retained campaigns; resume one | [Retained campaigns](references/retained-campaigns.md) | Read-only evidence summary or explicitly authorized continuation |
| Grade, regrade or export retained attempts | [Evaluation-to-export](references/evaluate-workflow.md) | Explicit attempt/grade selections; prior evidence preserved |
| Generate or review an exported report | [Report review](references/review-viewer.md) | New HTML and separately disclosed browser/disclosure checks |

A combined author-and-evaluate request finishes authoring and freezes the candidate
before execution. Whole-plugin authoring, custom agents, hooks and executable
packaging belong to their respective creator roles, not this Skill's authoring
workflow. Skill/Plugin **evaluation** remains in scope here.

## Common limits before actions

The agent confirms the requested outcome, writable paths and execution authority.
Authoring or scenario design is not permission to launch models, install capabilities,
change credentials or publish. Audit and inspection remain read-only. It preserves
supplied work, sources and prior attempts; missing inputs block only dependent work.

Metadata/instructions remain English, descriptions concise and third-person, and
SKILL.md <=500 lines. Format validation, behavioral effectiveness and verified host
compatibility are distinct claims. Recorded format sources are not changed without
fresh upstream evidence. The agent prefers deterministic oracles for deterministic
properties and exact artifacts/tool observations over a task's self-report.

## Current executable boundary

`scripts/skill-creator.mjs` launches **agent-plugin**, not the retired creator CLI.
The loaded Skill root supplies the launcher; the candidate root supplies evaluation
inputs. The whole contained Skill and Node.js >=22.22.2 are required; installed users
need no app checkout, build, dependency installation or runtime download.

```bash
node <skill-root>/scripts/skill-creator.mjs --help
node <skill-root>/scripts/skill-creator.mjs validate /canonical/path/to/candidate
node <skill-root>/scripts/skill-creator.mjs evaluation --skills /path/to/skill --dry-run
node <skill-root>/scripts/skill-creator.mjs evaluation --plugin /path/to/plugin --dry-run
```

The agent uses the **configured default model** unless the user explicitly requests
an override. It omits `--model` by default; it does not infer a model from the session,
provider name or example. It records unknown effective model identity as unknown.
Goose is the default host; another host's selection is not compatibility proof.
Read [current options](README.md#command-contract) before choosing execution limits.
Defaults are repetitions 3, parallelism 3, max turns 50 and timeout 0 (disabled).
There is no monetary cap option; paid execution and expansion require authority.

Dry-run prepares without host calls. Normal evaluation compares one composed profile
with its absence in private HOME/XDG directories, **not an OS sandbox**. Suites are
found exactly at each Skill's `evals/evals.json`. Repeatable/combinable `--skills` and
`--plugin` deduplicate canonical roots and Skills included in Plugins. Plugin suites
come from immediate `skills/*/SKILL.md` children: missing suites are skipped, all
missing or any present malformed suite fails. No root Plugin suite is needed.
Every scenario receives the whole composed treatment, not only its provenance child;
IDs are namespaced by Skill directory. This is not a built-in old/current comparison.

## Deliver evidence, not promises

The selected workflow ends with changed paths or read-only findings, actual commands
and outcomes, unresolved inputs/proof and the next useful action. Failures, unavailable
outcomes and uncertainty remain visible. An authorized concrete correction can be
retried once; repeated failure stops with the blocker, not weakened criteria or scope.
No automatic paid retries, favorable-grade selection or fabricated scores are allowed.

Only current linked workflows are active. [Historical material](references/historical/README.md)
retains old schemas, fixtures and commands for provenance, not execution. No historical
import, legacy receipts, description optimizer, live report server, packaging CLI or
standalone native creator executable is supplied. Report generation uses an explicit
export and the contained Node helper; it embeds private outputs and does not redact
secrets automatically. Browser verification and acceptance require their own evidence.
