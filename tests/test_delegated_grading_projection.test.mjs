import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
for (const runtime of ['skills/skill-creator/runtime', 'skills/plugin-creator/runtime/related/skill-creator']) {
  test(runtime + ': copied delegated CLI workflow and security regressions', () => {
    const stage = mkdtempSync(path.join(tmpdir(), 'delegated-projection-'));
    try {
      const copied = path.join(stage, 'runtime');
      cpSync(path.join(root, runtime), copied, { recursive: true });
      const tests = path.join(stage, 'tests');
      mkdirSync(tests);
      writeFileSync(path.join(stage, 'package.json'), '{"type":"module"}');
      // Reuse the independently specified application behavior tests at the
      // contained runtime seam; only fixture and module locations are changed.
      for (const name of ['test_delegated_grading_e2e.test.ts', 'test_batch_grading.test.ts']) {
        const source = readFileSync(path.join(root, 'apps/skill-creator-cli/tests', name), 'utf8')
          .replaceAll('../dist/scripts/', pathToFileURL(path.join(copied, 'dist/scripts')).href + '/')
          .replaceAll('resolve("dist/scripts/cli.js")', JSON.stringify(path.join(copied, 'dist/scripts/cli.js')))
          .replaceAll('resolve("tests/fixtures/fake-goose.mjs")', JSON.stringify(path.join(root, 'apps/skill-creator-cli/tests/fixtures/fake-goose.mjs')));
        writeFileSync(path.join(tests, name), source);
      }
      const env = { ...process.env };
      delete env.NODE_PATH;
      // A separate runner must not inherit the parent's node:test context,
      // which otherwise exits successfully without executing any files.
      delete env.NODE_TEST_CONTEXT;
      const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', ...['test_delegated_grading_e2e.test.ts', 'test_batch_grading.test.ts'].map(n => path.join(tests, n))], { cwd: stage, env, encoding: 'utf8', timeout: 60000 });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /# tests [1-9][0-9]*/, 'Child must report executed tests: ' + result.stdout + result.stderr);
      assert.match(result.stdout, /# fail 0\b/, result.stdout + result.stderr);
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  });
}
