# Evaluate, grade, export and review

Use the current contained `agent-plugin` launcher below, not historical
`run-evaluation`, `review`, `render-report`, or upstream Python commands. Resolve
`<skill-root>` to the loaded Skill directory. Existing retained evidence can enter
at inspection, export or report generation without launching candidates again.

## 1. Freeze scope and execution authority

Use the supplied exact `evals/evals.json` suites and Skill/Plugin selections. Do
not begin with an unsolicited redesign or add cases/repetitions/graders. If suites
are missing, ask or author only under explicit permission. Normal evaluation and
grading may contact paid models. Freeze candidate sources, criteria, model/host,
repetitions, turn/time limits, permitted actions and stopping rule before launch.
There is no monetary-cap flag; disclose unknown costs. Private HOME/XDG isolates
host discovery, not operating-system/keyring/network access.

## 2. Evaluate and inspect

```bash
node <skill-root>/scripts/skill-creator.mjs evaluation --skills /path/to/skill --dry-run
node <skill-root>/scripts/skill-creator.mjs evaluation --skills /path/to/skill --model <model>
node <skill-root>/scripts/skill-creator.mjs inspect <campaign-id> --json
```

Repeat/combine `--skills` and `--plugin` to compose one profile. Every scenario
compares the whole selected profile with its absence. Default repetitions 3,
parallelism 3, max turns 50 and timeout 0 (disabled) apply unless authorized options
are supplied. Dry-run only validates the matrix. Use `--registry <file>` consistently
when an explicit isolated registry is selected. Inspect the returned campaign ID,
logical trials and exact attempt IDs; process completion is not quality acceptance.
Missing evidence remains a gap. Do not retry automatically.

## 3. Grade explicit attempts

```bash
node <skill-root>/scripts/skill-creator.mjs grading <campaign-id> --attempt <attempt-id> --json
node <skill-root>/scripts/skill-creator.mjs judgments <campaign-id> --json
```

Grade each selected completed candidate attempt explicitly under grading execution
authority. Optional `--model`, `--max-turns` and `--timeout` bound the judge as
requested; omitted model uses its configured default, not an inferred effective
model. Preserve technical failures, unavailable/uncertain outcomes and disagreement.
`judgments` is read-only. `regrading` appends a fresh judgment for an explicit
attempt and requires new execution authority; it never replaces earlier grades.
Retain the exact successful decisive grade UUID for export. Do not select a grade
because it is latest or favorable, or treat a task's self-report as independent
acceptance. The CLI's grader execution does not establish calibrated judge quality.

## 4. Export the explicit selected grades

```bash
node <skill-root>/scripts/skill-creator.mjs export <campaign-id> --grading <with-grade-id> --grading <without-grade-id> --benchmark --output /existing/parent/NEW-export
```

`--grading` repeats once per selected logical trial. Export reads the registry and
reverifies corresponding attempt archives; it performs no model calls. The output
directory must be new with an existing parent. `--benchmark` is optional and requires
complete homogeneous selected pairs; omit it for a workspace-only export, not to
hide failed quality. The benchmark is quality-only; duration/tokens/cost are not
inferred. Export rejects ambiguous, missing, corrupt or nondecisive selections.
Check a parseable complete `export-manifest.json` and absent `.export-pending`.

## 5. Generate and inspect the report

Before rendering or sharing, read [report generation and disclosure](review-viewer.md).

```bash
node <skill-root>/scripts/generate-report.mjs --workspace /existing/parent/NEW-export --output /existing/parent/NEW-review.html
```

The standalone Node helper verifies the manifest and embeds every selected run and
output, including potentially private logs. It does not modify the export, call a
model or open SQLite. Open the generated HTML and verify With/Without/Compare,
JSON/chat displays, grade disclosures and optional benchmark. Feedback is page-session
only; Done downloads a file, not a server or database update. A report-only request
starts here with an existing export and never reruns candidates to fix the UI.

## 6. Report observed results and stop

Give exact campaign/export/HTML paths, grade selections, observed comparison and
missingness, commands/checks actually performed, browser verification status and
next action. Separate execution, grading, export integrity, report generation,
behavioral effectiveness, host compatibility and acceptance. Local evidence is not
authenticated provider proof or publication authority. Change evaluated sources
only when improvement is separately authorized.
