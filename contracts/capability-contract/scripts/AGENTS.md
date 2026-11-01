# Capability contract script map

## Mandatory first step: documentation impact study

Before any code change, study its documentation impact: identify affected entry
points, symbols, data contracts, call order, ownership and verification commands;
read the relevant ancestor and local `AGENTS.md` files and linked sources first.
Automatically update affected `AGENTS.md` files when the change makes their maps
inaccurate or incomplete, within the current permissions and exclusive write scope.
If an affected file is outside scope, report the needed update to its owner rather
than editing it. If no update is needed, state why in the handoff.
This is a maintainer instruction, not installed hook, CI or runtime enforcement.

## Scope and progressive reading

These four Node ESM scripts build/test the shared contract package and discover or
refresh compatibility evidence. They are authoring tools, not installed Skill CLIs.

1. Read the [repository instructions](../../../AGENTS.md), then this map.
2. Read [package commands/exports](../package.json) and [compiler configuration](../tsconfig.json).
3. Open only the script relevant to the task; follow the symbol map below.
4. For discovery/fixture changes, read the [compatibility policy](../COMPATIBILITY_SPECIFICATION.md),
   [discovery ledger](../fixtures/compatibility/producer-discovery.json),
   [review oracle](../fixtures/compatibility/expected-public-surfaces.json) and
   [compatibility tests](../tests/compatibility.test.ts).
5. Follow each ledger `sourceFile` / `versionSourceFile` into repository sources;
   paths inside the ledger are repository-relative, not relative to this directory.

## Entry points and call order

| File | Main/top-level flow and symbols |
| --- | --- |
| [build.mjs](build.mjs) | No named `main`. Resolve package `root` from `import.meta.url`, select local `node_modules/typescript/bin/tsc` as `tsc`, `spawnSync(process.execPath, [tsc, "-p", tsconfig])`, then exit with `result.status ?? 1`. Inherits stdio and uses package cwd. |
| [test.mjs](test.mjs) | No named `main`. Resolve `root`, synchronously run `scripts/build.mjs` as `build`; stop on nonzero/null build status. Enumerate immediate `tests/*.test.ts` as `tests`, run `process.execPath --test ...tests`, then exit with `result.status ?? 1`. No recursive discovery or explicit sorting. |
| [discover-compatibility-producers.mjs](discover-compatibility-producers.mjs) | Importable source-only helpers plus guarded direct CLI. Direct execution resolves repository root from argument 2 or cwd, loads the ledger, calls `discoverFromSources`, emits pretty JSON to stdout. Does not import the compatibility registry. |
| [refresh-compatibility-fixtures.mjs](refresh-compatibility-fixtures.mjs) | Executes on import; no CLI guard or named `main`. Resolve `contractRoot`, `repo`, `base`, `manifestPath`; load `manifest`; refresh classified discovery expectations/counts; write ledger; call `discoverFromSources`; recursively enumerate fixtures through `files`; build `hashes` using `sha`; write hash inventory; log counts. |

There are no classes or declared TypeScript interfaces in these scripts. Contracts
are JavaScript object shapes and lexical source conventions; the TypeScript
interfaces they inspect live in producer sources.

## Discovery functions and data contracts

All exported helpers below are in [discover-compatibility-producers.mjs](discover-compatibility-producers.mjs).

- `discoverHostDeclarations(source)` returns `{ exports, eventVariants, protocolVersion }`.
  Matches line-start exported `Host*` interfaces/types/classes; extracts lowercase
  event keys between `HostEventDataByType` and `HostEventEnvelope`; requires the
  literal `HOST_ADAPTER_PROTOCOL_VERSION`. Missing declaration/version throws.
  See [host types](../src/host-adapter-types.ts) for those source symbols.
- `discoverSchemaRegistrations(source)` returns `{ documents, registrations }`.
  Reads quoted members of `SchemaDocumentType` and lexical `registration(...)`
  rows as `{ version, declaredVersion, status, active, isDefault, documents }`.
  Missing matches yield empty arrays, not a schema-validation error.
  The ledger points to [schema_registry.ts](../../../apps/plugin-creator-cli/scripts/schema_registry.ts).
- `discoverArtifactNames(source)` returns sorted, unique quoted filename literals
  with `json`, `jsonl`, `html` or `md` extensions. It is lexical discovery, not an AST
  or a scan of files on disk.
- `discoverArtifactSurfaceMappings(source, rule, aliases, exclusions)` first checks
  names against sorted `rule.expected`, then checks each matching source row's
  positive safe-integer `evidenceOccurrences` against exact `sourceEvidence` counts.
  Each discovered `sourceFile::artifact` must have exactly one matching row using
  `siteId ?? site` and `sourceFieldOrArtifact`; at least one significant row is required.
  Returns `{ siteId, artifact, classification, ... }` mappings with either
  `canonicalArtifactId` / `role` for aliases or `rationale` for exclusions; drift throws.
- `discoverVersionEvidence(source, evidence)` is a substring-presence boolean.
- `discoverFromSources(manifest, loadSource)` calls host discovery, schema discovery,
  per-rule artifact names/mappings, then version evidence. Returns
  `{ host, schemaRegistry, artifacts, versions }`; artifact entries contain
  `{ sourceFile, actual, mappings }`, version entries `{ id, matched, emittedVersion }`.
  `loadSource(file)` supplies source text; unmatched version evidence returns false.

The ledger's `host`, `schemaRegistry`, `artifactDiscovery`, `versionRules`,
`producerSiteAliases` and `structuralExclusions` feed discovery. Its `surfaces`,
`canonicalArtifacts`, `producerBackedSurfaceIds` and `compatibleSurfaceAliases`
are broader compatibility-test inputs, not automatically reconstructed by discovery.
Tests compare source observations, the ledger, [COMPATIBILITY_REGISTRY](../src/compatibility.ts)
and the independent review oracle; successful discovery alone is not full validation.

## Source/generated ownership and refresh hazards

- Edit these script sources and [src/](../src/), not emitted [dist/](../dist/).
  `tsconfig.json` compiles `src/**/*.ts` to `dist` JavaScript and declarations;
  tests remain TypeScript and run directly under a compatible Node runtime.
- Refresh updates `artifactDiscovery[].expected` and evidence occurrence counts only
  after checking existing classifications and nonempty evidence. New artifact sites
  require intentional ledger classification; refresh refuses unclassified artifacts.
- Refresh writes the ledger **before** aggregate discovery validation. It is not
  transactional: failure can leave an updated ledger without new fixture hashes.
- `files(dir)` recursively enumerates compatibility fixtures with `statSync`;
  it is not a symlink-rejection boundary. `sha` hashes raw file bytes with SHA-256.
  [fixture-hashes.sha256.json](../fixtures/compatibility/fixture-hashes.sha256.json)
  contains `{ schemaVersion: "1.0.0", algorithm: "sha256", files }` with sorted,
  slash-normalized relative paths; it excludes only itself.
- Retain frozen fixtures, review oracle and independent expected outcomes. Refresh
  re-seals current bytes; it does not authorize semantic changes or prove compatibility.
- Generated Skill runtime mirrors remain owned by root tooling; contract changes
  need build/fixture preparation before runtime generation. Never edit installed
  `~/.agents` trees to validate these scripts.

## Verification routing (from repository root)

| Need | Command / effect |
| --- | --- |
| Source-only discovery | `node contracts/capability-contract/scripts/discover-compatibility-producers.mjs .` — reads sources/ledger and prints observations; no fixture writes. |
| Package build | `(cd contracts/capability-contract && npm run build)` — requires local TypeScript; writes `dist`. |
| Package verification | `(cd contracts/capability-contract && npm test)` — builds first, then all immediate `.test.ts` files. |
| Targeted compatibility check | `(cd contracts/capability-contract && node --test tests/compatibility.test.ts)` — requires current `dist`; checks discovery drift, registry/oracle/evidence, frozen hashes, readers and migration behavior. |
| Intentional fixture refresh | `(cd contracts/capability-contract && npm run refresh:compatibility)` — mutates ledger/hash inventory; review inputs and resulting diff, then build/test. |
| Downstream runtime gates | `npm run build:skill-runtimes && npm run check:skill-runtime-dist-drift` — generation writes mirrors; drift gate checks them. |
| Inventory/distribution gates | `npm run check:change-set-inventory`; `npm run test:distribution && npm run test:production` — follow root instructions for broader acceptance. |

Use Node 22+ with direct TypeScript-test support (not every early Node 22 version
has the same support). Build before consumers and never rebuild shared outputs
while concurrent tests use them. `test.mjs` inherits the environment and does not
clear `NODE_TEST_CONTEXT`: remove that variable before nested Node test runners.
For a doc-only map update, check relative links, line count and source symbol names;
do not run mutating build/refresh/generation commands without matching authority.
