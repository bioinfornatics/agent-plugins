#!/usr/bin/env node
/** Repository-owned projection for evaluation. No build, publication or model calls. */
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectProduction } from './production.mjs';
import { FilesystemEvaluationSource } from '../apps/agent-plugin/src/adapters/outbound/filesystem/filesystem-evaluation-source.ts';
import { captureDeclaredInputs } from '../apps/agent-plugin/src/adapters/outbound/filesystem/declared-input-snapshot.ts';

const source = path.resolve(import.meta.dirname, '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);

function safeDirectoryAncestors(directory) {
  let current = path.parse(directory).root;
  for (const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) throw Error('symlink destination ancestor: ' + current);
    if (stat && !stat.isDirectory()) throw Error('expected directory ancestor: ' + current);
  }
}

function destinationPath(destination) {
  destination = path.resolve(destination);
  if (inside(source, destination) || inside(destination, source) && !inside(destination, path.join(source, '.artifacts'))) {
    throw Error('protected source destination; use a new directory under .artifacts or outside the repository');
  }
  safeDirectoryAncestors(path.dirname(destination));
  if (lstatSync(destination, { throwIfNoEntry: false })) throw Error('candidate destination must be new');
  return destination;
}

/** Include directory membership as well as bytes/modes, so empty additions also invalidate integrity. */
function inventory(root, relative = '') {
  const rows = [];
  for (const name of readdirSync(path.join(root, relative)).sort()) {
    const member = relative ? relative + '/' + name : name;
    const stat = lstatSync(path.join(root, member));
    if (stat.isSymbolicLink()) throw Error('candidate symlink forbidden: ' + member);
    if (stat.isDirectory()) {
      rows.push({ path: member, type: 'directory' });
      rows.push(...inventory(root, member));
    } else if (stat.isFile()) {
      rows.push({ path: member, type: 'file', mode: stat.mode & 0o111 ? 755 : 644, size: stat.size, sha256: hash(readFileSync(path.join(root, member))) });
    } else throw Error('candidate special file forbidden: ' + member);
  }
  return rows;
}

function writeCaptured(root, relative, bytes, executable) {
  const destination = path.join(root, relative);
  // Evaluation overlays may never replace a distributed file or escape the evals boundary.
  if (!relative.startsWith('evals/') || relative.split('/').some(p => !p || p === '.' || p === '..') || relative.includes('\\')) throw Error('evaluation resource must be under evals: ' + relative);
  if (existsSync(destination)) {
    if (!lstatSync(destination).isFile() || !readFileSync(destination).equals(bytes) || Boolean(lstatSync(destination).mode & 0o111) !== executable) throw Error('conflicting evaluation resource: ' + relative);
    return;
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, bytes, { flag: 'wx' });
  chmodSync(destination, executable ? 0o755 : 0o644);
}

async function addSuites(plugin) {
  for (const name of readdirSync(path.join(plugin, 'skills')).sort()) {
    const skill = path.join(source, 'skills', name);
    // The bounded reader validates parents/links before copying; no arbitrary eval directory copy.
    const suiteInput = await captureDeclaredInputs(skill, ['evals/evals.json'], { bytes: 0, entries: 0 });
    const suiteBytes = Buffer.from(suiteInput.files[0].content, 'base64');
    const suite = JSON.parse(suiteBytes.toString('utf8'));
    if (!Array.isArray(suite.evals) || !suite.evals.length) throw Error('missing evaluation scenarios: ' + name);
    const declarations = [];
    for (const scenario of suite.evals) {
      // This repository uses the generic files contract. Legacy/external fixtures need explicit migration.
      if (scenario.fixtures !== undefined || !Array.isArray(scenario.files)) throw Error('candidate suites require explicit files declarations: ' + name);
      declarations.push(...scenario.files);
    }
    const inputs = await captureDeclaredInputs(skill, declarations, { bytes: 0, entries: 0 });
    const target = path.join(plugin, 'skills', name);
    writeCaptured(target, 'evals/evals.json', suiteBytes, suiteInput.files[0].executable);
    for (const file of inputs.files) writeCaptured(target, file.path, Buffer.from(file.content, 'base64'), file.executable);
    // Preserve declared empty directories too: discovery must work from the candidate alone.
    for (const declaration of declarations) {
      if (!declaration.startsWith('evals/')) throw Error('evaluation resource must be under evals: ' + declaration);
      if (lstatSync(path.join(skill, declaration)).isDirectory()) mkdirSync(path.join(target, declaration), { recursive: true });
    }
  }
}

/** New output envelope contains plugin/ and a sibling integrity record, never a production claim. */
export async function prepareEvaluationCandidate(destination) {
  destination = destinationPath(destination);
  mkdirSync(path.dirname(destination), { recursive: true });
  const staging = mkdtempSync(path.join(path.dirname(destination), '.evaluation-candidate-'));
  const bundle = path.join(staging, 'bundle');
  try {
    mkdirSync(bundle);
    const plugin = path.join(bundle, 'plugin');
    const production = projectProduction(plugin);
    // The production inventory is now a baseline, not a valid manifest for an enriched tree.
    rmSync(path.join(plugin, 'distribution-manifest.json'));
    await addSuites(plugin);
    const prepared = await new FilesystemEvaluationSource().load({ kind: 'plugin', root: plugin });
    const entries = inventory(plugin);
    const manifest = {
      schemaVersion: 1, kind: 'local-evaluation-candidate',
      sourceCommit: production.sourceCommit, sourceTree: production.sourceTree,
      production, entries, inventorySha256: hash(JSON.stringify(entries)),
      fingerprint: prepared.fingerprint,
      scenarios: prepared.scenarios.map(s => s.id),
      snapshotBytes: prepared.files.reduce((sum, file) => sum + Buffer.from(file.content, 'base64').length, 0),
    };
    writeFileSync(path.join(bundle, 'candidate-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    await verifyEvaluationCandidate(bundle);
    // This protects ordinary operator mistakes, not concurrent hostile destination races.
    if (lstatSync(destination, { throwIfNoEntry: false })) throw Error('candidate destination must be new');
    renameSync(bundle, destination);
    return manifest;
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

/** Checks the copied envelope without consulting the original source checkout. Not a signature/approval. */
export async function verifyEvaluationCandidate(destination) {
  destination = path.resolve(destination);
  safeDirectoryAncestors(destination);
  if (readdirSync(destination).sort().join() !== 'candidate-manifest.json,plugin') throw Error('unexpected candidate envelope');
  const manifestPath = path.join(destination, 'candidate-manifest.json');
  if (!lstatSync(manifestPath).isFile()) throw Error('candidate manifest must be a regular file');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.kind !== 'local-evaluation-candidate' || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit) || !/^[a-f0-9]{40}$/.test(manifest.sourceTree)) throw Error('invalid candidate manifest');
  const plugin = path.join(destination, 'plugin');
  safeDirectoryAncestors(plugin);
  const entries = inventory(plugin);
  if (JSON.stringify(entries) !== JSON.stringify(manifest.entries) || hash(JSON.stringify(entries)) !== manifest.inventorySha256) throw Error('candidate inventory mismatch');
  const production = manifest.production;
  if (production?.sourceCommit !== manifest.sourceCommit || production.sourceTree !== manifest.sourceTree || hash(JSON.stringify(production.files)) !== production.inventorySha256) throw Error('invalid production baseline');
  const distributed = entries.filter(row => row.type === 'file' && !row.path.split('/').includes('evals'));
  const baseline = production.files;
  if (distributed.length !== baseline.length || distributed.some(row => !baseline.some(file => file.path === row.path && file.mode === row.mode && file.size === row.size && file.sha256 === row.sha256))) throw Error('candidate treatment differs from production baseline');
  const prepared = await new FilesystemEvaluationSource().load({ kind: 'plugin', root: plugin });
  if (prepared.fingerprint !== manifest.fingerprint || JSON.stringify(prepared.scenarios.map(s => s.id)) !== JSON.stringify(manifest.scenarios) || prepared.files.reduce((sum, file) => sum + Buffer.from(file.content, 'base64').length, 0) !== manifest.snapshotBytes) throw Error('candidate preparation mismatch');
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, destination, ...extra] = process.argv.slice(2);
    if (!destination || extra.length || !['prepare', 'verify'].includes(mode)) throw Error('usage: prepare-evaluation-candidate.mjs prepare|verify <directory>');
    const manifest = await (mode === 'prepare' ? prepareEvaluationCandidate(destination) : verifyEvaluationCandidate(destination));
    console.log(JSON.stringify({ status: 'passed', mode, plugin: path.join(path.resolve(destination), 'plugin'), scenarios: manifest.scenarios.length, snapshotBytes: manifest.snapshotBytes, inventorySha256: manifest.inventorySha256 }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
