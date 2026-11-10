# Prompt and context engineering for Agent Skills

Use this short technique navigator when authoring, auditing or improving instructions.
Read the [assessment guide](assessment-guide.md#purpose-and-reading-moments) before
drafting, with actual audit source or improvement evidence, and again for final
candidate/report assessment. Its [41-rule checklist](assessment-guide.md#authoritative-assessment-checklist)
is authoritative; this page is not a duplicate acceptance checklist.

## Skills are context engineering

A Skill has three jobs:

1. **selection:** metadata helps the model decide to load it;
2. **execution:** instructions and resources guide task completion;
3. **verification:** observable checks prevent unsupported success claims.

Optimize all three rather than treating the Skill as one large prompt.

## Useful techniques

### Intent-oriented metadata

Describe the user outcome and activation context. Keep procedures in the body.

### Instruction hierarchy

Use objective, conditions, prerequisites, workflow/branches, constraints, verification and output contract as a readable default. Adapt placement to the actual task/model and keep operational safeguards before actions (rules 08, 14, 34).

### Imperative, grounded instructions

Use direct verbs and name the source of truth. Prefer “Validate the mapping before modifying the document” over passive suggestions.

### Appropriate degree of freedom

Use heuristics for open work, parameterized patterns for preferred approaches, and exact scripts for fragile operations.

### Conditional prompting

State the branch condition before its instructions. Move substantial branches to directly linked references.

### Coverage before compression

For rule-rich deterministic domains, first map the main rule space across entities, directions, formats, versions, states, constraints, and failure modes. Then compress the instructions through scripts and references. Build breadth-first so the minimal complete Skill, eval set, and validation exist before deep automation. Do not optimize prompt length by silently omitting automatable rules, and do not chase exhaustive implementation until required deliverables are complete. Minimality means no unnecessary context, not incomplete domain behavior.

### Templates and schemas

Use strict templates for machine consumers and flexible defaults for human reports (rule 27). For this assessment, functional Markdown hierarchy plus XML content boundaries is mandatory user policy, not portable syntax or universal performance proof; see [rule 16 and example](assessment-guide.md#functional-hybrid-example).

### Few-shot examples

Use concrete input/output pairs when format, tone, or edge-case behavior is difficult to describe. Avoid redundant examples and move collections into references.

### Contrastive boundaries

Briefly distinguish the closest competing capability, for example: “Use for one Skill; use plugin-creator for a complete plugin.” Avoid exhaustive negative lists.

### Plan-validate-execute

For batch, destructive, or high-stakes work, externalize a structured plan, validate it, execute only after success, then verify the result.

### Feedback loops

Use `execute → validate → inspect errors → authorized correction → recheck` with explicit retry/stop limits. Repeated failure reports a blocker; no implicit paid retries. Put cheap validation close to the action that can fail (rules 24–25).

### Tool affordance

State which tool or script to use, when, with which input, expected output, and failure behavior. Distinguish reading a script from executing it.

### Verifiable reasoning artifacts

Do not request private chain-of-thought. Request plans, mappings, checklists, diffs, validation reports, citations, and evidence that can be inspected.

### Fail-closed claims

Do not report success unless required validators and evidence complete. Missing capability yields `blocked`, not an invented pass.

### Idempotence and resume

Preserve completed artifacts, resume at the first incomplete phase, avoid repeating expensive model calls, and return exact next actions.

## Technique-to-rule navigation

| Concern | Assessment rules |
|---|---|
| Selection and metadata | 01–05 |
| Sufficient context, conditional references and duplication | 06–12 |
| Precision, hybrid boundaries, examples and reasoning artifacts | 13–18 |
| Tools, ordering, intermediates, failures and continuity | 19–26 |
| Output, evidence, authority and reachable resources | 27–30 |
| Comparison, oracles, uncertainty and compatibility | 31–35 |
| Ablation, autonomy, instruction sensitivity, delegation, brevity, persistence | 36–41 |

For pattern selection use the [authoring catalog](skill-authoring-best-practices.md).
For current commands use [command-contract.md](command-contract.md); evaluation
or grading is conditional on explicit requested scope and execution authority.
