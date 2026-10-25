#!/usr/bin/env python3
"""Seal/verify documentation build input and output hashes, rejecting unsafe entries."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / '.artifacts/documentation/site'

def inputs():
    files = ['README.md', '.gitignore', 'config/reproducibility/source-manifest.json',
             'zensical.en.toml','zensical.fr.toml','.github/workflows/documentation.yml',
             'docs/documentation.md','docs/requirements.in','docs/requirements.txt']
    for prefix in ['docs/assets','docs/overrides']:
        files += [str(p.relative_to(ROOT)) for p in (ROOT/prefix).rglob('*') if p.is_file()]
    files += [str(p.relative_to(ROOT)) for p in (ROOT/'docs/site').rglob('*.md')]
    files += [str(p.relative_to(ROOT)) for p in (ROOT/'scripts').glob('*documentation*') if p.is_file()]
    return sorted(set(files))

def digest(path):
    assert path.is_file() and not path.is_symlink(), f'Unsafe or absent file: {path}'
    return hashlib.sha256(path.read_bytes()).hexdigest()

def source():
    return {f:digest(ROOT/f) for f in inputs()}

def inventory(site):
    result = {}
    assert not site.is_symlink(), 'Symlink site root'
    for path in sorted(site.rglob('*')):
        assert not path.is_symlink(), f'Symlink output: {path}'
        if path.is_dir(): continue
        assert path.is_file(), f'Special output: {path}'
        rel = str(path.relative_to(site))
        if rel != 'build-manifest.json': result[rel] = digest(path)
    return result

def clean_source():
    assert not subprocess.check_output(['git','status','--porcelain','--',*inputs()],cwd=ROOT,text=True), 'Commit every sealed documentation input before publication'

def verify(site=SITE):
    manifest = json.loads((site/'build-manifest.json').read_text())
    assert manifest['schemaVersion']==1
    assert manifest['outputs']==inventory(site), 'Altered or unexpected build output'
    assert manifest['inputs']==source(), 'Build source inputs changed'
    provenance = json.loads((site/'source.json').read_text())
    assert provenance['sourceCommit']==subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(), 'Stale source commit'
    # Build-time ignored copies cannot silently differ from canonical shared resources.
    for lang in ['en','fr']:
        for asset in (ROOT/'docs/assets').iterdir():
            copy = ROOT/'docs/site'/lang/'assets'/asset.name
            if copy.exists(): assert digest(copy)==digest(asset), f'Stale ignored asset: {copy}'
    print('PASS: exact source and output hashes; no unexpected files or symlinks')

if __name__=='__main__':
    if sys.argv[1]=='seal':
        (SITE/'build-manifest.json').write_text(json.dumps({'schemaVersion':1,'inputs':source(),'outputs':inventory(SITE)},indent=2)+chr(10))
    elif sys.argv[1]=='verify': verify()
    elif sys.argv[1]=='clean': clean_source()
    else: raise SystemExit('Expected seal or verify')
