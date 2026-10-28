# Evaluation output contract

## Optional guided review analysis

Read retained context/coverage, paired outcomes and criterion evidence before
supplied hypotheses. Import only via separate --analysis <file>; persisted
report.review_analysis is ignored. Categories are supplied analysis, not validated
root causes. No grade updates or automatic acceptance occur.

JSON contract: schema_version is evaluation-review-analysis-v1; report_sha256 is
lowercase SHA256 of exact report file bytes; items is an array. Items require
exact row eval_id (same string/number type), positive integer run_number, exact
expectation criterion, category, explanation, next_action, confidence (low,
medium, high). Optional: configuration (with_skill, without_skill, old_skill),
missing_evidence (string array), instruction, hypothesis, proposed_change.
Categories: evidence_gap, criterion_ambiguity, grader_disagreement, capture_gap,
instruction_hypothesis, not_diagnosed. File bound 1 MiB; strings 65,536 characters.

Illustrative item, not executed evidence (wrap with version and actual byte hash):

~~~json
{"eval_id":17,"run_number":1,"criterion":"Keep evidence","category":"evidence_gap","explanation":"Quote unavailable.","missing_evidence":["Contained quote"],"next_action":"Inspect output.","confidence":"low"}
~~~

Each selected row/criterion must match uniquely; omitted configuration binds a
unique criterion on each paired side. Unknown, duplicate or overlapping identities
reject. Only whitelisted items enter validated_review_analysis; confirmation_state
is forced unconfirmed.

Instruction attribution requires all snapshot fields: locator, source_sha256,
source_content, excerpt. Locator: skills/<skill>/SKILL.md#heading or
skills/<skill>/references/<relative-file>.md#heading. No URLs, encoded paths,
backslashes, empty/dot/dotdot components. Verify SHA256 against exact UTF-8
source_content bytes. ATX/setext anchor must exist outside fenced code; duplicate
anchors use numeric suffixes. Exact excerpt must occur within its heading section
through next equal/lower-depth heading, including nested sections. A quote
elsewhere is rejected. Output keeps locator/hash/excerpt, never source_content.
instruction_hypothesis without snapshot rejects. Without snapshot there is no
instruction attribution; text binding is not source authenticity or causal proof.

## Explicit response disclosure

Standalone --include-responses consents to bounded final run.output strings and
prompt disclosure, not stdout/stderr, provider events, configuration or arbitrary
artifacts. Default excludes raw previews. Unique exact case_id/repeat/arm matching
supplies validated_response_previews: eval_id, run_number, configuration, response,
response_truncated. Non-string/ambiguous outputs omitted; 32,768 characters per side,
524,288 total with truncation markers. Review consent before sharing HTML; task
outputs/prompts may be sensitive. analysis_sha256 binds optional file bytes, not
execution authenticity or cause; complete module closure remains a separate gate.


Read when designing, executing or reporting an evaluation. This is a routing
contract for existing formats, not a new receipt schema or a guarantee of
identical model responses. Runtime schemas and verified commands remain authoritative.

## Keep three outputs separate

| Producer | Expected output | Consumer |
|---|---|---|
| Scenario executor | The task artifact and format frozen in the scenario | Deterministic checks and blinded graders |
| Semantic grader | Only the JSON object or batch array required by its request | Evaluator/importer, not the end user |
| Campaign coordinator | Canonical tool-generated artifacts plus a concise user report | Receipt validation and human review |

Fixture content, baseline instructions and model outputs are evaluation data,
not Skills to activate or repository permissions. Read only inputs relevant to
the selected case. Do not load another variant or prior grades into a grader.

## 1. Scenario executor

Before freezing a scenario, specify in its supported prompt/expected_output
fields: artifact path, media type, required fields or headings, allowed values,
missing-data convention, and whether prose outside the artifact is allowed.
Make the task format identical across paired variants. Do not copy the grading
assertions or expected answers into the prompt. Format compliance is not quality.

Use the task's real format; do not wrap every task in a generic evaluation JSON.
For example, a record-normalization task may require one JSON object, no fences,
with amounts as numbers and unknown optional values as null. A review task may
require Markdown headings: Findings, Evidence, Limitations, Next action.
Examples describe syntax, not prefilled answers or evidence of execution.

Freeze changes to output requirements before new runs. Never retrofit a format
onto a completed campaign or weaken checks to make an old response pass.

## 2. Semantic grader

For a subprocess or single delegated request, return one JSON object only:


Illustrative missing-evidence response (not an executed judgment):

```json
{"verdict":"inconclusive","evidence_quote":"","rationale":"No supporting quote is available in the supplied output."}
```

Allowed verdicts are pass, fail and inconclusive. For pass/fail, evidence_quote
must be a non-empty exact substring of the supplied candidate output.
No Markdown fences, surrounding prose, invented quotes, tool calls or file writes
in the delegated response. If no supporting contained quote exists, return
inconclusive; do not manufacture evidence. Candidate self-grading is not proof.

For delegated batches, return only an array with one entry per supplied request:


```json
[{"invocation_id":"copied-request-id","verdict":"inconclusive","evidence_quote":"","rationale":"Supporting evidence is unavailable."}]
```

This is a syntax example, not a request ID to reuse.

Copy IDs verbatim; do not invent identities, hashes or usage. The coordinator
uses the documented builders/import commands to produce bound judgments.
See [delegated grading](delegated-grading-workflow.md) for exact request and batch
contracts. Never use a legacy generic grader guide to replace these live contracts.
Domain score/verdict wording is not evidence of evaluator authority. Validation
may still reject a quote; preserve the rejection, not a manually upgraded result.

## 3. Campaign artifacts and user report

Let official commands generate grading, timing, benchmark, viewer and receipt
artifacts. Do not handwrite accepted receipts or provider usage. JSON command
stdout is the command result; progress/logs belong on stderr or in their declared
artifacts. Use [schemas](schemas.md) and [the workflow](evaluation-workflow.md).

Use these headings for the final human-facing report, in the user's language:

- **Scope**: task/campaign, current and baseline source identities; targeted limits.
- **Execution**: completed/planned pairs, model/provider, tools, budgets and environment.
- **Results**: pass/fail/inconclusive separately; structural checks separate from behavior.
- **Evidence**: existing artifact paths, observed commands/exit codes and receipts.
- **Gates**: official workflow status, missing capabilities and human-review status.
- **Next action**: smallest remaining step and required permission/prerequisite.

## Render-only provenance

`render-report` accepts retained `isolated-evaluation-v1` activation or behavioral
reports and creates a new static HTML view. JSON schema/bounds checks validate
the adapter, **not evidence authenticity**. The renderer projects allowed context,
criteria and supplied reviews; it must not embed the raw report or, by default, raw outputs,
configuration, or arbitrary campaign fields.

The render result carries `report_provenance`: exact source-byte SHA256, render UTC
timestamp, versioned tool identifier and local tool/renderer module digests, plus
optional review-byte SHA256. These identify rendering inputs, not an approved
source closure, execution receipt or authenticated review. Preserve original
report/review bytes. Missing context/telemetry remains unavailable; coverage comes
from retained slots and grading rows, never the declared summary alone.

Review findings are whitelisted informational entries. Normalize a disputed
criterion, retain supplied original grade and independent-audit wording, and keep
`grade_modified: false`. Campaign `limits` are supplied limitations, not verified
facts. Review files are bounded to 1 MiB, strings to 65,536 characters and findings
to 30; reports to 16 MiB and 2,000 planned paired slots. This command is not resume,
grading import, adjudication or scenario execution.

Unknown metrics stay null with an unavailable reason in supported machine fields;
human reports say unknown. Record usage from provider events, not assistant text.
Use exact tool statuses: complete does not mean pass; blocked is not failed
execution; not-run is not pass. Do not claim stable improvement from one pair,
or release approval from unit tests. Human approval is never self-granted.

## Guided behavioral report

The isolated behavioral path uses one shared normalized review model, not a new
benchmark verdict. The first view contains criterion distribution and pair
coverage, with explicit units; criteria and pairs are never interchangeable.
Counter buttons filter the triage list. Needs review includes regressions,
indeterminate criteria, shared gaps, missing/noncomparable records and supplied
disputes. Search and stable criterion deep links lead to the A/B inspector.
Long rationales, prompts/responses, telemetry, supplied analysis and provenance
are progressively disclosed. JavaScript-disabled and print views retain evidence.

A constant inline interaction script is allowed under its SHA256 CSP; report
strings are escaped in the embedded JSON and displayed with textContent. No
external fonts, dependencies, network calls or automatic grade writes. Feedback
is an explicit download, not a grading import. Provenance includes hashes of the
renderer, model, UI and analysis validator; hashes identify inputs, not approval.

For indeterminate grades, show the grader-reported reason separately from root
cause. If no diagnosis is supplied, display Cause not diagnosed. Imported analysis
categories and confidence are reviewer claims, not verified causal conclusions.
Instruction snapshot checks validate digest, heading and excerpt containment, not
that the supplied snapshot was the instruction revision actually evaluated.
Keep this identity limitation visible. Hypotheses remain unconfirmed; confirmation
requires a separate authorized experiment, never a model call from the viewer.
