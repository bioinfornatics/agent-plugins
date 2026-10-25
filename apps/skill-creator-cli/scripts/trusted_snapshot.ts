import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	openSync,
	readFileSync,
	readdirSync,
	realpathSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const DEFAULT_TRUSTED_FILE_LIMIT = 16 * 1024 * 1024;
const TREE_CAPTURE_RETRIES = 3;
export interface TrustedSnapshot {
	path: string;
	bytes: Buffer;
	sha256: string;
}
export interface TrustedSnapshotOptions {
	maxBytes?: number;
	allowEmpty?: boolean;
	afterOpen?: () => void;
}
function contained(
	root: string,
	target: string,
	label: string,
): { root: string; target: string; relative: string } {
	const lexicalRoot = resolve(root),
		lexicalTarget = resolve(target),
		rel = relative(lexicalRoot, lexicalTarget);
	if (!rel || isAbsolute(rel) || rel.split(sep).some((part) => part === ".."))
		throw new TypeError(label + " must be a lexically contained file");
	const realRoot = realpathSync(lexicalRoot),
		realTarget = realpathSync(lexicalTarget),
		realRel = relative(realRoot, realTarget);
	if (
		!realRel ||
		isAbsolute(realRel) ||
		realRel.split(sep).some((part) => part === "..")
	)
		throw new TypeError(label + " must be realpath-contained");
	let current = lexicalRoot;
	for (const part of rel.split(sep)) {
		current = join(current, part);
		const named = lstatSync(current);
		if (named.isSymbolicLink())
			throw new TypeError(
				label + " must not contain symbolic-link path components",
			);
	}
	return { root: realRoot, target: lexicalTarget, relative: rel };
}
function sameFile(
	a: NonNullable<ReturnType<typeof fstatSync>>,
	b: NonNullable<ReturnType<typeof fstatSync>>,
): boolean {
	return (
		a.dev === b.dev &&
		a.ino === b.ino &&
		a.mode === b.mode &&
		a.size === b.size &&
		a.mtimeMs === b.mtimeMs &&
		a.ctimeMs === b.ctimeMs
	);
}
/**
 * Trust-boundary invariant: containment and file identity are checked before
 * and after the bounded read; symbolic links and mid-read replacement fail.
 */
export function readTrustedSnapshot(
	root: string,
	target: string,
	label = "trusted evidence",
	options: TrustedSnapshotOptions = {},
): TrustedSnapshot {
	const max = options.maxBytes ?? DEFAULT_TRUSTED_FILE_LIMIT;
	if (!Number.isSafeInteger(max) || max < 1)
		throw new TypeError("trusted snapshot maxBytes must be positive");
	const checked = contained(root, target, label);
	let fd: number | undefined;
	try {
		const namedBefore = lstatSync(checked.target);
		if (!namedBefore.isFile())
			throw new TypeError(label + " must be a regular file");
		fd = openSync(
			checked.target,
			constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
		);
		const before = fstatSync(fd);
		if (
			!before.isFile() ||
			before.dev !== namedBefore.dev ||
			before.ino !== namedBefore.ino
		)
			throw new Error(label + " path identity changed before capture");
		if (
			(before.size === 0 && !options.allowEmpty) ||
			before.size < 0 ||
			before.size > max
		)
			throw new TypeError(label + " exceeds its bounded snapshot size");
		const bytes = readFileSync(fd);
		options.afterOpen?.();
		const after = fstatSync(fd),
			namedAfter = lstatSync(checked.target);
		const realAfter = realpathSync(checked.target),
			realRel = relative(checked.root, realAfter);
		if (isAbsolute(realRel) || realRel.split(sep).some((part) => part === ".."))
			throw new Error(label + " escaped containment during capture");
		if (
			!sameFile(before, after) ||
			namedAfter.isSymbolicLink() ||
			!namedAfter.isFile() ||
			after.dev !== namedAfter.dev ||
			after.ino !== namedAfter.ino ||
			bytes.length !== before.size
		)
			throw new Error(label + " changed while being captured");
		return {
			path: checked.target,
			bytes,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		};
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}
export function readTrustedJson<T = unknown>(
	root: string,
	target: string,
	label = "trusted JSON evidence",
	options: TrustedSnapshotOptions = {},
): T {
	const snapshot = readTrustedSnapshot(root, target, label, options);
	try {
		return JSON.parse(snapshot.bytes.toString("utf8")) as T;
	} catch {
		throw new TypeError(label + " is not valid JSON");
	}
}
export interface TrustedArtifactSnapshot {
	sha256: string;
	files: Map<string, TrustedSnapshot>;
}
type Entry = {
	type: "directory" | "file";
	path: string;
	size: number;
	sha256?: string;
	snapshot?: TrustedSnapshot;
};
function manifest(
	root: string,
	target: string,
	label: string,
): { identity: string; entries: Entry[]; files: Map<string, TrustedSnapshot> } {
	const entries: Entry[] = [],
		files = new Map<string, TrustedSnapshot>();
	const walk = (directory: string): void => {
		const before = lstatSync(directory);
		if (before.isSymbolicLink() || !before.isDirectory())
			throw new TypeError(label + " contains a non-directory or symbolic link");
		const names = readdirSync(directory).sort();
		for (const name of names) {
			const child = join(directory, name),
				stat = lstatSync(child),
				key = relative(target, child).replaceAll("\\", "/");
			if (stat.isSymbolicLink())
				throw new TypeError(label + " must not contain symbolic links");
			if (stat.isDirectory()) {
				entries.push({ type: "directory", path: key, size: 0 });
				walk(child);
			} else if (stat.isFile()) {
				const snapshot = readTrustedSnapshot(root, child, label);
				files.set(key, snapshot);
				entries.push({
					type: "file",
					path: key,
					size: snapshot.bytes.length,
					sha256: snapshot.sha256,
					snapshot,
				});
			} else throw new TypeError(label + " contains a non-regular entry");
		}
		const after = lstatSync(directory);
		if (
			!sameFile(before, after) ||
			JSON.stringify(names) !== JSON.stringify(readdirSync(directory).sort())
		)
			throw new Error(label + " changed while being captured");
	};
	const top = lstatSync(target);
	walk(target);
	const after = lstatSync(target);
	if (!sameFile(top, after))
		throw new Error(label + " changed while being captured");
	const identity = JSON.stringify(
		entries.map(({ type, path, size, sha256 }) => ({
			type,
			path,
			size,
			sha256,
		})),
	);
	return { identity, entries, files };
}
function frame(
	hash: ReturnType<typeof createHash>,
	type: string,
	data: string | Buffer,
): void {
	const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8"),
		head = Buffer.alloc(9);
	head.writeUInt8(type === "file" ? 1 : type === "directory" ? 2 : 3, 0);
	head.writeBigUInt64BE(BigInt(bytes.length), 1);
	hash.update(head);
	hash.update(bytes);
}
export function captureTrustedArtifact(
	root: string,
	target: string,
	label = "trusted evidence",
): TrustedArtifactSnapshot {
	const named = lstatSync(target);
	if (named.isSymbolicLink())
		throw new TypeError(label + " must not be a symbolic link");
	if (named.isFile()) {
		const snapshot = readTrustedSnapshot(root, target, label);
		const h = createHash("sha256");
		frame(h, "manifest", "trusted-artifact-v2");
		frame(h, "file", "");
		frame(h, "manifest", snapshot.bytes);
		return { sha256: h.digest("hex"), files: new Map([["", snapshot]]) };
	}
	if (!named.isDirectory())
		throw new TypeError(label + " must be a regular file or directory");
	const realRoot = realpathSync(resolve(root)),
		realDir = realpathSync(target),
		rel = relative(realRoot, realDir);
	if (isAbsolute(rel) || rel.split(sep).some((part) => part === ".."))
		throw new TypeError(label + " directory must be contained");
	for (let attempt = 0; attempt < TREE_CAPTURE_RETRIES; attempt++) {
		const first = manifest(root, target, label),
			second = manifest(root, target, label);
		if (first.identity !== second.identity) continue;
		const hash = createHash("sha256");
		frame(hash, "manifest", "trusted-artifact-v2");
		frame(hash, "manifest", String(first.entries.length));
		for (const entry of first.entries) {
			frame(hash, entry.type, entry.path);
			frame(hash, "manifest", String(entry.size));
			if (entry.type === "file") frame(hash, "manifest", entry.snapshot!.bytes);
		}
		return { sha256: hash.digest("hex"), files: first.files };
	}
	throw new Error(label + " changed repeatedly while being captured");
}
export function hashTrustedArtifact(
	root: string,
	target: string,
	label = "trusted evidence",
): string {
	return captureTrustedArtifact(root, target, label).sha256;
}
