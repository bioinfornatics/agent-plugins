# Repository instructions


## Development-to-production flow

```text
feature -> develop -> exact-SHA CI -> independent approval
                                              |
                                 reverify source + approval
                                              |
                                    production projection
                                              |
                                  main: installable Skills
```

- **Development:** authoritative sources, tests, build tooling, versioned configuration and generated runtime mirrors. Feature PRs target develop. The source branch rename is complete; workflow filenames and build paths remain stable.
- **Main:** generated installation tree, not a source merge; no authoring apps or root build tooling.
- **Why:** Git installation needs ready-to-run, self-contained Skills, without a build or dependency installation. Keep compiled JavaScript and production dependencies inside `skills/<name>/runtime/`; Node.js 22+ is required for this distribution.
- **Configuration:** `config/reproducibility/` declares source closure and platform verification rules; `config/skill-runtimes/` maps apps to Skill runtimes. Both contain versioned build inputs, not disposable outputs or legacy code.
- **Artifacts:** temporary build/projection outputs belong in `.artifacts/` or temporary directories. Routine cleanup must preserve committed Skill runtimes, vendored dependencies and evaluation evidence.
- **Verification:** routine CI clean-builds the exact source SHA, rejects committed-output drift, runs the production profile and checks projection/Git installation. Only five-platform release packaging is deferred; scheduled/manual exhaustive CI checks isolated reproducibility plus one full suite.
- **Promotion:** a same-repository `develop` -> `main` PR is a review request. Require independent current-SHA approval or explicit personal-owner manual authorization, reverify the source, and recheck authorization/source/base before publication.
- **Publication:** `scripts/production.mjs` creates the allowlisted tree; `scripts/promote-production.mjs` publishes a commit with previous `main` as its sole parent, using a normal fast-forward push. Close the PR without merging; never force-push or merge `develop` into `main`.
- **Governance:** workflow guards are not branch protection; do not claim enforced review unless repository rules are configured.

See `docs/branch-migration.md` for CI scopes, approval safeguards and rollback.

This monorepo maintains independent open-format-first creator skills, with Goose as the reference runtime.

- Write all Agent Skill metadata and instructions in English.
- Keep Skill descriptions concise and in third person; state what the Skill does and when it should activate.
- Keep `SKILL.md` at or below 500 lines; move conditional or deep detail into directly linked references using progressive disclosure.

- Treat the repository root as an Open Plugins distribution and keep `plugin.json` valid.
- Keep each directory under `skills/` independently installable.
- Never reference runtime files outside a skill's own directory.
- Route by responsibility: skills → `agent-plugins:skill-creator`, agents → `agent-plugins:agent-creator`, hooks → `agent-plugins:hook-creator`, whole plugins → `agent-plugins:plugin-creator`; accept unqualified names for standalone installations.
- Plugin-creator orchestrates but does not duplicate specialized authoring logic.
- Treat vendored documentation in each creator's `references/` directory as its recorded source-of-truth snapshot.
- Refresh snapshots from upstream before changing a public format contract.
- Each creator is TypeScript compiled to `dist/`; run `npm run build && npm test` in each creator's directory before release, and keep runtime `node_modules` vendored (no network dependency at install time).
- Do not mutate live `~/.agents` directories in automated tests.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:970c3bf2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
