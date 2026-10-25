# Goose Hooks Reference

Use only when the plugin requires event-driven behavior.

Read [Goose target compatibility](goose-target-compatibility.md) before authoring. Native Goose uses hooks/hooks.json; the default published-tag profile does not support PreToolUseResult. The modern recorded profile does, as observation only.

## Layout

```text
my-plugin/
├── plugin.json
├── hooks/
│   └── hooks.json
└── scripts/
    └── handler.sh
```

## Schema pattern

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "developer__shell|developer__edit",
        "hooks": [
          {
            "type": "command",
            "command": "${PLUGIN_ROOT}/scripts/handler.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Supported lifecycle events currently include:

- `SessionStart`
- `SessionEnd`
- `Stop`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `BeforeReadFile`
- `AfterFileEdit`
- `BeforeShellExecution`
- `AfterShellExecution`

Matchers are regular expressions, not globs. Omit `matcher` to match every event. If an explicit catch-all is needed, use `.*`, never bare `*`.

Use `${PLUGIN_ROOT}` for plugin-relative commands.

## Event payload

Hook commands receive JSON on stdin. Common fields include:

- `event`
- `session_id`
- `matcher_context`
- `tool_name`
- `tool_input`
- `message`
- `last_assistant_message`
- `working_dir`

Treat event-specific fields as optional.

## Blocking behavior

Only use blocking when the plugin is intentionally enforcing policy.

`PreToolUse` can block a tool call by:

- exiting with code `2` and writing the reason to stderr, or
- writing JSON beginning with `{"decision":"block","reason":"..."}` to stdout.

A `Stop` hook can keep a turn running, but should be designed carefully to avoid loops.

Most other hook events are observation-only.

## Safety

- Hooks execute local commands. Document this prominently.
- Prefer fail-safe validation scripts but understand goose hooks generally fail open unless a supported blocking signal is used.
- Never interpolate untrusted payload fields directly into shell commands.
- Parse JSON safely.
- Prefer minimal privileges and explicit dependencies.

## Scope boundary

Hooks belong to a plugin and are installed with that plugin under
`.agents/plugins/`. They are not agent definitions under `.agents/agents/`.
Because hook commands execute locally, review every bundled command and keep
blocking hooks fast and deterministic.
