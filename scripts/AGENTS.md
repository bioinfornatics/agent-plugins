# Root authoring tooling — context map

## Mandatory documentation-impact review

**For every code change, review documentation impact before considering the work complete.**
Check whether entry points, options, call order, ownership, generated outputs, safety
boundaries or verification requirements changed. Automatically update the applicable
`AGENTS.md` context maps when needed, together with affected user documentation;
record “no documentation impact” with a reason when none is needed.

This is an agent work rule, **not a hook or CI implementation**. Updates must stay
within the task's authorized paths and exclusive-writer ownership. If an affected
map is outside scope, report the exact required update to its owner/coordinator;
do not overwrite another worker's changes or enlarge permissions silently. Do not
edit generated installation guidance, fixtures or live installations as a shortcut.
A documentation update never authorizes builds, cleanup, installation, Git writes,
credentials, remote operations or publication.

## Scope and reading strategy

- Inherit [root operational rules](../AGENTS.md). This directory contains source-side
  orchestration for `develop`, not installed creator launchers or production authoring tools.
- Start with [package scripts](../package.json) and the task row below; follow direct
  calls only where the behavior being changed crosses that seam.
- Most `.mjs` files execute at module top level. Do not invent a `main()` or import
  them merely to inspect them: imports can build, delete, install or mutate Git.
  Named exported seams below are useful test targets, not a general safety guarantee.
- The objects/manifests below are JavaScript/Python data contracts, not TypeScript
  interfaces. There is no root-script TS class/interface hierarchy to learn.
- Read [contribution setup](../CONTRIBUTING.md), [promotion policy](../docs/branch-migration.md)
  or [documentation setup](../docs/documentation.md) only for the corresponding task.
- Do not recursively inventory generated `dist`, runtime, fixture, vendored or artifact
  trees for orientation. Read their declaring source/configuration first.

| Task | First seam | Then read only as needed |
|---|---|---|
| Restore/build development tools | [prepare-development.mjs](prepare-development.mjs), [rebuild-production.mjs](rebuild-production.mjs) | Per-app build scripts; dependency integrity |
| Change standalone Skill runtime closure | [generate-skill-runtimes.mjs](generate-skill-runtimes.mjs) | Runtime mapping, app package/lock/vendor metadata |
| Check VS Code workspace integration | [test-vscode-integration.mjs](test-vscode-integration.mjs) | Root/app `.vscode`, `agent-plugins.code-workspace`, app development specification; checks JSON and local help/dry-run only, not live breakpoints |
| Generate/review exported evaluation HTML | [generate-report.mjs](../skills/skill-creator/scripts/generate-report.mjs), [report workflow](../skills/skill-creator/references/review-viewer.md) | Contained source helper + data-free `assets/report-viewer.html`; no root generator or Python dependency |
| Change test groups or output handling | [ci-tests.mjs](ci-tests.mjs), [test.mjs](test.mjs) | Shard plan, platform classification, wrappers |
| Prepare local evaluation candidate | [prepare-evaluation-candidate.mjs](prepare-evaluation-candidate.mjs) | `projectProduction()` plus explicit suites/declared inputs under `evals`; generic source loader verifies bounds; no build/model/publication |
| Change Git distribution contents | [production.mjs](production.mjs) | Production tests, isolated install gate |
| Change approval/provenance/preflight | [production-request.mjs](production-request.mjs), [production-verification.mjs](production-verification.mjs) | Preflight and promotion workflows; trust section below |
| Change site build or publication | [build-documentation.sh](build-documentation.sh) | Integrity, link checker, browser tests, publication workflow |
| Change cleanup/source reproducibility | [clean.mjs](clean.mjs), [test-clean-source-reproducibility.mjs](test-clean-source-reproducibility.mjs) | Source manifest and inventory validator |

## Current Node reconstruction and verification — 2026-11-03

The abrupt migration retires the four creator CLIs and Bun/native release campaigns.
Obsolete executable scripts were removed; historical evidence/resources remain retained.

1. `prepare-development.mjs` authenticates nine Linux-x64 npm tarballs against the
   app lock SHA-512 and vendor manifest, extracts offline without lifecycle scripts,
   checks package identity and paths, and creates new app node_modules only.
2. `rebuild-production.mjs` captures current app dist/runtime/launcher hashes+modes,
   builds apps/agent-plugin and generates skill-creator runtime, rejecting drift.
3. `generate-skill-runtimes.mjs` validates the unique app mapping and closed package,
   generates only skills/skill-creator/runtime and its launcher with rollback.
   No builds inside generation; build before consumers. `check-skill-runtime-dist-drift`
   rebuilds current app dist and compares it, not read-only.
4. `test-clean-source-reproducibility.mjs` copies only declared sources/tarballs into
   private HOME/XDG, authenticates dependencies, regenerates twice, checks hash/mode
   stability and zero npm cache usage, then verifies projection. Full mode executes
   current app and root contracts; explicit Goose required for host install/update.
5. `ci-test-plan.mjs` recursively partitions every current app test exactly once into
   four shards. Canonical jobs remain quick/skill-1..4/remaining/verify. Retired
   legacy creator grading/HTML/native guarantees are retired-not-accepted, not green
   mocks. Current explicit grading/export and the contained Node report helper have
   their own active tests; retirement is not a claim that those additions are absent.
6. `test.mjs` runs current app tests and closed root remainder. Build/generate before
   test consumers, separate checkouts for parallel CI. Missing required CI Goose fails.
7. `test-production-install.mjs` uses an explicit Goose binary and fresh HOME/XDG,
   isolated Git identity/hooks and local Git source. Install/update verify five Skills,
   one contained launcher, metadata retention, readonly history and removal of seven
   old executable/runtime/fixture canaries. No live HOME or model calls.

Runtime dependencies are recorded under vendor/agent-plugin-tarballs; preserve
older vendor material. Current source inventory and build order declare new inputs.
Build/preparation proof is Linux x64 only; Node runtime portability and model efficacy
remain separate. No actual GitHub run or publication follows from local verification.

## Git distribution and publication trust boundary

- [production.mjs](production.mjs) exports `projectProduction(destination)`,
  `verifyProduction(root)`, `smokeProduction(root)`; CLI modes are `project|verify|smoke`.
  Projection requires a new non-overlapping destination; copies an explicit installation
  allowlist, excludes development resources, validates each runtime with `runtimeClosed()`,
  records source commit/tree and `inventorySha256`, then verifies the projection.
  Smoke verifies first, then invokes the single contained launcher with empty PATH/NODE_PATH.
  **Projection does not publish and does not establish approval or a clean source tree.**
- Its trusted preflight closure is only `promotion-preflight.mjs`,
  `production-request.mjs`, `production-verification.mjs`, copied into `.github/scripts`
  alongside selected workflows. Root authoring `scripts/` is not shipped wholesale.
- [test-production-install.mjs](test-production-install.mjs), top level: verify/smoke →
  disposable repository/HOME/Goose paths → pinned Goose 1.47.0 Git install → exact Skill
  discovery/no authoring leakage → launcher checks → local update → repeated discovery
  and obsolete-fixture removal. It creates temporary Git history, never live installs.
- [production-request.mjs](production-request.mjs): `validateRequestIdentity()` checks an
  open non-draft same-repository **develop → main** request and exact source/base races.
  `validateRequest()` also rejects outstanding change requests and requires independent
  current-SHA maintainer approval OR exact-source explicit personal-owner manual authority.
  CLI `--identity-only` is not authorization. Do not confuse policy checks with permission
  granted to the current agent.
- [production-verification.mjs](production-verification.mjs):
  `awaitCanonicalVerification()` uses `selectCanonicalRun()`/`validateCanonicalJobs()`
  and `requiredJobs` (**quick, remaining, skill-1..4, verify**). Only canonical same-repo
  **push/develop**, exact-SHA, successful current run/attempt/job metadata qualifies.
  It rechecks source and reruns; CLI also compares source workflow bytes.
  PR/fork/stale/caller-artifact proof is not equivalent, and CI proof is not review.
- [promotion-preflight.mjs](promotion-preflight.mjs): `verifyPromotionPreflight()` checks
  identity → canonical verification → identity again. CLI requires HEAD equal exact main.
  [promotion-pr.yml](../.github/workflows/promotion-pr.yml) uses `pull_request_target`,
  exact base checkout, no persisted credentials, read-only contents/actions/PR permissions,
  and rejects foreign heads. PR source is API data only: **never checkout/import/build PR
  head, execute its artifacts, interpolate PR text into shell or use publication secrets**.
  A passing preflight is informational; missing conflicted-PR checks are not success.
- [promote-production.yml](../.github/workflows/promote-production.yml): resolve approval →
  await canonical proof → publish job rechecks proof/approval before promotion, then closes
  the request without merging. [promote-production.mjs](promote-production.mjs), top level:
  clean/pushed develop and expected main → fetch → retained canonical candidate verification →
  verify/smoke/install → frozen recheck/staged blob+mode verification → temporary index/tree/commit with **previous main as sole parent** →
  candidate ref → remote main/source race checks → optional normal fast-forward push.
  **Even without `--push`, it fetches and creates Git objects/refs.** The script does not
  itself perform independent approval checks; the workflow guards remain separate.
- Never merge/rebase develop into main to resolve intentional source/distribution conflicts;
  never force-push. Actual GitHub execution and repository/environment protection need
  separate observed evidence; local tests do not prove trigger rollout or enforcement.
  No command described here grants publication authority.

## Contained report helper — current

The skill-creator Skill ships exactly two scripts: the generated CLI launcher and
the source-owned `scripts/generate-report.mjs`, plus `assets/report-viewer.html` and pinned Marked/DOMPurify browser assets/licenses
under `assets/report-libraries/`. The helper verifies those bindings before writing
and embeds exact scripts as Base64 data URLs once per HTML, with license notices.
Marked owns GFM parsing/rendering; DOMPurify enforces a strict Markdown-only policy.
Raw HTML is literal, images become text links, and URLs stay HTTP(S)/mailto-only.
Use Node.js >=22.22.2 and
`node <skill-root>/scripts/generate-report.mjs --workspace <export-root> --output <NEW-html> [--skill-name <label>]`.
The export root contains `export-manifest.json`; output must be new, outside the
export/protected source/evidence roots, with an existing parent. The helper verifies
explicit export integrity and grade/run bindings, then embeds all selected outputs,
including confidential logs. Inputs and existing HTML are never overwritten; review
disclosure before sharing. There are no models, SQLite, network, Python or upstream
dependencies. The template contains no campaign data or external dependencies.
Explicit scenario source names are required and matched to bound metadata;
re-export retained grades for old workspaces, without model calls. The top Source
skill label is `[plugin-name:]skill-name`; the prompt remains in conversation.
Supplementary files are grouped in a closed Supporting artifacts disclosure, and
a space-reserving feedback dock remains outside scrollable output, with independent
Compare fields. Formal grade summaries precede conversation; criteria/evidence and `.jsonl`/`.log`
contents start collapsed without removing embedded data or downloads. Navigation
selects a unique available alternative only within the destination repetition;
explicit missing conditions receive contextual diagnostics, never guessed pairing.

`node --test tests/test_report_generator.test.ts` exercises the copied helper and
rejection boundaries. Existing `REPORT_PLAYWRIGHT_MODULE` and `REPORT_CHROMIUM`
enable viewer interaction/feedback-download checks; a skipped browser case is not
proof. These direct tests do not build runtimes. In contrast, `ci-tests.mjs remaining`
invokes `test.mjs` and its committed-runtime drift gate, which rebuilds app dist;
do not run that group under a no-build restriction.

## Native tooling retirement

The Bun native compiler, archive packaging, offline-native bundle, staged installer,
tagged native workflow and their tests were removed. Root package/Make entrypoints
expose current Node verification only. Their native guarantees remain retired and
unverified; current Git-install safety is tested at test-production-install.mjs.

## Cleanup and source closure

[clean.mjs](clean.mjs) exports `CLEAN_PATHS` and `cleanGenerated(root)`:
validate root ancestry → resolve all safe targets → remove only root `bin`, `dist`,
`release-staging`, `release-assets`, `.artifacts`. Skill runtimes, vendor and retained
proof are not routine cleanup targets; preserve unrelated work even inside disposable areas.

[validate-change-set-inventory.mjs](validate-change-set-inventory.mjs), top level, validates
[ source-manifest.json ](../config/reproducibility/source-manifest.json): canonical regular
required files, generated declarations, no overlap, and no undeclared tracked/untracked
inputs outside Beads. New source paths need declarations by their authorized owner;
do not bypass inventory or edit the manifest outside scope.

[test-clean-source-reproducibility.mjs](test-clean-source-reproducibility.mjs): `copyDeclared()`
projects only manifest inputs into a disposable source tree → verify vendor integrity →
initialize temporary Git → validate inventory → build apps/contract and refresh compatibility →
generate runtimes → repeat for byte/mode stability → applicable native parity/full tests.
`--build-only` instead runs targeted production projection tests after reproduction.
`installVendoredModules()` and `snapshot()` support isolation. It also writes/removes a
source-worktree canary; do not assume “isolated” means zero source writes.

## Bilingual documentation flow

1. [build-documentation.sh](build-documentation.sh): `check-documentation.py --source-only` →
   clear only disposable site output → copy shared assets/build strict English and French
   Zensical sites → finalize → full link check → seal and verify integrity.
2. [check-documentation.py](check-documentation.py): `check()` uses `route()` and
   `Page(HTMLParser)` to verify language/page/nav parity, links/anchors and page-preserving
   language selectors. [finalize-documentation.py](finalize-documentation.py), top level,
   writes entry/404 pages, `.nojekyll` and exact source provenance.
3. [documentation-integrity.py](documentation-integrity.py): `inputs()`/`source()` hash source;
   `inventory()` hashes plain outputs; `verify()` checks exact inputs/output/provenance and
   ignored shared-asset copies; `clean_source()` rejects dirty sealed publication inputs.
   CLI `seal|verify|clean`; the `build-manifest.json` object binds inputs to outputs.
4. [test-documentation-integrity.py](test-documentation-integrity.py) tests extra/modified/
   symlink outputs and temporarily changes/restores an ignored asset. Not wholly read-only.
   [test-documentation-browser.mjs](test-documentation-browser.mjs), top level, uses real
   Chromium: desktop/mobile EN/FR routes, diagram SVGs, keyboard/Escape, overflow and no-JS
   navigation. `PLAYWRIGHT_MODULE`, `CHROMIUM_PATH`, `DOCS_URL` select tooling/site;
   default is a local server over generated output, with artifact screenshots.
5. [documentation.yml](../.github/workflows/documentation.yml): build/integrity/browser →
   artifact → restricted develop publication job with `github-pages` environment → Pages
   build request. Owner/environment approval is not independent review; verify real rules.
6. [publish-documentation.sh](publish-documentation.sh): check → verify hashes → require
   clean sealed inputs/current provenance (and current develop in CI) → temporary Git repo
   tracking prior gh-pages or orphan first publication → copy site → commit → normal push.
   It defaults to `upstream`; never execute based on this map alone. Documentation publication
   is independent of plugin/main promotion and requires explicit current authority.

## Local evaluation candidate preparation

`prepare-evaluation-candidate.mjs` exports async `prepareEvaluationCandidate(destination)`
and `verifyEvaluationCandidate(destination)`; CLI `prepare|verify <directory>`. Node
>=22.22.2 uses native TypeScript stripping to reuse the generic source loader, not
generated runtime imports. Preparation requires current contained runtimes; it does
not build. A new destination outside protected source paths (or below `.artifacts`)
receives schema-v2 `production/`, `plugin/` and sibling `candidate-manifest.json`.
Production is projected once and safely copied; its manifest remains intact in `production/`. A verified production
projection is enriched with five suites and only explicit `files` closure under
`evals`; external/legacy `fixtures` declarations require migration, not implicit copying.
The distribution manifest is removed from the plugin and retained as a baseline in
the sibling record: this enriched tree is not verified production or approval.

Validation uses the existing generic loader, including its shared snapshot bounds,
before final directory rename. Failed preparation removes only its private staging
directory. Reject existing destinations, links/special files, unsafe input paths and
conflicting overlays. The ordinary-filesystem checks are not a hostile concurrent
filesystem sandbox. Verification detects inventory/mode drift and checks treatment
against the production baseline without original source access; hashes are integrity,
not signatures. Commit/tree are informational when source inputs are dirty; the
actual file inventory and evaluation fingerprint bind copied contents.

Evaluate `<destination>/plugin` through the existing `evaluation --plugin` option.
`evals` is discovery/input data and excluded from installed treatment.
`snapshotBytes` counts installation bytes only; the generic load also bounds suites
and scenario inputs. `test_evaluation_candidate.test.ts` belongs to the closed root
remainder. Preparation, dry-run and tests do not establish live host/model behavior.

## Frozen promotion seams

`frozen-candidate.mjs:verifyFrozenCandidate(directory, expectedSource)` is the
built-in-only static verification seam: checks production through `verifyProduction`,
candidate inventory and treatment equality, never imports candidate runtime/TS.
`candidate-transfer.mjs` CLI `pack|unpack <input> <new-output>` uses bounded data-only
JSON with source/repository/run/attempt identity and restores executable intent.
CLI `download <new-file>` requires pinned artifact ID/API SHA-256 in environment,
checks archive bytes before streaming its unique `candidate.json` member via unzip;
no path extraction. GitHub CLI/unzip are required in the publishing runner.

Canonical verify uploads only push/develop artifacts named by source/run/attempt.
`selectCandidateArtifact()` rejects missing/duplicate/expired/foreign/digest-less
artifacts. Promotion passes pinned outputs and rechecks them before publishing.
`promote-production.mjs` requires the frozen envelope argument and never calls
`projectProduction`; verify/smoke/install then temporary index and guarded normal
push. Candidate data is not trusted code. Approval and metadata proof stay separate.
Dry-run is not behavioral model acceptance. Live workflow proof remains unverified.

Before push, the publishing seam requires all artifact pins, rechecks canonical proof
and approval, then remote identities. API/Git checks remain optimistic, not atomic.

`tests/test_frozen_promotion.test.ts` invokes the actual publication CLI in a
disposable Git repository with a local bare remote and private identity/HOME/hooks.
It checks successful push, exact blob/mode equality, previous-main sole parent and
source index/worktree preservation, plus install-time corruption refusal. Goose
installation and GitHub proof/approval are explicit test doubles; this is publication
mechanics proof, not live host/API acceptance. The declaring source test belongs
to the root remainder and never pushes to operator remotes.

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
Candidate requested/default identity is shared at page level (effective model unknown);
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
