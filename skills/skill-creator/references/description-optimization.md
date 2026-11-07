> **Historical reference — not a current execution workflow.** Retained for provenance.
> Its commands, schemas and acceptance claims are not supported by the current CLI.
> Use [current evaluation](evaluate-workflow.md), [scenario design](evaluation-design.md),
> [authoring](create-workflow.md) or [report review](review-viewer.md) instead.

# Description optimization workflow

Read this reference only when creating, reviewing, or optimizing Skill discovery metadata.

## Description decision

Before writing the description, answer:

1. What does the Skill do?
2. In which user situations should the agent activate it?

Write the answer in English, in third person, as one or two concise sentences. Include distinctive user intents and domain terms. Do not include implementation steps, translated query examples, or exhaustive routing exclusions. Mention a neighboring Skill only when necessary to resolve a realistic ambiguity. The description is visible before the body is loaded: explain responsibility and activation, not a procedural checklist or long list of obligations.

Test activation scope separately from execution authority. Derive both from the target responsibility; do not import role names or workflow-specific obligations from the feedback source. Put prerequisites and conditions for reusing prior work in the body.

Recommended shape:

```yaml
description: Processes PDF files and extracts text or tables. Use when working with PDFs, forms, document extraction, or PDF transformation.
```

## Trigger evaluation set

Select a compact risk-distinct query set, without a universal count, with a balanced mix of:

- positive cases using varied phrasing, languages, complexity, and implicit intent;
- difficult negative cases that resemble the Skill but belong to a neighboring capability.

```json
[
  {"query": "realistic user request", "should_trigger": true},
  {"query": "near-miss request", "should_trigger": false}
]
```

Avoid trivial positives and unrelated negatives. Multilingual user queries test semantic discovery; descriptions remain English.

## Human review of trigger cases

Use `assets/eval_review.html` to review and edit the query set before optimization. Replace its data, Skill name, and description placeholders, open the resulting HTML, then use the exported JSON as the frozen eval set.

## Optimization loop

```bash
node <skill-creator-directory>/runtime/dist/scripts/run_loop.js \
  --eval-set <trigger-eval.json> \
  --skill-path <skill-directory> \
  --model <session-model> \
  --runs-per-query <justified-repetition-bound> \
  --max-iterations <authorized-iteration-bound> \
  --verbose
```

Use the contained runtime script shown above; `evidence-loop` is a separate approval-ledger workflow, not the description optimizer. In a source checkout, the equivalent script is `apps/skill-creator-cli/dist/commands/run_loop.js` after building.

The description experiment follows Anthropic's first-choice routing logic: each repetition presents a uniquely named description-only stub, and the first tool request determines whether that stub was selected. This is not the installed-capability A/B experiment. Default workers/timeouts match the inspected Python baseline (10 workers, 30 seconds); infrastructure failures remain unavailable rather than being converted to negative trials. The frozen split is saved in `split.json` when a log directory is supplied. The seeded JavaScript partition is not claimed identical to Python's RNG; use its explicit membership for analysis. Improvement prompt/response files contain supplied queries and model text: review before sharing; they are not universally sanitized.

Set --runs-per-query explicitly rather than silently accepting the runtime default of three. Before invoking the loop, bound all query repetitions, candidate-generation calls and iterations; include held-out evaluation costs and uncertainty about provider prices. Run optimization only for an observed discovery problem or an explicit comparison request, not routine description authoring. The loop evaluates queries repeatedly, splits train and held-out cases, proposes descriptions and selects by held-out score. The configured bound is not permission to keep trying until green. Review the proposed description and evidence before applying it within the authorized scope; show before/after text, actual calls and limitations.

## Quality checks

A candidate description should:

- be English-only and third person;
- say what the Skill does and when to activate it;
- normally stay within 15–40 words when that preserves reliable discovery;
- remain comfortably below the 1,024-character hard limit;
- avoid body-level procedures and file-layout details;
- distinguish the Skill from close siblings without becoming a list of exclusions;
- trigger on multilingual intent without embedding translations.
