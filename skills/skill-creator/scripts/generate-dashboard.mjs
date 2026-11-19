#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Multi-campaign dashboard over explicit verified exports (ap-r5dg). Each campaign stays a
// separate column; nothing is pooled, no latest/favourable selection, no models or database.
import { createHash } from 'node:crypto';
import { lstat, open, readFile, realpath, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildReportData, verifiedExport } from './generate-report.mjs';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const digest = value => createHash('sha256').update(value).digest('hex');
const within = (path, root) => path === root || path.startsWith(root + sep);
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value ?? null);

/** Configured identity only (product ap-h8f6): a missing map stays unknown, and two unknown
 * defaults never prove the same model. Effective backend identity is never claimed. */
function candidateIdentity(overview, agent) {
  const configured = overview.candidateModel.configured?.[agent];
  return configured && typeof configured.provider === 'string' && typeof configured.model === 'string'
    ? { known: true, provider: configured.provider, model: configured.model, source: configured.source }
    : { known: false, requested: overview.candidateModel.requested ?? null };
}
// An absent judge or host is unknown, never equal to another unknown (review ap-r5dg).
// A judge or host record without a version is equally unknown (review ap-r5dg round 2).
const judgeKey = judge => judge && judge.host?.version ? canonical({ packetVersion: judge.packetVersion ?? 1, host: judge.host, model: judge.model, limits: judge.limits, instructionsSha256: judge.instructionsSha256 ?? null }) : null;

/** One campaign column: criteria-weighted selected scores per (source, scenario, host) cell. */
export function campaignColumn(data, root) {
  const { overview, runs } = data;
  const cells = new Map();
  for (const trial of overview.trials) {
    const source = trial.source.pluginName ? `${trial.source.pluginName}:${trial.source.skillName}` : trial.source.skillName;
    const key = canonical([source, trial.scenarioId, trial.agent]);
    if (!cells.has(key)) cells.set(key, { key, source, scenarioId: trial.scenarioId, agent: trial.agent, prompt: null, judgeModelUnverified: false, fingerprints: new Set(), judges: new Set(), hosts: new Set(),
      conditions: { with: { passed: 0, total: 0, selected: 0, planned: 0, technical: 0, inconclusive: 0, missing: 0, activation: {} }, without: { passed: 0, total: 0, selected: 0, planned: 0, technical: 0, inconclusive: 0, missing: 0, activation: {} } }, trials: [] });
    const cell = cells.get(key), condition = cell.conditions[trial.condition];
    condition.planned++;
    const run = trial.selectedGradeId ? runs.find(item => item.provenance.gradeId === trial.selectedGradeId) : undefined;
    if (trial.score && run) {
      condition.selected++; condition.passed += trial.score.passed; condition.total += trial.score.total;
      cell.prompt ??= run.prompt;
      cell.fingerprints.add(digest(canonical([run.prompt, run.grading.expectations.map(e => e.text)])));
      const judge = trial.grades.find(g => g.id === trial.selectedGradeId)?.judge ?? null;
      if (judge && judge.model?.effective === 'unknown' && !judge.model?.requested) cell.judgeModelUnverified = true;
      cell.judges.add(judgeKey(judge));
      const host = run.provenance.receipt?.host;
      cell.hosts.add(host?.version ? canonical(host) : null);
      if (trial.activation) condition.activation[trial.activation.class] = (condition.activation[trial.activation.class] ?? 0) + 1;
    } else if (trial.grades.some(g => g.outcomeClass === 'technical-error')) condition.technical++;
    else if (trial.grades.some(g => g.outcomeClass === 'inconclusive')) condition.inconclusive++;
    else condition.missing++;
    // Exact evidence identity; the dashboard never derives a "latest" grade or attempt.
    cell.trials.push({ trialId: trial.trialId, condition: trial.condition, repetition: trial.repetition, attemptId: trial.attemptId,
      gradeId: trial.selectedGradeId, score: trial.score ? trial.score.passRate : null });
  }
  return { campaignId: overview.campaignId, root, profile: overview.profile,
    candidates: Object.fromEntries([...new Set(overview.trials.map(t => t.agent))].map(agent => [agent, candidateIdentity(overview, agent)])),
    cells: [...cells.values()].map(cell => ({ ...cell, fingerprints: [...cell.fingerprints], judges: [...cell.judges], hosts: [...cell.hosts],
      conditions: Object.fromEntries(Object.entries(cell.conditions).map(([name, c]) => [name, { ...c, score: c.total ? c.passed / c.total : null }])) })) };
}

/** Comparability contract (ap-r5dg plan): only the configured candidate model may differ.
 * Every other difference, an unknown identity or a missing decisive score yields reasons and no delta. */
export function compareCells(a, b, campaignA, campaignB) {
  const reasons = [];
  if (campaignA.profile.id !== campaignB.profile.id || campaignA.profile.revision !== campaignB.profile.revision) reasons.push('profile revision differs');
  if (a.fingerprints.length !== 1 || b.fingerprints.length !== 1) reasons.push('criteria unavailable or inconsistent within a campaign');
  else if (a.fingerprints[0] !== b.fingerprints[0]) reasons.push('prompt or criteria differ');
  if (a.judges.includes(null) || b.judges.includes(null)) reasons.push('judge configuration unknown');
  else if (a.judges.length !== 1 || b.judges.length !== 1 || a.judges[0] !== b.judges[0]) reasons.push('judge configuration differs or is mixed');
  if (a.hosts.includes(null) || b.hosts.includes(null) || a.hosts.length !== 1 || b.hosts.length !== 1 || a.hosts[0] !== b.hosts[0]) reasons.push('candidate host version differs or is unknown');
  const idA = campaignA.candidates[a.agent], idB = campaignB.candidates[b.agent];
  if (!idA?.known || !idB?.known) reasons.push('configured candidate identity unknown');
  else if (idA.provider === idB.provider && idA.model === idB.model) reasons.push('same configured model: replication shown side by side, not pooled');
  if (a.conditions.with.score === null || b.conditions.with.score === null) reasons.push('With-profile score unavailable');
  return reasons.length ? { comparable: false, reasons, delta: null }
    // Judges record only "configuration default, effective unknown" unless a model is requested:
    // equal judge configurations cannot prove the same judge model, so the delta is qualified, not refused.
    : { comparable: true, reasons: [], caveats: a.judgeModelUnverified || b.judgeModelUnverified ? ['judge model identity unverified (configured default)'] : [], delta: 100 * (b.conditions.with.score - a.conditions.with.score),
      coverage: { from: [a.conditions.with.selected, a.conditions.with.planned], to: [b.conditions.with.selected, b.conditions.with.planned] } };
}

export function buildDashboardData(columns) {
  assert(columns.length >= 2, 'At least two explicit campaign exports are required');
  assert(new Set(columns.map(c => c.campaignId)).size === columns.length, 'Duplicate campaign export');
  const keys = [...new Set(columns.flatMap(c => c.cells.map(cell => cell.key)))].sort();
  const rows = keys.map(key => {
    const cells = Object.fromEntries(columns.map(c => [c.campaignId, c.cells.find(cell => cell.key === key) ?? null]));
    const present = columns.filter(c => cells[c.campaignId]);
    const comparisons = [];
    for (let i = 0; i < present.length; i++) for (let j = i + 1; j < present.length; j++) {
      const [a, b] = [present[i], present[j]];
      comparisons.push({ from: a.campaignId, to: b.campaignId, ...compareCells(cells[a.campaignId], cells[b.campaignId], a, b) });
    }
    const first = present[0] && cells[present[0].campaignId];
    return { key, source: first.source, scenarioId: first.scenarioId, agent: first.agent,
      prompt: present.map(c => cells[c.campaignId].prompt).find(Boolean) ?? null, cells, comparisons };
  });
  return { schemaVersion: 1, campaigns: columns.map(({ cells: _cells, ...column }) => column), rows,
    limitations: ['Configured candidate identities only; effective backend models are unverified',
      'Each campaign is a separate column; no pooling of replications or models',
      'Deltas only when profile revision, prompt/criteria, host version and judge configuration are identical and both configured identities are known and distinct',
      'Unavailable scores (unselected, inconclusive, technical error) are never zero',
      'Judge or host provenance without a version is unknown and blocks deltas; a default-configured judge model is unverified and qualifies them'] };
}

/** Link only an existing sibling review.html rendered from this exact verified export: its embedded
 * export provenance must carry this manifest digest, and a managed ownership receipt, when present,
 * must match campaign and HTML bytes. A stale or foreign report is not linked. Local integrity only. */
async function boundReview(directory, campaignId, manifestSha256) {
  const review = join(directory, 'review.html');
  if (!await lstat(review).then(info => info.isFile(), () => false)) return null;
  const bytes = await readFile(review);
  if (!bytes.includes(`"manifest_sha256":"${manifestSha256}"`)) return null;
  const receipt = await readFile(join(directory, '.agent-plugin-html.json'), 'utf8').then(JSON.parse, error => error.code === 'ENOENT' ? undefined : null);
  if (receipt === null || (receipt !== undefined && (receipt.campaignId !== campaignId || receipt.htmlSha256 !== digest(bytes)))) return null;
  return pathToFileURL(review).href;
}

function fill(template, data) {
  assert(template.split('/*__DASHBOARD_DATA__*/').length === 2, 'Dashboard template placeholder missing or ambiguous');
  const serialized = JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return template.replace('/*__DASHBOARD_DATA__*/', () => serialized);
}

/** Readonly over inputs; explicit output must be new, outside every export and protected root. */
export async function generateDashboard({ workspaces, output }) {
  assert(Array.isArray(workspaces) && workspaces.length >= 2, 'At least two --workspace export roots are required');
  assert(typeof output === 'string' && output.trim(), '--output <new.html> is required: a dashboard has no owning campaign');
  const columns = [], protectedRoots = [];
  for (const workspace of workspaces) {
    const verified = await verifiedExport(resolve(workspace));
    const data = buildReportData(verified.manifest, verified.files, verified.manifestBytes);
    const manifestSha256 = digest(verified.manifestBytes);
    const review = await boundReview(dirname(verified.root), verified.manifest.campaignId, manifestSha256);
    columns.push({ ...campaignColumn(data, verified.root), review, exportManifestSha256: manifestSha256 });
    protectedRoots.push(verified.root, ...verified.manifest.runs.flatMap(run => run.protectedRoots || []));
  }
  const data = buildDashboardData(columns);
  let target = resolve(output);
  target = join(await realpath(dirname(target)), basename(target));
  for (const root of protectedRoots) {
    assert(typeof root === 'string', 'Dashboard output overlaps an export or protected evidence root');
    // The target parent is canonical; canonicalize roots too so a symlinked root still matches.
    const canonical = await realpath(root).catch(() => resolve(root));
    assert(!within(target, resolve(root)) && !within(target, canonical), 'Dashboard output overlaps an export or protected evidence root');
  }
  const html = fill(await readFile(new URL('../assets/dashboard-viewer.html', import.meta.url), 'utf8'), data);
  const handle = await open(target, 'wx', 0o600);
  try { await handle.writeFile(html); }
  catch (error) { await handle.close(); await unlink(target); throw error; }
  await handle.close();
  return { output: target, campaigns: columns.length, rows: data.rows.length, comparable: data.rows.flatMap(r => r.comparisons).filter(c => c.comparable).length };
}

function parseArguments(args) {
  const options = { workspaces: [] };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index], value = args[index + 1];
    assert(['--workspace', '--output'].includes(flag) && typeof value === 'string' && value.trim() && !value.startsWith('--'), 'Expected --workspace <exportdir> (repeat >=2) --output <new.html>');
    if (flag === '--workspace') options.workspaces.push(value);
    else { assert(options.output === undefined, 'Duplicate --output'); options.output = value; }
    index++;
  }
  return options;
}
async function main() {
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  assert(major > 22 || major === 22 && (minor > 22 || minor === 22 && patch >= 2), 'Node.js >=22.22.2 required');
  if (process.argv.slice(2).join(' ') === '--help') {
    console.log('Usage: node generate-dashboard.mjs --workspace <exportdir> --workspace <exportdir> [...] --output <new.html>\nReadonly verified exports; one column per campaign; deltas only for established comparability; no models, database or network.');
    return;
  }
  console.log(JSON.stringify(await generateDashboard(parseArguments(process.argv.slice(2)))));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(`Dashboard generation failed: ${error.message}`); process.exitCode = 1; });
}
