# Repository instructions

This repository maintains a portable, vendor-neutral Agent Skill Creator.

- Use the Agent Skills `SKILL.md` specification for skills.
- Write all Agent Skill metadata and instructions in English.
- Keep Skill descriptions concise and in third person; state what the Skill does and when it should activate.
- Keep `SKILL.md` at or below 500 lines; move conditional or deep detail into directly linked references using progressive disclosure.
- Scope all generated artifacts to Agent Skills under `.agents/skills`; do not generate `.agents/agents` or `.agents/plugins` assets.
- Use `AGENTS.md` exclusively for repository instructions; do not add host-specific instruction files or configuration directories.
- Keep agent and plugin schemas host-aware; they are not part of the Agent Skills specification.
- Keep runner-specific TypeScript behavior isolated in `apps/skill-creator-cli/src/evaluation/runners/`; do not add it to this portable Skill tree.
- Run `(cd apps/skill-creator-cli && npm run build && npm test)` after CLI changes.
- Run `skill-creator validate "$(realpath .)"` from this skill directory after `SKILL.md` changes; the argument must be the canonical absolute skill path, never a bare `.`.
