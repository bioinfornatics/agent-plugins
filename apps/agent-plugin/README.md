# agent-plugin

Comparative Skill/Plugin evaluation CLI in `apps/agent-plugin`, developed with
npm, Node.js >=22.22.2, TypeScript and Commander.js. Node runs `src/index.ts`
with native TypeScript stripping; no compilation step is required for source app execution.
`npm run build` emits JavaScript; `npm run package:runtime -- <new-directory>`
packages the contained Node runtime.
Read [AGENTS.md](AGENTS.md) before changes;
[SPECIFICATION.md](SPECIFICATION.md) routes the canonical requirements.

## Current source state — 2026-11-06

Current commands: evaluation, history, inspect, grading, regrading, judgments.
Goose is the only implemented candidate/Judge host. Standard suite import,
unsupported-constraint diagnostics, verified attempt reading and append-only
judgments are wired locally. Model overrides are optional; native imported
configuration/environment defaults remain intact, effective model unknown unless
observed. Historical dated sections below are snapshots, not current capability
summaries. Current behavior is specified in product §§23–27.

Known pending work: grading.json file export, workspace/benchmark projection,
real-model calibration, historical import and explicit profile membership updates.
Local/fake-host checks are not native provider or publication acceptance.

## Historical source snapshot — 2026-11-03

Source baseline: `67028c0`. Preparation, composed profiles, bounded parallel Goose
execution, schema-v2 SQLite registry, conservative frozen-plan resume and read-only
`history`/`inspect` are implemented. Local tests use a fake host and real SQLite;
they do not prove native profile activation or model/export compatibility.
Grading, regrading, historical import, HTML decision reports and explicit membership
updates of an existing profile identity remain undelivered. The contained runtime is generated for this app under the existing skill-creator
launcher; this abrupt migration retires the old creator CLI commands. Local
packaging is separate from publication (`ap-fdz0`).

The initial preparation-only slice is superseded. Its dated records remain in
[product](specifications/product.md) and [development](specifications/development.md).

## CLI contract

Commands from the app directory after `npm ci`:

Dry-run prepares without host calls; non-dry-run executes Goose and requires campaign
authority. Use the current development gates below; historical test counts are dated
receipts, not current suite guarantees. Local contained runtime checks and real
provider/model compatibility are separate evidence levels.

```bash
npm start -- --help
npm start -- evaluation --help
npm start -- evaluation --skills /path/to/skill --dry-run
npm start -- evaluation --plugin /path/to/plugin --dry-run
npm start -- evaluation --skills /path/to/one /path/to/two \
  --plugin /path/to/plugin --skills /path/to/three \
  --agent goose --agent codex --model "model-id" --dry-run
```

`agent-plugin evaluation` is the public command. `--skills <paths...>` and
`--plugin <paths...>` are repeatable and combinable; at least one target is
required for a new campaign. Canonical roots compose one profile; duplicate roots
and standalone Skills already included in a Plugin are deduplicated.
`--profile-name` is optional; the name is not the profile identity.
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
- Every retained scenario compares the **whole composed profile** with its absence,
  including selected Plugins' non-Skill capabilities; provenance is not an installation selector.
- Scenarios are deduplicated by canonical suite provenance and source ID; Skill-directory
  namespaces allow child suites to reuse local IDs.
- For S retained scenarios, A selected agents and R repetitions: `2 × S × A × R`
  planned trials and `S × A × R` pairs, not execution receipts. Only Goose execution
  is wired; other selected hosts support preparation, not an implicit fallback.

## Imported evaluation suites — 2026-11-04 source candidate

The reader accepts AgentSkills `expected_output`, optional `files` and optional
`expectations`. `expected_output` is preserved as judge-side `expectedOutput`,
never appended to the candidate prompt. Missing/empty expectations produce
`grading.notable: false`; they do not acquire a score.

`files` paths are relative to the Skill root and retain that relative path in
both private trial workspaces. Regular files and directories are captured with
existing bounded snapshot limits. Parent/leaf symlinks, traversal, special files,
reserved configuration/secrets/instruction names and `files` together with
legacy `fixtures` are rejected. The reserved-name policy is not comprehensive
secret detection or a race-free filesystem sandbox. Legacy `fixtures` remains
suite-relative; `assertions` remains an alias requiring equality if both are used.

Recognized scenario extensions (`name`, `subject`, `language`, `target`,
`preconditions`, `budget`, `capabilities`, `navigation_expectations`,
`coverage_tags`, `execution_assertions`) and suite `coverage_dimensions` are
preserved canonically in frozen plans. Unknown fields remain errors. Any declared
`preconditions`, `budget`, `capabilities`, `navigation_expectations` or
`execution_assertions` currently emits `unsupported-scenario-constraint`
diagnostics: dry-run can display the plan, but execution refuses before host
creation/preflight or new-campaign storage. Removing displayed diagnostics does
not authorize execution: admission derives constraints from preserved data.
Resume first reads its stored plan, then applies the same refusal without source
rediscovery or host launch.

Changed expected output, extension data or input bytes change the content
revision. Historical schema3 plans without these additive fields remain readable.
Recovery also compares frozen profile content with the retained profile-revision
snapshot and checks aggregate/component scenario consistency. This detects
valid-shaped substitutions under unchanged revision labels; it is not tamperproof
against coordinated rewriting of both database payloads.

The local contained Skill runtime is regenerated from this source and verified,
including isolated Git install/update checks. No live operator installation or
publication is performed. Grading/benchmark exports and new subcommands remain
separate increments, not delivered here. A deterministic domain foundation now
validates supplied judgments and projects the strict grading object without I/O.
It verifies references/excerpts against supplied text, not SHA-256 authenticity
or semantic judgment quality. A local/mock-ready Goose judge transport now uses a separate private session,
neutral evidence aliases and exact named-export terminal JSON. No grading CLI,
persistence or calibration is wired yet.

## Registry, resume and consultation

`--registry <file>` overrides the shared user registry. Default:
`$XDG_DATA_HOME/agent-plugin/evaluations.sqlite`, or
`$HOME/.local/share/agent-plugin/evaluations.sqlite` when XDG is absent, empty or relative.
Evidence defaults to `campaigns` beside the registry; `--output <directory>` overrides
only the evidence location. Dry-run does not create a registry.

```bash
npm start -- evaluation --resume <campaign-id> --registry /temporary/registry.sqlite
npm start -- history --registry /temporary/registry.sqlite --json
npm start -- inspect <campaign-id> --registry /temporary/registry.sqlite
```

Resume executes pending trials from the frozen stored plan, without rereading sources
or replaying finalized trials. Selectors, name, output, dry-run and execution overrides
are rejected. `--retry-uncertain` explicitly permits new attempts for uncertain trials;
corrupted publications still reject. Resuming may call a paid model and needs authority.
History/inspect open schema-v2 SQLite read-only without creation, migration or model calls.
Evidence availability means file presence, not checksum validation; absent scores are
unavailable/null, never zero. No native conversation continuation, power-loss durability
or OS sandbox is promised. Plugins declaring MCP mappings remain unsupported.

## Development and limitations

Run from `apps/agent-plugin`:

```bash
npm ci
npm run lint
npm run lint:fix
npm test
npm run test:watch
npm run typecheck
```

Biome is pinned as a development dependency. `lint` checks all TypeScript files
under `src/` and `tests/` without writing changes and fails on errors or warnings.
`lint:fix` explicitly applies safe fixes; remaining diagnostics still fail.
Recommended lint rules are enabled, while formatting and import organization are
disabled. Lint success does not imply passing tests, typechecks or host readiness.

Use `package-lock.json` as the sole dependency lockfile; `npm ci` is development
setup, not an installed Skill requirement. Tests use `node:test` and `node:assert`.
SQLite is accessed lazily through a storage-local `node:sqlite` wrapper, not at CLI import.

See [development](specifications/development.md) for checks and dated historical
proof, and [architecture](src/README.md) for boundaries. An app build and runtime packaging script exist; no deploy script exists. Static documentation checks are not npm/Node gate or real-host evidence.
The old `agents` and `run --prompt` commands are not this product's interface.

The generated `skills/skill-creator/scripts/skill-creator.mjs` launcher now invokes
the contained agent-plugin CLI with Node.js >=22.22.2. Old creator CLI compatibility
is intentionally retired by the authorized abrupt migration. See [deployment](specifications/deployment.md).


## Historical execution snapshot — 2026-11-02

This dated snapshot is retained as historical evidence, not the current feature inventory
or proof of the npm/Node migration. Current instructions are in [AGENTS.md](AGENTS.md).

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

## Judge model selection — confirmed 2026-11-05

Model override is optional. Without an override, the Goose judge retains the
imported native provider/model configuration, including functional environment
precedence; with an override, the exact model string is passed explicitly.
No judge model is hard-coded or inferred from candidate options. Requested versus
effective identity remains distinct; effective is unknown without observation.
Claude/Codex must use their own configuration when implemented and are not yet
supported by this adapter. Development checks use fake executables, not providers.

## Local grading persistence foundation — 2026-11-05

The source provides verified explicit-attempt evidence reading and gradeAttempt
orchestration with an injected Judge. Evidence uses the exact bytes checked against
checkpoint and registry hashes; schema2 receives a separately validated version1
grading extension on explicit append, never during read-only history. Regrades append
new IDs, technical failures remain distinct and existing grades cannot be updated or
deleted through the extension contract. Missing registries are never created by
this grading boundary. No grading/regrading CLI or benchmark export is wired yet;
local tests use a fake Judge, not a real model. No semantic quality/calibration or
cryptographic protection against coordinated database rewriting is claimed.

Current retention limitation: each grading record retains the supplied text request
as well as citations and digests, so repeated grades duplicate that text. Per-read
bounds are not a global campaign/storage quota. The storage boundary trusts the
Judge transport's known-secret filtering and does not independently detect every
secret in injected outcomes/provenance. Unknown-secret and operator-input limits
remain explicit; broader retention/privacy policy is a separate integration gate.

## Grading CLI — 2026-11-06 source candidate

`grading <campaign-id> --attempt <attempt-id>` invokes a new judgment over an
explicit verified candidate attempt. `regrading` uses the same interface and
always appends a fresh grading ID; it never relaunches the candidate. Both accept
`--registry`, optional `--model`, `--agent goose`, `--max-turns` (50), `--timeout`
(0 disabled) and `--json`. Unsupported agents fail before Judge construction.
No model override means native imported configuration, not a hard-coded model.
These commands can call paid models and require explicit campaign authority.

`judgments <campaign-id> [--attempt <attempt-id>] [--registry <file>] [--json]`
reads historical judgments without models, registry creation or migration. It
checks stored bindings/outcomes/rows and retained text hashes, but does not reopen
archives: `verification.archives` is `not-reverified`, not integrity proof of the
current archive tree. Missing registry or grading extension yields an empty list.
Full request blobs are not output. Technical Judge failures are stored and return
nonzero CLI status; inconclusive is a distinct available outcome with verdict
counts, never a fabricated binary grade or score. Existing history/inspect remain
readonly with score:null. Grading.json file export/benchmark remains separate.
