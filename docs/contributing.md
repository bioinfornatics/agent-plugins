# Contributing to capability instructions

## Choose the right location

Start with [repository instructions](../AGENTS.md): inspect the repository, branch,
index, current permissions and pre-existing changes. Define the objective, exclusions
and evidence needed before editing; claim the corresponding Beads task.

Feature branches start from `develop`; feature PRs target `develop`. `main` receives
only a verified generated installation projection, never a source merge. Follow
[the build and promotion contract](../CONTRIBUTING.md); a `develop` → `main`
promotion request is closed without merging, not squash-merged.

| Location | Contribution / boundary |
|---|---|
| `skills/<name>/` | English instructions and contained resources; each Skill remains independently installable |
| `apps/<creator>-cli/`, `contracts/` | TypeScript implementation, tests and shared contracts; edit sources, then regenerate outputs |
| `skills/<name>/runtime/` | Committed generated runtime and dependencies; never repair these instead of their sources |
| `docs/` | Contributor policy and technical references; no execution logs or task histories |
| `docs/site/en/`, `docs/site/fr/` | Pedagogical English documentation and full French mirrors |
| `tests/`, creator test directories | Reproducible format, implementation, packaging and regression checks |
| `.artifacts/` | Disposable outputs and previews; preserve still-needed evidence before cleanup |
| Beads / retained evaluation workspaces | Current task truth / observed execution evidence; neither is a documentation page |

New canonical files must be declared in
[`config/reproducibility/source-manifest.json`](../config/reproducibility/source-manifest.json).
Do not edit generated `dist/`, runtime mirrors or native stages as implementation sources.

## Route by responsibility

| Requested outcome | Creator |
|---|---|
| Author, audit, improve or evaluate one Skill | `agent-plugins:skill-creator` |
| Define or evaluate a custom agent | `agent-plugins:agent-creator` |
| Add, audit or test a lifecycle hook | `agent-plugins:hook-creator` |
| Assemble, validate or evaluate a complete plugin; configure MCP | `agent-plugins:plugin-creator` |
| Design contained executable dependencies and launchers | `agent-plugins:plugin-script-packaging` |

Standalone installations use unqualified names. Plugin Creator coordinates
specialists; it does not duplicate their authoring logic. Goose is the verified
reference host, not proof that another host implements the same behavior.

## Write an actionable instruction

Use this execution structure:

```text
intent → verified prerequisites → scoped action → observable result → next action or stop
```

- State what to do, required inputs, permissions, outputs and the next capability to load.
- Keep descriptions concise and third-person: behavior and activation conditions.
- Keep `SKILL.md` at most 500 lines; directly link conditional or deep references.
- Keep required resources inside the Skill; never reach into siblings or root sources at runtime.
- Separate portable format rules from host adapters and executable side effects.
- Define Goals/Non-goals and observable success criteria; use Given/When/Then for behavior.
- For relevant quality limits, name the metric, target, workload, environment and measurement method.
- Do not invent performance targets, implicit permissions or simulated execution evidence.

Skill metadata and instructions remain **English**. The bilingual documentation
uses English as its authoritative source and French as a separate complete mirror,
including diagram labels. Follow [documentation maintenance](documentation.md) for
translation, Zensical checks and separately authorized Pages publication.

Creator `references/` snapshots record format sources. Refresh and review upstream
before changing a public format contract; a validator/runtime disagreement requires
checking the documented contract and implementation, not declaring compatibility.

## Verify before proposing

Run relevant checks from the repository root:

```bash
npm run check:change-set-inventory
npm run test:distribution
npm run test:production
```

For implementation changes, build and test the affected creator:

```bash
(cd apps/skill-creator-cli && npm run build && npm test)
npm run build:skill-runtimes
npm run check:skill-runtime-dist-drift
```

Replace `skill-creator-cli` with the affected app. Shared contract changes require
their build and compatibility-fixture refresh before runtime generation; follow
[the complete build order](../CONTRIBUTING.md#build-after-editing). Before release,
verify all four creators and the applicable repository gates.

For instruction or format changes, use the corresponding creator validator/audit
with a canonical absolute target path; consult its `--help` and
[component guide](../README.md#learn-more-and-contribute). Check relative links,
resource containment and consistency with the recorded public contract.

Format validation, trigger evaluation and behavioral evaluation answer different
questions. A meaningful behavioral comparison needs realistic paired cases,
preserved outputs, explicit grading and review. A changed hook/runtime also needs
authorized, failure, malformed-input and boundary cases. Missing tools, model runs
or human review remain **blocked**, not passed; static checks do not prove model
quality or installed-host compatibility. Never mutate live `~/.agents` in tests.

## Deliver and hand off

- Report actual changed files, preserved work, commands/results, candidate identity and limits.
- Store task status and follow-up work in Beads; use `bd remember` for durable knowledge.
- Preserve evaluation evidence; keep receipts and logs outside pedagogical documentation.
- Close only the evidenced task scope; passing tests alone do not approve a release.
- Commit, push, merge, installation, publication and Dolt synchronization need current authorization.
- For an authorized commit, verify identity, exact staged files, message and resulting hash.
- After confirmed integration into `develop`, remove local and remote feature branches only after checking for unmerged work and obtaining deletion authorization.
- Provide an executable next action with the task, inputs and prerequisites needed to resume.

Publication and rollback: [plugin promotion](../CONTRIBUTING.md#promotion-reviewed-source-generated-production)
and [GitHub Pages](documentation.md#publication-and-rollback). These are separate
flows; neither authoring nor task closure grants release authority.
