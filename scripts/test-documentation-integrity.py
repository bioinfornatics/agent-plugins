#!/usr/bin/env python3
"""Negative publication checks, performed only on disposable output copies."""
import importlib.util
from pathlib import Path
import shutil
import tempfile
spec=importlib.util.spec_from_file_location('integrity',Path(__file__).with_name('documentation-integrity.py'))
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
m.verify()
with tempfile.TemporaryDirectory(dir=m.ROOT/'.artifacts/documentation') as temp:
    root=Path(temp)
    for kind in ['extra','modified','symlink']:
        site=root/kind
        shutil.copytree(m.SITE,site)
        if kind=='extra': (site/'private.txt').write_text('must not publish')
        if kind=='modified': (site/'en/assets/documentation.css').write_text('modified')
        if kind=='symlink': (site/'unsafe').symlink_to('/etc/passwd')
        try: m.verify(site)
        except AssertionError: print('PASS: rejected '+kind+' output')
        else: raise AssertionError('Accepted '+kind+' output')
asset=m.ROOT/'docs/site/en/assets/documentation.css'
original=asset.read_bytes()
try:
    asset.write_bytes(b'stale ignored resource')
    try: m.verify()
    except AssertionError: print('PASS: rejected stale ignored asset')
    else: raise AssertionError('Accepted stale ignored asset')
finally: asset.write_bytes(original)
