# Codex hooks — official documentation inventory

**Inspected: 2026-11-07. Status: documented + selected release-source inspection; no integration test, supported-version range, or agent-plugin compatibility claim.**

Codex currently has a trusted lifecycle-hook framework, **not only `notify`**.
The official `developers.openai.com/codex/hooks` URL redirected to
`learn.chatgpt.com/docs/hooks` during this inspection. This reference records
Codex-specific behavior; do not import Goose's event, matcher or blocking rules.

## Evidence and version boundaries

| Official source inspected | Observed evidence | Boundary |
|---|---|---|
| [Codex hooks](https://developers.openai.com/codex/hooks), redirect to [current hooks page](https://learn.chatgpt.com/docs/hooks) | Events, config, trust hashes, `/hooks`, decisions, MCP, plugins and cloud/local distinctions below | Live documentation, not a binary test |
| [GitHub latest-release API](https://api.github.com/repos/openai/codex/releases/latest) and [release notes](https://github.com/openai/codex/releases/tag/rust-v0.167.0) | Latest stable returned was `rust-v0.167.0`, published `2026-11-06T01:40:00Z`; notes include extraction of PreToolUse handling (#58357) and running it before direct Guardian review (#58368) | Actual API response, not a date-derived or guessed release |
| [Release commit API](https://api.github.com/repos/openai/codex/commits/rust-v0.167.0) and [release tree](https://github.com/openai/codex/tree/086ccc833bc9cf01024ad2dd6af7dbd421b6bf9a/codex-rs/hooks) | Exact release commit `086ccc833bc9cf01024ad2dd6af7dbd421b6bf9a`; hooks engine, event implementations and generated wire schemas present | Selected source files read; not complete runtime verification |
| [Main commit API](https://api.github.com/repos/openai/codex/commits/main) | Main returned `57a808a3920f05f2d4b9eab2d0493e1df136ae6b`, dated `2026-11-07T12:41:14Z` | Newer than stable; not substituted for release behavior |

The hooks page explicitly warns that linked **main** schemas may contain fields
absent from the current release. Its cloud-orchestration coverage also describes
separately managed services, not necessarily the CLI release. No specific
contradiction was established in the selected release files inspected; this is
**not** a claim that every live-doc feature was verified in v0.167.0. Obtain
release-pinned schemas and execution receipts before claiming exact compatibility.

## Supported documented events

All controls below require an enabled, trusted **synchronous** handler. Background
handlers cannot block, approve, rewrite, reject prompts or continue turns.

| Event | Matcher input | Documented effect / control |
|---|---|---|
| `SessionStart` | `source`: `startup`, `resume`, `clear`, `compact`, `fork` | Adds developer context; `continue:false` stops continuation. After compaction, context reaches the immediate next request. |
| `SessionEnd` | `reason`: currently `other` | Main-thread teardown observer; cannot keep the thread open or steer it. Command-only, always synchronous. |
| `SubagentStart` | `agent_type` | Adds context to subagent; `continue:false` does **not** prevent startup. |
| `PreToolUse` | Tool name and aliases | Denies supported tools or rewrites input; may add context. |
| `PermissionRequest` | Tool name and aliases | Before approval: allow, deny, or leave normal approval flow. Any explicit deny wins. |
| `PostToolUse` | Tool name and aliases | Adds context or replaces completed tool result with blocking feedback; **cannot undo side effects**. |
| `PreModelRequest` | Ignored | Diagnostic per request attempt, including retries; cannot block or alter context. |
| `PostModelRequest` | Ignored | Diagnostic outcome (`completed`, `failed`, `cancelled`), optional error and token usage; cannot block or alter context. |
| `PreCompact` | `trigger`: `manual`, `auto` | `continue:false` stops before compaction. |
| `PostCompact` | `trigger`: `manual`, `auto` | `continue:false` stops after compaction. |
| `UserPromptSubmit` | Ignored | Adds context; block decision or exit 2 rejects prompt. |
| `SubagentStop` | `agent_type` | Block decision requests another subagent pass; `continue:false` takes precedence over continuation. |
| `Stop` | Ignored | Block decision creates a continuation prompt, not a rejected turn; `continue:false` takes precedence. Inspect `stop_hook_active` to avoid unintended loops. |
| `Interrupt` | Ignored | Active main-thread interruption observer; not idle/subagent interruption; cannot prevent interruption or restart the turn. |

`SessionEnd` runs on normal closure, archive/delete of an open conversation, or
30-minute idle expiry when no client has it open. Switching threads or
`thread/unsubscribe` does not immediately end the session.

### Tool coverage and matchers

- Matchers use exact-string/alternative mode for literal patterns, and regex mode
  when regex characters are present. The release-source tests establish that `Bash`
  does not match `BashOutput`, `mcp__memory` does not match
  `mcp__memory__create_entities`, and `Edit|Write` selects exact alternatives.
  **Codex** accepts `"*"`, `""`, or an omitted matcher as match-all; this must not
  be generalized to Goose regex handling. See the release-pinned
  [matcher implementation and tests](https://github.com/openai/codex/blob/086ccc833bc9cf01024ad2dd6af7dbd421b6bf9a/codex-rs/hooks/src/events/common.rs).
- Shell and unified `exec_command` match `Bash`; `apply_patch` also matches `Edit`
  and `Write` but retains canonical input name `apply_patch`.
- MCP names look like `mcp__filesystem__read_file`. Other local function tools
  normally participate, for example `update_plan`; `spawn_agent` also matches `Agent`.
- Hosted tools such as `WebSearch` do not use the local function-tool hook path.
  Specialized paths may opt out. `write_stdin` does not repeat PreToolUse for a
  previously approved command; a later poll may deliver its PostToolUse result.
- Nested code-mode calls receive these decisions: PreToolUse denial rejects before
  execution; PostToolUse blocking rejects after execution. PostToolUse
  `continue:false` changes model-facing feedback but does not reject the nested promise.

## Configuration, discovery and trust

| Scope / representation | Documented behavior |
|---|---|
| User | `~/.codex/hooks.json` or inline `[hooks]` in `~/.codex/config.toml` |
| Project | `<repo>/.codex/hooks.json` or inline `[hooks]` in `<repo>/.codex/config.toml`; only loaded from a trusted project layer |
| Other active config layers | Hooks next to active layers or inline config; sources aggregate rather than higher precedence replacing lower hooks. Both representations in one layer merge with a warning. |
| Installed enabled plugin | Default `hooks/hooks.json`; `.codex-plugin/plugin.json` may override via `hooks`: contained `./` path(s), inline hooks object(s). Explicit entries replace the default path. |
| Managed | System, MDM, cloud or `requirements.toml` policy; managed hooks are trusted by policy and cannot be disabled through the user browser. |
| Managed local requirements | `[hooks]` in `requirements.toml`; `managed_dir` / `windows_managed_dir` locate separately distributed scripts. `allow_managed_hooks_only=true` excludes user, project, session and plugin sources. Pin `[features].hooks=true` to enforce managed hooks despite local disabling. |

Hooks are enabled by default; `[features].hooks=false` disables them. `codex_hooks`
is a deprecated feature alias. Administrators can force the feature off in
`requirements.toml`.

Non-managed definitions must be reviewed and trusted before execution. Trust is
recorded against the current hook hash; new/changed hooks are listed but skipped
until trusted. CLI `/hooks` inspects sources, reviews/trusts and disables individual
non-managed hooks; the desktop UI exposes Review hooks and Settings > Hooks.
Plugin script changes require renewed review even if the definition is unchanged.
The one-invocation `--dangerously-bypass-hook-trust` option bypasses persisted trust
for enabled hooks; it is **not recommended as normal policy configuration**.
Project trust and per-hook trust are separate gates.

Release-source inspection confirms user/session-owned `hooks.state` with
`enabled`, `trusted_hash` and `trusted_content_hash`; project/managed/plugin layers
must not write user hook preferences. Source discovery distinguishes optional
warnings from required managed-hook load errors. A trust check is not proof of
script safety, complete audit coverage or sandbox containment.

## Handler and wire contract

Configuration shape is `hooks` → event → array of matcher groups → `hooks` array
of handlers. Optional top-level JSON `description` is metadata.

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "^Bash$",
      "hooks": [{
        "type": "command",
        "command": "/usr/bin/python3 /absolute/path/check_command.py",
        "timeout": 30
      }]
    }]
  }
}
```

- Implemented documented handlers: `command` and `mcp_tool`. `prompt` and `agent`
  parse but are skipped; syntax acceptance is not execution support.
- Commands run in session cwd, not the hook-file directory. Use contained/absolute
  paths and treat stdin content as data, never shell interpolation.
- Handler options include `timeout` (seconds), `statusMessage`, Windows override
  `commandWindows` (TOML also `command_windows`), `additionalContextLimit`, and
  command `async`. Most defaults are **600 seconds**, not Goose's 30 seconds.
  `SessionEnd` and `Interrupt` default to 1 second and permit at most 3 seconds.
- Command stdin is one JSON object: generally `session_id`, nullable
  `transcript_path`, `cwd`, `hook_event_name`, `model`, with event-specific fields
  such as `turn_id`, `tool_name`, `tool_use_id`, `tool_input`, `tool_response`.
  SessionEnd has its narrower teardown payload; do not require every common field
  on every event. Transcript format is not a stable interface.
- Plugin commands receive `PLUGIN_ROOT`, `PLUGIN_DATA` and compatibility aliases
  `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`.
- Empty output with exit 0 succeeds. Plain text adds context only for
  SessionStart, SubagentStart and UserPromptSubmit; tool events ignore it;
  Stop/SubagentStop/Interrupt require JSON for nonempty successful stdout.
- Common JSON fields include `continue`, `stopReason`, `systemMessage`,
  `suppressOutput`, but support is **event-specific**. `suppressOutput` is not
  implemented. Unsupported fields must not be mistaken for enforceable controls.

### Decisions and failure boundaries

PreToolUse denial:

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked by policy."}}
```

Legacy `{"decision":"block","reason":"..."}` or exit **2** with stderr also
blocks PreToolUse. Rewriting requires `permissionDecision:"allow"` plus
`updatedInput`; Bash/apply_patch need a string `command`, while other tools receive
replacement arguments. This allow/rewrite is not PermissionRequest approval.
PreToolUse `ask`, legacy `approve`, `continue`, `stopReason` and `suppressOutput`
are parsed but unsupported: error reported, tool continues.

PermissionRequest uses
`hookSpecificOutput:{hookEventName:"PermissionRequest",decision:{behavior:"allow"}}`
or `behavior:"deny"` with `message`. No decision leaves normal approval in place.
Its reserved `updatedInput`, `updatedPermissions`, and `interrupt` fields fail
closed today. Do not generalize that to all hook failures.

PostToolUse block/exit 2 replaces the result with feedback after the tool has run;
`continue:false` suppresses original result processing, not prior side effects.
`updatedMCPToolOutput` and `suppressOutput` are unsupported and normal result
processing continues after reporting the error. UserPromptSubmit block/exit 2
rejects the prompt; Stop/SubagentStop block/exit 2 instead requests continuation.

Matching hooks from multiple sources all run; matching command handlers launch
concurrently, so denial cannot prevent another matching handler from starting.
Explicit decisions can control supported paths, but errors, timeouts, missing MCP
servers/tools and malformed PreToolUse output can fail open. Hooks are guardrails,
**not a complete enforcement or durable-audit boundary**.

### MCP, asynchronous execution and output

MCP handlers name `server`, `tool`, optional JSON `input` templates, `timeout` and
`statusMessage`. `${field.nested}` expands recursively; whole-value placeholders
retain JSON types. Hooks use already-connected servers: no startup/reconnection,
no tool-approval requests, and no recursive hook triggering. They are synchronous;
the shorter server/hook timeout applies, excluding elicitation-response waiting.
SessionStart may precede MCP readiness. SessionEnd does not support MCP handlers.

Command `async:true` delivers informational output at the next safe point or next
user turn; completion never starts a turn. At most eight background hooks run per
session; others wait. Shutdown cancels unfinished background work and discards
undelivered output. SessionEnd stays synchronous even with `async:true`.

Additional context defaults to about 2,500 tokens per message; oversized output
spills under `<temp_dir>/hook_outputs/<session_id>/<uuid>.txt` with a preview.
`additionalContextLimit` changes this command-handler threshold; 0 removes the
limit. Tool feedback/continuation prompts retain the default. Avoid secrets in
output: spilling can retain it on disk.

## Cloud is a separate scope

The live page documents enterprise Work Cloud with local computer access and dots
using admin-configured **Global MCP hooks** when managed policy/remote hooks are
enabled. It excludes personal accounts and Work Cloud without local computer
access. Cloud orchestration does not load command/prompt/agent handlers, local
config/directories/plugins, environment-scoped hooks or SessionEnd MCP hooks.
Local-only Work/Codex threads retain local hook support. This is documentation of
service behavior, not a tested CLI/plugin-host integration.

## Release-pinned implementation sources inspected

All following links use exact commit `086ccc833bc9cf01024ad2dd6af7dbd421b6bf9a`:

- [Discovery and trust/load policy](https://github.com/openai/codex/blob/086ccc833bc9cf01024ad2dd6af7dbd421b6bf9a/codex-rs/hooks/src/engine/discovery.rs)
- [User/session hook-state ownership](https://github.com/openai/codex/blob/086ccc833bc9cf01024ad2dd6af7dbd421b6bf9a/codex-rs/hooks/src/config_rules.rs)
- [Plugin declaration metadata](https://github.com/openai/codex/blob/086ccc833bc9cf01024ad2dd6af7dbd421b6bf9a/codex-rs/hooks/src/declarations.rs)
- [PermissionRequest decision folding](https://github.com/openai/codex/blob/086ccc833bc9cf01024ad2dd6af7dbd421b6bf9a/codex-rs/hooks/src/events/permission_request.rs)
- [SessionEnd timing/output](https://github.com/openai/codex/blob/086ccc833bc9cf01024ad2dd6af7dbd421b6bf9a/codex-rs/hooks/src/events/session_end.rs)
- [Interrupt advisory behavior](https://github.com/openai/codex/blob/086ccc833bc9cf01024ad2dd6af7dbd421b6bf9a/codex-rs/hooks/src/events/interrupt.rs)
- [Common event/matcher handling](https://github.com/openai/codex/blob/086ccc833bc9cf01024ad2dd6af7dbd421b6bf9a/codex-rs/hooks/src/events/common.rs)
- [Generated schema inventory](https://github.com/openai/codex/tree/086ccc833bc9cf01024ad2dd6af7dbd421b6bf9a/codex-rs/hooks/schema/generated) (tree inspected; not all schemas read)
- [Legacy notify implementation](https://github.com/openai/codex/blob/086ccc833bc9cf01024ad2dd6af7dbd421b6bf9a/codex-rs/hooks/src/legacy_notify.rs)

## Legacy notification is not lifecycle policy

Legacy `notify` spawns an argv command after agent completion and appends JSON as
its final argument, with type `agent-turn-complete`, thread/turn ids, cwd, input
messages and last assistant message. The inspected source nulls stdin/stdout/stderr
and does not wait for a policy verdict. It cannot implement PreToolUse denial or
prompt rejection. Keep it distinct from trusted hooks and from UI notifications.

**Unverified:** installed Codex activation, end-to-end trust persistence, blocking
under real tools, Windows behavior, cloud rollout, and compatibility with this
repository's plugin format. No install, authentication, model run or release was
performed for this inventory.
