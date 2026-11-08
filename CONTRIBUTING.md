# Contributing to Agent Plugins

Thanks for helping make agent capabilities easier to author, safer to share, and more useful. This guide explains where to work, how the build works, and why the installation branch differs from the source branch. For installation and first use, see [README.md](README.md).

## The branch model, in one minute

The source branch is **develop**. The development-to-develop rename is complete; CI and promotion accept only develop as the source branch. Workflow filenames and build commands are unchanged.

```text
feature/my-change
       │ reviewed feature PR
       ▼
develop                     authoritative source + generated runtime mirrors
       │ exact-source-SHA CI + independent current-SHA approval
       │ reverify source, approval, and current main
       ▼
production projection       allowlisted installation tree, not a source merge
       │ normal fast-forward publication
       ▼
main                        ready-to-install Skills + contained runtimes
```

Think of `develop` as the workshop and `main` as the packaged product. Users should not need the workshop to run the product.

| Branch | Purpose | What belongs there |
|---|---|---|
| Feature branch | A focused, reviewable change | Source, tests, documentation, and regenerated outputs for that change |
| `develop` | Authoritative development history | Apps, contracts, build rules, tests, vendored dependencies, and Skill runtime mirrors |
| `main` | Git-installable production distribution | Manifest, user documentation, license, self-contained Skills, provenance, and dispatch workflows |

**Feature PRs target `develop`. Never merge `develop` into `main` or edit generated production files by hand.** A `develop` → `main` PR is a promotion review request; successful publication closes it without merging.

The policy is repository-specific. The upstream migration is documented; ServierHub publication remains subject to separate permissions and migration work. Do not change remotes or credentials to work around this. See [migration policy and rollback](docs/branch-migration.md).

## Start a contribution

For Skill instructions, creator routing and evidence-backed authoring, read
[Contributing to capability instructions](docs/contributing.md). This root guide
remains the authority for development setup, builds and production promotion.

1. Inspect [AGENTS.md](AGENTS.md), the relevant component guide, and existing Beads issues. Use `bd prime` for tracker guidance and `bd ready` to find available work. Track work with `bd`, not a separate Markdown task list.
2. Create a feature branch from `develop`. If you already have a checkout, inspect `git status` first and preserve existing changes.
3. Keep the change scoped, document acceptance criteria, and include reproducible validation evidence in the PR.

For a fresh upstream checkout:

```bash
git clone --branch develop https://github.com/bioinfornatics/agent-plugins.git
cd agent-plugins
git switch -c feature/my-change
```

Creating a branch does not authorize an automated agent to commit or push. Follow the active user and repository policy.

## Development prerequisites

- **Node.js 22+** for the contained runtimes and Node-based tooling. Routine CI uses Node.js 22.22.2.
- **Git**; **Beads (`bd`)** for task tracking. **Make** is optional.
- Full verification also needs the verified **Goose 1.57.0** executable and a supported browser for integration/accessibility checks. See [.github/workflows/development-ci.yml](.github/workflows/development-ci.yml) for CI prerequisites.

These are contributor requirements. **Git-installation users need Node.js, not Bun or an npm install.**

### Restore dependencies offline

From a fresh development checkout:

```bash
node scripts/prepare-development.mjs
```

This verifies the vendored dependency closure and restores development `node_modules` into the current agent-plugin app without network installation or lifecycle scripts. It deliberately refuses to overwrite existing development modules; inspect an existing checkout instead of deleting dependencies blindly.

Dependency changes require a deliberate package/lockfile and vendored-closure update; offline restoration is not a dependency upgrade command.

## Understand the source layout

```text
apps/agent-plugin/         Current TypeScript evaluation app
  src/                      domain, application ports/use-cases, adapters
  scripts/                  build/test/package wrappers
  tests/                    source and contained-runtime tests
  dist/                     emitted ESM index.js and modules
contracts/                  shared contracts and compatibility fixtures
skills/<name>/              independently installable instructions/resources
  scripts/<name>.mjs         generated launcher and source report helper (skill-creator only)
  runtime/                  generated JavaScript + production dependencies
config/skill-runtimes/       versioned app-to-Skill mapping and schema
config/reproducibility/      canonical source closure and platform rules
vendor/                     verified offline build dependencies
scripts/ and tests/         repository build, verification, publication tooling
docs/                       technical policy and production document templates
.artifacts/                 ignored disposable build/projection outputs
```

Configuration is a build input, not clutter. Runtime mirrors and evaluation evidence are retained deliverables, not cleanup targets.

## How source becomes an installable Skill

1. **Author** TypeScript under `apps/agent-plugin/`; edit Skill instructions and supporting resources under `skills/<name>/`.
2. **Compile** the app with its declared build wrapper: src/index.ts emits dist/index.js. The report helper is source-owned under skills/skill-creator/scripts/generate-report.mjs with a contained HTML template; no embedded viewer generation is required.
3. **Generate** the skill-creator contained runtime using `config/skill-runtimes/skill-runtime-map.json`. The generator copies compiled implementation/resources and the locked production dependency closure into `skills/<name>/runtime/`, creates its manifest, and writes the launcher.
4. **Review and retain** regenerated runtime mirrors alongside the source change. CI rebuilds them and rejects differences from committed outputs. Never fix a generated file instead of its source.
5. **Project** the verified source into a production-only tree. `scripts/production.mjs` selects allowed files, rejects incomplete runtimes and unsafe entries, and records exact source commit/tree plus a hashed file inventory.

The installed launcher runs JavaScript from **inside its own Skill directory**. It must not reach into root `apps/`, another Skill, or repository-level dependencies. That containment is why copying the whole Skill directory works without a build or dependency install.

### Build after editing

Run these from the repository root after restoring dependencies:

```bash
(cd apps/agent-plugin && npm run build)
(cd contracts/capability-contract && npm run build)
node contracts/capability-contract/scripts/refresh-compatibility-fixtures.mjs
npm run build:skill-runtimes
npm run check:skill-runtime-dist-drift
```

For a focused change, build and test the affected app first:

```bash
(cd apps/agent-plugin && npm run build && npm test)
```

Then regenerate runtime mirrors before final verification. The root `package.json` scripts are canonical; Make is an optional facade, not a replacement of every internal Node runner. The clean CI rebuild command, `node scripts/rebuild-production.mjs`, is a **drift gate**: use it after generated changes are recorded in the candidate, not to accept stale committed outputs.

## Verify your change

| Command | Scope |
|---|---|
| `npm run test:distribution` | Distribution structure and adoption documentation |
| `npm run test:production` | Projection, runtime containment, provenance, promotion guards |
| `npm run test:production-ci` | Routine production profile, including creator and integration checks; native packaging is retired |
| `npm test` | Full developer suite, current Node application and root contract checks |
| `npm run test:reproducibility-build` | Isolated clean-source build reproducibility |
| `npm run test:reproducibility` | Exhaustive isolated verification |

Before release, run `npm run build && npm test` in apps/agent-plugin and the required root gates. Tests must not mutate live `~/.agents` directories. Missing external tools or behavioral evidence must be reported as limits, not a pass.

Routine PR/push CI verifies the **exact source head SHA**, not a synthetic merge tree: offline restoration, clean rebuild, committed-output coherence, production-profile tests, deterministic projection, and isolated Git installation/update. Scheduled/manual exhaustive CI adds isolated reproducibility ; native tagged-release tooling is retired. Complete CI logs are uploaded for 14 days; consult them when the bounded console output is insufficient.

### Preview production without publishing

Use a destination that does not already exist:

```bash
node scripts/production.mjs project .artifacts/production-preview
node scripts/production.mjs verify .artifacts/production-preview
node scripts/production.mjs smoke .artifacts/production-preview
```

Projection is a local preview, **not publication or approval**. If generated from an uncommitted working tree, its recorded HEAD does not prove those edits are committed; release verification requires a clean exact-SHA candidate.

## Promotion: reviewed source, generated production

For authorized maintainers:

1. Merge the reviewed feature PR into `develop`.
2. Open a same-repository, non-draft PR with head `develop` and base `main`. State clearly that it is a **promotion review request**.
3. Require successful exact-head CI and independent collaborator/maintainer approval for that same SHA. Stale approvals, author self-approval, forks, and outstanding change requests fail closed.
4. Approval starts **Promote production**. It resolves the source/base pair, reruns verification for that exact source, and rechecks approval, source, and current `main` before publishing. Manual dispatch on `develop`, with the PR number and expected `main` SHA, is the recovery path.
5. The publisher creates a generated-tree commit with previous `main` as its **sole parent**, then uses a normal fast-forward push. It closes the PR without merging and keeps `develop`.

**Never click Merge on this request. Never force-push production.** Workflow guards do not configure branch protection; required checks and publisher permissions must be configured separately before claiming enforced governance. Approval checks are not atomic with GitHub reviews.

If publication succeeded but closing the PR failed, inspect `main` provenance before retrying. Rollback creates a new production commit from the recorded previous tree, with current `main` as parent; it does not reset history. Follow [the complete policy](docs/branch-migration.md) for safeguards and limits.

## Current distribution and developer facade

Git distribution on main ships contained Node.js JavaScript and locked dependencies.
Native Bun archives and staged installation commands are retired. See [RELEASES.md](RELEASES.md).
Use make help, make test and make clean for the optional developer facade. Installation
and updates use the host Git-plugin flow, not a local staged installer.

## Documentation and authoring rules

- Keep `README.md` user-facing: value, installation, examples, and troubleshooting. Put build and contributor details here.
- Edit `docs/production-README.md` for the README projected to `main`. It must link to developer docs on `develop`, because root development files are intentionally excluded from production.
- Add new canonical source files to `config/reproducibility/source-manifest.json`.
- Keep `plugin.json` valid and each directory under `skills/` independently installable.
- Write Skill metadata/instructions in English; use concise third-person descriptions and keep `SKILL.md` at or below 500 lines. Move deep detail into directly linked references.
- Route changes by responsibility: Skill, agent, hook, or whole-plugin creator. Refresh vendored upstream snapshots before changing a public format contract.
- Preserve paired evaluation evidence. Never turn missing or inconclusive results into improvement claims.

## Safe cleanup and handoff

`make clean` (or `npm run clean`) removes generated root `bin/`, `dist/`, `release-staging/`, `release-assets/`, and `.artifacts/`. It preserves Skill runtimes, vendor dependencies, evaluations, and `.agents/` content. Do not use broad deletion commands as a substitute. Save temporary evidence elsewhere before cleanup if it is still needed.

At handoff, report changed files, exact checks and their outcomes, limitations, and Beads status. Close completed issues and file follow-up work where needed. Commit, push, and Dolt remote synchronization require explicit authority under the conservative repository policy.

### Sole-maintainer personal repository

The personal repository owner may explicitly dispatch promotion with owner_manual
and exact expected_source/expected_main SHAs. This records owner authorization,
not independent review. All verification and projection gates remain required.
See [the manual promotion contract](docs/branch-migration.md#explicit-owner-manual-promotion).

## Prepare a local plugin evaluation candidate

Do not point the plugin evaluator at the full development repository: it contains
source tooling, dependencies and retained evidence, rather than only the delivered
plugin. Prepare a production-shaped local candidate with its evaluation suites:

```bash
# From the repository root; output must not already exist.
npm run prepare:evaluation-candidate -- .artifacts/evaluation-candidate
npm run verify:evaluation-candidate -- .artifacts/evaluation-candidate

# Generic evaluator: pass the plugin subdirectory, not the envelope or develop root.
node skills/skill-creator/scripts/skill-creator.mjs evaluation \
  --plugin "$PWD/.artifacts/evaluation-candidate/plugin" --dry-run
```

Preparation does not build, install dependencies, invoke models, modify `main` or
publish. It requires current contained runtimes; follow the existing build/runtime
commands above if missing or stale. The candidate contains production files plus
`skills/*/evals/evals.json` and explicit scenario `files` inputs under `evals`. It
does not copy historical fixtures or the entire source checkout. Relative input
paths and executable intent are preserved. Evaluations remain excluded from
installation and only declared neutral inputs are restored into both trial arms.

The new output directory contains:

```text
evaluation-candidate/
+-- plugin/                   pass this path to --plugin
|   +-- plugin.json
|   +-- skills/*/evals/...     suites and selected inputs
|   +-- distributed resources and contained runtime
+-- production/               frozen distribution, without evaluation data
+-- candidate-manifest.json   integrity/provenance; not installed
```

The retained `production/` keeps its original `distribution-manifest.json` and executable intent.
The sibling manifest records the original production inventory, actual candidate
file hashes/modes, scenario IDs and evaluation fingerprint. The enriched plugin
is **not** a production projection accepted by `verifyProduction`; production's
strict exclusions remain unchanged. Git commit/tree identify the starting revision,
not uncommitted changes; actual hashes bind the copied bytes. Verification requires
no source checkout, but the source-side verifier itself remains repository tooling.
Hashes detect accidental drift, not malicious replacement of files and manifest.

The generic loader checks its existing 4 MiB/file, 64 MiB/shared-load, 20,000-entry
and depth-64 bounds before preparation succeeds. Reported `snapshotBytes` is the
installation size only; suites and repeated scenario inputs also consume the shared
budget. Failed preparation leaves no final candidate. Existing destinations and
symlink ancestry are refused; these checks are not a concurrent hostile-filesystem
sandbox. Use a new output directory for each frozen candidate.

`--dry-run` prepares without host/model calls and does not prove host execution.
Removing it launches an evaluation and requires explicit campaign authorization;
use the configured default model unless an override is explicitly requested.

### Frozen candidate promotion chain

```text
develop (exact source SHA) -> candidate {production/, plugin/, manifest}
                         -> canonical technical verification
                         -> immutable run/attempt-bound artifact
                         -> approval + rechecks -> same production/ bytes on main
```

Canonical push/develop verification retains a single projected distribution and
prepares its enriched evaluation copy. The generic evaluator performs a **dry-run**,
and the isolated Git installation gate consumes the retained production tree.
This is technical preparation proof, **not a passed behavioral/model evaluation**;
no paid campaign or quality threshold is automatically introduced.

Promotion resolves a unique nonexpired candidate artifact from the exact canonical
run and attempt, authenticates its archive SHA-256 through GitHub API metadata,
then restores a bounded data-only payload preserving executable intent. The
publisher verifies the frozen production and candidate-treatment binding and
does not reconstruct the distribution. Approval and source/main race checks remain
mandatory. Missing/expired artifacts or superseding runs abort publication; rerun
canonical verification and resolve fresh proof, never fall back to rebuilding during
promotion. Local hashes alone do not authorize publication. Actual GitHub execution
and artifact rollout remain unverified until observed after authorized integration.
