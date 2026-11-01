# Agent Creator CLI — instructions and code map

## Mandatory rule: review documentation impact with every code change

For **every code modification**, review whether applicable `AGENTS.md` files still
accurately describe the changed code and its execution boundaries.

- Before editing, read ancestor instructions and the relevant source.
- After editing, compare the actual diff with documented symbols, command mappings,
  ordered calls, data contracts, error/security limits, and verification steps.
- **Automatically update affected `AGENTS.md` files in the same change when needed**,
  without waiting for a documentation request. Replace obsolete statements.
- If no update is needed, briefly explain why in the delivery report; do not add a
  no-change log to this file.
- Respect ownership and authorization. For an affected file outside permitted scope,
  conflicting with another contributor, or unavailable for editing, report the exact
  required update rather than expanding scope or silently leaving stale guidance.
- Before handoff, check relative links and mapped entry points. Static documentation
  checks do not establish runtime behavior or agent compliance.

This is an agent instruction, **not an installed hook or CI enforcement mechanism**.
Its scope is `apps/agent-creator-cli/scripts/`; external links provide navigation,
not repository-wide authority. Ancestor instructions remain applicable.

## Progressive reading and source ownership

1. Read the mandatory rule and entry map first.
2. Read [cli.ts](cli.ts) and [runtime-dispatch.ts](runtime-dispatch.ts) for dispatch.
3. Select one command from the command table; read its source before deeper imports.
4. Follow supporting seams only for a concrete contract or verification question.

Keep this map concise, English, and source-linked, not a copied implementation,
transitive inventory, task history, or line-number-only index. Source overrides it.
Make TypeScript changes here, never in the portable Skill's generated runtime.

| Entry / ownership | Source | Boundary |
|---|---|---|
| Installed Node launcher | [launcher map](../../../skills/agent-creator/scripts/AGENTS.md) | Generated launcher spawns contained CLI; mapping/integrity limits live there |
| Application entry | [cli.ts](cli.ts), `runCli()`, `isMain()` | Unified command dispatch and presentation |
| Native entry | [bun-entry.ts](bun-entry.ts) | Inject `__creatorDependencies` (`js-yaml`), import CLI, assign awaited exit code |
| Embedded command boundary | [runtime-dispatch.ts](runtime-dispatch.ts), `runEmbedded()` | Invoke selected `main()` in process with output/exit interception |
| Build / package declaration | [package.json](../package.json), [tsconfig.json](../tsconfig.json) | `bin` is `dist/scripts/cli.js`; compile scripts and eval-viewer into `dist` |
| Runtime projection | [runtime map](../../../config/skill-runtimes/skill-runtime-map.json), [generator](../../../scripts/generate-skill-runtimes.mjs) | Copy emitted closure/resources into independently contained Skill runtime |

```text
Node CLI guard: not /$bunfs/ AND isMain()
  -> process.exitCode = await runCli(argv)
Native bun-entry -> inject dependency -> import CLI -> await runCli(argv)
runCli -> parseCommon -> error/help OR dispatch -> dynamic import selected module
  -> runEmbedded(main, forwarded) -> main() -> capture result
  -> classifyExit -> text/JSON presentation -> return numeric exit code
```

`isMain()` accepts `import.meta.main` or compares real paths of module and argv[1];
missing argv[1] or realpath failure returns false. The outer guard excludes `/$bunfs/`.
Installed authoring paths may be absent; inspect emitted modules there, but edit in
an authoring checkout. Never add runtime dependencies on sibling Skills/root tools.

## Dispatcher symbols and data contracts

Definitions are in [cli.ts](cli.ts) unless another file is named.

| Kind | Symbol | Role / shape |
|---|---|---|
| Object | `COMMANDS` | Seven command records `{script, usage}`; `script` is metadata, not dispatch |
| Constant | `GENERAL_HELP` | Global usage, common options, exit descriptions |
| Types | `Command`, `Format` | `keyof typeof COMMANDS`; `"text" \| "json"` |
| Function | `commandHelp(command)` | Usage from registry |
| Function | `parseCommon(argv)` | `{command?, forwarded, format, quiet, help, error?}` |
| Function | `classifyExit(status, output)` | Status/output-based public exit classification |
| Async function | `dispatch(command, args)` | Import switch selecting exported `main()` |
| Exported async function | `runCli(argv)` | Parse, dispatch, classify, present; `Promise<number>` |
| Function | `isMain()` | Entry identity guard |
| Interface | `EmbeddedResult` in [runtime-dispatch.ts](runtime-dispatch.ts) | `{status: number, stdout: string, stderr: string}` |
| Class | `EmbeddedExit` in runtime-dispatch | Internal sentinel carrying intercepted exit status |
| Exported async function | `runEmbedded(main, argv)` | Await zero-argument entry; numeric return or intercepted exit sets status |
| Local closure | `append(target, values)` in runtime-dispatch | String conversion, space joining, newline append |

`cli.ts` declares no classes or named interfaces. Command changes must reconcile
`COMMANDS`, `GENERAL_HELP`, `dispatch()`, help usage, tests, and this map.
**The switch dispatches; `COMMANDS[*].script` does not load a module.**

Public JSON shapes (camel-case `exitCode`, not `exit_code`):

- Parse error: `{ok:false, command:null, exitCode:2, error}`.
- Help: `{ok:true, command:string|null, exitCode:0, help}`.
- Completed dispatch: `{ok, command, exitCode, stdout, stderr}`; trailing newlines
  trimmed; stdout remains a string even when a command printed JSON.
- `spawnError` is currently an empty string; dispatch does not spawn the CLI again.

## Ordered calls and errors

1. `parseCommon()` scans all argv, removes `--quiet`, `-h`/`--help`, and both format
   forms; default is text/non-quiet. First remaining item selects the command.
2. Parse error prints text error + global help or JSON error, then returns `2`.
3. No command with help prints global help; selected command with help prints its
   usage; return `0`. Quiet suppresses help text, not JSON help.
4. `dispatch()` dynamically imports the selected command and calls `runEmbedded()`.
5. Embedded execution saves argv, exit, console log/error, stdout/stderr write;
   substitutes argv `[originalArgv[0] ?? "creator", "embedded-command", ...args]`;
   intercepts output and exit; awaits `main()`; status defaults to `0`.
6. Numeric return or `EmbeddedExit` sets status; `finally` restores all saved globals.
   Unexpected exceptions propagate after restoration, not as `EmbeddedResult`.
7. `classifyExit()` examines status and combined stdout/stderr: status `0` wins;
   overwrite refusal/permission diagnostics become `3`; otherwise status `2` or
   parse/unknown-option/usage diagnostics become `2`; remaining failures become `1`.
8. JSON always prints its envelope, including with quiet. Text emits stdout unless
   quiet + success; stderr is always emitted. Return code to entry caller.

Limits to preserve or explicitly reassess:

- No top-level dispatcher catch: thrown parse/import/application errors can bypass
  classification and JSON envelopes. Standalone module catch guards are not invoked
  by the embedded dispatcher; do not promise uniform sanitized failures.
- Common-option stripping precedes module parsers; module `parseArgs()` exceptions
  may propagate. Registry membership uses `in`, not an own-key whitelist; it is not
  a hardened trust boundary or full argument validation.
- Global interception is not concurrency isolation or sandboxing. It does not
  preserve stream callback/backpressure semantics or capture every console API.
- Exit `3` describes matched operational diagnostics, not a universal lifecycle
  payload status. Quiet is not universal suppression of successful output.

## Commands and feature seams

Seven public commands; each maps to that module's exported `main()`.
Table order is navigation, not invocation order. No Skill Creator command list applies.

| Command | Module | Feature / ordered seam |
|---|---|---|
| `init` | [init_agent.ts](init_agent.ts) | Parse name/options -> validate `NAME_RE`/length -> create output dir -> refuse overwrite -> `renderAgent()` -> write `<name>.md` |
| `validate` | [validate_agent.ts](validate_agent.ts) | `parseAgent()` -> optional filename/name match -> OK or `AgentFormatError` diagnostic |
| `evaluate` | [run_agent_eval.ts](run_agent_eval.ts) | Parse agent/eval set -> `validateEvalSet()` -> baseline -> hash/schedule metadata -> bounded pair jobs -> `runCase()` -> summary; stop heartbeat and clean temporary dirs |
| `grade` | [grade_agent_eval.ts](grade_agent_eval.ts) | Build plans with `verifiedRuns()` before grading -> `gradeRun()` deterministic then optional semantic assertions -> redact/write grading |
| `aggregate` | [aggregate_benchmark.ts](aggregate_benchmark.ts) | `load()` -> `aggregate()`/`generate()` -> telemetry coverage + paired summary -> JSON and Markdown outputs |
| `install` | [install_agent.ts](install_agent.ts) | Require exactly one project/global scope -> `parseAgent()` -> destination `.agents/agents/<name>.md` -> refuse overwrite unless force -> copy |
| `privacy` | [privacy_policy.ts](privacy_policy.ts) | `policy`, `redact`, `put`, `status`, `delete`; versioned protected refs, TTL/integrity checks, audit-before-delete tombstones |

Supporting contracts (read on demand, not additional registered commands):

| Source / symbols | Data contract / verification concern |
|---|---|
| [agent_format.ts](agent_format.ts): `ALLOWED_FIELDS`, `NAME_RE`, `AgentDocument`, `AgentFormatError`, `parseAgent()`, `renderAgent()` | `{name, description:string|null, model:string|null, body}`; strict fields, kebab-case <=64, nonempty body without TODO |
| [assertion_grading.ts](assertion_grading.ts): `AssertionSpec`, `VariantManifest`, `Verdict`, `normalizeAssertions()`, `assertionHashFromManifest()`, `runDeterministic()` | Versioned deterministic/semantic criteria; source hashes bind variants; pass/fail/inconclusive with evidence |
| [repeated_agent_runs.ts](repeated_agent_runs.ts): `AgentRunProfile`, `AgentPairSchedule`, `PairEquivalence`, `scheduleAgentPairs()`, `summarizePairedAgentRuns()` | fast/standard/release = 1/3/5 pairs; index/seed/order; model/tools/fixtures/timeout/turn equivalence |
| [resource_telemetry.ts](resource_telemetry.ts): `NullableTelemetryMetric`, `NormalizedResourceTelemetry`, `timingArtifact()`, `normalizeResourceTelemetry()` | Nullable value + availability reason/source; provider/model/Goose identity; coverage gates efficiency claims |
| [privacy_policy.ts](privacy_policy.ts): `RetentionPolicy`, `ProtectedArtifactRef`, `ArtifactStatus`, `PrivacyDiagnostic`, protected-artifact APIs | Retain/delete-after-aggregate; digest, bytes, timestamps, metadata hash; unavailable reason; redaction is not encryption |
| [evidence_exchange.ts](evidence_exchange.ts): `EvidenceJob`, `EvidenceRun`, `EvidenceDiagnostic`, `exportEvidenceJob()`, `importEvidenceRun()` | Library export/import seam, separate from `evaluate`; integrity-bound external evidence and explicit trust levels |
| [generate_review.ts](../eval-viewer/generate_review.ts): `main()`, `generateHtml()`, `isAllowedOrigin()` | Separate viewer entry, not CLI `review`; bounded files, safe JSON and local origin checks |
| [runtime-deps.ts](runtime-deps.ts): `loadRuntimeDependency()` | Embedded injection -> contained node_modules -> contained vendor; failure is a packaging defect, not permission for consumer npm install |

Evaluation outputs bind assertions/variants in `eval_metadata.json`, per-run
`assertion_hash.txt`, `execution_evidence.json`, response, optional transcript, timing,
and `run_summary.json`. Fast retains flat variant dirs; repeated runs add `run-N`.
`EvalCase` optional TypeScript fields do not describe all runtime requirements:
validator requires subject, language, target.kind, preconditions, files, and prompt.

Security/behavior boundaries:

- `init --path` writes to the supplied directory (default cwd), not automatically
  `.agents/agents`; authoring guidance must choose the correct destination.
- Follow [custom-agents.md](../../../skills/agent-creator/references/custom-agents.md)
  as vendored format truth: only name/description/model; role-focused definitions,
  no Skills/plugins/recipes or MCP/runtime declarations in agent files.
- Eval runners use temporary project agents, `execFile`, timeouts/turn limits, and
  cleanup; fixture path checks are not an OS sandbox or symlink-proof containment.
- Evaluation withholds raw failed-runner diagnostics and redacts retained output;
  default transcripts are retained. Redaction is not proof of complete secrecy.
- `GradingDiagnostic` flags incomplete/stale variants before grading writes.
  Semantic grading requires at least two identified graders, call budget, and quotes
  contained in output; `resolveJudgments()` makes disagreement inconclusive.
  Identity labels do not by themselves prove independent evaluators or host behavior.

## Verification and change gates

Run from repository root unless specified; permission remains required for writes.

- Documentation-only: verify links, named symbols, seven command mappings, Markdown
  fences, <=220-line budget, and actual diff. Do not rebuild merely for this map.
- CLI implementation: `(cd apps/agent-creator-cli && npm run build && npm test)`.
  [build.mjs](build.mjs) retires/cleans app dist, runs local tsc, copies viewer HTML;
  [test.mjs](test.mjs) builds again, discovers sorted `tests/*.test.ts`, rejects no
  tests, and runs Node tests. Do not build while other consumers use that dist.
- Runtime projection: `npm run build:skill-runtimes`, then
  `npm run check:skill-runtime-dist-drift`; never hand-edit emitted runtime files.
- Review source inventory/projection impact: `npm run check:change-set-inventory`,
  `npm run test:distribution`, `npm run test:production` as applicable under root
  instructions. Native packaging follows [build-bun-executables.mjs](../../../scripts/build-bun-executables.mjs), not the Node launcher path.
- Never mutate live user agents in tests; use temporary project installations.
  No Beads mutation, commit, push, release, credential change, or remote sync is
  authorized by this file. Report static inspection, executed tests, generated-output
  equivalence, and real-host proof separately; none substitutes for another.
