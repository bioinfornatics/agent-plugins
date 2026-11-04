# Repository instructions


This repository maintains the Goose/Open Plugins creator skill.

- Write all Agent Skill metadata and instructions in English.
- Keep Skill descriptions concise and in third person; state what the Skill does and when it should activate.
- Keep `SKILL.md` at or below 500 lines; move conditional or deep detail into directly linked references using progressive disclosure.

- Scope generated artifacts to plugins installed under `.agents/plugins`.
- Do not generate standalone `.agents/skills` or `.agents/agents` assets.
- Bundled skills under a plugin's `skills/` directory are in scope.
- Treat hooks as executable security-sensitive code.
- Keep Goose-specific behavior explicit and source-verified.
- Preserve portable components when migrating another plugin ecosystem.

## Tooling and review boundary

- This Skill provides authoring instructions and manual source-format review; its creator CLI and native executable are retired.
- The only distributed launcher is `skills/skill-creator/scripts/skill-creator.mjs` with Node.js >=22.22.2, exposing agent-plugin evaluation/history/inspect. Do not add creator validation, grading, packaging or installation commands.
- Evaluation sources are user-selected Skills and/or Plugins, never standalone agents/hooks. History/inspect are read-only; do not promise grading, generated reports or approval.
- Preserve historical references without presenting their retired commands as current workflows. Keep source-backed format constraints and component routing intact.
- Keep Skill metadata/instructions English, descriptions concise and third-person, and SKILL.md <=500 lines.
