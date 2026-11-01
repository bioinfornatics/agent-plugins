# Skill Creator launcher — agent instructions and code map

## Mandatory rule: review documentation impact with every code change

For **every code modification**, assess whether the applicable `AGENTS.md` files
still accurately describe the code. Review this file whenever the launcher or any
mapped entry point, command, contract, or execution boundary changes.

- Before editing, read the applicable ancestor instructions and the relevant source.
- After editing, compare the actual code diff against the documented symbols,
  command mappings, call order, data contracts, constraints, and verification steps.
- **Automatically update affected `AGENTS.md` content in the same change when
  needed**, without waiting for a separate documentation request. Remove obsolete
  statements; do not merely append corrections.
- If no update is needed, state briefly in the delivery report that documentation
  impact was reviewed and why the existing map remains accurate. Do not add a
  no-change log to this file.
- Respect ownership and write authorization. If an affected file is outside the
  authorized scope, conflicts with another contributor's work, or cannot be edited,
  report the exact required update rather than silently leaving stale instructions
  or expanding scope without permission.
- Before handoff, verify links and mapped entry points. Never claim that static
  documentation checks prove runtime behavior or agent compliance.

This is an agent instruction, not an installed hook or CI enforcement mechanism.
Its directory scope is `skills/skill-creator/scripts/`; references to other paths
provide navigation and do not impose this rule repository-wide. Ancestor rules
remain applicable. All paths below are relative to this file unless stated otherwise.

## Purpose and context budget

The launcher starts the Skill's contained Node runtime. It does not implement
Skill authoring, validation, evaluation, grading, or packaging itself.

Use this map as a navigation index, not a replacement for source inspection:

1. Read the mandatory rule and the entry-point map first.
2. For launcher changes, read only the launcher symbols, call order, and boundaries.
3. For CLI changes, read the dispatcher and only the selected command module.
4. Traverse deeper imports only when the current question requires them.

Keep this file in English, concise, and source-linked. Prefer stable paths and
symbol names over line-number-only references, copied source, exhaustive transitive
inventories, historical logs, or task status. Keep rules separate from observations.
Source is authoritative: refresh the map rather than following stale descriptions.

## Entry-point map and source ownership

```text
skill-creator.mjs                         installation-facing Node launcher
  -> ../runtime/runtime-manifest.json    runtimeEntry mapping
  -> spawn(Node, contained cli.js, args)  separate child process
     -> ../runtime/dist/scripts/cli.js   generated application entry
        -> runCli()                      actual application dispatcher
           -> embedded()                 selects one command module
              -> runEmbedded(entry,args) in-process command boundary
                 -> selected exported main / named entry
```

| Component | Source / navigation | Ownership and role |
|---|---|---|
| Launcher | [skill-creator.mjs](skill-creator.mjs) | Top-level execution; no named `main()` |
| Runtime mapping | [runtime-manifest.json](../runtime/runtime-manifest.json) | `runtimeEntry: dist/scripts/cli.js`; manifest declares source app/entry |
| Contained CLI | [generated cli.js](../runtime/dist/scripts/cli.js) | Committed generated runtime; do not edit emitted code manually |
| Authoritative CLI | [cli.ts](../../../apps/skill-creator-cli/scripts/cli.ts), `runCli()` | Source in the authoring checkout; top-level guard invokes `runCli()` |
| Embedded boundary | [runtime-dispatch.ts](../../../apps/skill-creator-cli/scripts/runtime-dispatch.ts), `runEmbedded()` | Captures command output/status and restores process globals |

The manifest identifies `apps/skill-creator-cli/scripts/cli.ts` as the source.
Authoring paths under `apps/` may be absent in an installation-only distribution;
use the contained emitted modules there, and make source changes in an authoring
checkout. Never introduce runtime dependencies on sibling Skills or root tooling.

## Launcher symbol and object map

`skill-creator.mjs` declares **no named functions, classes, interfaces, or type
aliases**. Its anonymous callbacks validate path components and handle child
`error` and `exit` events.

| Symbol / object | Role |
|---|---|
| `name` | Logical identity, `skill-creator` |
| `major` | Major version extracted from `process.versions.node` |
| `skillRoot` | Skill directory resolved relative to `import.meta.url`, not cwd |
| `manifestPath`, `manifest` | Runtime metadata path and parsed JSON value |
| `mapped`, `entry` | Validated relative mapping and resolved absolute entry |
| `stat` | Node filesystem `Stats` object used for entry-type checks |
| `child` | Node `ChildProcess` returned by `spawn()` |
| Spawn options | `{stdio: "inherit", env: process.env}` |

| Imported API | Use |
|---|---|
| `fileURLToPath`, `dirname`, `resolve` | Locate the Skill and contained entry |
| `readFileSync`, `JSON.parse` | Read/parse the runtime manifest |
| `isAbsolute`, `.split()`, `.some()` | Validate the relative entry mapping |
| `lstatSync`, `stat.isFile()`, `stat.isSymbolicLink()` | Inspect the final entry |
| `spawn`, `child.once` | Launch runtime and register event handlers |
| `process.kill` | Reproduce the child's terminating signal in the parent |

`existsSync` and `sep` are imported but currently unused. Do not treat unused
imports as behavior or expand a documentation change into code cleanup.

## Launcher execution order and failure boundaries

```text
1. Load built-in imports; set logical name; extract Node major version.
2. Require an integer Node major >= 22.
   failure -> console.error; process.exitCode = 1; no runtime launch
3. Derive skillRoot from the launcher's own module URL.
4. Resolve manifestPath; readFileSync -> JSON.parse inside try/catch.
   read/parse failure -> diagnostic; exitCode = 1
5. If manifest is truthy, validate:
   schemaVersion === 1; logicalName === name; runtimeEntry is a string;
   mapping is not absolute and has no empty, ".", or ".." components.
   invalid -> diagnostic; exitCode = 1
6. Resolve entry under runtime; lstatSync(entry,{throwIfNoEntry:false}).
   require a regular file and reject a final-entry symbolic link.
   missing/wrong type -> diagnostic; exitCode = 1
7. spawn(process.execPath,[entry,...process.argv.slice(2)],options).
8. Register child.once("error",handler) and child.once("exit",handler).
   error -> launch diagnostic; parent exitCode = 1
   exit without signal -> parent exitCode = code ?? 1
   exit with signal -> process.kill(process.pid,signal)
                       failure to reproduce signal -> exitCode = 1
```

The event callbacks are asynchronous alternatives, not sequential calls to both
handlers. The same Node executable, arguments, environment, and terminal streams
are used for the child. This forwarding is not isolation or environment sanitization.

Observed limits to preserve or explicitly reassess when changing behavior:

- The launcher checks mapping and final-entry type, not manifest file hashes.
- A parsed but falsy JSON value skips the `if(manifest)` body without an explicit
  mapping-validation diagnostic.
- `lstatSync()` is outside the manifest-read catch; filesystem exceptions there
  are not converted into that catch's diagnostic.
- Rejecting a final-entry symlink does not establish that every ancestor is free
  of symlinks, nor provide an OS sandbox or complete integrity guarantee.

## Application functions, types, and data contracts

Definitions below are in `cli.ts` unless another file is named.

| Kind | Symbol | Responsibility |
|---|---|---|
| Type alias | `Format` | `"text"` or `"json"` |
| Type alias | `Command` | Union of 21 registered commands; excludes early `render-report` and `replay` branches |
| Registry object | `commands` | Per-command `{entry, usage, required}`; `required` is an anonymous argument predicate |
| Function | `hasValue(args, option)` | Find an option with a following non-dash-prefixed value |
| Function | `help(command?)` | Global, dedicated, or generic command help |
| Function | `parseCommon(argv)` | Extract `--quiet`, `--format value`, and `--format=value` |
| Function | `maybeJson(value)` | Parse JSON; otherwise return original text or null |
| Async function | `embedded(command, args)` | Dynamic-import switch that selects the actual exported command entry |
| Exported async function | `runCli(argv)` | Main dispatcher; returns numeric exit code |
| Interface | `EmbeddedResult` in `runtime-dispatch.ts` | `{status: number; stdout: string; stderr: string}` |
| Class | `EmbeddedExit` in `runtime-dispatch.ts` | Carries intercepted `process.exit()` status |
| Exported async function | `runEmbedded(main, argv, options)` in `runtime-dispatch.ts` | Invoke command entry and capture output/status |
| Local function | `append(target, values)` in `runtime-dispatch.ts` | Append intercepted console output |

There are no declared classes or named interfaces in `cli.ts` itself.
Important data shapes:

- Parsed options: `{args, format, quiet, error?}`; defaults are text and non-quiet.
- Embedded execution: `{status, stdout, stderr}`.
- Generic JSON envelope: `{command, status, exit_code, output, stderr}`.
- Full-eval presentation: status, phases, checkpoint, next actions, executable actions.

**Dispatch uses the `embedded()` switch, not `commands[*].entry`.** On command
changes, reconcile the type union, registry, help, switch, and this map.
The top-level CLI guard runs for `import.meta.main` or module URLs outside
`/$bunfs/`; it is not a conventional exact-entry-file comparison.

## Application call order

```text
CLI top-level guard -> process.exitCode = await runCli()
  render-report? -> runRenderReportCli(argv.slice(1)) -> return
  replay?        -> runReplayCli(argv.slice(1))       -> return
  global help?   -> help() -> print                  -> return 0
  otherwise:
    1. argv.shift() -> name -> registry membership check
    2. parseCommon(argv) -> reject invalid format
    3. command help? -> help(name) -> return 0
    4. commands[name].required(args) -> missing input returns 2
    5. candidate only: append selected --format
    6. await embedded(name,args)
       -> dynamic import selected module
       -> runEmbedded(exported entry,args)
          save argv/exit/console/stream methods
          substitute argv; intercept exit and output
          await entry; capture numeric return or EmbeddedExit
          finally restore all saved process globals
          return {status,stdout,stderr}
    7. trim captured output -> maybeJson(stdout)
    8. normalize raw status -> command-specific status interpretation
    9. print dedicated candidate/full-eval or generic text/JSON output
   10. return code -> caller assigns process.exitCode
```

- Unknown commands, invalid formats, and missing dispatcher inputs return `2`.
  Dispatcher predicates are minimum prechecks, not complete command validation.
- `render-report` and `replay` bypass common parsing, embedded capture, and generic
  output normalization; each has its own parser and error handling.
- Most entries consume substituted `process.argv`; the two manual-record commands
  use closures passing `args` directly to `main(args)`.
- `full-eval` passes `{passthroughStderr:true}` for live stderr progress.
- Unexpected embedded exceptions propagate after process globals are restored.
  This global interception is not a concurrency-isolated execution boundary.
- Raw status normally maps `0 -> 0`, `2 -> 2`, everything else to `1`.
  Selected lifecycle-status payloads override that mapping; `blocked` and
  `awaiting-grading` become `3`. Selected failed trigger-eval backend diagnostics
  also become `3`. Consult `runCli()` for the exact accepted-status list.
- Candidate JSON and full-eval have dedicated presentation. Generic JSON always
  prints its envelope, including with `--quiet`; do not describe quiet as universally
  suppressing successful output.

## Feature and command navigation

One selected branch executes per invocation; table order is not execution order.
There are 23 exposed paths: 21 registry commands plus 2 early special branches.
`run_evaluation.ts` re-exports `main` from `evaluation_protocol.ts`.

| Command | Feature | Authoritative module / exported entry |
|---|---|---|
| `render-report` | Retained report to new HTML | [render_evaluation_report.ts](../../../apps/skill-creator-cli/scripts/render_evaluation_report.ts) / `runRenderReportCli` |
| `replay` | One frozen isolated case pair | [replay_evaluation.ts](../../../apps/skill-creator-cli/scripts/replay_evaluation.ts) / `runReplayCli` |
| `run-evaluation` | Isolated activation/behavioral evaluation | [run_evaluation.ts](../../../apps/skill-creator-cli/scripts/run_evaluation.ts) / `main` |
| `prepare-execution` | Paired execution packets | [prepare_execution.ts](../../../apps/skill-creator-cli/scripts/prepare_execution.ts) / `main` |
| `candidate` | Idea to resumable Skill candidate | [idea_to_candidate.ts](../../../apps/skill-creator-cli/scripts/idea_to_candidate.ts) / `main` |
| `validate` | Agent Skills format validation | [quick_validate.ts](../../../apps/skill-creator-cli/scripts/quick_validate.ts) / `main` |
| `design-evals` | Validate/normalize scenarios | [design_evals.ts](../../../apps/skill-creator-cli/scripts/design_evals.ts) / `main` |
| `freeze-evals` | Derive/freeze scenario suites | [freeze_eval_scenarios.ts](../../../apps/skill-creator-cli/scripts/freeze_eval_scenarios.ts) / `main` |
| `analyze` | Analyze authoring-pattern evidence | [analyze_evaluation.ts](../../../apps/skill-creator-cli/scripts/analyze_evaluation.ts) / `main` |
| `evidence-loop` | Governed improvement loop | [evidence_improvement.ts](../../../apps/skill-creator-cli/scripts/evidence_improvement.ts) / `main` |
| `full-eval` | Resumable evaluation orchestration | [full_eval.ts](../../../apps/skill-creator-cli/scripts/full_eval.ts) / `main` |
| `trigger-eval` | Trigger-description evaluation | [run_eval.ts](../../../apps/skill-creator-cli/scripts/run_eval.ts) / `main` |
| `aggregate` | Benchmark aggregation | [aggregate_benchmark.ts](../../../apps/skill-creator-cli/scripts/aggregate_benchmark.ts) / `main` |
| `review` | Generate/serve review viewer | [generate_review.ts](../../../apps/skill-creator-cli/eval-viewer/generate_review.ts) / `main` |
| `verify` | Release-gate verification | [verify_skill_gates.ts](../../../apps/skill-creator-cli/scripts/verify_skill_gates.ts) / `main` |
| `package` | Distributable `.skill` archive | [package_skill.ts](../../../apps/skill-creator-cli/scripts/package_skill.ts) / `main` |
| `usability-study` | Governed session records | [usability_study.ts](../../../apps/skill-creator-cli/scripts/usability_study.ts) / `main(args)` |
| `screen-reader-acceptance` | Manual records/attestations | [screen_reader_acceptance.ts](../../../apps/skill-creator-cli/scripts/screen_reader_acceptance.ts) / `main(args)` |
| `prepare-grading` | Blinded grading requests | [prepare_grading.ts](../../../apps/skill-creator-cli/scripts/prepare_grading.ts) / `mainPrepare` |
| `grading-status` | Pending/completed/stale requests | [prepare_grading.ts](../../../apps/skill-creator-cli/scripts/prepare_grading.ts) / `mainStatus` |
| `import-grading` | Verified judgment import | [import_grading.ts](../../../apps/skill-creator-cli/scripts/import_grading.ts) / `main` |
| `group-grading-batches` | Group pending requests | [batch_grading.ts](../../../apps/skill-creator-cli/scripts/batch_grading.ts) / `mainGroup` |
| `apply-grading-batch` | Fan batch results into judgments | [batch_grading.ts](../../../apps/skill-creator-cli/scripts/batch_grading.ts) / `mainApply` |

## Verification and change checklist

Run commands from the repository root; follow ancestor instructions for additional
gates and the authoritative current build configuration.

- Instruction-only changes: check relative links, symbol/entry mappings, command
  coverage, Markdown structure, and the actual diff. Do not rebuild runtimes solely
  because this documentation changed.
- CLI implementation changes: `(cd apps/skill-creator-cli && npm run build && npm test)`.
- Runtime mirror changes: `npm run build:skill-runtimes` followed by
  `npm run check:skill-runtime-dist-drift`; edit sources, not generated outputs.
- Check whether the source inventory or distribution projection needs an update;
  use root instructions for applicable inventory/distribution gates.
- Never use live `~/.agents` installations as automated test targets. No commit,
  push, release, credential change, or remote sync is authorized by this file.

This map covers the launcher, immediate dispatcher, and command entry seams,
not exhaustive command internals. Distinguish source inspection, executed tests,
generated-output equivalence, and proven host behavior in every delivery report.
