# Agent Creator maintenance

- Preserve the recorded format in [custom-agent source](references/custom-agents.md).
  Refresh upstream before changing its public contract; see [provenance](references/UPSTREAM.md).
- Author custom roles in `.agents/agents`, not portable plugin agents, Skills or recipes.
- Keep active instructions English, metadata concise and third-person, and `SKILL.md` <=500 lines.
- This Skill has no current creator executable/component validator. Do not edit or revive retained runtimes/scripts as authoring tooling.
- Keep historical evidence/fixtures intact. New evaluation inputs must be neutral data copied to both arms; use supported suite fields and keep setup in `evals/preparation.md`.
- Test only in isolated project/user directories, never live operator installations.
