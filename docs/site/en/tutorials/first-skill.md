# Tutorial: create your first Skill

You will turn one small, observable task into a portable Skill: read a Markdown file and report its decisions and open questions. The purpose is to learn the authoring and review loop, not to prove a production capability in one example.

## Before you begin

Complete [Getting started](../getting-started.md). Work in a scratch project where you authorize file creation. Use a plugin-qualified creator name after plugin installation, or the plain `skill-creator` name after standalone installation. No external API or custom executable is needed for this exercise.

## 1. Define what good output means

Use this small fixture as `meeting.md` in your scratch project:

```markdown
# Release planning
- Decision: publish the migration guide before the release.
- Decision: keep the existing configuration keys for this release.
- Open question: who will review the examples?
- Discussion: a new dashboard might be useful later.
```

Expected behavior: two decisions, one open question, and no invented reviewer. The dashboard discussion is not a decision. This distinction makes the task testable.

## 2. Ask for a focused Skill

> Use `agent-plugins:skill-creator` to create `.agents/skills/markdown-summary`. It should summarize one Markdown file into key decisions and open questions, without inventing facts or treating discussion as a decision. Write the Skill metadata and instructions in English. Keep it simple and portable, validate it, and show the created files and anything still needing evaluation. Do not add a custom agent, hook, external API, or unnecessary script.

Answer the creator's clarification questions. Specify what to do when a file has no decisions or questions: say that none are recorded, rather than filling the gap.

## 3. Review the generated files

Check that `.agents/skills/markdown-summary/SKILL.md` exists. Read it before use. Its purpose and activation conditions should match the request, and its workflow should explain how to separate explicit decisions, open questions, and other discussion.

Supporting files are optional, not a goal. If any are generated, check that they remain inside the Skill directory and are directly referenced when needed. A short, self-contained workflow may need only `SKILL.md`.

Ask the creator to explain the validation result. Format conformance and authoring policy are separate checks; neither is evidence of better summaries. Avoid unnecessary complexity to satisfy imaginary requirements.

## 4. Try the fixture

In a session where the new project Skill is discoverable, explicitly ask the host to use `markdown-summary` on `meeting.md` and return decisions and open questions.

**Success check:** the answer preserves both decisions, leaves the reviewer question unanswered, and does not promote the dashboard idea into a decision. The agent should not modify the input file.

This is a smoke check, not a paired behavioral evaluation and not a trigger-accuracy study. Explicitly loading a Skill does not show that the host would choose it unaided.

## 5. Add a boundary case

Try a second file containing discussion only:

```markdown
# Ideas
A dashboard could make the release easier to follow.
We might discuss ownership next week.
```

**Success check:** the summary reports that no decisions or open questions are explicitly recorded. It should not convert a possible future discussion into a current assignment.

If the behavior is wrong, preserve the output and describe the specific failure before editing the Skill. Add a realistic evaluation case for it instead of merely expanding the instructions.

## 6. Know when to stop

You have completed the tutorial when the files are inspectable, validation is reported, and the two smoke checks have recorded outcomes. Report unresolved behavior honestly.

For a claim that the Skill helps, compare it with `without_skill` or an earlier `old_skill` version on the same scenarios, with grading and review evidence. Follow [Evaluate and improve](../how-to/evaluate.md). Do not package or enable more widely just because one answer looked good.

**Continue:** [Creator selection](../how-to/creators.md) for other capability types, or the [Skill Creator guide](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/skill-creator/README.md) for advanced workflows.
