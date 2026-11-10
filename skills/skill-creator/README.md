# Skill Creator

Authors and improves portable Agent Skills and runs comparative Skill/Plugin
evaluations. Authoring produces instructions and scenarios; it does not implicitly
launch a model. See [SKILL.md](SKILL.md) for routing and execution authority.

## Migration status

**0.6.1.** The existing `scripts/skill-creator.mjs` path
now serves the `agent-plugin` CLI from `apps/agent-plugin`. It is not the old
`skill-creator` command family. Node.js **>=22.22.2** is required. Copy the whole
Skill directory, including its contained runtime. No npm install, build, Bun or
runtime download is required for an installed Git distribution.

Old creator command families are retired. Current standalone Skill `validate`,
explicit `grading`/`regrading`/`judgments`, `export` and the contained Node HTML
helper are supported additions, not old-command aliases. Packaging, historical
import, description optimization and live report servers are not supplied. The intent routes in SKILL.md select the active authoring, audit, improvement,
scenario-design, retained-campaign and evaluation/report workflows. Other retained CLI
references are historical, not instructions to invoke old commands. No standalone native creator
executables are supplied by this candidate. Other plugin Skills own separate authoring responsibilities; consult their current
instructions and verified command support independently.

## Command contract

Read the contained [CLI command reference](references/command-contract.md#command-contract)
for commands, parameter defaults and required values.

Use the tool’s default values. Apply overrides only when explicitly requested by the user. Ask for required values that have no default.

## Default durable locations

See [default durable locations](references/command-contract.md#default-durable-locations)
in the same contained reference.

## Default evaluation experience

Ask “Evaluate this Skill/Plugin.” The Skill owns discovery and preparation,
With/Without trials, initial grading, explicit grade selection, export and `review.html`.
When needed, one upfront checkpoint resolves scope, model-call authority (including
grading), limits and required values without defaults. Export/report destinations
use tool defaults without a destination question; candidate preparation still
requires a destination with no default. It then continues without asking you
to trigger each stage. Explicit prepare-only, trials-only, inspection, grading,
export or report requests remain bounded. Failures and incomplete coverage are
disclosed; no automatic paid retries or sharing follow.

This is **Skill-level orchestration of separate supported commands**, not a new
single-command CLI pipeline. See [the complete workflow](references/evaluate-workflow.md).

## Grading, export and HTML review

Read [evaluation-to-report workflow](references/evaluate-workflow.md) for explicit
attempt/grade selection and grading authority, and [report workflow](references/review-viewer.md)
for the contained `scripts/generate-report.mjs` helper and browser checks.
`validate` checks standalone Skill format, not Plugin/agent/hook conformance.
Grading/regrading may call a paid model and append judgments; export is read-only
and requires explicit grades, never an inferred latest result. A quality-only
benchmark does not imply token, cost or time telemetry or calibrated quality.

The helper reads a complete explicit export and its contained
`assets/report-viewer.html` template; no app access, npm install, model, database
or network call is needed. Export `--output` defaults to the recorded validated
campaign’s `report/export`. Helper `--workspace` is required; `--output` defaults
to managed `report/review.html`, or exclusive sibling `review.html` for an external/legacy
export. Managed regeneration authenticates ownership, inventory and the HTML hash
receipt before staged replacement. The managed helper checks an exact directory tree,
current-UID ownership, directories 700 and files 600; unknown empty directories are
refused. External/legacy compatibility is intentionally broader. Precommit ordinary
failures preserve the prior view. Export commits at the successful staged-directory
-> export rename; the helper commits only after both HTML and receipt renames succeed.
Postcommit backup/stage/lock cleanup failure returns committed success with the exact
generic warning
`Report publication committed; cleanup residue requires operator inspection before regeneration.`
The CLI emits it on stderr; helper JSON may include optional `warnings`. Retained
residue blocks regeneration; no automatic stale repair, stale-lock takeover or crash
atomicity is supplied. Explicit outputs remain new/exclusive and outside protected roots. Export and HTML
are separate operations: export regeneration leaves old HTML unchanged until helper
regeneration. Evidence and grades remain immutable. See [report generation](references/review-viewer.md#generate).
Reports require explicit source names from the current export; re-export retained
grades for old workspaces without new model calls. Source skill replaces the duplicate
prompt block; supporting artifacts start collapsed and feedback stays in a
space-reserving dock with independent Compare fields.
All selected output bytes, including private logs, are
embedded: review disclosure before sharing. Feedback lasts only until reload;
Done downloads `feedback.json`, not a workspace write. Generator execution,
browser verification and model quality are separate evidence.

## Inputs and comparison

Skill discovery is exact at `evals/evals.json`. Plugin discovery checks immediate
`skills/*/SKILL.md` children: missing suites are skipped, all missing is an error,
and any present malformed suite is an error. No Plugin root suite is required.
Scenario IDs are namespaced by Skill directory. Author missing scenarios only
under explicit authority; historical formats are not interchangeable.

Selectors compose one profile, deduplicating canonical roots and Skills included
in Plugins. Every child scenario uses the whole composed profile as treatment,
not its provenance child alone. Normal execution compares profile presence and
absence with bounded parallel Goose trials in private HOME/XDG. This isolation
is not an OS sandbox. The shared schema-v2 SQLite registry records logical trials
and append-only attempts; evidence remains campaign-isolated. Resume preserves
previous attempts and uses the stored plan.

Model calls may be paid. Obtain explicit execution authority; disclose unknown
costs and the absence of a monetary cap. Dry-run is preparation, not effectiveness
proof. Local source tests and read-only history verification do not establish
native profile activation, installed-runtime readiness or model compatibility.

## Authoring without retired commands

The contained [assessment guide](references/assessment-guide.md) retains dated
prompt/context/Skill-authoring knowledge and the authoritative 41-rule checklist.
Apply it before drafting, to actual-source audits and evidence-led improvements,
then on the final candidate. Record pass/revise/N/A/unverified for each rule;
functional Markdown plus XML is authoring policy, not portable format validity or
a demonstrated universal gain. Evaluation-only work loads it only when needed.

Use the [authoring checklist](references/authoring.md), relevant
[patterns](references/skill-authoring-best-practices.md), and conditional
[domain coverage](references/domain-coverage.md). Review metadata, links and
containment directly and report the checks actually performed. Static review,
behavioral effectiveness and host compatibility are separate conclusions.

## Self-evaluation design

The current suite uses short natural user requests and supplied neutral inputs.
The active [suite](evals/evals.json) contains creation, audit and evaluation planning/boundary cases; verify input/tool prerequisites separately. Planning cases do not prove automatic end-to-end execution, which requires separately authorized candidate and grading calls.

## Attribution

Derived from Anthropic's skill creator; see [LICENSE.txt](LICENSE.txt).

## Supported host baseline

Active instructions target current stable host releases and current official documentation.
Do not teach historical version branches unless the user explicitly requests an older target.
Record agent-plugin version, host/version, feature, evidence and verification status in
compatibility matrices instead. A documented capability is not a tested integration;
unsupported or untested hosts remain explicitly unverified. Refresh upstream before
changing public contracts and keep exact runtime versions in execution provenance.

## Judge evidence and limits

Grading/regrading defaults are 20 turns and 600 seconds; these are distinct from candidate evaluation defaults. Explicit timeout 0 disables the judge deadline. The configured model remains the default unless the user requests an override. Each grade retains a short versioned instructions.txt, neutral evidence manifest/files, reader audit and host diagnostics under the campaign judging directory. The judge can only list the supplied evidence manifest and read bounded slices through its declared read-only extension; it receives no shell or ambient profile tools. Evidence content remains untrusted, and exact citations are validated against frozen artifacts. Failed grading remains a technical outcome, not an invented verdict. Historical grades keep their original defaults and provenance.

## Evaluation overview and model-specific scores

Reports open on Overview with Needs attention and All evaluations. The bounded,
hash-bound `overview.json` records every frozen planned trial, including trials
without a selected decisive grade. Only explicit selected grades contribute scores;
technical errors, inconclusive, unselected and missing grades have no score.
Overview metadata is stored-binding validated; selected evidence is archive-reverified.
Rows show source/scenario, candidate host/model, judge configuration, criterion counts,
and selected/planned coverage. Candidate requested overrides are not effective-model
proof; configured defaults remain explicitly unknown. Candidate and judge identities
are separate, and judge/model partitions never share scores. Unknown-default results
from different campaigns must not be treated as the same model. One export covers one
campaign; comparing multiple campaign models in one report is not currently supplied.
With/Without deltas use only complete pairs inside a homogeneous partition. Attention
includes failed criteria in either arm, technical grading errors, absent selected
verdicts and unsuccessful execution. Candidate failed criteria are prioritized and
baseline failures are labeled separately. Expand Trials and evidence to open an exact
selected run; unselected trials list their state without fabricated detail or scores.
Return using Overview; detail feedback remains page-session/run-bound.

### Configured candidate identity

New campaigns freeze the configured provider/model per host before execution; omit
optional `--agent`/`--model` unless the user requests them. Internal runtime pinning
is not a user override. Reports show configured identity and selected session metadata,
not proof of the actual backend. Historical missing identities remain unknown; never
resolve them from current settings or rewrite old grades. Managed report regeneration
changes derived outputs only; retained explicit reports remain untouched. Only provider/model
identity is retained, not whole provider parameters or credentials.
