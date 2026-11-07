import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile, chmod, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { FilesystemJudgeInstructionWriter, instructionLocation, JUDGE_INSTRUCTION_LIMIT, verifyInstructionFile } from "../../src/adapters/outbound/storage/judge-instruction-files.ts";

const campaign = "11111111-1111-1111-1111-111111111111", attempt = "22222222-2222-2222-2222-222222222222";
test("persistent storage keeps exact UTF-8 packet private; collisions, tampering and link substitution cannot replace it", async () => {
  const root = await mkdtemp(join(tmpdir(), "instruction-storage-"));
  try {
    const location = instructionLocation(root, randomUUID(), campaign, attempt);
    const writer = new FilesystemJudgeInstructionWriter();
    const text = "Exact\r\nUnicode é\uFEFF\n";
    const artifact = await writer.write(location, text);
    assert.deepEqual(artifact, { ...location, sha256: createHash("sha256").update(text).digest("hex") });
    assert.equal(await readFile(location.path, "utf8"), text);
    assert.equal((await lstat(location.path)).mode & 0o777, 0o600);
    assert.equal((await lstat(dirname(location.path))).mode & 0o777, 0o700);
    await assert.rejects(writer.write(location, "replacement"), { code: "EEXIST" });
    assert.equal(await readFile(location.path, "utf8"), text);
    await writeFile(location.path, "changed");
    await assert.rejects(verifyInstructionFile(artifact), /integrity mismatch/);
    await rm(location.path); await symlink(join(root, "victim"), location.path);
    await assert.rejects(writer.write(location, "replacement"), { code: "EEXIST" });
    await assert.rejects(verifyInstructionFile(artifact));
    await assert.rejects(readFile(join(root, "victim")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("oversize and unsafe locations refuse before directory writes; shared directories are not chmodded", async () => {
  const root = await mkdtemp(join(tmpdir(), "instruction-boundary-"));
  try {
    const writer = new FilesystemJudgeInstructionWriter();
    const location = instructionLocation(root, randomUUID(), campaign, attempt);
    await assert.rejects(writer.write(location, "x".repeat(JUDGE_INSTRUCTION_LIMIT + 1)), /size limit/);
    await assert.rejects(lstat(join(root, "judging")), { code: "ENOENT" });
    await assert.rejects(writer.write({ ...location, path: join(root, "arbitrary-script") }, "packet"), /destination/);
    await assert.rejects(lstat(join(root, "arbitrary-script")), { code: "ENOENT" });
    await mkdir(join(root, "judging"), { mode: 0o755 });
    await assert.rejects(writer.write(location, "packet"), /mode 700/);
    assert.equal((await lstat(join(root, "judging"))).mode & 0o777, 0o755);
    await rm(join(root, "judging"), { recursive: true });
    await mkdir(join(root, "outside"));
    await symlink(join(root, "outside"), join(root, "judging"));
    await assert.rejects(writer.write(location, "packet"), /links/);
    await assert.rejects(lstat(join(root, "outside", location.gradeId)), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("bounded files reject relaxed permissions and hardlinks even with unchanged content", async () => {
  const root = await mkdtemp(join(tmpdir(), "instruction-integrity-"));
  try {
    const writer = new FilesystemJudgeInstructionWriter();
    const artifact = await writer.write(instructionLocation(root, randomUUID(), campaign, attempt), "x".repeat(JUDGE_INSTRUCTION_LIMIT));
    assert.equal((await lstat(artifact.path)).size, JUDGE_INSTRUCTION_LIMIT);
    await chmod(artifact.path, 0o644);
    await assert.rejects(verifyInstructionFile(artifact), /Unsafe/);
    await chmod(artifact.path, 0o600); await link(artifact.path, join(root, "duplicate"));
    await assert.rejects(verifyInstructionFile(artifact), /Unsafe/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
