# Skill Creator

Authors and improves portable Agent Skills and runs comparative Skill/Plugin
evaluations. Authoring produces instructions and scenarios; it does not implicitly
launch a model. See [SKILL.md](SKILL.md) for routing and execution authority.

## Migration status

**0.6.0 candidate, not published.** The existing `scripts/skill-creator.mjs` path
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

Prefix each invocation with `node <skill-root>/scripts/skill-creator.mjs`.
The CLI identifies itself as `agent-plugin`; this does not install a PATH command.

```bash
node <skill-root>/scripts/skill-creator.mjs evaluation --skills /path/to/skill --dry-run
node <skill-root>/scripts/skill-creator.mjs evaluation --plugin /path/to/plugin --dry-run
node <skill-root>/scripts/skill-creator.mjs evaluation --skills /path/to/skill
node <skill-root>/scripts/skill-creator.mjs history --json
node <skill-root>/scripts/skill-creator.mjs inspect <campaign-id> --json
node <skill-root>/scripts/skill-creator.mjs evaluation --resume <campaign-id> --retry-uncertain
node <skill-root>/scripts/skill-creator.mjs validate /canonical/path/to/skill
node <skill-root>/scripts/skill-creator.mjs grading <campaign-id> --attempt <attempt-id> --json
node <skill-root>/scripts/skill-creator.mjs judgments <campaign-id> --json
node <skill-root>/scripts/skill-creator.mjs export <campaign-id> --grading <grade-id> --output /existing/parent/NEW-export
node <skill-root>/scripts/generate-report.mjs --workspace /path/to/export --output /existing/parent/NEW-review.html
```

Use `--help` on the CLI or a subcommand for its exact syntax.

| Evaluation option | Contract |
|---|---|
| `--skills <paths...>` | Repeatable Skill roots; combinable with `--plugin` |
| `--plugin <paths...>` | Repeatable Plugin roots; no `--plugins` alias |
| `--profile-name <name>` | Optional label; not profile identity |
| `--model <name>` | Explicit user override; omission uses configured default |
| `--agent <name>` | Repeatable host selector: goose, claude, codex; default goose; selection is not compatibility proof |
| `--repetitions <count>` | Paired repetitions per scenario/host; default 3 |
| `--max-turns <count>` | Requested turn limit; default 50; enforcement depends on host |
| `--timeout <seconds>` | Default 0, disabled |
| `--parallelism <count>` | Global concurrency; default 3 |
| `--registry <file>` | User-wide SQLite registry override |
| `--output <directory>` | Campaign evidence directory; default beside registry |
| `--dry-run` | Validate and print JSON matrix; no host calls |
| `--resume <campaign-id>` | Frozen stored plan; no source selectors, name, output, dry-run or execution-parameter overrides |
| `--retry-uncertain` | Resume only; explicitly permits fresh attempts for uncertain trials, never bypasses corruption checks |

`history [--profile <id>] [--registry <file>] [--json]` filters by exact profile
identity. `inspect <campaign-id> [--registry <file>] [--json]` lists stored
parameters, trials, attempts and evidence locations. Both are read-only: no
execution, registry creation or migration. Evidence availability is file presence,
not SHA-256 verification. History/inspect produce no score or HTML report. No `--budget`,
`--grade`, `--format` or historical-import command is supported.

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
or network call is needed. It creates new self-contained HTML, never overwriting
inputs or existing HTML. All selected output bytes, including private logs, are
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

Use the [authoring checklist](references/authoring.md), relevant
[patterns](references/skill-authoring-best-practices.md), and conditional
[domain coverage](references/domain-coverage.md). Review metadata, links and
containment directly and report the checks actually performed. Static review,
behavioral effectiveness and host compatibility are separate conclusions.

## Self-evaluation design

The current suite uses short natural user requests and supplied neutral inputs.
See [coverage](evals/coverage.md) for source-to-criterion proof and
[preparation](evals/preparation.md) for both-arm setup and retained-registry gates.
Historical suites and fixtures are preserved outside current executable discovery;
see the [historical boundary](references/historical/README.md).

## Attribution

Derived from Anthropic's skill creator; see [LICENSE.txt](LICENSE.txt).
