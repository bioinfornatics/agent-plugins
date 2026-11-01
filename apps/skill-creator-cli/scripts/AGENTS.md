# Skill Creator application scripts — instructions and source map

## Mandatory rule: review documentation impact with every code change

For **every code modification** in this directory, assess whether applicable
`AGENTS.md` files still accurately describe the code, including this map and the
[nested runner map](runners/AGENTS.md) when its boundary is affected.

- Before editing, read ancestor instructions and the relevant source.
- After editing, compare the actual diff against documented symbols, command
  mappings, ordered calls, data contracts, security limits, and verification gates.
- **Automatically update affected `AGENTS.md` content in the same change when
  needed**, without a separate documentation request. Replace obsolete statements.
- If no update is needed, briefly explain in the delivery report why the existing
  map remains accurate; do not add no-change logs here.
- Respect ownership and current write authorization. For an affected file outside
  scope, an ownership conflict, or an unavailable edit, report the exact required
  update instead of silently leaving stale guidance or expanding permission.
- Verify links and mapped entries before handoff. Static checks do not prove
  runtime behavior, host compatibility, or agent compliance.

This is a directory-scoped agent instruction, **not an installed hook or CI
mechanism**. Ancestor rules remain applicable. Links outside this directory are
navigation, not an extension of this rule's scope. This file grants no source,
tracker, Git, release, credential, remote-sync, or installation mutation authority.
Never use live `~/.agents` installations as automated test targets.

## Progressive reading and ownership

1. Start with this rule and the entry seams below.
2. For CLI behavior, read [cli.ts](cli.ts) and only the selected command module.
3. For execution, choose the isolated engine or runner branch below; then follow
   only imports needed to answer the question.
4. For build/test changes, read the wrappers and configuration, not all commands.

Source is authoritative. Keep this map concise, English, and symbol/path based;
exclude copied implementation, exhaustive transitive inventories, and task history.
The [installation launcher map](../../../skills/skill-creator/scripts/AGENTS.md)
explains Node startup and the contained runtime; do not duplicate its full map here.
Edit TypeScript sources, not emitted `dist` or Skill runtime JavaScript. Contained
runtimes must not acquire dependencies on sibling Skills or root authoring tools.

## Entry seams and ordered dispatch

| Entry / source | Role |
|---|---|
| [cli.ts](cli.ts), `runCli(argv)` | Unified dispatcher; numeric return assigned to `process.exitCode` |
| [bun-entry.ts](bun-entry.ts) | Native Bun entry; installs `globalThis.__creatorDependencies`, imports CLI, calls `runCli(process.argv.slice(2))` |
| [runtime-dispatch.ts](runtime-dispatch.ts), `runEmbedded()` | In-process command output/status capture |
| [runtime-deps.ts](runtime-deps.ts), `loadRuntimeDependency<T>()` | Embedded dependency first, then contained `node_modules`, then `vendor/node_modules`; missing package is a packaging defect |
| [package.json](../package.json), [tsconfig.json](../tsconfig.json) | Bin `dist/scripts/cli.js`; NodeNext/ES2022; compile scripts and viewer to `dist` |

```text
CLI top-level guard -> runCli()
  render-report? -> runRenderReportCli(argv.slice(1)) -> return
  replay?        -> runReplayCli(argv.slice(1))       -> return
  global help?   -> help() -> print                  -> return 0
  otherwise:
    shift name -> registry membership -> parseCommon -> help/precheck
    candidate: append selected --format
    embedded(name,args) -> dynamic import -> runEmbedded(selected entry,args)
    trim captures -> maybeJson(stdout) -> normalize status -> present -> return
```

The CLI guard accepts `import.meta.main` **or** URLs outside `/$bunfs/`; it is not
an exact-entry-file comparison. `commands[*].entry` is metadata: the `embedded()`
switch performs dispatch. Reconcile union, registry, help, switch, and maps when
commands change. Two manual-record commands pass `args` directly through closures.
`full-eval` enables live stderr writes with `{passthroughStderr:true}`.

`runEmbedded()` saves argv, exit, console methods, and stream writes; substitutes
argv and capture methods; awaits the command; catches its private `EmbeddedExit`;
then restores saved globals in `finally`. Unexpected exceptions propagate. This
process-global interception is neither concurrency-isolated nor a sandbox; it does
not save every process global (for example `process.exitCode`). Dynamic module
import happens before capture, so import-time side effects are outside it.

## Dispatcher symbols and data contracts

| Kind / symbol | Contract or responsibility |
|---|---|
| `Format`, `Command` (type aliases) | `text \| json`; 21 registered commands, excluding two early branches |
| `commands` (object) | Per-command `{entry, usage, required}`; anonymous minimum-input predicates |
| `hasValue()`, `help()` | Following non-dash value check; global/dedicated/generic help |
| `parseCommon()` | `{args, format, quiet, error?}`; defaults text/non-quiet |
| `maybeJson()` | Parse stdout JSON; otherwise text or null |
| `embedded()`, exported `runCli()` | Select entry; dispatch and present numeric result |
| `EmbeddedResult` (interface) | `{status: number, stdout: string, stderr: string}` |
| `EmbeddedExit` (private class), local `append()` | Intercept exit status; append console captures |

`cli.ts` itself declares no classes or named interfaces. Generic JSON is
`{command, status, exit_code, output, stderr}`. Candidate JSON and full-eval have
dedicated output; full-eval includes phases, checkpoint, next/executable actions.

- Unknown command, invalid format, or missing precheck input returns `2`;
  predicates are not complete command validation.
- Ordinary raw status maps `0 -> 0`, `2 -> 2`, everything else to `1`.
  Selected lifecycle payloads override it; `blocked`/`awaiting-grading` become `3`.
  Selected failed trigger backend diagnostics also become `3`; inspect `runCli()`
  for the exact accepted-status list, not a general success assumption.
- Generic JSON still prints with `--quiet`; successful text is suppressed.
  Candidate/full-eval quiet behavior differs. Early branches bypass common parsing,
  capture, and normalization and own their error handling.

## Complete command navigation

One selected command executes per invocation; table order is not call order.
There are **23 exposed paths: 21 registry commands plus two early branches**.
Entries are exported `main` unless otherwise specified.

| Command | Feature / source entry |
|---|---|
| `render-report` | Retained report to new HTML: [render_evaluation_report.ts](render_evaluation_report.ts), `runRenderReportCli` (early) |
| `replay` | One frozen isolated case pair: [replay_evaluation.ts](replay_evaluation.ts), `runReplayCli` (early) |
| `run-evaluation` | Activation/behavioral isolation: [run_evaluation.ts](run_evaluation.ts), re-exports [evaluation_protocol.ts](evaluation_protocol.ts) `main` |
| `prepare-execution` | Advanced paired packets: [prepare_execution.ts](prepare_execution.ts) |
| `candidate` | Idea to resumable candidate: [idea_to_candidate.ts](idea_to_candidate.ts) |
| `validate` | Agent Skills format: [quick_validate.ts](quick_validate.ts) |
| `design-evals` | Scenario validation/normalization: [design_evals.ts](design_evals.ts) |
| `freeze-evals` | Derived/frozen suites: [freeze_eval_scenarios.ts](freeze_eval_scenarios.ts) |
| `analyze` | Authoring-pattern evidence: [analyze_evaluation.ts](analyze_evaluation.ts) |
| `evidence-loop` | Governed improvement: [evidence_improvement.ts](evidence_improvement.ts) |
| `full-eval` | Resumable orchestration: [full_eval.ts](full_eval.ts); dedicated help in [cli_help.ts](cli_help.ts) |
| `trigger-eval` | First-choice description checks: [run_eval.ts](run_eval.ts) |
| `aggregate` | Benchmark aggregation: [aggregate_benchmark.ts](aggregate_benchmark.ts); dedicated help in `cli_help.ts` |
| `review` | Generate/serve viewer: [generate_review.ts](../eval-viewer/generate_review.ts) |
| `verify` | Release gates: [verify_skill_gates.ts](verify_skill_gates.ts) |
| `package` | `.skill` archive: [package_skill.ts](package_skill.ts) |
| `usability-study` | Governed session records: [usability_study.ts](usability_study.ts), `main(args)` |
| `screen-reader-acceptance` | Manual records/attestations: [screen_reader_acceptance.ts](screen_reader_acceptance.ts), `main(args)` |
| `prepare-grading` | Blind requests: [prepare_grading.ts](prepare_grading.ts), `mainPrepare` |
| `grading-status` | Pending/completed/stale requests: [prepare_grading.ts](prepare_grading.ts), `mainStatus` |
| `import-grading` | Verified judgments: [import_grading.ts](import_grading.ts) |
| `group-grading-batches` | Group pending requests: [batch_grading.ts](batch_grading.ts), `mainGroup` |
| `apply-grading-batch` | Fan out judgments: [batch_grading.ts](batch_grading.ts), `mainApply` |

## Evaluation execution: choose the correct boundary

### Public isolated protocol

[evaluation_protocol.ts](evaluation_protocol.ts) defines `Mode`, `Case`, `main()`,
`resumeEvaluation()`, `project()`, and state helpers `saveState()`/`loadState()`.
`run.json` contains `{state, sha256}`; cases bind manifests/fixtures/config and runs
carry source/evidence hashes. `project()` creates report/review and grading packets.

```text
main -> parse/validate mode, selection, cases, budgets, output
  resume? -> validate retained state/evidence -> import or execute grades -> project
  new:
    validateEvaluationOutput
    per-case dry runIsolatedEvaluation(captureReplay:false) -> freeze bindings
    create private workspace -> acquireDirectoryLockSync -> saveState
    bounded case workers -> runIsolatedEvaluation(expectedBinding)
    retain outputs/evidence -> sort/save state -> project -> index history -> report
    finally release lock; cancellation handlers are removed
```

Resume cannot override frozen candidate inputs or rerun candidates. Optional
`--resume --grade` does launch isolated judges; model-free import is a different
path. Dry runs prepare/hash without Goose/model calls. Cases may run concurrently;
arms and repetitions within each case engine remain sequential.

### Engine, process, and retained evidence

| Source / symbols | Read for |
|---|---|
| [evaluation_isolated.ts](evaluation_isolated.ts): `IsolatedEvaluationOptions`, `runIsolatedEvaluation()`, `validateEvaluationOutput()`, `gradingEnvironment()` | Private paired discovery; options include bindings/replay, selection, fixtures, provider/model, budgets, cancellation |
| Same module: `Invalid`, `ExecutionFailure`; `FileHash`, `Skill`, `Plugin`, `Target`, `Inventory`; `report`, `pendingArchives` | Typed internal failures, closure/inventory shapes, report and cleanup ownership |
| Same module: `checkedPath()`, `filesIn()`, `copyClosure()`, `selectTargets()`, `verifyInventory()` | Ancestor/type checks, clean fixtures, hash-rechecked copies, exact discovery |
| [evaluation_config.ts](evaluation_config.ts): `EvaluationConfigCapture`, `captureEvaluationConfig()`, `stageEvaluationConfig()` | Private provider configuration/support files versus public bindings |
| [evaluation_process.ts](evaluation_process.ts): `ProcessResult`, `runProcess()`, `ProcessDiagnostic`, `DiagnosticChannel` | Owned process groups, byte/decode/exit observations, bounded diagnostics |
| [evaluation_privacy.ts](evaluation_privacy.ts): `EvaluationSensitiveValue`, `EvaluationSensitiveCapture`, `redactSensitiveValues()` | Sensitive-value capture and public diagnostic screening |
| [task_evidence.ts](task_evidence.ts), [goose_session.ts](runners/goose_session.ts) | Frozen task artifacts/final response, visible session projection, confidential raw logs |
| [evaluation_grading.ts](evaluation_grading.ts): `prepareGradingRequest()`, `validateGradingResponse()`, `executeGradingPackets()` | Blind packet bindings, imported judgments, separate host judges |
| [evaluation_replay.ts](evaluation_replay.ts), [evaluation_report.ts](evaluation_report.ts) | Retained recipes/fidelity and report analysis/rendering |

Engine order: validate inputs/output -> select/hash targets/fixtures/config ->
private staging -> freeze/check bindings -> optional safe replay capture -> for
each repetition alternate arm order -> build both private HOME/cwd copies ->
verify **both** discovery inventories before either task -> sequential tasks ->
freeze task files -> session export/final-response attachment/raw logs -> cleanup
-> write owned report. Failure cleanup retains pending raw logs without launching
a candidate/export; it never overwrites a rejected existing output.

Security limits: private discovery is **not OS isolation**. Children retain host
filesystem/network and same-user/session keyring access; full plugins may execute
hooks. Discovery/loaders and ambient extensions are stripped by the isolated
engine; provider config/support secrets are privately staged, not public bindings.
External CLI login caches are not transported. Public diagnostic redaction is not
a claim that task output, visible session logs, or raw logs are safe to publish.
`runProcess()` caps combined output at 16 MiB, requires valid UTF-8, observes first
failure, terminates/escalates owned groups, and provides no automatic retry.
The isolated engine rejects actual execution on Windows (dry preparation differs).
Activation records requested loads, not successful use; completion/configured
identity is not authenticated endpoint proof or semantic quality acceptance.

### Runner-based path (different environment policy)

See [runners/AGENTS.md](runners/AGENTS.md) before modifying adapters.
[run_eval.ts](run_eval.ts) stages description-only trigger inputs, calls
`createRunner()`/`startStream()`, observes first-choice loads with bounded streams,
and distinguishes unavailable infrastructure from negative classifications via
[trigger_evaluation.ts](trigger_evaluation.ts). Runner-based paired execution
injects Skill text directly; it is not activation evidence.
[isolated_host.ts](isolated_host.ts) intentionally inherits operator environment;
its historical filename does not imply private HOME/discovery isolation.

## Build, test, and verification gates

[build.mjs](build.mjs) and [test.mjs](test.mjs) are top-level scripts, not named
`main()` functions. Both derive `root` from their module URL, not shell cwd.

- Build: validate `dist` location -> retire/remove old `dist` -> generate
  `eval-viewer/embedded_viewer.ts` from HTML -> spawn local TypeScript compiler ->
  copy HTML to emitted viewer. Nonzero/null child status fails.
- Test: run build first -> discover `tests/*.test.ts` -> spawn Node test runner with
  file concurrency `2`, package cwd, and `SKILL_CREATOR_SKILL_ROOT`. It removes
  Playwright/Chrome override variables and `NODE_PATH`, not `NODE_TEST_CONTEXT`.
  Remove `NODE_TEST_CONTEXT` before nested test runs; never race builds with readers.
- Instruction-only edits: check links, symbol/entry coverage, line limits, Markdown,
  and actual diff. Do not rebuild generated outputs solely for these instructions.
- Authorized CLI changes: `(cd apps/skill-creator-cli && npm run build && npm test)`.
  Targeted tests consume built `dist`; see [test_cli.test.ts](../tests/test_cli.test.ts),
  [test_isolated_evaluation.test.ts](../tests/test_isolated_evaluation.test.ts),
  [test_evaluation_process.test.ts](../tests/test_evaluation_process.test.ts), and
  [test_isolated_privacy.test.ts](../tests/test_isolated_privacy.test.ts).
- Runtime changes: root `npm run build:skill-runtimes` then
  `npm run check:skill-runtime-dist-drift`; review source inventory, distribution,
  and production gates in [root instructions](../../../AGENTS.md).

Report static inspection, executed tests, runtime equivalence, and actual host
proof separately. This map covers entry seams and execution boundaries, not every
command's internals; follow the selected module for its authoritative contract.
