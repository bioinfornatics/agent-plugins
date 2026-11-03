# Development, build and verification

Read before executing development/build/tests. Commands below are observed in the
current package manifests, not proof that all gates pass.

## Development commands and approved preparation interface

Run from `apps/agent-plugin`. The evaluation preparation interface is implemented;
real host execution and installed-runtime migration are not.

| Command | Purpose / current limit |
|---|---|
| `bun run start --help` | Run current entrypoint; CLI help; preparation contract is `evaluation`, not execution |
| `bun run start --watch` | NOT a development watcher: this would be a CLI option. Do not use it as a watch command |
| `bun --watch src/index.ts --help` | Bun runtime watch for entrypoint development; not a package script or campaign |
| `bun run start evaluation --help` | Evaluation options and defaults |
| `bun run start evaluation --skills /path/to/skill --dry-run` | Validate local suite and emit JSON matrix; no host calls |
| `bun run start evaluation --plugin /path/to/plugin --dry-run` | Prepare child scenarios with whole-Plugin treatment |
| `bun run start evaluation --skills /path/to/skill` | Execute Goose; may contact a paid model, requires explicit campaign authority |
| `bun test ./tests/scaffold ./tests/evaluation` | Focused entrypoint and preparation regression |
| `bun test ./tests/scaffold` | Entrypoint regressions only; inspect current expectations, not preparation acceptance |
| `bun run test:watch` | Watch current tests |
| `bun run lint` | Biome recommended lint on all `src/` and `tests/` TypeScript files; read-only; errors and warnings fail |
| `bun run lint:fix` | Explicitly apply safe Biome lint fixes; remaining diagnostics fail; no formatting or import organization |
| `./node_modules/.bin/tsc --noEmit --project tsconfig.json` | Source-only typecheck |
| `bun test` | Full discovered current test suite |
| `bun run typecheck` | Source and test-inclusive checks |

Biome is an exact-pinned development dependency configured in `biome.json`.
Use `bun install --frozen-lockfile` to reproduce the checked-in lint tooling.
Biome does not replace import resolution, typechecking or executable regressions.
Retired relay tests were removed explicitly after guarantee mapping (see acceptance snapshot below).

`bun install` is the documented development dependency setup, not an end-user
installation step. Review lockfile/identity before changing dependencies. A missing
local dependency does not authorize registry/auth changes or runtime generation.

No app `build`, `dev` or `deploy` package script currently exists. Do not invent a
working command. Pin tooling and add declared commands only in an authorized build
implementation. Runtime projection is covered in [deployment.md](deployment.md).

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

Use `bun:test` under `tests/`, mirroring meaningful responsibilities. Domain tables
have independent expected values; use cases exercise injected ports; adapters cover
translation/failures/resource ownership; CLI covers output routes, detached callbacks,
help/errors/exit status/import safety and one actual entrypoint subprocess.

Historical `tests/cli.test.ts`, `tests/application/` and `tests/adapters/` still
reference the retired generic implementation. Preserve them unless migration/removal
is in scope. Last observed broad failures were missing old adapters/use cases and
obsolete command expectations. Their migration must be explicit, not hidden by
weakening tests or permanent excludes. Recheck baseline when related files change.

No current full-suite, Node installation, distribution or real-provider readiness
is claimed. Injected tests prove mechanics only. Host/network/provider checks require
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
JSON-only prepared output and zero host calls in both modes. Non-dry-run must
validate first, then return explicit execution-unavailable failure. `--budget` is
deferred; do not claim a monetary limit. These are required checks, not recorded
passing results. Documentation-only verification does not run a paid campaign.

## Verification snapshot — 2026-11-02

Bun 1.3.12: focused tests 29 pass, 0 fail; source-only typecheck passes.
Full `bun test`: 33 pass, 8 fail, 3 errors from preserved historical commands
and missing retired modules. Full `bun run typecheck` also fails on those historical
imports. These failures remain visible; no exclusions or test weakening were added.


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


## VS Code workspace and Bun breakpoints

Open `agent-plugins.code-workspace` from the repository root:

```bash
code agent-plugins.code-workspace
```

The workspace opens `Repository` and `Agent Plugin CLI` as separate folders.
Repository `.vscode` owns source-inventory/editor checks; app `.vscode` owns Bun
launches, app tasks and Biome. `${workspaceFolder}` in an app configuration resolves
to `apps/agent-plugin`, so the app can also be opened standalone. Opening only the
repository directory does not discover nested app `.vscode` configurations.

Repository search excludes only `apps/agent-plugin/**` to avoid duplicate results
in multi-root mode; the app root remains searchable and visible. When opening the
repository alone, temporarily disable **Use Exclude Settings and Ignore Files**
in Search to include this app, or open the workspace. Future apps need their own
folder entries before adding corresponding repository search exclusions.

### Debug

The recommended extensions are `oven.bun-vscode` and `biomejs.biome`; recommendations
do not install them. Bun must be available on VS Code's PATH. If not, change the
app launch configuration's `runtime` to your local absolute Bun path; do not commit
an operator-specific path. No build or pre-launch dependency installation is needed:
Bun runs TypeScript directly and this app uses `noEmit` and Bun-specific modules.

In Run and Debug, select:

- **Agent Plugin: CLI help** — inspect startup with `--help`.
- **Agent Plugin: Evaluation help** — inspect evaluation option parsing.
- **Agent Plugin: Prepare Skill (dry-run)** — enter an absolute Skill directory
  containing `evals/evals.json`; validates inputs without executing a host.

Set a breakpoint on an executable line in `src/main.ts` (for example the
`createApplication(output)` call) and press F5. All profiles stop on entry; continue
with F5 to reach the selected branch. The program must be `src/index.ts` because
it owns `import.meta.main` startup. Help does not reach evaluation preparation;
use the dry-run profile for that branch. No default profile executes a real campaign.
Debugging Bun does not automatically debug child Goose processes.

Bun's [VS Code support](https://bun.com/guides/runtime/vscode-debugger) is experimental;
configuration validation is not proof of live breakpoint binding. If the extension
fails, use the web inspector from the app directory:

```bash
bun --inspect-brk src/index.ts --help
```

Open the inspector URL printed by Bun. `Bun: Run File` does not debug breakpoints;
use the named F5 profile or `Bun: Debug File`.

### Tasks and lint

Run Task exposes read-only lint, source-only and full typechecks, focused tests
(scaffold, evaluation, fake-host execution) and full tests. Broad checks retain the
historical failures described above; focused success is not full-suite acceptance.
No task installs dependencies, applies lint fixes, starts paid trials or publishes.
Biome uses the app-local installed binary and requires its configuration. Formatting
on save is disabled consistently with `biome.json`; no import-organization/fix-on-save
policy is introduced. Dependencies must already be prepared using the documented setup.

From the repository root, `node scripts/test-vscode-integration.mjs` validates JSON,
folder/path ownership, safe task/launch contracts and actual help/dry-run invocations
with a temporary fixture. It does not start an inspector, verify live extension/LSP
behavior or replace application tests. Root tasks were deliberately reduced from the
obsolete four-creator workflow; builds and publication remain explicit CLI operations.
The workspace and `.vscode` files are source-side development resources, outside
`production.mjs`'s installation allowlist. No runtime mapping or projection changed.


## Profile/registry candidate verification — 2026-11-03

`bun test ./tests/scaffold ./tests/evaluation ./tests/execution`: 52 pass/0 fail;
source-only tsc and Biome lint pass, Bun 1.3.12. Full suite retains 56 pass/8 fail/
3 errors from historical imports/commands; full typecheck also fails on those tests.
No exclusions or legacy reconstruction. Snapshot/profile, real SQLite shared registry,
ordered cleanup and independent process append tested; no native model campaign.
Tests always pass an explicit temporary registry; never use the live user registry.
Import/history/grading/recovery and installed runtime compatibility are not delivered.


## Durable recovery candidate — 2026-11-03

Focused scaffold/evaluation/execution: 70 pass, source tsc/lint/diff pass.
Independent recovery review: 18 pass/94 assertions. Includes SIGKILL owner,
publication reconciliation/corruption refusal, exact schema-v1 migration rollback,
PID/hostname/EPERM/token boundaries and deterministic worker drain under write failure.
Full suite retains 74 pass/8 fail/3 errors, full types historical missing modules.
These are local SQLite/fake-host tests, not native resume or power-loss durability.


## Foundation local acceptance — 2026-11-03 (supersedes historical gate failures)

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


## History slice verification — 2026-11-03

Full bun test83pass0fail427assertions; full typecheck/lint/diff pass. Independent
history tests4pass28assertions. Read-only SQLite fixtures and actual CLI verify
missing registry/no creation, homonyms/revisions, retained attempts, absent proofs,
unchanged registry bytes and unsupported schema refusal. No model or live registry.
