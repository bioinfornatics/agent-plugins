import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, statSync, chmodSync, linkSync, symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {historyPath, indexEvaluation, reindexEvaluation, historyCategories} from '../dist/scripts/evaluation_history.js';
const sqlite = async () => { const name = (globalThis as any).Bun ? 'bun:sqlite' : 'node:sqlite'; const m = await import(name); return (path: string) => (globalThis as any).Bun ? new m.Database(path) : new m.DatabaseSync(path); };
const query = (db: any, sql: string) => (globalThis as any).Bun ? db.query(sql) : db.prepare(sql);
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
function fixture(root: string, id = 'id'): any {
 const output = join(root, 'output-' + id); mkdirSync(output, {mode: 0o700}); writeFileSync(join(output, 'review.html'), '<h1>Review</h1>');
 const report: any = {schema_version: 'isolated-evaluation-v1', campaign_id: id, mode: 'behavioral', output, review: join(output, 'review.html'), status: 'inconclusive', model: null, provider: null, selected_targets: ['one'], cases: [{id: 1}], runs_per_query: 1, missing_runs: [], rows: [], runs: [], review_findings: [{criterion: 'regression', case_id: 1, repeat: 1, arm: 'baseline'}, {criterion: 'regression', case_id: 1, repeat: 1, arm: 'with_targets'}, {title: 'Unlinked broad note'}], comparison: {criteria: {gains: 5000}}};
 for (const arm of ['baseline', 'with_targets']) {
  const directory = `case-1/${arm}/run-1`, dir = join(output, directory); mkdirSync(join(dir, 'outputs'), {recursive: true, mode: 0o700}); mkdirSync(join(dir, 'raw-logs'), {mode: 0o700});
  const bind = (path: string, bytes: Buffer | string) => { writeFileSync(join(dir, path), bytes, {mode: 0o600}); return {path, bytes: Buffer.byteLength(bytes), sha256: sha(bytes)}; };
  const rawFile = bind('raw-logs/goose.log', Buffer.concat([Buffer.from('private-log-body\n"quoted"\n'), Buffer.alloc(200000, 0xff)]));
  const raw = bind('raw-logs/manifest.json', JSON.stringify({protocol: 'goose-raw-logs-v1', session_name: 'audit-' + arm, status: 'complete', files: [rawFile]}) + '\n');
  const transcript = bind('session-log.json', JSON.stringify({protocol: 'goose-session-log-v1', session_name: 'audit-' + arm, messages: [{role: 'assistant', text: ['line 1\n"quotes"']}], redacted: false}) + '\n');
  const final = bind('final-response.txt', 'line 1\n"literal quotes"\n\n');
  const grading = bind('outputs/result.txt', 'different grading packet\n');
  report.runs.push({directory, case_id: 1, repeat: 1, arm, status: 'succeeded', session_name: 'audit-' + arm, session_log: {...transcript, status: 'retained', session_name: 'audit-' + arm, raw_files: {...raw, status: 'complete'}}, final_response_path: final.path, final_response_sha256: final.sha256, output_sha256: grading.sha256});
  report.rows.push({eval_id: 1, configuration: arm === 'baseline' ? 'without_skill' : 'with_skill', run_number: 1, grading_status: 'complete', execution_status: 'succeeded', expectations: ['gain', 'regression', 'gap', 'pass', 'uncertain'].map((text, i) => ({text, passed: i === 4 ? null : arm === 'baseline' ? [false, true, false, true][i] : [true, false, false, true][i]}))});
 }
 writeFileSync(join(output, 'report.json'), JSON.stringify(report) + '\n', {mode: 0o600}); return report;
}
async function rows(path: string) {
 const db = (await sqlite())(path); try { return {history: query(db, 'SELECT * FROM evaluation_history ORDER BY campaign_id').all(), slots: query(db, 'SELECT * FROM evaluation_slots ORDER BY campaign_id,case_id,arm,repetition').all(), version: query(db, 'PRAGMA user_version').get().user_version}; } finally { db.close(); }
}
test('exact retained-byte bindings and canonical multi-label counters survive zero-model idempotent repair', async () => {
 const root = mkdtempSync(join(tmpdir(), 'history-')); try {
  const path = historyPath({HOME: root}), report = fixture(root);
  assert.equal((await indexEvaluation(path, report)).status, 'indexed');
  const first = await rows(path); assert.equal(first.version, 2); assert.equal(first.history[0].model, null); assert.equal(first.history[0].report_uri, new URL('file://' + report.review).href);
  assert.deepEqual(JSON.parse(first.history[0].categories_json), ['Needs review', 'Regressions', 'Undecidable', 'Shared gaps', 'Gains', 'Both pass', 'Disputes']);
  assert.deepEqual(JSON.parse(first.history[0].counters_json), {regressions: 1, undecidable: 1, shared_gaps: 1, gains: 1, both_pass: 1, disputes: 1, missing: 0, noncomparable: 0});
  assert.equal(first.slots.length, 2); assert.equal(first.slots[0].final_response_path, join(report.output, report.runs[0].directory, 'final-response.txt')); assert.equal(first.slots[0].final_response_sha256, sha('line 1\n"literal quotes"\n\n'));
  assert.notEqual(first.slots[0].final_output_sha256, first.slots[0].final_response_sha256);
  assert.equal((await reindexEvaluation(path, join(report.output, 'report.json'))).status, 'indexed'); assert.deepEqual(await rows(path), first);
  assert.equal(statSync(path).mode & 0o777, 0o600); assert.equal(statSync(join(path, '..')).mode & 0o777, 0o700); assert(!readFileSync(path).includes(Buffer.from('private-log-body')));
 } finally { rmSync(root, {recursive: true, force: true}); }
});
test('transcript, manifest, raw-file and final-response drift reject before transaction and preserve prior rows and DB bytes', async () => {
 const root = mkdtempSync(join(tmpdir(), 'history-')); try {
  const path = historyPath({HOME: root}), report = fixture(root); assert.equal((await indexEvaluation(path, report)).status, 'indexed'); const original = await rows(path);
  const bytes = readFileSync(path), dir = join(report.output, report.runs[0].directory);
  for (const filename of ['session-log.json', 'raw-logs/manifest.json', 'raw-logs/goose.log', 'final-response.txt', 'outputs/result.txt']) {
   const file = join(dir, filename), before = readFileSync(file); writeFileSync(file, Buffer.concat([before, Buffer.from('\n')]));
   assert.equal((await indexEvaluation(path, {...report, model: 'must-not-write'})).status, 'unavailable'); assert.deepEqual(readFileSync(path), bytes); assert.deepEqual(await rows(path), original); writeFileSync(file, before);
  }
  const altered = structuredClone(report); altered.runs[0].final_response_sha256 = sha('line 1\n"literal quotes"'); assert.equal((await indexEvaluation(path, altered)).reason, 'history-artifact-drift');
  delete altered.runs[0].final_response_sha256; delete altered.runs[0].final_response_path; assert.equal((await indexEvaluation(path, altered)).reason, 'history-final-response-binding-missing');
  const uncreated = join(root, 'never-created/index.sqlite'); writeFileSync(join(dir, 'raw-logs/goose.log'), 'drift'); assert.equal((await indexEvaluation(uncreated, report)).status, 'unavailable'); assert.throws(() => statSync(join(root, 'never-created')));
 } finally { rmSync(root, {recursive: true, force: true}); }
});
test('hardlinked/protected database and nonprivate parent are rejected without changing bytes or permissions', async () => {
 const root = mkdtempSync(join(tmpdir(), 'history-')); try {
  const report = fixture(root), state = join(root, 'state'); mkdirSync(state, {mode: 0o700});
  const protectedFile = join(state, 'protected'), target = join(state, 'index.sqlite'); writeFileSync(protectedFile, 'protected non-sqlite bytes', {mode: 0o640}); linkSync(protectedFile, target);
  const bytes = readFileSync(protectedFile), mode = statSync(protectedFile).mode; assert.equal((await indexEvaluation(target, report)).reason, 'unsafe-history-file'); assert.deepEqual(readFileSync(protectedFile), bytes); assert.equal(statSync(protectedFile).mode, mode);
  const privateHardlink = join(state, 'private-hardlink'); chmodSync(protectedFile, 0o600); linkSync(protectedFile, privateHardlink); assert.equal((await indexEvaluation(privateHardlink, report)).reason, 'unsafe-history-file'); assert.deepEqual(readFileSync(protectedFile), bytes); assert.equal(statSync(protectedFile).mode & 0o777, 0o600);
  const singleton = join(state, 'singleton'); writeFileSync(singleton, 'do not chmod', {mode: 0o644}); assert.equal((await indexEvaluation(singleton, report)).reason, 'unsafe-history-file'); assert.equal(statSync(singleton).mode & 0o777, 0o644); assert.equal(readFileSync(singleton, 'utf8'), 'do not chmod');
  const publicDir = join(root, 'public'); mkdirSync(publicDir, {mode: 0o755}); assert.equal((await indexEvaluation(join(publicDir, 'index.sqlite'), report)).reason, 'history-parent-not-private'); assert.equal(statSync(publicDir).mode & 0o777, 0o755); assert.throws(() => statSync(join(publicDir, 'index.sqlite')));
 } finally { rmSync(root, {recursive: true, force: true}); }
});
test('unsafe artifact links/traversal and retained-report repair path mismatch do not enter the database', async () => {
 const root = mkdtempSync(join(tmpdir(), 'history-')); try {
  const report = fixture(root), path = historyPath({HOME: root}), run = report.runs[0], file = join(report.output, run.directory, 'final-response.txt'), bytes = readFileSync(file);
  rmSync(file); symlinkSync(join(report.output, 'review.html'), file); assert.equal((await indexEvaluation(path, report)).status, 'unavailable'); rmSync(file); writeFileSync(file, bytes); linkSync(file, join(root, 'linked-final')); assert.equal((await indexEvaluation(path, report)).status, 'unavailable'); rmSync(join(root, 'linked-final'));
  for (const value of ['../review.html', '/tmp/result', 'outputs/../result.txt', 'a\\b']) { const copy = structuredClone(report); copy.runs[0].final_response_path = value; assert.equal((await indexEvaluation(path, copy)).reason, 'history-final-response-binding-invalid'); }
  writeFileSync(join(root, 'report.json'), JSON.stringify(report)); assert.equal((await reindexEvaluation(path, join(root, 'report.json'))).reason, 'history-report-invalid');
 } finally { rmSync(root, {recursive: true, force: true}); }
});
test('missing grading, failed execution and absent planned slots are Missing; disputes count criteria not notes', () => {
 const report: any = {mode: 'behavioral', cases: [{id: 1}, {id: 2}], runs_per_query: 1, missing_runs: [], rows: [], runs: [{case_id: 1, repeat: 1, arm: 'baseline', status: 'failed'}, {case_id: 1, repeat: 1, arm: 'with_targets', status: 'succeeded'}], review_findings: [{title: 'generic note'}]};
 const result = historyCategories(report); assert.equal(result.counters.missing, 2); assert.equal(result.counters.disputes, 0); assert.deepEqual(result.labels, ['Needs review', 'Missing']);
});
test('independent writers preserve campaigns and repairs replace stale slots rather than accumulating them', async () => {
 const root = mkdtempSync(join(tmpdir(), 'history-')); try {
  const path = historyPath({HOME: root}), a = fixture(root, 'a'), b = fixture(root, 'b'), moduleUrl = new URL('../dist/scripts/evaluation_history.js', import.meta.url).href;
  const run = (report: any) => new Promise<void>((resolve, reject) => { const child = spawn(process.execPath, ['--input-type=module', '-e', `const {reindexEvaluation}=await import(${JSON.stringify(moduleUrl)});const r=await reindexEvaluation(${JSON.stringify(path)},${JSON.stringify(join(report.output, 'report.json'))});if(r.status!=='indexed')throw Error(JSON.stringify(r));`], {env: {...process.env, NODE_TEST_CONTEXT: undefined}, stdio: ['ignore', 'pipe', 'pipe']}); let errors = ''; child.stderr.on('data', d => errors += d); child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error(errors))); });
  await Promise.all([run(a), run(b), run(a), run(b)]); let indexed = await rows(path); assert.deepEqual(indexed.history.map((r: any) => r.campaign_id), ['a', 'b']); assert.equal(indexed.slots.length, 4);
  a.runs.pop(); writeFileSync(join(a.output, 'report.json'), JSON.stringify(a)); assert.equal((await reindexEvaluation(path, join(a.output, 'report.json'))).status, 'indexed'); indexed = await rows(path); assert.equal(indexed.slots.filter((r: any) => r.campaign_id === 'a').length, 1); assert.equal(indexed.slots.filter((r: any) => r.campaign_id === 'b').length, 2);
 } finally { rmSync(root, {recursive: true, force: true}); }
});
test('version-one migration preserves old campaigns; unknown schema rolls back without rewriting', async () => {
 const root = mkdtempSync(join(tmpdir(), 'history-')); try {
  const report = fixture(root), state = join(root, 'state'); mkdirSync(state, {mode: 0o700}); const path = join(state, 'index.sqlite'); writeFileSync(path, '', {mode: 0o600});
  const db = (await sqlite())(path); db.exec("CREATE TABLE evaluation_history (campaign_id TEXT PRIMARY KEY, source_json TEXT NOT NULL, started_at TEXT, finished_at TEXT, provider TEXT, model TEXT, identity_provenance TEXT NOT NULL, status TEXT NOT NULL, report_uri TEXT NOT NULL, categories_json TEXT NOT NULL); CREATE TABLE evaluation_slots (campaign_id TEXT NOT NULL, case_id INTEGER NOT NULL, arm TEXT NOT NULL, repetition INTEGER NOT NULL, session_name TEXT, started_at TEXT, finished_at TEXT, execution_status TEXT NOT NULL, transcript_path TEXT, transcript_sha256 TEXT, raw_manifest_path TEXT, raw_manifest_sha256 TEXT, final_output_path TEXT, final_output_sha256 TEXT, PRIMARY KEY(campaign_id,case_id,arm,repetition)); INSERT INTO evaluation_history VALUES ('old','[]',NULL,NULL,NULL,NULL,'unknown','complete','file:///old','[]'); PRAGMA user_version=1;"); db.close();
  assert.equal((await indexEvaluation(path, report)).status, 'indexed'); const migrated = await rows(path); assert.equal(migrated.version, 2); assert.deepEqual(migrated.history.map((r: any) => r.campaign_id), ['id', 'old']); assert.equal(migrated.history[1].counters_json, '{}');
  const newer = (await sqlite())(path); newer.exec('PRAGMA user_version=99'); newer.close(); const before = readFileSync(path); assert.equal((await indexEvaluation(path, report)).reason, 'history-schema-unsupported'); assert.deepEqual(readFileSync(path), before);
 } finally { rmSync(root, {recursive: true, force: true}); }
});
// Node loader-specific failure injection; Bun's actual adapter is covered above.
if (!(globalThis as any).Bun) test('unavailable node:sqlite is explicit, never falls back or creates an index', async () => {
 const root = mkdtempSync(join(tmpdir(), 'history-')); try {
  const report = fixture(root), path = historyPath({HOME: root}), loader = join(root, 'no-sqlite.mjs');
  writeFileSync(loader, "export async function resolve(specifier,context,next){if(specifier==='node:sqlite')throw Error('builtin unavailable');return next(specifier,context);}");
  const moduleUrl = new URL('../dist/scripts/evaluation_history.js', import.meta.url).href;
  const output = await new Promise<string>((resolve, reject) => {
   const child = spawn(process.execPath, ['--experimental-loader', loader, '--input-type=module', '-e', `const {reindexEvaluation}=await import(${JSON.stringify(moduleUrl)});console.log(JSON.stringify(await reindexEvaluation(${JSON.stringify(path)},${JSON.stringify(join(report.output, 'report.json'))})));`], {env: {...process.env, NODE_TEST_CONTEXT: undefined}, stdio: ['ignore', 'pipe', 'pipe']}); let stdout = '', stderr = '';
   child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d); child.on('error', reject); child.on('exit', code => code === 0 ? resolve(stdout) : reject(Error(stderr)));
  });
  assert.deepEqual(JSON.parse(output), {status: 'unavailable', reason: 'history-runtime-unavailable: node:sqlite requires Node.js 22.5+', path}); assert.throws(() => statSync(path));
 } finally { rmSync(root, {recursive: true, force: true}); }
});
test('a rehashed raw manifest cannot hide raw-file drift or redirect to another slot', async () => {
 const root = mkdtempSync(join(tmpdir(), 'history-')); try {
  const report = fixture(root), path = historyPath({HOME: root}); assert.equal((await indexEvaluation(path, report)).status, 'indexed'); const before = readFileSync(path), run = report.runs[0], filename = join(report.output, run.directory, 'raw-logs/manifest.json');
  const manifest = JSON.parse(readFileSync(filename, 'utf8')); manifest.files[0].sha256 = sha('not the raw bytes');
  const bind = () => { const bytes = JSON.stringify(manifest) + '\n'; writeFileSync(filename, bytes); run.session_log.raw_files.sha256 = sha(bytes); run.session_log.raw_files.bytes = Buffer.byteLength(bytes); };
  bind(); assert.equal((await indexEvaluation(path, report)).reason, 'history-artifact-drift'); assert.deepEqual(readFileSync(path), before);
  manifest.files[0].path = '../../with_targets/run-1/raw-logs/goose.log'; bind(); assert.equal((await indexEvaluation(path, report)).reason, 'history-artifact-binding-invalid'); assert.deepEqual(readFileSync(path), before);
 } finally { rmSync(root, {recursive: true, force: true}); }
});
