/** Original-environment discovery index. Retained artifacts, never the database, are authoritative. */
import * as fs from 'node:fs';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { regularPath, readVerifiedFile } from './evaluation_files.js';
import { isolatedBehavioralData, analyzePairedValue } from './evaluation_report.js';
import { buildSessionReviewModel } from './session_review_model.js';
export function historyPath(env = process.env) {
    const home = env.HOME || homedir(), state = env.XDG_STATE_HOME;
    return join(state && isAbsolute(state) ? state : join(home, '.local/state'), 'agent-plugins/evaluations/index.sqlite');
}
const fail = (reason) => { throw new Error(reason); };
const relative = (v) => typeof v === 'string' && !!v && !isAbsolute(v) && !v.includes('\\') && !v.includes('\0') && v.split('/').every(p => !!p && p !== '.' && p !== '..');
const digest = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
/** Portable local integrity checks; raw logs are streamed for hashing, not parsed. */
function artifact(filename, expected, size, collect = false) {
    try {
        return readVerifiedFile(filename, { sha256: expected, bytes: size, maxBytes: collect ? 8 * 1024 * 1024 : undefined, collect });
    }
    catch (error) {
        return fail(error.message === 'evidence-drift' ? 'history-artifact-drift' : 'history-artifact-unsafe-or-missing');
    }
}
function bound(root, binding, collect = false) {
    if (!relative(binding?.path) || !digest(binding?.sha256) || !Number.isSafeInteger(binding?.bytes) || binding.bytes < 0)
        fail('history-artifact-binding-invalid');
    return artifact(join(root, binding.path), binding.sha256, binding.bytes, collect);
}
function validate(report) {
    if (!report || typeof report.output !== 'string' || !isAbsolute(report.output) || report.output.includes('\0') || report.output.split(/[\\/]/).includes('..') || !Array.isArray(report.runs))
        fail('history-report-invalid');
    const output = resolve(report.output);
    regularPath(output, true);
    if (typeof report.review !== 'string' || resolve(report.review) !== join(output, 'review.html'))
        fail('history-report-invalid');
    artifact(report.review);
    const keys = new Set();
    return report.runs.map((r) => {
        if (!Number.isSafeInteger(r.case_id) || r.case_id < 0 || !Number.isSafeInteger(r.repeat) || r.repeat < 1 || !['baseline', 'with_targets'].includes(r.arm) || r.directory !== `case-${r.case_id}/${r.arm}/run-${r.repeat}`)
            fail('unsafe-history-slot');
        const key = JSON.stringify([r.case_id, r.arm, r.repeat]);
        if (keys.has(key))
            fail('history-duplicate-slot');
        keys.add(key);
        const root = join(output, r.directory), transcript = r.session_log, raw = transcript?.raw_files;
        let transcriptPath = null, rawPath = null, finalPath = null, outputPath = null;
        if (transcript?.status === 'retained' || transcript?.path !== undefined) {
            if (transcript.path !== 'session-log.json')
                fail('history-artifact-binding-invalid');
            const source = JSON.parse(bound(root, transcript, true).toString('utf8'));
            if (!['goose-session-log-v1', 'goose-session-log-v2'].includes(source.protocol) || source.session_name !== transcript.session_name)
                fail('history-artifact-binding-invalid');
            transcriptPath = join(root, transcript.path);
        }
        if (raw?.path !== undefined) {
            if (raw.path !== 'raw-logs/manifest.json')
                fail('history-artifact-binding-invalid');
            const manifest = JSON.parse(bound(root, raw, true).toString('utf8'));
            if (manifest.protocol !== 'goose-raw-logs-v1' || manifest.session_name !== transcript.session_name || !Array.isArray(manifest.files))
                fail('history-artifact-binding-invalid');
            const files = new Set();
            for (const file of manifest.files) {
                if (!relative(file.path) || !file.path.startsWith('raw-logs/') || file.path === raw.path || files.has(file.path))
                    fail('history-artifact-binding-invalid');
                files.add(file.path);
                bound(root, file);
            }
            rawPath = join(root, raw.path);
        }
        else if (raw?.files?.length || ['complete', 'partial'].includes(raw?.status))
            fail('history-artifact-binding-invalid');
        if (r.final_response_path !== undefined || r.final_response_sha256 !== undefined) {
            if (!relative(r.final_response_path) || !digest(r.final_response_sha256))
                fail('history-final-response-binding-invalid');
            finalPath = join(root, r.final_response_path);
            artifact(finalPath, r.final_response_sha256);
        }
        else if (r.status === 'succeeded')
            fail('history-final-response-binding-missing');
        if ((r.grading_source_sha256 ?? r.output_sha256) !== undefined && (r.grading_source_sha256 ?? r.output_sha256) !== null) {
            if (!digest(r.grading_source_sha256 ?? r.output_sha256))
                fail('history-artifact-binding-invalid');
            outputPath = join(root, 'outputs/result.txt');
            artifact(outputPath, r.grading_source_sha256 ?? r.output_sha256);
        }
        return [r.case_id, r.arm, r.repeat, r.session_name ?? null, r.started_at ?? null, r.finished_at ?? null, r.status, transcriptPath, transcriptPath ? transcript.sha256 : null, rawPath, rawPath ? raw.sha256 : null, outputPath, outputPath ? (r.grading_source_sha256 ?? r.output_sha256) : null, finalPath, finalPath ? r.final_response_sha256 : null];
    });
}
/** Counts derive from canonical criterion rows, not possibly stale report.comparison totals. */
export function historyCategories(report) {
    const counters = { regressions: 0, undecidable: 0, shared_gaps: 0, gains: 0, both_pass: 0, disputes: 0, missing: 0, noncomparable: 0 };
    if (report.mode === 'behavioral') {
        const data = isolatedBehavioralData(report), comparison = analyzePairedValue(data.runs, data.pending ?? []);
        const model = buildSessionReviewModel({ ...data, review_findings: report.review_findings }, comparison);
        const map = { regression: 'regressions', undecidable: 'undecidable', both_fail: 'shared_gaps', gain: 'gains', both_pass: 'both_pass', unavailable: 'missing', noncomparable: 'noncomparable' };
        for (const item of model.items) {
            if (map[item.outcome])
                counters[map[item.outcome]]++;
            if (item.review_findings.length)
                counters.disputes++;
        }
    }
    else {
        counters.missing = (report.runs ?? []).filter((r) => r.status !== 'succeeded').length + (report.missing_runs ?? []).length;
    }
    const labels = Object.entries({ Regressions: counters.regressions, Undecidable: counters.undecidable, 'Shared gaps': counters.shared_gaps, Gains: counters.gains, 'Both pass': counters.both_pass, Disputes: counters.disputes, Missing: counters.missing, Noncomparable: counters.noncomparable }).filter(([, n]) => n > 0).map(([label]) => label);
    if (['regressions', 'undecidable', 'shared_gaps', 'disputes', 'missing', 'noncomparable'].some(k => counters[k] > 0))
        labels.unshift('Needs review');
    return { labels, counters };
}
async function database(path) {
    const bun = Boolean(globalThis.Bun), name = bun ? 'bun:sqlite' : 'node:sqlite';
    let module;
    try {
        module = await import(name);
    }
    catch {
        return fail(bun ? 'history-runtime-unavailable: bun:sqlite required' : 'history-runtime-unavailable: node:sqlite requires Node.js 22.5+');
    }
    regularPath(dirname(path), true);
    regularPath(path);
    if (!fs.existsSync(dirname(path)))
        fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const parent = fs.lstatSync(dirname(path)), uid = process.getuid?.();
    if (!parent.isDirectory() || (parent.mode & 0o077) !== 0 || (uid !== undefined && parent.uid !== uid))
        fail('history-parent-not-private');
    if (!fs.existsSync(path)) {
        try {
            fs.closeSync(fs.openSync(path, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600));
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
        }
    }
    const target = fs.lstatSync(path);
    if (!target.isFile() || target.nlink !== 1 || (target.mode & 0o077) !== 0 || (uid !== undefined && target.uid !== uid))
        fail('unsafe-history-file');
    // Never chmod a caller-owned target, including a hardlink or protected existing file.
    for (const suffix of ['-journal', '-wal', '-shm']) {
        regularPath(path + suffix);
        const st = fs.lstatSync(path + suffix, { throwIfNoEntry: false });
        if (st && (!st.isFile() || st.nlink !== 1 || (st.mode & 0o077) !== 0 || (uid !== undefined && st.uid !== uid)))
            fail('unsafe-history-file');
    }
    const db = bun ? new module.Database(path, { create: true }) : new module.DatabaseSync(path);
    return { exec: (s) => db.exec(s), statement: (s) => bun ? db.query(s) : db.prepare(s), close: () => db.close() };
}
function migrate(db) {
    const version = Number(db.statement('PRAGMA user_version').get().user_version);
    if (![0, 1, 2].includes(version))
        fail('history-schema-unsupported');
    if (version === 0) {
        // An unversioned nonempty database is not ours to rewrite.
        if (db.statement("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length)
            fail('history-schema-unsupported');
        db.exec('CREATE TABLE evaluation_history (campaign_id TEXT PRIMARY KEY, source_json TEXT NOT NULL, started_at TEXT, finished_at TEXT, provider TEXT, model TEXT, identity_provenance TEXT NOT NULL, status TEXT NOT NULL, report_uri TEXT NOT NULL, categories_json TEXT NOT NULL, counters_json TEXT NOT NULL); CREATE TABLE evaluation_slots (campaign_id TEXT NOT NULL, case_id INTEGER NOT NULL, arm TEXT NOT NULL, repetition INTEGER NOT NULL, session_name TEXT, started_at TEXT, finished_at TEXT, execution_status TEXT NOT NULL, transcript_path TEXT, transcript_sha256 TEXT, raw_manifest_path TEXT, raw_manifest_sha256 TEXT, final_output_path TEXT, final_output_sha256 TEXT, final_response_path TEXT, final_response_sha256 TEXT, PRIMARY KEY(campaign_id,case_id,arm,repetition));');
    }
    else if (version === 1)
        db.exec("ALTER TABLE evaluation_history ADD COLUMN counters_json TEXT NOT NULL DEFAULT '{}'; ALTER TABLE evaluation_slots ADD COLUMN final_response_path TEXT; ALTER TABLE evaluation_slots ADD COLUMN final_response_sha256 TEXT;");
    db.exec('PRAGMA user_version=2');
}
export async function indexEvaluation(path, report) {
    let db;
    try {
        // All artifact validation and classification precede opening/mutating the index.
        const slots = validate(report), categories = historyCategories(report);
        const id = report.campaign_id || createHash('sha256').update(resolve(report.output)).digest('hex');
        db = await database(path);
        db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
        migrate(db);
        db.statement('INSERT OR REPLACE INTO evaluation_history VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, JSON.stringify(report.selected_targets ?? []), report.started_at ?? null, report.finished_at ?? null, report.configured_identity?.provider ?? report.provider ?? null, report.configured_identity?.model ?? report.model ?? null, report.configured_identity?.provenance ?? 'configured CLI values; unknown stays null; not authenticated endpoint proof', report.status, pathToFileURL(report.review).href, JSON.stringify(categories.labels), JSON.stringify(categories.counters));
        db.statement('DELETE FROM evaluation_slots WHERE campaign_id=?').run(id);
        const stmt = db.statement('INSERT INTO evaluation_slots VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
        for (const slot of slots)
            stmt.run(id, ...slot);
        db.exec('COMMIT');
        return { status: 'indexed', path, campaign_id: id };
    }
    catch (error) {
        try {
            db?.exec('ROLLBACK');
        }
        catch { }
        const message = error.message;
        return { status: 'unavailable', reason: message.startsWith('history-') || message === 'unsafe-history-file' || message === 'unsafe-history-slot' ? message : 'history-index-unavailable', path };
    }
    finally {
        db?.close();
    }
}
/** Zero-model repair: safely reread a retained canonical report and replace only its campaign. */
export async function reindexEvaluation(path, reportPath) {
    try {
        const report = JSON.parse(artifact(reportPath, undefined, undefined, true).toString('utf8'));
        if (report.schema_version !== 'isolated-evaluation-v1' || typeof report.output !== 'string' || resolve(reportPath) !== join(resolve(report.output), 'report.json'))
            fail('history-report-invalid');
        return await indexEvaluation(path, report);
    }
    catch (error) {
        return { status: 'unavailable', reason: error.message.startsWith('history-') ? error.message : 'history-report-invalid', path };
    }
}
