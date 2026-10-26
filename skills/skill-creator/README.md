# Skill Creator

A vendor-neutral fork of Anthropic's `skill-creator`, adapted to the open [Agent Skills](https://agentskills.io) format and the emerging `.agents/skills` interoperability convention used by Goose and other compatible agents.

## Two independent workflows

SKILL.md is a short intent router. Load only [creation](references/create-workflow.md)
or [evaluation](references/evaluate-workflow.md); specialized references load at
the selected workflow step that needs them. Do not preload the other workflow.

- **Create or improve:** write actionable instructions and the target resource tree, supply behavioral scenarios and relevant activation cases, validate the produced candidate, and deliver it. Evaluation execution is not implicit.
- **Evaluate:** run the existing scenarios, collect actual task evidence, check/grade outputs, aggregate results, generate and inspect HTML, then report. Do not start with creation, audit, environment diagnostics or a rewrite.

When both are requested, create the candidate and scenarios first, then evaluate the frozen candidate. Missing scenarios are a concrete input gap, not permission to silently redesign an existing suite.

## What changed

- Skills live in `.agents/skills/` or `~/.agents/skills/` and retain the standard `SKILL.md` format.
- Repository instructions use `AGENTS.md` exclusively; no host-specific instruction or configuration files are created.
- Scope is restricted to skills under `.agents/skills/`; agent definitions and plugins belong to separate creators.
- Legacy subprocess trigger evaluation stages a Skill in a separate workspace, not a discovery sandbox; simple session-owned evaluation launches no models.
- Description optimization calls a configurable non-interactive agent CLI. Goose is the default.
- Viewer and report wording is vendor-neutral.

## Requirements

- A tagged native `skill-creator` executable, or Node.js 22+ for source development
- Goose on `PATH` for trigger evaluation and description optimization, unless another adapter is implemented

## Unified CLI

Use the unified entrypoint for validation, evaluation, aggregation, review, gate verification, and packaging. In a tagged release it is injected at `scripts/skill-creator`; source development and builds belong in `apps/skill-creator-cli/`, not this portable Skill directory.

```bash
skill-creator --help
skill-creator candidate /path/to/conversation --idea "plain-language idea"
skill-creator validate /path/to/skill
skill-creator audit /path/to/skill --format json
skill-creator design-evals /path/to/skill/evals/evals.json --skill-path /path/to/skill --format json
skill-creator freeze-evals /path/to/elicitation.json --draft -o /path/to/draft.json
skill-creator freeze-evals /path/to/completed-draft.json -o /path/to/frozen-plan.json
skill-creator analyze /path/to/workspace --skill-path /path/to/skill --format json
skill-creator full-eval /path/to/skill --workspace /path/to/workspace --dry-run
skill-creator full-eval /path/to/skill --workspace /path/to/workspace --execute --model <model>
skill-creator full-eval /path/to/skill --workspace /path/to/workspace --resume --human-review pass --tests-status pass
skill-creator trigger-eval --eval-set /path/to/trigger-evals.json --skill-path /path/to/skill
skill-creator aggregate /path/to/iteration-workspace
skill-creator review /path/to/iteration-workspace --static review.html
skill-creator evidence-loop /path/to/iteration-workspace --skill-path /path/to/skill --loop /path/to/separate-ledger
skill-creator usability-study --validate /path/to/session.json --format json
skill-creator usability-study /path/to/anonymous-sessions --format json
skill-creator screen-reader-acceptance --validate /path/to/anonymous-record.json --format json
skill-creator screen-reader-acceptance /path/to/anonymous-records --attestations /path/to/receipts --format json
skill-creator verify /path/to/skill --evaluation /path/to/iteration-workspace --tests-status pass --triggering-status pass --human-review pass
skill-creator package /path/to/skill ./dist-out
```

Every subcommand accepts `--help`, `--format text|json`, and `--quiet`. Exit codes are `0` for success, `1` for failure, `2` for invalid usage, and `3` when verification or execution is blocked. Use only the stable executable name in released workflows.

`validate` checks Agent Skills format conformance. `audit` checks repository authoring policy. `design-evals` checks scenario realism, discrimination, capabilities, atomic assertions, fixtures, and navigation expectations. `freeze-evals` derives five elicitation shells per material capability and freezes completed scenarios, deterministic assertions, qualitative review questions, execution context, edits, provenance, and a canonical content hash. `analyze` separates completed, unavailable, and blocked evidence, then maps failed assertions and navigation results to authoring patterns. Packaging blocks error-level audit findings and reports warnings.

`full-eval` uses the fixed phase order `validate → authoring-audit → evaluation-design → scaffold → paired-runs-and-grading → aggregate → static-review → receipt → post-evaluation-pattern-review → verify`. Its result always includes `status`, `phases`, and `next_actions`; `--format json` wraps that result in the unified CLI envelope. `--dry-run` is non-mutating. Normal reruns and `--resume` preserve existing artifacts and continue from the first unmet requirement. Without `--execute`, the orchestrator never invokes an LLM itself: exit code `3` identifies the exact paired output, grading, timing, test, or human-review evidence an agent or person must provide before rerunning. With `--execute`, one invocation advances through paired execution, grading, aggregation, static review, analysis, receipt, and gates. Select `--run-profile fast|standard|release` for exactly 1, 3, or 5 deterministic counterbalanced pairs per scenario; repeated profiles require a sufficient root `aggregate_budget`. When human review is the only decision left, exit code `3` is a non-failing `human-review` checkpoint with ordered `executable_actions`; resume starts at verification without rerunning completed phases. The source-bound `<workspace>/receipt.json` records hashes for the Skill, eval plan, execution evidence, benchmark JSON/Markdown, review, and analysis.

## Idea to candidate

The `candidate` command provides a durable conversational checkpoint from a plain-language idea through routing, bounded elicitation, contract preview, exact-hash contract confirmation, frozen scenario confirmation, and isolated launch. Re-run it with the same workspace in a later session to resume without mutating a read-only view. The default output is a short novice summary, with assumptions and risks always included in the final report; `--mode expert`, `--detail`, and repeatable `--override path=value` expose supported contract controls. Unsupported budget overrides fail explicitly.

Only `--fake` execution is bundled. It writes beneath the realpath-contained conversation workspace, performs no production mutation, reports generation as `simulated`, and reports validation and evaluation as `not-run`. Use it to test the flow, not to approve a candidate.

## Validate and package

```bash
skill-creator validate "$(realpath /path/to/skill)"
skill-creator package /path/to/skill ./dist-out
```

## Evaluation: Why / What / How

**Why:** correct Skill selection and useful task output are different properties.
Scenario design maximizes **distinct risk coverage, not test count**: deterministic
checks for formats, links, calculations and observable state; blinded LLM judgment
for contextual decisions; a few representative operational journeys. Costly repeats
need an explicit confidence question, budget and stop rule. Permission, stale-proof,
missing-context, work-preservation and correction-stop boundaries stay visible.
See [scenario design and its research basis](references/evaluation-design.md).

| Mode | What it checks | Default input | Outputs |
|---|---|---|---|
| activation (default) | Should this request load the Skill? | `<skill>/eval.json`, array of `{query,should_trigger}` | run/status JSON, HTML; completed results.json |
| behavioral | Does task output satisfy criteria versus baseline? | `<skill>/evals/evals.json`, `{skill_name,evals:[{id,prompt,expected_output,files?,expectations?}]}` | paired outputs, blind grading packets, local benchmark/HTML; complete compatible benchmark |

**How:** `run-evaluation --skill-path <dir> [--mode behavioral] --format json`.
With an existing eval set, run this command directly: no preliminary Skill audit,
runtime smoke test, credential probe or scenario redesign. The command validates
its own inputs. Handle an observed error with a targeted authorized correction,
then one retry; otherwise preserve the workspace and report the blocker. Read
only the applicable mode instructions. Permission-sensitive effects still require
authority, and absent delegation blocks its dependent step without inventing runs.
The current session delegates pending candidates, not the script. Activation
imports observed load-tool events using `--observations <file>` on resume. Missing
native telemetry is unsupported, never a false activation decision. Behavioral
resumes generate `grading_requests`: delegate only their anonymous request JSON
to independent graders, then import `{request_id,judgments}` batches using
`--grading-results <file>`. Never expose expectations to candidates or variant
paths to graders. Store observed timing, never estimated tokens.

Resume with `--output <run-directory> --resume`; repeat overridden eval-set.
Activation defaults to `<skill>/eval_result/<date>-<UUID>`; behavioral to sibling
`<skill-name>-workspace/iteration-1`, with `eval-ID/configuration/run-N/outputs`.
Use `--iteration N` or a new output for later behavioral iterations.

Both modes produce safe static `review.html` even when evidence is incomplete.
Open the report and verify the displayed data. Missing telemetry or inconclusive
grades stay unavailable in local reports and block strict complete exports.
`complete` means artifact completion, not acceptance; no authenticated receipt,
provider proof, filesystem isolation or grading independence is inferred.
See [activation procedure](references/trigger-evaluation.md) and
[behavioral procedure](references/evaluation-workflow.md).

## Advanced behavioral evaluation

Trigger accuracy answers whether the host selects a Skill; behavioral evaluation
answers whether using it improves the output. For an explicit evaluation request,
the creator builds realistic cases and assertions, runs isolated
`with_skill` and `old_skill`/`without_skill` pairs, grades every run, aggregates
the benchmark, and generates an HTML review artifact. A complete receipt is
required before claiming that the Skill passed or improved.

```text
Load agent-plugins:skill-creator and evaluate /path/to/skill against its previous
version. Create scenarios and assertions, run the paired evaluation, grade and
aggregate it, then generate a static HTML review report.
```

If a required runner, model, grader, or review capability is unavailable, the
result is `evaluation: blocked`, with the missing capability and artifact named.

## Trigger evaluation

```bash
skill-creator trigger-eval \
  --eval-set /path/to/trigger-evals.json \
  --skill-path /path/to/skill \
  --model provider/model-id \
  --verbose
```

The eval set is a JSON array of objects with `query` and `should_trigger` fields. Output preserves the legacy result fields and additively includes versioned per-run outcomes, infrastructure-failure counts, confusion metrics, latency distributions, usage/cost availability, and telemetry coverage. See [the trigger evaluation reference](references/trigger-evaluation.md).

## Improve from evaluation evidence

```bash
skill-creator evidence-loop /path/to/iteration-workspace \
  --skill-path /path/to/skill \
  --loop /path/to/separate-ledger \
  --max-iterations 5
```

The separate ledger records proposed, challenged, approved, and measured revisions without mutating the source Skill implicitly. For trigger evaluation, use `--runner goose` or set `SKILL_CREATOR_RUNNER`; unsupported runner adapters fail explicitly.

## Portable paths and scope

| Asset | Project | User | Managed here? |
|---|---|---|---|
| Skills | `.agents/skills/` | `~/.agents/skills/` | Yes |
| Agents | `.agents/agents/` | `~/.agents/agents/` | No — use an agent creator |
| Plugins | `.agents/plugins/` | `~/.agents/plugins/` | No — use a plugin creator |
| Instructions | `AGENTS.md` | host-dependent | No — repository guidance only |

Only the skill directory and `SKILL.md` contract are covered by the Agent Skills specification. `.agents/skills` is an emerging installation convention. This repository intentionally does not define agent or plugin schemas.

## Governed usability study kit

`references/usability-study-kit.md` provides the consent script, facilitator protocol, cohort tasks, retention rules, and metric definitions. Session records are strict, anonymous, consent-required JSON validated against `assets/usability-study/session.schema.json`. Checked-in fixtures are explicitly synthetic validator data, never participant evidence. The deterministic analyzer requires at least five sessions and both developer and nonexpert cohorts before evaluating the 80% completion-without-correction threshold. It classifies findings and prints suggested P0/P1 `bd create` commands without executing them.

## Manual screen-reader acceptance kit

`references/screen-reader-acceptance-kit.md` defines the required NVDA/Windows and VoiceOver/Safari combinations and seven static/live tasks. Records bind the canonical protocol version and SHA-256, exact mode/task expectations, a shared report-build SHA-256, concrete semver-like AT/browser/OS versions, reviewer pseudocode, bounded structured evidence, privacy review, at-most-90-day retention, and severity-ranked findings. Unavailable combinations are documented but never pass. A separate qualified-reviewer trust policy allowlists Ed25519 public keys and actions; DSSE-like receipts bind the exact complete record and expire. The CLI creates unsigned signing requests and verifies receipts, but never handles private keys. The deterministic analyzer returns `PASS` only for complete non-synthetic manual evidence with current trusted signatures with all tasks passing and no P0/P1 findings; checked-in fixtures are explicitly non-evidence.

## Attribution and license

This fork derives from Anthropic's skill creator. See `LICENSE.txt` for the upstream license and attribution.
