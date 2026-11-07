# Evidence-driven Skill improvement

Read this reference after behavioral evaluation, trigger evaluation, human review, or observed real usage.

## 1. Validate evidence first

Confirm that paired runs used equivalent models, tools, inputs, budgets, and capabilities. Ensure current runs could load conditional references. Distinguish Skill failures from scenario, runner, or grader defects.

## 2. Classify each failure

| Symptom | Pattern or component to inspect |
|---|---|
| Missed trigger | Description intent and activation terms |
| False trigger | Sibling boundary and description precision |
| Missing step | Sequential workflow or checklist |
| Wrong branch | Conditional workflow |
| Required reference ignored | Local action condition and reading deadline |
| Safeguard read after its action | Operational/output separation and prerequisite order |
| Output formatting loaded before investigation | Output-only contract at the final reporting step |
| Same references repeatedly loaded | Duplicate entrypoint links and unchanged-context reuse |
| Delivery checks treated as independent boxes | One numbered, responsibility-specific progression |
| Workflow and checklist repeat the work | Merge investigation, checks, reporting, handoff and stop into one sequence |
| Conditional reference catalog still loaded eagerly | Move each link into its consuming step, not merely add a condition |
| Harmonized headings still obscure execution order | Reconsider section boundaries around actual actions |
| Irrelevant references loaded | Domain organization and branch conditions |
| Error found too late | Feedback loop |
| Unsafe or incorrect mutation | Plan-validate-execute |
| Repeated generated helper code | Utility script |
| Layout or rendering defect | Visual analysis |
| Unstable output structure | Template or examples |
| Confusion among tools | Default plus conditional escape hatch |
| Missing runtime capability | Dependencies, compatibility, or MCP guidance |

Run:

```bash
skill-creator analyze <evaluation-workspace> \
  --skill-path <skill-directory> \
  --format json
```

## 3. Choose the smallest correction

- Change metadata only for selection failures.
- Reorder or foreground existing content before adding prose.
- Move conditional depth into a direct reference.
- Add a script for deterministic repeated work.
- Add validation when a failure is mechanically detectable.
- Tighten freedom only where risk requires it.
- Improve the scenario when the assertion is weak or coupled to an implementation detail.

## 4. Avoid overfitting

Generalize from the failure category, not the exact prompt. Preserve useful behavior, add a regression case for the discovered risk, and do not copy grader language into the Skill.

## 5. Run the governed improvement loop

Use the immutable loop ledger after `analyze` has complete repeated-run evidence:

```bash
# Classify evidence into mechanisms and emit the proposal contract.
skill-creator evidence-loop <evaluation-workspace> \
  --skill-path <user-owned-skill> --loop <separate-ledger>

# Preview a challenged proposal. This does not mutate the Skill.
skill-creator evidence-loop <evaluation-workspace> \
  --skill-path <user-owned-skill> --loop <separate-ledger> --proposal proposal.json

# Apply exactly the previewed proposal to an isolated revision only.
skill-creator evidence-loop <evaluation-workspace> \
  --skill-path <user-owned-skill> --loop <separate-ledger> --approve <complete-plan-integrity-sha256>

# After executing the isolated revision, attach complete results.
skill-creator evidence-loop <evaluation-workspace> \
  --skill-path <user-owned-skill> --loop <separate-ledger> --results <new-workspace>
```

The enforced lifecycle is proposal -> preview -> approval -> awaiting-results -> results. Each change must cite failed evidence and a recommended catalog pattern; exceptions require a substantive reason linked to a challenge objection. Challenges are integrity-hashed, source-bound, independently provenanced, and require substantive objections plus responses. Regressions must be new, unique, frozen, canonically hashed, and provenance-bound. Approval binds the complete plan integrity hash and isolated source-hashed revision.

Results require the approved pending revision. Receipt, benchmark, and execution evidence must bind that source, evidence digest, run count, and exact preserved-plus-regression scenario IDs. Every transition performs budget preflight. Tokens are summed from timing.json total_tokens, never means; non-finite values fail closed. Reports include effectiveness, variance, total time, total tokens, and total cost.

Adversarial coverage is executable in `tests/test_evidence_improvement.test.ts`: it attacks state, plan, and revision tampering; partial-hash approval; challenge identity and integrity; non-catalog patterns; duplicate, existing, non-frozen, and unprovenanced regressions; premature or unbound results; and non-finite budgets.
