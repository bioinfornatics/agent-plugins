# OpenCode plugin callbacks and event inventory

## Scope and provenance

Retrieved **2026-11-07**. This is a documentation/source inventory, **not tested
OpenCode support**, an installation recipe, or a portable hooks contract. No
OpenCode process, plugin, model, or handler was executed.

- Canonical documentation URL: <https://opencode.ai/docs/plugins/>. Direct retrieval
  returned **HTTP 403**; the deployed page content/build revision could not be
  verified. The official repository's English documentation source was inspected
  instead; do not describe this as a successful live-page retrieval.
- Repository identity: unauthenticated GitHub API request to
  <https://api.github.com/repos/sst/opencode> redirected to repository ID
  `975734319`, whose `full_name` is **`anomalyco/opencode`**, default branch `dev`.
  Its README links back to `https://opencode.ai` and `/docs`. This resolves the
  old `sst/opencode` versus renamed `anomalyco/opencode` source anomaly; do not
  substitute an unrelated similarly named repository.
- Current development snapshot inspected: **`fdce6365bcdf2af0fdac65d46dc1806a75d10b02`**,
  committer date `2026-11-07T14:42:38Z` ([commit API][dev-api]). Documentation
  SHA-256: `291ebd06ba95d08cb3b657b5f664506334032767c620ed60ee46aed2df69b2e0`.
- GitHub's latest-release endpoint returned **v1.19.5**, published
  `2026-10-28T06:17:49Z`, resolved commit
  **`810c0eba1a7348036f8bdf61e6632d0c36c6876c`** (committer date
  `2026-10-28T06:17:33Z`). This is the exact inspected published source profile,
  not proof of the locally installed version or other release channels.
- [Release notes][release] were inspected: one core fix, failed TUI worker requests
  now return an error instead of leaving callers hanging (#54936). They do not
  establish plugin-hook compatibility or a version-transition support range.
- [Current docs source][docs-dev] and [release docs source][docs-release] have the
  same hook/event content; their sole diff is an SDK link changed from absolute
  to relative. API/types/dispatcher claims below use the **release commit**, not
  an assumed equivalence of all development code.

## Native format: not universal `hooks.json`

The docs describe **JavaScript/TypeScript modules** exporting plugin functions
that receive context and return a hooks object. Local discovery paths are
`.opencode/plugins/` and `~/.config/opencode/plugins/`; npm packages are selected
through the `plugin` array in `opencode.json`. Automatic dependency installation
is documented, but was not performed for this inventory.

This surface is not Goose/Claude command hooks, `hooks/hooks.json`, stdin payloads,
regular-expression matchers, or exit-code-2 denial. There is no universal
`hooks.json` format established by these OpenCode sources. Plugin code uses
JavaScript conditions on callback inputs and mutates supplied output objects.

The docs say hooks run in sequence, with global config, project config, global
plugin directory, then project plugin directory. This is not a promise that
asynchronous event observers finish sequentially (see limitations below).

```ts
// Illustrative shape only; not executed or installation-verified.
export const Example = async () => ({
  "tool.execute.before": async (input, output) => {
    // input.tool identifies the tool; output.args contains mutable arguments.
  },
  event: async ({ event }) => {
    if (event.type === "session.idle") {
      // Observe a session event; this is not a tool-policy decision.
    }
  },
})
```

## Callback keys on the returned hooks object

The [release `Hooks` interface][hooks] is the source of this complete key inventory.
All entries are optional. **D** means demonstrated/explained by the plugins docs;
**T** means declared in TypeScript, not a demonstrated activation guarantee.
Callback signatures return `Promise<void>` unless an entry is a registration
object. Fields below summarize the interface, not a replacement type definition.

| Key | Input / mutable output or registration | Evidence |
|---|---|---|
| `event` | `{ event }`; dispatch by `event.type`, payload in `event.properties` | D/T |
| `config` | Config object; no separate output argument | T |
| `dispose` | No arguments; teardown callback | T |
| `tool` | Map of tool definitions (`description`, args schema, execute) | D/T |
| `auth` | Provider auth loader and OAuth/API methods registration | T |
| `provider` | Provider ID and optional models callback registration | T |
| `chat.message` | Session/agent/model/message/variant → user message and parts | T |
| `chat.params` | Session/agent/model/provider/message → temperature, topP, topK, maxOutputTokens, options | T |
| `chat.headers` | Session/agent/model/provider/message → headers | T |
| `permission.ask` | SDK Permission → status `ask`, `deny`, or `allow` | T; invocation not verified |
| `command.execute.before` | Command/session/arguments → parts | T; source call inspected |
| `tool.execute.before` | Tool/session/call ID → args | D/T |
| `shell.env` | cwd, optional session/call IDs → env | D/T |
| `tool.execute.after` | Tool/session/call ID/args → title, output, metadata | D/T |
| `tool.definition` | Tool ID → description and parameters | T; source call inspected |
| `experimental.chat.messages.transform` | Empty input → messages containing info and parts | T |
| `experimental.chat.system.transform` | Optional session ID/model → system strings | T |
| `experimental.provider.small_model` | Provider → optional model | T |
| `experimental.session.compacting` | Session ID → context strings, optional prompt | D/T |
| `experimental.compaction.autocontinue` | Session/agent/model/provider/message/overflow → enabled | T |
| `experimental.text.complete` | Session/message/part IDs → text | T |

Docs explain `experimental.session.compacting` runs before the continuation
summary: append `output.context`, or set `output.prompt` to replace the default
prompt entirely (then context is ignored). Interface comments say
`experimental.compaction.autocontinue` runs after successful compaction, before
synthetic continuation; setting enabled false skips that turn. Experimental names
are recorded literally, without a stability or compatibility-range promise.

**Important documentation taxonomy correction:** the docs' “Events” section also
lists `shell.env`, `tool.execute.before`, and `tool.execute.after`. These are
**callback keys**, not event-type names in either inspected SDK Event union.
Likewise `command.execute.before` is not `command.executed`, and `permission.ask`
is not `permission.asked` or `permission.replied`.

## Event names documented for `event: async ({ event })`

The following reproduces the docs' event inventory after removing the three
callback keys above. This means **documented event names**, not an assertion that
every name is emitted to every plugin under every frontend/runtime path.

| Category | Exact event types |
|---|---|
| Command | `command.executed` |
| File | `file.edited`, `file.watcher.updated` |
| Installation | `installation.updated` |
| LSP | `lsp.client.diagnostics`, `lsp.updated` |
| Message | `message.part.removed`, `message.part.updated`, `message.removed`, `message.updated` |
| Permission | `permission.asked`, `permission.replied` |
| Server | `server.connected` |
| Session | `session.created`, `session.compacted`, `session.deleted`, `session.diff`, `session.error`, `session.idle`, `session.status`, `session.updated` |
| Todo | `todo.updated` |
| TUI | `tui.prompt.append`, `tui.command.execute`, `tui.toast.show` |

## Declared event surfaces and emission limitations

There is a material distinction between **SDK declarations**, **publish call
sites**, **plugin delivery**, and **observed execution**.

1. `Hooks.event` imports `Event` from the [legacy SDK generated types][sdk-v1].
   Its union additionally declares `server.instance.disposed`,
   `installation.update-available`, `permission.updated`, `vcs.branch.updated`,
   `pty.created`, `pty.updated`, `pty.exited`, and `pty.deleted`. It declares
   `permission.updated`, **not** docs' `permission.asked`.
2. The [release dispatcher][dispatcher] actually subscribes through EventV2Bridge,
   casts `{ id, type, properties: event.data }` with `as any`, and invokes `event`.
   Consequently legacy static types do not enumerate every potential runtime name.
3. The [v2 generated Event union][sdk-v2] declares the following complete grouped
   inventory. This is a **declared stream inventory, not an emission/activation
   receipt**. In particular it lacks `lsp.client.diagnostics`; its absence is a
   source discrepancy, not proof that the documentation name can never occur.

| Group | Exact v2 event names |
|---|---|
| Catalog/integration/models/reference | `catalog.updated`, `integration.updated`, `integration.connection.updated`, `models-dev.refreshed`, `reference.updated` |
| Command/file/install/LSP | `command.executed`, `file.edited`, `file.watcher.updated`, `installation.updated`, `installation.update-available`, `lsp.updated` |
| Message | `message.updated`, `message.removed`, `message.part.updated`, `message.part.removed`, `message.part.delta` |
| Permissions | `permission.asked`, `permission.replied`, `permission.v2.asked`, `permission.v2.replied` |
| Plugin/project | `plugin.added`, `project.updated`, `project.directories.updated` |
| PTY | `pty.created`, `pty.updated`, `pty.exited`, `pty.deleted` |
| Questions | `question.asked`, `question.replied`, `question.rejected`, `question.v2.asked`, `question.v2.replied`, `question.v2.rejected` |
| Server/global | `server.connected`, `server.instance.disposed`, `global.disposed` |
| Session | `session.created`, `session.updated`, `session.deleted`, `session.diff`, `session.error`, `session.status`, `session.idle`, `session.compacted` |
| Session next routing/prompt | `session.next.agent.switched`, `session.next.model.switched`, `session.next.moved`, `session.next.prompted`, `session.next.prompt.admitted`, `session.next.context.updated`, `session.next.synthetic` |
| Session next shell/step | `session.next.shell.started`, `session.next.shell.ended`, `session.next.step.started`, `session.next.step.ended`, `session.next.step.failed` |
| Session next text/reasoning | `session.next.text.started`, `session.next.text.delta`, `session.next.text.ended`, `session.next.reasoning.started`, `session.next.reasoning.delta`, `session.next.reasoning.ended` |
| Session next tools | `session.next.tool.input.started`, `session.next.tool.input.delta`, `session.next.tool.input.ended`, `session.next.tool.called`, `session.next.tool.progress`, `session.next.tool.success`, `session.next.tool.failed` |
| Session next retry/compaction/revert | `session.next.retried`, `session.next.compaction.started`, `session.next.compaction.delta`, `session.next.compaction.ended`, `session.next.revert.staged`, `session.next.revert.cleared`, `session.next.revert.committed` |
| Todo/TUI/VCS/MCP | `todo.updated`, `tui.prompt.append`, `tui.command.execute`, `tui.toast.show`, `tui.session.select`, `vcs.branch.updated`, `mcp.tools.changed`, `mcp.browser.open.failed` |
| Workspace/worktree | `workspace.ready`, `workspace.failed`, `workspace.status`, `worktree.ready`, `worktree.failed` |

An actual publish call was inspected for `command.executed` in
[session/prompt.ts][prompt]: it follows command prompting. Error publication was
also inspected in plugin loading and the task-agent lookup path. The
[EventV2Bridge][bridge] attaches location when publishing and maps data into the
stream payload. These are source observations, **not observed emitted events**.
The plugin listener filters `event.location?.directory` to its instance directory;
SDK stream membership alone therefore cannot promise plugin delivery, including
locationless/server/global events. Complete per-event producer auditing is pending.

## Blocking, async behavior, and exceptions

- **Documented:** the `.env` protection example throws `new Error(...)` inside
  `tool.execute.before` to prevent a read. Arguments are in `output.args`, not
  `input.args`. This documents one interception technique, not a universal safe
  policy system, retry prohibition, file-access sandbox, or shell deny protocol.
- **Source-inspected:** `Plugin.trigger` iterates registered hooks and yields each
  callback through `Effect.promise`; it has no local per-callback catch/timeout.
  Thus trigger callbacks are awaited sequentially and mutations share the output
  object. Exceptions enter the caller's failure path; the inspected task path
  calls the before hook before tool execution. No global fail-open/fail-closed
  behavior, exception-to-model text, retry behavior, or latency bound is asserted.
- **Source-inspected:** event forwarding calls `void hook.event?.(...)` inside
  `Effect.sync`; it does **not await the returned Promise**. An async rejection is
  not awaited/caught there. Synchronous exceptions and surrounding EventV2 listener
  isolation are different concerns; no crash/denial/durable-audit guarantee follows.
- Config and dispose callbacks have explicit logging and ignored-error handling in
  the dispatcher, unlike trigger callbacks. Do not generalize one failure policy
  to all callbacks.
- `permission.ask` has a typed deny status, but its invocation/enforcement was not
  verified. `tool.execute.after` cannot undo already executed side effects; it is
  not established as a universal failure observer. No dedicated
  `tool.execute.failure` key exists in the inspected interface.
- Docs describe `shell.env` for AI tools and user terminals; source inspection
  found it awaited before shell spawning. It injects environment, not a documented
  portable blocking decision. No runtime coverage was tested.

## Remaining verification

Live docs deployment remains inaccessible (403). No supported host range is
claimed. Release-to-release changes, callback activation across native/TUI/desktop
paths, event producers/directory routing, permission-hook enforcement, errors,
timeouts, retries, and policy bypasses remain untested. No installation,
authentication, model execution, Git mutation, or tracker change was performed.

## Official sources

All links below were retrieved/inspected on 2026-11-07 except the inaccessible
canonical docs page explicitly reported above. Immutable source links pin claims.

[dev-api]: https://api.github.com/repos/anomalyco/opencode/commits/fdce6365bcdf2af0fdac65d46dc1806a75d10b02
[release]: https://github.com/anomalyco/opencode/releases/tag/v1.19.5
[docs-dev]: https://github.com/anomalyco/opencode/blob/fdce6365bcdf2af0fdac65d46dc1806a75d10b02/packages/web/src/content/docs/plugins.mdx
[docs-release]: https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/web/src/content/docs/plugins.mdx
[hooks]: https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/plugin/src/index.ts
[dispatcher]: https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/opencode/src/plugin/index.ts
[sdk-v1]: https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/sdk/js/src/gen/types.gen.ts
[sdk-v2]: https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/sdk/js/src/v2/gen/types.gen.ts
[prompt]: https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/opencode/src/session/prompt.ts
[bridge]: https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/opencode/src/event-v2-bridge.ts
