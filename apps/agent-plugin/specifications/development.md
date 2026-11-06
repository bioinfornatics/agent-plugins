# Development, build and verification

Read before executing development/build/tests. npm/Node is the current app toolchain.
The verification snapshot below covers the app only, not installed runtime or native Goose.

## Development commands and evaluation interface

Run from `apps/agent-plugin` with Node.js >=22.22.2. Node's native TypeScript
stripping runs `src/index.ts`; there is no app compilation step. Dry-run prepares
without host calls; non-dry-run executes bounded Goose trials and requires campaign
authority. Native provider compatibility remains unverified; local contained-runtime
verification is recorded separately.

| Command | Purpose / current limit |
|---|---|
| `npm ci` | Install development dependencies from the sole `package-lock.json` |
| `npm start -- --help` | CLI help; `--` forwards arguments to the source entrypoint |
| `npm start -- evaluation --help` | Evaluation options and defaults |
| `npm start -- evaluation --skills /path/to/skill --dry-run` | Validate local suite and emit JSON matrix; no host calls |
| `npm start -- evaluation --plugin /path/to/plugin --dry-run` | Prepare child scenarios with whole-Plugin treatment |
| `npm start -- evaluation --skills /path/to/skill` | Execute Goose; may contact a paid model, requires explicit campaign authority |
| `npm test` | All active `node:test` regressions, including scaffold, evaluation and execution |
| `npm run test:watch` | Watch active tests; not an application watcher |
| `npm run typecheck:source` | Source-only TypeScript check |
| `npm run typecheck` | Source and active-test checks |
| `npm run lint` | Read-only Biome lint on `src/` and `tests/`; errors and warnings fail |
| `npm run lint:fix` | Explicit safe Biome fixes; remaining diagnostics fail; no formatting/import organization |

`npm start -- --watch` would forward a CLI option, not enable runtime watch.
The source-only task uses `typecheck:source`, supplied by the coordinated package
migration; validate the final manifest before execution.

Biome is an exact-pinned development dependency configured in `biome.json`.
It does not replace import resolution, typechecking or executable regressions.
Retired relay tests were removed explicitly after guarantee mapping (see historical
acceptance snapshot below). `npm ci` is development setup, not an end-user Skill
installation step. Review lockfile/identity before changing dependencies; missing
local dependencies do not authorize registry/auth changes or runtime generation.

`npm run build` emits Node ESM JavaScript through scripts/build.mjs;
`npm run package:runtime -- <new-directory>` packages the exact production closure.
No dev/deploy script exists. Runtime generation and projection remain distinct
from publication; see [deployment.md](deployment.md).

## Working procedure

1. Read the task/criteria, inspect affected source, local instructions and dirty state.
2. Use the smallest public-seam test to discriminate the expected wrong behavior.
   Establish observed red for executable repairs; static checks suffice only for
   a documentation-only slice and remain explicitly static.
3. Change one coherent behavior within owned files; run the same focused check,
   then relevant adapter/CLI/integration regressions. Keep builds before consumers;
   never clean or regenerate outputs another test is using.
4. Report command, cwd, environment/tool version, actual exit/result and coverage.
   Focused green does not override a failing full gate or prove installed operation.

## Test design and known baseline

Use `node:test` and `node:assert` under `tests/`, mirroring meaningful responsibilities.
The storage-local SQLite wrapper loads `node:sqlite` lazily; CLI imports must not
load SQLite or open a database. Domain tables
have independent expected values; use cases exercise injected ports; adapters cover
translation/failures/resource ownership; CLI covers output routes, detached callbacks,
help/errors/exit status/import safety and one actual entrypoint subprocess.

Retired `tests/cli.test.ts`, `tests/application/` and `tests/adapters/` were removed
after explicit guarantee mapping. Their dated missing-import/obsolete-command
failures below remain historical evidence, not the active test baseline. npm/Node
migration gates must be rerun against the final candidate; do not infer success
from those snapshots or weaken active tests to obtain green results.

Historical app-only npm/Node evidence from 2026-11-03 is recorded below (92 tests,
typecheck and lint pass). No contained installation, distribution or real-provider
readiness is claimed. Injected tests prove mechanics only. Host/network/provider checks require
explicit authorization, isolated fixtures and version-bound evidence.

## Delivery gate

Inspect diff/status; retain user work. Report added/modified paths, focused and broad
results separately, unresolved blockers and next executable action. Independent
acceptance gates on US/epics remain in Beads; a documentation task or smoke test does
not grant acceptance, commit, deployment or paid campaign authority.

## Preparation verification boundary

Exercise repeatable/combinable target lists, per-kind deduplication, per-target
matrices, Skill-directory namespaces and full-Plugin treatment. Include exact
Skill suite paths, immediate Plugin children, skipped absent child suites, all
absent failure and malformed present failure. Check defaults, free model string,
JSON-only prepared output and zero host calls in dry-run. Non-dry-run must
validate first, then execute only within explicit campaign authority. `--budget` is
deferred; do not claim a monetary limit. These are required checks, not recorded
passing results. Documentation-only verification does not run a paid campaign.

## Historical verification snapshot — 2026-11-02

All dated Bun snapshots below are historical proof, not npm/Node migration acceptance.

Bun 1.3.12: focused tests 29 pass, 0 fail; source-only typecheck passes.
Full `bun test`: 33 pass, 8 fail, 3 errors from preserved historical commands
and missing retired modules. Full `bun run typecheck` also fails on those historical
imports. These failures were visible at that snapshot; no exclusions or test weakening were added.


## Historical execution snapshot — 2026-11-02

Retained as a dated snapshot, not the current feature inventory; consult AGENTS.md.

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


## VS Code workspace and Node breakpoints

Open `agent-plugins.code-workspace` from the repository root:

```bash
code agent-plugins.code-workspace
```

The workspace opens `Repository` and `Agent Plugin CLI` as separate folders.
Repository `.vscode` owns source-inventory/editor checks; app `.vscode` owns Node
launches, app tasks and Biome. `${workspaceFolder}` in an app configuration resolves
to `apps/agent-plugin`, so the app can also be opened standalone. Opening only the
repository directory does not discover nested app `.vscode` configurations.

Repository search excludes only `apps/agent-plugin/**` to avoid duplicate results
in multi-root mode; the app root remains searchable and visible. When opening the
repository alone, temporarily disable **Use Exclude Settings and Ignore Files**
in Search to include this app, or open the workspace. Future apps need their own
folder entries before adding corresponding repository search exclusions.

### Debug

The recommended extension is `biomejs.biome`; recommendations do not install it.
VS Code's built-in Node debugger uses launch type `node`, `runtimeExecutable: node`
and program `src/index.ts`. Node.js >=22.22.2 must be on VS Code's PATH. An operator
may configure a local absolute runtime path, but must not commit it. Run `npm ci`
first; no build or pre-launch dependency installation is configured. Node strips
TypeScript types natively; typechecking remains a separate check.

In Run and Debug, select:

- **Agent Plugin: CLI help** — inspect startup with `--help`.
- **Agent Plugin: Evaluation help** — inspect evaluation option parsing.
- **Agent Plugin: Prepare Skill (dry-run)** — enter an absolute Skill directory
  containing `evals/evals.json`; validates inputs without executing a host.

Set a breakpoint on an executable line in `src/main.ts` (for example the
`createApplication(output)` call) and press F5. All profiles stop on entry; continue
with F5 to reach the selected branch. The program must be `src/index.ts` because
it owns process startup. Help does not reach evaluation preparation;
use the dry-run profile for that branch. No default profile executes a real campaign.
Debugging Node does not automatically debug child Goose processes.

Static launch validation does not prove live breakpoint binding. For an explicit
inspector session from the app directory, use:

```bash
node --inspect-brk src/index.ts --help
```

Attach with the Node debugger; live inspector/breakpoint behavior still needs
operator verification.

### Tasks and lint

Run Task exposes read-only lint, source-only and full typechecks, and focused/all
test labels. Both test tasks intentionally use `npm test` to run all active tests;
no historical-directory selection or permanent exclusion is introduced. CLI tasks
use `npm start -- <args>` so help/evaluation arguments reach the application.
App-local npm/Node results pass; see the migration verification below.
No task installs dependencies, applies lint fixes, starts paid trials or publishes.
Biome uses the app-local installed binary and requires its configuration. Formatting
on save is disabled consistently with `biome.json`; no import-organization/fix-on-save
policy is introduced. Dependencies must already be prepared using the documented setup.

The root editor regression `node scripts/test-vscode-integration.mjs` validates
current npm tasks and Node launches; five checks pass after the separately
authorized integration update (ap-fdz0.2). Its coverage validates JSON,
folder/path ownership, safe task/launch contracts and actual help/dry-run invocations
with a temporary fixture. It does not start an inspector, verify live extension/LSP
behavior or replace application tests. Root tasks were deliberately reduced from the
obsolete four-creator workflow; builds and publication remain explicit CLI operations.
The workspace and `.vscode` files are source-side development resources, outside
`production.mjs`'s installation allowlist. No runtime mapping or projection changed.


## Historical profile/registry candidate verification — 2026-11-03

`bun test ./tests/scaffold ./tests/evaluation ./tests/execution`: 52 pass/0 fail;
source-only tsc and Biome lint pass, Bun 1.3.12. Full suite retains 56 pass/8 fail/
3 errors from historical imports/commands; full typecheck also fails on those tests.
No exclusions or legacy reconstruction. Snapshot/profile, real SQLite shared registry,
ordered cleanup and independent process append tested; no native model campaign.
Tests always pass an explicit temporary registry; never use the live user registry.
Import/history/grading/recovery and installed runtime compatibility are not delivered.


## Historical durable recovery candidate — 2026-11-03

Focused scaffold/evaluation/execution: 70 pass, source tsc/lint/diff pass.
Independent recovery review: 18 pass/94 assertions. Includes SIGKILL owner,
publication reconciliation/corruption refusal, exact schema-v1 migration rollback,
PID/hostname/EPERM/token boundaries and deterministic worker drain under write failure.
Full suite retains 74 pass/8 fail/3 errors, full types historical missing modules.
These are local SQLite/fake-host tests, not native resume or power-loss durability.


## Historical foundation local acceptance — 2026-11-03 (superseded the earlier Bun gate failures)

Authorized retirement of four prompt-relay test files: tests/cli.test.ts,
tests/adapters/agent-adapters.test.ts, tests/adapters/commander-cli.test.ts,
tests/application/execute-agent.test.ts. These exercised removed run/agents/bootstrap
and ExecuteAgentUseCase APIs, not evaluation. No discovery excludes, skips or
retired implementation restored. Guarantee mapping independently reviewed:

| Retired guarantee | Current discriminating evidence |
|---|---|
| Help/dispatch/argument validation | scaffold entrypoint/output and evaluation CLI/preparation tests |
| Blank prompt and exact input | preparation invalid-suite prompt + alias/fixture exact text |
| Missing adapter | host-selection missing host before any effects |
| Duplicate gateway array registration | retired API; host Map and explicit selection dedup are current contract |
| Result identity/nonempty response | negative host attribution + named export whitespace/wrong-prompt/user-only fixtures |
| Client error not success | thrown host => uncertain attempt; nonzero/export failures and sanitized handler errors |
| Raw string output | retired generated-content API; handler summary JSON and routed output |

Final full `bun test`: **79 pass, 0 fail, 399 assertions**, 11 files, Bun 1.3.12.
`bun run typecheck` (source + tests), `bun run lint`, `git diff --check` pass.
Independent reviews: 20261103_5 reran previous 75-test candidate and full gates;
20261103_6 accepted retirement mapping; 20261103_7 reviewed preparation criteria
and found output-failure proof gap; 20261103_9 accepted added failure/24-pair-reference
proof; 20261103_8 accepted HOST/STORE/RES approved local boundaries. The final
79-test receipt is coordinator-run, not mislabelled as independent rerun.

Output failure means nonzero CLI/no successful-ready outcome, not retracting bytes
already emitted by a caller-owned stream. Arbitrary partial writer rollback is not
promised. Source data may contain operator-authored secrets; tests verify no ambient
configuration/auth is copied, not comprehensive detection of input secrets.
Native/provider, installed-runtime, power-loss, stable-profile membership editing,
history/import/grading remain open; local acceptance does not authorize publication.


## Historical history slice verification — 2026-11-03

Full bun test83pass0fail427assertions; full typecheck/lint/diff pass. Independent
history tests4pass28assertions. Read-only SQLite fixtures and actual CLI verify
missing registry/no creation, homonyms/revisions, retained attempts, absent proofs,
unchanged registry bytes and unsupported schema refusal. No model or live registry.


## npm/Node migration verification — 2026-11-03

User-authorized migration replaces the development runtime, package manager and
runner together: Node.js 22.22.2, npm 10.9.7, node:test/node:assert. Existing 89
scenarios remain; three storage-boundary regressions cover positional rows,
rollback, synchronous transaction admission and readonly/no-create behavior.

- `npm ci --ignore-scripts --no-audit --no-fund`: succeeds with the generated
  npm v3 lock and public npmjs dependencies. The initial offline attempt failed
  because YAML was not cached; no credentials or registry settings were changed.
- `npm test`: 92 pass, 0 fail/cancelled/skipped/todo, 14 files.
- `npm run typecheck`, `npm run lint`, `git diff --check`: pass.
- CLI help, evaluation help and import-only paths are silent on stderr; SQLite
  loads lazily. Opening SQLite emits Node's ExperimentalWarning; it is not suppressed.
- Root `node scripts/test-vscode-integration.mjs`: 5 pass after the authorized
  npm/Node integration update. Live debugger binding, generated installed runtime,
  platform compatibility and real-provider activation remain unverified.

Independent review of the final candidate is recorded in Beads ap-fdz0.1.


## Contained Node runtime migration — local WIP, 2026-11-03

Authorized abrupt migration replaces old creator CLI compatibility with one
agent-plugin runtime under skills/skill-creator. Local candidate: npm test109pass,
typecheck/lint pass; build and generated-dist drift pass; copied runtime regressions
cover help/dry-run/readonly missing-registry history, integrity/paths/version floor
and subprocess transport. Root production15pass and local projection smoke pass.
These receipts do not establish exact committed-source provenance: source tree is
dirty with preserved user entrypoint changes.

Independent review20261103_43 finds local inventory/dependencies coherent, but
full migration needs corrections to canonical CI, offline dependency/source rebuild,
Git install/update gate and sibling Skill instructions. No independent final-candidate
runtime execution, copied fake campaign/inspect/resume or real Git upgrade receipt
yet. Keep ap-fdz0 open; no publication/live update/model proof inferred.


## Final local migration checks — 2026-11-03

App110tests/typecheck/lint pass. Four CI shards26/27/17/40 cover all17files;
quick and closed root remainder pass. Isolated manifest reconstruction authenticates
nine lock-matching tarballs without npm install/lifecycle/network/cache fallback;
double generation239files stable, npmCacheEntries0, root sources unchanged.
Full reconstruction includes copied installed fake campaign/inspect/frozen resume
and actual isolated Git install/update with checksum-pinned Goose1.47.0: five
Skills, one launcher, seven retired canaries removed. Goose1.57 also locally passes.
Canonical workflow YAML/trust tests pass; actual GitHub exact-source execution and
remote publication remain unperformed. Linux-x64 build closure only; no models.

## Current grading verification — 2026-11-06

CLI grading/regrading/judgments are wired; they are not promises of calibrated
model quality. Run full app tests/types/lint/build for source changes, then generated
runtime drift/inventory and distribution/production gates for companions. Grading
columns use shared UTF-8 JSON limits; tests cover legacy9MiB and inclusive16MiB
round-trip, overflow refusal, latest-user candidate attribution and typed text.
Historical92/Bun snapshots above are dated receipts, not current suite size.
