import { closeSync, constants, fsyncSync, lstatSync, linkSync, mkdirSync, openSync, readdirSync, realpathSync, renameSync, unlinkSync, writeSync, } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { acquireDirectoryLockSync, fsyncDirectory } from "./durable_file.js";
import { readTrustedSnapshot } from "./trusted_snapshot.js";
export const FIXED_MIGRATION_POLICY_VERSION = "fixed-workspace-compatibility-v1";
export const MIGRATION_RECEIPT = ".full-eval-migration-receipt.json";
const JOURNAL = ".full-eval-migration-journal.json";
const BACKUP = ".full-eval-job.pre-compat-v1.json";
const STATE = ".full-eval-job.json";
const ARCHIVE = ".full-eval-archive";
const ARCHIVE_SET = "compat-v1";
const LOCK = ".full-eval-migration-lock";
const CLAIM = ".full-eval-job.migration-claim.json";
const DECISION_FIELDS = ["decision_policy", "initial_policy_hash", "sampling_protocol", "sampling_protocol_hash", "family_manifest_path", "family_manifest_hash", "comparison_claim"];
const PHASES = ["validate-legacy", "backup", "write-current-job", "write-receipt"];
const PRESERVED_NAMES = new Set(["benchmark.json", "benchmark.md", "review.html", "receipt.json", "progress.json", "manual-evidence.json", "execution-evidence.json"]);
const CONTROLLED = new Set([STATE, BACKUP, JOURNAL, MIGRATION_RECEIPT, CLAIM, LOCK, ARCHIVE]);
const MAX_CONTROL_BYTES = 64 * 1024 * 1024;
function canonical(value) { return JSON.stringify(value, null, 2) + "\n"; }
function sha(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function fault(boundary) { if (process.env.SKILL_CREATOR_MIGRATION_FAULT === boundary)
    throw new Error(`injected migration fault at ${boundary}`); }
function unsupported(job) { throw new Error(`unsupported full-eval workspace schema ${String(job?.schema_version ?? "missing")}; downgrade and future-version migration are refused`); }
function pathExists(path) { try {
    lstatSync(path);
    return true;
}
catch {
    return false;
} }
function regularNoFollow(path) { try {
    const s = lstatSync(path);
    return s.isFile() && !s.isSymbolicLink();
}
catch {
    return false;
} }
function ownedRegular(path, label) { const s = lstatSync(path); if (s.isSymbolicLink() || !s.isFile())
    throw new Error(label + " is not a no-follow regular file"); const uid = typeof process.geteuid === "function" ? process.geteuid() : undefined; if (uid !== undefined && s.uid !== uid)
    throw new Error(label + " is not owned by the current user"); }
function workspaceIdentity(path) { const lexical = resolve(path), s = lstatSync(lexical); if (s.isSymbolicLink() || !s.isDirectory())
    throw new Error("migration workspace must be a real directory, not a symbolic link"); if (realpathSync(lexical) !== lexical)
    throw new Error("migration workspace must not traverse symbolic-link path components"); return { path: lexical, device: s.dev, inode: s.ino }; }
function sameIdentity(a, b) { return a?.path === b.path && a?.device === b.device && a?.inode === b.inode; }
function assertContained(root, target, label) { const rel = relative(root, resolve(target)); if (!rel || isAbsolute(rel) || rel.split(sep).some(x => x === ".."))
    throw new Error(label + " is not lexically contained in the workspace"); return rel; }
function ensureDirectories(root, targetDir) { const rel = relative(root, resolve(targetDir)); if (isAbsolute(rel) || rel.split(sep).some(x => x === ".."))
    throw new Error("archive directory escapes workspace"); let at = root; for (const part of rel.split(sep).filter(Boolean)) {
    at = join(at, part);
    if (pathExists(at)) {
        const s = lstatSync(at);
        if (s.isSymbolicLink() || !s.isDirectory())
            throw new Error("archive path contains a symlink or special file");
    }
    else {
        mkdirSync(at, { mode: 0o700 });
        fsyncDirectory(dirname(at));
    }
} }
function writeTemp(parent, bytes) { const temp = join(parent, `.migration-${process.pid}-${randomUUID()}.tmp`), fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600), data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes); try {
    let off = 0;
    while (off < data.length)
        off += writeSync(fd, data, off, data.length - off);
    fsyncSync(fd);
}
finally {
    closeSync(fd);
} return temp; }
/** Publish once without ever replacing an existing pathname. */
function publishImmutable(root, path, bytes, label) { assertContained(root, path, label); ensureDirectories(root, dirname(path)); if (pathExists(path))
    throw new Error(label + " already exists; immutable publication refused"); const temp = writeTemp(dirname(path), bytes); try {
    linkSync(temp, path);
    fsyncDirectory(dirname(path));
    ownedRegular(path, label);
    const snap = readTrustedSnapshot(root, path, label, { maxBytes: MAX_CONTROL_BYTES });
    if (snap.sha256 !== sha(bytes))
        throw new Error(label + " publication verification failed");
}
finally {
    try {
        unlinkSync(temp);
    }
    catch { }
} }
function trusted(root, path, label, afterOpen) { ownedRegular(path, label); return readTrustedSnapshot(root, path, label, { maxBytes: MAX_CONTROL_BYTES, afterOpen }); }
function trustedJson(root, path, label) { const snapshot = trusted(root, path, label); let value; try {
    value = JSON.parse(snapshot.bytes.toString("utf8"));
}
catch {
    throw new Error(label + " is not valid JSON");
} if (snapshot.bytes.toString("utf8") !== canonical(value))
    throw new Error(label + " is not canonical JSON"); return { snapshot, value }; }
function externalDigest(path, label) { if (!path)
    return null; let target = resolve(path); try {
    const s = lstatSync(target);
    if (s.isSymbolicLink())
        throw new Error(label + " is a symbolic link");
    if (s.isDirectory())
        target = join(target, "SKILL.md");
}
catch (error) {
    if (error?.code === "ENOENT")
        return null;
    throw error;
} const root = dirname(target); return readTrustedSnapshot(root, target, label, { maxBytes: MAX_CONTROL_BYTES }).sha256; }
function selected(rel) { return PRESERVED_NAMES.has(rel) || rel.endsWith("/execution-evidence.json") || rel.endsWith("/eval_metadata.json"); }
function captureArtifacts(workspace) { const out = new Map(); const walk = (dir) => { const before = lstatSync(dir); if (before.isSymbolicLink() || !before.isDirectory())
    throw new Error("workspace contains a symlink or special directory"); const names = readdirSync(dir).sort(); for (const name of names) {
    const path = join(dir, name), rel = relative(workspace, path).replaceAll("\\", "/");
    if (dir === workspace && CONTROLLED.has(name)) {
        if (name === ARCHIVE && pathExists(path)) {
            const s = lstatSync(path);
            if (s.isSymbolicLink() || !s.isDirectory())
                throw new Error("migration archive is a symlink or special file");
        }
        continue;
    }
    const s = lstatSync(path);
    if (s.isSymbolicLink())
        throw new Error(`workspace artifact ${rel} is a symbolic link`);
    if (s.isDirectory())
        walk(path);
    else if (s.isFile()) {
        if (selected(rel))
            out.set(rel, trusted(workspace, path, `preserved artifact ${rel}`));
    }
    else
        throw new Error(`workspace artifact ${rel} is a special file`);
} const after = lstatSync(dir); if (before.dev !== after.dev || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs || JSON.stringify(names) !== JSON.stringify(readdirSync(dir).sort()))
    throw new Error("workspace changed while artifacts were captured"); }; walk(workspace); return out; }
function hashes(files) { return Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v.sha256])); }
function verifyArchive(workspace, expected) { const root = join(workspace, ARCHIVE, ARCHIVE_SET); if (!pathExists(root)) {
    if (Object.keys(expected).length)
        throw new Error("preserved migration archive is absent");
    return;
} const top = lstatSync(root); if (top.isSymbolicLink() || !top.isDirectory())
    throw new Error("preserved migration archive is not a real directory"); const seen = new Set(); const walk = (dir) => { for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name), rel = relative(root, path).replaceAll("\\", "/"), s = lstatSync(path);
    if (s.isSymbolicLink())
        throw new Error("preserved migration archive contains a symbolic link");
    if (s.isDirectory())
        walk(path);
    else if (s.isFile()) {
        if (!(rel in expected))
            throw new Error(`unrecorded preserved archive artifact ${rel}`);
        const actual = trusted(workspace, path, `archived artifact ${rel}`).sha256;
        if (actual !== expected[rel])
            throw new Error(`archived artifact digest mismatch: ${rel}`);
        seen.add(rel);
    }
    else
        throw new Error("preserved migration archive contains a special file");
} }; walk(root); for (const rel of Object.keys(expected))
    if (!seen.has(rel))
        throw new Error(`preserved archive artifact is absent: ${rel}`); }
function publishArchive(workspace, files) { const root = join(workspace, ARCHIVE, ARCHIVE_SET); ensureDirectories(workspace, root); for (const [rel, snapshot] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    const target = join(root, ...rel.split("/"));
    if (pathExists(target)) {
        const actual = trusted(workspace, target, `archived artifact ${rel}`);
        if (actual.sha256 !== snapshot.sha256)
            throw new Error(`existing archived artifact does not match: ${rel}`);
    }
    else
        publishImmutable(workspace, target, snapshot.bytes, `archived artifact ${rel}`);
} verifyArchive(workspace, hashes(files)); }
function assertLegacy(job, workspace) { if (job?.schema_version !== "2.0")
    unsupported(job); if (!Array.isArray(job.phases) || !job.phases.length || !job.phases.every((p) => typeof p?.name === "string" && Array.isArray(p?.artifacts) && typeof p?.status === "string"))
    throw new Error("ambiguous legacy full-eval job shape; migration refused"); const present = DECISION_FIELDS.filter(key => Object.hasOwn(job, key)); if (present.length)
    throw new Error(`partial or policy-bound full-eval job is not legacy fixed evidence (${present.join(", ")}); migration refused`); let historical = 0; for (const [rel, snapshot] of captureArtifacts(workspace)) {
    if (rel.endsWith("eval_metadata.json") || rel.endsWith("execution-evidence.json")) {
        const value = JSON.parse(snapshot.bytes.toString("utf8"));
        if (value?.decision_policy !== undefined || value?.anytime_quality_policy !== undefined || value?.sampling_protocol !== undefined || value?.comparison_family !== undefined)
            throw new Error("adaptive or policy-bound evidence cannot be migrated as fixed");
        historical++;
    }
} const scaffolded = job.phases.some((p) => p.name === "scaffold" && ["succeeded", "running", "blocked", "failed", "cancelled"].includes(p.status)); if (scaffolded && historical === 0 && !job.phases.some((p) => Array.isArray(p.artifacts) && p.artifacts.length))
    throw new Error("legacy fixed intent is ambiguous because historical metadata/evidence is absent"); }
function currentJob(legacy) { return { ...legacy, decision_policy: "fixed", initial_policy_hash: null, family_manifest_path: null, family_manifest_hash: null, comparison_claim: null, sampling_protocol: null, sampling_protocol_hash: null }; }
function priorStatus(job) { return job.status === "blocked" ? "blocked" : job.status === "cancelled" ? "cancelled" : job.status === "failed" ? "failure" : job.status === "succeeded" ? "success" : "active"; }
function receiptFrom(j) { return { schema_version: "2.0", kind: "full-eval-fixed-compatibility-migration", policy_version: j.policy_version, transaction_id: j.transaction_id, workspace_identity: j.workspace_identity, source: j.source, target: { path: STATE, sha256: j.target.sha256 }, backup: j.backup, archive: j.archive, prior_status: j.prior_status, regeneration_required_for_current_aggregation: true }; }
function validateJournal(workspace, identity) { const { value } = trustedJson(workspace, join(workspace, JOURNAL), "migration journal"); const j = value; if (j?.schema_version !== "2.0" || j.kind !== "full-eval-fixed-compatibility-migration-journal" || j.policy_version !== FIXED_MIGRATION_POLICY_VERSION || typeof j.transaction_id !== "string" || !sameIdentity(j.workspace_identity, identity) || j.target?.path !== STATE || j.backup?.path !== BACKUP || j.archive?.root !== `${ARCHIVE}/${ARCHIVE_SET}` || typeof j.target?.bytes !== "string" || sha(j.target.bytes) !== j.target.sha256 || j.backup.sha256 !== j.source?.job_sha256)
    throw new Error("foreign, malformed, or unsupported migration journal"); const expected = receiptFrom(j); if (j.receipt_sha256 !== sha(canonical(expected)))
    throw new Error("migration journal receipt binding is invalid"); return j; }
function verifyCompleted(workspace, identity, allowRolledBack = false, expectedOriginalSha256) { const journal = validateJournal(workspace, identity), receiptDoc = trustedJson(workspace, join(workspace, MIGRATION_RECEIPT), "migration receipt"), expected = receiptFrom(journal); if (canonical(receiptDoc.value) !== canonical(expected) || receiptDoc.snapshot.sha256 !== journal.receipt_sha256)
    throw new Error("migration receipt does not exactly match its local journal consistency binding"); const state = trusted(workspace, join(workspace, STATE), "migration job"), backup = trusted(workspace, join(workspace, BACKUP), "migration backup"); if (state.sha256 !== expected.target.sha256 && (!allowRolledBack || state.sha256 !== expected.source.job_sha256))
    throw new Error("migration target job digest mismatch"); if (backup.sha256 !== expected.backup.sha256 || backup.sha256 !== expected.source.job_sha256)
    throw new Error("migration backup original digest mismatch"); if (expectedOriginalSha256 !== undefined && backup.sha256 !== expectedOriginalSha256)
    throw new Error("externally supplied expected original job SHA-256 does not match no-follow backup bytes"); let original; try {
    original = JSON.parse(backup.bytes.toString("utf8"));
}
catch {
    throw new Error("migration backup is not valid original job JSON");
} if (externalDigest(typeof original.skill === "string" ? original.skill : undefined, "legacy skill source") !== expected.source.skill_source_sha256 || externalDigest(typeof original.eval_set === "string" ? original.eval_set : undefined, "legacy evaluation plan") !== expected.source.eval_plan_sha256)
    throw new Error("migration source dependency digest mismatch"); const live = hashes(captureArtifacts(workspace)); if (canonical(live) !== canonical(expected.source.artifact_sha256))
    throw new Error("preserved source artifacts changed after migration"); verifyArchive(workspace, expected.archive.artifact_sha256); return { journal, receipt: expected, state, backup }; }
/** Replace a controlled file only after atomically claiming and rechecking the exact expected pathname entry. */
function replaceChecked(workspace, path, expected, replacement) { const claim = join(workspace, CLAIM); if (pathExists(claim))
    throw new Error("stale migration claim requires manual recovery"); const temp = writeTemp(workspace, replacement); let claimed = false; try {
    renameSync(path, claim);
    claimed = true;
    const held = trusted(workspace, claim, "claimed migration job");
    if (held.sha256 !== expected.sha256 || !held.bytes.equals(expected.bytes))
        throw new Error("migration job changed during atomic claim (TOCTOU detected)");
    linkSync(temp, path);
    fsyncDirectory(workspace);
    const installed = trusted(workspace, path, "installed migration job");
    if (installed.sha256 !== sha(replacement))
        throw new Error("installed migration job verification failed");
    unlinkSync(claim);
    claimed = false;
    fsyncDirectory(workspace);
}
catch (error) {
    if (claimed && !pathExists(path)) {
        try {
            renameSync(claim, path);
            claimed = false;
            fsyncDirectory(workspace);
        }
        catch { }
    }
    throw error;
}
finally {
    try {
        unlinkSync(temp);
    }
    catch { }
} }
function recoverClaim(workspace) { const claim = join(workspace, CLAIM), state = join(workspace, STATE); if (!pathExists(claim))
    return; if (pathExists(state))
    throw new Error("ambiguous migration claim and job coexist; migration refused"); const held = trusted(workspace, claim, "interrupted migration claim"); renameSync(claim, state); fsyncDirectory(workspace); const restored = trusted(workspace, state, "recovered migration job"); if (restored.sha256 !== held.sha256)
    throw new Error("migration claim recovery changed bytes"); }
function rollbackCommand(workspace, digest) { return `skill-creator migrate-evaluation ${JSON.stringify(workspace)} --rollback --expected-original-sha256 ${digest}`; }
function result(workspace, status, changed, dry = false, extra = {}) { const digest = extra.original_job_sha256 ?? null; return { schema_version: "1.0", command: "migrate-evaluation", status, exit_code: status === "success" || status === "preview" ? 0 : status === "blocked" ? 3 : 1, workspace, dry_run: dry, changed, policy_version: FIXED_MIGRATION_POLICY_VERSION, phases: PHASES.map(name => ({ name, status: status === "preview" ? "planned" : status === "blocked" ? "blocked" : "complete" })), receipt: regularNoFollow(join(workspace, MIGRATION_RECEIPT)) ? join(workspace, MIGRATION_RECEIPT) : null, original_job_sha256: digest, rollback_command: digest ? rollbackCommand(workspace, digest) : null, ...extra }; }
function normalizeExpectedDigest(value) { if (value === undefined)
    return undefined; if (!/^[a-f0-9]{64}$/.test(value))
    throw new TypeError("--expected-original-sha256 must be exactly 64 lowercase hexadecimal characters"); return value; }
export function migrateFixedWorkspace(workspaceArg, options = {}) {
    const identity = workspaceIdentity(workspaceArg), workspace = identity.path, expectedOriginalSha256 = normalizeExpectedDigest(options.expectedOriginalSha256);
    if (options.rollback && expectedOriginalSha256 === undefined)
        return result(workspace, "blocked", false, false, { reason: "rollback requires externally supplied --expected-original-sha256; local migration files are integrity bindings, not an authenticity authority" });
    const lock = join(workspace, LOCK);
    if (pathExists(lock)) {
        const s = lstatSync(lock);
        if (s.isSymbolicLink() || !s.isDirectory())
            throw new Error("migration lock is a symlink or special file");
    }
    const release = acquireDirectoryLockSync(lock, { timeoutMs: 30_000 });
    try {
        const currentIdentity = workspaceIdentity(workspace);
        if (!sameIdentity(identity, currentIdentity))
            throw new Error("workspace identity changed while acquiring migration lock");
        recoverClaim(workspace);
        const statePath = join(workspace, STATE), backupPath = join(workspace, BACKUP), receiptPath = join(workspace, MIGRATION_RECEIPT), journalPath = join(workspace, JOURNAL);
        if (options.rollback) {
            const verified = verifyCompleted(workspace, identity, true, expectedOriginalSha256);
            const extra = { prior_status: verified.receipt.prior_status, original_job_sha256: verified.backup.sha256 };
            if (verified.state.sha256 === verified.backup.sha256)
                return result(workspace, "success", false, false, { ...extra, reason: "externally authenticated pre-migration job backup already restored" });
            replaceChecked(workspace, statePath, verified.state, verified.backup.bytes);
            return result(workspace, "success", true, false, { ...extra, reason: "restored pre-migration job backup authenticated by the externally supplied digest" });
        }
        if (pathExists(receiptPath)) {
            const verified = verifyCompleted(workspace, identity, true, expectedOriginalSha256);
            const extra = { prior_status: verified.receipt.prior_status, original_job_sha256: verified.backup.sha256 };
            if (verified.state.sha256 === verified.receipt.source.job_sha256) {
                if (expectedOriginalSha256 === undefined)
                    return result(workspace, "blocked", false, false, { ...extra, reason: "reapplying a rolled-back migration requires externally supplied --expected-original-sha256; no rollback or reapply was performed" });
                replaceChecked(workspace, statePath, verified.state, verified.journal.target.bytes);
                verifyCompleted(workspace, identity, false, expectedOriginalSha256);
                return result(workspace, "success", true, false, { ...extra, reason: "reapplied fixed migration after external original-digest verification" });
            }
            return result(workspace, "success", false, false, extra);
        }
        if (!pathExists(statePath))
            throw new Error("full-eval workspace has no .full-eval-job.json");
        const state = trusted(workspace, statePath, "full-eval workspace job", options.afterStateOpen);
        if (expectedOriginalSha256 !== undefined && state.sha256 !== expectedOriginalSha256)
            throw new Error("externally supplied expected original job SHA-256 does not match no-follow legacy job bytes");
        let job;
        try {
            job = JSON.parse(state.bytes.toString("utf8"));
        }
        catch {
            throw new Error("full-eval workspace job is not valid JSON");
        }
        let journal;
        if (pathExists(journalPath))
            journal = validateJournal(workspace, identity);
        else {
            assertLegacy(job, workspace);
            const artifacts = captureArtifacts(workspace), migrated = canonical(currentJob(job)), source = { job_sha256: state.sha256, skill_source_sha256: externalDigest(typeof job.skill === "string" ? job.skill : undefined, "legacy skill source"), eval_plan_sha256: externalDigest(typeof job.eval_set === "string" ? job.eval_set : undefined, "legacy evaluation plan"), artifact_sha256: hashes(artifacts) };
            const base = { schema_version: "2.0", kind: "full-eval-fixed-compatibility-migration-journal", policy_version: FIXED_MIGRATION_POLICY_VERSION, transaction_id: randomUUID(), workspace_identity: identity, source, target: { path: STATE, sha256: sha(migrated), bytes: migrated }, backup: { path: BACKUP, sha256: source.job_sha256 }, archive: { root: `${ARCHIVE}/${ARCHIVE_SET}`, artifact_sha256: source.artifact_sha256 }, prior_status: priorStatus(job) };
            const provisional = { ...base, receipt_sha256: "" };
            provisional.receipt_sha256 = sha(canonical(receiptFrom(provisional)));
            journal = provisional;
            if (options.dryRun)
                return result(workspace, "preview", true, true, { prior_status: journal.prior_status, original_job_sha256: journal.source.job_sha256 });
            publishImmutable(workspace, journalPath, canonical(journal), "migration journal");
            fault("after-journal");
        }
        const artifacts = captureArtifacts(workspace);
        if (canonical(hashes(artifacts)) !== canonical(journal.source.artifact_sha256))
            throw new Error("preserved source artifacts changed after migration validation");
        if (pathExists(backupPath)) {
            const backup = trusted(workspace, backupPath, "migration backup");
            if (backup.sha256 !== journal.source.job_sha256)
                throw new Error("migration backup verification failed");
        }
        else {
            const now = trusted(workspace, statePath, "legacy migration job");
            if (now.sha256 !== journal.source.job_sha256)
                throw new Error("legacy job changed after migration validation");
            publishImmutable(workspace, backupPath, now.bytes, "migration backup");
        }
        publishArchive(workspace, artifacts);
        fault("after-backup");
        let now = trusted(workspace, statePath, "migration job before update");
        if (now.sha256 !== journal.target.sha256) {
            if (now.sha256 !== journal.source.job_sha256)
                throw new Error("partial migration target is ambiguous; rollback required");
            replaceChecked(workspace, statePath, now, journal.target.bytes);
            now = trusted(workspace, statePath, "migrated job");
        }
        fault("after-job");
        if (pathExists(receiptPath))
            throw new Error("migration receipt appeared concurrently");
        publishImmutable(workspace, receiptPath, canonical(receiptFrom(journal)), "migration receipt");
        fault("after-receipt");
        const verified = verifyCompleted(workspace, identity, false, expectedOriginalSha256);
        return result(workspace, "success", true, false, { prior_status: verified.receipt.prior_status, original_job_sha256: verified.backup.sha256 });
    }
    finally {
        release();
    }
}
export function legacyMigrationNeeded(workspaceArg) { try {
    const identity = workspaceIdentity(workspaceArg), path = join(identity.path, STATE);
    if (!regularNoFollow(path))
        return false;
    const job = JSON.parse(trusted(identity.path, path, "full-eval workspace job").bytes.toString("utf8"));
    return job?.schema_version === "2.0" && !DECISION_FIELDS.some(key => Object.hasOwn(job, key));
}
catch {
    return false;
} }
export async function main() { try {
    const args = process.argv.slice(2), digestIndex = args.indexOf("--expected-original-sha256"), expectedOriginalSha256 = digestIndex >= 0 ? args[digestIndex + 1] : undefined, workspace = args.find((x, i) => !x.startsWith("-") && (digestIndex < 0 || i !== digestIndex + 1));
    if (!workspace)
        throw new TypeError("workspace directory is required");
    if (digestIndex >= 0 && !expectedOriginalSha256)
        throw new TypeError("--expected-original-sha256 requires a digest value");
    const value = migrateFixedWorkspace(workspace, { dryRun: args.includes("--dry-run") || args.includes("--preview"), rollback: args.includes("--rollback"), expectedOriginalSha256 });
    console.log(JSON.stringify(value, null, 2));
    return value.exit_code;
}
catch (error) {
    console.log(JSON.stringify({ schema_version: "1.0", command: "migrate-evaluation", status: "failure", exit_code: 1, workspace: null, dry_run: false, changed: false, policy_version: FIXED_MIGRATION_POLICY_VERSION, phases: PHASES.map(name => ({ name, status: "failed" })), receipt: null, original_job_sha256: null, rollback_command: null, reason: error.message }, null, 2));
    return 1;
} }
