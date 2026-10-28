# Evaluation scenario design

Read this reference before creating or changing activation or behavioral evaluation scenarios.

## Risk-distinct, cost-aware design

**Maximize coverage of distinct risks, not the number of tests.** A risk is a materially different failure mechanism or consequence, not a new wording of the same prompt. This is a design objective, not permission to remove required acceptance or release checks.

Before freezing cases:

1. Identify the user outcome, central claims, observed failures and material safety boundaries. Prioritize by impact and plausible likelihood; use qualitative levels when no measured probabilities exist.
2. Map each material risk to a scenario or direct check, its observable expected result, evidence source and cheapest valid oracle. Mark uncovered risks explicitly. Keep this compact mapping in the agreed design notes/tracker; do not invent mandatory fields in the simple eval schemas.
3. Select a case because it adds a failure mechanism, boundary, interaction, realistic journey or regression protection. Merge redundant prompt variants only when their evidence obligations remain covered; shared vocabulary does not establish redundancy. One coherent case may cover related risks through separate atomic assertions.
4. Prefer equivalence classes, boundary values and meaningful state transitions over exhaustive prompt permutations. Add combinations when the interaction itself is risky; do not require the full Cartesian product. Cheap deterministic tests may still need many cases for genuinely different rules.
5. Freeze criteria, fixtures, source/baseline identity, permitted actions and execution/repetition budgets before launching. Preserve held-out cases for improvement claims when feasible; report any limits of generalization.

### Global and marginal execution cost

Before launching, account separately for candidate and grader calls. Candidate calls
scale with selected scenarios, compared variants and repetitions. Grader calls depend
on the adapter: a batch-capable grader may judge all criteria for one output in one
call; a criterion-level adapter multiplies by semantic criteria as well as graders.
Include optimization/repair rounds, retries and provider timeouts in the total bound.
Use measured prices when available; otherwise disclose unknown monetary cost and
bound calls and time. Never introduce planning-only fields into closed runtime schemas.

For every proposed expansion record: uncovered risk or decision-changing uncertainty,
additional calls/time/cost, stopping condition and required authority. If no useful
information gain is expected, do not execute it. Preserve an explicit uncovered-risk
list rather than pretending a cheap subset meets a required full acceptance protocol.

### Choose the oracle per assertion

| Property | Preferred evidence and check | Limit |
|---|---|---|
| Format, schema, local links, arithmetic | Parse/validate artifacts; resolve contained links; recompute totals, rates and thresholds from known inputs | A valid schema or existing link does not prove semantic correctness; remote access needs permission and may be unavailable |
| Permission-sensitive effects, preservation, provenance | Observe actual tool events, artifact hashes, source bindings, before/after state and exit/status results | An assistant promise or filesystem separation alone proves neither absence of side effects nor execution authenticity |
| Contextual routing, relevance, adequacy of clarification/handoff | Independent blinded LLM judgment with frozen atomic criteria, exact evidence and an inconclusive option | Do not replace contextual judgment with keyword matching; calibrate against human examples and escalate ambiguity/high stakes |
| Integration and operational usability | A few representative real-host journeys with the required tools and observable outcomes | Unit/static/synthetic checks do not prove real-host orchestration or browser behavior |

Split mixed assertions: check the calculation in code, then judge whether the interpretation fits the user context. Batch related semantic criteria for one output; do not routinely buy a separate grader for every assertion. Check outcomes rather than prescribing a tool sequence, except where ordering is a public contract or a safety requirement.

### Keep important boundaries explicit

Retain each applicable boundary below. Mark a boundary not applicable only with a scope reason, not to meet a cost target. Use minimal fixtures rather than a full pipeline when they expose the same risk reliably.

| Boundary | Scenario contrast | Observable evidence |
|---|---|---|
| Permissions | Read-only request versus explicitly authorized mutation/publication | Tool actions and changed state stay within current authority; unauthorized effects absent; contextual refusal/clarification judged separately |
| Stale evidence | Valid frozen result versus changed source, fixture or expired approval | Binding/expiry check rejects reuse; response does not relabel historical proof as current |
| Missing context | Sufficient input versus a decision-critical missing input | Agent requests the missing decision or blocks the affected action without inventing facts; unaffected permitted work can continue |
| Preservation of work | Existing user edits and prior outputs versus an empty workspace | Before/after hashes or targeted diffs preserve protected content; resume does not rerun completed work without cause |
| Correction stop | Recoverable failure versus exhausted budget or repeated no-progress failure | Observed attempts respect the agreed bound; agent stops with a blocker and restart action, without weakening criteria |

A safety-boundary failure remains visible per assertion; a good average cannot cancel an unauthorized action or fabricated proof.

### Repeat only for a defined information gain

Distinct scenarios measure breadth; repeated trials measure variability on the same case. Neither substitutes for the other. Before repeating an expensive candidate or grader, state the question (unstable decision, ambiguous judgment, required reliability or small paired effect), metric, maximum trials/cost and stopping rule. Keep paired variants equivalent and preserve all attempts, including unavailable outcomes.

An unchanged deterministic check normally needs no repeated model execution. Retry missing grader slots only when candidate bindings remain valid; infrastructure failure is not a negative skill verdict. If no new information is expected, stop or choose an uncovered risk. Required repetitions in an approved protocol remain required.

One successful trial is an observation, not reliability proof. Repeated grading of one output does not measure candidate variability. Correlated trials, reused context, cached evidence and shared failures do not become independent samples merely through repetition. Report sample size and uncertainty where supported; never invent confidence intervals or tokens. At-least-one-success (pass@k) is not all-trials consistency (pass^k). For adaptive statistical decisions, use an approved sequential method; do not repeatedly peek at ordinary fixed-sample intervals and stop at a favorable result.

Separate the execution/repetition budget from the repair budget. Stop corrections at the agreed bound, preserve failures and open risks, and ask for a new decision rather than silently extending the loop.

### Research basis and applicability

Sources consulted on 2026-10-26; recommendations are adapted to this Skill, not numeric quotas or new runtime contracts:

- [Anthropic, Demystifying evals for AI agents](https://www.anthropic.com/research/demystifying-evals-for-ai-agents), 2026-01-09: code/model/human grader trade-offs, tasks versus trials, balanced positive/negative cases, observable outcomes and uncertainty. Its suggested initial dataset size is context-specific, not a mandatory test count.
- [Google Testing Blog, Just Say No to More End-to-End Tests](https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html), 2015-04-22: fast, reliable, diagnosable lower-level checks plus a small operational end-to-end set.
- [Ham Vocke, The Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html), 2018-02-26: a balanced portfolio with fewer broad tests. Apply the granularity principle, not fixed ratios, to agent evaluations.

The risk mapping, five-boundary table and marginal-information rule are the project policy synthesis requested by the user; they are not verbatim source prescriptions.

## Packaged fixture library

When evaluating `skill-creator` itself or demonstrating scenario design, use the immutable examples under `assets/evaluation-fixtures/`. The library includes valid and invalid frontmatter, a known baseline/current Skill pair, trigger cases, and partial and complete evaluation workspaces. Copy a fixture into an isolated temporary workspace before modification; never edit the packaged source fixture during a run. Read `assets/evaluation-fixtures/README.md` for each fixture's expected property.

## Canonical scenario format

The enriched advanced scenario format below uses `assertions`; graded results use `expectations` in `grading.json`. Simple behavioral inputs also accept canonical `expectations` (or a matching `assertions` alias); activation uses `{query,should_trigger}`. Do not require enriched fields merely to apply the risk-design principles.

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "name": "conditional-provider-routing",
      "subject": "skill-authoring",
      "language": "en",
      "target": {
        "kind": "existing-skill",
        "path": "evals/files/deployment-skill/"
      },
      "preconditions": [
        "Copy the immutable target fixture into an isolated temporary workspace"
      ],
      "budget": {
        "max_turns": 12,
        "timeout_seconds": 600
      },
      "prompt": "Update evals/files/deployment-skill/ so AWS and Azure details load only when relevant.",
      "expected_output": "A valid Skill with a shared workflow and provider-specific references.",
      "files": ["evals/files/deployment-skill/"],
      "capabilities": {
        "filesystem": true,
        "agent_runner": true,
        "browser": false,
        "network": false,
        "tools": ["developer"]
      },
      "assertions": [
        "SKILL.md contains the provider-independent deployment workflow",
        "SKILL.md routes an AWS request to references/aws.md",
        "SKILL.md routes an Azure request to references/azure.md",
        "Every linked resource exists"
      ],
      "navigation_expectations": {
        "must_read": ["SKILL.md"],
        "read_when_relevant": ["references/aws.md", "references/azure.md"],
        "must_not_read": []
      },
      "coverage_tags": ["provider:aws", "provider:azure", "risk:destructive"]
    }
  ]
}
```

## Scenario quality checklist

### Explicit target and context

- Declare the responsibility under test in `subject`.
- Declare the prompt language and a matching `language:<code>` coverage tag.
- Identify the target structurally: current and baseline Skill, eval set, trigger set, workspace, or new output name.
- Name the same target path in the prompt so the request remains autonomous outside the JSON document.
- Declare fixture immutability, baseline, capabilities, expected pre-existing artifacts, execution level, and budget under `preconditions` and `target.execution`.
- Never use “this Skill”, “that Skill”, or “cette skill” without an explicit target.

### Realistic

- Resembles a request a real user would send.
- Includes only context the user would naturally know.
- Names concrete inputs, constraints, and desired outcomes.
- Does not leak the assertion wording into the prompt.

### Execution level and budget

Declare one expected execution level in `target.execution`:

- `explain` — explain or route a workflow without claiming it ran;
- `dry-run` — inspect and produce a deterministic phase plan only;
- `execute` — perform the requested operations and produce their artifacts;
- `resume` — preserve a supplied workspace and continue from its first incomplete phase. For unavailable semantic grading with valid unchanged bindings, retry only the unavailable grader slots; do not execute the completed candidate again or replace its task evidence.

Assertions must match that level. Do not fail an `explain` scenario for not producing an archive, or pass an `execute` scenario that merely lists commands. Give end-to-end scenarios sufficient turns, timeout, tools, and fixtures to finish. If a full nested pipeline is intentionally impossible, test honest blocking instead of hidden completion expectations.

### Focused

- Tests one coherent capability or risk.
- May have several atomic assertions, but not unrelated goals.
- Uses a descriptive `name` identifying the capability under test.

### Discriminating

- Exposes a gap that the Skill should solve.
- Is difficult enough that current and baseline outputs can differ.
- Includes boundaries, conditional paths, error cases, or domain knowledge rather than trivial compliance.
- Preserves scenarios the baseline handles correctly for non-regression.

### No hidden grading criteria

Freeze assertions before launching runs. Every criterion used by a deterministic checker, LLM grader, blind comparator, or human release gate must map to a written assertion or an explicitly labeled qualitative review question. A grader may use domain expertise to judge an assertion, but must not invent an additional deliverable. If review reveals a valuable unasserted criterion, add it to the next iteration and rerun both variants; do not retroactively fail only one output.

### Verifiable

- Assertions describe observable outcomes.
- Each assertion checks one observable requirement and can cite specific evidence. Split independent predicates rather than rewarding a compound criterion with one partial quote.
- Deterministic assertions can be checked by a script.
- Subjective quality is assigned to human or blind review.
- Assertions verify outcomes, not private reasoning.

### Domain-coverage-aware

For a rule-rich deterministic Skill, derive scenarios from its coverage matrix before deepening extended automation. Add stable `coverage_tags` such as `format:yaml`, `version:openapi-3`, `direction:response`, `change:enum-expanded`, or `failure:external-reference`. Ensure every required in-scope dimension/value appears in at least one scenario and create the durable eval set before implementing lower-priority extended cells. Do not require coverage tags for simple or subjective Skills.

### Baseline and provenance

Freeze target provenance before the first paired run. Record immutable current and baseline paths or source hashes, eval-set identity, model, tools, budget, and fixture snapshot. Use `without_skill` only for a genuinely new Skill and `old_skill` for an improvement claim. Never compare a current output that could load references with a baseline denied equivalent filesystem access. Regenerate evidence after any source-hash change.

### Capability-aware

Declare filesystem, runner, browser, network, and tool availability. A scenario requiring execution must not be graded as an execution success when its declared runner is unavailable. Missing capability should instead test honest blocking behavior.

### Navigation-aware

For progressive disclosure, specify which resources must always be read, which should be read only under a condition, and which should remain unloaded. Save actual resource access in run evidence when the runtime exposes it.

## Required scenario mix

For a material Skill change, cover applicable risk roles below, not a fixed minimum count of costly runs. Select cases from the risk map; related roles may share one coherent case with independently observable assertions:

1. a normal positive case;
2. a difficult boundary or sibling-routing case;
3. a conditional/progressive-disclosure case;
4. a missing-capability or error case;
5. a non-regression case when improving an existing Skill.

## Derive and freeze from elicitation

Only when using the strict `freeze-evals` elicitation contract, inventory every material capability and create exactly one scenario of each kind: `normal`, `boundary`, `restraint`, `missing-capability`, and `non-regression`. This fixed category contract is not a mandate to run five nested end-to-end pipelines for every simple evaluation. Preserve its required shells when selected; use the smallest evidence level that satisfies each category. Do not deduplicate away schema-required scenarios or bypass a frozen execution budget. Restraint scenarios test an explicit non-goal; missing-capability scenarios test honest failure or blocking. The derivation command creates incomplete shells and explicit elicitation questions rather than inventing user context:

```bash
skill-creator freeze-evals elicitation.json --draft -o draft.json
skill-creator freeze-evals completed-draft.json -o frozen-plan.json
```

Each completed scenario records `execution_level`, `fixtures`, declared `capabilities`, positive `budget`, atomic `assertions`, separate `review_questions`, category-specific `semantics`, explicit `user_edits`, and non-empty `coverage_tags` containing both `capability:<id>` and `category:<kind>`. An empty `user_edits: []` is the required acknowledgement that no edits were made. Each assertion has a stable `id`, non-empty `subject`, an `operator` from the documented enum, a scalar `expected` value, and a typed `locator` (`json-pointer`, `file`, `stdout`, `stderr`, or `exit-code`). The frozen format can express more locator/operator combinations than an executor supports. Current paired execution supports `file`, `json-pointer`, `stdout`, and `exit-code`; `stderr` is explicitly rejected before candidate execution. File preservation uses observed before/after hashes; JSON-pointer existence refers to the member, not file existence. Check executor preflight rather than treating format conformance as executable support. Free-form statements are invalid; `because`, `if`, `when`, and an embedded second predicate are rejected so no trailing clause can smuggle in another assertion. Subjective predicates such as *loves*, *feels*, or *seems* belong only in review questions. Prompts must remain natural user requests and must not repeat assertion wording, including short or punctuation/case/Unicode-normalized copies.

Category semantics are substantive, not coverage labels: normal cases name the success path; boundaries name the limiting condition; restraints name a non-goal and decline/leave-unchanged response; missing-capability cases name the unavailable capability and block/honest-failure response. A non-regression case must carry a `preservation_reference` with a concrete baseline id, preserved behavior, and structured locator for baseline evidence.

Freezing accepts only closed, plain JSON shapes and requires complete actor provenance plus real UTC ISO-8601 timestamps supplied by the caller; it never synthesizes the current time. It emits `canonical_content_sha256` over canonical plan content. The same logical input hashes identically regardless of object-key order, while any frozen scenario, assertion, locator, semantic contract, review question, execution context, edit, or provenance change changes the hash and invalidates evidence bound to the previous plan. The module exports `deriveScenarioPlan`, `freezeScenarioPlan`, and `canonicalScenarioHash` for host-independent integrations and uses only the local Node runtime.

## Assertion guidance

Prefer:

```text
Runs the official deterministic Skill validator and reports its result.
```

over implementation coupling such as:

```text
Uses quick_validate.js.
```

Require a specific command only when it is part of the public contract.

## Useful plan/handoff example

Compare the current planning Skill with its frozen previous version using this same request and context in isolated runs:

> Plan a reviewable fix for the CSV importer in `src/import.ts`. It currently accepts empty customer IDs. The fixture `evals/files/customer-ids.csv` contains one empty ID and one valid ID. Existing valid imports must keep working. Give the next implementer a plan; do not modify files, commit, or deploy. No test run has been performed yet.

Freeze separate semantic assertions (one observable requirement each):

```json
[
  {"id":"reject-empty-id","version":1,"classification":"semantic","criterion":"The plan requires rejection of an empty customer ID."},
  {"id":"preserve-valid-id","version":1,"classification":"semantic","criterion":"The plan requires preservation of valid customer imports."},
  {"id":"reproduce-before-fix","version":1,"classification":"semantic","criterion":"The plan schedules a failing reproduction of the empty-ID defect before the repair."},
  {"id":"restart-location","version":1,"classification":"semantic","criterion":"The handoff identifies src/import.ts as the implementation starting point."},
  {"id":"honest-test-status","version":1,"classification":"semantic","criterion":"The response reports testing as not yet performed."}
]
```

Preserve each assertion’s `critical` value exactly: true, false, and omitted are distinct persisted expectations and are independently checked against frozen assertions in both subprocess and delegated modes. File equality/not-equality compares captured raw bytes against expected UTF-8 bytes and binds the raw digest. Text, regex and JSON operators require lossless UTF-8 round-trip; invalid bytes yield inconclusive rather than replacement-character evidence. Semantic quotes come from genuine decoded captured text or the final assistant response, never serialized metadata or JSON escape spellings.

These are behavioral-evaluator assertions, not the separate structured `freeze-evals` elicitation format above. Give one independent blinded grader the request, one output, and all five criteria in one batch. For `reproduce-before-fix`, a useful exact quote might be “First add a regression test using the empty-ID fixture and confirm it fails; then reject the invalid row.” The rationale explains the ordering; shared words alone do not prove it. A mere “Tests” heading or “I pass all assertions” is not substantive evidence. If the output supplies no contained quote sufficient for a verdict, mark it inconclusive rather than inventing evidence.

Use observed filesystem changes for deterministic restraint checks; do not infer no changes from an assistant's promise. Ask separately in qualitative review: “Could the next implementer start without guessing the acceptance behavior?” Flag missing coverage or weak assertions for the next iteration, not as hidden criteria in this one. Keep normal, boundary, missing-capability, restraint, and non-regression cases coherent with their own inputs and permissions; this example does not replace the required scenario mix.

## Validate the design

```bash
skill-creator design-evals <evals.json> --skill-path <skill-directory> --format json
```

Fix error-level findings before behavioral evaluation. Review warnings for weak discrimination, missing subject/language/preconditions, non-atomic assertions, missing target fixtures, absent navigation expectations, and uncovered declared domain dimensions.

## Inference and host-boundary assertions

For fixed-suite claims, predeclare complete equally weighted suite repetitions as the sampling unit. Independent stable rounds and approximate normality of round effects are assumptions, not consequences of having two samples. One observation, zero empirical variance or any missing quality round cannot establish stable improvement; degenerate summaries must not advertise statistically valid intervals. Keep optional-stopping claims under their separately frozen anytime policy.

Assert actual host behavior rather than claiming an OS sandbox: subprocesses inherit normal operator environment/authentication and use separate workspaces; ambient discovery and tools remain available. Graders request no extra builtins, but host load_skill availability remains; prompt-only requests not to use tools do not remove a tool. A mock host can verify adapter protocol, preservation and failure classification, not real-provider isolation or task quality. Design recovery cases that preserve execution bytes and valid grades while unavailable slots are retried, and reject stale bindings without candidate reexecution.

## Corrected evidence boundaries

Unlocated contains, not-contains and regex checks search each actually shown readable decoded task source separately, never artifact paths, hashes, encoding labels, metadata or JSON transport escapes. Regex matches cannot bridge sources. A visible match decides positive pass or negative fail; no match with any omitted or unreadable selected source is inconclusive, never proof of absence. Use exists with an explicit file locator to assert file presence.

Required equals, not-equals, contains, not-contains and regex operands must be supplied before candidate execution or grader spend. Contains, not-contains and regex operands, and file/stdout equals or not-equals operands, must be strings: no null, boolean, number, array or object coercion is allowed. JSON equality through a JSON-pointer locator accepts explicit expected:null, false, 0 and empty string as values, not missing operands; expected takes precedence over checker.value. Both shorthand and structured regex patterns and flags compile during authoring preflight, across all scenarios before dispatch (including resume); invalid patterns, flags or text operand types fail without candidate or grader calls. Direct low-level checker invalid-regex fallback is inconclusive, not a host exception. JSON-pointer equality compares the selected JSON value; a missing member fails both equals and not-equals. Stdout equality compares literal final-response text, not parsed JSON. exists defaults to presence when its operand is omitted; an explicit operand is interpreted as a boolean (null means absence). File equality compares bytes and preservation compares observed pre/post hashes.

The final assistant response is retained verbatim, including JSON output fields, siblings, whitespace and nested objects. Task-authored self-grading fields remain untrusted text, never evaluator authority. For native Goose stream-json, final response means only the last completed, user-visible assistant message before the successful terminal boundary, not all assistant text in the session. Contiguous fragments sharing a message ID are actual deltas: append every text block exactly, including repeated or prefix-identical text; never deduplicate them as cumulative snapshots. A new message ID supersedes prior commentary. Tool requests invalidate their message, and tool/user boundaries require a later final assistant message. Tool responses, thinking, hidden/internal text and preliminary commentary never become final-response evidence.

Native response selection rejects missing final text, malformed or unsupported intervening events, reused identities across boundaries, truncation markers, and messages or duplicate completions after the terminal boundary. A single anonymous assistant message can be unambiguous; multiple anonymous fragments, or mixed anonymous/identified fragments without a boundary, fail explicitly rather than being guessed together. Notifications/progress do not contribute text. Existing explicit terminal-string command adapters retain their separate literal-string compatibility path, with terminal-boundary checks; this is not a native Goose completion payload. The same selector governs candidate output and both command-grader capabilities.

Semantic quotes must occur in actually shown decoded content. Captured-but-omitted, binary/uninterpreted or unchanged non-output input content cannot authenticate a quote merely because its bytes were retained.

- Candidate SKILL.md instructions are directly injected for every declared tool plan. Exposure is not natural trigger activation, proof of reading linked resources, or proof of correct tool use; verify actual host behavior separately.
- Deterministic stdout locators inspect the final assistant response and exit_code locators inspect the Goose host process exit. Capture an explicit task-command result file to assert task stdout or command status.
- A JSON-pointer locator selects its member before contains, not-contains or regex evaluation. Never let an unrelated sibling satisfy the assertion. Preservation operators on JSON-pointer locators are unsupported; use a supported frozen file locator.
- Typed-only and mixed assertions keep their frozen IDs/versions; grader emission order must not change criterion identity. Original judgment/request envelopes and retained hashes must be independently validated before grading-only recovery; tampered retained evidence cannot be rehashed into authority.
- Root .agents is excluded discovery state. For authored-agent artifacts, scope delivery to a nested project such as project/.agents/agents/ and freeze corresponding locators.
- Retained partial capture and honest inconclusive judgments support inspection, not release approval or a statistical winner. Keep unavailable evidence distinct from task failure and from available uncertainty.

Literal case-insensitive match spans refer to the original decoded text (UTF-16 offsets), not a lowercased copy: `İstanbul OK` contains `ok` at 9–11 with quote `OK`. Candidate and grader streams use stateful fatal UTF-8 decoding across chunk boundaries and flush at EOF; malformed or incomplete stream bytes fail explicitly, never as replacement-character evidence. Deterministic-only delegated scenarios finalize under verified evaluator authority without semantic calls or dummy graders; mixed suites delegate only semantic assertions.
