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

Old validation, packaging, grading, scoring, HTML reporting and import workflows
are retired executable functionality. Retained reference files are historical;
they are not instructions to invoke old commands. No standalone native creator
executables are supplied by this candidate. Other plugin Skills retain authoring
instructions but their legacy CLI references remain migration-pending.

## Command contract

Prefix each invocation with `node <skill-root>/scripts/skill-creator.mjs`.
The CLI identifies itself as `agent-plugin`; this does not install a PATH command.

```bash
node <skill-root>/scripts/skill-creator.mjs evaluation --skills /path/to/skill --dry-run
node <skill-root>/scripts/skill-creator.mjs evaluation --plugin /path/to/plugin --dry-run
node <skill-root>/scripts/skill-creator.mjs evaluation --skills /path/to/skill --model <model>
node <skill-root>/scripts/skill-creator.mjs history --json
node <skill-root>/scripts/skill-creator.mjs inspect <campaign-id> --json
node <skill-root>/scripts/skill-creator.mjs evaluation --resume <campaign-id> --retry-uncertain
```

Use `--help` on the CLI or a subcommand for its exact syntax.

| Evaluation option | Contract |
|---|---|
| `--skills <paths...>` | Repeatable Skill roots; combinable with `--plugin` |
| `--plugin <paths...>` | Repeatable Plugin roots; no `--plugins` alias |
| `--profile-name <name>` | Optional label; not profile identity |
| `--model <name>` | Free model identifier string |
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
not SHA-256 verification. No score or HTML report is produced. No `--budget`,
`--grade`, `--format` or historical-import command is supported.

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

## Attribution

Derived from Anthropic's skill creator; see [LICENSE.txt](LICENSE.txt).
