#!/usr/bin/env node
/** Editor contract checks; never launches a debugger, installs dependencies or calls a host. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'apps/agent-plugin');
const json = relative => JSON.parse(readFileSync(path.join(root, relative), 'utf8'));
const resolveFolder = (value, folder) => value.replaceAll('${workspaceFolder}', folder);

// Incorrect folder ownership can silently launch the wrong app in a multi-root workspace.
test('workspace keeps repository and CLI roots separate and only suppresses duplicated app search', () => {
  const workspace = json('agent-plugins.code-workspace');
  assert.deepEqual(workspace.folders, [
    { name: 'Repository', path: '.' },
    { name: 'Agent Plugin CLI', path: 'apps/agent-plugin' },
  ]);
  for (const folder of workspace.folders) assert.ok(existsSync(path.join(root, folder.path)));
  assert.equal(workspace.settings?.['search.exclude']?.['apps/agent-plugin/**'], undefined);
  assert.equal(json('.vscode/settings.json')['search.exclude']['apps/agent-plugin/**'], true);
  assert.equal(json('apps/agent-plugin/.vscode/settings.json')['search.exclude'], undefined);
  for (const relative of ['.vscode/settings.json', 'apps/agent-plugin/.vscode/settings.json']) {
    assert.equal(json(relative)['files.exclude'], undefined, 'app must stay visible in the explorer');
  }
});

// Test both full and focused checks: a narrow green check must not replace the failing broad gates.
test('process tasks use current commands without obsolete creators, installs or hidden automatic work', () => {
  for (const [folder, relative] of [[root, '.vscode/tasks.json'], [app, 'apps/agent-plugin/.vscode/tasks.json']]) {
    const tasks = json(relative);
    const scripts = JSON.parse(readFileSync(path.join(folder, 'package.json'), 'utf8')).scripts;
    const labels = new Set(tasks.tasks.map(task => task.label));
    assert.equal(labels.size, tasks.tasks.length);
    for (const task of tasks.tasks) {
      assert.equal(task.type, 'process');
      assert.equal(resolveFolder(task.options.cwd, folder), folder);
      assert.equal(task.runOptions?.runOn, undefined);
      assert.equal(task.dependsOn, undefined);
      assert.equal(task.command, folder === app ? 'bun' : 'node');
      if (task.command === 'node') assert.ok(existsSync(path.join(folder, task.args[0])), 'root script must exist');
      if (task.args[0] === 'run') assert.ok(Object.hasOwn(scripts, task.args[1]), `unknown script: ${task.args[1]}`);
      assert.doesNotMatch(JSON.stringify(task), /npm install|lint:fix|promote:|release|install:plugin|skills\/.*\/dist/);
    }
  }
  const tasks = json('apps/agent-plugin/.vscode/tasks.json').tasks;
  assert.ok(tasks.some(task => task.args.join(' ') === 'run test'));
  assert.ok(tasks.some(task => task.args.join(' ') === 'run typecheck'));
  assert.ok(tasks.some(task => task.args.join(' ') === 'test ./tests/scaffold ./tests/evaluation ./tests/execution'));
  assert.ok(tasks.some(task => task.args.join(' ') === 'run lint'));
  assert.ok(tasks.some(task => task.args.join(' ') === 'x --no-install tsc --noEmit --project tsconfig.json'));
});

// Bun-specific modules and import.meta.main require index.ts under Bun, not a Node launch.
test('debug profiles resolve Bun entrypoint and cannot launch a real campaign by default', () => {
  const launch = json('apps/agent-plugin/.vscode/launch.json');
  assert.equal(launch.version, '0.2.0');
  assert.equal(launch.configurations.length, 3);
  for (const configuration of launch.configurations) {
    assert.equal(configuration.type, 'bun');
    assert.equal(configuration.request, 'launch');
    assert.equal(configuration.runtime, 'bun');
    assert.equal(resolveFolder(configuration.program, app), path.join(app, 'src/index.ts'));
    assert.ok(existsSync(resolveFolder(configuration.program, app)));
    assert.equal(resolveFolder(configuration.cwd, app), app);
    assert.equal(configuration.stopOnEntry, true);
    assert.equal(configuration.preLaunchTask, undefined);
    assert.ok(configuration.args.includes('--help') || configuration.args.includes('--dry-run'));
  }
  assert.deepEqual(launch.configurations[0].args, ['--help']);
  assert.deepEqual(launch.configurations[1].args, ['evaluation', '--help']);
  assert.deepEqual(launch.configurations[2].args, ['evaluation', '--skills', '${input:skillPath}', '--dry-run']);
  assert.ok(launch.inputs.some(input => input.id === 'skillPath' && input.type === 'promptString'));
});

test('Biome uses app-local tooling while preserving lint-only policy and recommendations', () => {
  const settings = json('apps/agent-plugin/.vscode/settings.json');
  assert.equal(settings['biome.requireConfiguration'], true);
  // Biome extension 3.8.1 resolves a relative override against the folder URI;
  // unlike VS Code launch fields, it does not interpolate workspace variables.
  const binary = settings['biome.lsp.bin'];
  assert.equal(binary, 'node_modules/.bin/biome');
  assert.ok(!binary.includes('${'), 'Biome binary overrides must not use launch-variable syntax');
  assert.ok(existsSync(path.resolve(app, binary)), 'app-local Biome must exist before editor checks');
  assert.equal(settings['editor.formatOnSave'], false);
  assert.equal(settings['biome.lspBin'], undefined);
  const biome = json('apps/agent-plugin/biome.json');
  assert.equal(biome.formatter.enabled, false);
  assert.equal(biome.assist.enabled, false);
  const rootRecommendations = json('.vscode/extensions.json').recommendations;
  assert.ok(rootRecommendations.includes('planet57.vscode-beads'));
  assert.ok(rootRecommendations.includes('biomejs.biome'));
  assert.ok(json('apps/agent-plugin/.vscode/extensions.json').recommendations.includes('oven.bun-vscode'));
});

// Execute the configured program/arguments, not an echo mock. Inspector binding remains a separate live check.
test('configured help and dry-run invocations succeed without a host or provider', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'agent-plugin-vscode-'));
  try {
    mkdirSync(path.join(fixture, 'evals'));
    writeFileSync(path.join(fixture, 'SKILL.md'), '---\nname: vscode-fixture\ndescription: Local preparation fixture.\n---\nLocal fixture.\n');
    writeFileSync(path.join(fixture, 'evals/evals.json'), JSON.stringify({
      evals: [{ id: 1, prompt: 'Return a greeting.', expectations: ['A greeting.'] }],
    }));
    for (const configuration of json('apps/agent-plugin/.vscode/launch.json').configurations) {
      const args = configuration.args.map(value => value === '${input:skillPath}' ? fixture : value);
      const result = spawnSync(configuration.runtime, [resolveFolder(configuration.program, app), ...args], {
        cwd: resolveFolder(configuration.cwd, app), encoding: 'utf8', timeout: 15000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
      if (args.includes('--help')) assert.match(result.stdout, /Usage:/);
      else {
        const prepared = JSON.parse(result.stdout);
        assert.equal(prepared.status, 'prepared');
        assert.equal(prepared.candidateRuns, 6);
        assert.equal(prepared.targets.length, 1);
        assert.equal(prepared.targets[0].root, fixture);
      }
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
