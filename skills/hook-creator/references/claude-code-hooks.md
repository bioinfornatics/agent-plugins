# Claude Code hooks — official documentation inventory

Retrieved **2026-11-07**. Status: **documented, not integration-tested**.
This is a Claude Code contract, not the Goose/Agent Plugins hook contract.
Do not transfer event names, blocking rules, or handler schemas between hosts.

## Evidence and scope

- [Official Hooks reference](https://code.claude.com/docs/en/hooks), retrieved 2026-11-07; page metadata reports `dateModified: 2026-11-06T20:48:25.474Z`.
- [Official repository changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md), [retrieved raw content](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md), retrieved 2026-11-07. First observed heading: **2.1.319**; this is an observed changelog heading, not a verified installed version or release date.
- The reference links [Settings](https://code.claude.com/docs/en/settings) for settings resolution. Its Markdown endpoint returned HTTP 403 and was not inspected; managed file paths and full precedence are therefore not inventoried here.
- The HTML Hooks reference was successfully retrieved (HTTP 200). Its Markdown endpoint returned HTTP 403. Search discovery attempts returned no usable results; the official URL was directly verified instead.
- No Claude Code execution, installation, authentication, model calls, or cross-host compatibility tests were performed. No supported-version range is inferred.

## Configuration and ownership

See [Configuration](https://code.claude.com/docs/en/hooks#configuration) and [Hook locations](https://code.claude.com/docs/en/hooks#hook-locations).

JSON nesting: `hooks` → event name → array of matcher groups → each group's `hooks` array of handlers.

| Location | Scope |
|---|---|
| `~/.claude/settings.json` | User, all local projects |
| `.claude/settings.json` | Shared project |
| `.claude/settings.local.json` | Local project |
| Managed policy settings | Organization, administrator-controlled |
| Plugin `hooks/hooks.json` | Enabled plugin |
| Skill YAML frontmatter | Rest of session after invocation |
| Subagent YAML frontmatter | While that subagent runs |

Settings-level hook entries merge. A duplicate handler across settings files runs once; plugin/skill copies stay separate. Matching hooks run in parallel; prompt/agent hooks have a concurrency limit of 12.
Cloud sessions do not read the operator's local user settings automatically; runner/managed-source rules apply.
`/hooks` is a read-only browser. Settings-file edits normally reload through the watcher.
`disableAllHooks` follows settings precedence and cannot disable managed hooks from a lower level.
`allowManagedHooksOnly` blocks user/project/local/plugin hooks, with an exemption for plugins force-enabled through managed `enabledPlugins`; it also affects other customization surfaces.
`strictPluginOnlyCustomization` can exclude non-plugin skill frontmatter hooks. See the source's workspace-trust section rather than assuming project hooks are sandboxed.

## Complete event catalogue

All **33** events listed by the retrieved official lifecycle table appear below.
Matcher `—` means unsupported: a configured matcher is silently ignored.
“Exit 2” describes command exit status, **not** every JSON decision or failure policy.
Full payload schemas and event-specific exceptions: [Hook events](https://code.claude.com/docs/en/hooks#hook-events).

| Event | Trigger | Matcher target | Exit 2 effect |
|---|---|---|---|
| `SessionStart` | Begin/resume session | Start source | User-only error; session proceeds |
| `Setup` | `--init-only`, or `--init`/`--maintenance` in `-p` | `init` / `maintenance` | Ignored |
| `UserPromptSubmit` | Prompt submitted, including self-started turns | — | Reject prompt |
| `UserPromptExpansion` | Typed command expands to prompt | Command name | Block expansion |
| `PreToolUse` | Before tool execution | Tool name | Block tool |
| `PermissionRequest` | Tool needs permission decision | Tool name | Ignored; use decision object |
| `PermissionDenied` | Auto mode denies tool | Tool name | Ignored; denial already occurred |
| `PostToolUse` | Successful tool call | Tool name | Feedback to Claude, no rollback |
| `PostToolUseFailure` | Failed tool call | Tool name | Feedback to Claude, no rollback |
| `PostToolBatch` | Parallel batch resolved, before next model call | — | Stop agentic loop |
| `Notification` | Notification sent | Notification type | Ignored |
| `MessageDisplay` | Assistant text displayed | — | Original text displayed |
| `SubagentStart` | Subagent spawned | Agent type | User-only error |
| `SubagentStop` | Subagent finishes | Agent type | Prevent stopping |
| `TaskCreated` | TaskCreate creates task | — | Roll back creation |
| `TaskCompleted` | Task marked complete | — | Prevent completion |
| `Stop` | Claude finishes response | — | Continue conversation |
| `StopFailure` | Turn ends on API error | Error type | Output/status ignored except terminalSequence |
| `TeammateIdle` | Team teammate about to idle | — | Continue working |
| `InstructionsLoaded` | CLAUDE.md/rules loaded | Load reason | Ignored |
| `ConfigChange` | Configuration changes during session | Configuration source | Block application, except policy_settings |
| `CwdChanged` | Working directory changes | — | User-only error |
| `DirectoryAdded` | `/add-dir` / SDK register_repo_root | Addition source | Debug log only; already added |
| `FileChanged` | Watched file changes | Literal watch filenames | User-only error |
| `WorktreeCreate` | Worktree requested | — | Any nonzero status fails creation |
| `WorktreeRemove` | Hook-created worktree removed | — | Any nonzero fails if directory remains |
| `PreCompact` | Before compaction | `manual` / `auto` | Block compaction |
| `PostCompact` | Compaction completed | `manual` / `auto` | User-only error |
| `PreModelSwitch` | Requested model switch | Canonical destination model | Block switch; user feedback |
| `PostModelSwitch` | Model changed | Canonical destination model | User-only error |
| `Elicitation` | MCP server requests input | MCP server name | Decline without dialog |
| `ElicitationResult` | User response before server delivery | MCP server name | Decline response |
| `SessionEnd` | Session terminates | End reason | User-only error |

`PreToolUse`/`PostToolUse` skip EndConversation calls. `WorktreeCreate` replaces default Git worktree creation; `WorktreeRemove` applies to hook-created worktrees.

## Matchers and handler types

See [Matcher patterns](https://code.claude.com/docs/en/hooks#matcher-patterns).
`*`, empty, or omitted matches all. Values containing only letters/digits/underscore/hyphen/spaces/comma/pipe are exact strings or exact alternatives separated by `|` or `,`. Other values are **unanchored JavaScript regular expressions**; anchor deliberately with `^`/`$`.
`FileChanged` and `StopFailure` have a narrower exact-string character set: letters/digits/underscore/pipe. FileChanged's watch-list construction has additional event-specific rules; do not treat a regex as a filesystem glob.
MCP tool names use `mcp__<server>__<tool>`; plugin agent names can be scoped (`plugin-name:agent-name`). Bash matchers on PreToolUse/PermissionRequest also cover Monitor commands; approval/rewrite limitations require the dedicated Monitor section.

| Handler support | Events |
|---|---|
| All five types | PermissionDenied, PostToolBatch, PostToolUse, PostToolUseFailure, PreToolUse, Stop, SubagentStop, TaskCompleted, TaskCreated, TeammateIdle, UserPromptExpansion, UserPromptSubmit |
| command/http/mcp_tool/prompt; **not agent** | PermissionRequest |
| command/http/mcp_tool; **not prompt/agent** | ConfigChange, CwdChanged, DirectoryAdded, Elicitation, ElicitationResult, FileChanged, InstructionsLoaded, MessageDisplay, Notification, PostCompact |
| command/mcp_tool | SessionStart, Setup |

**Gap:** the remaining eight events' handler-type eligibility was not fully inspected; consult [Prompt-based hooks](https://code.claude.com/docs/en/hooks#prompt-based-hooks) before configuring them. Agent hooks are explicitly experimental.

Common handler keys: required `type`; optional `if`, `timeout` (seconds), `statusMessage`, `once`. `once` is honored only in skill frontmatter.
`if` holds one permission-rule pattern, e.g. `Bash(git *)`; evaluated only for PreToolUse/PostToolUse/PostToolUseFailure/PermissionRequest/PermissionDenied. On other events an `if`-bearing handler **never runs**.
Defaults: command/http/mcp_tool 600 s; prompt 30 s; agent 60 s. The first three default to 30 s for UserPromptSubmit/model-switch events and 10 s for MessageDisplay. SessionEnd shares 1.5 s, extensible by configured timeout to at most 60 s.

- `command`: required `command`; optional `args`, `shell`, `async`, `asyncRewake`, `onFailure`. With `args`, spawn executable directly (no shell); without, shell form. Prefer exec form for path placeholders. Windows `.cmd`/`.bat` shims require shell or explicit underlying executable.
- `http`: required `url`; optional `headers`, `allowedEnvVars`, `onFailure`. JSON POST; header interpolation requires `allowedEnvVars`. Global merged `allowedHttpHookUrls` and `httpHookAllowedEnvVars` constrain every source, including managed hooks.
- `mcp_tool`: required `server`, `tool`; optional `input` with `${path}` substitutions from event JSON. Plugin server name: `plugin:<plugin-name>:<server-name>`. Text result follows stdout parsing; `isError: true` is nonblocking. No automatic OAuth flow. Launch SessionStart and all Setup events skip MCP handlers before clients exist.
- `prompt` / `agent`: required `prompt`, optional `model`; `$ARGUMENTS` substitutes input JSON. Prompt evaluation returns `{ "ok": boolean, "reason": string }` (reason relevant on rejection). PermissionRequest rejection needs its decision object; prompt `ok: false` has no effect there. PermissionDenied prompt/agent output cannot set retry and is discarded.

Script placeholders: `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`. Project root does not follow mid-session worktree changes. Plugin `${user_config.*}` substitution is exec-form only; shell-form references fail. Do not interpolate untrusted payloads into shell source.

## Input, output, and permission decisions

See [Hook input and output](https://code.claude.com/docs/en/hooks#hook-input-and-output) and [Decision control](https://code.claude.com/docs/en/hooks#decision-control).
Command input is JSON on stdin; HTTP input is the POST body. Common fields include `session_id`, `transcript_path`, `cwd`, `hook_event_name`; conditional fields include `prompt_id`, `scratchpad_dir`, `permission_mode`, `effort`, `agent_id`, `agent_type`. Not every event receives every field. Transcript writes are asynchronous; use Stop/SubagentStop `last_assistant_message` for current final text.
Tool events include `tool_name`, `tool_input`, `tool_use_id`; PermissionRequest also provides `permission_suggestions`. ElicitationResult carries `mcp_server_name`, `action`, optional `mode`, `elicitation_id`, `content`. Model-switch events use `from_model`/`to_model`, not a universal model field.
**Payload gap:** this inventory does not reproduce or fully verify every per-event field, tool-specific input variant, watch-path schema, or notification subtype. Follow each event's input subsection before implementation.

Print one JSON object with no surrounding log output and preferably exit 0. `hookSpecificOutput` requires `hookEventName`.
Top-level fields: `continue`, `stopReason`, `systemMessage`, `terminalSequence`; `suppressOutput` is accepted but has no effect. Events can discard fields; universal acceptance is not universal behavior. Relevant context/message strings are capped at 10,000 characters.

- `PreToolUse`: nested `permissionDecision: allow|deny|ask|defer`, `permissionDecisionReason`, `updatedInput`, `additionalContext`. Precedence: **deny > defer > ask > allow**. `defer` requires noninteractive `-p`. `updatedInput` replaces the entire input. Deny/ask rules remain evaluated; allow is not blanket permission bypass. Deprecated top-level approve/block is not the current contract.
- `PermissionRequest`: nested `decision.behavior: allow|deny`; allow may carry `updatedInput`, `updatedPermissions`; deny may carry `message`, `interrupt`. Exit 2 alone does not deny.
- Permission updates: `addRules`, `replaceRules`, `removeRules`, `setMode`, `addDirectories`, `removeDirectories`; destinations `session`, `localSettings`, `projectSettings`, `userSettings`. They can persist changes. A hook cannot enable unavailable/disabled bypass mode; bypass is never persisted as defaultMode.
- `PermissionDenied`: nested `retry: true` tells Claude retry is possible; ignored for classifier no-verdict denials.
- Top-level `decision: block` plus `reason`: UserPromptSubmit/Expansion, PostToolUse/Failure/Batch, Stop/SubagentStop, ConfigChange, PreCompact, TaskCreated. Post-tool feedback cannot undo the tool.
- TeammateIdle/TaskCompleted: exit 2 prevents idle/completion; `continue: false` can stop a teammate entirely, but TaskCompleted ignores it when TaskUpdate triggered the event. TaskCreated ignores continue false.
- `PreModelSwitch`: nested permissionDecision allow/deny/ask, or top-level block. `MessageDisplay.displayContent` changes display only, not transcript/model input.
- `WorktreeCreate`: command stdout path or HTTP nested `worktreePath`; missing path fails. WorktreeRemove discards JSON.
- `Elicitation`/`ElicitationResult`: nested `action: accept|decline|cancel`, optional full `content` replacement, or top-level block. Nested output applies only on exit 0. Hook-answered Elicitation skips ElicitationResult. Do not convert a user decline into accept inadvertently; cancel can retain submitted values, decline withholds them.

Exit 2 blocks only as the event table specifies. Other statuses normally fail open, **but valid JSON can still apply despite a nonzero status**; Worktree and elicitation exceptions differ. Missing-file stderr with empty stdout on Stop/SubagentStop/TaskCompleted or a plugin UserPromptSubmit can turn exit 2 into a nonblocking error. Do not claim a policy is fail-closed from exit codes alone.
`onFailure: block` on command/http (documented from **2.1.295**) covers launch failure, unexpected status, timeout, invalid JSON, HTTP failure. It denies PermissionRequest on failure; it has no effect on Stop/SubagentStop/TaskCompleted/TeammateIdle or background commands. Windows without Git Bash has additional default failure exceptions.
HTTP empty 2xx succeeds; JSON-object 2xx uses structured output; non-2xx, connection errors, invalid bodies normally fail open unless the failure contract blocks.
Async commands cannot block the triggering action; ordinary async timeouts are not enforced. `asyncRewake` wakes Claude on exit 2 rather than retroactively preventing the action.

## Version evidence and follow-up

The changelog's **2.1.318** section changes PostToolUse after interruption: hooks now run on tool calls completing after a new message interrupts the turn, with up to 10 seconds to finish. **2.1.319** fixes hook matchers using a claude.ai connector terminal name being ignored in Claude Desktop (effective once Desktop includes that version).
These are documented host changes, not tested transitions. The coordinator records these observations in the compatibility matrix. A plugin changelog destination has not been established; no release or linked changelog entry is claimed.
The reference explicitly dates skill-hook registration limits to **2.1.304**: per skill source, 1,024 hooks and 16,384 aggregate matcher characters. This is a feature-specific documented threshold, not a supported minimum for this plugin.
Unverified: installed host/version, release timestamps, supported version range, complete per-event payload/output exceptions, remaining handler eligibility, managed settings paths/precedence, executable safety and actual blocking behavior. Documentation evidence does not prove mutual host compatibility.
