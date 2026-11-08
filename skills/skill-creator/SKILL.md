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
| Evaluate Skills, Plugins or a combined profile | [Evaluation](references/evaluate-workflow.md) | Graded comparison, verified export and new HTML report; partial stages only when requested |
| Find or inspect retained campaigns; resume one | [Retained campaigns](references/retained-campaigns.md) | Read-only evidence summary or explicitly authorized continuation |
| Grade, regrade or export retained attempts | [Evaluation-to-export](references/evaluate-workflow.md) | Explicit attempt/grade selections; prior evidence preserved |
| Generate or review an exported report | [Report review](references/review-viewer.md) | New HTML and separately disclosed browser/disclosure checks |

## Own the evaluation outcome

An ordinary request to evaluate Skills or Plugins means the complete
**collect → prepare → evaluate → grade → export → generate `review.html`** journey.
Follow [evaluation-to-report](references/evaluate-workflow.md) without requiring the
user to know internal commands. Resolve missing scope, writable destinations and
candidate-plus-grading execution authority in one upfront checkpoint when needed.
Reuse sufficient current authorization; do not ask for approval again at grading,
export or HTML stage boundaries within that frozen scope. Progress updates are
informational, not questions asking the user to unlock the next step.

Honor explicit partial requests: prepare/dry-run only, trials only, inspection,
grading only, export only or report only. Never turn read-only inspection or
report generation into new model calls. Ask only for a decision-blocking input,
changed scope, ambiguous retained selections or new execution/retry authority.
A blocked stage does not erase completed evidence: continue independent authorized
work and deliver a clearly incomplete result when the full report cannot be made.
Report generation does not authorize sharing or imply acceptance.

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

## Monitor long-running commands

For evaluation (including resume), grading and regrading, keep heartbeat enabled
by default and monitor stderr using the tool's available streaming or process-wait
capability. Recognize `[agent-plugin] <operation>: active; elapsed <seconds>s`
(first tick after 10 seconds); stdout remains the command result, not progress.
Follow [heartbeat detection and waiting](references/evaluate-workflow.md#monitor-heartbeat-and-wait-for-the-same-command)
before launching these commands. A heartbeat is not model-progress or quality proof;
missing ticks alone never authorize interruption, retries or another paid launch.

## Deliver evidence, not promises

The selected workflow ends with changed paths or read-only findings, actual commands
and outcomes, unresolved inputs/proof and the next useful action. Failures, unavailable
outcomes and uncertainty remain visible. An authorized concrete correction can be
retried once; repeated failure stops with the blocker, not weakened criteria or scope.
No automatic paid retries, favorable-grade selection or fabricated scores are allowed.

Only current linked workflows are active. No historical
import, legacy receipts, description optimizer, live report server, packaging CLI or
standalone native creator executable is supplied. Report generation uses an explicit
export and the contained Node helper; it embeds private outputs and does not redact
secrets automatically. Browser verification and acceptance require their own evidence.

## Current host baseline

Use current stable host releases and official documentation for ordinary requests.
Historical targets are handled only when explicitly requested; version-specific evidence
belongs in compatibility matrices, not alternate everyday workflows. Record the running
host version as provenance and do not claim untested host support.
