# Plugin Creator CLI — agent instructions and source map

## Mandatory rule: review documentation impact with every code change

For **every code modification**, assess whether applicable `AGENTS.md` files still
accurately describe the code. Review this map when a mapped entry, command, contract,
ordered call, execution boundary, or verification gate changes.

- Before editing, read ancestor instructions and the relevant source.
- After editing, compare the actual diff against documented symbols, command routing,
  data shapes, ownership, failure boundaries, security limits, and verification steps.
- **Automatically update affected `AGENTS.md` content in the same change when
  needed**, without a separate documentation request. Replace obsolete statements;
  do not merely append corrections.
- If no update is needed, briefly explain in the delivery report why the existing
  map remains accurate. Do not add no-change logs here.
- Respect authorization and ownership. If an affected document is outside permitted
  scope, conflicts with another contributor's work, or cannot be edited, report the
  exact required update; do not expand scope or silently leave stale instructions.
- Before handoff, verify links and mapped entry points. Static documentation checks
  do not prove runtime behavior, host compatibility, or agent compliance.

This is an agent instruction, **not an installed hook or CI enforcement mechanism**.
Its scope is `apps/plugin-creator-cli/scripts/`; cross-directory references are
navigation, not repository-wide scope extension. Ancestor instructions still apply.
All source links below are relative to this file.

## Purpose and progressive reading

The CLI orchestrates whole-plugin authoring, validation, migration, packaging, and
component/integration evidence. It does not replace specialist Skill authoring.

1. Read this rule, entry map, and dispatch order first.
2. Select one command from the feature table; inspect its actual handler and types.
3. Read only the relevant validation, evidence, packaging, or runtime seam below.
4. Traverse deeper imports only when required. Source is authoritative; refresh the
   map instead of following stale observations.

Keep instructions English and concise. Prefer linked symbols over line-only
references, copied source, exhaustive transitive inventories, or status/history.

## Entry points and ownership

```text
installation: Skill launcher -> manifest -> spawn(Node, contained cli.js, args)
authoring:    dist/scripts/cli.js exact-entry guard -> runCli(argv)
native:       bun-entry.ts -> dependencies -> import cli -> runCli(argv)
runCli:       direct command API OR child() -> runEmbedded(main, args)
```

| Entry / seam | Source | Ownership / contract |
|---|---|---|
| Dispatcher | [cli.ts](cli.ts), `runCli(argv)` | Authoritative TypeScript; returns numeric exit code |
| App executable | [package.json](../package.json), [generated cli.js](../dist/scripts/cli.js) | Bin points to `dist/scripts/cli.js`; generated, not manually edited |
| Installation launcher | [plugin-creator.mjs](../../../skills/plugin-creator/scripts/plugin-creator.mjs), [launcher map](../../../skills/plugin-creator/scripts/AGENTS.md) | Separate Node child process; own Node/mapping/type checks |
| Contained runtime | [runtime-manifest.json](../../../skills/plugin-creator/runtime/runtime-manifest.json), [contained cli.js](../../../skills/plugin-creator/runtime/dist/scripts/cli.js) | Committed projection with production dependencies |
| Native entry | [bun-entry.ts](bun-entry.ts) | Seeds `__creatorDependencies`; explicitly invokes `runCli` |
| Embedded execution | [runtime-dispatch.ts](runtime-dispatch.ts), `runEmbedded()` | In-process output/status capture; not an OS sandbox |
| Runtime projection | [skill-runtime-map.json](../../../config/skill-runtimes/skill-runtime-map.json) | Source app/entry and contained related command closure |

Edit TypeScript here, not emitted `dist/` or portable Skill runtime files. Authoring
`apps/` paths may be absent in installation-only distributions. Preserve independently
installable Skills; runtime execution must not depend on sibling Skills or root tooling.
Scope generated artifacts to plugins under `.agents/plugins`, including bundled
`skills/`; do not generate standalone `.agents/skills` or `.agents/agents` assets.

## Dispatcher symbols and data contracts

Definitions are in [cli.ts](cli.ts) unless otherwise linked.

| Kind | Symbol | Responsibility |
|---|---|---|
| Type alias | `Format` | `text`, `json`, `jsonl`, `ci`, or `review` |
| Interface | `Common` | `{format, quiet, help, mode, target, args}` |
| Constants | `EXIT_SUCCESS`, `EXIT_FAILURE`, `EXIT_USAGE`, `EXIT_BLOCKED` | 0, 1, 2, 3; no exported pending-approval constant |
| Objects / values | `HELP`, `HERE` | Global usage text; module directory (`HERE` currently unused) |
| Function | `parseCommon(args)` | Returns `Common` or diagnostic string; removes common options |
| Function | `emit(value, text, o)` | Quiet-aware output; JSON only for `format === "json"`, otherwise text |
| Function | `usage(message?)` | Prints diagnostic/global help to stderr; returns 2 |
| Async function | `child(script, args)` | Four explicit dynamic imports into `runEmbedded`; no child process |
| Async function | `wrapped(command, o)` | Init/package capture, exit mapping, last-line output |
| Function | `runValidate(o)` | Portable load OR strict schema plus Goose structure checks |
| Async functions | `runMigrate(o)`, `runVerify(o)` | Parse embedded JSON report/receipt and map its status |
| Async function | `runFullEval(o)` | Parse orchestration options, call `fullEval`, render result/events |
| Exported async function | `runCli(argv)` | Dispatch 11 commands; no command registry object or `Command` alias |

There are no classes declared in `cli.ts`.
[Runtime dispatch](runtime-dispatch.ts) declares interface `EmbeddedResult`
`{status: number, stdout: string, stderr: string}`, class `EmbeddedExit` carrying
intercepted exit status, exported async `runEmbedded(main, argv)`, and local arrow
function `append(target, values)`.

Useful command contracts (read definitions, not inferred envelopes):

- Validation: [SchemaValidationResult](validate_agent_plugin_schema.ts), Goose
  `validate()` result `{errors, warnings}`, [PortableLoadResult](portable_loader.ts).
- Migration: [MigrationOptions / MigrationReport](migrate_plugin.ts); verification:
  [VerifyOptions / verifyPlugin](verify_plugin_gates.ts) receipt status/profile/name.
- Orchestration: [FullEvalOptions / FullEvalState / FullEvalJob](full_eval.ts),
  result `exit_code` and `event_file`; [CiEvalConfig / CiEvalResult](ci_eval.ts).
- Review: [ReviewConfig / BranchHost / ReviewResult](independent_review.ts), branch
  statuses; golden journeys: [GoldenOptions / GoldenJourneyId](golden_journeys.ts).
- Doctor: [DoctorReport](installation_doctor.ts), status `ok`, `error`, or `blocked`.

No universal JSON envelope exists: init/package emit `{ok, command, output}`;
validation adds target/outcome or schema/structural details; other commands emit
native reports. `ci-eval` prints JSON regardless of selected common format.

## Ordered dispatch and execution

```text
cli.ts exact-entry guard -> process.exitCode = await runCli(argv.slice(2))
runCli:
  1. no command / global -h / --help -> print HELP, return 0
  2. reject unknown command -> usage, return 2
  3. parseCommon(raw) -> reject diagnostic string -> usage, return 2
  4. command help -> print HELP, return 0
  5. reject explicit --goose-target outside validate
  6. choose ONE branch, in source order:
     decision-research -> golden-e2e -> independent-review -> ci-eval -> doctor
     -> validate -> migrate -> verify -> full-eval -> wrapped(init/package)
  7. branch validates its own arguments, invokes handler, emits output, returns code
```

There are **no pre-parser special command branches**; all 11 commands pass through
common parsing. Defaults: text, strict-authoring, nonquiet, no help, and the default
target from [goose_hook_contract.ts](goose_hook_contract.ts). Command help precedes
the validate-only target restriction. Common parsing does not validate every
command-specific option; consult each handler.

The source/Node top-level guard excludes `/$bunfs/`, requires `process.argv[1]`,
and compares resolved module path to resolved entry path. Native execution instead
calls `runCli` explicitly from `bun-entry.ts`.

For init/package/migrate/verify:

```text
child() -> dynamic import selected main -> runEmbedded(main, args)
  save argv / exit / console methods / stdout and stderr write methods
  substitute argv; intercept exit and output
  await main(); numeric result OR EmbeddedExit supplies status (default 0)
  finally restore saved globals
  return {status, stdout, stderr}
wrapper -> parse captured output -> emit report -> return mapped exit code
```

Unexpected embedded exceptions propagate after restoration. No concurrency-isolated
process context is provided; do not run these interceptors concurrently in one process.
Quiet suppresses normal branch output, not usage/errors or explicit help.
`runFullEval` replays retained events into text/jsonl/ci/review projections, or emits
the raw JSON result; dry-run avoids event replay. Its catch returns 1.

## Feature and command navigation

Table order is navigation, not execution order. Entries are actual dispatch targets;
module-level standalone CLIs are not additional registered commands.

| Command | Feature / input | Actual module / exported handler |
|---|---|---|
| `init` | Name, optional parent path/skills/hooks; writes skeleton | [init_goose_plugin.ts](init_goose_plugin.ts), `main()` via `wrapped` |
| `doctor` | Explicit installation root; text/json only | [installation_doctor.ts](installation_doctor.ts), `diagnoseInstallation`, `renderDoctor` |
| `validate` | One plugin directory; portable or strict | [portable_loader.ts](portable_loader.ts), `loadPortablePlugin` OR [validate_agent_plugin_schema.ts](validate_agent_plugin_schema.ts), `validateAgentPluginSchema` + [validate_goose_plugin.ts](validate_goose_plugin.ts), `validate` |
| `migrate` | Audit by default; apply/approve/backup options | [migrate_plugin.ts](migrate_plugin.ts), `main()` -> `migratePlugin` |
| `verify` | Component/integration/archive evidence gates | [verify_plugin_gates.ts](verify_plugin_gates.ts), `main()` -> `verifyPlugin` |
| `package` | Plugin directory/output ZIP; authoring/release policy | [package_goose_plugin.ts](package_goose_plugin.ts), `main()` via `wrapped` |
| `full-eval` | Plugin directory; resumable workspace/job graph | [full_eval.ts](full_eval.ts), `fullEval` via `runFullEval` |
| `ci-eval` | Exactly `--config FILE`; noninteractive evaluation | [ci_eval.ts](ci_eval.ts), `runCiEval` |
| `independent-review` | Config, host command, repeated host args | [independent_review.ts](independent_review.ts), `runIndependentReview`, `commandBranchHost` |
| `golden-e2e` | List, run/resume/cancel, or inspect retained evidence | [golden_journeys.ts](golden_journeys.ts), `listGoldenJourneys`, `runGoldenJourney`, `inspectGoldenEvidence` |
| `decision-research` | Exactly `--input FILE`; offline anonymous sessions | [decision_comprehension.ts](decision_comprehension.ts), `analyzeDecisionResearchFile` |

## Errors, security, and deeper seams

- `wrapped` maps embedded failure 2 to usage, other nonzero statuses to 1; success
  emits the last nonempty stdout line. Migration maps parsed `blocked` to 3, other
  parsed statuses to 0; verify maps `pass` to 0, `blocked` to 3, others to 1.
  JSON parse failures use embedded status 2 or 1; no universal normalization applies.
- Full-eval and CI return result `exit_code`; pending approval can be 4. Golden runs
  return 4 for pending approval, otherwise 3 and report activation denied. Golden
  inspect returns 3 for fresh evidence, otherwise 1; listing returns 0.
- Decision research returns 0 for pass, otherwise 3. Independent review returns 1
  for any nonsucceeded branch, otherwise 0. Their catches and golden catches return
  usage 2. Doctor maps ok/error/blocked to 0/1/3. Other uncaught errors may propagate.
- [path_containment.ts](path_containment.ts), [package_manifest.ts](package_manifest.ts),
  and [production_approval.ts](production_approval.ts) own containment, collection,
  and approval bindings. Format acceptance is not behavioral or host proof.
- Init refuses nonempty roots but writes incrementally; it is not a transaction.
  Package collects files after validation; production approval is checked after ZIP
  creation and failed approval removes the ZIP. Treat paths and inherited environment
  as consequential inputs, not automatically sanitized data.
- [commandBranchHost](independent_review.ts) spawns the requested host, sends JSON on
  stdin, and expects JSON stdout; orchestration is not OS-level sandboxing.
- [related-command-runtime.ts](related-command-runtime.ts) resolves contained map
  entries and spawns Node; native uses an in-process handler. It avoids PATH/NODE_PATH
  lookup and repository apps, but final-entry checks do not prove symlink-free ancestors.
- [resource_paths.ts](resource_paths.ts) derives contained/authoring roots and honors
  `PLUGIN_CREATOR_SKILL_ROOT`; [runtime-deps.ts](runtime-deps.ts) uses embedded or
  local/vendored dependencies. Missing dependencies are packaging defects, not a
  reason to install into a consumer project.
- Treat hooks as executable security-sensitive code. The source-backed target
  contract is [goose_hook_contract.ts](goose_hook_contract.ts), copied from Hook
  Creator during build; never infer host support from schema validity alone.

## Verification and handoff gates

Run from repository root unless the command explicitly changes directory.

- Documentation-only: check relative links, mapped symbols/entries, command coverage,
  Markdown/fences, line budget, and actual diff. Do not rebuild for this map alone.
- CLI changes: `(cd apps/plugin-creator-cli && npm run build && npm test)`.
  [build.mjs](build.mjs) derives app root from its URL, guards/retire-cleans `dist`,
  copies Hook Creator's contract, runs local TypeScript with [tsconfig.json](../tsconfig.json),
  then imports emitted decision research. [test.mjs](test.mjs) rebuilds before running
  app `tests/*.test.ts` with Node; it forwards nonzero child status.
- Do not rebuild/retire dist while consumers run in the same checkout. Remove
  inherited `NODE_TEST_CONTEXT` before nested Node test runners (see root guidance).
- Runtime changes: `npm run build:skill-runtimes` then
  `npm run check:skill-runtime-dist-drift`; edit source, not generated mirrors.
- Review inventory/projection impact: `npm run check:change-set-inventory` and
  applicable `npm run test:distribution` / `npm run test:production` gates.
- Native changes: inspect [build-native.mjs](build-native.mjs) and package native
  scripts; compile uses `BUN_EXECUTABLE` or Bun and the explicit native entry.
- Never target live `~/.agents` in automated tests. This map authorizes no Git,
  credential, installation, publication, or remote-sync actions.

Report documentation review, source inspection, executed tests, generated-output
checks, and proven host behavior separately. This is an immediate-seam navigation
map, not exhaustive internals or evidence that every documented boundary is safe.
