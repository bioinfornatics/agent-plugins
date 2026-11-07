# Goose hook target compatibility

## Recorded source contracts

| Profile | Source commit | PreToolUseResult | Native hook path |
|---|---|---|---|
| `v1.47.0` (default) | `f9c7aaccde4834810dfd13d5efa8f0d39ba28a20` | Absent | `hooks/hooks.json` |
| `main-2b17adc` | `2b17adc33a7176e701c2fef9578a5fc5834ea89a` | Supported, observation only | `hooks/hooks.json` |

Profiles identify inspected source, not installed binary provenance or a minimum published release. Never infer support from a binary reporting 1.47.0 or from the word latest. Unknown profiles fail as invalid usage. Defaulting to the published tag preserves its existing event restrictions.

## Select the source contract before authoring

Choose the recorded revision matching the requested behavior; if the running host
is unknown, report activation as unverified. Route handler/event authoring to
hook-creator's current instructions. Its old `init`/`validate` commands and the
plugin creator validator are retired. Reading a source profile does not configure
or identify an installed binary.

## Native versus adapter

Both inspected HookManager loaders select `<plugin>/hooks/hooks.json`. The distributor-owned `io.github.bioinfornatics.agent-plugins.goose` envelope and its namespaced hook file are not native activation paths. Existing adapter files retain structural validation with an explicit activation warning. Structural success is not installed-host compatibility. Multiple layouts are rejected; do not merge them or guess precedence. Automatic migration preserves native hooks and blocks adapter-only migration pending a reviewed activation decision. New native scaffolds preserve manifest bytes and add root hooks plus a contained handler.

## Observation and safety

PreToolUseResult is emitted after the PreToolUse chain resolves and before tool dispatch or denial return. Its matcher targets the tool name. It reports allow/deny, policy_evaluated and, on denial, blocked_by/reason; tool_call_id correlates lifecycle events. It cannot change the decision. Only PreToolUse and Stop are blocking events. Matching observers are awaited and may add latency; best-effort delivery does not imply durable audit evidence. Never log secrets from tool inputs or reasons.

These profiles scope event recognition and native layout. They do not claim exhaustive support for every newer Goose configuration field; unsupported authoring fields must retain diagnostics. Test actual lifecycle execution on the chosen binary before claiming activation. Installation, direct handler execution and source tests are separate evidence levels.

## Source evidence and refresh

Inspected 2026-10-25, read-only. Sources in [Goose](https://github.com/aaif-goose/goose):
- `crates/goose/src/hooks/mod.rs`: HookEvent/from_name and HookManager::from_plugins at both commits.
- `crates/goose/src/agents/state_machine/ops_toolcalling.rs`: modern run_pre_tool_hooks and result emission.
- `crates/goose/src/agents/state_machine/tests/hooks_lifecycle.rs`: modern allow/deny and tool_call_id scenarios.
- Introduction commit `d0fc739a4`: PreToolUseResult and tool_call_id.

Compare exact source revisions before changing these recorded constraints. The old
creator build/mirror procedure is historical, not current tooling. No runtime
regeneration or new event support follows from this documentation update.

Official current documentation: [Hooks](https://goose-docs.ai/docs/guides/context-engineering/hooks) and [Plugins](https://goose-docs.ai/docs/guides/context-engineering/plugins). Current documentation may describe newer behavior than the default published-tag profile.
