# Evaluation scenario design

Read this reference before creating or changing `evals/evals.json`.

## Packaged fixture library

When evaluating `skill-creator` itself or demonstrating scenario design, use the immutable examples under `assets/evaluation-fixtures/`. The library includes valid and invalid frontmatter, a known baseline/current Skill pair, trigger cases, and partial and complete evaluation workspaces. Copy a fixture into an isolated sandbox before modification; never edit the packaged source fixture during a run. Read `assets/evaluation-fixtures/README.md` for each fixture's expected property.

## Canonical scenario format

Use `assertions` in scenario and metadata files. Reserve `expectations` for graded results in `grading.json`.

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
        "Copy the immutable target fixture into an isolated sandbox"
      ],
      "budget": {
        "max_turns": 12,
        "timeout_seconds": 600
      },
      "prompt": "Update this deployment Skill so AWS and Azure details load only when relevant.",
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
        "SKILL.md contains the shared workflow and provider-selection decision",
        "AWS and Azure details are stored in separate directly linked references",
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
- `resume` — preserve a supplied workspace and continue from its first incomplete phase.

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
- Each assertion is atomic and can cite specific evidence.
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

For a material Skill change, prefer at least:

1. a normal positive case;
2. a difficult boundary or sibling-routing case;
3. a conditional/progressive-disclosure case;
4. a missing-capability or error case;
5. a non-regression case when improving an existing Skill.

## Derive and freeze from elicitation

Before execution, inventory every material capability and create exactly one scenario of each kind: `normal`, `boundary`, `restraint`, `missing-capability`, and `non-regression`. Restraint scenarios test an explicit non-goal; missing-capability scenarios test honest failure or blocking. The derivation command creates incomplete shells and explicit elicitation questions rather than inventing user context:

```bash
skill-creator freeze-evals elicitation.json --draft -o draft.json
skill-creator freeze-evals completed-draft.json -o frozen-plan.json
```

Each completed scenario records `execution_level`, `fixtures`, declared `capabilities`, positive `budget`, atomic `assertions`, separate `review_questions`, category-specific `semantics`, explicit `user_edits`, and non-empty `coverage_tags` containing both `capability:<id>` and `category:<kind>`. An empty `user_edits: []` is the required acknowledgement that no edits were made. Each assertion has a stable `id`, non-empty `subject`, an `operator` from the documented enum, a scalar `expected` value, and a typed `locator` (`json-pointer`, `file`, `stdout`, `stderr`, or `exit-code`). Free-form statements are invalid; `because`, `if`, `when`, and an embedded second predicate are rejected so no trailing clause can smuggle in another assertion. Subjective predicates such as *loves*, *feels*, or *seems* belong only in review questions. Prompts must remain natural user requests and must not repeat assertion wording, including short or punctuation/case/Unicode-normalized copies.

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

## Validate the design

```bash
skill-creator design-evals <evals.json> --skill-path <skill-directory> --format json
```

Fix error-level findings before behavioral evaluation. Review warnings for weak discrimination, missing subject/language/preconditions, non-atomic assertions, missing target fixtures, absent navigation expectations, and uncovered declared domain dimensions.
