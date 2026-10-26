---
name: skill-creator
description: Creates, audits and improves one Agent Skill. Use when authoring or reviewing SKILL.md, tuning activation, evaluating behavior, or preparing standalone Skill packaging.
---

# Skill Creator

Create/improve one portable Agent Skill, or execute its evaluation and produce HTML reports. Select the workflow from the user's request; load only that workflow and start it. Do not run a separate readiness investigation.

## Select and execute

1. **Create or improve:** read [creation workflow](references/create-workflow.md), then write the instructions, resource tree and evaluation scenarios. Creation supplies scenarios; it does not execute them automatically.
2. **Evaluate or report:** read [evaluation workflow](references/evaluate-workflow.md), then execute existing scenarios with mandatory isolated A/B contexts and activation or behavioral measurement, collect/grade evidence and generate/inspect HTML. Isolation is not a mode; behavioral is the default. Do not audit, redesign or rewrite the Skill first.
3. **Both requested:** execute creation first, then read the evaluation workflow for the frozen candidate. Do not preload both workflows.

## Common boundaries

- Use supplied context and make reversible choices within scope. Ask only for a concrete user decision blocking the next action; continue unaffected work.
- Preserve existing user work. Installation, credential changes and publication require a separate explicit request.
- Execute the requested action, not generic filesystem/tool/credential/runtime diagnostics. On an actual error, apply one concrete authorized correction and retry once, or report the exact blocker and stop.
- Reuse applicable loaded guidance. Follow links from the selected workflow only at the step and condition that need them; do not recursively preload references or load the unselected workflow. Report observed results, not simulated proof or self-granted approval.

## Other explicitly requested actions

- **Audit only:** read [audit guidance](references/audit.md), run the scoped audit and report; do not execute creation first.
- **Package or assess release:** read [packaging guidance](references/packaging-and-release.md) and [verification gates](references/verification-gates.md) at that action. Publication remains separate.
- **Usability study:** read [study guidance](references/usability-study-kit.md) before its requested protocol. **Manual screen-reader acceptance:** read [screen-reader guidance](references/screen-reader-acceptance-kit.md). Synthetic records are not human acceptance evidence.
- Whole-plugin work belongs to agent-plugins:plugin-creator, hooks to agent-plugins:hook-creator, and agent definitions to agent-plugins:agent-creator. Repository instructions belong in AGENTS.md.
