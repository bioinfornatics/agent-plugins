# Design executable scenarios from user questions

1. **Start from the capability and user outcome.** Read the actual Skill and relevant
   active workflows. Select useful positive journeys, distinct boundary interactions
   and observed regressions; do not optimize for a case count or refusal-only suite.
   A scenario should reveal a failure mechanism, not recite the Skill's instructions.
   Apply the [intention-to-observation mapping](#map-intentions-to-observable-realization)
   before selecting prompts, fixtures and assertions; choose explanation or execution
   explicitly rather than crediting an explanation as realized behavior.
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
   Arbitrary per-scenario setup hooks and custom constraint enforcement are not
   supplied. The closed app-owned retained preparation recipe documented below is
   supported; it cannot execute a suite-provided command. If a requested registry
   fixture is not supported by that recipe or cannot be verified safely, state the
   exact prerequisite and exclude that execution from ready coverage rather than
   citing an imaginary registry or relabeling historical evidence as current.
4. **Derive atomic criteria and proof independently.** Put assertions outside prompts.
   For each case derive criteria and proof from the source and user request; keep
   assertions in the suite, not a second tracker or mandatory sidecar. Parse artifacts for format, links,
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

## Map intentions to observable realization

Read the actual Skill's intent table and the conditional workflow rules governing
that journey, not just its description. For each selected intention, derive a
compact design mapping before authoring; keep execution governance outside closed
suite fields and keep the final atomic assertions in the suite.

| Design input | Question to resolve |
|---|---|
| Source intention / rule | Which user outcome and exact conditional source rule does this case test? |
| Realistic trigger | What ordinary request and genuine initial state make that rule applicable? |
| Authority / prerequisite | What may the agent actually do, with which tools, task mechanism and owned paths? |
| Expected action / restraint | What must happen, or must not happen, beyond describing the rule? |
| Observable oracle | Which independent artifact, public seam or matched tool event distinguishes correct realization from plausible prose? |
| Insufficient evidence | What answer, supplied result or incomplete observation could look convincing without proving that outcome? |

**Choose the proof level explicitly.** An explanation case asks for diagnosis,
planning or a handoff and measures that deliverable; it cannot prove a repair,
verification run or refusal to execute. An execution case requests a concrete
authorized action and supplies a runnable public seam and genuine initial state.
A restraint case must make the forbidden action feasible and observable while
withholding its authority; a final unchanged file alone cannot prove no action
occurred. A source/static check measures instruction or fixture conformance, not
behavioral Skill TDD. Never label fictional task records as live tracker/Git facts.
Declare a controlled task-state mechanism honestly, or require the real integration
when the source rule demands it. Missing mandatory authority, recording, fixture,
tool or host capability is a precise prerequisite and inconclusive execution
coverage, not permission to force a conflicting route or weaken the criterion.

For example, Iterate's correction intention needs a real failing controller test,
current repair authority and remaining attempts: observe the symptom-specific red
before production mutation, a durable counter increment before corrective dispatch,
a scoped production repair and an actual test rerun. Its proof-only intention needs
a working unchanged controller: observe Test work without code writes or a consumed
attempt. At 3/3 exhaustion, observe a task-state read followed by no corrective
dispatch, no writes and no counter reset; retain the failure and required decision.
These cases measure different action/restraint decisions, not three paraphrases of
an intended answer. Use a minimal independent exact-one cancellation test and
user-owned sentinel bytes rather than supplied PASS receipts.

**Separate final state from temporal evidence.** An independent deterministic
oracle can check final behavior, counters, hashes and inventories. It cannot infer
red-before-repair, counter-before-dispatch, transient writes or actual routing from
final bytes. Require matched real tool arguments/results and relevant state
transitions bound to the frozen case, arm and candidate. Conditional Skill routing
in the treatment needs an actual load/consultation event (or allowed direct source
read) with applicable inputs and subsequent action; verbal Skill-name recitation
is insufficient. Do not manufacture a baseline failure because it lacks treatment
Skill names: compare the same authorized behavioral outcomes, and assess treatment
instruction realization separately. Missing, unmatched or incomplete tool evidence
leaves temporal/action criteria inconclusive; absence of effects requires complete
coverage of relevant effect-capable tools. No generic wrapper attestation,
candidate-authored self-receipt or supplied PASS earns execution credit. Do not
claim a recorder, grader execution or instrumented run that was not performed.

**Keep task data neutral and answers out.** Prompts should name ordinary project
inputs and desired work, not `evals/` metadata or purpose-input packets, assertion
IDs, target Skill names, expected routing commands or evaluator oracles. Declare
safe relative task paths and verify the current import's exact workspace mapping;
do not assume a rename or imaginary setup capability. Give both arms identical
neutral fixtures, authority and public verification tools, never treatment rules
or an answer-bearing prepared result. Hold independent oracle/initial-state
evidence outside candidate inputs. Current semantic grading cannot run scripts:
perform any separately authorized deterministic oracle check outside the grader,
retain its actual candidate-bound result, then let read-only grading inspect it.
A grader's statement that a script passed is not an observed script execution.

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
    "target": {"path": "inputs/draft.md"},
    "coverage_tags": ["journey:audit"],
    "prompt": "Could you review inputs/draft.md before I share it?",
    "assertions": ["Findings cite a concrete defect in the supplied draft"],
    "expected_output": "A source-linked review with actionable findings.",
    "files": ["inputs/draft.md"]
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

Unsupported enriched suite constraints must not be used. Declare task inputs explicitly; missing execution prerequisites remain unresolved.

## Registered dynamic inputs

For retained consultation, an optional closed `preparation` descriptor `{ "kind": "retained-evaluation", "version": 1, "campaign": "completed" }` selects app-owned deterministic setup. An interrupted fixture may be selected explicitly with `campaign: "interrupted"`. It never selects a suite script or arbitrary command. Natural prompts may use `{{fixture.registry_path}}`, `{{fixture.campaign_id}}`, `{{fixture.with_attempt_id}}`, `{{fixture.without_attempt_id}}` (completed only), and `{{fixture.new_export_path}}`. The executor binds these after durable start, keeps the frozen template and actual task separately, and retains authenticated setup evidence. Unknown/malformed tokens fail discovery; unsafe binding values fail before launch. Non-simple values use documented POSIX argument quoting; no recursive expansion occurs. Dry-run never generates fixtures.
