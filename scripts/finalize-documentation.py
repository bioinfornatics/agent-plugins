#!/usr/bin/env python3
"""Add the English entrypoint and immutable source provenance to the site."""
import json
from pathlib import Path
import subprocess
ROOT = Path(__file__).resolve().parents[1]
site = ROOT / '.artifacts/documentation/site'
site.mkdir(parents=True, exist_ok=True)
(site / 'index.html').write_text('''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0;url=en/"><title>Agent Plugins documentation</title>
<link rel="canonical" href="https://bioinfornatics.github.io/agent-plugins/en/"></head>
<body><h1>Agent Plugins documentation</h1><p><a href="en/" lang="en">English</a> · <a href="fr/" lang="fr">Français</a></p></body></html>''')
(site / '404.html').write_text('''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found / Page introuvable</title></head><body><h1>Page not found / Page introuvable</h1><p><a href="/agent-plugins/en/">English documentation</a> · <a href="/agent-plugins/fr/" lang="fr">Documentation française</a></p></body></html>''')
(site / '.nojekyll').touch()
sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
(site / 'source.json').write_text(json.dumps({'sourceCommit': sha, 'zensical': '0.0.72', 'sourceRepository': 'https://github.com/bioinfornatics/agent-plugins', 'languages': ['en','fr']}, indent=2) + '\n')
