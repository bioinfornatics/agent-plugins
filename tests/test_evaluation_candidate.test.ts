import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, symlinkSync, chmodSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareEvaluationCandidate, verifyEvaluationCandidate } from '../scripts/prepare-evaluation-candidate.mjs';
import { projectProduction, verifyProduction } from '../scripts/production.mjs';
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
    const production = path.join(temp, 'production');
    projectProduction(production);
    const baseline = await new FilesystemEvaluationSource().load({ kind: 'skill', root: path.join(plugin, 'skills/agent-creator') });
    assert.ok(baseline.files.every(f => !f.path.includes('evaluation-fixtures')));
    for (const row of manifest.production.files) {
      assert.deepEqual(readFileSync(path.join(plugin, row.path)), readFileSync(path.join(production, row.path)), row.path);
    }
    writeFileSync(path.join(production, 'skills/agent-creator/evals.json'), '{}');
    assert.throws(() => verifyProduction(production), /inventory mismatch/);
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
    const file = path.join(destination, 'plugin/LICENSE');
    const original = readFileSync(file);
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
  const runtime = path.resolve(import.meta.dirname, '../skills/skill-creator/runtime/runtime-manifest.json');
  const original = readFileSync(runtime);
  try {
    writeFileSync(path.join(temp, 'sentinel'), 'preserve');
    writeFileSync(runtime, '{}');
    await assert.rejects(prepareEvaluationCandidate(destination), /invalid runtime manifest/);
    assert.ok(!existsSync(destination));
    assert.equal(readFileSync(path.join(temp, 'sentinel'), 'utf8'), 'preserve');
    assert.deepEqual(readdirSync(temp), ['sentinel']);
  } finally {
    writeFileSync(runtime, original);
    rmSync(temp, { recursive: true, force: true });
  }
});
