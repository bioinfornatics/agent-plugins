# Plugin Creator launcher — agent instructions and code map

## Mandatory rule: review documentation impact with every code change

For **every code modification**, assess whether applicable `AGENTS.md` files
still accurately describe the code. Review this map when the launcher or a mapped
entry point, command, contract, execution boundary, or verification step changes.

- Before editing, read ancestor instructions and the relevant source.
- After editing, compare the actual diff with documented symbols, command mappings,
  ordered calls, data contracts, ownership, security limits, and verification gates.
- **Automatically update affected `AGENTS.md` content in the same change when
  needed**, without a separate documentation request. Replace obsolete statements;
  do not merely append corrections.
- If no update is needed, briefly explain in the delivery report why the map remains
  accurate. Do not add no-change logs to this file.
- Respect authorization and ownership. If an affected document is outside permitted
  scope, conflicts with another contributor's work, or cannot be edited, report the
  exact required update rather than expanding scope or silently leaving it stale.
- Before handoff, verify links and mapped entry points. Static checks do not prove
  runtime behavior, host compatibility, or agent compliance.

This is an agent instruction, **not an installed hook or CI enforcement mechanism**.
Its directory scope is `skills/plugin-creator/scripts/`; cross-directory links are
navigation, not repository-wide scope extension. Ancestor instructions still apply.
Paths below are relative to this document unless stated otherwise.

## Purpose and progressive reading

The launcher starts the contained Node CLI; it does not itself author, migrate,
validate, evaluate, or package plugins.

1. Read the mandatory rule and entry map first.
2. For launcher work, read its symbols, ordered calls, and failure boundaries below.
3. For command work, follow the [source CLI map](../../../apps/plugin-creator-cli/scripts/AGENTS.md),
   then read only the selected command module and relevant contracts.
4. Follow deeper imports only to answer the current question. Source is authoritative.

Keep this map in English, concise, and source-linked. Prefer symbols and stable
paths over line-only references, copied source, transitive inventories, or history.

## Entry points and ownership

```text
plugin-creator.mjs
  -> runtime/runtime-manifest.json (relative to the Skill root)
  -> spawn(process.execPath, [contained cli.js, ...args])
     -> generated cli.js exact-entry guard -> runCli(args)
        -> direct command API, or child() -> runEmbedded(main, args)
```

| Component | Navigation | Contract / owner |
|---|---|---|
| Installation launcher | [plugin-creator.mjs](plugin-creator.mjs) | Top-level Node script; no named `main()` |
| Runtime manifest | [runtime-manifest.json](../runtime/runtime-manifest.json) | Version 1; `logicalName: plugin-creator`; `runtimeEntry: dist/scripts/cli.js` |
| Contained entry | [generated cli.js](../runtime/dist/scripts/cli.js) | Committed generated JavaScript; never edit emitted code manually |
| Source dispatcher | [cli.ts](../../../apps/plugin-creator-cli/scripts/cli.ts) | Authoritative TypeScript; exported `runCli(argv)` |
| Embedded boundary | [runtime-dispatch.ts](../../../apps/plugin-creator-cli/scripts/runtime-dispatch.ts) | `runEmbedded()` captures output and status in-process |
| Runtime projection | [skill-runtime-map.json](../../../config/skill-runtimes/skill-runtime-map.json) | Maps source app/entry and contained related commands |

The manifest names `apps/plugin-creator-cli` and `scripts/cli.ts` as source.
Authoring paths under `apps/` may be absent in installation-only distributions:
inspect contained emitted modules there, but change TypeScript in an authoring
checkout. Preserve the portable Skill and contained runtime ownership; never add
runtime dependencies on sibling Skills or root authoring tooling.

Scope generated artifacts to plugins installed under `.agents/plugins`, including
bundled `skills/`; do not generate standalone `.agents/skills` or `.agents/agents`.
Treat hooks as executable security-sensitive code; keep Goose claims source-verified
and preserve portable components during migration.

## Launcher symbols and objects

The launcher declares **no named functions, classes, interfaces, or type aliases**.
Anonymous callbacks validate mapping components and handle child events.

| Symbol / object | Responsibility |
|---|---|
| `name`, `major` | Logical name and major version from `process.versions.node` |
| `skillRoot` | Root resolved from `import.meta.url`, not cwd |
| `manifestPath`, `manifest` | Manifest location and parsed JSON value |
| `mapped`, `entry` | Validated relative mapping and resolved entry path |
| `stat` | Final-entry filesystem `Stats` |
| `child` | Spawned `ChildProcess` |
| Spawn options | `{stdio: "inherit", env: process.env}` |

Imported APIs: `fileURLToPath`, `dirname`, and `resolve` locate files;
`readFileSync` reads metadata; `isAbsolute` plus split/component checks validate
mapping syntax; `lstatSync` inspects the final entry; `spawn` starts Node;
`child.once` handles events; `process.kill` forwards a terminating signal.
`existsSync` and `sep` are unused imports, not implemented behavior.

## Ordered calls and failure boundaries

```text
1. Load imports -> name -> Node major.
2. Require integer Node major >= 22.
   failure -> diagnostic, exitCode = 1, no launch
3. Resolve skillRoot -> manifestPath.
4. readFileSync -> JSON.parse inside try/catch.
   read/parse failure -> diagnostic, exitCode = 1
5. For truthy manifest, require schemaVersion === 1, matching logicalName,
   string runtimeEntry, nonabsolute mapping, no empty / "." / ".." components.
   invalid mapping -> diagnostic, exitCode = 1
6. Resolve entry under runtime -> lstatSync(entry, {throwIfNoEntry:false}).
   require a regular file, reject final-entry symlink
   missing/wrong type -> diagnostic, exitCode = 1
7. spawn(process.execPath, [entry, ...process.argv.slice(2)], spawn options).
8. Register asynchronous child.once handlers:
   error -> launch diagnostic, parent exitCode = 1
   exit without signal -> parent exitCode = code ?? 1
   exit with signal -> process.kill(process.pid, signal)
                       forwarding failure -> exitCode = 1
```

The event handlers are alternatives, not sequential calls to both handlers.
Arguments, Node executable, environment, and terminal streams are forwarded;
this is not environment sanitization or process isolation policy.

- A parsed falsy JSON value skips the truthy-manifest body without an explicit
  mapping-validation diagnostic.
- `lstatSync()` is outside the read/parse catch; its filesystem exceptions escape.
- Manifest file hashes are not verified by the launcher.
- Final-entry symlink rejection does not verify every ancestor or establish an OS
  sandbox, complete containment proof, or integrity guarantee.

## Application navigation and contracts

[cli.ts](../../../apps/plugin-creator-cli/scripts/cli.ts) exposes 11 commands:
`init`, `doctor`, `validate`, `migrate`, `verify`, `package`, `full-eval`, `ci-eval`,
`independent-review`, `golden-e2e`, and `decision-research`. There are no command
branches before common parsing; global help is the early return.
The [source CLI map](../../../apps/plugin-creator-cli/scripts/AGENTS.md) links each
feature and actual exported handler; it is not a transitive symbol inventory.

- CLI functions: `parseCommon`, `emit`, `usage`, `child`, `wrapped`, `runValidate`,
  `runMigrate`, `runVerify`, `runFullEval`, and exported `runCli`.
- CLI types/objects: `Format`, `Common`, `HELP`, `HERE`, and four exported exit
  constants. `Common` carries `{format, quiet, help, mode, target, args}`.
- Embedded module: interface `EmbeddedResult` is `{status, stdout, stderr}`;
  class `EmbeddedExit` carries intercepted exit status; local `append` captures
  console text. `runEmbedded(main, argv)` restores saved process globals in `finally`.
- `child()` selects four dynamic imports: init/package/migrate/verify `main()`.
  This in-process boundary differs from the launcher's separate child process.
- Normal usage errors return 2; failed evaluation generally returns 1; blocked
  evidence may return 3 and pending approval may return 4. Command payloads control
  some exit mappings; do not assume one universal normalization rule.

## Verification and handoff

Run from the repository root; respect ancestor gates and current build sources.

- Documentation-only: check local relative links, mapped symbols/entries, command
  coverage, Markdown structure, line budget, and the actual diff. No runtime rebuild
  is needed solely for this map.
- CLI changes: `(cd apps/plugin-creator-cli && npm run build && npm test)`.
  Read [build.mjs](../../../apps/plugin-creator-cli/scripts/build.mjs) and
  [test.mjs](../../../apps/plugin-creator-cli/scripts/test.mjs) before execution;
  testing rebuilds and the build copies the hook contract into the app.
- Runtime mirrors: `npm run build:skill-runtimes` then
  `npm run check:skill-runtime-dist-drift`; edit sources, not generated outputs.
- Review source inventory and projection impact; use `npm run check:change-set-inventory`
  and applicable `npm run test:distribution` / `npm run test:production` gates.
- Never target live `~/.agents` installations in automated tests. This file grants
  no commit, push, release, credential, installation, or remote-sync authority.

Report documentation review, source inspection, executed tests, generated-output
checks, and proven host behavior separately. This map covers immediate entry seams,
not exhaustive command internals or proof that every documented boundary is safe.
