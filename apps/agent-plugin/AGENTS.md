# Agent Plugin — mandatory working contract

Read this file before every modification. It supplements repository-root rules;
current user instructions take precedence. It grants no publication authority.

## Current authorized slice

- Source app rename: `apps/agent-plugin`; public command `agent-plugin evaluation`.
- Preparation only: dry-run validates and emits a JSON matrix with no host calls;
  non-dry-run validates then fails explicitly with execution unavailable.
- `--skills <paths...>` and `--plugin <paths...>` are combinable/repeatable;
  deduplicate roots by kind and preserve separate target comparisons.
- Skill discovery is silent and exact at `evals/evals.json`. Plugin discovery uses
  immediate `skills/*/SKILL.md` children and their suites: skip missing child
  suites, error if all are absent or any present suite is malformed. No root suite
  required. Each child scenario retains the full Plugin treatment.
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
- Make implementations discoverable. `CliOutput` is a CLI-local contract in
  `cli-output.ts`; `StreamCliOutput implements CliOutput` lives in its own nearby
  file. Keep callbacks bound and caller-owned streams open. Do not replace the
  named production implementation with an anonymous object.
- Introduce contracts only for actual use-case needs; no interface/class per file
  by default, speculative DI container, generic Utils bucket or port per I/O call.
- Fake HOME is not a sandbox. Tests must not mutate live operator installations;
  credentials must not enter archives. Mock tests do not prove host compatibility.
- Installation remains Git-backed `main` with a Node.js 22+ launcher and contained
  JavaScript runtime. Development Bun code is not automatically Node-compatible.
  Never hand-edit generated Skill runtimes or point installed launchers at `apps/`.
- Use Beads for task ownership and progress `bd prime`. Inspect existing changes, claim the
  active task before implementation, preserve user work. Commit/push/release,
  credential changes and Dolt remote sync need explicit current authorization.

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

Current app has no build/deploy scripts. Historical tests reference removed sources;
focused checks are not full-suite acceptance. Read development/deployment before
claiming readiness or trying repository-wide runtime generation.
