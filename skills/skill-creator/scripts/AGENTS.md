# Skill Creator executable seams — agent instructions and code map

## Mandatory rule: review documentation impact with every code change

For every code modification, assess whether applicable `AGENTS.md` files still
accurately describe entrypoints, options, contracts, call order and safety boundaries.
Read ancestor instructions and relevant source before editing; automatically update
owned affected maps in the same change. If a map is outside authorized ownership,
report the required correction instead of silently expanding scope. When no update
is needed, give the reason in the handoff, not a no-change log in this file.

This is an agent instruction, not a hook or CI enforcement mechanism. Its directory
scope is `skills/skill-creator/scripts/`; ancestor rules remain applicable. Paths
below are relative to this file. Static documentation checks do not prove runtime
behavior or agent compliance.

## Current entrypoints and ownership

This Skill contains exactly two scripts: the generated CLI launcher and the
source-owned report helper. Both require Node.js >=22.22.2. End users need the
whole contained Skill, not Python, an upstream checkout, root tooling or npm setup.

```text
skill-creator.mjs
  -> ../runtime/runtime-manifest.json
  -> spawn(Node, ../runtime/dist/index.js, arguments)
     -> main() -> createApplication() -> createCli() -> selected command handler

generate-report.mjs
  -> verifiedExport(explicit export root) -> buildReportData()
  -> verifiedReportLibraries() + ../assets/report-viewer.html -> new self-contained HTML
```

| Component | Source / navigation | Ownership and role |
|---|---|---|
| CLI launcher | [skill-creator.mjs](skill-creator.mjs) | Generated through declared packaging/runtime tooling; never hand-edit |
| Runtime mapping | [runtime-manifest.json](../runtime/runtime-manifest.json) | `apps/agent-plugin`, `src/index.ts` -> `dist/index.js`; contained generated inventory |
| Installed CLI | [index.js](../runtime/dist/index.js) | Generated application entry; never hand-edit |
| Source entry/lifecycle | [index.ts](../../../apps/agent-plugin/src/index.ts), [main.ts](../../../apps/agent-plugin/src/main.ts) | Process boundary and testable CLI lifecycle |
| Assembly/dispatcher | [composition-root.ts](../../../apps/agent-plugin/src/composition-root.ts), [create-cli.ts](../../../apps/agent-plugin/src/adapters/inbound/cli/create-cli.ts) | Dependency assembly and Commander command registration |
| Report helper | [generate-report.mjs](generate-report.mjs) | Source-owned standalone Node helper; built-in imports only |
| Report template | [report-viewer.html](../assets/report-viewer.html) | Data-free static viewer; no external dependencies or campaign data |

Authoring `apps/` paths are navigation only and are absent from installation-only
distributions. Never make the installed scripts depend on them or sibling Skills.

## Launcher execution and integrity boundary

The launcher validates Node version, its own plain-file path, manifest identity and
mapping, every inventoried runtime file's size/hash, and the exact runtime tree.
`plain()` rejects symlink path segments; `canonical()` rejects unsafe relative
inventory paths. Unlisted files/directories are rejected before runtime import.

It spawns the same Node executable with explicit arguments and inherited streams,
clearing `NODE_PATH` and `NODE_OPTIONS`. SIGINT/SIGTERM/SIGHUP are forwarded to the
child; child close propagates exit status or signal. Failures emit a diagnostic and
nonzero status. This is local integrity checking, not an OS sandbox or authenticated
publisher provenance. Caller-owned streams remain open.

## Current CLI navigation

`main(argv, output)` assembles the CLI and calls `parseAsync(..., {from: "user"})`.
Commander help/parse errors return their exit code; domain errors emit their message,
and unexpected errors emit the generic diagnostic. Command behavior belongs in
`adapters/inbound/cli/handle-*-command.ts` and application use cases, not assembly.

Supported commands are `evaluation`, `history`, `inspect`, `grading`, `regrading`,
`judgments`, `export` and standalone Skill-format `validate`. See the
[current command contract](../README.md#command-contract) and
[evaluation-to-report workflow](../references/evaluate-workflow.md) for exact
arguments and execution authority. Grading/evaluation can call models; history,
inspect, judgments and export are read-only at their stated boundaries. Report
creation is a separate script, not a CLI `render-report` or `review` command.

## Report helper contract and navigation

```bash
node <skill-root>/scripts/generate-report.mjs --help
node <skill-root>/scripts/generate-report.mjs --workspace /path/to/export-root --output /existing/parent/NEW-review.html
node <skill-root>/scripts/generate-report.mjs --workspace /path/to/export-root --output /existing/parent/NEW-review.html --skill-name "Review label"
```

Resolve `<skill-root>` to the loaded Skill. The parser accepts unique `--workspace`
and `--output` values and optional unique `--skill-name`; both required values must
be present. Workspace means the export root containing `export-manifest.json`, not
`iteration-1`, SQLite or an evidence archive. Output must be new, outside the export
and protected source/evidence roots, with an existing parent.

- `verifiedExport()` verifies the current complete explicit-export manifest, absent
  pending marker, exact regular-file inventory, sizes and SHA-256 hashes.
- `buildReportData()` validates explicit unique selected grades/runs, comparison
  identity, matching metadata/criteria/decisive summaries and optional quality-only
  benchmark rows; it never selects a latest run or regrades.
- `embedFile()` preserves selected nested outputs as UTF-8 text or exact-byte binary
  downloads. `generateReport()` reads the contained static template, safely serializes
  data into its unique placeholder, and creates HTML exclusively with `open(...,"wx")`.

There are no model, database or network calls and no writes to inputs. All selected
outputs are embedded, including confidential logs; there is no automatic redaction.
Review disclosure before sharing. Local mutable hashes do not authenticate provider
provenance; hostile filesystem races and crash-atomic writes are not claimed.

The viewer provides With skill/Without skill/Compare, case/repetition navigation,
JSON tree/formatted/raw and conversation views, visible formal grade summaries
before conversation with collapsed criteria/evidence, and optional quality-only
Benchmark. Nested `.jsonl`/`.log` output content starts collapsed; filename/download
remain visible and all bytes stay embedded. Case/repetition navigation preserves
Compare or an available condition, falling back only to a unique alternative in
the same repetition. Explicit missing-arm selection gives a contextual diagnostic;
ambiguous or unresolved identity is never silently replaced. Feedback is page-session only; Done downloads `feedback.json`
with original run IDs, not a workspace/database update. See the
[report workflow](../references/review-viewer.md) for browser and disclosure limits.
The template has no campaign data or remote fonts/CDN dependencies. Marked and
DOMPurify browser distributions live in `../assets/report-libraries/` with pinned
manifest hashes and licenses; `verifiedReportLibraries()` checks plain paths and
bindings before output creation. Exact JS bytes are Base64 data scripts (no eval,
network or HTML-tokenizer exposure); licenses are embedded as escaped hidden text.
`renderChatMarkdown()` uses Marked GFM and strict DOMPurify DocumentFragment output,
not a custom Markdown parser. HTML stays literal, images are links, and URLs remain
HTTP(S)/mailto-only. Table alignment uses fixed attributes/CSS, never source styles.

## Historical boundary

Before the November 2026 migration, this launcher mapped to the retired
`apps/skill-creator-cli` dispatcher (`cli.js`, `runCli`, `embedded`, `runEmbedded`)
and its creator/report command families. That mapping is historical only and must
not be used as current build, dispatch or command guidance. Current standalone
validation, grading/export and the Node HTML helper are supported additions, not
compatibility aliases. No Python generator, live report server or old creator
packaging command is supplied.

## Verification and handoff

Instruction-only changes: inspect relative links, symbols, exact command mappings
and the changed text; do not rebuild runtimes solely for documentation. For app
changes, follow [development](../../../apps/agent-plugin/specifications/development.md).
For runtime/launcher changes, follow [deployment](../../../apps/agent-plugin/specifications/deployment.md)
and declared root tooling; generated files are never hand-edited.

From the repository root, `node --test tests/test_report_generator.test.ts` exercises
the copied contained helper, export rejection and non-overwrite boundaries. Set
`REPORT_PLAYWRIGHT_MODULE` and `REPORT_CHROMIUM` to existing tooling to enable the
browser test; missing tooling is a disclosed skip, not browser proof. Do not install
browser dependencies or launch models implicitly. Never mutate live `~/.agents`.
Report static, source, copied-helper, browser and installed-host evidence separately.
No Git, release, credentials or remote action is authorized by this map.
