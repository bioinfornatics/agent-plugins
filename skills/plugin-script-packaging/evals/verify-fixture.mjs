import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, readFileSync, writeFileSync, symlinkSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const evals = fileURLToPath(new URL('.', import.meta.url));
const source = join(evals, 'inputs/launcher');
function hashes(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => {
    const path = join(e.parentPath, e.name);
    return [path.slice(root.length), createHash('sha256').update(readFileSync(path)).digest('hex')];
  }).sort();
}
const before = hashes(source);
// All writable test state is below this Skill; no HOME, registry or installation access.
const scratch = mkdtempSync(join(evals, '.fixture-check-'));
let checks = 0;
try {
  const copy = join(scratch, 'isolated component');
  cpSync(source, copy, { recursive: true });
  const run = (...args) => {
    const env = { PATH: '', LANG: 'C.UTF-8' };
    return spawnSync(process.execPath, [join(copy, 'launch.mjs'), ...args], { cwd: scratch, env, encoding: 'utf8', timeout: 5000 });
  };
  const exact = (args, status, stdout, stderr) => {
    const result = run(...args);
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, status);
    assert.equal(result.stdout, stdout);
    assert.equal(result.stderr, stderr);
    checks++;
  };
  const args = ['space value', 'café', '; touch NEVER', '$(echo nope)', '', '--literal'];
  exact(['echo', ...args], 0, JSON.stringify(args) + '\n', '');
  exact(['fail'], 7, '', 'fixture failure\n');
  exact(['missing-operation'], 2, '', 'unknown operation\n');
  const manifestPath = join(copy, 'artifact.json');
  const original = JSON.parse(readFileSync(manifestPath, 'utf8'));
  // Independent hardcoded outcomes exercise the actual launcher, not a copied path algorithm.
  for (const entry of ['../outside.mjs', resolve(scratch, 'outside.mjs'), 'payload/missing.mjs']) {
    writeFileSync(manifestPath, JSON.stringify({ ...original, entry }));
    exact(['echo', 'must not run'], 1, '', 'fixture refused\n');
  }
  writeFileSync(manifestPath, JSON.stringify({ ...original, sha256: '0'.repeat(64) }));
  exact(['echo'], 1, '', 'fixture refused\n');
  const outside = join(scratch, 'outside.mjs');
  writeFileSync(outside, "console.log('escaped payload ran');\n");
  symlinkSync(outside, join(copy, 'payload/link.mjs'));
  writeFileSync(manifestPath, JSON.stringify({ ...original, entry: 'payload/link.mjs', sha256: createHash('sha256').update(readFileSync(outside)).digest('hex') }));
  exact(['echo'], 1, '', 'fixture refused\n');
  rmSync(join(copy, 'payload/link.mjs'));
  symlinkSync(join(copy, 'payload'), join(copy, 'linked-parent'));
  writeFileSync(manifestPath, JSON.stringify({ ...original, entry: 'linked-parent/command.mjs' }));
  exact(['echo'], 1, '', 'fixture refused\n');
  assert.deepEqual(hashes(source), before);
  console.log(JSON.stringify({ checks, retainedInputHashesUnchanged: true, runtime: process.version, mode: 'interpreted-js', native: 'not-tested', host: 'not-tested', signals: 'not-tested' }));
} finally { rmSync(scratch, { recursive: true, force: true }); }
