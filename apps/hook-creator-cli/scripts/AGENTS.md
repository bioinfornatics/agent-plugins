# Hook Creator CLI — agent instructions and code map

## Mandatory rule: review documentation impact with every code change

For **every code modification**, assess whether applicable `AGENTS.md` files still
accurately describe the code. Review this map whenever an entry point, command,
contract, call order, or execution boundary changes.

- Before editing, read applicable ancestor instructions and relevant source.
- After editing, compare the actual diff with documented symbols, command mappings,
  data contracts, constraints, security boundaries, and verification steps.
- **Automatically update affected `AGENTS.md` content in the same change when
  needed**, without waiting for a documentation request. Replace obsolete guidance;
  do not append corrections or task histories.
- If no update is needed, briefly explain why the map remains accurate in the
  delivery report; do not add no-change logs here.
- Respect ownership and current write authorization. If an affected file is outside
  scope, conflicts with another contributor, or cannot be edited, report the exact
  required update; do not silently leave stale guidance or expand scope.
- Before handoff, verify links and mapped entries. Static checks do not prove
  runtime behavior, agent compliance, handler safety, or host compatibility.

This is an agent instruction, **not an installed hook or CI enforcement**. Its
scope is `apps/hook-creator-cli/scripts/`; external links are navigation, not
repository-wide authority. Ancestor instructions remain applicable. Paths below
are relative to this document unless explicitly stated otherwise.

## Purpose, ownership, and progressive reading

This application authors and validates hook plugin components, binds evaluation
inputs, signs/verifies evidence, and maintains signed human-approval records.
It does not run evaluations, execute generated handlers, deploy, or install.

1. Read this rule, entry map, and [cli.ts](cli.ts) for dispatcher work.
2. Select only the relevant command module from the feature table.
3. Follow containment, format, hashing, or signing helpers only for the boundary
   under review; read build/test entries when changing their contracts.
4. Keep this map concise, English, source-linked, and free of exhaustive inventories.
   Source is authoritative; navigation does not replace inspection.

```text
installation: skills/hook-creator/scripts/hook-creator.mjs
  -> runtime/runtime-manifest.json -> child Node runtime/dist/cli.js
source/package bin: dist/cli.js <- scripts/cli.ts
  -> isMain(import.meta.url) -> process.exitCode = run(argv)
native: bun-entry.ts -> process.exitCode = run(process.argv.slice(2))
run -> parseCommon -> one direct imported command function -> output/status
```

| Entry / configuration | Ownership and role |
|---|---|
| [cli.ts](cli.ts) | Authoritative synchronous dispatcher; no embedded runner or subprocess command dispatch |
| [bun-entry.ts](bun-entry.ts) | Explicit native entry; imports `run` |
| [init_hook.ts](init_hook.ts), [validate_hook.ts](validate_hook.ts) | Also guarded standalone Node entries: `main()` and `legacyMain()` |
| [package.json](../package.json), [tsconfig.json](../tsconfig.json) | Bin `dist/cli.js`; NodeNext compilation from `scripts/` into `dist/` |
| [launcher map](../../../skills/hook-creator/scripts/AGENTS.md) | Installation-facing process boundary |
| [runtime manifest](../../../skills/hook-creator/runtime/runtime-manifest.json) | Generated `runtimeEntry: dist/cli.js`, source app/entry, hashes |
| [contained cli.js](../../../skills/hook-creator/runtime/dist/cli.js) | Committed emitted runtime; never edit manually |
| [runtime mapping](../../../config/skill-runtimes/skill-runtime-map.json) | Authoritative source-to-contained-runtime mapping |

Edit TypeScript here, not generated `dist/` or the portable Skill tree. Contained
runtimes must not depend on sibling Skills or root tooling. Authoring paths may
be absent in installation-only distributions.

## Dispatcher symbols and contracts

Definitions below are in [cli.ts](cli.ts).

| Kind | Symbol | Responsibility / shape |
|---|---|---|
| Type | `Format` | `"text" | "json"` |
| Interface | `Common` | `{format, quiet, help, target: GooseTarget, rest: string[]}` |
| Constant | `HELP` | Usage and five command families; not a dispatch registry |
| Function | `parseCommon(argv)` | Strip common flags anywhere; preserve other args in `rest` |
| Function | `output(value, format, quiet, lines)` | JSON value or text lines; quiet suppresses output |
| Function | `failure(error, format, usage)` | JSON `{ok:false,error,usage}` or stderr diagnostic; return `2`/`1` |
| Exported function | `run(argv)` | Parse, dispatch, print; return numeric exit status |
| Function | `isMain(metaUrl)` | `import.meta.main` or realpath equality with `process.argv[1]`; resolution failure returns false |

There are no declared classes in `cli.ts`. `UsageError` comes from `init_hook.ts`.
There is no generic JSON envelope: branches select their own output objects.
Defaults are text, non-quiet, and `DEFAULT_GOOSE_TARGET` (`v1.47.0`). Common flags:
`--format`/`--format=`, `--goose-target`/`--goose-target=`, `--quiet`, `-h`/`--help`.
An explicit target is supported only for `init` and `validate`.

## Features and exact command mapping

One branch executes per invocation; table order is not call order.

| Command | Public module seam | Effect / output contract |
|---|---|---|
| `init <plugin_dir> <event> <name>` | [init_hook.ts](init_hook.ts): `parseInitArgs` -> `initHook` | Write native config and handler; `{ok,command,hooksPath,scriptPath}` |
| `validate <plugin_dir>` | [validate_hook.ts](validate_hook.ts): `validateHook` | Inspect component; `{ok,command,goose_target,goose_source_commit,errors,warnings,path}` |
| `eval-manifest create <spec> <out>` | [evaluation_run_manifest.ts](evaluation_run_manifest.ts): `writeEvaluationRunManifest` | Exclusive new file; `{ok,command,action,manifest}` |
| `eval-manifest verify <manifest> [receipt]` | Same module: `verifyEvaluationRunManifest` | Rehash bound inputs; `{command,action,ok,errors}` |
| `attestation create <spec> <out> [--private-key <pem>]` | [evidence_attestation.ts](evidence_attestation.ts): `writeEvidenceAttestation` | Exclusive new envelope; `{ok,command,action,path,signed}` |
| `attestation verify <envelope>` | Same module: `verifyEvidenceAttestation` | `--policy local|production`, `--trust-policy`, `--tests-status`; result `{ok,state,trust,errors,...}` |
| `approval request <spec> <out>` | [production_approval.ts](production_approval.ts): `writeApprovalRequest` -> `approvalSha` | Exclusive new pending request; path/state/hash output |
| `approval review|approve|reject|expire|supersede <approval> <decision> --private-key <pem>` | Same module: `updateApproval` -> `approvalSha` | Signed atomic transition; path/hash/revision output |
| `approval verify <approval> --trust-policy <json> [--bindings <json>]` | Same module: `inspectApproval` | Read-only trust/state/bindings check |
| `approval consume <approval> --purpose deploy|install --trust-policy <json> --bindings <json>` | Same module: `inspectApproval` | Read-only exact-binding check; output includes command/action/purpose/result |

`consume` validates the purpose string in the CLI, but passes only trust policy and
expected bindings to `inspectApproval`. It does not bind a purpose into the signed
record, record consumption, deploy, install, or authorize this agent to do so.
`HELP` omits `--tests-status`; production verification explicitly rejects that manual
status. Reconcile help, argument parsing, branches, and this map on command changes.

## Ordered dispatch and errors

```text
run(argv)
  1. parseCommon(argv); parse error -> failure(error, "text", true) -> 2
  2. extract command/args; help -> output(help, quiet=false) -> 0
  3. missing command -> usage failure; unsupported explicit target -> usage failure
  4. inside try: select init / approval / attestation / eval-manifest / validate
     init: parseInitArgs(args + selected target) -> initHook -> output -> 0
     create/request: write function -> output -> 0
     approval transition: parse flags -> read decision -> require action match
       -> updateApproval -> approvalSha -> output -> 0
     verify/consume: parse flags -> read JSON inputs -> verifier -> output -> 0/1
     validate: require one arg -> validateHook -> output -> 0/1
     unknown command/action or bad arity -> throw UsageError
  5. catch -> failure(error, selected format, error instanceof UsageError) -> 2/1
caller assigns numeric result to process.exitCode
```

Quiet suppresses successful text and JSON output, including validation warnings
on success. Failed verification remains visible (`quiet && result.ok`); failure
output ignores quiet, and help explicitly ignores quiet. Parser failures use text
regardless of an earlier JSON option. Runtime/I/O/JSON errors normally return `1`;
usage errors return `2`. Standalone `init_hook.ts` catches all errors as `2`, unlike
`run`; standalone `validate_hook.ts` uses its own parser/output (`legacyMain`).

## Selected module symbols and data flow

| Module | Functions / types / objects to inspect |
|---|---|
| [init_hook.ts](init_hook.ts) | Class `UsageError`; interfaces `InitOptions`, `InitResult`; `NAME_RE`; `parseInitArgs`, `initHook`; staging helpers `obj`, `stat`, `sibling`, `stage`; guarded `isMain`, `main` |
| [validate_hook.ts](validate_hook.ts) | Interface `ValidateResult extends ValidationResult` adds `path`; `validateHook` -> `validateHooks` then `locateHooks`; `isMain`, `legacyMain` |
| [hook_format.ts](hook_format.ts) | `ValidationResult {errors,warnings}`; `locateHooks`, `validateHooks`, `referencedPluginFile`; layout/namespace constants, aliases, `HOOK_EVENTS`, re-exported `BLOCKING_EVENTS` |
| [containment.ts](containment.ts) | `safePluginPath`, `regularFile`, `directoryOrMissing`; returned `{path,exists}`; local `stat` |
| [goose_hook_contract.ts](goose_hook_contract.ts) | `GOOSE_TARGETS`, `GooseTarget`, `DEFAULT_GOOSE_TARGET`, `gooseTarget`, `hookEvents`, native/adapter paths, `BLOCKING_EVENTS` |
| [evaluation_run_manifest.ts](evaluation_run_manifest.ts) | `canonicalSerialize`, `canonicalManifestHash`; validate spec/manifest, create/write/verify functions; `MANIFEST_VERSION`, internal record alias `O` |
| [evidence_attestation.ts](evidence_attestation.ts) | Validate statement/envelope, create/write/verify functions; `VerificationState`, payload/statement/predicate constants; `safe`, `hashPath`, `pae`, `keyid`, `freshness` |
| [production_approval.ts](production_approval.ts) | Validate/create/inspect/append/write/update approval; `approvalSha`, `approvalRequestSha`; `APPROVAL_VERSION`, `BINDING_KEYS`; `state`, `verifyEvents`, `verifyReplacement`, `atomic`, `acquire`, `release`; `LockOwner {fd,token}` |

- Init options: `{pluginDir,event,name,matcher,timeout,target?}`; defaults matcher
  null/timeout 30. Native document: `{hooks:{[event]:[{matcher?,hooks:[{type:"command",
  command:"${PLUGIN_ROOT}/scripts/<name>.sh",timeout}]}]}}`; result has two paths.
- Manifest: version, canonical content/input fingerprint hashes, `inputs`,
  `execution`, `provenance`. Inputs bind canonical paths/content; execution records
  adapters, models, tools, budgets, runner, graders, environment and trust boundaries.
- Attestation: `{payloadType,payload,signatures}` containing canonical in-toto JSON.
  Predicate binds source, result, optional evaluation manifest, invocation/environment,
  issuer and validity times. Local evidence is unsigned; CI requires Ed25519.
- Approval: request identity/times, requester, automated evidence, six `BINDING_KEYS`
  hashes (artifact/archive/manifest/benchmark/test/review), signed hash-chained events,
  optional reciprocal supersession lineage. State starts pending; evidence pass is
  not human approval. Decisions require expected revision and approval content hash.

## Security boundaries and observed limits

- Treat [vendored hooks.md](../../../skills/hook-creator/references/hooks.md) as the
  format source, with [target compatibility](../../../skills/hook-creator/references/goose-target-compatibility.md)
  clarifying source-profile and activation differences. Profiles are not live-binary proof.
- Generate only plugin components. `initHook` requires existing `plugin.json`, rejects
  existing handler/adapter envelopes, stages files, renames with backups, and attempts
  rollback/cleanup. It writes native `hooks/hooks.json`; manifest remains unchanged.
- Containment resolves the root and rejects escapes/existing symlink components.
  Checks/staging are not an OS sandbox or a complete concurrent-filesystem guarantee;
  rollback cleanup catches errors and is best-effort.
- Only `PreToolUse` and `Stop` block. Generated shell handler reads stdin and exits 0;
  commands are executable/security-sensitive, not run by these CLI branches.
- `validateHooks` checks layout, fields, regex, timeout, referenced files and selected
  script text. `referencedPluginFile` is a token heuristic, not a shell parser;
  validation does not prove executable permission, command safety or host activation.
  Constants named `CANONICAL`/`LEGACY` reflect older naming, not native preference.
- Manifest verification rehashes inputs and optional receipt bindings; it does not
  run the declared evaluation. Evidence verification checks canonical payload,
  freshness, trusted issuer/signature and passing result, not independent execution.
- Approval inspection checks trusted reviewer identity/role/key/action, signatures,
  state, times and optional exact bindings. Atomic updates use ownership-token locks,
  stale-lock reclamation, exclusive temp writes and rename; key use remains sensitive.
  New attestation and approval files use exclusive creation and mode `0600`;
  evaluation manifests use exclusive creation without an explicit mode.

## Verification and change gates

Run from repository root unless explicitly changing directory.

- Instruction-only changes: check relative links, mapped symbols/commands, fences,
  <=220-line budget and diff. Do not rebuild solely for this map.
- CLI changes: `(cd apps/hook-creator-cli && npm run build && npm test)`.
  [build.mjs](build.mjs) retires/cleans dist, invokes local TypeScript, restores `0755`
  on cli/init/validate entries, optionally copies viewer HTML. [test.mjs](test.mjs)
  rebuilds first, requires sorted `tests/*.test.ts`, then invokes Node `--test`.
- Runtime changes: source first; `npm run build:skill-runtimes` then
  `npm run check:skill-runtime-dist-drift`; shared contracts require their build first.
- Review source inventory/projection impact under root instructions:
  `npm run check:change-set-inventory`, `npm run test:distribution`,
  `npm run test:production` when applicable. Never build/retire dist while consumers
  use it; use isolated checkouts for concurrent builds.
- Never test against live `~/.agents` installations. No Git, credential, publication,
  installation, remote sync, or paid-execution authority is granted here.

Report source inspection, static checks, executed tests, generated-output drift and
proven host behavior separately. This map covers entry and command seams, not all
transitive helpers or acceptance evidence.
