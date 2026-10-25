# Skill audit checklist

Read this reference when reviewing an existing Skill without necessarily changing its behavior.

## Conformance

- `SKILL.md` exists and has valid YAML.
- `name` matches the directory and respects the Agent Skills format.
- `description` is non-empty and within the hard limit.
- Every linked local resource exists and stays inside the Skill directory.
- Paths use portable forward slashes.

Run:

```bash
skill-creator validate <skill-directory>
skill-creator audit <skill-directory> --format json
```

## Discovery metadata

- English and third person.
- States what the Skill does.
- States when it activates.
- Uses distinctive intent and domain terms.
- Avoids procedures, obligation lists, translated keyword lists, and exhaustive exclusions.
- Lets the agent select before loading the body; broad activation does not grant broad execution authority.
- Distinguishes only realistic neighboring capabilities.

## Instruction architecture

- The common path is easy to locate.
- Prerequisites, actions, and verification are ordered.
- Mandatory steps and conditional branches are distinguishable.
- Instruction freedom matches task risk.
- Terminology is consistent.
- One default approach is preferred over equivalent choices.
- Current behavior is separated from necessary legacy guidance.

## Progressive disclosure

- `SKILL.md` is at most 500 lines.
- Conditional and domain-specific detail is externalized.
- References are directly linked from `SKILL.md`.
- Long references have a table of contents.
- Frequently needed content is not hidden too deeply.
- Each reference appears once inside the workflow step that needs it, with an explicit reading deadline. A conditional preamble/catalog does not substitute for action-local placement.
- Operational safeguards load before the actions they govern; output-only contracts load after investigation, immediately before reporting, including blocked and no-change cases.
- Mixed operational/output references are split or read early enough to preserve safeguards.
- Already loaded unchanged guidance is reused, not mechanically reread.

## Ordered delivery verification

Check that a multi-step Skill has one numbered, responsibility-specific workflow/checklist spanning investigation, verification, reporting, transmission and stop. Reject a workflow plus a second checklist that repeats the same work. Conditional/parallel sublists require an explicit join before dependent steps. Verify these ordering properties within that single progression:

1. Confirm context and actual performed work.
2. Inspect observations and results required by that responsibility.
3. Verify delegated artifacts and evidence when delegation occurred.
4. Keep missing evidence, permissions and capabilities explicit.
5. Identify the immediate action and applicable restart context.
6. As the final step, read applicable output-only contracts and write the report, including blocked or unchanged work.

Assess dependency order rather than requiring these exact words or six items. Static text checks cannot prove that an agent follows this sequence.

## Scripts and runtime

- Scripts handle expected errors and justify constants.
- Instructions say whether to run or read each script.
- Inputs, outputs, dependencies, and verification are documented.
- External CLIs, packages, MCP servers, and credentials are checked rather than assumed.

## Evidence classification

Report separately:

- **completed:** validated facts and existing artifacts;
- **unavailable:** evidence the environment cannot produce, with reasons;
- **blocked:** required evidence or decisions preventing completion;
- **warnings:** non-blocking authoring risks;
- **errors:** issues that must prevent packaging or release.
