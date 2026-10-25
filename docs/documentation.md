# Maintaining the bilingual documentation

The documentation target is https://bioinfornatics.github.io/agent-plugins/.
English is authoritative; French mirrors every English page. This site is separate
from the installable Skills on `main` and the ServierHub installation distribution.

## Local build

Use Python 3.12 and the hash-locked documentation dependency set:

```bash
python3.12 -m venv .artifacts/documentation/venv
.artifacts/documentation/venv/bin/pip install --require-hashes -r docs/requirements.txt
PATH="$PWD/.artifacts/documentation/venv/bin:$PATH" bash scripts/build-documentation.sh
```

Output lives in `.artifacts/documentation/site/`. Serve its parent with the site
mounted at `/agent-plugins/`; the browser check starts a correctly mounted local
server automatically:

```bash
CHROMIUM_PATH=/path/to/chrome node scripts/test-documentation-browser.mjs
```

The default Playwright import uses existing Skill Creator development dependencies.
For an isolated installation, set `PLAYWRIGHT_MODULE` to an absolute path to
`playwright-core/index.mjs` (version 1.60.0). CI installs this separately and uses
Chrome provided by the runner. Screenshots are saved under `.artifacts/documentation/`.
A browser test establishes only its tested browser/viewport behavior, not a complete
accessibility audit or a human learning study.

## Add or change a page

1. Edit English under `docs/site/en/` and translate the corresponding French file
   under `docs/site/fr/`. Keep matching paths and content coverage.
2. Update both localized navigation lists in `zensical.en.toml` and
   `zensical.fr.toml`. Translate Mermaid labels and explain diagrams in prose.
3. Use relative Markdown links for site pages and explicit GitHub URLs for repository
   references not shipped with the site. Do not link to authoring sources on `main`.
4. Build and run checks. Translation parity checks prove structure and coverage,
   not semantic translation quality; review both texts.

## Localization and diagrams

Zensical 0.0.72 provides localized theme text, Mermaid fences, template overrides,
and language alternate links. Two builds provide independent language search and
navigation without relying on unsupported third-party localization plugins.

The `partials/alternate.html` override uses a native HTML disclosure with links to
matching page routes. It supports keyboard navigation and works without JavaScript.
Escape dismissal is a small optional enhancement. Anchor fragments are intentionally
not carried across languages, because translated headings have different IDs.

The header partial is the Zensical 0.0.72 snapshot with one change: unconditionally
include the custom selector. Its CSS places the selector at the far right. Recheck
this snapshot against the pinned theme whenever upgrading. Shared CSS/JS is copied
into ignored localized asset folders during build. Do not author those copies.

Sources consulted: [language](https://zensical.org/docs/setup/language/),
[customization](https://zensical.org/docs/customization/),
[diagrams](https://zensical.org/docs/authoring/diagrams/),
[publishing](https://zensical.org/docs/publish-your-site/).
Mermaid is loaded by Zensical's built-in browser integration; network access is
required for its external module. The conceptual prose remains readable if diagrams
cannot load. External links and host compatibility are not certified by site checks.

## Publication and rollback

Feature PRs target `develop`. The documentation workflow builds and browser-checks
PRs without publication. Scoped changes pushed to `develop` build, verify, and publish
the site to `gh-pages` in the personal upstream repository after approval in the
`github-pages` environment. That environment is configured with the personal owner
as a required reviewer and only `develop` as an allowed deployment branch. Owner
approval is not independent review; administrator bypass remains available. The
publisher also rejects a source SHA that is no longer current remote `develop`.
Pages uses legacy branch
publishing from `gh-pages:/`, with `.nojekyll`. CI explicitly requests a Pages build
because pushes using `GITHUB_TOKEN` do not themselves trigger Pages.

The first release can be published from a reviewed feature commit with explicit user
authority. After committing the documentation inputs and rebuilding, run:

```bash
bash scripts/publish-documentation.sh upstream
```

The publisher stages only generated site files in a temporary repository. Each
publication is a normal fast-forward commit on `gh-pages`; never force-push. The
`source.json` file binds the site to the source commit. Uncommitted documentation
inputs or stale provenance block publication. A build manifest binds canonical input
hashes and every output hash; verification rejects injected files, modified assets,
symlinks and stale ignored copies. CI supplies a temporary-repository credential
helper backed by the environment token and an explicit bot identity. No token is
written into the repository or logs. Review the exact source and evidence
before invoking this separately authorized remote operation.

Configure Pages once with repository admin permission; do not reconfigure an existing
site without inspecting it. Keep the source PR open for independent project review.
The `main` projection, Skill runtimes, plugin manifest and production promotion
workflow are unchanged. This deployment is not a Skill release or promotion.

For rollback, rebuild a previously accepted source commit in an isolated worktree,
verify it, and publish a new `gh-pages` commit carrying that source SHA. Recheck the
public URL, language links and `source.json`; do not rewind branch history.
