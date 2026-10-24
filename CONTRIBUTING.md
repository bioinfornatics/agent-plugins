# Contributing to Agent Plugins

Thanks for helping make agent capabilities easier to author, safer to share, and more useful. This guide explains where to work, how the build works, and why the installation branch differs from the source branch. For installation and first use, see [README.md](README.md).

## The branch model, in one minute

The source branch is named **`development`**, not `develop`.

```text
feature/my-change
       │ reviewed feature PR
       ▼
development                 authoritative source + generated runtime mirrors
       │ exact-source-SHA CI + independent current-SHA approval
       │ reverify source, approval, and current main
       ▼
production projection       allowlisted installation tree, not a source merge
       │ normal fast-forward publication
       ▼
main                        ready-to-install Skills + contained runtimes
```

Think of `development` as the workshop and `main` as the packaged product. Users should not need the workshop to run the product.

| Branch | Purpose | What belongs there |
|---|---|---|
| Feature branch | A focused, reviewable change | Source, tests, documentation, and regenerated outputs for that change |
| `development` | Authoritative development history | Apps, contracts, build rules, tests, vendored dependencies, and Skill runtime mirrors |
| `main` | Git-installable production distribution | Manifest, user documentation, license, self-contained Skills, provenance, and dispatch workflows |

**Feature PRs target `development`. Never merge `development` into `main` or edit generated production files by hand.** A `development` → `main` PR is a promotion review request; successful publication closes it without merging.

The policy is repository-specific. The upstream migration is documented; ServierHub publication remains subject to separate permissions and migration work. Do not change remotes or credentials to work around this. See [migration policy and rollback](docs/branch-migration.md).

## Start a contribution

1. Inspect [AGENTS.md](AGENTS.md), the relevant component guide, and existing Beads issues. Use `bd prime` for tracker guidance and `bd ready` to find available work. Track work with `bd`, not a separate Markdown task list.
2. Create a feature branch from `development`. If you already have a checkout, inspect `git status` first and preserve existing changes.
3. Keep the change scoped, document acceptance criteria, and include reproducible validation evidence in the PR.

For a fresh upstream checkout:

```bash
git clone --branch development https://github.com/bioinfornatics/agent-plugins.git
cd agent-plugins
git switch -c feature/my-change
```

Creating a branch does not authorize an automated agent to commit or push. Follow the active user and repository policy.

## Development prerequisites

- **Node.js 22+** for the contained runtimes and Node-based tooling. Routine CI uses Node.js 22.22.2.
- **Bun 1.3.12**, pinned in `package.json` and `bun-release.json`, for the package-script facade and native release compiler.
- **Git**; **Beads (`bd`)** for task tracking. **Make** is optional.
- Full verification also needs the verified **Goose 1.47.0** executable and a supported browser for integration/accessibility checks. See [.github/workflows/development-ci.yml](.github/workflows/development-ci.yml) for CI prerequisites.
- Native packaging needs `tar`, `gzip`, `zip`, and `sha256sum`; release CI supplies real-platform runners.

These are contributor requirements. **Git-installation users need Node.js, not Bun or an npm install.** Native archives do not require Node.js.

### Restore dependencies offline

From a fresh development checkout:

```bash
node scripts/prepare-development.mjs
```

This verifies the vendored dependency closure and restores development `node_modules` into the four apps and the capability contract without network installation or lifecycle scripts. It deliberately refuses to overwrite existing development modules; inspect an existing checkout instead of deleting dependencies blindly.

Dependency changes require a deliberate package/lockfile and vendored-closure update; offline restoration is not a dependency upgrade command.

## Understand the source layout

```text
apps/<creator>-cli/          TypeScript authoring sources, tests, generated dist/
contracts/                  shared contracts and compatibility fixtures
skills/<name>/              independently installable instructions/resources
  scripts/<name>.mjs         generated Node launcher for executable creators
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

1. **Author** TypeScript under `apps/<creator>-cli/`; edit Skill instructions and supporting resources under `skills/<name>/`.
2. **Compile** the app to its `dist/` directory and build shared contracts.
3. **Generate** each Skill’s contained runtime using `config/skill-runtimes/skill-runtime-map.json`. The generator copies compiled implementation/resources and the locked production dependency closure into `skills/<name>/runtime/`, creates its manifest, and writes the launcher.
4. **Review and retain** regenerated runtime mirrors alongside the source change. CI rebuilds them and rejects differences from committed outputs. Never fix a generated file instead of its source.
5. **Project** the verified source into a production-only tree. `scripts/production.mjs` selects allowed files, rejects incomplete runtimes and unsafe entries, and records exact source commit/tree plus a hashed file inventory.

The installed launcher runs JavaScript from **inside its own Skill directory**. It must not reach into root `apps/`, another Skill, or repository-level dependencies. That containment is why copying the whole Skill directory works without a build or dependency install.

### Build after editing

Run these from the repository root after restoring dependencies:

```bash
for app in apps/*-creator-cli; do
  (cd "$app" && npm run build) || exit
done
(cd contracts/capability-contract && npm run build)
node contracts/capability-contract/scripts/refresh-compatibility-fixtures.mjs
npm run build:skill-runtimes
npm run check:skill-runtime-dist-drift
```

For a focused change, build and test the affected app first:

```bash
(cd apps/skill-creator-cli && npm run build && npm test)
```

Then regenerate runtime mirrors before final verification. The root `package.json` scripts are canonical; Bun and Make are facades, not a replacement of every internal Node runner. The clean CI rebuild command, `node scripts/rebuild-production.mjs`, is a **drift gate**: use it after generated changes are recorded in the candidate, not to accept stale committed outputs.

## Verify your change

| Command | Scope |
|---|---|
| `npm run test:distribution` | Distribution structure and adoption documentation |
| `npm run test:production` | Projection, runtime containment, provenance, promotion guards |
| `npm run test:production-ci` | Routine production profile, including creator and integration checks; defers five-platform release packaging |
| `npm test` | Full developer suite, including applicable native/package checks |
| `npm run test:reproducibility-build` | Isolated clean-source build reproducibility |
| `npm run test:reproducibility` | Exhaustive isolated verification |

Before release, run `npm run build && npm test` in each creator app and the required root gates. Tests must not mutate live `~/.agents` directories. Missing external tools or behavioral evidence must be reported as limits, not a pass.

Routine PR/push CI verifies the **exact source head SHA**, not a synthetic merge tree: offline restoration, clean rebuild, committed-output coherence, production-profile tests, deterministic projection, and isolated Git installation/update. Scheduled/manual exhaustive CI adds isolated reproducibility and five-platform packaging verification. Native tagged releases have their own real-platform matrix. Complete CI logs are uploaded for 14 days; consult them when the bounded console output is insufficient.

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

1. Merge the reviewed feature PR into `development`.
2. Open a same-repository, non-draft PR with head `development` and base `main`. State clearly that it is a **promotion review request**.
3. Require successful exact-head CI and independent collaborator/maintainer approval for that same SHA. Stale approvals, author self-approval, forks, and outstanding change requests fail closed.
4. Approval starts **Promote production**. It resolves the source/base pair, reruns verification for that exact source, and rechecks approval, source, and current `main` before publishing. Manual dispatch on `development`, with the PR number and expected `main` SHA, is the recovery path.
5. The publisher creates a generated-tree commit with previous `main` as its **sole parent**, then uses a normal fast-forward push. It closes the PR without merging and keeps `development`.

**Never click Merge on this request. Never force-push production.** Workflow guards do not configure branch protection; required checks and publisher permissions must be configured separately before claiming enforced governance. Approval checks are not atomic with GitHub reviews.

If publication succeeded but closing the PR failed, inspect `main` provenance before retrying. Rollback creates a new production commit from the recorded previous tree, with current `main` as parent; it does not reset history. Follow [the complete policy](docs/branch-migration.md) for safeguards and limits.

## Git production versus native releases

| | Git distribution on `main` | Tagged native release |
|---|---|---|
| Execution | Node.js 22+ launcher | Platform-specific Bun executable |
| Skill payload | Compiled JavaScript and production dependencies in `runtime/` | Executable in `scripts/`; Node launcher/runtime payload excluded |
| Source of build | Verified `development` commit | Tag targeting `development` source |
| End-user build/install dependencies | None beyond Node.js and the host | No Node.js or npm dependencies |

Native release assembly excludes Node payloads and injects the matching executable; do not mix the two modes. See [RELEASES.md](RELEASES.md) for user-facing archives and verification.

Useful optional developer commands:

```bash
make help
make bundle                         # current-platform native plugin stage
make bundle-install-plugin DRY_RUN=1 # build, then preview project-local installation
make release OUTPUT=/path/to/assets  # validate/package all pinned targets
```

The Make installer handles a **full plugin** under project-local `.agents/plugins/agent-plugins`, not a standalone Skill. It refuses existing destinations unless explicitly forced and rejects symlinked destinations/ancestors. See `make help` for `DEST`, `SOURCE`, diagnostics, and other options. Generated native stages must not be edited by hand.

## Documentation and authoring rules

- Keep `README.md` user-facing: value, installation, examples, and troubleshooting. Put build and contributor details here.
- Edit `docs/production-README.md` for the README projected to `main`. It must link to developer docs on `development`, because root development files are intentionally excluded from production.
- Add new canonical source files to `config/reproducibility/source-manifest.json`.
- Keep `plugin.json` valid and each directory under `skills/` independently installable.
- Write Skill metadata/instructions in English; use concise third-person descriptions and keep `SKILL.md` at or below 500 lines. Move deep detail into directly linked references.
- Route changes by responsibility: Skill, agent, hook, or whole-plugin creator. Refresh vendored upstream snapshots before changing a public format contract.
- Preserve paired evaluation evidence. Never turn missing or inconclusive results into improvement claims.

## Safe cleanup and handoff

`make clean` (or `npm run clean`) removes generated root `bin/`, `dist/`, `release-staging/`, `release-assets/`, and `.artifacts/`. It preserves Skill runtimes, vendor dependencies, evaluations, and `.agents/` content. Do not use broad deletion commands as a substitute. Save temporary evidence elsewhere before cleanup if it is still needed.

At handoff, report changed files, exact checks and their outcomes, limitations, and Beads status. Close completed issues and file follow-up work where needed. Commit, push, and Dolt remote synchronization require explicit authority under the conservative repository policy.
