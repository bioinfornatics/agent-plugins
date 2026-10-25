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

Create about 20 realistic queries with a balanced mix of:

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
skill-creator evidence-loop \
  --eval-set <trigger-eval.json> \
  --skill-path <skill-directory> \
  --model <session-model> \
  --max-iterations 5 \
  --verbose
```

The loop evaluates each query repeatedly, splits train and held-out test cases, proposes improved descriptions, and selects by held-out score. Apply the best description, show the before/after text and scores, and preserve the report.

## Quality checks

A candidate description should:

- be English-only and third person;
- say what the Skill does and when to activate it;
- normally stay within 15–40 words when that preserves reliable discovery;
- remain comfortably below the 1,024-character hard limit;
- avoid body-level procedures and file-layout details;
- distinguish the Skill from close siblings without becoming a list of exclusions;
- trigger on multilingual intent without embedding translations.
