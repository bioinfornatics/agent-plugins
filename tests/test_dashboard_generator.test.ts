import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const source = resolve(import.meta.dirname, '../skills/skill-creator');
const script = join(source, 'scripts/generate-dashboard.mjs');
const hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
const judgeA = { host: { id: 'goose', version: '1.57.0' }, model: { source: 'configuration-default', effective: 'unknown' }, limits: { maxTurns: 20, timeout: 600, preflightTimeout: 10, exportTimeout: 10, outputBytes: 1024 } };

interface Campaign { id: string; model?: string; revision?: string; expectations?: string[]; prompt?: string;
  /** null: no judge provenance / no candidate receipt (unknown, never equal to another unknown). */
  judge?: typeof judgeA | null; host?: string | null;
  /** Per condition: passed criteria count, or 'inconclusive' / 'technical' for unselected trials. */
  outcomes?: { with: number | 'inconclusive' | 'technical'; without: number | 'inconclusive' | 'technical' } }

/** Minimal verified export accepted by generate-report.mjs buildReportData (one scenario, one repetition). */
async function exportFor(base: string, c: Campaign) {
  const workspace = join(base, c.id, 'export'); await mkdir(workspace, { recursive: true });
  const files: { path: string; bytes: number; sha256: string }[] = [];
  const add = async (path: string, content: string) => { await mkdir(join(workspace, path, '..'), { recursive: true }); await writeFile(join(workspace, path), content); files.push({ path, bytes: Buffer.byteLength(content), sha256: hash(content) }); };
  const expectations = c.expectations ?? ['First criterion', 'Second criterion'];
  const sourceIdentity = { skillName: 'notes' };
  const metadata = { eval_id: 1, id: 'notes/scenario-1', prompt: c.prompt ?? 'Summarise the notes.', expectations, source: sourceIdentity };
  await add('iteration-1/eval-1/eval_metadata.json', JSON.stringify(metadata));
  const configured = c.model ? { source: 'configuration-default', provider: 'provider', model: c.model } : undefined;
  const profile = { id: 'profile', name: 'Notes profile', revision: c.revision ?? 'revision-1' };
  const runs = [], trials = [], selected: string[] = [];
  for (const [index, condition] of (['with', 'without'] as const).entries()) {
    const outcome = (c.outcomes ?? { with: 2, without: 1 })[condition];
    const gradeId = `${c.id.slice(0, 8)}-0000-4000-8000-00000000000${index}`, attemptId = `${c.id.slice(0, 8)}-0000-4000-8000-00000000001${index}`;
    const trialId = `trial-${index + 1}`;
    const judge = c.judge === undefined ? judgeA : c.judge;
    if (typeof outcome !== 'number') {
      trials.push({ trialId, sequence: index, scenarioId: metadata.id, source: sourceIdentity, agent: 'goose', repetition: 1, pairId: 'pair-1', condition, status: 'finalized', attemptId, attemptStatus: 'completed',
        selectedGradeId: null, grades: [{ id: gradeId, attemptId, status: outcome === 'technical' ? 'technical-error' : 'completed', outcomeClass: outcome === 'technical' ? 'technical-error' : 'inconclusive', judge: outcome === 'technical' ? null : judge }], score: null });
      continue;
    }
    const path = `iteration-1/eval-1/${condition === 'with' ? 'with_skill' : 'without_skill'}/run-1`;
    const grading = { expectations: expectations.map((text, i) => ({ text, passed: i < outcome, evidence: 'observed' })), summary: { passed: outcome, failed: expectations.length - outcome, total: expectations.length, pass_rate: outcome / expectations.length } };
    await add(`${path}/eval_metadata.json`, JSON.stringify(metadata));
    await add(`${path}/grading.json`, JSON.stringify(grading));
    await add(`${path}/outputs/transcript.json`, '{"messages":[]}');
    const model = configured ? { configured, observed: null } : undefined;
    selected.push(gradeId);
    runs.push({ path, condition, evalId: 1, repetition: 1, campaignId: c.id, gradeId, trialId, attemptId, manifestDigest: 'a'.repeat(64), evidenceDigest: 'b'.repeat(64), requestDigest: 'c'.repeat(64),
      profile, scenario: { id: metadata.id, source: sourceIdentity }, agent: 'goose', pairId: 'pair-1', protectedRoots: [], judge,
      options: configured ? { candidateModels: { goose: configured } } : {}, receipt: { ...(c.host === null ? {} : { host: c.host === '' ? { id: 'goose' } : { id: 'goose', version: c.host ?? '1.57.0' } }), ...(model ? { model } : {}) } });
    trials.push({ trialId, sequence: index, scenarioId: metadata.id, source: sourceIdentity, agent: 'goose', repetition: 1, pairId: 'pair-1', condition, status: 'finalized', attemptId, attemptStatus: 'completed',
      ...(model ? { model } : {}), selectedGradeId: gradeId, grades: [{ id: gradeId, attemptId, status: 'completed', outcomeClass: 'decisive', judge }],
      score: { passed: outcome, failed: expectations.length - outcome, total: expectations.length, passRate: outcome / expectations.length } });
  }
  const overview = { schemaVersion: 1, campaignId: c.id, profile, candidateModel: { source: 'configuration-default', effective: 'unknown', ...(configured ? { configured: { goose: configured } } : {}) }, trials };
  await add('overview.json', JSON.stringify(overview));
  await writeFile(join(workspace, 'export-manifest.json'), JSON.stringify({ schemaVersion: 1, method: 'agent-plugin-explicit-quality-v1', status: 'complete', kind: 'workspace', campaignId: c.id, overview: 'overview.json',
    selection: { strategy: 'explicit-one-grade-per-logical-trial', gradingIds: selected }, runs, files }));
  return workspace;
}
/** Stand-in report bytes carrying the export provenance digest that generate-report embeds. */
const boundReview = (workspace: string) => `<!doctype html><script>{"manifest_sha256":"${createHash('sha256').update(readFileSync(join(workspace, 'export-manifest.json'))).digest('hex')}"}</script>`;
const run = (args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { PATH: '', HOME: tmpdir() } });
const dataOf = async (output: string) => JSON.parse((await readFile(output, 'utf8')).split('const DATA = ')[1]!.split(';\n')[0]!);
const ids = ['aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000003'];

test('dashboard keeps model columns separate and computes a delta only for established comparability (MC1, MC2)', async () => {
  const base = await mkdtemp(join(tmpdir(), 'dashboard-'));
  try {
    const cases: [string, Campaign, string | null, Partial<Campaign>?][] = [
      ['distinct known models', { id: ids[1]!, model: 'model-B', outcomes: { with: 1, without: 1 } }, null],
      ['same model replication', { id: ids[1]!, model: 'model-A' }, 'same configured model'],
      ['unknown identity', { id: ids[1]! }, 'configured candidate identity unknown'],
      ['other revision', { id: ids[1]!, model: 'model-B', revision: 'revision-2' }, 'profile revision differs'],
      ['other criteria', { id: ids[1]!, model: 'model-B', expectations: ['First criterion', 'Changed criterion'] }, 'prompt or criteria differ'],
      ['other judge', { id: ids[1]!, model: 'model-B', judge: { ...judgeA, limits: { ...judgeA.limits, maxTurns: 5 } } }, 'judge configuration differs'],
      ['other host version', { id: ids[1]!, model: 'model-B', host: '1.58.0' }, 'candidate host version differs'],
      // Two unknowns are never treated as equal (review ap-r5dg findings 1 and 2).
      ['both judges unknown', { id: ids[1]!, model: 'model-B', judge: null }, 'judge configuration unknown', { judge: null }],
      ['explicitly requested judge model', { id: ids[1]!, model: 'model-B', outcomes: { with: 1, without: 1 }, judge: { ...judgeA, model: { source: 'override', requested: 'judge-x', effective: 'unknown' } as unknown as typeof judgeA.model } }, null, { judge: { ...judgeA, model: { source: 'override', requested: 'judge-x', effective: 'unknown' } as unknown as typeof judgeA.model } }],
      ['both hosts unknown', { id: ids[1]!, model: 'model-B', host: null }, 'candidate host version differs or is unknown', { host: null }],
      ['both host versions unknown', { id: ids[1]!, model: 'model-B', host: '' }, 'candidate host version differs or is unknown', { host: '' }],
      ['both judge host versions unknown', { id: ids[1]!, model: 'model-B', judge: { ...judgeA, host: { id: 'goose' } as typeof judgeA.host } }, 'judge configuration unknown', { judge: { ...judgeA, host: { id: 'goose' } as typeof judgeA.host } }],
    ];
    for (const [name, other, reason, first] of cases) {
      const dir = join(base, name.replace(/ /g, '-'));
      const a = await exportFor(dir, { id: ids[0]!, model: 'model-A', ...first }), b = await exportFor(dir, other), output = join(dir, 'dashboard.html');
      const result = run(['--workspace', a, '--workspace', b, '--output', output]);
      assert.equal(result.status, 0, `${name}: ${result.stderr}`);
      const data = await dataOf(output);
      assert.equal(data.rows.length, 1, name);
      const [row] = data.rows, [comparison] = row.comparisons;
      // Each campaign keeps its own score; nothing is averaged across columns.
      assert.equal(row.cells[ids[0]!].conditions.with.score, 1, name);
      if (reason === null) {
        assert.equal(comparison.comparable, true, name); assert.equal(comparison.delta, -50, name);
        // A default-configured judge cannot prove the same judge model: qualified, not refused.
        // These exports predate code-mode recording (ap-49tf): unknown qualifies, never refuses.
        assert.deepEqual(comparison.caveats, [...(name.includes('requested') ? [] : ['judge model identity unverified (configured default)']), 'host code mode not recorded for at least one campaign'], name);
      }
      else { assert.equal(comparison.comparable, false, name); assert.equal(comparison.delta, null, name); assert.ok(comparison.reasons.some((r: string) => r.includes(reason)), `${name}: ${comparison.reasons}`); }
    }
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('unavailable outcomes stay null with their cause and evidence keeps exact identities (MC3)', async () => {
  const base = await mkdtemp(join(tmpdir(), 'dashboard-'));
  try {
    const a = await exportFor(base, { id: ids[0]!, model: 'model-A', outcomes: { with: 2, without: 'technical' } });
    const b = await exportFor(base, { id: ids[1]!, model: 'model-B', outcomes: { with: 'inconclusive', without: 0 } });
    await writeFile(join(base, ids[0]!, 'review.html'), boundReview(a));
    const output = join(base, 'dashboard.html'), result = run(['--workspace', a, '--workspace', b, '--output', output]);
    assert.equal(result.status, 0, result.stderr);
    const data = await dataOf(output), row = data.rows[0];
    assert.equal(row.cells[ids[0]!].conditions.without.score, null);
    assert.equal(row.cells[ids[0]!].conditions.without.technical, 1);
    assert.equal(row.cells[ids[1]!].conditions.with.score, null);
    assert.equal(row.cells[ids[1]!].conditions.with.inconclusive, 1);
    assert.equal(row.cells[ids[1]!].conditions.without.score, 0, 'a decisive zero stays a real zero');
    assert.deepEqual(row.comparisons[0].reasons, ['With-profile score unavailable']);
    assert.deepEqual(row.cells[ids[0]!].trials.map((t: { gradeId: string | null }) => t.gradeId), [`${ids[0]!.slice(0, 8)}-0000-4000-8000-000000000000`, null]);
    // Only an existing sibling review.html is linked, never a guessed location.
    assert.equal(data.campaigns[0].review, pathToFileURL(join(base, ids[0]!, 'review.html')).href);
    assert.equal(data.campaigns[1].review, null);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('embedded campaign text cannot terminate the data script without a browser', async () => {
  const base = await mkdtemp(join(tmpdir(), 'dashboard-'));
  try {
    const hostile = 'x</script><img src=x onerror=alert(1)>\u2028\u2029<!--';
    const a = await exportFor(base, { id: ids[0]!, model: 'model-A', prompt: hostile }), b = await exportFor(base, { id: ids[1]!, model: 'model-B', prompt: hostile });
    const output = join(base, 'dashboard.html');
    assert.equal(run(['--workspace', a, '--workspace', b, '--output', output]).status, 0);
    const html = await readFile(output, 'utf8'), payload = html.split('const DATA = ')[1]!.split(';\n')[0]!;
    assert.equal(/[<>\u2028\u2029]/.test(payload), false);
    assert.equal(html.match(/<\/script/gi)!.length, html.match(/<script/gi)!.length);
    assert.equal(JSON.parse(payload).rows[0].prompt, hostile);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('a sibling review.html is linked only when rendered from the same verified export', async () => {
  const base = await mkdtemp(join(tmpdir(), 'dashboard-'));
  try {
    const a = await exportFor(base, { id: ids[0]!, model: 'model-A' }), b = await exportFor(base, { id: ids[1]!, model: 'model-B' });
    const c = await exportFor(base, { id: ids[2]!, model: 'model-C' });
    const html = boundReview(a);
    await writeFile(join(base, ids[0]!, 'review.html'), html);
    await writeFile(join(base, ids[0]!, '.agent-plugin-html.json'), JSON.stringify({ version: 1, campaignId: ids[0], htmlSha256: hash(html) }));
    // Stale/foreign: another export's provenance digest.
    await writeFile(join(base, ids[1]!, 'review.html'), boundReview(a));
    // Receipt bound to other bytes.
    await writeFile(join(base, ids[2]!, 'review.html'), boundReview(c));
    await writeFile(join(base, ids[2]!, '.agent-plugin-html.json'), JSON.stringify({ version: 1, campaignId: ids[2], htmlSha256: hash('other') }));
    const output = join(base, 'dashboard.html'), result = run(['--workspace', a, '--workspace', b, '--workspace', c, '--output', output]);
    assert.equal(result.status, 0, result.stderr);
    const data = await dataOf(output);
    assert.deepEqual(data.campaigns.map((x: { review: string | null }) => x.review), [pathToFileURL(join(base, ids[0]!, 'review.html')).href, null, null]);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('dashboard refuses a single or duplicated campaign, a missing or existing output and an output inside an export', async () => {
  const base = await mkdtemp(join(tmpdir(), 'dashboard-'));
  try {
    const a = await exportFor(base, { id: ids[0]!, model: 'model-A' }), b = await exportFor(base, { id: ids[1]!, model: 'model-B' });
    const existing = join(base, 'existing.html'); await writeFile(existing, 'keep');
    for (const [args, message] of [
      [['--workspace', a, '--output', join(base, 'one.html')], /two/],
      [['--workspace', a, '--workspace', a, '--output', join(base, 'dup.html')], /Duplicate campaign/],
      [['--workspace', a, '--workspace', b], /--output/],
      [['--workspace', a, '--workspace', b, '--output', existing], /EEXIST/],
      [['--workspace', a, '--workspace', b, '--output', join(a, 'inside.html')], /overlaps/],
    ] as const) {
      const result = run([...args]);
      assert.notEqual(result.status, 0, args.join(' '));
      assert.match(result.stderr, message);
    }
    assert.equal(await readFile(existing, 'utf8'), 'keep');
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('dashboard view renders separate columns, unavailable labels and exact deep links', {skip:!process.env.REPORT_PLAYWRIGHT_MODULE || !process.env.REPORT_CHROMIUM}, async () => {
  const base = await mkdtemp(join(tmpdir(), 'dashboard-browser-'));
  const { chromium } = await import(pathToFileURL(process.env.REPORT_PLAYWRIGHT_MODULE!).href);
  const browser = await chromium.launch({ executablePath: process.env.REPORT_CHROMIUM, headless: true });
  try {
    const hostile = 'Notes</script><img src=x onerror="window.injected=1">\u2028<b>bold</b>';
    const a = await exportFor(base, { id: ids[0]!, model: 'model-A', prompt: hostile }), b = await exportFor(base, { id: ids[1]!, model: 'model-B', prompt: hostile, outcomes: { with: 'technical', without: 1 } });
    await writeFile(join(base, ids[0]!, 'review.html'), boundReview(a));
    const output = join(base, 'dashboard.html');
    assert.equal(run(['--workspace', a, '--workspace', b, '--output', output]).status, 0);
    const page = await browser.newPage(), errors: string[] = [];
    page.on('pageerror', (error: Error) => errors.push(error.message));
    await page.goto(pathToFileURL(output).href);
    assert.deepEqual(errors, []);
    // Embedded campaign text stays inert text: no element injection, no script execution.
    assert.equal(await page.evaluate(() => (window as unknown as { injected?: number }).injected), undefined);
    assert.equal(await page.locator('img, b').count(), 0);
    assert.match(await page.locator('#matrix tbody th .task').innerText(), /<\/script><img src=x/);
    assert.deepEqual(await page.locator('#matrix thead th').allInnerTexts(), ['Source · scenario · host', 'C1', 'C2', 'Comparisons']);
    const cells = page.locator('#matrix tbody td');
    assert.match(await cells.nth(0).innerText(), /With profile: 100\.0%/);
    assert.match(await cells.nth(1).innerText(), /With profile: No score · 0\/1 selected · 1 technical error/);
    assert.match(await cells.nth(2).innerText(), /not compared — With-profile score unavailable/);
    assert.equal(await cells.nth(0).locator('a').getAttribute('href'), pathToFileURL(join(base, ids[0]!, 'review.html')).href + '#trial=trial-1');
  } finally { await browser.close(); await rm(base, { recursive: true, force: true }); }
});

test('a delta between unequal With-profile coverages is qualified with both coverages, never refused (ap-t7uo)', async () => {
  const { compareCells } = await import(pathToFileURL(script).href);
  const campaign = (model: string) => ({ profile: { id: 'profile', revision: 'revision-1' }, candidates: { goose: { known: true, provider: 'provider', model } } });
  const cell = (selected: number, planned: number, score: number) => ({ agent: 'goose', fingerprints: ['f'], judges: ['j'], hosts: ['h'], judgeModelUnverified: false,
    conditions: { with: { selected, planned, score } } });
  const coverageCaveats = (a: ReturnType<typeof cell>, b: ReturnType<typeof cell>) => {
    const result = compareCells(a, b, campaign('model-A'), campaign('model-B'));
    assert.equal(result.comparable, true);
    return result.caveats.filter((c: string) => c.includes('coverage'));
  };
  assert.deepEqual(coverageCaveats(cell(3, 3, 1), cell(3, 3, 0.5)), [], 'equal coverage is not qualified');
  assert.deepEqual(coverageCaveats(cell(1, 3, 1), cell(3, 3, 0.5)), ['With-profile selected coverage differs (1/3 vs 3/3)']);
  // Equal ratios over different planned repetitions still rest on unequal evidence.
  assert.deepEqual(coverageCaveats(cell(1, 1, 1), cell(3, 3, 0.5)), ['With-profile selected coverage differs (1/1 vs 3/3)']);
});

test('a known code-mode difference refuses the delta; unknown only qualifies it (ap-49tf)', async () => {
  const { compareCells } = await import(pathToFileURL(script).href);
  const campaign = (model: string, codeMode?: string) => ({ profile: { id: 'profile', revision: 'revision-1' }, candidates: { goose: { known: true, provider: 'provider', model } },
    ...(codeMode === undefined ? {} : { tooling: { goose: codeMode } }) });
  const cell = (score: number) => ({ agent: 'goose', fingerprints: ['f'], judges: ['j'], hosts: ['h'], judgeModelUnverified: false, conditions: { with: { selected: 1, planned: 1, score } } });
  const differ = compareCells(cell(1), cell(0.5), campaign('A', 'enabled'), campaign('B', 'disabled'));
  assert.deepEqual([differ.comparable, differ.delta, differ.reasons], [false, null, ['host code mode differs']]);
  const equal = compareCells(cell(1), cell(0.5), campaign('A', 'enabled'), campaign('B', 'enabled'));
  assert.deepEqual([equal.comparable, equal.caveats], [true, []]);
  const unknown = compareCells(cell(1), cell(0.5), campaign('A', 'enabled'), campaign('B'));
  assert.deepEqual([unknown.comparable, unknown.caveats], [true, ['host code mode not recorded for at least one campaign']]);
});
