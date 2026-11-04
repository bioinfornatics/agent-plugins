#!/usr/bin/env node
/** Reconstruct the declared source offline. This is not a sandbox or publication gate. */
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const buildOnly = process.argv[2] === '--build-only';
if (process.argv.length > 3 || process.argv[2] && !buildOnly) throw new Error('usage: test-clean-source-reproducibility.mjs [--build-only]');
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(source, 'config/reproducibility/source-manifest.json'), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const normalize = value => value.split(path.sep).join('/');
const canonical = value => typeof value === 'string' && !path.isAbsolute(value) && !value.includes('\\') && !value.includes(':') && value.split('/').every(part => part && part !== '.' && part !== '..');
const required = manifest.requiredFiles;
if (manifest.schemaVersion !== 1 || !Array.isArray(required) || new Set(required).size !== required.length) throw new Error('invalid or duplicate source manifest entries');
for (const relative of required) {
  if (!canonical(relative) || relative.startsWith('.git/') || relative.startsWith('.beads/') ||
      /^(?:node_modules\/|apps\/[^/]+\/(?:dist|node_modules)\/|skills\/[^/]+\/runtime\/)/.test(relative)) {
    throw new Error('source manifest admits unsafe or mutable generated input: ' + relative);
  }
}
// Capture only explicitly authorized inputs, not arbitrary operator workspace files.
// Checking each ancestor prevents a regular leaf inside a symlink from escaping source.
function sourceRow(relative) {
  let absolute = source;
  for (const part of relative.split('/')) {
    absolute = path.join(absolute, part);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error('source symlink forbidden: ' + relative);
  }
  const stat = lstatSync(absolute);
  if (!stat.isFile()) throw new Error('manifest entry is not a regular file: ' + relative);
  return { path: relative, sha256: digest(readFileSync(absolute)), mode: stat.mode & 0o777 };
}
const initialSource = required.map(sourceRow);
const work = mkdtempSync(path.join(tmpdir(), 'agent-plugins-clean-source-'));
const clean = path.join(work, 'source'), app = path.join(clean, 'apps/agent-plugin');
const home = path.join(work, 'home'), emptyCache = path.join(work, 'npm-cache');
// No inherited credentials, Git settings, Node loaders, nested test context, or
// provider configuration. HOME alone would not isolate XDG/Goose installations.
const env = {
  PATH: process.env.PATH ?? '', HOME: home, LANG: 'C', LC_ALL: 'C', TZ: 'UTC', SOURCE_DATE_EPOCH: '0',
  XDG_CONFIG_HOME: path.join(work, 'config'), XDG_DATA_HOME: path.join(work, 'data'),
  XDG_STATE_HOME: path.join(work, 'state'), XDG_CACHE_HOME: path.join(work, 'cache'),
  XDG_RUNTIME_DIR: path.join(work, 'run'), GOOSE_PATH_ROOT: path.join(work, 'goose'), TMPDIR: path.join(work, 'tmp'),
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(work, 'empty-gitconfig'), GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: path.join(work, 'empty-hooks'),
  GIT_AUTHOR_NAME: 'Clean Reproduction', GIT_AUTHOR_EMAIL: 'clean-reproduction@example.invalid',
  GIT_COMMITTER_NAME: 'Clean Reproduction', GIT_COMMITTER_EMAIL: 'clean-reproduction@example.invalid',
  npm_config_cache: emptyCache, npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false',
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
};
let host;
function run(command, args, { cwd = clean, capture = false } = {}) {
  const result = spawnSync(command, args, { cwd, env, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' });
  if (result.error || result.signal || result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.error?.message ?? result.signal ?? `exit ${result.status}`}\n${result.stderr ?? ''}`);
  return result.stdout;
}
function copyDeclared(relative) {
  const from = path.join(source, relative), to = path.join(clean, relative);
  sourceRow(relative);
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(from, to); chmodSync(to, lstatSync(from).mode & 0o777);
}
function inventory(directory) {
  const rows = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const absolute = path.join(dir, entry.name), stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error('inventory symlink forbidden: ' + absolute);
      if (stat.isDirectory()) walk(absolute);
      else if (stat.isFile()) rows.push({ path: normalize(path.relative(directory, absolute)), sha256: digest(readFileSync(absolute)), mode: stat.mode & 0o777 });
      else throw new Error('inventory special file forbidden: ' + absolute);
    }
  }
  walk(directory); return rows.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
const snapshotRoots = ['apps/agent-plugin/dist', 'skills/skill-creator/runtime', 'skills/skill-creator/scripts'];
function snapshot() {
  return snapshotRoots.flatMap(relative => inventory(path.join(clean, relative)).map(row => ({ ...row, path: relative + '/' + row.path })));
}
function buildAndGenerate() {
  const staleCanary = path.join(app, 'dist/__stale_dist_canary__.js');
  mkdirSync(path.dirname(staleCanary), { recursive: true });
  writeFileSync(staleCanary, "throw new Error('stale dist survived');\n");
  run(process.execPath, ['scripts/build.mjs'], { cwd: app });
  if (existsSync(staleCanary)) throw new Error('current app build retained stale dist canary');
  run(process.execPath, ['scripts/generate-skill-runtimes.mjs']);
}
try {
  for (const directory of [clean, home, emptyCache, env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_STATE_HOME,
    env.XDG_CACHE_HOME, env.XDG_RUNTIME_DIR, env.GOOSE_PATH_ROOT, env.TMPDIR, env.GIT_CONFIG_VALUE_0]) mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(env.GIT_CONFIG_GLOBAL, '');
  // An explicit external host is permitted only in full mode, with no model calls.
  // Resolve before changing cwd; never replace a supplied binary with PATH discovery.
  if (!buildOnly) {
    const selected = process.env.GOOSE_TEST_BINARY || process.env.GOOSE_EXECUTABLE;
    if (process.env.GOOSE_TEST_BINARY && process.env.GOOSE_EXECUTABLE && path.resolve(process.env.GOOSE_TEST_BINARY) !== path.resolve(process.env.GOOSE_EXECUTABLE)) throw new Error('conflicting explicit Goose executables');
    if (selected) {
      host = path.resolve(selected);
      env.GOOSE_TEST_BINARY = host; env.GOOSE_EXECUTABLE = host;
    }
  }
  for(const relative of required)copyDeclared(relative);
  const copied = inventory(clean);
  const expected = [...initialSource].sort((a, b) => a.path.localeCompare(b.path, 'en'));
  if (JSON.stringify(copied) !== JSON.stringify(expected)) throw new Error('manifest projection bytes or modes differ from source');
  if (existsSync(path.join(app, 'dist')) || existsSync(path.join(app, 'node_modules')) || existsSync(path.join(clean, 'node_modules'))) throw new Error('mutable workspace output entered reconstruction');
  // Git metadata and hooks are private and created only after explicit copying;
  // neither the operator index nor ignored/untracked files select source inputs.
  run('git', ['init', '-q']);
  run('git', ['add', '-A']); run('git', ['commit', '-qm', 'manifest source']);
  run(process.execPath, ['scripts/validate-change-set-inventory.mjs', '--clean-projection']);
  // Prove unknown files are rejected in this private tree, never write a root canary.
  const canary = path.join(clean, '__undeclared_reconstruction_canary__.txt');
  writeFileSync(canary, 'must not be admitted\n');
  try {
    const rejected = spawnSync(process.execPath, ['scripts/validate-change-set-inventory.mjs', '--clean-projection'], { cwd: clean, env, encoding: 'utf8' });
    if (rejected.error || rejected.signal || rejected.status === 0 || !/undeclared source files:[^\n]*__undeclared_reconstruction_canary__/.test(rejected.stderr ?? '')) throw new Error('inventory did not reject private undeclared canary');
  } finally { rmSync(canary, { force: true }); }
  // The declared preparer authenticates pinned tarball hashes/package locks before
  // extraction, including TypeScript. Never copy installed workspace dependencies.
  const declaredTarballs = required.filter(relative => relative.startsWith('vendor/agent-plugin-tarballs/') && relative.endsWith('.tgz'));
  if (declaredTarballs.length !== 9 || !required.includes('vendor/agent-plugin-tarballs/manifest.json')) throw new Error('source manifest must declare nine pinned agent-plugin tarballs and their authentication manifest');
  run(process.execPath, ['scripts/prepare-development.mjs']);
  if (!existsSync(path.join(app, 'node_modules/typescript/bin/tsc'))) throw new Error('offline preparation did not supply current app TypeScript');
  buildAndGenerate(); const first = snapshot();
  buildAndGenerate(); const second = snapshot();
  if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('app dist, runtime and launcher rebuild is not byte-stable');
  run(process.execPath, ['scripts/validate-change-set-inventory.mjs', '--clean-projection']);
  // The clean test runner compares committed runtime drift; checkpoint only this
  // temporary tree, never the source repository's index, identity or hooks.
  run('git', ['add', '-A']); run('git', ['commit', '-qm', 'reconstructed outputs']);
  run(process.execPath, ['scripts/check-skill-runtime-dist-drift.mjs']);
  run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], { cwd: app });
  run(process.execPath, ['node_modules/typescript/bin/tsc', '--project', 'tsconfig.test.json', '--noEmit'], { cwd: app });
  const candidate = path.join(work, 'production');
  run(process.execPath, ['scripts/production.mjs', 'project', candidate]);
  run(process.execPath, ['scripts/production.mjs', 'verify', candidate]);
  run(process.execPath, ['scripts/production.mjs', 'smoke', candidate]);
  if (!buildOnly) run(process.execPath, ['scripts/test.mjs'], { cwd: app });
  if (!buildOnly && host) {
    // Closed root remainder contains production, CI, cleanup and host contracts;
    // app tests already ran via their authoritative test script above.
    run(process.execPath, ['scripts/test.mjs', '--profile=production', '--ci-skill-shards']);
    run(process.execPath, ['scripts/test-production-install.mjs', candidate]);
  } else {
    run(process.execPath, ['--test', 'tests/test_production.test.ts', 'tests/test_ci_verification.test.ts', 'tests/test_production_install_contract.test.ts']);
  }
  if (JSON.stringify(required.map(sourceRow)) !== JSON.stringify(initialSource)) throw new Error('root source inputs changed during clean reconstruction');
  console.log(JSON.stringify({ status: 'passed', scope: buildOnly ? 'isolated-build-and-projection' : 'full', sourceFiles: required.length,
    deterministicFiles: second.length, npmCacheEntries: inventory(emptyCache).length, appDistSourceFiles: 0,
    staleDistCanariesRemoved: 2, arbitraryUntrackedExcluded: true, rootSourceUnchanged: true,
    hostTestsRun: Boolean(host) && !buildOnly, hostTestsSkippedReason: buildOnly ? 'build-only' : host ? null : 'no explicitly supplied host', nativeTestsRun: false }));
} finally {
  try {
    if (JSON.stringify(required.map(sourceRow)) !== JSON.stringify(initialSource)) throw new Error('root source inputs changed during clean reconstruction (including concurrent edits)');
  } finally{rmSync(work, { recursive: true, force: true });}
}
