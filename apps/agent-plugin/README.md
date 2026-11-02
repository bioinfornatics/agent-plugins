# agent-plugin

Comparative Skill/Plugin evaluation CLI in `apps/agent-plugin`, developed with
Bun, TypeScript and Commander.js. Read [AGENTS.md](AGENTS.md) before changes;
[SPECIFICATION.md](SPECIFICATION.md) routes the canonical requirements.

## Authorized scope: preparation only

The authorized implementation prepares an evaluation matrix. It does **not** run
agents, install targets, call models or judges, store results, or generate reports.
`evaluation --dry-run` validates local inputs and writes the prepared matrix as
JSON. Without `--dry-run`, `evaluation` performs the same validation and then fails
explicitly because execution is unavailable. Invalid input fails before either
outcome; no simulated evaluation success is returned.

## CLI contract

Commands for the approved preparation implementation, from the renamed app
directory after development dependencies are available:

The preparation CLI is implemented and covered by focused tests. Host execution
and installed-runtime compatibility remain unimplemented/unverified.

```bash
bun run start --help
bun run start evaluation --help
bun run start evaluation --skills /path/to/skill --dry-run
bun run start evaluation --plugin /path/to/plugin --dry-run
bun run start evaluation --skills /path/to/one /path/to/two \
  --plugin /path/to/plugin --skills /path/to/three \
  --agent goose --agent codex --model "model-id" --dry-run
```

`agent-plugin evaluation` is the public command. `--skills <paths...>` and
`--plugin <paths...>` are repeatable and combinable; at least one target is
required. Roots are deduplicated by kind, not collapsed into one combined target.
`--agent` is repeatable, defaults to Goose, and has no implicit fallback. `--model`
is a free string, not a fixed enum or proof of model availability. Defaults:
`--repetitions 3`, `--max-turns 50`, `--timeout 0` (disabled), `--parallelism 3`.
`--budget` is deferred: no monetary cap is implemented or promised.

## Scenario discovery and comparisons

- A Skill uses exactly `<skill>/evals/evals.json`; no alternate-location search or
  discovery chatter. Its missing or malformed suite is an error.
- A Plugin discovers immediate `skills/*/SKILL.md` children and each child's exact
  `evals/evals.json`. Missing child suites are skipped; all absent is an error;
  a malformed present suite is an error. No root evaluation suite is required.
- Each Plugin child scenario compares the **whole Plugin**, including its
  non-Skill treatment, against absence of that Plugin; it is not a Skill-only run.
- Each selected target has a separate with/without comparison. Scenario identities
  are namespaced by Skill directory, so child suites may reuse local IDs.
- Prepared candidate rows are targets × their scenarios × selected agents ×
  repetitions × {with, without}; these are planned rows, not execution receipts.

## Development and limitations

Run from `apps/agent-plugin`:

```bash
bun install --frozen-lockfile
bun run lint
bun run lint:fix
```

Biome is pinned as a development dependency. `lint` checks all TypeScript files
under `src/` and `tests/` without writing changes and fails on errors or warnings.
`lint:fix` explicitly applies safe fixes; remaining diagnostics still fail.
Recommended lint rules are enabled, while formatting and import organization are
disabled. Lint success does not imply passing tests, typechecks or host readiness.

See [development](specifications/development.md) for source checks and historical
test limitations, and [architecture](src/README.md) for boundaries. No app build or
deploy script exists. Historical tests reference removed generic relay sources;
a focused preparation check is not full-suite acceptance or real-host evidence.
The old `agents` and `run --prompt` commands are not this product's interface.

The installed `skills/skill-creator/scripts/skill-creator.mjs` launcher stays
unchanged. App rename does not migrate runtime mappings or replace that contained
Node.js 22+ runtime. See [deployment](specifications/deployment.md).


## Execution slice — 2026-11-02 (supersedes preparation-only behavior above)

Non-dry-run now executes Goose trials sequentially; `--output <directory>` defaults
to `.artifacts/evaluations`. Each campaign creates a private UUID directory with
`evaluation.sqlite` and hash-manifested artifacts. Only Goose execution is supported;
other hosts still support preparation only. A failed/incomplete trial produces nonzero CLI status.
Goose uses a private HOME/XDG/path root per trial, filtered builtin/platform config,
explicit credential/permission files, a fresh workspace and named session export.
Plugins with MCP declarations (`mcp.json`, `.mcp.json`, `mcpServers`) are unsupported.
Only the with condition installs the target. Eval files are excluded from installation.
Known credential values are redacted in collected artifacts; the private database retains
operator-supplied prompts/criteria as inputs, which must not contain secrets. Unknown keyring
or network credentials are not guaranteed redacted. HOME isolation is not an OS sandbox.
Current tests use a fake executable and real SQLite, not paid/native model responses.
Native Plugin activation and native conversation-export fidelity remain unverified.
No judge, regrading, parallel pool, cancellation API or crash recovery is delivered.
Timeout uses process-group termination on POSIX. Pending/orphan artifact directories
and running rows may remain on storage failure; they are not represented as completed.
