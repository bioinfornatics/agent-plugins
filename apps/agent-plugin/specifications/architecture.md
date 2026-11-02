# Architecture and project map

Read when changing boundaries, ports, entrypoints, I/O ownership or reporting.
The application is `apps/agent-plugin`, not retired `apps/skill-creator-cli`.
See [product.md](product.md) for requirements.

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
      reporting/                   # HTML rendering
```

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

- Domain MUST NOT import Commander, Bun/Node I/O, database libraries, adapters or
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

## Current preparation boundary

`evaluation` consumes repeatable/combinable Skill and Plugin roots. Local suite
I/O belongs to an outbound boundary; validation and matrix expansion are pure
rules where possible. Deduplicate roots by kind, preserve separate target
comparisons, namespace scenarios by Skill directory, and retain whole-Plugin
with/without treatment for each child scenario. Do not introduce host, judge or
store calls just to prepare a plan. Dry-run presents JSON; non-dry-run validates
then explicitly rejects unavailable execution. Future directories are not proof
of delivered adapters. Installed runtime mappings remain outside this slice.

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

- `index.ts` is the process boundary: guard execution with `import.meta.main`,
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
