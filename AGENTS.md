# Agent Plugins — operational reference

## Product and routing

- **Product:** author, validate, evaluate and distribute reusable agent capabilities; Agent Skills + Agent Plugins 1.0.0 formats.
- **Host boundary:** Goose is the verified reference host; other hosts require evidence.
| Responsibility | Skill (`agent-plugins:` prefix for plugin installations) |
|---|---|
| One Skill: create, audit, improve, evaluate | `skill-creator` |
| Custom agent / delegated persona | `agent-creator` |
| Lifecycle hook / handler policy | `hook-creator` |
| Whole plugin / manifest / MCP / integration | `plugin-creator` |
| Executable dependencies / launchers / native packaging | `plugin-script-packaging` |

- Standalone installations accept unqualified Skill names.
- Plugin Creator orchestrates specialists; it does not duplicate their authoring logic.
- Format validation != behavioral evaluation != proven host compatibility.

## Source ownership

| Path / branch | Ownership / invariant |
|---|---|
| `apps/*-creator-cli/`, `contracts/` | TypeScript sources, tests and compiled `dist/`; edit sources, not generated outputs |
| `skills/<name>/` | Independently installable instructions, references and resources |
| `skills/<name>/runtime/` | Committed generated JavaScript + vendored production dependencies; never depend on sibling/root runtime files |
| `config/skill-runtimes/`, `config/reproducibility/` | Versioned runtime mapping, source closure and platform verification rules; declare new source files |
| `vendor/`, evaluation evidence | Retained dependencies and proof; not disposable cleanup targets |
| `docs/site/en/`, `docs/site/fr/` | English-authoritative site and full French mirrors; matching routes, translated diagrams |
| `.artifacts/` | Disposable build, test, preview and projection outputs |
| `develop` | Authoritative sources + tests + tooling + generated runtime mirrors |
| `main` | Generated installation tree; no root authoring apps/build tooling |
| `gh-pages` | Generated documentation only; independent of plugin production |

## Two publication flows

```text
Plugin: feature -> reviewed PR -> develop -> exact-SHA CI -> authorization
        -> reverify source + approval + main -> allowlisted projection -> main
Docs:   feature -> PR -> develop -> bilingual build + browser checks
        -> owner approval -> current-source/hash checks -> gh-pages -> Pages approval
```

- Feature PRs target `develop`; a `develop` -> `main` PR is a promotion review request, NEVER a source merge.
- After confirmed integration into `develop`, delete local and remote feature branches to keep the workspace clean; first verify no unmerged work remains and obtain deletion authorization.
- Plugin authorization: independent current-SHA approval OR explicit personal-owner manual authorization.
- `scripts/production.mjs` projects; `scripts/promote-production.mjs` publishes with previous `main` as sole parent.
- Publish by normal fast-forward push; close the promotion PR without merging; never force-push production.
- Git installation: Node.js 22+, contained ready-to-run Skills, no build/dependency installation; native archives are separate.
- Documentation: `github-pages` owner approval is not independent review; administrator bypass remains available.
- Initial documentation release may use a reviewed feature commit with explicit user authorization.
- Documentation publication requires committed sealed inputs, exact source provenance and verified output hashes.
- Workflow guards are not branch protection; verify actual repository/environment rules before claiming enforcement.
- This checkout: `origin` = ServierHub fork; `upstream` = personal bioinfornatics repository; inspect remotes/account before publication.

## Authoring and safety
- Keep root `plugin.json` valid; keep every Skill independently installable.
- Skill metadata/instructions: English; descriptions concise, third-person, stating behavior and activation conditions.
- Keep `SKILL.md` <= 500 lines; directly link conditional/deep detail through progressive disclosure.
- Creator `references/` snapshots are recorded format sources; refresh upstream before changing a public format contract.
- Preserve committed runtimes, vendored dependencies, evaluation evidence and pre-existing user changes during cleanup.
- Never mutate live `~/.agents` installations in automated tests; never package secrets.

## Verification (run from repository root)

| Change / gate | Command / scope |
|---|---|
| Creator implementation | `(cd apps/<creator>-cli && npm run build && npm test)`; before release, run for all four creators |
| Runtime mirrors | `npm run build:skill-runtimes && npm run check:skill-runtime-dist-drift`; shared contracts require their build/fixture refresh first |
| Source inventory | `npm run check:change-set-inventory` |
| Distribution / projection regression | `npm run test:distribution && npm run test:production` |
| Routine exact-SHA CI | Clean rebuild, committed-output drift gate, production profile, projection and isolated Git install/update |
| Exhaustive CI | Isolated reproducibility + full suite; routine CI defers five-platform release packaging |
| Documentation | `bash scripts/build-documentation.sh`; `python3 scripts/test-documentation-integrity.py`; `node scripts/test-documentation-browser.mjs` (configured Python/Zensical/Chromium) |
References: [contribution/build setup](CONTRIBUTING.md), [promotion/rollback](docs/branch-migration.md), [documentation setup/publication](docs/documentation.md).

## Tracking and permissions — Beads minimal profile
- Run `bd prime` for task lifecycle, durable memory, dependencies and session-close protocol.
- Use `bd` for ALL task tracking and `bd remember` for persistent knowledge; no parallel TODO trackers or `MEMORY.md`.
- Conservative policy: no commit, push, release, credential change or Dolt remote sync without explicit current authorization.
- Handoff: changed files, actual checks, unresolved work and issue status; report blocked commands/errors; preserve user work.
- Explicit user/orchestrator restrictions override tracker guidance; a completed task never grants publication authority.
