# Repository instructions

- Treat `references/hooks.md` as the vendored source of truth.
- Generate hooks only as plugin components.
- Keep blocking behavior limited to PreToolUse and Stop.
- Treat hook commands as executable, security-sensitive code.

## Tooling and review boundary

- This Skill provides authoring instructions and manual source-format review; its creator CLI and native executable are retired.
- The only distributed launcher is `skills/skill-creator/scripts/skill-creator.mjs` with Node.js >=22.22.2, exposing agent-plugin evaluation/history/inspect. Do not add creator validation, grading, packaging or installation commands.
- Evaluation sources are user-selected Skills and/or Plugins, never standalone agents/hooks. History/inspect are read-only; do not promise grading, generated reports or approval.
- Preserve historical references without presenting their retired commands as current workflows. Keep source-backed format constraints and component routing intact.
- Keep Skill metadata/instructions English, descriptions concise and third-person, and SKILL.md <=500 lines.
