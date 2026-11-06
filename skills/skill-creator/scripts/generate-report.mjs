#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// This helper consumes the explicit export protocol, not a registry or guessed latest run.
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, open, unlink } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const jsonLimit = 16 * 1024 * 1024;
const totalLimit = 512 * 1024 * 1024;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const sha = /^[a-f0-9]{64}$/;
const textExtensions = new Set('.txt .md .json .jsonl .log .csv .py .js .mjs .ts .tsx .jsx .yaml .yml .xml .html .css .sh .rb .go .rs .java .c .cpp .h .hpp .sql .r .toml'.split(' '));
const imageTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const within = (path, root) => path === root || path.startsWith(root + sep);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
function parseJson(bytes, name) {
  assert(bytes.length <= jsonLimit, `JSON byte limit exceeded: ${name}`);
  try { return JSON.parse(decode(bytes)); } catch { throw new Error(`Invalid UTF-8 JSON: ${name}`); }
}
function safePath(path) {
  assert(typeof path === 'string' && path.length > 0 && !path.includes('\\') && !/[\x00-\x1f]/.test(path)
    && path.split('/').every(part => part && part !== '.' && part !== '..' && !part.includes(':')), 'Invalid export relative path');
  return path;
}
async function inventory(root, relative = '') {
  const files = [];
  for (const item of await readdir(join(root, relative), { withFileTypes: true })) {
    const path = relative ? `${relative}/${item.name}` : item.name;
    safePath(path);
    const info = await lstat(join(root, path));
    assert(!info.isSymbolicLink(), `Linked export entry: ${path}`);
    if (info.isDirectory()) files.push(...await inventory(root, path));
    else { assert(info.isFile() && info.nlink === 1, `Non-regular export entry: ${path}`); files.push(path); }
  }
  return files;
}
async function verifiedExport(workspace) {
  const root = await realpath(workspace);
  assert((await lstat(workspace)).isDirectory() && !(await lstat(workspace)).isSymbolicLink(), 'Workspace must be a plain export directory');
  const actual = await inventory(root);
  assert(!actual.includes('.export-pending'), 'Incomplete export: pending marker present');
  assert(actual.includes('export-manifest.json'), 'Missing export-manifest.json; pass the export root, not iteration-1');
  const manifestBytes = await readFile(join(root, 'export-manifest.json'));
  const manifest = parseJson(manifestBytes, 'export-manifest.json');
  assert(record(manifest) && manifest.schemaVersion === 1 && manifest.method === 'agent-plugin-explicit-quality-v1'
    && manifest.status === 'complete' && ['workspace', 'quality-only-benchmark'].includes(manifest.kind), 'Unsupported or incomplete export manifest');
  assert(uuid.test(manifest.campaignId) && Array.isArray(manifest.files) && Array.isArray(manifest.runs)
    && manifest.runs.length > 0 && manifest.runs.length <= 1000, 'Invalid export selection');
  assert(manifest.selection?.strategy === 'explicit-one-grade-per-logical-trial'
    && Array.isArray(manifest.selection.gradingIds) && manifest.selection.gradingIds.length === manifest.runs.length
    && manifest.selection.gradingIds.every(id => typeof id === 'string' && uuid.test(id))
    && new Set(manifest.selection.gradingIds).size === manifest.runs.length, 'Explicit unique grade selection required');
  const files = new Map();
  let total = manifestBytes.length;
  for (const entry of manifest.files) {
    assert(record(entry), 'Invalid export file entry');
    const name = safePath(entry.path);
    assert(name !== 'export-manifest.json' && !files.has(name) && Number.isSafeInteger(entry.bytes)
      && entry.bytes >= 0 && sha.test(entry.sha256), 'Invalid or duplicate export file binding');
    total += entry.bytes;
    assert(total <= totalLimit, 'Export total byte limit exceeded');
    const info = await lstat(join(root, name));
    assert(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size === entry.bytes, `Export size/type mismatch: ${name}`);
    const bytes = await readFile(join(root, name));
    assert(bytes.length === entry.bytes && digest(bytes) === entry.sha256, `Export hash mismatch: ${name}`);
    files.set(name, bytes);
  }
  assert(actual.length === files.size + 1 && actual.every(name => name === 'export-manifest.json' || files.has(name)), 'Unmanifested export files present');
  return { root, manifest, manifestBytes, files };
}
function embedFile(name, bytes) {
  const extension = extname(name).toLowerCase();
  if (textExtensions.has(extension)) {
    try { return { name, type: 'text', content: decode(bytes) }; } catch { /* Binary download preserves invalid UTF-8 bytes. */ }
  }
  const mime = imageTypes[extension] || (extension === '.pdf' ? 'application/pdf' : 'application/octet-stream');
  return { name, type: imageTypes[extension] ? 'image' : extension === '.pdf' ? 'pdf' : 'binary', mime,
    data_uri: `data:${mime};base64,${bytes.toString('base64')}` };
}
function buildReportData(manifest, files, manifestBytes, skillName) {
  const readJson = name => { assert(files.has(name), `Missing bound report input: ${name}`); return parseJson(files.get(name), name); };
  const seenRuns = new Set(), seenTrials = new Set(), seenGrades = new Set(), identities = new Map();
  const runs = manifest.runs.map(mapping => {
    assert(record(mapping) && ['with', 'without'].includes(mapping.condition) && Number.isSafeInteger(mapping.evalId)
      && mapping.evalId > 0 && Number.isSafeInteger(mapping.repetition) && mapping.repetition > 0
      && mapping.campaignId === manifest.campaignId && typeof mapping.trialId === 'string'
      && uuid.test(mapping.attemptId) && manifest.selection.gradingIds.includes(mapping.gradeId)
      && [mapping.manifestDigest, mapping.evidenceDigest, mapping.requestDigest].every(value => typeof value === 'string' && sha.test(value)), 'Invalid selected run binding');
    const configuration = mapping.condition === 'with' ? 'with_skill' : 'without_skill';
    const path = `iteration-1/eval-${mapping.evalId}/${configuration}/run-${mapping.repetition}`;
    assert(mapping.path === path && !seenRuns.has(path) && !seenTrials.has(mapping.trialId) && !seenGrades.has(mapping.gradeId), 'Ambiguous selected run identity');
    seenRuns.add(path); seenTrials.add(mapping.trialId); seenGrades.add(mapping.gradeId);
    // v6 pairs by eval ID/repetition. Refuse heterogeneous identities rather than
    // displaying unrelated profiles/agents as a comparison when no benchmark exists.
    assert(typeof mapping.profile?.revision === 'string' && typeof mapping.scenario?.id === 'string'
      && typeof mapping.agent === 'string', 'Missing comparison provenance');
    const identity = JSON.stringify([mapping.profile.revision, mapping.scenario.id, mapping.agent]);
    assert(!identities.has(mapping.evalId) || identities.get(mapping.evalId) === identity, 'Incompatible comparison identities');
    identities.set(mapping.evalId, identity);
    const metadata = readJson(`${path}/eval_metadata.json`);
    const scenarioMetadata = readJson(`iteration-1/eval-${mapping.evalId}/eval_metadata.json`);
    assert(metadata.eval_id === mapping.evalId && metadata.id === mapping.scenario.id && typeof metadata.prompt === 'string'
      && metadata.prompt.trim() && Array.isArray(metadata.expectations) && metadata.expectations.length > 0
      && metadata.expectations.every(text => typeof text === 'string')
      && JSON.stringify(metadata) === JSON.stringify(scenarioMetadata), 'Run/scenario metadata mismatch');
    const grading = readJson(`${path}/grading.json`);
    assert(record(grading) && Array.isArray(grading.expectations) && grading.expectations.length === metadata.expectations.length
      && grading.expectations.every((expectation, index) => record(expectation) && expectation.text === metadata.expectations[index]
        && typeof expectation.passed === 'boolean' && typeof expectation.evidence === 'string'), 'Invalid or mismatched decisive grading');
    const passed = grading.expectations.filter(expectation => expectation.passed).length;
    const total = grading.expectations.length;
    assert(grading.summary?.passed === passed && grading.summary.failed === total - passed && grading.summary.total === total
      && grading.summary.pass_rate === passed / total, 'Grading summary mismatch');
    const prefix = `${path}/outputs/`;
    const outputs = [...files].filter(([name]) => name.startsWith(prefix)).sort(([a], [b]) => {
      // Keep the approved initial transcript view; nested artifacts follow it.
      const rank = name => name === prefix + 'transcript.json' ? 0 : name === prefix + 'artifact-index.json' ? 1 : 2;
      return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
    }).map(([name, bytes]) => embedFile(name.slice(prefix.length), bytes));
    assert(outputs.length && (files.has(prefix + 'transcript.json') || files.has(prefix + 'artifact-index.json')), 'Missing exported transcript/artifact index');
    return { id: `eval-${mapping.evalId}-${configuration}-run-${mapping.repetition}`, prompt: metadata.prompt,
      eval_id: mapping.evalId, configuration, run_number: mapping.repetition, outputs, grading, provenance: mapping };
  });
  const benchmark = manifest.kind === 'quality-only-benchmark' ? readJson('iteration-1/benchmark.json') : null;
  if (benchmark) {
    assert(benchmark.metadata?.quality_only === true && Array.isArray(benchmark.runs) && benchmark.runs.length === runs.length, 'Invalid quality-only benchmark');
    for (const run of runs) {
      const rows = benchmark.runs.filter(row => row.eval_id === run.eval_id && row.configuration === run.configuration && row.run_number === run.run_number);
      assert(rows.length === 1 && JSON.stringify(rows[0].expectations) === JSON.stringify(run.grading.expectations)
        && JSON.stringify(rows[0].result) === JSON.stringify(run.grading.summary), 'Benchmark/run grading mismatch');
    }
  }
  return { skill_name: skillName || manifest.runs[0].profile?.name || 'Evaluation report', runs,
    previous_feedback: {}, previous_outputs: {}, benchmark,
    export_provenance: { campaign_id: manifest.campaignId, manifest_sha256: digest(manifestBytes), selection: manifest.selection,
      limitations: manifest.limitations, integrity: 'Local export hashes verified; not authenticated provider proof' } };
}

/** Generate from an explicit exported workspace only. Input files are never written;
 * output must be new and outside the workspace. All selected outputs are embedded,
 * including confidential logs; the operator must review disclosure before sharing.
 */
export async function generateReport({ workspace, output, skillName }) {
  const { root, manifest, manifestBytes, files } = await verifiedExport(resolve(workspace));
  output = resolve(output);
  const parent = await realpath(dirname(output));
  output = join(parent, basename(output));
  assert(!within(output, root), 'Report output must be outside the exported workspace');
  for (const protectedRoot of manifest.runs.flatMap(run => run.protectedRoots || [])) {
    assert(typeof protectedRoot === 'string' && !within(output, resolve(protectedRoot)), 'Report output overlaps protected source/evidence');
  }
  const data = buildReportData(manifest, files, manifestBytes, skillName);
  const template = await readFile(new URL('../assets/report-viewer.html', import.meta.url), 'utf8');
  const placeholder = '/*__REPORT_DATA__*/';
  assert(template.split(placeholder).length === 2, 'Report template placeholder missing or ambiguous');
  // Escape script delimiters, not user text; the viewer uses text nodes for JSON/chat.
  const serialized = JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const html = template.replace(placeholder, () => serialized);
  const handle = await open(output, 'wx', 0o600);
  try { await handle.writeFile(html); }
  catch (error) { await handle.close(); await unlink(output); throw error; }
  await handle.close();
  return { output, runs: data.runs.length, manifestSha256: digest(manifestBytes) };
}
function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = { '--workspace': 'workspace', '--output': 'output', '--skill-name': 'skillName' }[args[index]];
    assert(key && !Object.hasOwn(options, key) && typeof args[index + 1] === 'string' && !args[index + 1].startsWith('--') && args[index + 1].trim(), 'Expected unique --workspace <exportdir> --output <newhtml> [--skill-name <name>]');
    options[key] = args[++index];
  }
  assert(options.workspace && options.output, '--workspace and --output are required');
  return options;
}
async function main() {
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  assert(major > 22 || major === 22 && (minor > 22 || minor === 22 && patch >= 2), 'Node.js >=22.22.2 required');
  if (process.argv.slice(2).join(' ') === '--help') {
    console.log('Usage: node generate-report.mjs --workspace <exportdir> --output <newhtml> [--skill-name <name>]\nReadonly explicit export; new output outside workspace; no models, database, network or Python.');
    return;
  }
  console.log(JSON.stringify(await generateReport(parseArguments(process.argv.slice(2)))));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(`Report generation failed: ${error.message}`); process.exitCode = 1; });
}
