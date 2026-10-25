#!/usr/bin/env python3
"""Check translation coverage, navigation, deployed links and equivalent-page selectors."""
import argparse
from html.parser import HTMLParser
from pathlib import Path
import re
import tomllib
from urllib.parse import urlsplit, unquote

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / '.artifacts/documentation/site'
BASE = '/agent-plugins/'
ORIGIN = 'bioinfornatics.github.io'

class Page(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.refs, self.ids, self.alternates, self.lang = [], set(), {}, None
        self.feed(text)
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'html': self.lang = a.get('lang')
        if 'id' in a: self.ids.add(a['id'])
        for key in ('href', 'src'):
            if key in a: self.refs.append(a[key])
        if tag == 'a' and 'hreflang' in a: self.alternates[a['hreflang']] = a['href']

def route(file):
    return str(file.with_suffix('')) + '/' if file.name != 'index.md' else str(file.parent).replace('.', '').strip('/') + ('/' if str(file.parent) != '.' else '')

def check(source_only=False):
    for p in [ROOT/'docs/documentation.md', *(ROOT/'docs/site').rglob('*.md')]:
        assert all(c >= 32 or c in (9,10,13) for c in p.read_bytes()), f'Control character: {p}'
    pages = {lang: {p.relative_to(ROOT / 'docs/site' / lang) for p in (ROOT / 'docs/site' / lang).rglob('*.md')} for lang in ('en', 'fr')}
    assert pages['en'] and pages['en'] == pages['fr'], 'English/French page coverage differs'
    for lang in pages:
        cfg = tomllib.loads((ROOT / f'zensical.{lang}.toml').read_text())['project']
        assert {Path(next(iter(row.values()))) for row in cfg['nav']} == pages[lang], 'Navigation coverage differs'
        for file in pages[lang]:
            source = ROOT / 'docs/site' / lang / file
            text = source.read_text()
            assert text.startswith('# '), f'Missing title: {source}'
            assert text.count('~~~') % 2 == 0 and text.count('\x00') == 0
            for link in re.findall(r'\]\(([^)]+)\)', text):
                u = urlsplit(link)
                if not u.scheme and u.path: assert (source.parent / unquote(u.path)).is_file(), f'Broken source link: {source}: {link}'
    if source_only:
        print(f'PASS: {len(pages["en"])} corresponding pages per language; source links and navigation')
        return
    html = {p: Page(p.read_text()) for p in SITE.rglob('*.html')}
    assert html, 'Build the site first'
    for lang in pages:
        for file in pages[lang]:
            r = route(file)
            page = html[SITE / lang / r / 'index.html']
            assert page.lang == lang, f'Wrong page language: {file}'
            for target in pages:
                expected = f'https://{ORIGIN}{BASE}{target}/{r}'
                assert page.alternates.get(target) == expected, f'Selector does not preserve page: {lang}/{file}'
    for path, page in html.items():
        for ref in page.refs:
            u = urlsplit(ref)
            if u.scheme and u.scheme not in ('http', 'https'): continue
            if u.netloc and u.netloc != ORIGIN: continue
            if u.path.startswith('/'):
                assert u.path.startswith(BASE), f'URL outside Pages base: {ref}'
                target = SITE / unquote(u.path[len(BASE):])
            else:
                target = path.parent / unquote(u.path) if u.path else path
            target = target.resolve()
            assert target.is_relative_to(SITE.resolve()), f'Escaping site path: {ref}'
            if target.is_dir(): target /= 'index.html'
            assert target.is_file(), f'Broken generated link: {path.relative_to(SITE)} -> {ref}'
            if u.fragment and target.suffix == '.html':
                assert unquote(u.fragment) in html[target].ids, f'Broken fragment: {ref}'
    print(f'PASS: {len(html)} HTML pages; links, anchors, localized markup and equivalent-page selectors')

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--source-only', action='store_true')
    check(p.parse_args().source_only)
