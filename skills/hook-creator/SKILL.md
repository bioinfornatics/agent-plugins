---
name: hook-creator
description: Creates, audits and tests plugin lifecycle hooks. Use for hooks.json, handlers, matchers or blocking safety, not standalone roles or whole-plugin packaging.
---

# Hook Creator

## Choose the requested action

Hooks are executable, host-specific plugin components, not standalone
`.agents/hooks` assets or portable core configuration.

| Request | Action |
|---|---|
| Create or modify | Follow component authoring below |
| Audit only | Read the hook source and target contract, inspect the component and report findings without repair or scaffold |
| Test a handler | Review it first, then follow the isolated handler verification below |
| Whole-plugin scaffold, review, packaging or release | Hand off to available plugin-creator instructions |
| Standalone agent / Skill authoring | Route to agent-creator / skill-creator respectively |
| Comparative evaluation | Standalone hooks are unsupported sources; ask for a supported Skill/Plugin and route to skill-creator |

Resolve specialist names from the installed host (plugin installations use
`agent-plugins:<name>`; standalone installations use `<name>`). Disclose unavailable
guidance or loading mechanisms instead of inventing tools or commands.

## Author or review the component

1. Read [hook source](references/hooks.md) and
   [target compatibility](references/goose-target-compatibility.md) before selecting
   events/layout. Recorded source profiles are not installed-binary evidence;
   ambiguous “latest” is not a compatibility claim. Refresh
   [upstream](references/UPSTREAM.md) before changing public format constraints.
2. Inspect the target plugin's `plugin.json` and existing hooks. For creation with
   no valid manifest, obtain a minimal scaffold through plugin-creator in the same
   workspace. Do not scaffold on an audit-only request or overwrite existing work
   without authorization. Use native `<plugin>/hooks/hooks.json` and contained
   handlers; namespaced adapter layouts need a separate verified activation decision.
3. Select source-supported events. Only `PreToolUse` and `Stop` block; all others
   observe. `PreToolUseResult` is absent from recorded v1.47.0 and observation-only
   on recorded main-2b17adc. A result observer cannot reverse denial, and awaited
   observers can add latency without guaranteeing durable audit evidence.
4. Use optional **regular-expression** matchers, not globs. Anchor exact tool names
   (for example `^developer__shell$`); omit for all events or intentionally use `.*`,
   never bare `*`. State the intended event/tool population; the handler decides policy.
5. Use documented `command` actions and `${PLUGIN_ROOT}` paths. Read complete
   stdin JSON, tolerate optional fields and handle unsafe/malformed input without
   shell interpolation. Payload commands are data, not commands to execute.
   Document dependencies and executable mode for directly invoked handlers. Set
   timeout if the default 30 seconds is unsuitable.
6. Keep blocking fast and deterministic, not network telemetry. Deny with exit `2`
   plus actionable stderr, or stdout JSON beginning
   `{"decision":"block","reason":"..."}`. Other failures and timeouts fail open;
   arbitrary nonzero exits are not denial. Never advise a prohibited retry. Use
   `Stop` sparingly: repeated blocks can loop; the host caps them through
   `GOOSE_STOP_HOOK_BLOCK_CAP`.
7. Manually review JSON/manifest, supported events, compiling matchers, nonempty
   commands, valid timeouts, contained existing references, dependencies,
   executable permissions and placeholders. There is no current hook component
   validator; standalone Skill validation does not validate hooks.
8. For audit-only work, deliver concrete defects, minimal proposed corrections and
   unrun checks; do not execute a missing or unsafe handler. Otherwise continue to
   authorized handler tests below.

## Verify handlers and hand off

1. Before execution, inspect handlers and isolate fixtures; never use live operator
   installations. Test only under explicit local execution authority. Do not execute
   command strings from payloads, including supposedly safe near misses.
2. Exercise matcher match/nonmatch, allow/deny for blocking policy, missing optional
   fields, malformed inputs, absent dependencies and recovery. Capture actual
   exit/stdout/stderr. Keep host spawn/timeout and Stop block-cap recovery separate
   when they cannot be exercised by direct handler calls.
3. Report inspected/changed files, matcher rationale, runtime prerequisites, exact
   safety observations and untested failure modes. Direct handler success is not
   lifecycle activation on Goose; configuration review is not blocking-safety proof.
4. For whole-plugin handoff, provide component files and this evidence to
   plugin-creator. Mark missing receipts as missing even if the caller says tests
   passed. Do not duplicate whole-package review or imply publication readiness.

## Execution and tooling boundary

Execute only the requested branch and preserve source/evidence. Authoring does not
permit live installation, credentials, paid campaigns or publication. Report exact
blockers and missing capability rather than weakening criteria.

This Skill is instruction-only; its creator CLI/native executable is retired.
Retained scripts, run-contract, attestation and approval material are historical,
not current executable/signing workflows. Consult current skill-creator instructions
for authorized Skill/Plugin evaluation, grading, export or report review. No current
shared tool validates hook components; a Plugin campaign does not prove standalone
hook effectiveness, host activation or release approval.
