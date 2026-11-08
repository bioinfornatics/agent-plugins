import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, symlinkSync, chmodSync, mkdirSync, readdirSync, lstatSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareEvaluationCandidate, verifyEvaluationCandidate } from '../scripts/prepare-evaluation-candidate.mjs';
import { verifyProduction } from '../scripts/production.mjs';
import { FilesystemEvaluationSource } from '../apps/agent-plugin/src/adapters/outbound/filesystem/filesystem-evaluation-source.ts';

// A production-shaped candidate must resolve independently and must not install neutral test inputs.
test('local candidate carries all suites, preserves production treatment and detects drift', async () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'evaluation-candidate-'));
  try {
    const destination = path.join(temp, 'candidate');
    const manifest = await prepareEvaluationCandidate(destination);
    const plugin = path.join(destination, 'plugin');
    const prepared = await new FilesystemEvaluationSource().load({ kind: 'plugin', root: plugin });
    assert.equal(prepared.scenarios.length, 16);
    assert.deepEqual([...new Set(prepared.scenarios.map(s => s.id.split('/')[0]))].sort(),
      ['agent-creator', 'hook-creator', 'plugin-creator', 'plugin-script-packaging', 'skill-creator']);
    assert.ok(prepared.scenarios.some(s => s.fixturesFiles?.some(f => f.path === 'evals/inputs/invalid-agent.md')));
    assert.ok(prepared.files.every(f => !f.path.split('/').includes('evals')));
    assert.ok(!existsSync(path.join(plugin, 'distribution-manifest.json')));
    assert.ok(!existsSync(path.join(plugin, 'apps')));
    assert.ok(!existsSync(path.join(plugin, 'vendor')));
    assert.ok(manifest.snapshotBytes < 64 * 1024 * 1024);
    await verifyEvaluationCandidate(destination);
    assert.equal(manifest.schemaVersion, 2);
    assert.deepEqual(readdirSync(destination).sort(), ['candidate-manifest.json', 'plugin', 'production']);
    const production = path.join(destination, 'production');
    assert.deepEqual(verifyProduction(production), manifest.production);
    const originalManifest = readFileSync(path.join(production, 'distribution-manifest.json'));
    assert.equal(originalManifest.toString(), JSON.stringify(manifest.production, null, 2) + '\n');
    const baseline = await new FilesystemEvaluationSource().load({ kind: 'skill', root: path.join(plugin, 'skills/agent-creator') });
    assert.ok(baseline.files.every(f => !f.path.includes('evaluation-fixtures')));
    for (const row of manifest.production.files) {
      assert.deepEqual(readFileSync(path.join(plugin, row.path)), readFileSync(path.join(production, row.path)), row.path);
      assert.equal(lstatSync(path.join(plugin, row.path)).mode & 0o777, lstatSync(path.join(production, row.path)).mode & 0o777, row.path);
      assert.equal(lstatSync(path.join(production, row.path)).mode & 0o111 ? 755 : 644, row.mode, row.path);
    }
    assert.ok(manifest.production.files.some(row => row.mode === 755));
    await verifyEvaluationCandidate(destination);
    assert.deepEqual(readFileSync(path.join(production, 'distribution-manifest.json')), originalManifest);
    writeFileSync(path.join(plugin, 'skills/agent-creator/evals/inputs/invalid-agent.md'), 'changed');
    await assert.rejects(verifyEvaluationCandidate(destination), /inventory mismatch/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

// Existing paths and unsafe ancestors must not be overwritten or followed.
test('candidate preparation refuses existing and protected destinations and symlinks', async () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'evaluation-candidate-safe-'));
  try {
    writeFileSync(path.join(temp, 'sentinel'), 'preserve');
    await assert.rejects(prepareEvaluationCandidate(temp), /new/);
    assert.equal(readFileSync(path.join(temp, 'sentinel'), 'utf8'), 'preserve');
    await assert.rejects(prepareEvaluationCandidate(path.resolve(import.meta.dirname, '../skills/new-candidate')), /protected/);
    if (process.platform !== 'win32') {
      symlinkSync(temp, path.join(temp, 'link'), 'dir');
      await assert.rejects(prepareEvaluationCandidate(path.join(temp, 'link', 'candidate')), /symlink/);
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

// Verification rejects added/missing files and links, not only modified content.
test('candidate verification rejects additions, omissions, mode drift and links', async () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'evaluation-candidate-tamper-'));
  try {
    const destination = path.join(temp, 'candidate');
    await prepareEvaluationCandidate(destination);
    const production = path.join(destination, 'production');
    const frozen = path.join(production, 'LICENSE');
    const frozenBytes = readFileSync(frozen);
    const manifestPath = path.join(production, 'distribution-manifest.json');
    const originalManifest = readFileSync(manifestPath);
    writeFileSync(frozen, 'changed');
    await assert.rejects(verifyEvaluationCandidate(destination), /production inventory mismatch/);
    writeFileSync(frozen, frozenBytes);
    if (process.platform !== 'win32') {
      chmodSync(frozen, 0o755);
      await assert.rejects(verifyEvaluationCandidate(destination), /production inventory mismatch/);
      chmodSync(frozen, 0o644);
    }
    const alteredManifest = JSON.parse(originalManifest.toString());
    alteredManifest.sourceTree = '0'.repeat(40);
    writeFileSync(manifestPath, JSON.stringify(alteredManifest));
    assert.doesNotThrow(() => verifyProduction(production));
    await assert.rejects(verifyEvaluationCandidate(destination), /production baseline mismatch/);
    writeFileSync(manifestPath, originalManifest);
    rmSync(frozen);
    await assert.rejects(verifyEvaluationCandidate(destination), /production inventory mismatch/);
    writeFileSync(frozen, frozenBytes);
    if (process.platform !== 'win32') {
      symlinkSync(path.join(destination, 'plugin'), path.join(production, 'extra'), 'dir');
      await assert.rejects(verifyEvaluationCandidate(destination), /symlink/);
      rmSync(path.join(production, 'extra'));
    }
    renameSync(production, path.join(temp, 'saved-production'));
    await assert.rejects(verifyEvaluationCandidate(destination), /unexpected candidate envelope/);
    renameSync(path.join(temp, 'saved-production'), production);
    await verifyEvaluationCandidate(destination);
    const file = path.join(destination, 'plugin/LICENSE');
    const original = readFileSync(file);
    // Even a refreshed evaluation inventory cannot change the retained treatment.
    const candidatePath = path.join(destination, 'candidate-manifest.json');
    const candidateBytes = readFileSync(candidatePath);
    const rebound = JSON.parse(candidateBytes.toString());
    const changed = Buffer.from('different treatment');
    writeFileSync(file, changed);
    const row = rebound.entries.find(entry => entry.path === 'LICENSE');
    row.size = changed.length;
    row.sha256 = createHash('sha256').update(changed).digest('hex');
    rebound.inventorySha256 = createHash('sha256').update(JSON.stringify(rebound.entries)).digest('hex');
    writeFileSync(candidatePath, JSON.stringify(rebound));
    await assert.rejects(verifyEvaluationCandidate(destination), /treatment differs from production baseline/);
    writeFileSync(file, original);
    writeFileSync(candidatePath, candidateBytes);

    const extra = path.join(destination, 'plugin/extra');
    writeFileSync(extra, 'unexpected');
    await assert.rejects(verifyEvaluationCandidate(destination), /inventory mismatch/);
    rmSync(extra);
    mkdirSync(extra);
    await assert.rejects(verifyEvaluationCandidate(destination), /inventory mismatch/);
    rmSync(extra, { recursive: true });
    if (process.platform !== 'win32') {
      chmodSync(file, 0o755);
      await assert.rejects(verifyEvaluationCandidate(destination), /inventory mismatch/);
      chmodSync(file, 0o644);
    }
    rmSync(file);
    await assert.rejects(verifyEvaluationCandidate(destination), /inventory mismatch/);
    writeFileSync(file, original);
    if (process.platform !== 'win32') {
      symlinkSync(file, extra);
      await assert.rejects(verifyEvaluationCandidate(destination), /symlink/);
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

// Missing runtime integrity fails before any final candidate is visible; private staging is cleaned.
test('failed projection leaves no final candidate and preserves unrelated siblings', async () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'evaluation-candidate-failure-'));
  const destination = path.join(temp, 'candidate');
  try {
    writeFileSync(path.join(temp, 'sentinel'), 'preserve');
    const script = path.resolve(import.meta.dirname, '../scripts/prepare-evaluation-candidate.mjs');
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { registerHooks } from 'node:module';
      import { pathToFileURL } from 'node:url';
      registerHooks({ load(url, context, nextLoad) {
        const result = nextLoad(url, context);
        if (url.endsWith('/scripts/production.mjs')) {
          return { ...result, source: String(result.source).replace(
            'function runtimeClosed(skill) {',
            "function runtimeClosed(skill) { throw Error('injected runtime verification failure');") };
        }
        return result;
      }});
      const { prepareEvaluationCandidate } = await import(pathToFileURL(process.argv[1]).href);
      await prepareEvaluationCandidate(process.argv[2]);
    `, script, destination], { encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')) });
    assert.equal(child.status, 1, child.stderr);
    assert.match(child.stderr, /injected runtime verification failure/);
    assert.ok(!existsSync(destination));
    assert.equal(readFileSync(path.join(temp, 'sentinel'), 'utf8'), 'preserve');
    assert.deepEqual(readdirSync(temp), ['sentinel']);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
