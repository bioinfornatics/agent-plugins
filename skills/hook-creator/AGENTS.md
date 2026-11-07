# Hook Creator maintenance

- Preserve [hook source](references/hooks.md) and the recorded [target contracts](references/goose-target-compatibility.md); refresh upstream before public format changes.
- Author executable hooks only as plugin components. Only PreToolUse and Stop block.
- Keep English metadata/instructions, concise third-person descriptions and `SKILL.md` <=500 lines.
- No current creator executable/component validator exists. Do not revive historical runtime/scripts or claim Skill validation validates hooks.
- Preserve original fixtures, schemas and the historical `evals/run-contract.json`. New neutral inputs and setup belong in `evals/inputs` and `evals/preparation.md`; supported suite fields only.
- Inspect executable code before isolated tests; never execute payload commands or mutate live installations.
