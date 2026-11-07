> **Historical reference — not a current execution workflow.** Retained for provenance.
> Its commands, schemas and acceptance claims are not supported by the current CLI.
> Use [current evaluation](evaluate-workflow.md), [scenario design](evaluation-design.md),
> [authoring](create-workflow.md) or [report review](review-viewer.md) instead.

# JSON Schemas

This document defines the JSON schemas used by skill-creator.

## Contents

- [evals.json](#evalsjson)
- [history.json](#historyjson)
- [grading.json](#gradingjson)
- [metrics.json](#metricsjson)
- [timing.json](#timingjson)
- [benchmark.json](#benchmarkjson)
- [comparison.json](#comparisonjson)
- [analysis.json](#analysisjson)

---

## Mandatory isolated evaluation contracts

`run-evaluation` modes activation and behavioral (default) use the same mandatory isolated engine. Execution is default; --dry-run prepares without model calls. --mode isolated is invalid.

- Activation: `[{id?:number,query:string,expected_skills:string[],fixtures?:string}]`; should_trigger replaces expected_skills only for one explicit selected skill/no full plugin. Names include plugin namespaces.
- Behavioral: `{evals:[{id:number,prompt:string,expectations:string[],fixtures?:string}]}`; assertions is a string-array alias. Fixtures are clean directories relative to eval-set or global --fixtures. Skill-relative files unsupported.
- Single case: --prompt with --expected-skills for activation or optional --expectations JSON array for behavioral. Expectations never enter candidates.
- Workspace: frozen run.json (atomic state/digest envelope), report.json, review.html, per-case reports and per-arm response/task-evidence/artifacts, invocation receipts and projected session-log.json when export succeeds. Anonymous requests contain request_id, outputs and frozen expectations.
- Candidate session names are derived safely from scenario name/id, scenario identity, arm and repetition, unique in private HOME. Optional CLI --session-name <safe-prefix> changes the prefix, not the artifact destination or activation behavior. Candidates use goose run --name, never --no-session; before private HOME cleanup, goose session export --name <same-name> --format json is parsed only in bounded memory. No raw export is retained.
- session-log.json is a bounded review projection: literal unmasked visible user/assistant text and closed content-type counts only. Exclude tool arguments/results, thinking, provider settings and session metadata. It is not a full session backup, task-action proof or replacement for response/task evidence. Export failures are explicitly unavailable session evidence, separate from task execution/grading, and never trigger an automatic paid retry.
- `session_log.raw_files` is independent of export status: protocol `goose-raw-logs-v1`, session_name, status (`complete`/`partial`/`unavailable`), files (origin, source_path, path, bytes, sha256), origins (origin/path/status), issues (reason and optional origin/source_path), and successful manifest path/bytes/sha256. Paths are relative to the owned HOME or per-arm archive; `raw-logs/manifest.json` binds actual raw byte copies, not redacted projections. Complete refers to admitted files in available roots, not a guarantee that Goose emitted every possible log. See [raw retention policy](evaluate-workflow.md).
- --output is the canonical artifact/archive destination; the original-state history index references it without duplicating logs; prefer a new directory under ${XDG_STATE_HOME:-$HOME/.local/state}/agent-plugins/evaluations, not cache. Reuse the existing native CLI; no external archive flag, Python harness or new campaign command.
- Resume accepts optional --grading-results array `{request_id,judgments:[{text,verdict,evidence_quote,rationale}]}`. Decisive quotes match displayed outputs. Frozen state, outputs and existing grading bindings are revalidated; resume never launches candidates.
- New frozen campaigns declare grading_protocol decoded-task-sources-v1; anonymous packet outputs contain separately decoded original text sources. Quotes are checked against those sources, not metadata or serialized escape sequences. Historical campaigns without that marker retain their strict original packet contract; resume does not upgrade them.
- Missing grading/telemetry remains unavailable. Comparisons are descriptive gains/regressions/shared results plus available paired time/token differences, not authenticated acceptance receipts.

## evals.json

Defines the evals for a skill. Located at `evals/evals.json` within the skill directory.

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "name": "extract-pdf-with-missing-parser",
      "subject": "behavioral-evaluation",
      "language": "en",
      "prompt": "Extract the supplied PDF into the canonical output format.",
      "target": {
        "kind": "existing-skill",
        "execution": "execute",
        "path": "assets/evaluation-fixtures/pdf-extractor"
      },
      "preconditions": [
        "Copy the immutable target fixture into an isolated sandbox"
      ],
      "budget": {
        "max_turns": 12,
        "timeout_seconds": 600
      },
      "expected_output": "Description of expected result",
      "files": ["evals/files/sample1.pdf"],
      "capabilities": {
        "filesystem": true,
        "agent_runner": true,
        "browser": false,
        "network": false,
        "tools": []
      },
      "assertions": [
        "The output includes X",
        "The official deterministic validator reports success"
      ],
      "navigation_expectations": {
        "must_read": ["SKILL.md"],
        "read_when_relevant": [],
        "must_not_read": []
      },
      "coverage_tags": ["format:pdf", "failure:missing-parser"]
    }
  ]
}
```

**Fields:**
- `skill_name`: Name matching the skill's frontmatter
- `coverage_dimensions`: Optional top-level map of required `dimension` to values for a rule-rich deterministic domain; every declared `dimension:value` cell should appear in at least one scenario's `coverage_tags`
- `evals[].id`: Unique integer identifier
- `evals[].name`: Stable descriptive scenario name
- `evals[].subject`: Creator responsibility or behavior under test
- `evals[].language`: Prompt language code, paired with a `language:<code>` coverage tag
- `evals[].prompt`: Autonomous task statement that names its target instead of relying on “this Skill” context
- `evals[].target`: Structured target identity such as current/baseline Skill paths, a workspace, or a new output name; its `execution` is one of `explain`, `dry-run`, `execute`, or `resume`
- `evals[].preconditions`: Fixture immutability, baseline, capability, and workspace assumptions
- `evals[].budget`: Positive `max_turns` and `timeout_seconds` for executable agent scenarios, sized to the artifacts explicitly required; the Goose paired adapter defaults omitted `max_turns` to 40
- `aggregate_budget`: Root execution cap with positive integer `max_runs`, `max_turns`, and `timeout_seconds`; required for `standard` (3 pairs) and `release` (5 pairs), and validated against every scenario/configuration repetition.
- `evals[].model`: Optional host model identifier enforced for that scenario; the full-eval `--model` override applies to every paired run
- `evals[].expected_output`: Human-readable description of success
- `evals[].files`: Optional list of input file paths (relative to skill root)
- `evals[].capabilities`: Declared filesystem, runner, browser, network, and tool availability
- `evals[].assertions`: Atomic, observable statements graded for every run
- `evals[].navigation_expectations`: Required, conditional, and forbidden resource reads for progressive-disclosure cases
- `evals[].coverage_tags`: Optional stable `dimension:value` labels used to verify the coverage matrix of a rule-rich deterministic domain

Use `assertions` only in scenario and `eval_metadata.json` files. Use `expectations` only in `grading.json`, where every assertion gains `passed` and `evidence`.

---

## history.json

Tracks version progression in Improve mode. Located at workspace root.

```json
{
  "started_at": "2026-01-15T10:30:00Z",
  "skill_name": "pdf",
  "current_best": "v2",
  "iterations": [
    {
      "version": "v0",
      "parent": null,
      "expectation_pass_rate": 0.65,
      "grading_result": "baseline",
      "is_current_best": false
    },
    {
      "version": "v1",
      "parent": "v0",
      "expectation_pass_rate": 0.75,
      "grading_result": "won",
      "is_current_best": false
    },
    {
      "version": "v2",
      "parent": "v1",
      "expectation_pass_rate": 0.85,
      "grading_result": "won",
      "is_current_best": true
    }
  ]
}
```

**Fields:**
- `started_at`: ISO timestamp of when improvement started
- `skill_name`: Name of the skill being improved
- `current_best`: Version identifier of the best performer
- `iterations[].version`: Version identifier (v0, v1, ...)
- `iterations[].parent`: Parent version this was derived from
- `iterations[].expectation_pass_rate`: Pass rate from grading
- `iterations[].grading_result`: "baseline", "won", "lost", or "tie"
- `iterations[].is_current_best`: Whether this is the current best version

---

## grading.json

Located at `<run-dir>/grading.json`. The legacy readable review example below uses `text`, `passed`, and `evidence`; it is not the automated semantic-adapter response schema. Canonical evaluator records use `schema_version: 2`, `authority: "evaluator"`, and retain assertion-set/variant/output hashes, per-assertion verdicts, grader judgments, and inconclusive counts. `passed: false` alone does not distinguish fail from inconclusive; read `verdict` and `summary.inconclusive` in canonical evidence.

Automated semantic grading batches all criteria for one output/grader. `CommandGraderAdapter` expects `judgments`, an array with one `{id, version, verdict, evidence_quote, rationale}` object per published criterion. Verdict is `pass`, `fail`, or `inconclusive`; `evidence_quote` is an exact non-empty output substring and rationale is non-empty. Delegated batches use the [documented invocation-ID array](delegated-grading-workflow.md). The CLI validates containment and rationale, rejects explicit self-awarded claims, and retains identity, blinding, replay, and stale assertion/variant/output bindings. No lexical overlap test decides semantic correctness, and arbitrary descriptions are not accepted as `evidence_quote`. One valid decisive grader may pass/fail; additional requested graders must agree with valid evidence or aggregation is inconclusive.

```json
{
  "expectations": [
    {
      "text": "The output includes the name 'John Smith'",
      "passed": true,
      "evidence": "Found in transcript Step 3: 'Extracted names: John Smith, Sarah Johnson'"
    },
    {
      "text": "The spreadsheet has a SUM formula in cell B10",
      "passed": false,
      "evidence": "No spreadsheet was created. The output was a text file."
    }
  ],
  "summary": {
    "passed": 1,
    "failed": 1,
    "total": 2,
    "pass_rate": 0.5
  },
  "execution_metrics": {
    "tool_calls": {
      "Read": 5,
      "Write": 2,
      "Bash": 8
    },
    "total_tool_calls": 15,
    "total_steps": 6,
    "errors_encountered": 0,
    "output_chars": 12450,
    "transcript_chars": 3200
  },
  "timing": {
    "executor_duration_seconds": 165.0,
    "grader_duration_seconds": 26.0,
    "total_duration_seconds": 191.0
  },
  "claims": [
    {
      "claim": "The form has 12 fillable fields",
      "type": "factual",
      "verified": true,
      "evidence": "Counted 12 fields in field_info.json"
    }
  ],
  "user_notes_summary": {
    "uncertainties": ["Used 2023 data, may be stale"],
    "needs_review": [],
    "workarounds": ["Fell back to text overlay for non-fillable fields"]
  },
  "eval_feedback": {
    "suggestions": [
      {
        "assertion": "The output includes the name 'John Smith'",
        "reason": "A hallucinated document that mentions the name would also pass"
      }
    ],
    "overall": "Assertions check presence but not correctness."
  }
}
```

**Fields:**
- `expectations[]`: Graded expectations with evidence
- `summary`: Aggregate pass/fail counts
- `execution_metrics`: Tool usage and output size (from executor's metrics.json)
- `timing`: Wall clock timing (from timing.json)
- `claims`: Extracted and verified claims from the output
- `user_notes_summary`: Issues flagged by the executor
- `eval_feedback`: (optional) Improvement suggestions for the evals, only present when the grader identifies issues worth raising

---

## metrics.json

Output from the executor agent. Located at `<run-dir>/outputs/metrics.json`.

```json
{
  "tool_calls": {
    "Read": 5,
    "Write": 2,
    "Bash": 8,
    "Edit": 1,
    "Glob": 2,
    "Grep": 0
  },
  "total_tool_calls": 18,
  "total_steps": 6,
  "files_created": ["filled_form.pdf", "field_values.json"],
  "errors_encountered": 0,
  "output_chars": 12450,
  "transcript_chars": 3200
}
```

**Fields:**
- `tool_calls`: Count per tool type
- `total_tool_calls`: Sum of all tool calls
- `total_steps`: Number of major execution steps
- `files_created`: List of output files created
- `errors_encountered`: Number of errors during execution
- `output_chars`: Total character count of output files
- `transcript_chars`: Character count of transcript

---

## timing.json

Wall clock timing for a run. Located at `<run-dir>/timing.json`.

**How to capture:** When a subagent task completes, the task notification includes `total_tokens` and `duration_ms`. Save these immediately — they are not persisted anywhere else and cannot be recovered after the fact.

```json
{
  "total_tokens": 84852,
  "duration_ms": 23332,
  "total_duration_seconds": 23.3,
  "executor_start": "2026-01-15T10:30:00Z",
  "executor_end": "2026-01-15T10:32:45Z",
  "executor_duration_seconds": 165.0,
  "grader_start": "2026-01-15T10:32:46Z",
  "grader_end": "2026-01-15T10:33:12Z",
  "grader_duration_seconds": 26.0
}
```

---

## benchmark.json

Output from Benchmark mode. Located at `benchmarks/<timestamp>/benchmark.json`.

```json
{
  "metadata": {
    "skill_name": "pdf",
    "skill_path": "/path/to/pdf",
    "executor_model": "provider/model-id",
    "analyzer_model": "most-capable-model",
    "timestamp": "2026-01-15T10:30:00Z",
    "evals_run": [1, 2, 3],
    "runs_per_configuration": 3
  },

  "runs": [
    {
      "eval_id": 1,
      "eval_name": "Ocean",
      "configuration": "with_skill",
      "run_number": 1,
      "result": {
        "pass_rate": 0.85,
        "passed": 6,
        "failed": 1,
        "total": 7,
        "time_seconds": 42.5,
        "tokens": 3800,
        "tool_calls": 18,
        "errors": 0
      },
      "expectations": [
        {"text": "...", "passed": true, "evidence": "..."}
      ],
      "notes": [
        "Used 2023 data, may be stale",
        "Fell back to text overlay for non-fillable fields"
      ]
    }
  ],

  "run_summary": {
    "with_skill": {
      "pass_rate": {"mean": 0.85, "stddev": 0.05, "min": 0.80, "max": 0.90},
      "time_seconds": {"mean": 45.0, "stddev": 12.0, "min": 32.0, "max": 58.0},
      "tokens": {"mean": 3800, "stddev": 400, "min": 3200, "max": 4100}
    },
    "without_skill": {
      "pass_rate": {"mean": 0.35, "stddev": 0.08, "min": 0.28, "max": 0.45},
      "time_seconds": {"mean": 32.0, "stddev": 8.0, "min": 24.0, "max": 42.0},
      "tokens": {"mean": 2100, "stddev": 300, "min": 1800, "max": 2500}
    },
    "delta": {
      "pass_rate": "+0.50",
      "time_seconds": "+13.0",
      "tokens": "+1700"
    }
  },

  "notes": [
    "Assertion 'Output is a PDF file' passes 100% in both configurations - may not differentiate skill value",
    "Eval 3 shows high variance (50% ± 40%) - may be flaky or model-dependent",
    "Without-skill runs consistently fail on table extraction expectations",
    "Skill adds 13s average execution time but improves pass rate by 50%"
  ]
}
```

**Fields:**
- `metadata`: Information about the benchmark run
  - `skill_name`: Name of the skill
  - `timestamp`: When the benchmark was run
  - `evals_run`: List of eval names or IDs
  - `runs_per_configuration`: Number of runs per config (e.g. 3)
- `runs[]`: Individual run results
  - `eval_id`: Numeric eval identifier
  - `eval_name`: Human-readable eval name (used as section header in the viewer)
  - `configuration`: Must be `"with_skill"` or `"without_skill"` (the viewer uses this exact string for grouping and color coding)
  - `run_number`: Integer run number (1, 2, 3...)
  - `result`: Nested object with `pass_rate`, `passed`, `total`, `time_seconds`, `tokens`, `errors`
- `run_summary`: Statistical aggregates per configuration
  - `with_skill` / `without_skill`: Each contains `pass_rate`, `time_seconds`, `tokens` objects with `mean` and `stddev` fields
  - `delta`: Difference strings like `"+0.50"`, `"+13.0"`, `"+1700"`
- `notes`: Freeform observations from the analyzer

**Important:** The viewer reads these field names exactly. Using `config` instead of `configuration`, or putting `pass_rate` at the top level of a run instead of nested under `result`, will cause the viewer to show empty/zero values. Always reference this schema when generating benchmark.json manually.

---

## comparison.json

Output from blind comparator. Located at `<grading-dir>/comparison-N.json`.

```json
{
  "winner": "A",
  "reasoning": "Output A provides a complete solution with proper formatting and all required fields. Output B is missing the date field and has formatting inconsistencies.",
  "rubric": {
    "A": {
      "content": {
        "correctness": 5,
        "completeness": 5,
        "accuracy": 4
      },
      "structure": {
        "organization": 4,
        "formatting": 5,
        "usability": 4
      },
      "content_score": 4.7,
      "structure_score": 4.3,
      "overall_score": 9.0
    },
    "B": {
      "content": {
        "correctness": 3,
        "completeness": 2,
        "accuracy": 3
      },
      "structure": {
        "organization": 3,
        "formatting": 2,
        "usability": 3
      },
      "content_score": 2.7,
      "structure_score": 2.7,
      "overall_score": 5.4
    }
  },
  "output_quality": {
    "A": {
      "score": 9,
      "strengths": ["Complete solution", "Well-formatted", "All fields present"],
      "weaknesses": ["Minor style inconsistency in header"]
    },
    "B": {
      "score": 5,
      "strengths": ["Readable output", "Correct basic structure"],
      "weaknesses": ["Missing date field", "Formatting inconsistencies", "Partial data extraction"]
    }
  },
  "expectation_results": {
    "A": {
      "passed": 4,
      "total": 5,
      "pass_rate": 0.80,
      "details": [
        {"text": "Output includes name", "passed": true}
      ]
    },
    "B": {
      "passed": 3,
      "total": 5,
      "pass_rate": 0.60,
      "details": [
        {"text": "Output includes name", "passed": true}
      ]
    }
  }
}
```

---

## analysis.json

Output from post-hoc analyzer. Located at `<grading-dir>/analysis.json`.

```json
{
  "comparison_summary": {
    "winner": "A",
    "winner_skill": "path/to/winner/skill",
    "loser_skill": "path/to/loser/skill",
    "comparator_reasoning": "Brief summary of why comparator chose winner"
  },
  "winner_strengths": [
    "Clear step-by-step instructions for handling multi-page documents",
    "Included validation script that caught formatting errors"
  ],
  "loser_weaknesses": [
    "Vague instruction 'process the document appropriately' led to inconsistent behavior",
    "No script for validation, agent had to improvise"
  ],
  "instruction_following": {
    "winner": {
      "score": 9,
      "issues": ["Minor: skipped optional logging step"]
    },
    "loser": {
      "score": 6,
      "issues": [
        "Did not use the skill's formatting template",
        "Invented own approach instead of following step 3"
      ]
    }
  },
  "improvement_suggestions": [
    {
      "priority": "high",
      "category": "instructions",
      "suggestion": "Replace 'process the document appropriately' with explicit steps",
      "expected_impact": "Would eliminate ambiguity that caused inconsistent behavior"
    }
  ],
  "transcript_insights": {
    "winner_execution_pattern": "Read skill -> Followed 5-step process -> Used validation script",
    "loser_execution_pattern": "Read skill -> Unclear on approach -> Tried 3 different methods"
  }
}
```

Windows model execution is currently rejected: owned descendant process-tree cleanup is not implemented. Dry-run remains available. Interrupted campaigns remain incomplete with explicit missing run slots; resume only rebuilds/imports retained evidence, never executes missing candidates.

## Current evaluation protocol

The active isolated path uses bound decoded task sources only. Historical grading projections and workspace migrations are unsupported; archived evidence is preserved as files, not upgraded or rerun.
Use run-evaluation --resume --grade --output <directory> [--grader-timeout <seconds>] to execute one configured Goose judge per pending output. The host owns request and criterion identities; the model returns only indexed semantic judgments. Each attempted slot is recorded; automatic paid retries are forbidden.
A judge that requests tools is unavailable, not independent quality proof. Task-authored process claims remain unverified. Observer traces retain closed tool categories and request/response correlation, never tool arguments, body text, reasoning or guessed process outcomes.
Method references: https://www.comet.com/docs/opik/evaluation/overview and https://www.comet.com/docs/opik/evaluation/concepts . Opik also recommends human judge alignment: https://www.comet.com/docs/opik/evaluation/annotation_queues . Following these principles is not certification or integration with Opik.
