# Design executable scenarios from user questions

1. **Start from the capability and user outcome.** Read the actual Skill and relevant
   active workflows. Select useful positive journeys, distinct boundary interactions
   and observed regressions; do not optimize for a case count or refusal-only suite.
   A scenario should reveal a failure mechanism, not recite the Skill's instructions.
2. **Write a short natural request.** Name the supplied task input and desired outcome.
   Include only context a user would naturally provide. Keep expected answers,
   treatment helpers, command recipes and evaluator safety tails out of prompts.
   A real constraint such as “audit only” belongs to the request; evaluation governance
   belongs to the separately agreed execution/preparation protocol.
3. **Supply neutral inputs to both arms.** Declare Skill-root-relative `files` paths;
   current import copies their exact bytes to the same workspace-relative paths.
   Never depend on treatment installation to supply task data. `SKILL.md`, `AGENTS.md`,
   discovery/config roots, secrets and symlinks are reserved inputs. Inert drafts such
   as `SKILL.md.fixture` are data, not installed capabilities. Describe required
   materialization separately and verify the resulting target before claiming readiness.
   No current per-scenario setup hook or constraint enforcement is supplied. If native
   registry preparation cannot be generated safely, state the exact environment
   prerequisite and exclude that execution from ready coverage, rather than citing an
   imaginary registry or relabeling historical evidence as current.
4. **Derive atomic criteria and proof independently.** Put assertions outside prompts.
   For each case map source section -> user question -> criteria -> proof in coverage.md
   or agreed design notes, not a second tracker. Parse artifacts for format, links,
   arithmetic and exact identities; observe hashes/tool events for preservation and
   effects; use blinded independent semantic review for contextual adequacy. A task's
   claim that it validated, resumed or rendered is not proof. Keep inconclusive outcomes.
5. **Freeze the experiment.** Record source/input identity, criteria, configured model
   default or explicit override, host/tool availability, repetitions, turn/time limits
   and stopping rule outside closed suite fields. The current CLI compares composed
   profile presence/absence, not old/current revisions. Every Plugin child scenario
   receives the whole profile. Paid evaluation/grading needs explicit authority;
   additional repetitions or retries need a question that can change a decision.
6. **Check and deliver the suite.** Validate JSON, unique integer IDs, nonempty prompts
   and assertions, input existence/containment and coverage tags. Use current dry-run
   for preparation when permitted; do not launch candidates merely to validate a suite.
   Report setup gaps, uncovered risks and actual checks. Valid import is not behavior.

## Current executable suite subset

Use only the fields below for newly authored suites. Descriptive `target`, `subject`,
`language` and coverage metadata do not enforce execution constraints. The current
runtime diagnoses and rejects constraint extensions at execution; do not add
`preconditions`, `budget`, `capabilities`, `navigation_expectations` or
`execution_assertions`. Legacy aliases/schemas are not an authoring default.

```json
{
  "skill_name": "example",
  "coverage_dimensions": {"journey": ["audit"]},
  "evals": [{
    "id": 1,
    "name": "audit-draft",
    "subject": "skill-audit",
    "language": "en",
    "target": {"path": "evals/inputs/draft.md"},
    "coverage_tags": ["journey:audit"],
    "prompt": "Could you review evals/inputs/draft.md before I share it?",
    "assertions": ["Findings cite a concrete defect in the supplied draft"],
    "expected_output": "A source-linked review with actionable findings.",
    "files": ["evals/inputs/draft.md"]
  }]
}
```

## Evidence and cost boundaries

Prefer a representative real-host journey plus direct deterministic seams over
Cartesian campaigns. Distinct cases measure breadth; repetitions measure variability.
Count candidate and grader calls separately. There is no monetary cap option, and
unknown price/effective model identity stays unknown. Pair equivalent task files and
capabilities; do not deny baseline access or leak treatment instructions through setup.
Preserve failures and held-out criteria when feasible. A quality delta does not prove
reliability, model compatibility, accessibility or permission-sensitive effect absence.

The old enriched/freeze-evals contract is preserved in
[historical scenario design](historical/evaluation-design-pre-ap-9ato.md), not executed.
The current self-evaluation [coverage](../evals/coverage.md) and
[preparation](../evals/preparation.md) distinguish ready inputs from environment gates.

## Registered dynamic inputs

For retained consultation, an optional closed `preparation` descriptor `{ "kind": "retained-evaluation", "version": 1, "campaign": "completed" }` selects app-owned deterministic setup. An interrupted fixture may be selected explicitly with `campaign: "interrupted"`. It never selects a suite script or arbitrary command. Natural prompts may use `{{fixture.registry_path}}`, `{{fixture.campaign_id}}`, `{{fixture.with_attempt_id}}`, `{{fixture.without_attempt_id}}` (completed only), and `{{fixture.new_export_path}}`. The executor binds these after durable start, keeps the frozen template and actual task separately, and retains authenticated setup evidence. Unknown/malformed tokens fail discovery; unsafe binding values fail before launch. Non-simple values use documented POSIX argument quoting; no recursive expansion occurs. Dry-run never generates fixtures.
