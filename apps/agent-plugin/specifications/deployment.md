# Build, Skill projection and deployment

Read before changing entrypoint compatibility, dependencies, resources, runtime
mapping, launchers or generated distribution. Also read [development.md](development.md).

## Current app runtime decision — 2026-11-03

The user replaces Bun with npm and Node.js >=22.22.2 for app development.
`npm ci` uses the sole `package-lock.json`; `npm start -- <args>` runs
`src/index.ts` with native TypeScript stripping. Tests use `node:test` and
`node:assert`; storage lazily loads `node:sqlite` through its local wrapper.
There is no app build/deploy step. Local npm/Node verification passes (92 tests,
source/test typecheck and lint; see development.md);
this source runtime change does not migrate the installed launcher, mapping or runtime.

## Historical installation decision and rationale — user confirmed 2026-11-02

Keep the existing Git-backed `main` installation channel and source-contained
JavaScript runtime. The user installs one Git tree, not an OS-specific release
archive. A Bun-built native binary is OS/architecture-specific; a universal
TypeScript/Python shebang launcher would require an interpreter and is not an
interpreter-free solution across Windows/Unix.

Selected installation layout:

```text
skills/skill-creator/
  scripts/skill-creator.mjs      # Small Node.js 22+ launcher
  runtime/
    runtime-manifest.json       # Closed entry mapping
    <emitted JavaScript>
    <production dependencies and resources>
```

No Python/Bun/shell launcher, runtime download, end-user compilation or dependency
installation is introduced. Native release archives may exist separately under
repository policy; they do not replace this channel and are not delivered by this task.

## Ownership and compatibility

- Editable TypeScript, tests, package/lockfile and build configuration belong to
  `apps/agent-plugin`. Installed Skill runtime material is generated.
- Launcher paths resolve relative to the installed Skill, never repository cwd,
  sibling application sources, absolute developer paths or global module fallback.
- Package exact production closure, required HTML/resources, licenses and notices;
  exclude secrets, test fixtures, dev tooling and private-path source maps.
- Launch using an argv array; preserve arguments, exit codes/signals and caller streams.
  Validate manifest entry mapping and reject traversal/symlink escapes.
- Source Node/TypeScript execution does not prove emitted, contained installed
  runtime compatibility. Verify entrypoint startup, lazy `node:sqlite` loading and
  production closure in a separately authorized installation migration.
- Do not hand-edit `skills/*/runtime/`, the launcher or generated outputs to simulate
  migration. Update sources/mapping/generators through declared tooling.

## Rename is source-only

The rename to `apps/agent-plugin` and public `agent-plugin evaluation` command do
not rename the installed Skill or launcher. Keep
`skills/skill-creator/scripts/skill-creator.mjs` unchanged. No runtime mapping
migration, generated runtime replacement, or publication belongs to this slice.
Source preparation JSON is not installed Node compatibility evidence.

## Current gap: new app is NOT projected

`config/skill-runtimes/skill-runtime-map.json` still maps logical `skill-creator`
to `apps/skill-creator-cli`, source `src/cli.ts`, emitted `dist/cli.js`. That old app
is removed from this workspace. The new app uses `apps/agent-plugin/src/index.ts`
and has no build/deploy script or emitted runtime. The existing Skill launcher is
not proof that it executes the new preparation CLI.

Do not run global regeneration against this known stale mapping as a shortcut.
Migration requires a bounded task: define Node-compatible emitted entry, build,
source closure/resources/dependencies, update mapping and inventories, generate in
isolation, then verify copied installed Skill without application access.
No runtime replacement or production publication is authorized by documentation.

## Pipeline and commands

Conceptual stages are distinct:

```text
editable source → build → contained Skill runtime → local production projection
                  → exact-source verification + authorization → publish main
```

Observed repository scripts, run from repository root **only after their inputs
and the new-app migration are valid**:

| Command | Stage / limits |
|---|---|
| `npm run build:skill-runtimes` | Generate runtime mirrors; currently blocked for this app by stale mapping/build inputs |
| `npm run check:skill-runtime-dist-drift` | Compare declared generated output; not a build or host proof |
| `npm run test:distribution` | Distribution regressions; inspect fixtures/source before execution |
| `npm run project:production` | Local allowlisted projection to `.artifacts/production`; not a remote deploy |
| `npm run test:production` | Projection regressions |
| `npm run promote:production` | Consequential publisher; requires explicit current authority and repository release gates |

There is currently no `npm run build` or `npm run deploy` in the app. Do not document
these as working commands until implemented and verified. Check current package
scripts again before execution; repository scripts can change independently.

## Verification required before replacing the installed runtime

1. Build from declared sources and locked production dependencies; verify licenses,
   closure, resources, manifest mapping and source inventory.
2. Run a copied Skill outside the repository with the declared Node runtime, no Bun,
   no `apps/` access, NODE_PATH fallback or package manager setup.
3. Test help, invalid arguments, exact output routing, arguments with spaces, errors,
   signals and required resources. Verify Node version rejection and tampered manifest.
4. Run generated-output drift and applicable distribution/projection/install checks.
   Source Node smoke tests do not substitute for installed Node evidence.
5. Report each mode/platform tested and untested separately. Preserve old runtime
   and existing user changes until authorized migration is verified.

## Publication is a separate gate

Follow repository-root rules and `docs/branch-migration.md`: reviewed sources on
`develop`, exact-source verification, current authorization, allowlisted generated
projection to `main` with previous main as sole parent. Do not merge develop into
main to resolve intentional source/distribution conflicts, force-push production,
or infer approval from green checks. Verify source/main races and remote provenance.

No push, installation into live HOME, restart, release or credential action follows
automatically from build/projection. Report build, local projection, installed tests
and remote publication as separate results; no publication performed by this document.
