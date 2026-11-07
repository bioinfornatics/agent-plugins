import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { registryDirectory } from "./registry-files.js";
export const JUDGE_INSTRUCTION_LIMIT = 16 * 1024 * 1024;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function instructionLocation(output, gradeId, campaignId, attemptId) {
    if (!uuid.test(gradeId) || !uuid.test(campaignId) || !(uuid.test(attemptId) || attemptId.startsWith(`${campaignId}-`) && /^\d+$/.test(attemptId.slice(campaignId.length + 1))) || !isAbsolute(output) || resolve(output) !== output)
        throw new Error("Invalid judge instruction attribution");
    return { path: join(output, "judging", gradeId, "instructions.txt"), gradeId, campaignId, attemptId };
}
/** Validate stored attribution lexically, without opening a caller-controlled file during history reads. */
export function validateInstructionArtifact(artifact, expected, hash) {
    if (!artifact || Object.keys(artifact).sort().join(",") !== "attemptId,campaignId,gradeId,path,sha256" ||
        artifact.path !== expected.path || artifact.gradeId !== expected.gradeId || artifact.campaignId !== expected.campaignId || artifact.attemptId !== expected.attemptId ||
        !/^[a-f0-9]{64}$/.test(artifact.sha256) || artifact.sha256 !== hash)
        throw new Error("Invalid judge instruction binding");
}
async function inspectDirectories(path) {
    let current = parse(path).root;
    for (const part of path.slice(current.length).split(sep).filter(Boolean)) {
        current = join(current, part);
        const info = await lstat(current);
        if (!info.isDirectory() || info.isSymbolicLink())
            throw new Error("Unsafe judge instruction directory");
    }
    for (const directory of [dirname(path), path]) {
        const info = await lstat(directory);
        if ((info.mode & 0o777) !== 0o700 || (process.getuid && info.uid !== process.getuid()))
            throw new Error("Judge instruction directories must be private");
    }
}
/** File integrity at append: no links, private ownership, exact bounded bytes. History does not read archives. */
export async function verifyInstructionFile(artifact) {
    await inspectDirectories(dirname(artifact.path));
    const handle = await open(artifact.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const info = await handle.stat();
        if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600 || (process.getuid && info.uid !== process.getuid()) || info.size > JUDGE_INSTRUCTION_LIMIT)
            throw new Error("Unsafe judge instruction file");
        const bytes = Buffer.alloc(info.size + 1);
        let length = 0;
        while (length < bytes.length) {
            const read = await handle.read(bytes, length, bytes.length - length, null);
            if (!read.bytesRead)
                break;
            length += read.bytesRead;
        }
        if (length !== info.size || createHash("sha256").update(bytes.subarray(0, length)).digest("hex") !== artifact.sha256)
            throw new Error("Judge instruction integrity mismatch");
    }
    finally {
        await handle.close();
    }
}
/** Storage-owned, exclusive persistent writer. No default global/temp destination and no overwrite.
 * Component checks reject observed links; like registry I/O this is not an OS sandbox against path races. */
export class FilesystemJudgeInstructionWriter {
    async write(location, instructions, bundle) {
        const output = dirname(dirname(dirname(location.path)));
        const expected = instructionLocation(output, location.gradeId, location.campaignId, location.attemptId);
        if (location.path !== expected.path)
            throw new Error("Invalid judge instruction destination");
        const bytes = Buffer.from(instructions, "utf8");
        if (bytes.length > JUDGE_INSTRUCTION_LIMIT)
            throw new Error("Judge instruction size limit exceeded");
        // Check/create each ancestor before descending; never chmod shared or existing user directories.
        await registryDirectory(join(output, "judging"), true);
        await registryDirectory(dirname(location.path), true);
        const handle = await open(location.path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try {
            await handle.chmod(0o600);
            await handle.writeFile(bytes);
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        if (bundle) {
            const evidenceRoot = join(dirname(location.path), "evidence");
            await registryDirectory(evidenceRoot, true);
            const entries = JSON.parse(bundle.manifest).artifacts;
            if (Buffer.byteLength(bundle.manifest) > 128 * 1024 || entries.length > 10000)
                throw new Error("Judge manifest size limit exceeded");
            for (const file of bundle.files) {
                const bytes = Buffer.from(file.text, "utf8");
                const entry = entries.find(e => e.path === file.name);
                if (!/^artifact-[1-9][0-9]*$/.test(file.name) || !entry || entry.kind !== "text" || entry.bytes !== bytes.length || entry.sha256 !== file.sha256 || createHash("sha256").update(bytes).digest("hex") !== file.sha256)
                    throw new Error("Judge evidence integrity mismatch");
                await exclusiveFile(join(evidenceRoot, file.name), bytes);
            }
            if (entries.filter(e => e.kind === "text").length !== bundle.files.length)
                throw new Error("Judge evidence manifest mismatch");
            await exclusiveFile(join(evidenceRoot, "manifest.json"), Buffer.from(bundle.manifest));
        }
        const artifact = { ...expected, sha256: createHash("sha256").update(bytes).digest("hex") };
        await verifyInstructionFile(artifact);
        return artifact;
    }
}
async function exclusiveFile(path, bytes) {
    const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
        await handle.chmod(0o600);
        await handle.writeFile(bytes);
        await handle.sync();
    }
    finally {
        await handle.close();
    }
}
/** Append verifies only the small manifest, not all already-authenticated multi-MB copies.
 * Historical reads validate retained packet/hash bindings without reopening archives. */
export async function verifyEvidenceManifest(artifact, hash) {
    const directory = join(dirname(artifact.path), "evidence");
    await inspectDirectories(dirname(artifact.path));
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700)
        throw new Error("Unsafe judge evidence directory");
    const handle = await open(join(directory, "manifest.json"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const info = await handle.stat();
        if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600 || info.size > 128 * 1024 || (process.getuid && info.uid !== process.getuid()))
            throw new Error("Unsafe judge evidence manifest");
        const bytes = await handle.readFile();
        if (bytes.length !== info.size || createHash("sha256").update(bytes).digest("hex") !== hash)
            throw new Error("Judge evidence manifest integrity mismatch");
    }
    finally {
        await handle.close();
    }
}
