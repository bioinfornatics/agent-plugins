# Goose hook target compatibility

## Recorded source contracts

| Profile | Source commit | PreToolUseResult | Native hook path |
|---|---|---|---|
| `v1.47.0` (recorded baseline) | `f9c7aaccde4834810dfd13d5efa8f0d39ba28a20` | Absent | `hooks/hooks.json` |
| `main-2b17adc` | `2b17adc33a7176e701c2fef9578a5fc5834ea89a` | Supported, observation only | `hooks/hooks.json` |

Profiles identify inspected source, not installed binary provenance or a minimum published release. Never infer support from a binary reporting 1.47.0 or from the word latest. An unknown target is a review gap, not evidence of support. The published tag is the conservative recorded baseline.

## Apply the recorded contract manually

Choose the inspected source revision before authoring or review. The v1.47.0 row
is the conservative recorded baseline, not a current CLI default. There is no
current `--goose-target`, hook init or hook component validation command. If the
requested binary/revision is unknown, report compatibility as unverified rather
than choosing a newer profile from its version label.

## Native versus adapter

Both inspected HookManager loaders select `<plugin>/hooks/hooks.json`. The
historical distributor-owned `io.github.bioinfornatics.agent-plugins.goose`
envelope and namespaced hook file are not native activation paths. Do not treat
an adapter's structural review as observed activation, combine layouts or guess
precedence. Multiple layouts are rejected rather than merged; the review preserves native hooks and blocks adapter-only migration without verified activation. New hook authoring must preserve manifest bytes unless a separately authorized manifest change is required. Preserve existing files; adapter-only migration requires a reviewed
activation decision. New native components retain the existing manifest and add
root hooks plus contained handlers, not a second plugin scaffold.

## Observation and safety

PreToolUseResult is emitted after the PreToolUse chain resolves and before tool dispatch or denial return. Its matcher targets the tool name. It reports allow/deny, policy_evaluated and, on denial, blocked_by/reason; tool_call_id correlates lifecycle events. It cannot change the decision. Only PreToolUse and Stop are blocking events. Matching observers are awaited and may add latency; best-effort delivery does not imply durable audit evidence. Never log secrets from tool inputs or reasons.

These profiles scope event recognition and native layout. They do not claim exhaustive support for every newer Goose configuration field; unsupported authoring fields must remain visible in review findings. Test actual lifecycle execution on the chosen binary before claiming activation. Installation, direct handler execution and source tests are separate evidence levels.

## Source evidence and refresh

Inspected 2026-10-25, read-only. Sources in [Goose](https://github.com/aaif-goose/goose):
- `crates/goose/src/hooks/mod.rs`: HookEvent/from_name and HookManager::from_plugins at both commits.
- `crates/goose/src/agents/state_machine/ops_toolcalling.rs`: modern run_pre_tool_hooks and result emission.
- `crates/goose/src/agents/state_machine/tests/hooks_lifecycle.rs`: modern allow/deny and tool_call_id scenarios.
- Introduction commit `d0fc739a4`: PreToolUseResult and tool_call_id.

Compare exact source revisions when updating recorded contracts. The former
creator CLI's contract modules and generated mirrors are historical; they are
not current source authorities or commands to rebuild. Refresh documentation and
inspect the target loader/event implementation before changing public constraints.

Official current documentation: [Hooks](https://goose-docs.ai/docs/guides/context-engineering/hooks) and [Plugins](https://goose-docs.ai/docs/guides/context-engineering/plugins). Current documentation may describe newer behavior than the recorded published-tag baseline.
