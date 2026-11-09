# Generate and review an exported evaluation

Use this workflow for an existing `agent-plugin export` workspace. Generation reads inputs without modifying them and writes new HTML locally: no model, database, network, Python, npm installation or
upstream checkout is needed. The entire installed Skill contains the Node helper
its static template and pinned browser libraries. Resolve `<skill-root>` to the loaded Skill directory.

## Generate

```bash
node <skill-root>/scripts/generate-report.mjs --help
node <skill-root>/scripts/generate-report.mjs --workspace /path/to/export --output /existing/parent/NEW-review.html
node <skill-root>/scripts/generate-report.mjs --workspace /path/to/export --output /existing/parent/NEW-review.html --skill-name "Review label"
```

Use Node.js >=22.22.2. `--workspace` is the **export root** containing
`export-manifest.json`, not `iteration-1`, a campaign evidence archive, or a
SQLite registry. `--output` is required, must be new, and must be outside the
exported workspace and protected source/evidence roots. Its parent must exist.
For an end-to-end evaluation, use the agreed `review.html` beside the export,
not inside it. If it exists, choose a new unoccupied filename in the authorized
parent. Resolve a missing writable destination, not permission for each local stage.
A standalone report request stays report-only. No output is overwritten. Repeating with a different new filename and unchanged
inputs/label produces identical HTML. A failure is nonzero and does not authorize
a candidate rerun or selection of a newer grade.

The helper requires the current `agent-plugin-explicit-quality-v1` schema-v1
manifest with `status: complete` and no `.export-pending` marker. It verifies the
exact file inventory, sizes and SHA-256 hashes before generating, then verifies
explicit unique grade/run bindings, matching metadata/criteria/decisive summaries,
and any quality-only benchmark rows. It refuses missing, unmanifested, linked,
corrupt, incompatible or ambiguous inputs. It never discovers a latest run or
regrades. These mutable local hashes prove consistency, not authenticated provider
provenance. No hostile-filesystem race sandbox or crash-atomic write is claimed.

## Disclosure before sharing

**All selected runs and output files are embedded, including nested artifacts and
confidential logs.** There is no silent sampling/truncation and no automatic secret
redaction. Review the HTML and source export for private paths, prompts, responses,
logs, credentials or other sensitive data before sharing. The committed template
contains no campaign data; the generated HTML intentionally contains user data.
Files which are not valid UTF-8 text remain exact-byte binary downloads. SVG,
spreadsheets and other unknown formats are download-only; there is no CDN renderer.

## Review in a browser

Open the generated HTML locally. Report file existence separately from actual
browser verification. Exports must contain explicit `scenario.source` (`skillName`, optional `pluginName`),
matching run/scenario metadata. Old exports without this field are rejected: re-export
the same retained grades with the current CLI, without evaluation or regrading.
The source identity identifies the suite origin; treatment remains the whole profile.

The approved viewer provides:

- **Source skill** replaces the duplicate top prompt, showing `[plugin-name:]skill-name`
  from frozen source ownership, not the global title or a guessed checkout path.
  The authored prompt remains in the conversation and raw transcript.
- **Supporting artifacts** groups every supplementary output under one native
  disclosure closed by default; expand it for filenames, downloads and contents.
  Primary transcript/artifact index stays visible. Collapsing never redacts bytes.
- A **feedback dock** sits outside the scrollable output and reserves its own space,
  rather than overlaying content. Single view labels the selected condition;
  Compare retains two independent run-bound fields. Editors can be resized, and
  the bounded dock scrolls on small screens. Drafts remain page-session only.

- **With skill**, **Without skill**, and **Compare**, with case/repetition
  navigation. Comparison uses explicit eval/condition/repetition identity, never
  adjacency or prompt similarity; incompatible profile/scenario/agent identities
  are rejected. On case/repetition navigation, an available selected condition is
  preserved; if it is absent, the viewer selects the other uniquely available
  condition within that exact repetition. Compare is preserved. Explicitly selecting
  a missing condition still shows its absence; counterparts are never invented.
- Transcript cards keep a top toolbar: **Conversation** (default), **Tree view**,
  **Formatted JSON**, then separate raw copy/download actions. Each comparison
  column switches only its own content; grades and feedback remain unchanged.
  Expand/collapse controls appear only in Tree view. Other JSON defaults to Tree
  view. Technical-event details unfold inside Conversation without changing modes.
  Conversation view hides technical events and displays
  authored user/assistant text rendered with Marked GFM (including tables and
  nested lists), then DOMPurify under a strict Markdown-only policy. Source HTML
  stays literal; images become text links with no automatic fetching; only
  explicit HTTP(S)/mailto links are active. Raw JSON is preserved independently of display modes.
- **Formal Grades** appears before output/conversation, in single-condition view
  and in each Compare column. The percentage and passed/failed totals stay visible;
  criteria and evidence are read-only, collapsed disclosures.
- Diagnostic `.jsonl` and `.log` files (case-insensitive), including nested Goose
  streams/request logs, start collapsed. Expand their content with the native
  disclosure; the filename and download remain available while closed. Collapsing
  is not redaction: the complete contents are still embedded.
  An optional **Benchmark** shows exported quality-only results; no resource
  measurements, calibrated verdict or confidence claim is manufactured.
- Independent feedback fields for each condition. Switching modes retains edits
  only in this page session. **Done** downloads `feedback.json` with original
  `run_id` values; it does not POST, update the export, write a registry, or store
  feedback across reload. Download the file before closing/reloading.

### Unavailable condition

Older reports used “Unavailable — no unique run for this condition, case and
repetition.” when the viewer could not select exactly one run for the current
eval ID, condition and repetition. Current reports name that combination and
distinguish a run not included in the export, ambiguous multiple matches, and
unverified identity. When the other condition is uniquely available, the missing
condition message points to its selection button. Zero matches indicates a missing counterpart; multiple matches or
unresolved identity are ambiguous. The current generator rejects duplicate or
invalid run identities before creating HTML, so for a valid current workspace
export the usual cause is an omitted selected counterpart for that repetition.
A completed export need not contain a full pair. For example, With skill/run-1
and Without skill/run-2 do not form a pair; neither repetition has both arms.
The viewer never substitutes another repetition or guesses from prompt similarity.

A navigation defect in older reports retained the previous condition when moving
to a case/repetition containing only the other condition. That caused an empty
view despite an available run. Current case/repetition navigation selects that
unique available alternative; it preserves Compare and never masks ambiguity.
The explicit condition buttons still allow inspecting a genuinely missing arm.
Regenerate old reports with the current helper/template to obtain this behavior.

Check the explicit selected runs in `export-manifest.json` and the case/repetition
picker. If an existing matching graded run was omitted, export the intended grade
selection to a **new** workspace and generate a **new** HTML file. A missing run
or grade is separate evaluation work, not permission for an automatic model rerun.
This message is not a failed grade, nor does it mean a log file is missing. A
selected run without `transcript.json` has a separate transcript-unavailable message
in Compare; its other artifacts remain accessible in single-condition view.

There is no live report server, previous-feedback import, LLM summary, semantic
regrading or automatic acceptance. Other historical review/render commands and the
older decision-oriented Review IR/accessibility claims do not describe this helper.
Automated browser checks are not manual screen-reader acceptance.

## Attribution

`assets/report-viewer.html` adapts Anthropic's
[skill-creator eval-viewer](https://github.com/anthropics/skills/tree/main/skills/skill-creator/eval-viewer)
under Apache License 2.0, retained in `../LICENSE.txt`. Agent Plugins modifications
promote the approved v6 JSON/chat/comparison/feedback UI into a data-free standalone
template and remove remote fonts/SheetJS and server feedback initialization. The
Node helper implements only the current explicit export protocol; it does not
vendor or invoke the upstream Python generator.

## Offline Markdown dependencies

The contained `assets/report-libraries/manifest.json` pins Marked 18.1.3 (MIT)
and DOMPurify 3.4.17 (Apache-2.0 OR MPL-2.0), upstream tarball identities and local
SHA-256/size bindings. Exact browser distributions and license texts are retained
beside it. The generator verifies plain files and bindings before output creation,
then embeds exact scripts as Base64 data URLs once per report, plus license notices.
There are no CDN requests, npm installs, eval calls or adjacent-file dependencies.
Data URLs keep vendor JS outside the HTML script tokenizer; source bytes are not
rewritten. Local hashes detect drift, not authenticated publisher provenance.

Library updates are explicit reviewed upgrades: verify upstream tarball integrity,
replace distributions/licenses and manifest bindings together, then rerun copied
helper, browser safety and distribution checks. Never fetch latest during generation.
Regenerate a new HTML to update an old report; existing files are not overwritten.

## Evaluation overview and model-specific scores

Reports open on Overview with Needs attention and All evaluations. The bounded,
hash-bound `overview.json` records every frozen planned trial, including trials
without a selected decisive grade. Only explicit selected grades contribute scores;
technical errors, inconclusive, unselected and missing grades have no score.
Overview metadata is stored-binding validated; selected evidence is archive-reverified.
Rows show source/scenario, candidate host/model, judge configuration, criterion counts,
and selected/planned coverage. Candidate requested overrides are not effective-model
proof; configured defaults remain explicitly unknown. Candidate and judge identities
are separate, and judge/model partitions never share scores. Unknown-default results
from different campaigns must not be treated as the same model. One export covers one
campaign; comparing multiple campaign models in one report is not currently supplied.
With/Without deltas use only complete pairs inside a homogeneous partition. Attention
includes failed criteria in either arm, technical grading errors, absent selected
verdicts and unsuccessful execution. Candidate failed criteria are prioritized and
baseline failures are labeled separately. Expand Trials and evidence to open an exact
selected run; unselected trials list their state without fabricated detail or scores.
Return using Overview; detail feedback remains page-session/run-bound.

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
