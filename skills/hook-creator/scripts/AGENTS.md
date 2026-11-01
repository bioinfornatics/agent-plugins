# Hook Creator launcher — agent instructions and code map

## Mandatory rule: review documentation impact with every code change

For **every code modification**, assess whether applicable `AGENTS.md` files still
accurately describe the code. Review this map whenever the launcher or a mapped
entry point, command, contract, or execution boundary changes.

- Before editing, read applicable ancestor instructions and relevant source.
- After editing, compare the actual diff against documented symbols, command
  mappings, call order, data contracts, constraints, and verification steps.
- **Automatically update affected `AGENTS.md` content in the same change when
  needed**, without waiting for a separate documentation request. Replace obsolete
  statements rather than appending corrections.
- If no update is needed, briefly explain in the delivery report why the map
  remains accurate; do not add no-change logs here.
- Respect ownership and current write authorization. If an affected file is outside
  scope, conflicts with another contributor, or cannot be edited, report the exact
  required update instead of silently leaving stale guidance or expanding scope.
- Before handoff, verify links and mapped entries. Static checks do not prove
  runtime behavior or agent compliance.

This is an agent instruction, **not an installed hook or CI enforcement**. Its
scope is `skills/hook-creator/scripts/`; external links provide navigation, not
repository-wide authority. Ancestor instructions remain applicable. Paths below
are relative to this document unless explicitly stated otherwise.

## Purpose and progressive reading

This launcher starts the independently contained Node runtime; it does not author,
validate, evaluate, sign, or approve hooks itself.

1. Read the mandatory rule and entry map first.
2. For launcher work, inspect its symbols, ordered execution, and limits below.
3. For application work, read the [CLI map](../../../apps/hook-creator-cli/scripts/AGENTS.md),
   [dispatcher](../../../apps/hook-creator-cli/scripts/cli.ts), and selected command only.
4. Follow deeper imports only when needed to answer the current question.

Keep maps concise, English, source-linked, and free of task history. Source is
authoritative; navigation is not a substitute for inspection.

## Entry points and ownership

```text
hook-creator.mjs                          installation-facing launcher
  -> ../runtime/runtime-manifest.json     validated runtimeEntry
  -> spawn(process.execPath, [entry, ...args])   separate child process
     -> ../runtime/dist/cli.js            generated contained application
        -> isMain(import.meta.url)
        -> run(process.argv.slice(2))     synchronous direct command dispatch
           -> selected imported function (no embedded runner)
```

| Component | Source link | Role |
|---|---|---|
| Launcher | [hook-creator.mjs](hook-creator.mjs) | Top-level execution; no named `main()` |
| Manifest | [runtime-manifest.json](../runtime/runtime-manifest.json) | `schemaVersion: 1`, `logicalName: hook-creator`, `runtimeEntry: dist/cli.js` |
| Contained CLI | [generated cli.js](../runtime/dist/cli.js) | Committed emitted runtime; never edit manually |
| Authoritative CLI | [cli.ts](../../../apps/hook-creator-cli/scripts/cli.ts) | `run(argv)` returns numeric status; `isMain()` guards invocation |
| Native entry | [bun-entry.ts](../../../apps/hook-creator-cli/scripts/bun-entry.ts) | Explicit `process.exitCode = run(...)` |
| Runtime mapping input | [skill-runtime-map.json](../../../config/skill-runtimes/skill-runtime-map.json) | Declares source app/entry and emitted entry |

The manifest names `apps/hook-creator-cli/scripts/cli.ts` as authoritative source.
`apps/` may be absent in installation-only distributions: inspect contained emitted
modules there, but make source changes in an authoring checkout. Never introduce
runtime dependencies on sibling Skills or root tooling.

## Launcher symbols and data contracts

The launcher declares **no named functions, classes, interfaces, or type aliases**.
Anonymous callbacks validate mapping components and handle child events.

| Symbol / object | Responsibility |
|---|---|
| `name`, `major` | Logical name and integer Node major version |
| `skillRoot` | Skill directory derived from `import.meta.url`, not cwd |
| `manifestPath`, `manifest` | Absolute metadata path and parsed JSON value |
| `mapped`, `entry` | Relative runtime mapping and resolved absolute entry |
| `stat` | `lstatSync()` result; require regular file, reject final symlink |
| `child` | `ChildProcess` from `spawn()` |
| Spawn options | `{stdio: "inherit", env: process.env}` |

Imported APIs: `fileURLToPath`, `dirname`, `resolve` locate the Skill;
`readFileSync` and `JSON.parse` load metadata; `isAbsolute`, `split`, and `some`
check the mapping; `lstatSync` checks entry type; `spawn`, `child.once`, and
`process.kill` forward execution and termination. `existsSync` and `sep` are
imported but unused; do not mistake them for behavior or authorize cleanup here.

The manifest also records source-lock and file hashes, but the launcher checks
only version, logical name, mapping syntax, and final entry type—not those hashes,
`runtimeMode`, source provenance, or Node constraint metadata.

## Ordered execution and errors

```text
1. Import built-ins; set name; extract Node major.
2. Require integer major >= 22.
   failure -> console.error; process.exitCode = 1; no child
3. Resolve skillRoot and manifestPath from launcher's module URL.
4. readFileSync -> JSON.parse inside try/catch.
   failure -> regeneration/reinstallation diagnostic; exitCode = 1
5. If manifest is truthy, validate schemaVersion === 1, logicalName === name,
   string runtimeEntry, non-absolute mapping, no empty / "." / ".." components
   (components are checked using both slash and backslash separators).
   invalid -> diagnostic; exitCode = 1
6. Resolve entry under runtime using mapped.split("/");
   lstatSync(entry, {throwIfNoEntry:false}).
   missing, non-file, or final symlink -> diagnostic; exitCode = 1
7. spawn(process.execPath, [entry, ...process.argv.slice(2)], options).
8. Register child.once("error") and child.once("exit") callbacks:
   error -> launch diagnostic; exitCode = 1
   exit without signal -> parent exitCode = code ?? 1
   exit with signal -> process.kill(process.pid, signal)
                       reproduction failure -> exitCode = 1
```

Callbacks are asynchronous event handlers, not sequential calls to both handlers.
The same Node executable, environment, arguments, and terminal streams are
forwarded. This is **not isolation or environment sanitization**.

Observed limits to preserve or explicitly reassess:

- Falsy parsed JSON skips `if(manifest)` without a mapping diagnostic.
- `lstatSync()` is outside the manifest-read catch; filesystem exceptions can escape.
- Rejecting the final symlink does not reject every ancestor symlink or establish
  complete path integrity. No OS sandbox or manifest-hash verification is provided.
- Hook commands are executable, security-sensitive plugin components. The CLI
  creates/inspects files; this launcher does not execute generated handlers.

## Application navigation and security boundaries

| Command family | Imported module / public seam |
|---|---|
| `init` | [init_hook.ts](../../../apps/hook-creator-cli/scripts/init_hook.ts): `parseInitArgs` -> `initHook` |
| `validate` | [validate_hook.ts](../../../apps/hook-creator-cli/scripts/validate_hook.ts): `validateHook` |
| `eval-manifest create|verify` | [evaluation_run_manifest.ts](../../../apps/hook-creator-cli/scripts/evaluation_run_manifest.ts): `writeEvaluationRunManifest`, `verifyEvaluationRunManifest` |
| `attestation create|verify` | [evidence_attestation.ts](../../../apps/hook-creator-cli/scripts/evidence_attestation.ts): `writeEvidenceAttestation`, `verifyEvidenceAttestation` |
| `approval` | [production_approval.ts](../../../apps/hook-creator-cli/scripts/production_approval.ts): `writeApprovalRequest`, `updateApproval`, `inspectApproval` |

Read the CLI map for all approval actions, output contracts, and call order.
`approval consume` validates the purpose argument and verifies exact bindings;
purpose is not bound into the signed approval. It does not deploy, install,
record consumption, or grant this agent permission. Signed evidence is distinct
from human approval and from observed host compatibility.

Use the vendored [hooks.md](../references/hooks.md) source and recorded
[target compatibility](../references/goose-target-compatibility.md); the latter
clarifies stale snapshot layout. Generate hooks only as plugin components; only
`PreToolUse` and `Stop` block. Native generation uses `hooks/hooks.json`, not an
unverified namespaced adapter. Configuration validation is not handler safety proof.

## Verification and change checklist

Run gates from repository root unless the command explicitly changes directory.

- Instruction-only edits: check relative links, actual symbol/entry mappings,
  command coverage, Markdown fences, line budget, and diff. Do not rebuild solely
  because this map changed.
- CLI changes: `(cd apps/hook-creator-cli && npm run build && npm test)`.
  See [build.mjs](../../../apps/hook-creator-cli/scripts/build.mjs) and
  [test.mjs](../../../apps/hook-creator-cli/scripts/test.mjs); tests rebuild first.
- Runtime changes: edit source, then `npm run build:skill-runtimes` and
  `npm run check:skill-runtime-dist-drift`; shared contracts need their build first.
- Review inventory/projection impact: root instructions govern
  `npm run check:change-set-inventory`, `npm run test:distribution`, and
  `npm run test:production` when applicable.
- Do not build/retire dist concurrently with consumers. Never test against live
  `~/.agents` installations. This file grants no Git, release, credential, remote,
  installation, or paid-execution authority.

Report source inspection, static checks, executed tests, generated-output drift,
and proven host behavior separately. This is an entry-seam map, not an exhaustive
transitive inventory.
