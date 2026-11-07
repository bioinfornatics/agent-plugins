# Architecture and project map

Read when changing boundaries, ports, entrypoints, I/O ownership or reporting.
The application is `apps/agent-plugin`, not retired `apps/skill-creator-cli`.
See [product.md](product.md) for requirements.

App execution uses Node.js >=22.22.2 native TypeScript stripping of `src/index.ts`
and npm-managed dependencies (`npm ci`, sole lockfile `package-lock.json`).
The storage-local SQLite wrapper loads `node:sqlite` lazily when storage is used;
CLI imports must not load SQLite or open a database. Tests use `node:test` and
`node:assert`; this runtime migration changes no layer ownership or installed mapping.

## Architecture contract

**Keep business rules independent of hosts and infrastructure; make every
implementation easy to locate; assemble concrete dependencies explicitly.**
The hexagon is a dependency rule, not merely a folder layout.

```text
src/
  index.ts                         # Runtime/process boundary
  main.ts                          # Import-safe CLI lifecycle
  composition-root.ts              # Concrete dependency assembly
  domain/                          # Pure data and rules
  application/
    ports/                         # Application-owned capability contracts
    use-cases/                     # Application orchestration and read models
  adapters/
    inbound/cli/                   # Commander parsing and presentation
    outbound/
      hosts/{goose,codex,claude}/   # Native host protocols and isolation
      judge/                       # LLM grading transport
      storage/                     # SQLite and evidence archives
      reporting/                   # Filesystem export; HTML reserved
```

Goose candidate execution and judging are wired to the CLI, with SQLite execution
and append-only grading storage plus readonly histories. Codex/Claude and HTML
remain reserved/unimplemented. Export orchestration and filesystem publication are
present as a source WIP candidate; full qualification and installed-runtime integration
remain pending. Local/mock checks do not establish native model calibration.

### Allowed dependencies

Type-only imports obey the same boundaries as runtime imports.

| Location | Allowed project dependencies | Responsibility |
|---|---|---|
| `domain/` | Other domain modules | Scenarios, plans, pairs, evidence, judgments and pure rules |
| `application/ports/` | Domain and other application ports | Capabilities required by use cases |
| `application/use-cases/` | Domain, application ports and cohesive application modules | Preparation, orchestration, inspection, regrading, replay |
| `adapters/inbound/cli/` | Domain, application and CLI-local modules | Translate CLI input to use cases and present outputs |
| `adapters/outbound/` | Domain, application contracts/read-model types and scoped low-level adapter helpers | Translate external protocols and own I/O |
| `composition-root.ts` | Application, adapters and domain as needed | Assemble dependencies, not execute business policy |
| `main.ts` | Composition root and CLI boundary contracts | CLI lifecycle and errors to exit status |
| `index.ts` | Main and runtime output adapter | Runtime startup, streams and process exit status |

- Domain MUST NOT import Commander, Node I/O, database libraries, adapters or
  application orchestration. Pure standard-library utilities are acceptable only
  if they introduce no environment dependency or side effect.
- Application MUST NOT import concrete adapters, Commander or runtime I/O APIs.
  External work goes through application-owned ports.
- Inbound adapters MUST call use cases rather than implement business rules or
  construct outbound adapters. Parsing/formatting rules belong at the CLI boundary.
- Outbound adapters MUST NOT invoke use cases or depend on inbound adapters.
  Cross-adapter composition belongs in the composition root. A shared low-level
  helper is allowed when its owner and responsibility are explicit.
- Keep host-specific flags, native responses, filesystem layouts and SQL outside
  the core. Normalize observations at adapter boundaries, without inventing evidence.

## Current preparation and execution boundary

`evaluation` consumes repeatable/combinable Skill and Plugin roots. Local suite
I/O belongs to an outbound boundary; validation and matrix expansion are pure
rules where possible. Deduplicate roots and included Skills into one profile, globally namespace
scenarios by suite provenance and retain whole-profile with/without treatment. Do not introduce host, judge or
store calls just to prepare a plan. Dry-run presents JSON without constructing hosts/storage. Non-dry-run executes
Goose with bounded parallel workers with private trial contexts, shared user SQLite registry and
campaign-isolated evidence.
Process-interruption recovery and read-only history are implemented locally. Native
model/profile compatibility remains unverified; historical import is undelivered.
Grading/regrading and judgment consultation are wired locally (see current §26).
Installed runtime mapping now targets this app after the authorized abrupt migration.

## Ports and responsibility

- Introduce `CandidateHost`, `Judge` and `EvaluationStore` in
  `application/ports/` only when a delivered use case needs their contracts.
  Define signatures from application needs, not speculative SDK features.
- Host adapters own their preflight, private environment, installation, execution,
  collection and cleanup. Candidate execution and grading remain separate
  capabilities even when a low-level transport is shared.
- SQLite and archive lifecycle belong in storage; HTML rendering consumes an
  application read model and MUST NOT launch agents or judges. Treat candidate
  content as untrusted data, never executable HTML.
- Reading evals, scheduling and transformations MAY remain simple modules. Do not
  add a port per filesystem call, ORM, event bus or distributed queue by default.
- An interface belongs to the layer that needs the contract. It does not belong
  in domain merely because it is an interface.


## Entrypoints, output and resource ownership

- `index.ts` is the process boundary: use a Node-compatible direct-entry guard,
  construct `StreamCliOutput(process.stdout, process.stderr)`, pass user argv to
  `main`, and assign the returned status to `process.exitCode`.
- `main(argv, output)` is import-safe and testable. It may handle `CommanderError`
  at this peripheral boundary; Commander MUST NOT leak into application/domain.
  Preserve help/error exit status and do not duplicate diagnostics already emitted.
- Imports MUST NOT parse argv, write output, open stores, launch subprocesses or
  contact providers. Explicit execution owns side effects.
- CLI presentation uses injected output, not `console` or process-global streams
  outside index. Adapters may use scoped runtime APIs for their own I/O.
- `StreamCliOutput.writeOut/writeErr` MUST preserve `this` when Commander calls
  detached callbacks: use arrow fields or explicit binding. Forward exact text
  to the correct stream, without adding newline/formatting implicitly.
- Writers are already open and caller-owned. The output adapter MUST NOT close
  stdout/stderr or promise asynchronous file flush. An owned file writer needs
  an explicit lifecycle when introduced.
- Resource creation and cleanup MUST have one owner. Never mutate live operator
  installations or copy credentials into evidence archives during automated tests.
  A fake HOME is not an OS sandbox; do not claim otherwise.


## Evaluation command ownership

`adapters/inbound/cli/handle-evaluation-command.ts` owns the `EvaluationHandler`
callback signature and its named production factory `createEvaluationCommandHandler`:
invokes application use cases, formats results and sanitizes errors. `create-cli.ts`
imports the callback signature with `import type`, without a runtime dependency on
the production handler.
The handler imports application contracts, never concrete outbound adapters. `create-cli.ts`
parses and dispatches only. `composition-root.ts` supplies source and lazy host/store
factories; dry-run does not instantiate execution resources.


## Profile/registry source candidate — local/mock

See [product section 17](product.md)
for canonical PRF/REG requirements and blocking decisions. Profile-indexed plans and the shared registry are source implementations; native
activation and historical import remain separate gates; history/inspect are delivered locally.

- Domain owns pure profile composition/revision and pairing rules; scenario
  provenance is distinct from the full-profile treatment. Identity is rooted in canonical effective selection; revision hashes captured content.
- Application prepares a profile plan and executes its full treatment via ports;
  it must not resolve XDG paths or construct concrete stores/hosts.
- The CLI exposes optional naming and resolved plans; `--profile-name`, `--registry` and evidence-only `--output` implement the approved
  first slice, with only singular `--plugin`. Composition root wires factories.
- GooseHost restores Plugin snapshots, then namespacePluginSkills rewrites immediate
  skills/*/SKILL.md frontmatter names in the private copy before enabling the Plugin.
  Matching plugin prefixes are preserved; original snapshots, body and other metadata
  remain intact. Standalone Skills are not transformed.
- Host adapters validate all members before candidate admission; install the whole
  profile only in with. Multiple Plugins must not replace one another’s enablement.
- Storage owns the shared registry schema/migration and campaign-isolated evidence;
  campaign identity scopes pairs/trials and cleanup. A per-campaign store object
  may own a session, but not the entire lifetime of the user registry resource.
- XDG/operator registry resolution is outside the candidate HOME; tests use an
  explicit temporary resource root, never the live user registry.
- Reading history is delivered through EvaluationHistory; keep only
  contracts it actually consumes. No speculative repository framework or dual
  authoritative DB synchronization is required by the direction.
- Filesystem publication and SQLite commit are not jointly atomic. Shared DB
  migrations/locks, crash reconciliation and ownership use schema v2, DELETE journaling
  and 5000 ms busy timeout per SQLite operation. Process recovery is implemented;
  filesystem/SQLite atomicity and power-loss durability are not promised.


## Durable campaign execution

Domain plans expose logical trial IDs; application executor owns bounded workers
and a serialized persistence queue. Crypto attempt factory remains injected from
composition root. Store schema v2 owns planned trials, append-only attempts and
PID/token campaign ownership; checkpoint verifier and schema migration are cohesive
storage modules. Resume returns frozen plan/pending/counts, with no source reads.
CLI --resume forbids overrides and requires explicit --retry-uncertain for unknown
outcomes; published corruption is never bypassed. No native session continuation,
power-loss fsync guarantee or filesystem/SQLite atomicity. See product section 18.


## Read-only history

EvaluationHistory is an application-owned read contract. SqliteEvaluationHistory
opens a readonly/query_only connection per request, never the write-side schema
initializer. CLI history/inspect handler presents results and sanitizes unexpected
storage errors; composition wires a lazy read adapter without host dependencies.
No implicit migration/creation, model call or checksum-verification claim for file
availability. See product section 20.

## Imported suites boundary — 2026-11-04

`domain/scenario-import.ts` owns canonical JSON/diagnostic and additive import
validation rules. `filesystem/declared-input-snapshot.ts` owns bounded declared
input I/O; it intentionally reads evals/files excluded from installation snapshots.
The CLI handler refuses unsupported constraints before constructing execution
adapters; executeEvaluation repeats admission for direct/resume callers using
preserved extensions, not trusting diagnostic presence. Recovery validates optional
payloads; registry revision comparisons use canonical object ordering. Existing
schema3 remains valid. No judge/reporting adapter is added by this import slice.

## Judge transport boundary — 2026-11-05

`application/ports/judge.ts` separates the Judge capability/request/outcome and
provenance from CandidateHost. `outbound/judge/goose-judge.ts` owns native private
session/process/cleanup; `judgment-packet.ts` allowlists evidence fields, assigns
neutral aliases and restores source references after domain validation. Existing
Goose low-level configuration/process helpers are reused; no fictitious candidate
trial, profile installation or candidate table write is used for judging.

## Grading persistence boundary — 2026-11-05

`verified-attempt.ts` and `judgment-store.ts` are application-owned capability
contracts. `grade-attempt.ts` orchestrates an explicit verified read, injected Judge
and append without CandidateHost. SQLite adapters own snapshot authentication,
coherent metadata, file integrity, extension validation and atomic inserts. The
checkpoint verifier can optionally retain bytes but existing recovery calls remain
metadata-only. Principal schema2 and readonly history stay compatible; a separate
extension version protects the additive grading schema. No CLI wiring is implied.

## Grading CLI/read model — 2026-11-06

Named grading/readback handlers call gradeAttempt and application-owned
JudgmentHistory. Composition binds factories only; Judge creation is deferred until
verified attempt reading. SqliteJudgmentHistory owns coherent readonly schema and
stored binding validation, returning an allowlisted DTO without request blobs.
Archive revalidation is not part of readback; explicit verification labels preserve
this boundary. No candidate dependencies are used by grading/readback commands.

Adversarial round-trip hardening: grading-serialization and grading-provenance
are shared outbound-storage contracts for append and readback. UTF-8 JSON column
bounds and canonical optional session/hash/provenance fields are checked before
writer database effects; reader integrity is not weakened to admit malformed rows.

## Export boundary — 2026-11-06

export-campaign is readonly orchestration using JudgmentHistory, VerifiedAttemptReader
and ExportWriter; no Judge/candidate factories. Detached verified metadata exposes
layout/provenance needed for export without reopening mutable source paths.
quality-benchmark owns pure descriptive paired-statistic rules. The filesystem writer
owns safe paths, exclusive destination, pending/readiness marker and delivery hashes.
Caller-owned input is snapshotted before awaits. Dedicated temporary staging is
disposable; destination cleanup preserves concurrent user files. Persistent evidence
archives remain outside this staging policy. Readiness verifies delivery content,
not permanent authenticity of mutable output. CLI handler translates selection/errors;
composition only wires factories.
Reduced benchmark compatibility and unknown telemetry remain explicit contracts.

## Standalone validation boundary — 2026-11-06 source candidate

`handle-validate-command` is the named inbound presentation/exit-status handler;
`validate-skill` orchestrates a single `SkillFormatSource` read. The filesystem
implementation reads only directory/`SKILL.md` and translates YAML to plain Map
values, preserving key types. `domain/skill-format` owns pure frontmatter rules
and diagnostics, without YAML, Node, Commander or host imports. Composition wires
this reader/handler only; validation never calls host, Judge or storage factories.
This is source format validation, not evaluation snapshots, packaging closure or
private installed-copy namespace checking. See product §29 for limits/exclusions.

## Retained fixture preparation boundary — ap-wljl

`domain/retained-preparation` owns closed declaration/token validation and pure
prompt binding. Scenario import applies the same rules to discovery and frozen
plans; fingerprinting includes the declaration. `TrialRequest.runtime` is detached
per-attempt task/preparation context, not authored scenario content.

`prepare-retained-fixture` is the named application-owned trusted synthetic recipe.
It invokes public application preparation/execution and store lifecycle seams through
`RetainedFixtureIO` factories; no outbound adapter invokes use cases. Composition
wires the filesystem IO implementation, evaluation source, store factory and UUID
factory. `EvaluationStore.preparation` is an optional dedicated storage capability,
leaving existing unprepared lifecycle signatures/test doubles unchanged.

The executor durably starts, allocates, runs the trusted recipe, persists provenance,
then admits the host. Storage owns layout/publication/digests; filesystem IO creates
neutral evaluator source and retained seed byte copies. Goose consumes bound task
and persistent candidate workspace but owns/disposes only its temporary host root.
`preparation-proof` validates evaluator proof and seed bytes for recovery/readers;
checkpoint v2 binds that proof, while v1 remains valid only for unprepared scenarios.
Verified reader uses a detached request so grading metadata snapshot shape for
historical unprepared attempts is unchanged.

### Persistent grading instructions

`JudgeInstructionLocation` is execution-only application port data, detached from
verified evidence. `gradeAttempt` allocates the grade identity and asks the authenticated
`JudgmentStore.prepareInstructions` for its campaign destination before constructing
Judge. Preparation resolves only; packet writes happen after Judge secret checks.
The optional method accommodates historical/mock stores, not a production temp fallback.
`JudgeInstructionWriter` owns exclusive persistence; the composition root injects
`FilesystemJudgeInstructionWriter` into GooseJudge explicitly. GooseJudge owns native
FILE/empty-stdin transport and exact named-export attribution. Storage owns private
file layout, bounds, append integrity and readback linkage; readonly history does not
reopen archived instruction files. The existing pure `judgmentPacket` adapter helper
is shared for exact append/readback packet hashing; it performs no native protocol or I/O.

## Bounded file-backed judge evidence — ap-ul8h

`judgment-packet.ts` captures detached citation authority and renders a version-2
short instruction template. `FilesystemJudgeInstructionWriter` persists neutral
text copies and their manifest under `judging/<grade>/evidence/`; original candidate
archives remain unchanged. `judge-evidence-reader.ts` is the app-owned runtime
entrypoint, compiled by the ordinary app build. `reader-launch.ts` selects that
same source or compiled entry by its own module URL, including copied runtime
layouts. The reader uses Node built-ins only; no development package or candidate
executable is loaded. Runtime projection/inventory is a separate required gate.

The Goose adapter adds only this stdio server with `--with-extension` and
`--no-profile`. Current installed Goose 1.57.0 help verifies both flags. Official
CLI documentation specifies named stdio commands; inspected v1.57.0
`crates/goose-cli/src/session/builder.rs` (`collect_extension_configs`) confirms
`no_profile` excludes configured extensions and project plugin MCP servers;
`crates/goose/src/agents/extension_manager/mod.rs` (`selection`) uses the stored
session extension list. This is source/help evidence, not native model execution.
The deterministic fake host launches the actual reader and checks the closed MCP
tool list and file slices. Real Goose/provider tool invocation remains unverified.

Sources inspected 2026-11-07:
- https://goose-docs.ai/docs/guides/goose-cli-commands
- https://goose-docs.ai/docs/getting-started/using-extensions
- https://github.com/block/goose/blob/v1.57.0/crates/goose-cli/src/session/builder.rs
- https://github.com/block/goose/blob/v1.57.0/crates/goose/src/agents/extension_manager/mod.rs

The reader is an outbound host-protocol helper, not an application use case.
It advertises only `list_manifest` and `read_artifact`; no shell, network,
extension manager, resource, prompt, or arbitrary-path read capability is exposed.
No unrestricted fallback is permitted. Byte offsets refer to exact UTF-8 bytes;
a slice cutting a multibyte code point is refused, not silently rewritten. Files
must be regular private single-link files, opened without following symlinks.
Directory component checks are not an OS-level sandbox against concurrent path
replacement. Copies are authenticated once by the writer; append verifies the
small manifest and instructions, not repeated full-artifact hashes. Final citation
validation still checks exact original path/digest/text independently of the model.

## Grading input/output evidence — ap-9ato.2

New `JudgeRequest.evidenceVersion: 2` separates `inputs/<relative>` projections of
frozen scenario bytes from `workspace/<relative>` final candidate files. Storage
projects initial bytes only after attempt verification; it does not add them to
the archived output manifest or reread live source files. History validates the
exact versioned input partition from stored plans without archive access. Requests
without this version retain their historical archive-only packet serialization.

The judge's neutral artifact manifest labels v2 inputs and workspace files with
categories and relative logical paths for targeted reading. Labels remain untrusted
data, never filesystem authority; physical reader selectors and citations remain
neutral aliases. This relaxes path blinding, not archive integrity. Known-credential
rejection and existing packet/reader bounds remain unchanged.

Output collection does not exclude `evals`: authored evaluation suites are legitimate
results. Private configuration/context and dependencies remain excluded; frozen input
evidence must not be confused with mutable final workspace files. Existing archives
missing such outputs are not repaired retroactively. Binary inputs retain their exact
hash and nontext classification; the text-only judge cannot infer their contents.

## Private user-level Skill authoring evidence — ap-9ato.3

Goose candidate HOME is a disposable private trial directory, not the operator HOME.
After treatment installation and before candidate launch, the host records existing
immediate .agents/skills roots with bounded content hashes. After execution it checks
those roots for changes and collects only newly created roots as user-skills/<name>/<file>.
Existing treatment contents are never output artifacts; mutation or unsafe collection
makes evidence partial. Evals remain eligible within newly authored roots. Configuration
and dependency exclusions, redaction, link rejection and aggregate bounds still apply.
The judge labels these outputs user-skill with the relative logical path .agents/skills/...;
physical evidence access remains alias-only. Placement is not observed discovery.
The collector does not capture project-local Skills or arbitrary private-HOME files.
