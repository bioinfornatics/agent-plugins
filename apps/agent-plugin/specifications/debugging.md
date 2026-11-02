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
- **Current historical tests:** missing retired imports are a known migration issue,
  not a request to recreate the previous generic prompt relay.

## Preparation-mode diagnostics

An execution-unavailable error after successful validation without `--dry-run`
is intentional, not a missing host to configure. Invalid suites must fail first.
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
