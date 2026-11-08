# Generate and review an exported evaluation

Use this workflow for an existing `agent-plugin export` workspace. Generation is
local and read-only: no model, database, network, Python, npm installation or
upstream checkout is needed. The entire installed Skill contains the Node helper
and its static template. Resolve `<skill-root>` to the loaded Skill directory.

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
No output is overwritten. Repeating with a different new filename and unchanged
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
browser verification. The approved viewer provides:

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
  literal authored user/assistant text with a safe small Markdown subset, not
  executable source HTML. Raw JSON is preserved independently of display modes.
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
