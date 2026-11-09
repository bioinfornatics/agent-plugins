#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// This helper consumes the explicit export protocol, not a registry or guessed latest run.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, readFile, readdir, realpath, open, unlink, mkdir, mkdtemp, rename, rmdir } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve, sep, parse } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

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
  const verified = { root, manifest, manifestBytes, files };
  // Only location-bound managed exports adopt the private, directory-exact
  // contract. Legacy external exports intentionally remain regular-file-exact.
  if (Object.hasOwn(manifest, 'reportLocation')) await authenticateManagedExport(verified, workspace);
  return verified;
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
// Only bounded provider/model identity fields enter reports, never provider settings.
function modelText(value) {
  return typeof value === 'string' && value.trim() && value.length <= 512 && !/[\x00-\x1f\x7f-\x9f]/.test(value);
}
function configuredModel(value) {
  return record(value) && Object.keys(value).sort().join(',') === 'model,provider,source'
    && ['override','configuration-default'].includes(value.source) && modelText(value.provider) && modelText(value.model);
}
function modelMap(value, source, requested) {
  assert(record(value) && Object.keys(value).length > 0 && Object.entries(value).every(([agent, model]) => modelText(agent)
    && configuredModel(model) && model.source === source && (requested === undefined || model.model === requested)), 'Invalid configured candidate models');
  return Object.entries(value).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([agent, model]) => [agent,model.source,model.provider,model.model]);
}
function modelEvidence(value, configured) {
  assert(record(value) && Object.keys(value).sort().join(',') === 'configured,observed' && configuredModel(value.configured)
    && JSON.stringify([value.configured.source,value.configured.provider,value.configured.model]) === JSON.stringify([configured?.source,configured?.provider,configured?.model])
    && (value.observed === null || record(value.observed) && Object.keys(value.observed).sort().join(',') === 'model,provider'
      && modelText(value.observed.provider) && modelText(value.observed.model)), 'Invalid candidate session model evidence');
  return [value.configured.source,value.configured.provider,value.configured.model,value.observed?.provider ?? null,value.observed?.model ?? null];
}
function validOverviewJudge(judge) {
  if (judge === null) return true;
  if (!record(judge) || judge.host?.id !== 'goose' || (judge.host.version !== undefined && typeof judge.host.version !== 'string')
    || judge.model?.effective !== 'unknown' || !['override','configuration-default'].includes(judge.model.source)
    || (judge.model.source === 'override' ? typeof judge.model.requested !== 'string' || !judge.model.requested.trim() : judge.model.requested !== undefined)
    || !record(judge.limits)) return false;
  for (const key of ['maxTurns','timeout','preflightTimeout','exportTimeout','outputBytes']) {
    if (!Number.isSafeInteger(judge.limits[key]) || judge.limits[key] < (['maxTurns','outputBytes'].includes(key) ? 1 : 0)) return false;
  }
  return judge.limits.timeout <= 2147483 && (judge.packetVersion === undefined || judge.packetVersion === 2)
    && (judge.instructionsSha256 === undefined || sha.test(judge.instructionsSha256))
    && (judge.evidenceManifestSha256 === undefined || judge.packetVersion === 2 && sha.test(judge.evidenceManifestSha256))
    && (judge.sessionName === undefined || typeof judge.sessionName === 'string' && judge.sessionName.length <= 1024)
    && (judge.instructionArtifact === undefined || record(judge.instructionArtifact) && judge.instructionArtifact.sha256 === judge.instructionsSha256);
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
    const source = mapping.scenario.source;
    const validName = name => typeof name === 'string' && name.trim() === name && name.length > 0 && !/[/\\:\x00-\x1f\x7f]/.test(name);
    assert(record(source) && validName(source.skillName) && (!Object.hasOwn(source, 'pluginName') || validName(source.pluginName)), 'Missing or invalid explicit scenario source; re-export retained grades');
    const identity = JSON.stringify([mapping.profile.revision, mapping.scenario.id, mapping.agent, source.skillName, source.pluginName ?? null]);
    assert(!identities.has(mapping.evalId) || identities.get(mapping.evalId) === identity, 'Incompatible comparison identities');
    identities.set(mapping.evalId, identity);
    const metadata = readJson(`${path}/eval_metadata.json`);
    const scenarioMetadata = readJson(`iteration-1/eval-${mapping.evalId}/eval_metadata.json`);
    assert(metadata.eval_id === mapping.evalId && metadata.id === mapping.scenario.id && typeof metadata.prompt === 'string'
      && metadata.prompt.trim() && Array.isArray(metadata.expectations) && metadata.expectations.length > 0
      && metadata.expectations.every(text => typeof text === 'string')
      && JSON.stringify(metadata.source) === JSON.stringify(source)
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
      source_label: source.pluginName ? `${source.pluginName}:${source.skillName}` : source.skillName,
      eval_id: mapping.evalId, configuration, run_number: mapping.repetition, outputs, grading, provenance: mapping };
  });
  assert(manifest.overview === 'overview.json', 'Required campaign overview missing; re-export retained grades');
  const overview = readJson('overview.json');
  assert(overview.schemaVersion === 1 && overview.campaignId === manifest.campaignId && record(overview.profile)
    && typeof overview.profile.id === 'string' && typeof overview.profile.revision === 'string'
    && ['override', 'configuration-default'].includes(overview.candidateModel?.source)
    && overview.candidateModel.effective === 'unknown'
    && (overview.candidateModel.source === 'override' ? typeof overview.candidateModel.requested === 'string' && overview.candidateModel.requested.trim() : overview.candidateModel.requested === undefined)
    && Array.isArray(overview.trials) && overview.trials.length > 0 && overview.trials.length <= 100000, 'Invalid campaign overview');
  const configured = overview.candidateModel.configured;
  const configuredBinding = configured === undefined ? null : modelMap(configured, overview.candidateModel.source, overview.candidateModel.requested);
  assert(configured === undefined || Object.keys(configured).every(agent => overview.trials.some(trial => trial.agent === agent)), 'Configured candidate host absent from frozen overview');
  const trialIds = new Set(), gradeIds = new Set(), selectedIds = new Set();
  const overviewName = name => typeof name === 'string' && name.length > 0 && name.trim() === name && !/[/\\:\x00-\x1f\x7f]/.test(name);
  for (const [sequence, trial] of overview.trials.entries()) {
    assert(record(trial) && trial.sequence === sequence && typeof trial.trialId === 'string' && !trialIds.has(trial.trialId)
      && typeof trial.scenarioId === 'string' && typeof trial.agent === 'string' && typeof trial.pairId === 'string'
      && Number.isSafeInteger(trial.repetition) && trial.repetition > 0 && ['with','without'].includes(trial.condition)
      && ['pending','running','uncertain','finalized'].includes(trial.status) && record(trial.source) && overviewName(trial.source.skillName)
      && (!Object.hasOwn(trial.source,'pluginName') || overviewName(trial.source.pluginName))
      && (trial.attemptId === null || uuid.test(trial.attemptId)) && (trial.attemptStatus === null || typeof trial.attemptStatus === 'string') && Array.isArray(trial.grades), 'Invalid overview trial');
    assert((trial.attemptStatus === null || ['running','completed','nonzero','timeout'].includes(trial.attemptStatus))
      && (trial.attemptId === null) === (trial.attemptStatus === null)
      && (trial.status !== 'pending' || trial.attemptId === null)
      && (trial.status !== 'running' || trial.attemptStatus === 'running')
      && (trial.status !== 'finalized' || ['completed','nonzero','timeout'].includes(trial.attemptStatus)), 'Contradictory overview lifecycle');
    trialIds.add(trial.trialId);
    for (const grade of trial.grades) {
      assert(uuid.test(grade.id) && !gradeIds.has(grade.id) && uuid.test(grade.attemptId)
        && ['completed','technical-error'].includes(grade.status) && ['decisive','inconclusive','technical-error'].includes(grade.outcomeClass)
        && validOverviewJudge(grade.judge)
        && (grade.status === 'technical-error') === (grade.outcomeClass === 'technical-error'), 'Invalid overview grade');
      gradeIds.add(grade.id);
    }
    if (trial.selectedGradeId === null) { assert(trial.score === null && trial.model === undefined, 'Unselected overview score/model forbidden'); continue; }
    const run = runs.find(run => run.provenance.gradeId === trial.selectedGradeId);
    const grade = trial.grades.find(grade => grade.id === trial.selectedGradeId);
    assert(run && grade?.outcomeClass === 'decisive' && grade.attemptId === trial.attemptId
      && run.provenance.trialId === trial.trialId && run.provenance.attemptId === trial.attemptId
      && run.provenance.scenario.id === trial.scenarioId && JSON.stringify(run.provenance.scenario.source) === JSON.stringify(trial.source)
      && run.provenance.profile.id === overview.profile.id && run.provenance.profile.name === overview.profile.name
      && run.provenance.profile.revision === overview.profile.revision && run.provenance.agent === trial.agent
      && JSON.stringify(run.provenance.judge ?? null) === JSON.stringify(grade.judge) && trial.status === 'finalized'
      && run.provenance.repetition === trial.repetition && run.provenance.condition === trial.condition
      && run.provenance.pairId === trial.pairId && run.provenance.options?.model === overview.candidateModel.requested
      && JSON.stringify({passed:run.grading.summary.passed,failed:run.grading.summary.failed,total:run.grading.summary.total,passRate:run.grading.summary.pass_rate}) === JSON.stringify(trial.score), 'Overview selected run/score mismatch');
    const runModels = run.provenance.options?.candidateModels;
    assert(JSON.stringify(runModels === undefined ? null : modelMap(runModels, overview.candidateModel.source, overview.candidateModel.requested)) === JSON.stringify(configuredBinding), 'Overview configured candidate model mismatch');
    const evidence = run.provenance.receipt?.model;
    if (configured?.[trial.agent] !== undefined) {
      assert(JSON.stringify(modelEvidence(trial.model, configured[trial.agent])) === JSON.stringify(modelEvidence(evidence, configured[trial.agent])), 'Overview session model mismatch');
    } else assert(trial.model === undefined && evidence === undefined, 'Unbound session model evidence');
    selectedIds.add(trial.selectedGradeId);
  }
  assert(selectedIds.size === runs.length, 'Overview selection incomplete');
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
    previous_feedback: {}, previous_outputs: {}, benchmark, overview,
    export_provenance: { campaign_id: manifest.campaignId, manifest_sha256: digest(manifestBytes), selection: manifest.selection,
      limitations: manifest.limitations, integrity: 'Local export hashes verified; not authenticated provider proof' } };
}

/** Generate from an explicit exported workspace only. Input files are never written;
 * explicit output must be new and outside the workspace; the managed default
 * may replace only receipt-bound derived HTML under the shared export lock. All selected outputs are embedded,
 * including confidential logs; the operator must review disclosure before sharing.
 */
// These mutable local digests detect asset drift, not publisher authentication.
// Libraries are embedded as data URLs: their exact JS bytes never enter the HTML
// script tokenizer (upstream regex/string literals legitimately contain <!--).
async function verifiedReportLibraries() {
  const root = new URL('../assets/report-libraries/', import.meta.url);
  async function plain(relative) {
    safePath(relative);
    const parts = relative.split('/');
    for (let i = 0; i <= parts.length; i++) {
      const url = i === 0 ? root : new URL(parts.slice(0, i).join('/'), root);
      const stat = await lstat(fileURLToPath(url).replace(/\/$/, ''));
      assert(!stat.isSymbolicLink() && (i < parts.length ? stat.isDirectory() : stat.isFile()), 'Linked/non-regular report library asset');
    }
    const bytes = await readFile(new URL(relative, root));
    assert(bytes.length <= jsonLimit, 'Report library asset too large');
    return bytes;
  }
  const manifest = parseJson(await plain('manifest.json'), 'report library manifest');
  const expected = {marked: ['marked.umd.js', 'licenses/marked-LICENSE'], dompurify: ['purify.min.js', 'licenses/dompurify-LICENSE']};
  assert(record(manifest) && manifest.schemaVersion === 1 && Array.isArray(manifest.libraries)
    && manifest.libraries.length === 2, 'Invalid report library manifest');
  const scripts = new Map(), notices = [];
  for (const entry of manifest.libraries) {
    assert(record(entry) && Object.hasOwn(expected, entry.name) && !scripts.has(entry.name)
      && entry.path === expected[entry.name][0] && entry.licensePath === expected[entry.name][1] && typeof entry.version === 'string'
      && /^\d+\.\d+\.\d+$/.test(entry.version), 'Invalid report library binding');
    const bytes = await plain(entry.path), license = await plain(entry.licensePath);
    assert(Number.isSafeInteger(entry.bytes) && bytes.length === entry.bytes
      && sha.test(entry.sha256) && digest(bytes) === entry.sha256
      && sha.test(entry.licenseSha256) && digest(license) === entry.licenseSha256, 'Report library integrity mismatch');
    scripts.set(entry.name, bytes.toString('base64'));
    notices.push(`${entry.name} ${entry.version}\n${decode(license)}`);
  }
  return {scripts, notices: notices.join("\n\n")};
}
function fillReportTemplate(template, replacements) {
  // Validate only the source template. Never rescan inserted transcript or label
  // text: users can legitimately quote any internal placeholder spelling.
  for (const placeholder of Object.keys(replacements)) {
    assert(template.split(placeholder).length === 2, 'Report template placeholder missing or ambiguous');
  }
  return template.replace(/\/\*__REPORT_DATA__\*\/|__REPORT_LIBRARY_(?:MARKED|DOMPURIFY|NOTICES)__/g,
    placeholder => replacements[placeholder]);
}

const missing = error => error?.code === 'ENOENT';
async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (missing(error)) return false; throw error; }
}
async function plainDirectory(path) {
  assert(resolve(path) === path, 'Noncanonical managed report path');
  let current = parse(path).root;
  const parts = path.slice(current.length).split(sep).filter(Boolean);
  const rootInfo = await lstat(current);
  assert(rootInfo.isDirectory() && !rootInfo.isSymbolicLink(), 'Linked/non-directory managed report path');
  for (const part of parts) {
    current = join(current, part);
    const info = await lstat(current);
    assert(info.isDirectory() && !info.isSymbolicLink(), 'Linked/non-directory managed report path');
  }
}
async function privateBytes(path, limit = totalLimit) {
  const before = await lstat(path);
  const safe = info => info.isFile() && !info.isSymbolicLink() && info.nlink === 1
    && (info.mode & 0o777) === 0o600 && (process.getuid === undefined || info.uid === process.getuid()) && info.size <= limit;
  assert(safe(before), 'Unsafe private managed report file');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    assert(safe(info) && info.dev === before.dev && info.ino === before.ino, 'Managed report file identity changed');
    const bytes = await handle.readFile(), after = await lstat(path);
    assert(after.dev === info.dev && after.ino === info.ino && safe(after) && bytes.length <= limit, 'Managed report file identity changed');
    return bytes;
  } finally { await handle.close(); }
}
// Authenticate ancestor directories as well as file bytes. Empty unmanifested
// directories must not disappear from the inventory; never chmod/repair inputs.
async function authenticateManagedExport({root, manifestBytes, files}, workspace) {
  await plainDirectory(workspace);
  const directories = new Set(['']);
  for (const name of files.keys()) {
    const parts = name.split('/'); parts.pop();
    while (parts.length) { directories.add(parts.join('/')); parts.pop(); }
  }
  const seen = new Set();
  async function walk(relative) {
    const path = join(root, relative), info = await lstat(path);
    if (info.isDirectory() && !info.isSymbolicLink()) {
      assert(directories.has(relative) && (info.mode & 0o777) === 0o700
        && (process.getuid === undefined || info.uid === process.getuid()), 'Unsafe managed export inventory directory');
      for (const name of await readdir(path)) {
        const child = relative ? `${relative}/${name}` : name;
        safePath(child); await walk(child);
      }
    } else {
      const expected = relative === 'export-manifest.json' ? manifestBytes : files.get(relative);
      assert(expected !== undefined, 'Unknown managed export inventory file');
      const bytes = await privateBytes(path, expected.length);
      assert(bytes.equals(expected), 'Managed export inventory bytes changed');
      seen.add(relative);
    }
  }
  await walk('');
  assert(seen.size === files.size + 1, 'Missing managed export inventory file');
}
const cleanupWarning = 'Report publication committed; cleanup residue requires operator inspection before regeneration.';
const warnCleanup = warnings => { if (!warnings.includes(cleanupWarning)) warnings.push(cleanupWarning); };
function exactObject(actual, expected) {
  return record(actual) && JSON.stringify(Object.entries(actual).sort()) === JSON.stringify(Object.entries(expected).sort());
}
async function managedLocation(verified) {
  const {root,manifest} = verified, location = manifest.reportLocation;
  assert(record(location) && typeof location.campaignDirectory === 'string', 'Invalid managed report location');
  const campaignDirectory = location.campaignDirectory, report = join(campaignDirectory, 'report');
  assert(exactObject(location, {version:1,campaignDirectory,exportDirectory:join(report,'export'),htmlFile:join(report,'review.html')})
    && root === location.exportDirectory, 'Invalid managed report location binding');
  await plainDirectory(campaignDirectory); await plainDirectory(report);
  const info = await lstat(report);
  assert((info.mode & 0o777) === 0o700 && (process.getuid === undefined || info.uid === process.getuid()), 'Unsafe managed report directory');
  // A location claim alone cannot exempt arbitrary protected ancestry. Every
  // selected run must bind this exact campaign; descendant evidence stays protected.
  assert(manifest.runs.every(run => Array.isArray(run.protectedRoots) && run.protectedRoots.includes(campaignDirectory)), 'Missing protected campaign binding');
  assert(exactObject(parseJson(await privateBytes(join(report,'.agent-plugin-report.json'),jsonLimit), 'report marker'),
    {version:1,campaignId:manifest.campaignId,campaignDirectory}), 'Invalid managed report marker');
  return {report, output:location.htmlFile, campaignDirectory, campaignId:manifest.campaignId};
}
async function managedInventory(context) {
  const {report,output,campaignId} = context, receiptPath = join(report,'.agent-plugin-html.json');
  const allowed = new Set(['export','review.html','.agent-plugin-report.json','.agent-plugin-report.lock','.agent-plugin-html.json']);
  assert((await readdir(report)).every(name => allowed.has(name)), 'Unknown managed report inventory path');
  const hadHtml = await exists(output), hadReceipt = await exists(receiptPath);
  assert(hadHtml === hadReceipt, 'Managed HTML requires matching ownership receipt');
  if (hadHtml) {
    const bytes = await privateBytes(output);
    assert(exactObject(parseJson(await privateBytes(receiptPath,jsonLimit),'HTML receipt'),
      {version:1,campaignId,htmlSha256:digest(bytes)}), 'Managed HTML ownership hash mismatch');
  }
  return {receiptPath, hadHtml};
}
// Two staged files and a shared export lock give ordinary-failure rollback, not
// crash atomicity or protection against a hostile same-user filesystem racer.
async function publishManagedHtml(context, html, warnings) {
  const {output,report,campaignId} = context;
  const initial = await managedInventory(context);
  const stage = await mkdtemp(join(report,'.agent-plugin-html-stage-'));
  const stageIdentity = await lstat(stage);
  const owned = new Map();
  const remember = async path => { const info = await lstat(path); owned.set(path,{dev:info.dev,ino:info.ino}); };
  const same = async path => { const identity = owned.get(path); if (!identity || !await exists(path)) return false;
    const info = await lstat(path); return !info.isSymbolicLink() && info.isFile() && info.dev === identity.dev && info.ino === identity.ino; };
  const move = async (from,to) => {
    const identity = owned.get(from) ?? await lstat(from);
    await rename(from,to); owned.delete(from); owned.set(to,{dev:identity.dev,ino:identity.ino});
  };
  const write = async (path,bytes) => {
    const handle = await open(path,'wx',0o600);
    try { await remember(path); await handle.writeFile(bytes); } finally { await handle.close(); }
  };
  const stagedHtml = join(stage,'new.html'), stagedReceipt = join(stage,'new.json');
  const oldHtml = join(stage,'old.html'), oldReceipt = join(stage,'old.json');
  let published = false;
  try {
    await write(stagedHtml,html);
    await write(stagedReceipt,JSON.stringify({version:1,campaignId,htmlSha256:digest(Buffer.from(html))})+'\n');
    // Recheck old bytes after rendering/staging before moving any prior report.
    // The scratch directory is ours, so inventory is checked before its creation.
    if (initial.hadHtml) {
      const bytes = await privateBytes(output);
      assert(exactObject(parseJson(await privateBytes(initial.receiptPath,jsonLimit),'HTML receipt'),
        {version:1,campaignId,htmlSha256:digest(bytes)}), 'Managed HTML ownership hash mismatch');
      await move(output,oldHtml); await move(initial.receiptPath,oldReceipt);
    }
    assert(!await exists(output) && !await exists(initial.receiptPath), 'Managed HTML destination appeared');
    await move(stagedHtml,output); await move(stagedReceipt,initial.receiptPath);
    // This is the commit boundary: both new files are now in place. Cleanup
    // failure must never roll back or report a failed publication after this.
    published = true;
  } catch (error) {
    for (const path of [output,initial.receiptPath]) if (await same(path)) { await unlink(path); owned.delete(path); }
    for (const [backup,destination] of [[oldHtml,output],[oldReceipt,initial.receiptPath]]) {
      if (await same(backup) && !await exists(destination)) { await move(backup,destination); owned.delete(destination); }
    }
    throw error;
  } finally {
    // Never recursively erase an unknown stage entry or changed file.
    for (const path of [...owned.keys()]) {
      if ([output,initial.receiptPath].includes(path) || !published && [oldHtml,oldReceipt].includes(path)) continue;
      try {
        if (path.startsWith(stage+sep) && await same(path)) await unlink(path);
        else warnCleanup(warnings);
      } catch { warnCleanup(warnings); }
    }
    try {
      const info = await lstat(stage);
      if (info.dev === stageIdentity.dev && info.ino === stageIdentity.ino && info.isDirectory() && !info.isSymbolicLink()) await rmdir(stage);
      else warnCleanup(warnings);
    } catch { warnCleanup(warnings); }
  }
}

export async function generateReport({ workspace, output, skillName }) {
  let verified = await verifiedExport(resolve(workspace));
  const managed = output === undefined && Object.hasOwn(verified.manifest,'reportLocation') ? await managedLocation(verified) : null;
  let lock, lockIdentity, result;
  const warnings = [];
  if (managed) {
    lock = join(managed.report,'.agent-plugin-report.lock');
    await mkdir(lock,{mode:0o700}); // Compatible with export; never take over stale locks.
    lockIdentity = await lstat(lock);
  }
  try {
    if (managed) {
      verified = await verifiedExport(resolve(workspace));
      await managedLocation(verified); await managedInventory(managed);
    }
    result = await renderReport(verified,output,skillName,managed,warnings);
  } finally {
    if (lock) {
      try {
        const info = await lstat(lock);
        if (info.dev === lockIdentity.dev && info.ino === lockIdentity.ino && info.isDirectory() && !info.isSymbolicLink()) await rmdir(lock);
        else warnCleanup(warnings);
      } catch { warnCleanup(warnings); }
    }
    // Preserve the original precommit error, without leaking cleanup errors.
    if (!result && warnings.length) console.warn('Report cleanup residue requires operator inspection; publication did not commit.');
  }
  return warnings.length ? {...result, warnings} : result;
}
async function renderReport(verified, output, skillName, managed, warnings) {
  const { root, manifest, manifestBytes, files } = verified;
  output = resolve(output ?? managed?.output ?? join(dirname(root),'review.html'));
  const parent = await realpath(dirname(output));
  output = join(parent, basename(output));
  assert(!within(output, root), 'Report output must be outside the exported workspace');
  for (const protectedRoot of manifest.runs.flatMap(run => run.protectedRoots || [])) {
    assert(typeof protectedRoot === 'string' && (managed && protectedRoot === managed.campaignDirectory || !within(output, resolve(protectedRoot))), 'Report output overlaps protected source/evidence');
  }
  const data = buildReportData(manifest, files, manifestBytes, skillName);
  const template = await readFile(new URL('../assets/report-viewer.html', import.meta.url), 'utf8');
  const libraries = await verifiedReportLibraries();
  // Escape script delimiters, not user text; the viewer uses text nodes for JSON/chat.
  const serialized = JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const html = fillReportTemplate(template, {
    '/*__REPORT_DATA__*/': serialized,
    '__REPORT_LIBRARY_MARKED__': libraries.scripts.get('marked'),
    '__REPORT_LIBRARY_DOMPURIFY__': libraries.scripts.get('dompurify'),
    '__REPORT_LIBRARY_NOTICES__': libraries.notices.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  });
  if (managed) { await managedLocation(verified); await publishManagedHtml(managed,html,warnings); }
  else {
    const handle = await open(output, 'wx', 0o600);
    try { await handle.writeFile(html); }
    catch (error) { await handle.close(); await unlink(output); throw error; }
    await handle.close();
  }
  return { output, runs: data.runs.length, manifestSha256: digest(manifestBytes) };
}
function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = { '--workspace': 'workspace', '--output': 'output', '--skill-name': 'skillName' }[args[index]];
    assert(key && !Object.hasOwn(options, key) && typeof args[index + 1] === 'string' && !args[index + 1].startsWith('--') && args[index + 1].trim(), 'Expected unique --workspace <exportdir> [--output <newhtml>] [--skill-name <name>]');
    options[key] = args[++index];
  }
  assert(options.workspace, '--workspace is required');
  return options;
}
async function main() {
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  assert(major > 22 || major === 22 && (minor > 22 || minor === 22 && patch >= 2), 'Node.js >=22.22.2 required');
  if (process.argv.slice(2).join(' ') === '--help') {
    console.log('Usage: node generate-report.mjs --workspace <exportdir> [--output <newhtml>] [--skill-name <name>]\nReadonly export; managed receipt-bound default or new sibling review.html; explicit output is always new; no models, database, network or Python.');
    return;
  }
  console.log(JSON.stringify(await generateReport(parseArguments(process.argv.slice(2)))));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(`Report generation failed: ${error.message}`); process.exitCode = 1; });
}
