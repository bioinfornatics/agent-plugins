#!/usr/bin/env bash
# Only generated documentation is published; main and production tooling are untouched.
set -euo pipefail
cd "$(dirname "$0")/.."
remote="${1:-upstream}"
site="$PWD/.artifacts/documentation/site"
test -f "$site/source.json"
python3 scripts/check-documentation.py
python3 scripts/documentation-integrity.py verify
python3 scripts/documentation-integrity.py clean
if [ "${DOCUMENTATION_CI:-}" = "1" ]; then
  current=$(git ls-remote "$remote" refs/heads/develop | cut -f1)
  test "$current" = "$(git rev-parse HEAD)" || { echo "Source is no longer current develop" >&2; exit 1; }
fi
# Require exact source provenance and no uncommitted documentation inputs.
python3 - <<'PY'
import json, subprocess
from pathlib import Path
source=json.loads(Path('.artifacts/documentation/site/source.json').read_text())['sourceCommit']
assert source == subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(), 'Stale documentation build'
paths=['docs/assets','docs/overrides','docs/site','docs/requirements.in','docs/requirements.txt','zensical.en.toml','zensical.fr.toml','scripts/build-documentation.sh','scripts/check-documentation.py','scripts/finalize-documentation.py','scripts/publish-documentation.sh','scripts/test-documentation-browser.mjs','.github/workflows/documentation.yml']
assert not subprocess.check_output(['git','status','--porcelain','--',*paths],text=True), 'Commit documentation sources before publication'
PY
repo=$(mktemp -d "$PWD/.artifacts/documentation/publish.XXXXXX")
trap 'rm -rf "$repo"' EXIT
url=$(git remote get-url "$remote")
source=$(git rev-parse HEAD)
git init -q "$repo"
git -C "$repo" remote add publish "$url"
if [ -n "${GH_TOKEN:-}" ]; then
  # Non-secret helper reads GH_TOKEN from the environment in the temporary repo.
  git -C "$repo" config credential.helper "!gh auth git-credential"
  git -C "$repo" config credential.https://github.com.useHttpPath true
fi
if git ls-remote --exit-code "$remote" refs/heads/gh-pages >/dev/null; then
  git -C "$repo" fetch --depth=1 publish gh-pages
  git -C "$repo" checkout -q -b gh-pages FETCH_HEAD
  git -C "$repo" rm -r --ignore-unmatch . >/dev/null
else
  git -C "$repo" checkout -q --orphan gh-pages
fi
cp -a "$site/." "$repo/"
git -C "$repo" add .
if git -C "$repo" diff --cached --quiet; then echo 'Documentation already current'; exit 0; fi
git -C "$repo" -c user.name="$(git config user.name)" -c user.email="$(git config user.email)" commit -q -m "docs: publish bilingual site from $source"
git -C "$repo" push publish HEAD:refs/heads/gh-pages
