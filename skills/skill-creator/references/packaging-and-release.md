> **Historical reference — not a current execution workflow.** Retained for provenance.
> Its commands, schemas and acceptance claims are not supported by the current CLI.
> Use [current evaluation](evaluate-workflow.md), [scenario design](evaluation-design.md),
> [authoring](create-workflow.md) or [report review](review-viewer.md) instead.

# Packaging and release checklist

Read this reference when packaging a standalone Skill or assessing release eligibility.

## Pre-package

- Format validation passes.
- Format and containment checks have no blocking errors.
- `SKILL.md` stays within the line budget.
- Every linked resource exists and is self-contained.
- Scripts and dependencies are complete for offline use when declared.
- Evaluation artifacts match current source hashes.

## Package

```bash
skill-creator package <skill-directory> [output-directory]
```

Packaging excludes development evaluation data and rejects symbolic links. Warnings remain visible; errors block archive creation.

## Release gates

```bash
skill-creator verify <skill-directory> \
  --profile release \
  --evaluation <iteration-workspace> \
  --tests-status pass \
  --triggering-status pass \
  --human-review pass
```

Release requires:

- structure and containment checks;
- portability and offline runtime completeness;
- deterministic tests;
- trigger evidence with sibling-overlap review;
- paired behavioral thresholds and current provenance;
- generated viewer and explicit human review.

Keep these states distinct:

- `complete`: required artifacts exist;
- `pass`: gates meet thresholds;
- `fail`: evidence proves a gate failed;
- `blocked`: required evidence or capability is missing;
- `na`: the gate does not apply.

A complete evaluation can still fail release gates.
