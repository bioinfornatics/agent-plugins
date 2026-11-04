# Debugging and failure investigation

Read when an observed result is wrong or a verification command fails. Then consult
[development.md](development.md) for the affected checks and
[deployment.md](deployment.md) if the installed runtime differs from app execution.

## Evidence-first procedure

1. Record symptom, expected behavior, public seam, exact command/cwd, runtime/host
   versions, exit status/signal and candidate files. Sanitize secrets in diagnostics.
2. Reproduce the smallest failing case without paid calls or live installation changes.
   If credentials, host or artifact are missing, report the exact prerequisite;
   do not substitute a mock and claim real reproduction.
3. Classify before repair: input/CLI, pure rule, application orchestration, adapter
   protocol, process lifetime, host response, archive/SQLite, rendered report or
   packaging/projection. Follow the data from boundary to boundary rather than
   collecting every source file.
4. Form a bounded cause hypothesis and a check that can disprove it. Fix the cause
   within scope; rerun original reproduction and related regressions. After repeated
   failure or scope expansion, stop and request the actual decision.
5. Remove temporary instrumentation; preserve useful sanitized proof in the issue.
   Never hide a failing gate with catch-all success, copied expected algorithms,
   exclusions, timeout increases or fabricated observations.

## Non-obvious failure classes

- **Imports:** importing main/CLI must not parse caller argv, write output or open
  resources. Check actual subprocess import behavior, not only source inspection.
- **Commander output:** verify callback receiver binding and stdout/stderr destination;
  do not duplicate Commander help/parse diagnostics in main.
- **Process lifecycle:** preserve nonzero exit/signal and wait for owned processes.
  Timeout 0 means no execution timer, not `setTimeout(..., 0)`. Async stream draining,
  cancellation and cleanup need evidence; exit 0 is not semantic success.
- **Wrapped runs:** compare direct/wrapped argv, cwd, environment and child status.
  Read wrapped-runtime reliability guidance when available; ordinary deterministic
  unit failures should not be blamed on wrappers.
- **Nested Node runners:** inherited NODE_TEST_CONTEXT can yield misleading child
  success; remove it where required by repository test-runner instructions.
- **Isolation:** HOME alone may not redirect XDG, host overrides, absolute paths,
  keyring or repository discovery. Fake HOME is not a sandbox. Do not copy secrets
  into evidence to make a reproduction easier.
- **Installed runtime:** identify the exact contained entrypoint/manifest and runtime;
  never repair by fallback to `apps/`, PATH modules or an end-user package install.
- **Runtime and lockfile:** check `node --version` (>=22.22.2) and reproduce with
  `npm ci` against the sole `package-lock.json`. Run active regressions with
  `npm test`; dated Bun results do not establish the npm/Node baseline.
- **SQLite import safety:** diagnose the storage-local lazy `node:sqlite` wrapper
  separately from CLI import/startup. Help and preparation must not eagerly load
  SQLite or open a database.
- **Historical tests:** retired relay imports and their dated failures are historical
  evidence, not a current request to recreate the generic prompt relay.

## Preparation-mode diagnostics

The execution-unavailable error belonged to the historical preparation-only slice.
Current non-dry-run executes Goose after validation; do not diagnose it using that
retired baseline. Invalid suites must still fail before host execution.
Dry-run must emit prepared JSON without host calls or discovery chatter. For
Plugins, distinguish skipped absent child suites from all-absent failure and
malformed-present failure; do not require a root suite or silently downgrade the
whole Plugin to a child Skill. Diagnose identity collisions using both target kind
and Skill-directory namespace. No model availability can be inferred from a plan.

## Reporting and escalation

Separate execution status, capture availability, grading failure and business verdict.
Absent telemetry is unknown, not zero. A failing export must not automatically relaunch
an expensive candidate. Report actual proof and limitations, leave unresolved tasks
open, and obtain authority for model calls, credential changes or remote actions.
