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
| `bun run start evaluation --skills /path/to/skill` | Validate then fail explicitly: execution unavailable |
| `bun test ./tests/scaffold ./tests/evaluation` | Focused entrypoint and preparation regression |
| `bun test ./tests/scaffold` | Entrypoint regressions only; inspect current expectations, not preparation acceptance |
| `bun run test:watch` | Existing watch script, includes historical tests and their failures |
| `bun run lint` | Biome recommended lint on all `src/` and `tests/` TypeScript files; read-only; errors and warnings fail |
| `bun run lint:fix` | Explicitly apply safe Biome lint fixes; remaining diagnostics fail; no formatting or import organization |
| `./node_modules/.bin/tsc --noEmit --project tsconfig.json` | Source-only typecheck |
| `bun test` | Full discovered test suite; historical references currently fail |
| `bun run typecheck` | Source and test-inclusive checks; historical imports currently fail |

Biome is an exact-pinned development dependency configured in `biome.json`.
Use `bun install --frozen-lockfile` to reproduce the checked-in lint tooling.
Historical test sources remain in lint scope even when their imports are retired;
Biome does not replace import resolution, typechecking or executable regressions.

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
