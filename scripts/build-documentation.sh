#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/check-documentation.py --source-only
# Delete only this disposable output tree; never retain arbitrary previous files.
python3 -c "from pathlib import Path; import shutil; p=Path('.artifacts/documentation/site'); assert not p.is_symlink(); shutil.rmtree(p, ignore_errors=True)"
for lang in en fr; do
  mkdir -p "docs/site/$lang/assets"
  cp docs/assets/documentation.css docs/assets/language.js "docs/site/$lang/assets/"
  zensical build --clean --strict -f "zensical.$lang.toml"
done
python3 scripts/finalize-documentation.py
python3 scripts/check-documentation.py
python3 scripts/documentation-integrity.py seal
python3 scripts/documentation-integrity.py verify
