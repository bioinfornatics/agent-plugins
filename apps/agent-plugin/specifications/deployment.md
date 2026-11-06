# Build, Skill projection and deployment

Read before changing entrypoints, dependencies, mapping, launchers or generated
runtime; also read [development.md](development.md).

## Historical migration contract — 2026-11-03, ap-fdz0

At this dated snapshot, the authorized **0.6.0 candidate was not published**. The source app is
`apps/agent-plugin`; its CLI is `agent-plugin evaluation`, `history` and `inspect`.
The existing installed path `skills/skill-creator/scripts/skill-creator.mjs` now
launches this app's emitted JavaScript. This is an executable replacement, not a
compatibility alias for the old creator commands or an installed PATH command.

The distribution retains five Skills but projects **only the skill-creator
runtime**. Other Skills retain authoring instructions with historical old
CLI references; do not claim those commands still work. Old standalone creator
executables, validation, packaging, grading, scoring, HTML reporting and historical
import are retired. Retained reference files are historical, not active routing.
No standalone native creator executable is delivered by this candidate. These dated
retirements describe the old command families, not the supported additions below.

## Node build and contained layout

Development and installed execution require Node.js **>=22.22.2**. `npm ci` uses
`package-lock.json`; `npm start -- <args>` runs `src/index.ts` with native TypeScript
stripping. Installed execution uses emitted ESM, not TypeScript source access.

```text
skills/skill-creator/
  SKILL.md
  scripts/skill-creator.mjs       # generated CLI launcher
  scripts/generate-report.mjs     # source-owned contained Node helper
  assets/report-viewer.html       # data-free static template
  runtime/
    runtime-manifest.json
    package.json
    dist/index.js
    <emitted application modules>
    node_modules/<locked production dependencies>
    THIRD_PARTY_NOTICES.md
```

Current declared app commands (inspect scripts before executing):

| Command from apps/agent-plugin | Purpose |
|---|---|
| `npm run build` | `scripts/build.mjs`: compile `tsconfig.build.json` into staged ESM `dist`, preserve previous output on failure |
| `node scripts/package-runtime.mjs <new destination>` | Package a contained Skill runtime and launcher; destination must be new |
| `npm test` | Active source regressions; not installed-host proof |
| `npm run typecheck` / `npm run lint` | Source/test static gates |

There is no app `npm run deploy`. End users must not compile, download a runtime,
install dependencies or use Python/Bun/shell launchers. The manifest maps
`src/index.ts` to `dist/index.js` and binds the packaged production closure.
The separate report helper requires the contained `assets/report-viewer.html`;
the CLI does not render reports itself. Package only required modules,
locked production dependencies, licenses and notices; exclude secrets, development
tooling, fixtures and private-path source maps. Do not hand-edit generated runtimes.

## Ownership and public behavior

TypeScript, tests, lockfile, build and packaging tooling are app-owned sources.
Mapping/generation/projection tooling is repository-owned. Launcher paths resolve
relative to the installed Skill, never sibling apps, developer absolute paths or
global module fallback. Preserve argument boundaries, errors, exit status/signals
and caller-owned streams; reject unsupported Node versions and manifest/path escapes.

Selectors compose one deduplicated profile; exact `evals/evals.json` discovery uses
immediate Plugin Skill children, skipping missing suites but rejecting all absent
or any malformed suite. Every scenario treats the whole profile. Normal evaluation
uses bounded parallel Goose trials and shared SQLite registry with campaign-isolated
evidence; private HOME/XDG is not an OS sandbox. Dry-run launches no host.
Standalone `validate` checks Skill format only, not evaluation or packaging.
History and inspect are read-only; resume uses frozen stored parameters and sources,
with explicit uncertain retry, append-only attempts and integrity checks.
Current grading/regrading/judgments and explicit export are wired. Export produces
grading.json, a workspace and an optional quality-only benchmark; no token/cost/time
telemetry is inferred. Historical import remains pending. Native activation
and model compatibility are separate, still unverified beyond recorded evidence.

## Contained report generation

The installed Skill can generate a new self-contained HTML report from an explicit
completed export without Python, an upstream checkout, npm setup, models, database
or network calls:

```bash
node <skill-root>/scripts/generate-report.mjs --workspace /path/to/export-root --output /existing/parent/NEW-review.html
node <skill-root>/scripts/generate-report.mjs --workspace /path/to/export-root --output /existing/parent/NEW-review.html --skill-name "Review label"
```

`--workspace` is the export root containing `export-manifest.json`, not `iteration-1`
or a registry/evidence archive. `--output` is required and must be new, outside the
export and protected source/evidence roots; its parent must exist. The helper checks
the complete explicit manifest, exact inventory/hashes, grade/run identities and
matching decisive summaries before creating HTML. It never overwrites inputs or
existing output, selects latest grades, or reruns candidates.

All selected outputs, including nested artifacts and confidential logs, are embedded
without automatic redaction. Review disclosure before sharing. The committed static
template contains no campaign data or external dependencies. With/Without/Compare,
JSON/chat views, grade disclosures and optional quality-only Benchmark are supported;
feedback is page-session only and Done downloads `feedback.json`, not a workspace
or database update. Local consistency hashes are not authenticated provider proof.
See [the report workflow](../../../skills/skill-creator/references/review-viewer.md)
for exact input, browser and disclosure limits.

## Repository pipeline and verification

```text
source → emitted ESM → contained Skill runtime → local allowlisted projection
       → exact-source verification + current authorization → published main
```

Run repository tooling only after its mapping/source inputs are coherent and within
authorized scope. `npm run build:skill-runtimes` generates declared runtime mirrors;
`npm run check:skill-runtime-dist-drift` checks generated-output drift.
`npm run test:distribution`, `npm run project:production` and
`npm run test:production` cover local distribution/projection; none publishes.
Changing documentation is not evidence that these gates have passed.

Before acceptance:

1. Build from declared sources and lockfile; verify closure, licenses, mapping and
   source inventory. Do not build concurrently with consumers of the same dist.
2. Copy the contained Skill outside the repository; run with Node >=22.22.2,
   no Bun, `apps/` access, NODE_PATH fallback or end-user package setup.
3. Check help and supported evaluation/history/inspect/grading/export/validate seams, invalid and retired
   commands, space-containing arguments, output, errors/signals, lazy SQLite,
   Node-version rejection and tampered manifest. Use isolated test directories;
   never touch live installations or launch paid campaigns without authority.
4. Check the copied contained report helper with its template: explicit export, new
   output, unchanged inputs, malformed input rejection and browser interactions.
   `node --test tests/test_report_generator.test.ts` runs from the repository root;
   existing `REPORT_PLAYWRIGHT_MODULE` and `REPORT_CHROMIUM` enable browser coverage.
   A skip is not browser acceptance; do not install tooling implicitly.
5. Run affected drift/distribution/projection/install gates. Distinguish static,
   source, copied-runtime, native-host/model and platform evidence. This document
   does not certify a build, projection, installation or host/model acceptance.

## Publication is separate

Follow repository-root rules and `docs/branch-migration.md`: reviewed sources on
`develop`, exact-source proof, current authorization and allowlisted projection to
`main` with previous main as sole parent. Recheck source/main races and provenance.
Do not merge `develop` into `main`, force-push production or infer approval from CI.
No live installation, restart, push, release or credentials action follows from a
local build or documentation change. Report source, local verification/projection
and remote publication separately; this document does not establish the current
candidate's publication state.

## Local reconstruction and update evidence — 2026-11-03

One mapped runtime is generated from agent-plugin; other creators are instructions
only. Retained old runtimes/native scripts are historical inputs, excluded from
production and current clean reconstruction. Dependency preparation is lock-bound
from nine authenticated npm tarballs, no lifecycle scripts; Linux x64 qualified.
Full isolated rebuild and local Git install/update pass under pinned Goose1.47.0;
source/runtime copies run help, dry-run, fake campaign, inspect and frozen resume.
No operator HOME installation, remote push or promotion performed. Workflow local
checks are not GitHub canonical exact-SHA proof; retain source/approval/race gates.
