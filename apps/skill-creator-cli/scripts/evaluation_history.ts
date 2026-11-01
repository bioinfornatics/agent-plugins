/** Original-environment discovery index. Retained artifacts, never the database, are authoritative. */
import * as fs from 'node:fs';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { regularPath } from './evaluation_files.js';
import { isolatedBehavioralData, analyzePairedValue } from './evaluation_report.js';
import { buildSessionReviewModel } from './session_review_model.js';

export interface HistoryResult { status: 'indexed' | 'unavailable'; path: string; campaign_id?: string; reason?: string }
export function historyPath(env: NodeJS.ProcessEnv = process.env): string {
 const home = env.HOME || homedir(), state = env.XDG_STATE_HOME;
 return join(state && state.startsWith('/') ? state : join(home, '.local/state'), 'agent-plugins/evaluations/index.sqlite');
}
const fail = (reason: string): never => { throw new Error(reason); };
const relative = (v: unknown): v is string => typeof v === 'string' && !!v && !isAbsolute(v) && !v.includes('\\') && !v.includes('\0') && v.split('/').every(p => !!p && p !== '.' && p !== '..');
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
/** Descriptor-anchored Linux reads reject links and special files. Raw logs are streamed, not parsed. */
function artifact(filename: string, expected?: string, size?: number, collect = false): Buffer {
 if (process.platform !== 'linux') fail('history-safe-reader-unavailable');
 let parent: number | undefined, fd: number | undefined;
 try {
  const parts = resolve(filename).split('/').filter(Boolean), leaf = parts.pop()!;
  parent = fs.openSync('/', fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  for (const part of parts) { const next = fs.openSync(`/proc/self/fd/${parent}/${part}`, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW); fs.closeSync(parent); parent = next; }
  fd = fs.openSync(`/proc/self/fd/${parent}/${leaf}`, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  const before = fs.fstatSync(fd);
  if (!before.isFile() || before.nlink !== 1 || (size !== undefined && before.size !== size) || (collect && before.size > 8 * 1024 * 1024)) fail('history-artifact-invalid');
  const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(64 * 1024), chunks: Buffer[] = []; let total = 0, n: number;
  while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) { total += n; if (collect && total > 8 * 1024 * 1024) fail('history-artifact-invalid'); hash.update(buffer.subarray(0, n)); if (collect) chunks.push(Buffer.from(buffer.subarray(0, n))); }
  const after = fs.fstatSync(fd);
  if (total !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || (expected !== undefined && hash.digest('hex') !== expected)) fail('history-artifact-drift');
  return Buffer.concat(chunks);
 } catch (error) { if ((error as Error).message.startsWith('history-')) throw error; return fail('history-artifact-unsafe-or-missing'); }
 finally { if (fd !== undefined) fs.closeSync(fd); if (parent !== undefined) fs.closeSync(parent); }
}
function bound(root: string, binding: any, collect = false): Buffer {
 if (!relative(binding?.path) || !digest(binding?.sha256) || !Number.isSafeInteger(binding?.bytes) || binding.bytes < 0) fail('history-artifact-binding-invalid');
 return artifact(join(root, binding.path), binding.sha256, binding.bytes, collect);
}
function validate(report: any): any[] {
 if (!report || typeof report.output !== 'string' || !isAbsolute(report.output) || report.output.includes('\0') || report.output.split(/[\\/]/).includes('..') || !Array.isArray(report.runs)) fail('history-report-invalid');
 const output = resolve(report.output); regularPath(output, true);
 if (typeof report.review !== 'string' || resolve(report.review) !== join(output, 'review.html')) fail('history-report-invalid');
 artifact(report.review);
 const keys = new Set<string>();
 return report.runs.map((r: any) => {
  if (!Number.isSafeInteger(r.case_id) || r.case_id < 0 || !Number.isSafeInteger(r.repeat) || r.repeat < 1 || !['baseline', 'with_targets'].includes(r.arm) || r.directory !== `case-${r.case_id}/${r.arm}/run-${r.repeat}`) fail('unsafe-history-slot');
  const key = JSON.stringify([r.case_id, r.arm, r.repeat]); if (keys.has(key)) fail('history-duplicate-slot'); keys.add(key);
  const root = join(output, r.directory), transcript = r.session_log, raw = transcript?.raw_files;
  let transcriptPath = null, rawPath = null, finalPath = null, outputPath = null;
  if (transcript?.status === 'retained' || transcript?.path !== undefined) {
   if (transcript.path !== 'session-log.json') fail('history-artifact-binding-invalid');
   const source = JSON.parse(bound(root, transcript, true).toString('utf8'));
   if (source.protocol !== 'goose-session-log-v1' || source.session_name !== transcript.session_name) fail('history-artifact-binding-invalid');
   transcriptPath = join(root, transcript.path);
  }
  if (raw?.path !== undefined) {
   if (raw.path !== 'raw-logs/manifest.json') fail('history-artifact-binding-invalid');
   const manifest = JSON.parse(bound(root, raw, true).toString('utf8'));
   if (manifest.protocol !== 'goose-raw-logs-v1' || manifest.session_name !== transcript.session_name || !Array.isArray(manifest.files)) fail('history-artifact-binding-invalid');
   const files = new Set<string>();
   for (const file of manifest.files) { if (!relative(file.path) || !file.path.startsWith('raw-logs/') || file.path === raw.path || files.has(file.path)) fail('history-artifact-binding-invalid'); files.add(file.path); bound(root, file); }
   rawPath = join(root, raw.path);
  } else if (raw?.files?.length || ['complete', 'partial'].includes(raw?.status)) fail('history-artifact-binding-invalid');
  if (r.final_response_path !== undefined || r.final_response_sha256 !== undefined) {
   if (!relative(r.final_response_path) || !digest(r.final_response_sha256)) fail('history-final-response-binding-invalid');
   finalPath = join(root, r.final_response_path); artifact(finalPath, r.final_response_sha256);
  } else if (r.status === 'succeeded') fail('history-final-response-binding-missing');
  if ((r.grading_source_sha256 ?? r.output_sha256) !== undefined && (r.grading_source_sha256 ?? r.output_sha256) !== null) {
   if (!digest(r.grading_source_sha256 ?? r.output_sha256)) fail('history-artifact-binding-invalid');
   outputPath = join(root, 'outputs/result.txt'); artifact(outputPath, r.grading_source_sha256 ?? r.output_sha256);
  }
  return [r.case_id, r.arm, r.repeat, r.session_name ?? null, r.started_at ?? null, r.finished_at ?? null, r.status, transcriptPath, transcriptPath ? transcript.sha256 : null, rawPath, rawPath ? raw.sha256 : null, outputPath, outputPath ? (r.grading_source_sha256 ?? r.output_sha256) : null, finalPath, finalPath ? r.final_response_sha256 : null];
 });
}
/** Counts derive from canonical criterion rows, not possibly stale report.comparison totals. */
export function historyCategories(report: any): { labels: string[]; counters: Record<string, number> } {
 const counters: Record<string, number> = { regressions: 0, undecidable: 0, shared_gaps: 0, gains: 0, both_pass: 0, disputes: 0, missing: 0, noncomparable: 0 };
 if (report.mode === 'behavioral') {
  const data = isolatedBehavioralData(report), comparison = analyzePairedValue(data.runs, data.pending ?? []);
  const model = buildSessionReviewModel({...data, review_findings: report.review_findings}, comparison);
  const map: Record<string, string> = { regression: 'regressions', undecidable: 'undecidable', both_fail: 'shared_gaps', gain: 'gains', both_pass: 'both_pass', unavailable: 'missing', noncomparable: 'noncomparable' };
  for (const item of model.items) { if (map[item.outcome]) counters[map[item.outcome]]++; if (item.review_findings.length) counters.disputes++; }
 } else {
  counters.missing = (report.runs ?? []).filter((r: any) => r.status !== 'succeeded').length + (report.missing_runs ?? []).length;
 }
 const labels = Object.entries({Regressions: counters.regressions, Undecidable: counters.undecidable, 'Shared gaps': counters.shared_gaps, Gains: counters.gains, 'Both pass': counters.both_pass, Disputes: counters.disputes, Missing: counters.missing, Noncomparable: counters.noncomparable}).filter(([, n]) => n > 0).map(([label]) => label);
 if (['regressions', 'undecidable', 'shared_gaps', 'disputes', 'missing', 'noncomparable'].some(k => counters[k] > 0)) labels.unshift('Needs review');
 return {labels, counters};
}
async function database(path: string): Promise<any> {
 const bun = Boolean((globalThis as any).Bun), name = bun ? 'bun:sqlite' : 'node:sqlite'; let module: any;
 try { module = await import(name); } catch { return fail(bun ? 'history-runtime-unavailable: bun:sqlite required' : 'history-runtime-unavailable: node:sqlite requires Node.js 22.5+'); }
 regularPath(dirname(path), true); regularPath(path);
 if (!fs.existsSync(dirname(path))) fs.mkdirSync(dirname(path), {recursive: true, mode: 0o700});
 const parent = fs.lstatSync(dirname(path)), uid = process.getuid?.();
 if (!parent.isDirectory() || (parent.mode & 0o077) !== 0 || (uid !== undefined && parent.uid !== uid)) fail('history-parent-not-private');
 if (!fs.existsSync(path)) { try { fs.closeSync(fs.openSync(path, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; } }
 const target = fs.lstatSync(path);
 if (!target.isFile() || target.nlink !== 1 || (target.mode & 0o077) !== 0 || (uid !== undefined && target.uid !== uid)) fail('unsafe-history-file');
 // Never chmod a caller-owned target, including a hardlink or protected existing file.
 for (const suffix of ['-journal', '-wal', '-shm']) { regularPath(path + suffix); const st = fs.lstatSync(path + suffix, {throwIfNoEntry: false}); if (st && (!st.isFile() || st.nlink !== 1 || (st.mode & 0o077) !== 0 || (uid !== undefined && st.uid !== uid))) fail('unsafe-history-file'); }
 const db = bun ? new module.Database(path, {create: true}) : new module.DatabaseSync(path);
 return {exec: (s: string) => db.exec(s), statement: (s: string) => bun ? db.query(s) : db.prepare(s), close: () => db.close()};
}
function migrate(db: any): void {
 const version = Number(db.statement('PRAGMA user_version').get().user_version);
 if (![0, 1, 2].includes(version)) fail('history-schema-unsupported');
 if (version === 0) {
  // An unversioned nonempty database is not ours to rewrite.
  if (db.statement("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length) fail('history-schema-unsupported');
  db.exec('CREATE TABLE evaluation_history (campaign_id TEXT PRIMARY KEY, source_json TEXT NOT NULL, started_at TEXT, finished_at TEXT, provider TEXT, model TEXT, identity_provenance TEXT NOT NULL, status TEXT NOT NULL, report_uri TEXT NOT NULL, categories_json TEXT NOT NULL, counters_json TEXT NOT NULL); CREATE TABLE evaluation_slots (campaign_id TEXT NOT NULL, case_id INTEGER NOT NULL, arm TEXT NOT NULL, repetition INTEGER NOT NULL, session_name TEXT, started_at TEXT, finished_at TEXT, execution_status TEXT NOT NULL, transcript_path TEXT, transcript_sha256 TEXT, raw_manifest_path TEXT, raw_manifest_sha256 TEXT, final_output_path TEXT, final_output_sha256 TEXT, final_response_path TEXT, final_response_sha256 TEXT, PRIMARY KEY(campaign_id,case_id,arm,repetition));');
 } else if (version === 1) db.exec("ALTER TABLE evaluation_history ADD COLUMN counters_json TEXT NOT NULL DEFAULT '{}'; ALTER TABLE evaluation_slots ADD COLUMN final_response_path TEXT; ALTER TABLE evaluation_slots ADD COLUMN final_response_sha256 TEXT;");
 db.exec('PRAGMA user_version=2');
}
export async function indexEvaluation(path: string, report: any): Promise<HistoryResult> {
 let db: any;
 try {
  // All artifact validation and classification precede opening/mutating the index.
  const slots = validate(report), categories = historyCategories(report);
  const id = report.campaign_id || createHash('sha256').update(resolve(report.output)).digest('hex');
  db = await database(path); db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE'); migrate(db);
  db.statement('INSERT OR REPLACE INTO evaluation_history VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, JSON.stringify(report.selected_targets ?? []), report.started_at ?? null, report.finished_at ?? null, report.configured_identity?.provider ?? report.provider ?? null, report.configured_identity?.model ?? report.model ?? null, report.configured_identity?.provenance ?? 'configured CLI values; unknown stays null; not authenticated endpoint proof', report.status, pathToFileURL(report.review).href, JSON.stringify(categories.labels), JSON.stringify(categories.counters));
  db.statement('DELETE FROM evaluation_slots WHERE campaign_id=?').run(id);
  const stmt = db.statement('INSERT INTO evaluation_slots VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'); for (const slot of slots) stmt.run(id, ...slot);
  db.exec('COMMIT'); return {status: 'indexed', path, campaign_id: id};
 } catch (error) { try { db?.exec('ROLLBACK'); } catch {} const message = (error as Error).message; return {status: 'unavailable', reason: message.startsWith('history-') || message === 'unsafe-history-file' || message === 'unsafe-history-slot' ? message : 'history-index-unavailable', path}; }
 finally { db?.close(); }
}
/** Zero-model repair: safely reread a retained canonical report and replace only its campaign. */
export async function reindexEvaluation(path: string, reportPath: string): Promise<HistoryResult> {
 try {
  const report = JSON.parse(artifact(reportPath, undefined, undefined, true).toString('utf8'));
  if (report.schema_version !== 'isolated-evaluation-v1' || typeof report.output !== 'string' || resolve(reportPath) !== join(resolve(report.output), 'report.json')) fail('history-report-invalid');
  return await indexEvaluation(path, report);
 } catch (error) { return {status: 'unavailable', reason: (error as Error).message.startsWith('history-') ? (error as Error).message : 'history-report-invalid', path}; }
}
