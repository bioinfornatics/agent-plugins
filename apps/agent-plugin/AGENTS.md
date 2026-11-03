# Agent Plugin — mandatory working contract

Read this file before every modification. It supplements repository-root rules;
current user instructions take precedence. It grants no publication authority.

## Current authorized slice

- Source app rename: `apps/agent-plugin`; public command `agent-plugin evaluation`.
- Dry-run prepares only; non-dry-run executes bounded parallel Goose trials in private HOME/XDG and stores SQLite/evidence. Native model compatibility remains unverified.
- `--skills <paths...>` and `--plugin <paths...>` are combinable/repeatable;
  aggregate into one composed profile; deduplicate canonical roots and Skills
  already included in a Plugin. `--profile-name` is optional; `--plugin` has no
  plural alias. Sources implement a shared user registry with campaign-isolated
  evidence; native profile activation, history CLI and import remain unverified/pending. Read product.md section 17 and the active task before changing
  these semantics; planning is not implementation or publication authority.
- `--resume <campaign-id>` uses the frozen stored plan; no selectors or parameter
  overrides. `--retry-uncertain` explicitly authorizes new attempts, never skips
  corruption checks. Schema-v2 registry owns logical trials and append-only attempts.
- Skill discovery is silent and exact at `evals/evals.json`. Plugin discovery uses
  immediate `skills/*/SKILL.md` children and their suites: skip missing child
  suites, error if all are absent or any present suite is malformed. No root suite
  required. Every child scenario retains the whole-profile treatment, never only its
  source child; source provenance is not an installation selector.
- Namespace scenario IDs by Skill directory. `--model` is a free string;
  `--agent` is repeatable with Goose default. `--budget` is deferred, no monetary cap.
- Leave installed `skills/skill-creator` launcher and runtime mapping unchanged;
  app rename is not installation migration.

## Philosophy and non-obvious invariants

- This is a comparative Skill/Plugin evaluation CLI, not a generator or prompt
  relay. Goose is selected by default; other hosts require explicit selection.
  Confirmed defaults: timeout 0 (disabled), max turns 50, repetitions 3, parallelism 3.
- The hexagon is a dependency rule: domain is pure; application depends on domain
  and application-owned ports; adapters translate protocols; composition-root wires
  dependencies. Type-only imports obey the same boundaries.
- Keep imports side-effect-free. `index.ts` owns process startup, `main.ts` owns
  testable CLI lifecycle, Commander stays outside domain/application.
- Keep dependency assembly separate from behavior. The composition root wires
  concrete dependencies and factories; command handling and orchestration belong
  in their respective adapters/use cases, not anonymous callbacks hidden in wiring.
- Make significant production behavior discoverable through an explicit operation
  name and a cohesive module near its contract. A reviewer should be able to find
  the implementation from the entrypoint without searching anonymous closures.
  Keep simple wiring and test doubles inline; do not impose one file, interface
  or class per function. See [conventions](specifications/conventions.md).
- Introduce contracts only for actual use-case needs, not speculative frameworks.
  Preserve boundary resource ownership: bind output callbacks and leave caller-owned
  streams open. Prefer named boundary implementations over anonymous substitutes.
- Fake HOME is not a sandbox. Tests must not mutate live operator installations;
  credentials must not enter archives. Mock tests do not prove host compatibility.
- Installation remains Git-backed `main` with a Node.js 22+ launcher and contained
  JavaScript runtime. App development uses npm and Node.js >=22.22.2 with native
  TypeScript stripping of `src/index.ts`; source execution does not prove installed
  runtime compatibility. `package-lock.json` is the sole dependency lockfile; use
  `npm ci`, `npm start -- <args>`, `npm test`, `npm run test:watch`,
  `npm run typecheck` and `npm run lint`. Tests use `node:test` and `node:assert`;
  the storage-local wrapper loads `node:sqlite` lazily.
  Never hand-edit generated Skill runtimes or point installed launchers at `apps/`.
- Use Beads for task ownership and progress `bd prime`. Inspect existing changes, claim the
  active task before implementation, preserve user work. Local commits follow the
  scoped policy below; push/release, credential changes and Dolt remote sync still
  need explicit current authorization.

## Local commits — verified, coherent increments

Git checkpoints make completed increments reviewable and recoverable across agent
sessions. Commit at meaningful milestones, not merely because time has elapsed.
This policy adapts [Anthropic's agent-maintained handoff pattern](https://github.com/anthropics/cwc-long-running-agents#agent-maintained-handoff)
and the verification guidance in [AGENTS.md](https://agents.md/); it does not adopt
an automatic catch-all commit on session stop.

### Authority and scope

- For user-authorized implementation within `apps/agent-plugin`, local commits of
  agent-owned changes in the approved scope are authorized without asking again
  for each increment, unless the user or orchestrator explicitly forbids them.
  This is a scoped exception to the repository-root requirement for separate
  commit authorization; it does not authorize committing changes outside this app.
- Research, planning, review-only and ambiguous requests do not authorize changes
  or commits. A request only to edit these instructions does not authorize a commit
  of the policy itself; do not bootstrap authority from newly written instructions.
- Local commit authority never authorizes push, remote branch deletion, release,
  publication, credential changes or Dolt remote sync. History rewriting, including
  amend, rebase and reset, requires separate explicit authorization.

### Commit boundaries

- Create a local commit after each coherent, verified increment, before starting
  an unrelated increment. Do not defer all completed increments to session end.
- Each commit serves one identifiable purpose and includes its necessary code,
  tests, documentation and generated outputs produced by declared tooling only.
  If a required companion change lies outside this app, obtain authority for the
  complete increment rather than committing an incomplete subset.
- Prefer independently reviewable and revertible commits. Do not split tightly
  coupled changes into broken intermediate states or mix unrelated refactors.
- Use functional milestones, not time or file-count quotas. A commit is a checkpoint,
  not evidence of acceptance, full-suite readiness or publication.

### Verification gate

- Review the intended diff and run the checks required for the affected scope by
  [development and verification](specifications/development.md) before committing.
  Documentation-only increments use applicable static checks; do not invent build
  commands or run unrelated or paid campaigns just to produce a commit.
- Checks must cover the final candidate. Rerun affected checks after relevant edits;
  earlier green results do not verify later changes.
- If a required check fails or cannot run, do not create a normal delivery commit.
  Report the failure, distinguish known baseline failures from new regressions, and
  request direction. Never silently exempt a failing gate, weaken tests or bypass
  hooks to obtain a commit. An unverified checkpoint needs explicit authorization
  and must be clearly identified as such.

### Staging and ownership

- Inspect initial Git status and preserve pre-existing user changes and staged work.
  Stage explicit paths or hunks; never blindly use `git add .` or `git add -A`.
- Review `git diff --cached` before committing and verify that the entire staged
  snapshot contains only the approved increment. If unrelated work is already staged,
  stop and ask; do not commit it or silently alter the user's index.
- Include only task-owned changes; exclude secrets and unrelated artifacts. If user
  and agent changes overlap and cannot be separated safely, stop and ask.

### Traceability and interruption

- Use a concise, purpose-oriented subject following repository conventions. Record
  the reason and actual verification commands/results in the body when useful;
  link the active Beads issue. Do not claim checks that were not performed.
- After committing, verify the resulting commit and Git status. At handoff report
  local hashes, actual checks, remaining changes and blockers; distinguish committed,
  pushed and published states explicitly.
- If interrupted before verification, preserve the work and record its state and
  next verification step in Beads. Do not create an automatic end-of-session commit.

## Code comments: preserve the next correct modification

When adding or changing code, preserve the information a future maintainer or
agent needs to make the next modification correctly. Prefer clear names, types
and structure for explaining what the code does; use comments to explain why it
must work this way and which constraints a change must preserve.

Add or update a comment when any of these conditions applies:

| Comment when… | Example |
|---|---|
| An external constraint explains the code | An API limit or a dependency-specific behavior |
| An apparently obvious change could introduce a bug | Required operation ordering or an edge-case treatment |
| The contract exceeds what names and types reveal | Units, side effects, idempotency or exception guarantees |
| A trade-off must remain available to future decisions | A performance choice with its verified justification |

- Put the explanation near the affected code; document public contracts on the
  relevant API. Link longer rationale rather than duplicating it.
- State the constraint, its reason and what must remain true. Include a source,
  regression test or measured evidence when available; do not invent rationale
  or present an unverified performance assumption as fact.
- Do not narrate obvious operations or add boilerplate comments to every symbol.
  Before removing an existing comment, preserve any still-valid information that
  names, types and tests do not convey.
- Recheck comments when changing the code: update obsolete explanations and
  remove claims that no longer apply. A comment does not replace a regression
  test for a testable invariant.

## Read only the relevant detail before the governed action

| Change or phase | Required reading |
|---|---|
| Product behavior, criteria, scenarios, budgets, analytical data | [Product](specifications/product.md) and active Beads issue |
| Layer boundaries, ports, entrypoints, resources, project map | [Architecture](specifications/architecture.md) |
| New/moved interface, class, module or shared code | [Conventions](specifications/conventions.md) |
| Development, build or test execution | [Development and verification](specifications/development.md) |
| Failure, regression, unexpected wrapped/host behavior | [Debugging](specifications/debugging.md), then development |
| Runtime dependencies, launcher, generated projection or publication | [Deployment](specifications/deployment.md), then development |

Do not load every document mechanically. Read linked subtopics only when relevant;
inspect the affected source/commands before execution. [SPECIFICATION.md](SPECIFICATION.md)
is a compatibility index, not a second product specification.

## Phase steering

1. Recover task, requirement, ownership, dirty state and current authority.
2. Investigate the public seam; define the smallest change and discriminating check.
3. Implement within authorized scope; run focused checks then applicable regressions.
4. Debug failures using evidence, without hiding them by weakened tests or exclusions.
5. Build/project only through declared tooling; deployment is not publication approval.
6. Report owned files, actual commands/results and gaps. Close only evidenced scope.

Current app has no build/deploy scripts. Retired prompt-relay tests were removed
after explicit guarantee mapping; dated Bun gate results are historical proof for
the local/mock foundation, not acceptance of the npm/Node migration. Current npm
test/typecheck/lint gates pass for the app (92 tests); the root editor integration
check also passes with npm tasks and Node launches. This does not prove native
or installed-runtime readiness.
Read development/deployment before repository-wide runtime generation.
