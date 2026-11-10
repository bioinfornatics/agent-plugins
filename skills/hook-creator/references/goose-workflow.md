# Goose component workflow

Read this procedure only when Goose is the target of component creation, modification
or audit. It supplements the shared safety, verification and delivery requirements
in [SKILL.md](../SKILL.md); it does not authorize execution or host activation.

## Author or review a Goose component

1. Read [current Goose inventory](goose-hooks.md) and
   [target compatibility](goose-target-compatibility.md) before selecting
   events/layout. Use current official documentation; source review is not
   installed-host activation evidence. Refresh
   [upstream](UPSTREAM.md) before changing public format constraints.
2. Inspect the target plugin's `plugin.json` and existing hooks. For creation with
   no valid manifest, obtain a minimal scaffold through plugin-creator in the same
   workspace. Do not scaffold on an audit-only request or overwrite existing work
   without authorization. Use native `<plugin>/hooks/hooks.json` and contained
   handlers; namespaced adapter layouts need a separate verified activation decision.
3. Select source-supported events. Only `PreToolUse` and `Stop` block; all others
   observe. `PreToolUseResult` is observation-only. A result observer cannot
   reverse denial, and awaited
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
   `{"decision":"block","reason":"..."}`. Failures default to allow; current
   `PreToolUse` actions may explicitly choose documented `on_failure: block`,
   while `Stop` remains fail-open. Review this choice against the requested policy;
   arbitrary nonzero exits are not denial. Never advise a prohibited retry. Use
   `Stop` sparingly: repeated blocks can loop; the host caps them through
   `GOOSE_STOP_HOOK_BLOCK_CAP`.
7. Manually review JSON/manifest, supported events, compiling matchers, nonempty
   commands, valid timeouts, contained existing references, dependencies,
   executable permissions and placeholders. There is no current hook component
   validator; standalone Skill validation does not validate hooks.
8. For audit-only work, deliver concrete defects, minimal proposed corrections and
   unrun checks; do not execute a missing or unsafe handler. Otherwise continue to
   the shared verification steps in [SKILL.md](../SKILL.md#verify-the-selected-component-and-hand-off).

## Goose-specific verification boundaries

For authorized tests, keep host spawn/timeout and Stop block-cap recovery separate
when they cannot be exercised by direct handler calls. Direct handler success is not
lifecycle activation on Goose; configuration review is not blocking-safety proof.
Return to the shared verification and delivery steps in [SKILL.md](../SKILL.md#verify-the-selected-component-and-hand-off).
