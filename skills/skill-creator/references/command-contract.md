# CLI command reference

Resolve `<skill-root>` to this loaded Skill’s directory. Paths to its scripts are
relative to that directory, independently of the session working directory.

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
node <skill-root>/scripts/skill-creator.mjs export <campaign-id> --grading <grade-id>
node <skill-root>/scripts/generate-report.mjs --workspace /recorded/campaign/report/export
```

Use `--help` on the CLI or a subcommand for its exact syntax.

Use the tool’s default values. Apply overrides only when explicitly requested by the user. Ask for required values that have no default.
Evaluation defaults: Goose, configured model (no `--model`), repetitions 3,
parallelism 3, max turns 50, timeout 0 and heartbeat enabled. Grading/regrading
defaults remain separate: Goose, configured model, 20 turns and 600 seconds,
heartbeat enabled. The current working directory identifies the evaluation source. Example paths
illustrate syntax; user input and tool defaults determine parameter values.
Required selectors/IDs and helper `--workspace` must be supplied. Export and helper
`--output` are optional and use the destinations below without a destination question.
Candidate preparation still requires a destination with no default. Honor requested
dry-run and partial stages; defaults grant no execution authority.

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
| `--output <directory>` | Optional evidence root override; Hive layout preserved, default root beside registry |
| `--dry-run` | Validate and print JSON matrix; no host calls |
| `-q`, `--quiet` | Disable heartbeat only; omit unless explicitly requested |
| `--resume <campaign-id>` | Frozen stored plan; no source selectors, name, output, dry-run or execution-parameter overrides |
| `--retry-uncertain` | Resume only; explicitly permits fresh attempts for uncertain trials, never bypasses corruption checks |

`history [--profile <id>] [--registry <file>] [--json]` filters by exact profile
identity. `inspect <campaign-id> [--registry <file>] [--json]` lists stored
parameters, trials, attempts and evidence locations. Both are read-only: no
execution, registry creation or migration. Evidence availability is file presence,
not SHA-256 verification. History/inspect produce no score or HTML report. No `--budget`,
`--grade`, `--format` or historical-import command is supported.

## Default durable locations

Omit evaluation `--registry` and `--output` unless explicitly requested. The shared
registry is `$XDG_DATA_HOME/agent-plugin/evaluations.sqlite` when XDG_DATA_HOME is
absolute; otherwise it is `$HOME/.local/share/agent-plugin/evaluations.sqlite`.
New campaigns use the sibling `campaigns/profile=<id>/model=configured-<digest>/campaign=<uuid>`
layout keyed by the frozen host/provider/model map, excluding selection source.
Legacy `model=default` and `model=requested-<digest>` paths remain unchanged.
Configured identity is not actual backend proof. An explicit
registry changes the default sibling campaigns root; an explicit evaluation output
changes only the root, preserving the same Hive partitions and metadata. Candidate
preparation requires a user-supplied or already authorized destination with no default;
ask neutrally when it is missing. Export and HTML generation use tool defaults.

Reuse a known nondefault registry consistently for retained history, inspection,
resume, grading and export; accessing existing evidence is not a new discretionary
override. Resume preserves the exact stored plan and evidence path; only registry,
explicitly requested retry-uncertain and quiet presentation options may accompany
`--resume`. Do not supply new selectors, defaults as flags or output destinations.

## Export and HTML destinations

`export <campaign-id> --grading <grade-id>... [--output <new-directory>] [--benchmark]`
requires explicit grading IDs, never a latest-grade selection. Omitted `--output`
uses the recorded validated DB campaign directory’s `report/export`, including
retained flat and Hive campaigns; it does not reconstruct paths from cwd or current
settings. Explicit `--output` requires a new exclusive destination with an existing
parent, outside protected source/evidence/registry roots. `--benchmark` is an optional
quality-only paired export, not a default override to add autonomously.

`node <skill-root>/scripts/generate-report.mjs --workspace <export-root> [--output <new-html>] [--skill-name <label>]`
requires the export root. Omitted `--output` uses authenticated managed
`<campaign>/report/review.html` when the export carries bound `reportLocation`; an
external/legacy export without that binding defaults to sibling `review.html`,
created exclusively. Explicit `--output` always requires a new file with an existing
parent, outside the export and protected roots, even if it names the managed path.

Managed export/HTML regeneration authenticates ownership and exact export inventory;
HTML replacement also requires `.agent-plugin-html.json` with
`{version:1,campaignId,htmlSha256}` matching the existing HTML. Both operations use
`.agent-plugin-report.lock` and stage before replacement. The managed helper checks
an exact directory tree, current-UID ownership, directories 700 and files 600;
unknown empty directories are refused. External/legacy compatibility is intentionally
broader. Precommit ordinary failures preserve the prior view. Export commits at the
successful staged-directory -> export rename; the helper commits only after both
HTML and receipt renames succeed. Postcommit backup/stage/lock cleanup failure returns
committed success with the exact generic warning
`Report publication committed; cleanup residue requires operator inspection before regeneration.`
The CLI emits it on stderr; helper JSON may include optional `warnings`. Retained
residue blocks regeneration; no automatic stale repair, stale-lock takeover, crash
atomicity or hostile-filesystem guarantees are supplied. Export regeneration
leaves old HTML unchanged until separate helper regeneration; evidence and grades
remain immutable. See [report generation](review-viewer.md#generate) for the full
regeneration boundary.
