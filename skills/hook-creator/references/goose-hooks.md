# Goose hooks — current official inventory

Retrieved **2026-11-07**. Status: documented, not hook-lifecycle integration-tested.
Read only for Goose targets; event names and blocking rules are not cross-host defaults.

## Sources and version boundary

- [Official Hooks reference](https://goose-docs.ai/docs/guides/context-engineering/hooks), retrieved as Markdown on 2026-11-07.
- [Goose v1.57.0 — stable release checked 2026-11-07](https://github.com/aaif-goose/goose/releases/tag/v1.57.0), API checked 2026-11-07: v1.57.0 published 2026-10-28T19:26:10Z.
- Release notes inspected; they do not establish a tested hook contract or a verified minimum supported version. Current live documentation can advance independently of the stable binary.
- [Target details](goose-target-compatibility.md) and [versioned evidence](compatibility-matrix.md) retain exact distinctions. Do not infer support for every documented feature from the release label.

## Answer citation and freshness

When answering which Goose hook events exist or which can block, cite the
[official Hooks reference](https://goose-docs.ai/docs/guides/context-engineering/hooks)
in the delivered answer. Reading this inventory without citing its official source
does not satisfy the source-backed answer requirement. State the date of the
source used and distinguish documented capabilities from exact-version runtime
activation evidence; do not imply that documentation proves host execution.

The retained release observation is **Goose v1.57.0**, not a promise of "latest".
Its tagged release metadata and notes were rechecked on **2026-11-09**; the notes
contain no hook-contract change claim. The live Hooks documentation was also
rechecked on **2026-11-09** and still documents the twelve events below. These
separate checks do not bind live documentation to the v1.57.0 binary or establish
an open-ended supported range. Refresh the official source for current requests;
if access is unavailable, disclose the retained date and unverified freshness.

## Documented events

| Event | When it runs | Matcher target |
|---|---|---|
| `SessionStart` | A session starts | None |
| `SessionEnd` | A session ends | None |
| `Stop` | goose finishes a turn or receives a stop event | None |
| `UserPromptSubmit` | The user submits a prompt | Prompt text |
| `PreToolUse` | Before goose runs a tool | Tool name |
| `PreToolUseResult` | After the `PreToolUse` chain resolves, for allowed and denied calls alike, before the tool runs or the denial is returned. Observation only | Tool name |
| `PostToolUse` | After a tool succeeds | Tool name |
| `PostToolUseFailure` | After a tool fails | Tool name |
| `BeforeReadFile` | Before goose reads a file | File path |
| `AfterFileEdit` | After goose successfully edits a file | File path |
| `BeforeShellExecution` | Before goose runs a shell command | Shell command |
| `AfterShellExecution` | After goose successfully runs a shell command | Shell command |

## Configuration and payload

Native plugin component: `<plugin>/hooks/hooks.json`; top-level `hooks` maps event
names to rule arrays, each rule contains optional regex `matcher` and a `hooks`
action array. Command handlers receive JSON on stdin with event/session identity
and optional tool, input, path, command and working-directory fields. Read the
complete current [payload reference](https://goose-docs.ai/docs/guides/context-engineering/hooks#hook-payload)
before authoring an event-specific parser; never assume every field is present.

Actions use documented command strings with `${PLUGIN_ROOT}` for contained plugin
paths. Matcher regexes are unanchored unless explicitly anchored; omit a matcher
or use `.*` for all, never bare `*`. File/shell post-events require successful tools.
Default action timeout is 30 seconds; dependencies and executable modes remain
operator prerequisites, not built-in sandbox guarantees.

## Authority and failures

Only PreToolUse and Stop block. Explicit denial uses exit 2 with actionable stderr
or documented stdout JSON `{"decision":"block","reason":"..."}`. Other nonzero
statuses are not automatic denial. Failures default to allow; selected PreToolUse
command actions can opt into documented `on_failure: block`. It does not make
invalid/skipped configuration or matcher rules fail closed. Stop remains fail-open;
its consecutive block cap is governed by `GOOSE_STOP_HOOK_BLOCK_CAP`.

PreToolUseResult observes the resolved allow/deny result and cannot change it;
observers are awaited, so latency is possible, but delivery is best effort rather
than durable auditing. SubagentStart/SubagentStop are not emitted according to
the current troubleshooting reference; they are not added to the event catalogue.

## Verification

Compile matcher patterns, inspect paths/configuration and run only authorized inert
handler tests. Payload command strings remain data. Direct handler exit/output proof
does not establish host dispatch, timeout recovery, lifecycle activation or a support
range. No handler, host, model, installation or credentials were used for this inventory.
