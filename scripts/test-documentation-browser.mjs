#!/usr/bin/env node
/** Real Chromium checks; imports can be overridden for a standalone CI install. */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '../apps/skill-creator-cli/node_modules/playwright-core/index.mjs');
const root = resolve('.artifacts/documentation/site');
const base = process.env.DOCS_URL || 'http://127.0.0.1:8765/agent-plugins/';
let server;
if (!process.env.DOCS_URL) {
  server = createServer((req,res) => {
    let path = decodeURIComponent(new URL(req.url, base).pathname);
    if (!path.startsWith('/agent-plugins/')) { res.writeHead(404).end(); return; }
    path = resolve(root, path.slice('/agent-plugins/'.length));
    if (!path.startsWith(root + '/') && path !== root) { res.writeHead(403).end(); return; }
    if (existsSync(path) && statSync(path).isDirectory()) path += '/index.html';
    if (!existsSync(path)) { res.writeHead(404).end(); return; }
    const types = {'.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml'};
    res.setHeader('Content-Type',types[extname(path)] || 'application/octet-stream');
    res.end(readFileSync(path));
  });
  await new Promise(r => server.listen(8765,'127.0.0.1',r));
}
const browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {})});
mkdirSync('.artifacts/documentation/screenshots',{recursive:true});
try {
  const page = await browser.newPage();
  const errors=[];
  page.on('pageerror', e => errors.push(e.message));
  // Map production links to the local base while retaining real relative assets.
  if (!process.env.DOCS_URL) await page.route('https://bioinfornatics.github.io/agent-plugins/**', async route => { const response = await route.fetch({url:route.request().url().replace('https://bioinfornatics.github.io/agent-plugins/',base)}); await route.fulfill({response}); });
  const routes = ['', 'concepts/', 'getting-started/', 'tutorials/first-skill/', 'how-to/creators/', 'how-to/evaluate/', 'reference/', 'contributing/'];
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    for (const lang of ['en','fr']) for (const route of routes) {
      const response=await page.goto(base+lang+'/'+route);
      assert.equal(response.status(),200);
      assert.equal(await page.locator('html').getAttribute('lang'),lang);
      const toggle=page.locator('.documentation-language summary');
      await toggle.focus(); await page.keyboard.press('Enter');
      await page.locator('.documentation-language[open]').waitFor();
      const other=lang==='en'?'fr':'en';
      const link=page.locator('.documentation-language a[hreflang="'+other+'"]');
      assert.equal(new URL(await link.getAttribute('href')).pathname,'/agent-plugins/'+other+'/'+route);
      await page.keyboard.press('Escape');
      assert.equal(await toggle.evaluate(e => e===document.activeElement),true);
      assert.equal(await page.locator('.documentation-language').getAttribute('open'),null);
      const box=await toggle.boundingBox();
      assert(box.x>width/2 && box.x+box.width<=width, 'Language selector must remain upper-right');
      assert(box.y<90);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth),true,'Unexpected horizontal overflow');
      const diagramCount = await page.locator('pre.mermaid, div.mermaid').count();
      if (diagramCount) {
        // Zensical renders diagrams in closed shadow roots; inspect them via Chromium DOM.
        await page.locator('div.mermaid').first().waitFor({timeout:30000});
        const cdp = await page.context().newCDPSession(page);
        const {root: dom} = await cdp.send('DOM.getDocument',{depth:-1,pierce:true});
        const nodes = [];
        function walk(node) { nodes.push(node); for (const child of [...(node.children||[]),...(node.shadowRoots||[])]) walk(child); }
        walk(dom);
        const svgs = nodes.filter(n => n.localName==='svg' && (n.attributes||[]).some(a => a.startsWith('__mermaid_')));
        assert.equal(svgs.length,diagramCount,'Every diagram must render an SVG');
        await cdp.detach();
      }
      if (route==='concepts/') await page.screenshot({path:'.artifacts/documentation/screenshots/'+lang+'-'+width+'.png',fullPage:true});
    }
    await page.goto(base+'en/tutorials/first-skill/');
    await page.locator('.documentation-language summary').focus();
    await page.keyboard.press('Enter');
    await page.locator('.documentation-language a[hreflang="fr"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(url => url.pathname.replace(/\/$/, '') === '/agent-plugins/fr/tutorials/first-skill', {waitUntil:'domcontentloaded'});
    assert.equal(await page.locator('html').getAttribute('lang'),'fr');
  }
  assert.deepEqual(errors,[],'Browser JavaScript errors');
  const nojs=await browser.newPage({javaScriptEnabled:false});
  if (!process.env.DOCS_URL) await nojs.route('https://bioinfornatics.github.io/agent-plugins/**', async route => { const response = await route.fetch({url:route.request().url().replace('https://bioinfornatics.github.io/agent-plugins/',base)}); await route.fulfill({response}); });
  await nojs.goto(base+'fr/reference/');
  await nojs.locator('.documentation-language summary').click();
  await nojs.locator('.documentation-language a[hreflang="en"]').click();
  await nojs.waitForURL(url => url.pathname.replace(/\/$/, '') === '/agent-plugins/en/reference', {waitUntil:'domcontentloaded'});
  console.log('PASS: 32 desktop/mobile localized pages, all diagrams, keyboard/Escape, page-preserving language navigation and no-JS switching');
} finally { await browser.close(); if(server) await new Promise(r => server.close(r)); }
