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

### Defaults and storage navigation

Preserve defaults: omit optional evaluation/grading flags unless explicitly
requested by the user. Evaluation: Goose, configured model (no `--model`),
repetitions 3, parallelism 3, 50 turns, timeout 0, heartbeat enabled.
Grading/regrading: Goose, configured model, 20 turns, 600 seconds, heartbeat enabled.
Do not infer overrides from cwd/session provider or select `.artifacts` for durable
data. Required selectors/IDs and requested dry-run governance remain applicable.

[evaluation-locations.ts](../../../apps/agent-plugin/src/adapters/outbound/storage/evaluation-locations.ts)
resolves the shared XDG registry and sibling campaigns root on execution. Omit
evaluation `--registry`/`--output` by default.
[campaign-layout.ts](../../../apps/agent-plugin/src/adapters/outbound/storage/campaign-layout.ts)
provides `publishCampaignDirectory()`: all new CLI campaigns use
`profile=<id>/model=configured-<digest>/campaign=<uuid>` and descriptive
`campaign.json`; explicit output changes only the root. Direct/nested stores remain
flat UUID children. Model keys represent frozen configured host/provider/model identities, not actual backend proof.
Legacy default/requested partitions remain retained, never migrated. The stored DB path and
frozen plan remain resume/history authority; no retained paths are migrated.
Reuse a known nondefault registry for retained access, not a new discretionary
override. Resume accepts only registry, explicitly requested retry-uncertain and
quiet presentation alongside its ID, never new selectors or execution/output flags.
Export/report `--output` and helper `--workspace` are mandatory, not optional
evaluation defaults; new export/report destinations require authority.

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

`buildReportData()` requires explicit `scenario.source` names matching bound
metadata. The current exporter resolves unique source ownership from the frozen
profile, including retained grades without changing archive/judgment digests.
No legacy name guessing or filesystem lookup is supplied; re-export old workspaces.
The source label is `[plugin-name:]skill-name`, not the report-title override.

The viewer replaces the top prompt with Source skill and keeps the authored prompt
in conversation. `renderOutputs()` groups supplementary files in a closed native
Supporting artifacts disclosure. Feedback lives outside `.main` in a flex dock,
reserving viewport space; Compare fields are independent and bound to their runs.

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

## Overview export seam

Current reports require a bound `overview.json` referenced by the export manifest.
`buildReportData()` validates all planned trial coordinates and selected grade/score
bindings. `renderOverview()` opens the home attention queue, partitions candidate
and judge provenance, shows null for unavailable scores, and links exact selected
trials through `openOverviewTrial()`. The current exporter reads frozen population
through the application-owned CampaignOverviewHistory port; no model or live source
lookup occurs. One report covers one campaign, not a multi-model campaign merger.

### Decision-first overview cards

`renderOverview()` keeps source/task excerpt, dominant With-profile score, honest
selected/planned coverage, concise attention reason and exact review action visible.
Candidate configured provider/model identity is shared at page level (legacy unknown);
candidate host and distinct judge-configuration badges remain per card. No aggregation
changes occur. Baseline, criterion arithmetic, matched delta, judge provenance and
individual trial targets live inside closed Details. Task excerpts use an exact
scenario/host-bound exported prompt, never invented names; entirely unselected
scenarios retain an explicit identifier/task-unavailable label. Review evaluation
opens a selected With trial first (failed criteria prioritized), or selected baseline
when no With trial exists; absent selected evidence never gets a fabricated target.

### Score bands and ascending triage

Overview scores retain their criterion-weighted arithmetic and judge partitions.
Cards with a With-profile score sort by unrounded percentage ascending, then lower
selected/planned coverage ratio; remaining ties preserve source order. Unavailable
scores live in a separate To verify group placed before numeric scores, appear red
as urgent review items, and never become zero in the underlying data.
Bands use raw score: <50 red, <70 orange, <90 light green, >=90 dark green; numeric
labels remain visible. Coverage is concise beside the score. Criterion-failure
counts and baseline failure explanations stay in closed Details; primary alerts
are limited to grading errors, absent verdicts and unfinished/unsuccessful execution.

### Compact overview layout

Overview cards use an inline source label (no banner), a shared score/coverage
metric row, and a common Details/review-action footer. Native Details keeps a
full-width content box; the summary reserves the action footprint so evidence
never overlaps the action. The introduction groups counts, visible candidate
identity and filters; methodology lives in a closed keyboard-operable disclosure.
Scoped responsive styles wrap metrics rather than shrinking task typography.
Raw sort, score bands, coverage denominators and model/judge partitions are unchanged.

## Judge terminal diagnostics

The Goose judge accepts terminal text with valid `thinking` and `redactedThinking`
auxiliary blocks according to the inspected Goose v1.57.0 message schema; only text
forms the verdict. Tool requests, unsupported/malformed blocks and thinking-only
answers remain technical failures. Exact prompt attribution and original JSON,
criterion, hash and quote checks remain mandatory. This is local adapter verification,
not a claim that historical omitted responses contained those auxiliary blocks.

An established persistent judging directory receives exclusive private
`host-diagnostics.json`: fixed stage, observed process byte counts/status, mapped
terminal role/type counts and sanitization omission causes, never message or thinking
payloads. Raw diagnostics may still be omitted safely. Temporary HOME is removed;
preallocation or partial writer failures have no safe fallback diagnostic destination.
Existing grades and omitted historical logs are never retroactively rewritten.

## Validated verdict versus diagnostic sanitization — ap-sb8p

`GooseJudge.judge()` validates original terminal JSON and exact evidence before
credential handling. Raw diagnostic omission is independent of verdict availability.
`sanitizeValidatedText()` inspects bounded JSON-escape decoding copies, preserving
safe prose/identities/quotes exactly; unsafe rationale is redacted or omitted alone.
Unsafe identity/citation fields are refused, never rewritten. Final provenance/error
strings use structural sanitization, not recursive prose token parsing. Known
credentials remain protected; arbitrary encodings/unknown secrets are not covered.
No automatic retries, historical grade rewriting or paid verification is implied.

## Structural tool evidence — ap-3mwp

The judge reader exposes `list_tool_events({path,cursor,limit,exactTool?})` for
neutral artifact IDs alongside `list_manifest` and `read_artifact`. It authenticates
the entire conversation once, indexes only actual request/response blocks, and
uses exact IDs; missing/duplicate/orphan IDs never establish successful access.
Supported envelopes: `messages`, `conversation`, `conversation.messages`.
Scan status (`complete`, `unsupported`, `capped`) and pagination are separate.
Limits: 64 MiB cumulative indexed source, 200000 message/block locations,
1–100 events requested, 8 KiB page JSON, 512-byte snippets, existing 64 calls
and 256 KiB cumulative delivery. Snippets are not exact source citations; use
original `read_artifact` quotes. No byte-offset or heap-size guarantee is implied.
A complete direct-call index does not exclude nested wrapper calls or direct
file reads; inspect matched results before claiming consultation. Never execute
wrapper code or equate a listing/mention with activation. Incomplete scans cannot
prove absence. Historical packets/grades remain frozen; no model retry follows.

## Partial comparison cards — ap-3mwp

Unselected trials share condition availability with a uniquely selected judge
partition for the same scenario/host, but never contribute scores or acquire
selected judge provenance. Ambiguous partitions retain a separate availability
card. With/Without selected coverage and inconclusive/error states are visible.
A baseline-only selected partition displays its Without score, not a fictional
With score; raw With scores still control triage. Resolved historical technical
errors live in Details when a decisive selected verdict exists. Unselected
history is not resolved by choosing a latest grade; raw scores and exact targets
remain selection-bound. Regenerate a new report; never rewrite old exports.

## Configured candidate model projection — ap-h8f6

Frozen options may carry `candidateModels` per host with source/provider/model only.
Overview `candidateModel.configured` exposes that map; selected-only `trial.model`
comes from verified metadata receipts, never from the receipt-free history snapshot.
The report binds maps and session observations exactly, displays configured identities
and labels observations as session metadata, not backend proof. Missing legacy maps
remain unknown. Internal runtime pinning is not an optional user CLI override.
