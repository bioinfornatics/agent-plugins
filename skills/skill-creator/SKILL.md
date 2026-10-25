---
name: skill-creator
description: Authors and manages one isolated Agent Skill or SKILL.md. Use for Skill creation, validation, audit, frontmatter, progressive disclosure, evaluation design, trigger tuning, behavioral comparison, improvement, migration, or standalone .agents/skills packaging. Do not use for whole plugins, hooks, or custom agents.
---

# Skill Creator

Create and improve portable Agent Skills for AI agents. Keep the entrypoint as an intent router and load detailed guidance only for the current responsibility.

## Offline runtime

Use `node scripts/skill-creator.mjs` for a copied source Skill; it requires Node.js 22+ and resolves only this Skill’s generated runtime. Tagged native archives use the released executable and do not require Node.js. Report a missing runtime or mapping as a packaging defect.

## Scope

Use this creator for one standalone or bundled Skill. Route whole-plugin work to `agent-plugins:plugin-creator`, hooks to `agent-plugins:hook-creator`, and custom agents to `agent-plugins:agent-creator`. A bundled Skill may be authored here, but plugin architecture, integration, packaging, and installation remain plugin-creator responsibilities.

Write all Agent Skill metadata and instructions in English. Use `AGENTS.md` exclusively for repository instructions.

## Intent routing

Read only the references required by the current request:

| User intent | Required guidance |
|---|---|
| Turn an early idea into a reviewable candidate | [Idea-to-candidate conversation](references/idea-to-candidate.md), then load authoring and evaluation guidance only after confirmation |
| Create or materially redesign a Skill | [Creation checklist](references/authoring.md), [pattern catalog](references/skill-authoring-best-practices.md), and [prompt engineering](references/prompt-engineering.md); also read [rule-rich domain coverage](references/domain-coverage.md) when correctness depends on many deterministic rules |
| Audit quality without changing behavior | [Audit checklist](references/audit.md) |
| Design or review evaluation scenarios | [Evaluation design](references/evaluation-design.md) and [schemas](references/schemas.md) |
| Evaluate behavioral quality or compare versions | [Behavioral evaluation](references/evaluation-workflow.md) |
| Grade pending semantic assertions after a `full-eval` run reports `awaiting-grading` | [Delegated semantic grading workflow](references/delegated-grading-workflow.md) |
| Test or optimize activation | [Trigger evaluation](references/trigger-evaluation.md) and [description optimization](references/description-optimization.md) |
| Prepare or analyze governed intake usability sessions | [Governed usability study kit](references/usability-study-kit.md) |
| Prepare or analyze manual screen-reader acceptance | [Manual screen-reader acceptance kit](references/screen-reader-acceptance-kit.md) |
| Improve after evaluation or real usage | [Evidence-driven improvement](references/improvement.md) and [pattern catalog](references/skill-authoring-best-practices.md) |
| Package or assess release readiness | [Packaging and release](references/packaging-and-release.md) and [verification gates](references/verification-gates.md) |

Use [schemas](references/schemas.md) whenever reading or writing evaluation artifacts.

For evaluation design, execution, grading or reporting, read the
[evaluation output contract](references/evaluation-output-contract.md). Keep task
outputs, grader responses and campaign receipts distinct; freeze task formats
before paired runs.

## Common invariants

### Discovery metadata

Before writing a description, answer:

1. What does the Skill do?
2. When should the agent activate it?

Write one or two concise, third-person English sentences. Include distinctive user intent and domain terms. Keep procedures, translations, and exhaustive exclusions out of metadata.

### Instruction design

Before writing the body, answer:

1. What instructions must the Skill give?
2. In what order must they run?
3. Are all instructions mandatory?
4. Which instructions are conditional?
5. Does the domain have a substantial deterministic rule space that needs explicit coverage?
6. Does `SKILL.md` exceed or approach 500 lines?

Order prerequisites, actions, and verification. Match instruction freedom to task risk. Explain non-obvious constraints without teaching generic concepts the model already knows.

### Progressive disclosure

Use three levels:

1. metadata for selection;
2. `SKILL.md` for the common workflow, mandatory rules, and branch decisions;
3. bundled `references/`, `scripts/`, and `assets/` loaded or executed only when their condition applies.

Link references directly from `SKILL.md`, name them descriptively, avoid deep chains, and add a Contents section above 300 lines. Keep `SKILL.md` at or below 500 lines.

### Pattern review

At creation and after evaluation, use the [pattern catalog](references/skill-authoring-best-practices.md) to ask for each potentially relevant pattern:

- Is it relevant here?
- Why?
- Where should it be applied?

Choose the smallest structural correction. For rule-rich deterministic domains, choose the smallest sufficient domain coverage rather than the smallest artifact, and deliver breadth-first so evals and final validation exist before extended automation. Do not copy patterns mechanically or overfit an evaluation prompt.

## Idea-to-candidate quick path

For an early idea, start with a plain-language, summary-first conversation. Ask no more than three questions in one turn, preview the full contract, freeze and confirm scenarios, then launch only inside the durable conversation workspace. Novices see no JSON or internal creator names; their final report always names assumptions and risks. Experts may inspect fields and use supported overrides; reject unsupported budgets rather than implying they took effect. The bundled fake adapter reports generation as simulated and validation/evaluation as not run. Every mutation remains isolated and production promotion is a separate decision. See [the detailed flow](references/idea-to-candidate.md).

    skill-creator candidate <conversation-workspace> --idea "plain-language idea"
    skill-creator candidate <conversation-workspace>  # resume later

## Commands

```bash
# Agent Skills format conformance
skill-creator validate <skill-directory>

# Authoring quality and pattern relevance
skill-creator audit <skill-directory> --format json

# Scenario quality and normalized eval set
skill-creator design-evals <evals.json> --skill-path <skill-directory> --format json

# Derive elicitation shells, then freeze a provenance-bound scenario plan
skill-creator freeze-evals <elicitation.json> --draft -o <draft.json>
skill-creator freeze-evals <completed-draft.json> -o <frozen-plan.json>

# Trigger-description evaluation
skill-creator trigger-eval --eval-set <trigger-eval.json> --skill-path <skill-directory>

# Resumable paired behavioral evaluation
skill-creator full-eval <skill-directory> --workspace <iteration-directory> --format json

# Map evaluation failures to authoring patterns
skill-creator analyze <iteration-directory> --skill-path <skill-directory> --format json

# Govern evidence-linked, challenged, approval-gated isolated revisions
skill-creator evidence-loop <iteration-directory> --skill-path <skill-directory> --loop <separate-ledger> --format json

# Governed anonymous usability study validation and analysis
skill-creator usability-study --validate <session.json> --format json
skill-creator usability-study <sessions-directory> --format json

# Manual screen-reader acceptance (protocol and real records; synthetic data is non-evidence)
skill-creator screen-reader-acceptance --validate <record.json> --format json
skill-creator screen-reader-acceptance <records-directory> --format json

# Release gates and packaging
skill-creator verify <skill-directory> [options]
skill-creator package <skill-directory> [output-directory]
```

Use `--help` for command details. JSON automation uses stable envelopes. Exit codes are 0 success, 1 failure, 2 invalid usage, and 3 blocked execution.

## Evaluation execution priority

When the user asks to evaluate, test, benchmark, compare, or prove improvement, execute the evaluation rather than stopping at a plan. Freeze realistic cases and atomic assertions with the baseline, launch equivalent paired runs, grade every output with one independent blinded grader batching all semantic criteria, aggregate, generate the viewer, validate completeness, analyze failures, and review actual outputs with the user. Additional graders are optional for ambiguity or higher stakes; disagreements remain inconclusive. Routine iteration uses evaluation verification, not release acceptance.

The current run must have filesystem access to references required by progressive disclosure. Record unavailable capabilities with reasons; never fabricate evidence. A complete receipt is not necessarily a passing result.

Before claiming completion:

The resumable evaluation validates receipt completeness and uses the `evaluation` verification profile for fast/standard iteration. Resume and analyze it before reporting the observed result:

```bash
skill-creator full-eval <skill-directory> --workspace <iteration-workspace> --resume [options]
skill-creator analyze <iteration-workspace> --skill-path <skill-directory> --format json
```

Report `pass`, `fail`, `blocked`, `complete`, and `na` without weakening them. Evaluation completion is not release acceptance. For a separately requested release decision, load packaging and verification guidance and use the release profile. Human review is never self-approved.

## Runtime fallbacks

If isolated agents are unavailable, run cases sequentially and disclose reduced independence. If no browser is available, generate static review HTML. Unsupported runners fail explicitly. Preserve completed artifacts and resume at the first incomplete phase.
