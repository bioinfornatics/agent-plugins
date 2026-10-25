# Result Contract 1.0.0

The result contract reports four orthogonal axes. It does not execute work, emit host events, authenticate approvers, or replace creator envelopes.

## Axes and applicability

- **Operation** is `planned`, `running`, `completed`, `blocked`, or `failed`. Terminal states are completed, blocked, and failed.
- **Evaluation** declares `applicable` and uses `pass`, `fail`, `inconclusive`, or `not-applicable`. Not-applicable is used exactly when applicability is false.
- **Evidence** independently declares applicability and `available`, `partial`, `unavailable`, or `not-applicable`.
- **Approval** independently declares applicability and `pending`, `approved`, `rejected`, or `not-applicable`. Applicable approval requires the exact `production-review` context. This contract records a decision but does not establish reviewer identity or CI authority.

Evaluation or approval applicability makes evidence applicable. A pass or fail verdict requires completed operation and available evidence. Planned, running, blocked, and failed operations can only be inconclusive when evaluation applies. Thus blocked never means pass or fail, and operation failure remains distinct from quality failure. Approved or rejected requires completed operation; approved additionally requires available evidence and, when evaluation applies, pass. Completed never defaults to approved.

Every result carries all four axes, including terminal results. Omitted or mismatched applicability, implicit approval, unsupported context, verdict without evidence, and final approval before completion are malformed and rejected with stable diagnostics.

## Deterministic normalization and aggregation

Normalization validates first, trims, deduplicates, and UTF-16-sorts operation reasons. It never supplies semantic defaults.

Aggregation validates every child and is total and permutation-invariant for every non-empty collection of valid children. Base operation precedence is `failed > blocked > running > planned > completed`; verdict precedence is `fail > inconclusive > pass`; evidence precedence is `unavailable > partial > available`; approval precedence is `rejected > pending > approved`. Non-applicable children do not vote on an applicable axis. Reasons are deduplicated and UTF-16-sorted.

Safe synthesis preserves truth without manufacturing evidence. A conclusive pass is demoted to inconclusive when aggregate evidence is partial or unavailable. Approved is similarly demoted to pending unless operation is completed, evidence is available, and every applicable aggregate evaluation passes. A child operation failure, fail verdict, or rejected approval always keeps aggregate exit classification at failure. When a conclusive failure conflicts with an unfinished operation, or a fail verdict conflicts with degraded evidence, the aggregate projects that failure onto `operation.failed`, uses an inconclusive verdict and pending approval as required by the schema, and records an exact `aggregate preserves child evaluation fail` or `aggregate preserves child approval rejected` synthesis reason. This is a conservative failure projection, not evidence inflation or implicit approval.

## Exit classification

| Code | Meaning | Rule |
| ---: | --- | --- |
| 0 | success | completed; no fail/rejection, evidence complete when applicable, and no pending approval |
| 1 | quality or operation failure | failed operation, fail verdict, or rejected approval |
| 2 | invalid usage | invocation failed before a valid result exists |
| 3 | blocked capability/evidence | blocked or unfinished operation, inconclusive evaluation, or partial/unavailable applicable evidence |
| 4 | pending approval | otherwise successful completed result awaiting applicable production review |

Precedence is invalid usage, failure, blocked capability/evidence, pending approval, success. Code 4 is intentionally distinct from code 3. A real pending human review maps to completed work with applicable evidence available and approval pending, so it reaches code 4; absent or incomplete evaluation evidence remains code 3.

## Legacy compatibility inventory

`fixtures/result/producer-inventory.json` is the source-backed acceptance inventory. Every current entry names the creator, source file, exact field/context, exact emitted token domain, and source evidence that tests must extract. `LEGACY_STATUS_MAPPINGS` must equal those current entries exactly. The inventory covers agent/hook CLI and grading fields; plugin CLI, full-eval, phase, gate, human-review, validation, migration status/classification, schema lifecycle, MCP compatibility, and path-containment statuses; and skill CLI, full-eval, phase, gate, human-review, receipt, audit, design, analysis, navigation, decision, trigger `results[].pass`, and grading `passed` booleans.

Type-only, fixture-only, shorthand, or rendered labels are listed separately as `documentedNonCurrent` and deliberately have no mapping. This includes non-emitted plugin validation `unsupported`/`policy-failed`, MCP `legacy-compatible`, package `packaged`, conformance fixture `not-applicable`, hook validation `ok`, and rendered trigger `PASS`/`FAIL`. Tokens are interpreted only with an exact creator and field context. Context-free and unknown mappings fail deterministically. Only the two explicit human-review contexts can produce approved/rejected; no completion, gate, validation, packaging, or migration mapping infers approval. Runtime creator outputs remain unchanged in version 1.
