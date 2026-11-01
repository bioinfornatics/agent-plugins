/** Goose session exports are private input, not public backups. Never retain raw JSON.
 * Raw run-created log files are a separate confidential byte-preserving archive. */
import { createHash } from "node:crypto";
import { join, resolve, relative, sep, dirname } from "node:path";
import { constants, lstatSync, mkdirSync, openSync, closeSync, fstatSync, readSync, writeSync, fsyncSync, readdirSync, unlinkSync } from "node:fs";
import { runProcess } from "../evaluation_process.js";
export function evaluationSessionName(prefix, arm, repeat) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(prefix) || !["baseline", "with_targets"].includes(arm) || !Number.isSafeInteger(repeat) || repeat < 1)
        throw new Error("invalid-evaluation-session-name");
    return `${prefix}-${arm}-${repeat}`;
}
/** Only visible plain conversation text and closed content counts cross the boundary.
 * Tool bodies, reasoning, arbitrary session metadata/settings and raw export hashes do not.
 */
export function projectSessionLog(input, expectedName, _redact) {
    const session = input;
    if (!session || session.name !== expectedName || !Array.isArray(session.conversation) || session.conversation.length > 4096)
        throw new Error("unsupported-session-export");
    const messages = [];
    const omitted = {};
    const types = new Set(["toolRequest", "toolResponse", "thinking", "redactedThinking", "image", "document", "systemNotification", "error", "actionRequired", "toolConfirmationRequest"]);
    let textBytes = 0;
    for (const message of session.conversation) {
        if (!message || !Array.isArray(message.content))
            throw new Error("unsupported-session-message");
        if (!["user", "assistant"].includes(message.role) || message.metadata?.userVisible !== true) {
            omitted.hidden_message = (omitted.hidden_message ?? 0) + 1;
            continue;
        }
        const text = [];
        for (const content of message.content) {
            // Assistant-only annotations can contain internal summaries even on visible messages.
            const audience = content?.annotations?.audience;
            if (content?.type === "text" && typeof content.text === "string" && (audience === undefined || (Array.isArray(audience) && audience.includes("user")))) {
                const value = content.text;
                textBytes += Buffer.byteLength(value);
                if (textBytes > 1024 * 1024)
                    throw new Error("session-projection-too-large");
                text.push(value);
            }
            else {
                const type = types.has(content?.type) ? content.type : "other_content";
                omitted[type] = (omitted[type] ?? 0) + 1;
            }
        }
        if (text.length)
            messages.push({ role: message.role, text });
    }
    return { protocol: "goose-session-log-v1", session_name: expectedName, scope: "visible-text-and-closed-content-counts; not a full session backup or OS execution proof",
        redacted: false, completeness: "complete-visible-text", raw_export_retained: false, messages, omitted };
}
/** Export in the same owned HOME/cwd, bounded in memory; failures are evidence gaps, never retries. */
export async function retainSessionLog(argv, cwd, env, name, directory, redact, timeout) {
    const result = await runProcess([...argv, "session", "export", "--name", name, "--format", "json"], cwd, env, "", Math.min(timeout, 30));
    const observation = { exit_code: result.code, signal: result.signal, exit_reason: result.reason, duration_seconds: result.durationSeconds,
        stdout_bytes: result.stdoutBytes, stderr_bytes: result.stderrBytes };
    if (result.reason !== "completed" || result.code !== 0 || result.stdoutDecodeInvalid || result.stdoutBytes > 8 * 1024 * 1024)
        return { status: "unavailable", reason: "session-export-failed-or-incomplete", session_name: name, observation, raw_export_retained: false };
    try {
        const projection = projectSessionLog(JSON.parse(result.stdout), name, redact);
        const bytes = JSON.stringify(projection, null, 2) + "\n";
        if (Buffer.byteLength(bytes) > 2 * 1024 * 1024)
            throw new Error("session-projection-too-large");
        regularAncestors(directory, "dir");
        if ((lstatSync(directory).mode & 0o777) !== 0o700)
            throw new Error("unsafe-archive-permissions");
        exclusiveBytes(join(directory, "session-log.json"), Buffer.from(bytes));
        return { status: "retained", path: "session-log.json", session_name: name, observation, bytes: Buffer.byteLength(bytes),
            sha256: createHash("sha256").update(bytes).digest("hex"), raw_export_retained: false, redacted: false, completeness: projection.completeness, scope: projection.scope };
    }
    catch {
        return { status: "unavailable", reason: "session-projection-rejected", session_name: name, observation, raw_export_retained: false };
    }
}
function archiveError(error) {
    const code = error?.code;
    return code && /^[A-Z0-9_]+$/.test(code) ? code : error instanceof Error && /^(?:unsafe-archive-(?:path|permissions|entry)|changed-archive-entry|excluded-non-log-entry)$/.test(error.message) ? error.message : "capture-rejected";
}
/** Validate each ancestor rather than trusting the final path (or realpath following links). */
function regularAncestors(path, kind) {
    const full = resolve(path), parts = full.split(sep).filter(Boolean);
    let current = full.slice(0, full.length - parts.join(sep).length);
    for (let i = 0; i < parts.length; i++) {
        current = join(current, parts[i]);
        const stat = lstatSync(current);
        if (stat.isSymbolicLink() || (i === parts.length - 1 && kind === "file" ? !stat.isFile() || stat.nlink !== 1 : !stat.isDirectory()))
            throw new Error("unsafe-archive-path");
    }
}
function exclusiveBytes(path, bytes) {
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
        let offset = 0;
        while (offset < bytes.length)
            offset += writeSync(fd, bytes, offset, bytes.length - offset);
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
}
/** A post-child snapshot of only owned log roots. No decoding, masking, byte cap, or retries.
 * The caller owns HOME and must await this before removing it. Exports/settings/DBs are not logs.
 */
export function retainRawLogs(home, directory, name) {
    const manifest = { protocol: "goose-raw-logs-v1", session_name: name, status: "unavailable", files: [], issues: [], origins: [] };
    const destination = join(directory, "raw-logs");
    try {
        regularAncestors(home, "dir");
        regularAncestors(directory, "dir");
        if ((lstatSync(directory).mode & 0o777) !== 0o700)
            throw new Error("unsafe-archive-permissions");
        mkdirSync(destination, { mode: 0o700 }); // Exclusive; never overwrite prior evidence.
    }
    catch (error) {
        manifest.issues.push({ reason: archiveError(error) });
        return manifest;
    }
    const roots = [["path-root-state", "state/logs"], ["xdg-goose-state", ".local/state/goose/logs"]];
    let available = 0;
    const excluded = /(?:^|\/)(?:config(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|keyrings?(?:\.[^/]*)?|sessions\.db(?:-wal|-shm)?|[^/]+\.(?:db|sqlite|sqlite3)(?:-wal|-shm)?)$/i;
    for (const [origin, locator] of roots) {
        const source = join(home, locator);
        try {
            regularAncestors(source, "dir");
        }
        catch (error) {
            manifest.origins.push({ origin, path: locator, status: "unavailable" });
            if (archiveError(error) !== "ENOENT")
                manifest.issues.push({ origin, source_path: locator, reason: archiveError(error) });
            continue;
        }
        available++;
        manifest.origins.push({ origin, path: locator, status: "available" });
        const visit = (dir) => {
            for (const entry of readdirSync(dir).sort()) {
                const from = join(dir, entry), sourcePath = relative(home, from).split(sep).join("/"), target = join(destination, origin, relative(source, from));
                let input, output, created = false;
                try {
                    const stat = lstatSync(from);
                    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || (stat.isFile() && stat.nlink !== 1))
                        throw new Error("unsafe-archive-entry");
                    if (excluded.test(sourcePath))
                        throw new Error("excluded-non-log-entry");
                    if (stat.isDirectory()) {
                        regularAncestors(from, "dir");
                        visit(from);
                        continue;
                    }
                    regularAncestors(from, "file");
                    input = openSync(from, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
                    const opened = fstatSync(input);
                    if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== stat.ino || opened.dev !== stat.dev)
                        throw new Error("changed-archive-entry");
                    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
                    regularAncestors(dirname(target), "dir");
                    output = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
                    created = true;
                    const hash = createHash("sha256"), buffer = Buffer.allocUnsafe(64 * 1024);
                    let bytes = 0, count;
                    while ((count = readSync(input, buffer, 0, buffer.length, null)) > 0) {
                        hash.update(buffer.subarray(0, count));
                        bytes += count;
                        let offset = 0;
                        while (offset < count)
                            offset += writeSync(output, buffer, offset, count - offset);
                    }
                    const after = fstatSync(input);
                    if (bytes !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs)
                        throw new Error("changed-archive-entry");
                    fsyncSync(output);
                    manifest.files.push({ origin, source_path: sourcePath, path: relative(directory, target).split(sep).join("/"), bytes, sha256: hash.digest("hex") });
                }
                catch (error) {
                    manifest.issues.push({ origin, source_path: sourcePath, reason: archiveError(error) });
                    if (created) {
                        if (output !== undefined) {
                            closeSync(output);
                            output = undefined;
                        }
                        try {
                            unlinkSync(target);
                        }
                        catch { }
                    }
                }
                finally {
                    if (input !== undefined)
                        closeSync(input);
                    if (output !== undefined)
                        closeSync(output);
                }
            }
        };
        try {
            visit(source);
        }
        catch (error) {
            manifest.issues.push({ origin, source_path: locator, reason: archiveError(error) });
        }
    }
    manifest.status = available === 0 ? "unavailable" : manifest.issues.length ? "partial" : "complete";
    try {
        const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
        exclusiveBytes(join(destination, "manifest.json"), bytes);
        const fd = openSync(destination, constants.O_RDONLY);
        try {
            fsyncSync(fd);
        }
        finally {
            closeSync(fd);
        }
        return { ...manifest, path: "raw-logs/manifest.json", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    }
    catch (error) {
        manifest.status = manifest.files.length ? "partial" : "unavailable";
        manifest.issues.push({ reason: "manifest-write-" + archiveError(error) });
        return manifest;
    }
}
