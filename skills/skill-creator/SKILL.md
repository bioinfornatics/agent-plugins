---
name: skill-creator
description: Creates, evaluates and improves one Agent Skill. Use when authoring or reviewing SKILL.md, tuning activation, evaluating behavior, or preparing standalone Skill packaging.
---

# Skill Creator

## Select the next action

| Request | Execute | Stop condition |
|---|---|---|
| Create or improve | Read [creation workflow](references/create-workflow.md); author and validate the scoped candidate | Deliver candidate and scenarios; do not execute them unless requested |
| Audit only | Read the audit guidance in the creation workflow; inspect the requested scope | Report findings; do not rewrite or launch evaluation |
| Evaluate existing cases | Read [evaluation workflow](references/evaluate-workflow.md); use native `skill-creator run-evaluation` | Deliver paired evidence and inspected HTML; do not audit/redesign first |
| Grade or report retained results | Use native resume/grading or `render-report` as directed by the evaluation workflow | Deliver derived evidence; never relaunch candidates for report corrections |
| Create and evaluate | Finish creation; freeze candidate; then read evaluation workflow | Deliver both results without preloading both branches |

Use mandatory isolated A/B for evaluation; select activation for actual load measurement or behavioral (default) for task quality. Isolation is an invariant, not a third mode. Scope standalone generated Skills to `.agents/skills`; keep metadata portable and instructions English.

For missing evaluation cases, request the concrete input or author cases only when authorized; read [evaluation design](references/evaluation-design.md) at that action. Do not create a Python harness, replacement campaign command or parallel archive workflow. Use existing supported options and a new durable evaluation directory via `--output`, not a cache.

## Host boundary

On Goose, callers use `load_skill(name: "agent-plugins:skill-creator")` for this plugin or `load_skill(name: "skill-creator")` for an available standalone installation. These are host tool calls, not shell commands or portable metadata. Once instructions are available, execute the selected branch; never reload itself recursively. On other hosts use verified loading; disclose direct reading if loading is unavailable. Report missing execution capability rather than simulate it. Route the controller only; never inject candidate loading into natural-activation tests.

Prefer the available native `skill-creator` CLI. For a source copy use Node.js 22+ with `node <skill-root>/scripts/skill-creator.mjs`; native archives use their released executable. A missing contained runtime is a packaging defect, not permission to build or install dependencies.

## Paid evaluation gate

- Evaluate only on request or under an approved acceptance protocol. Before launch, freeze source/baseline, fixtures, criteria and permitted actions; state the decision, distinct risks, expected outcomes, cheapest valid oracles, total candidate/grader calls (including repetitions, criterion-level grading and repairs), time/cost bound and stopping rule. Disclose unknown prices; obtain authority for paid execution and expansions.
- Cover required safety checks; add cases/repetitions/graders only for uncovered risk or decision-changing uncertainty, not a count target or Cartesian campaign. Prefer deterministic checks for deterministic properties and independent blinded grading for contextual quality. Reject plausible wrong outcomes, mock echoes, self-reported success and circular calculations; do not let a conditional assertion accept both outcomes under the same preconditions.
- Reuse evidence only with matching source, fixtures, protocol and bindings; re-render report corrections without rerunning candidates. Preserve failures, missingness and disagreement; at the bound report blocked/inconclusive, not automatic escalation. A small set is not reliability proof.

## Execution limits

- Execute the requested branch with supplied context; ask only for a decision blocking its next action. Continue unaffected authorized work.
- Follow repository instructions, Beads policy and current authority. Preserve existing edits, fixtures and evidence. Authoring does not authorize installation, credential changes, publication or paid campaigns.
- Run the native command first; do not add readiness audits, generic diagnostics, custom harnesses or recursive reference loading. Read linked detail only at its applicable action; reuse available guidance.
- On an actual error, apply one concrete authorized correction and retry once, or report the exact blocker and stop. Do not weaken criteria or silently expand scope/budget.
- Report files, commands, observed outcomes, missing evidence and next action; stop at the requested deliverable. Static conformance is not behavioral effectiveness or host compatibility.

## Other requested branches

- Package/release assessment: read [packaging guidance](references/packaging-and-release.md) and [verification gates](references/verification-gates.md). Publication requires separate authority.
- Usability study: read [study guidance](references/usability-study-kit.md). Manual screen-reader acceptance: read [screen-reader guidance](references/screen-reader-acceptance-kit.md). Never label synthetic records human acceptance.
- Whole plugin: route to `agent-plugins:plugin-creator`; hooks: `agent-plugins:hook-creator`; custom agents: `agent-plugins:agent-creator`. Use available standalone names only for standalone installations and verified host loading. Put repository instructions in AGENTS.md.
