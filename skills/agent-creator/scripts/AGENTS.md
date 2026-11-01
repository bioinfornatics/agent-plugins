# Agent Creator launcher — instructions and code map

## Mandatory rule: review documentation impact with every code change

For **every code modification**, review whether applicable `AGENTS.md` files still
accurately describe the changed code, including mapped entry points and boundaries.

- Before editing, read ancestor instructions and the relevant source.
- After editing, compare the actual diff with documented symbols, command mappings,
  ordered calls, data contracts, security/error limits, and verification steps.
- **Automatically update affected `AGENTS.md` files in the same change when needed**,
  without waiting for a documentation request. Replace obsolete statements rather
  than appending corrections.
- If no update is needed, briefly explain why in the delivery report; do not add a
  no-change log here.
- Respect authorization and ownership. If an affected document is outside permitted
  scope, conflicts with another contributor's work, or cannot be edited, report the
  exact required update instead of expanding scope or silently leaving it stale.
- Before handoff, verify relative links and mapped entry points. Static checks do
  not prove runtime behavior or agent compliance.

This is an agent instruction, **not an installed hook or CI enforcement mechanism**.
Its directory scope is `skills/agent-creator/scripts/`; external links are navigation,
not repository-wide authority. Ancestor instructions remain applicable.

## Progressive reading and ownership

1. Read this rule and the entry map first.
2. For launcher work, inspect the launcher and its generation template.
3. For application work, follow the CLI map and read only the selected command.
4. Follow deeper imports only for a concrete question; source overrides this map.

Keep this map English, concise, and source-linked. Prefer stable symbols and paths
rather than line-only references, copied code, exhaustive inventories, or histories.
The launcher starts the contained runtime; it does not author or evaluate agents.

| Component | Relative source / navigation | Responsibility |
|---|---|---|
| Installed launcher | [agent-creator.mjs](agent-creator.mjs) | Generated top-level Node launcher; no named `main()` |
| Launcher source | [generate-skill-runtimes.mjs](../../../scripts/generate-skill-runtimes.mjs), `launcherSource(name)` | Authoritative shared generation template; do not hand-edit generated launcher |
| Mapping declaration | [skill-runtime-map.json](../../../config/skill-runtimes/skill-runtime-map.json) | Agent Creator app, source entry, emitted entry, resources |
| Contained manifest | [runtime-manifest.json](../runtime/runtime-manifest.json) | Generated mapping and file inventory |
| Contained CLI | [cli.js](../runtime/dist/scripts/cli.js) | Generated application entry; never edit emitted code manually |
| Authoritative CLI | [cli.ts](../../../apps/agent-creator-cli/scripts/cli.ts), `runCli()` | TypeScript source in authoring checkout |
| Embedded boundary | [runtime-dispatch.ts](../../../apps/agent-creator-cli/scripts/runtime-dispatch.ts), `runEmbedded()` | Capture command output/status in process |
| Application map | [scripts/AGENTS.md](../../../apps/agent-creator-cli/scripts/AGENTS.md) | Commands, application contracts, feature seams and build gates |

```text
agent-creator.mjs
  -> runtime/runtime-manifest.json: runtimeEntry = dist/scripts/cli.js
  -> spawn(process.execPath, [entry, ...args])          separate child
     -> contained cli.js: isMain() -> runCli()
        -> parseCommon() -> dispatch(command, forwarded)
           -> dynamic import selected module -> runEmbedded(main, args)
              -> selected exported main()             in-process command
```

The manifest records `app: apps/agent-creator-cli`, `sourceEntry: scripts/cli.ts`,
`emittedEntry` and `runtimeEntry: dist/scripts/cli.js`, and `runtimeMode: node-bundled`.
Authoring links under `apps/`, `scripts/`, and `config/` may be absent in an installed
Skill. Inspect contained modules there, but make changes in an authoring checkout.
Never introduce runtime dependencies on sibling Skills or root build tooling.

## Launcher symbols, objects, and APIs

The launcher declares **no named functions, classes, interfaces, or type aliases**.
Anonymous callbacks validate mapping components and handle child events.

| Symbol / object | Role |
|---|---|
| `name`, `major` | Logical identity `agent-creator`; parsed Node major version |
| `skillRoot` | Skill location from `import.meta.url`, independent of cwd |
| `manifestPath`, `manifest` | Runtime metadata location and parsed JSON |
| `mapped`, `entry` | Relative runtime mapping and resolved entry path |
| `stat` | `lstatSync()` result for final-entry type checks |
| `child` | `spawn()` result; child `error` and `exit` event handlers |
| Spawn options | `{stdio: "inherit", env: process.env}` |

`fileURLToPath`, `dirname`, and `resolve` locate files; `readFileSync` and `JSON.parse`
load metadata; `isAbsolute`, `split`, and `some` validate mapping components.
`lstatSync`, `isFile`, and `isSymbolicLink` inspect the entry. `spawn`, `child.once`,
and `process.kill` handle execution and termination. `existsSync` and `sep` are
unused imports, not behavior; this map does not authorize cleanup.

## Ordered execution and failure boundaries

```text
1. Load built-ins; set name; extract Node major.
2. Require integer Node major >= 22.
   failure -> diagnostic, process.exitCode = 1; no child launch
3. Resolve skillRoot and manifestPath from module URL.
4. readFileSync -> JSON.parse inside try/catch.
   failure -> missing/invalid manifest diagnostic, exitCode = 1
5. If manifest is truthy, validate schemaVersion === 1, logicalName === name,
   runtimeEntry string, non-absolute mapping, no empty / "." / ".." components.
   invalid -> unsupported mapping diagnostic, exitCode = 1
6. Resolve entry under runtime; lstatSync(entry, {throwIfNoEntry:false}).
   require regular file, reject final-entry symlink.
   missing/wrong type -> incomplete runtime diagnostic, exitCode = 1
7. spawn(process.execPath, [entry, ...process.argv.slice(2)], options).
8. Register asynchronous child.once handlers:
   error -> launch diagnostic, parent exitCode = 1
   exit without signal -> parent exitCode = code ?? 1
   exit with signal -> process.kill(process.pid, signal)
                       failure to reproduce signal -> exitCode = 1
```

The event handlers are alternatives, not sequential calls to both handlers.
Forwarding preserves the Node executable, arguments, environment, and terminal
streams; it is not sandboxing or environment sanitization.

Observed limits to preserve or explicitly reassess:

- Launcher validation does not verify manifest file hashes or all manifest fields.
- Falsy parsed JSON skips the `if(manifest)` body without a mapping diagnostic.
- `lstatSync()` is outside the read/parse catch; its filesystem exceptions propagate.
- Rejecting the final-entry symlink does not prove symlink-free ancestors or full
  runtime integrity. Runtime mapping validation is not an OS security boundary.
- Application exceptions and output semantics belong to the linked CLI map, not
  this child-forwarding layer.

## Verification and authoring constraints

- Documentation-only changes: check links, symbols, entry mapping, Markdown, line
  budget, and actual diff. Do not rebuild merely because this map changed.
- CLI changes: `(cd apps/agent-creator-cli && npm run build && npm test)` from root.
- Launcher-template/runtime changes: `npm run build:skill-runtimes`, then
  `npm run check:skill-runtime-dist-drift`; edit authoritative sources, not output.
- Review source inventory/projection impact under root instructions; applicable
  gates include `npm run check:change-set-inventory`, `npm run test:distribution`,
  and `npm run test:production`. These commands may write build/test artifacts and
  require appropriate scope; they are not automatic permission to do so.
- Follow [custom-agents.md](../references/custom-agents.md) as vendored format truth:
  only `name`, `description`, `model`; keep agents role-focused, not Skills/plugins/
  recipes or runtime configuration. New installed definitions use `.agents/agents`.
- Never use live user agent files as automated test targets; project installation
  tests must use temporary directories. No commit, push, release, credential change,
  Beads mutation, or remote sync is authorized by this document.

This is a launcher and immediate-entry map, not a transitive inventory. Report
source inspection, executed tests, output equivalence, and host proof separately.
