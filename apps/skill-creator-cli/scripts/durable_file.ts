import {
	closeSync,
	constants,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { hostname } from "node:os";

/**
 * Persistence invariant: a successful return means file bytes reached fsync,
 * the atomic rename completed, and the containing directory was fsynced.
 */
function errorCode(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error
		? String((error as { code?: unknown }).code)
		: undefined;
}

export function fsyncDirectory(path: string): void {
	let fd: number | undefined;
	try {
		fd = openSync(path, constants.O_RDONLY);
		fsyncSync(fd);
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}
export function durableAtomicWrite(
	path: string,
	data: string | Buffer,
	mode = 0o600,
): void {
	const parent = dirname(path);
	mkdirSync(parent, { recursive: true });
	const temp = resolve(parent, "." + process.pid + "-" + randomUUID() + ".tmp");
	let fd: number | undefined;
	try {
		fd = openSync(
			temp,
			constants.O_WRONLY |
				constants.O_CREAT |
				constants.O_EXCL |
				(constants.O_NOFOLLOW ?? 0),
			mode,
		);
		const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
		let offset = 0;
		while (offset < bytes.length)
			offset += writeSync(fd, bytes, offset, bytes.length - offset);
		fsyncSync(fd);
		closeSync(fd);
		fd = undefined;
		renameSync(temp, path);
		fsyncDirectory(parent);
	} finally {
		if (fd !== undefined) closeSync(fd);
		try {
			rmSync(temp, { force: true });
		} catch {}
	}
}
/**
 * Locking invariant: ownership is identified by an unguessable token plus the
 * host, PID, and process start time. A releaser never removes another owner.
 * Remote owners are reclaimed only after the configured stale interval.
 */
interface LockOwner {
	schema_version: "1.0";
	token: string;
	pid: number;
	host: string;
	process_start: string | null;
	created_at: string;
}
function processStart(pid: number): string | null {
	try {
		const text = readFileSync("/proc/" + pid + "/stat", "utf8"),
			end = text.lastIndexOf(")");
		return text.slice(end + 2).split(" ")[19] ?? null;
	} catch {
		return null;
	}
}
function alive(owner: LockOwner): boolean {
	if (owner.host !== hostname()) return true;
	try {
		process.kill(owner.pid, 0);
	} catch (error: unknown) {
		return errorCode(error) === "EPERM";
	}
	const start = processStart(owner.pid);
	return owner.process_start === null || start === owner.process_start;
}
function ownerAt(dir: string): LockOwner | null {
	try {
		const modern = resolve(dir, "owner.json");
		if (lstatSync(modern).isFile()) {
			const x = JSON.parse(readFileSync(modern, "utf8"));
			return x?.schema_version === "1.0" &&
				typeof x.token === "string" &&
				Number.isSafeInteger(x.pid) &&
				typeof x.host === "string" &&
				typeof x.created_at === "string"
				? x
				: null;
		}
	} catch {}
	try {
		const legacy = resolve(dir, "owner"),
			text = readFileSync(legacy, "utf8").trim(),
			pid = Number(text),
			stat = lstatSync(dir);
		return Number.isSafeInteger(pid) && pid > 0
			? {
					schema_version: "1.0",
					token: "legacy",
					pid,
					host: hostname(),
					process_start: null,
					created_at: new Date(stat.mtimeMs).toISOString(),
				}
			: null;
	} catch {
		return null;
	}
}
export interface DirectoryLockOptions {
	timeoutMs?: number;
	pollMs?: number;
	staleMs?: number;
	now?: () => number;
}
export async function acquireDirectoryLock(
	dir: string,
	options: DirectoryLockOptions = {},
): Promise<() => void> {
	const timeout = options.timeoutMs ?? 15_000,
		poll = options.pollMs ?? 25,
		stale = options.staleMs ?? 300_000,
		now = options.now ?? Date.now,
		start = now(),
		token = randomUUID(),
		owner: LockOwner = {
			schema_version: "1.0",
			token,
			pid: process.pid,
			host: hostname(),
			process_start: processStart(process.pid),
			created_at: new Date(now()).toISOString(),
		};
	mkdirSync(dirname(dir), { recursive: true });
	for (;;) {
		try {
			mkdirSync(dir, { mode: 0o700 });
			durableAtomicWrite(
				resolve(dir, "owner.json"),
				JSON.stringify(owner) + "\n",
			);
			break;
		} catch (error: unknown) {
			if (errorCode(error) !== "EEXIST") throw error;
			const existing = ownerAt(dir),
				age = existing
					? now() - Date.parse(existing.created_at)
					: (() => {
							try {
								return now() - lstatSync(dir).mtimeMs;
							} catch {
								return 0;
							}
						})();
			const reclaim = existing
				? !alive(existing) || (existing.host !== hostname() && age >= stale)
				: age >= stale;
			if (reclaim) {
				const quarantine = dir + ".stale-" + process.pid + "-" + randomUUID();
				try {
					renameSync(dir, quarantine);
					rmSync(quarantine, { recursive: true, force: true });
					continue;
				} catch {}
			}
			if (now() - start >= timeout)
				throw new Error("timed out waiting for coordination lock: " + dir);
			await new Promise((r) =>
				setTimeout(r, Math.min(poll, Math.max(1, timeout - (now() - start)))),
			);
		}
	}
	let released = false;
	return () => {
		if (released) return;
		released = true;
		const current = ownerAt(dir);
		if (current?.token !== token) return;
		const quarantine = dir + ".release-" + process.pid + "-" + randomUUID();
		try {
			renameSync(dir, quarantine);
			const moved = ownerAt(quarantine);
			if (moved?.token === token)
				rmSync(quarantine, { recursive: true, force: true });
			else
				try {
					renameSync(quarantine, dir);
				} catch {}
		} catch {}
	};
}

export function acquireDirectoryLockSync(
	dir: string,
	options: DirectoryLockOptions = {},
): () => void {
	const timeout = options.timeoutMs ?? 15_000,
		poll = options.pollMs ?? 25,
		stale = options.staleMs ?? 300_000,
		now = options.now ?? Date.now,
		start = now(),
		token = randomUUID(),
		owner: LockOwner = {
			schema_version: "1.0",
			token,
			pid: process.pid,
			host: hostname(),
			process_start: processStart(process.pid),
			created_at: new Date(now()).toISOString(),
		};
	mkdirSync(dirname(dir), { recursive: true });
	for (;;) {
		try {
			mkdirSync(dir, { mode: 0o700 });
			durableAtomicWrite(
				resolve(dir, "owner.json"),
				JSON.stringify(owner) + "\n",
			);
			break;
		} catch (error: unknown) {
			if (errorCode(error) !== "EEXIST") throw error;
			const existing = ownerAt(dir),
				age = existing
					? now() - Date.parse(existing.created_at)
					: (() => {
							try {
								return now() - lstatSync(dir).mtimeMs;
							} catch {
								return 0;
							}
						})();
			if (
				existing
					? !alive(existing) || (existing.host !== hostname() && age >= stale)
					: age >= stale
			) {
				const quarantine = dir + ".stale-" + process.pid + "-" + randomUUID();
				try {
					renameSync(dir, quarantine);
					rmSync(quarantine, { recursive: true, force: true });
					continue;
				} catch {}
			}
			if (now() - start >= timeout)
				throw new Error("timed out waiting for coordination lock: " + dir);
			Atomics.wait(
				new Int32Array(new SharedArrayBuffer(4)),
				0,
				0,
				Math.min(poll, Math.max(1, timeout - (now() - start))),
			);
		}
	}
	let released = false;
	return () => {
		if (released) return;
		released = true;
		if (ownerAt(dir)?.token !== token) return;
		const quarantine = dir + ".release-" + process.pid + "-" + randomUUID();
		try {
			renameSync(dir, quarantine);
			if (ownerAt(quarantine)?.token === token)
				rmSync(quarantine, { recursive: true, force: true });
			else
				try {
					renameSync(quarantine, dir);
				} catch {}
		} catch {}
	};
}
