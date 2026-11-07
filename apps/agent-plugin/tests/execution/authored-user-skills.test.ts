import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { collectAuthoredUserSkills, snapshotUserSkills } from "../../src/adapters/outbound/hosts/goose/authored-user-skills.ts";
import { FILE_LIMIT } from "../../src/adapters/outbound/hosts/goose/private-files.ts";

async function fixture(run: (home: string, root: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "authored-skills-"));
  try { await run(home, join(home, ".agents", "skills")); }
  finally { await rm(home, { recursive: true, force: true }); }
}
async function put(root: string, path: string, content = "fixture"): Promise<void> {
  const parts = path.split("/");
  await mkdir(join(root, ...parts.slice(0, -1)), { recursive: true });
  await writeFile(join(root, path), content);
}
async function collect(home: string, baseline: Awaited<ReturnType<typeof snapshotUserSkills>>): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  await collectAuthoredUserSkills(home, baseline, async (path, name) => { files[name] = await readFile(path, "utf8"); });
  return files;
}

test("new global authored Skill retains evals but never exports existing treatment roots", async () => fixture(async (home, root) => {
  await put(root, "treatment/SKILL.md", "installed");
  const baseline = await snapshotUserSkills(home);
  await put(root, "authored/SKILL.md", "authored");
  await put(root, "authored/evals/evals.json", '{"evals":[]}');
  for (const privateName of [".git", ".agents", ".config", "node_modules", ".env"]) await put(root, `authored/${privateName}/secret`, "private");
  assert.deepEqual(await collect(home, baseline), { "authored/SKILL.md": "authored", "authored/evals/evals.json": '{"evals":[]}' });
}));

test("baseline is unfiltered and any existing root file modification/addition/deletion rejects before visits", async () => {
  for (const mutation of ["change", "add", "delete", "remove-root"]) await fixture(async (home, root) => {
    await put(root, "treatment/.env", "installed-secret");
    const baseline = await snapshotUserSkills(home);
    await put(root, "authored/SKILL.md");
    if (mutation === "change") await writeFile(join(root, "treatment/.env"), "modified");
    if (mutation === "add") await put(root, "treatment/new.txt");
    if (mutation === "delete") await rm(join(root, "treatment/.env"));
    if (mutation === "remove-root") await rm(join(root, "treatment"), { recursive: true });
    let visits = 0;
    await assert.rejects(collectAuthoredUserSkills(home, baseline, async () => { visits++; }), { message: "Existing user Skill changed during execution" });
    assert.equal(visits, 0);
  });
});

test("missing Skill root is empty without creating it; deleting a populated root rejects", async () => fixture(async (home, root) => {
  const baseline = await snapshotUserSkills(home);
  assert.deepEqual(await collect(home, baseline), {});
  await assert.rejects(readFile(root), { code: "ENOENT" });
  await put(root, "treatment/SKILL.md");
  const installed = await snapshotUserSkills(home);
  await rm(root, { recursive: true });
  await assert.rejects(collect(home, installed), { message: "Existing user Skill changed during execution" });
}));

test("ancestor, Skill root and regular leaf symlinks reject, while excluded private config links are not followed", async () => {
  for (const target of [".agents", ".agents/skills", ".agents/skills/authored", ".agents/skills/authored/SKILL.md"]) await fixture(async (home) => {
    const baseline = await snapshotUserSkills(home);
    await mkdir(join(home, "outside"));
    const parts = target.split("/");
    await mkdir(join(home, ...parts.slice(0, -1)), { recursive: true });
    await symlink(join(home, "outside"), join(home, target));
    await assert.rejects(collect(home, baseline), /Symlink/);
    await assert.rejects(snapshotUserSkills(home), /Symlink/);
  });
  await fixture(async (home, root) => {
    const baseline = await snapshotUserSkills(home);
    await put(root, "authored/SKILL.md", "safe");
    await symlink(home, join(root, "authored/.config"));
    assert.deepEqual(await collect(home, baseline), { "authored/SKILL.md": "safe" });
  });
});

test("oversized baseline and authored files reject bounded regular reads", async () => fixture(async (home, root) => {
  const baseline = await snapshotUserSkills(home);
  await put(root, "authored/SKILL.md");
  await truncate(join(root, "authored/SKILL.md"), FILE_LIMIT + 1);
  await assert.rejects(snapshotUserSkills(home), /bounded regular file/);
  await assert.rejects(collect(home, baseline), /bounded regular file/);
}));

test("byte budget is shared across new Skill roots and unfiltered baseline roots", async () => fixture(async (home, root) => {
  const baseline = await snapshotUserSkills(home);
  // Each root is below TREE_LIMIT; together seventeen FILE_LIMIT files exceed it.
  for (let i = 0; i < 17; i++) {
    const path = `${i < 9 ? "first" : "second"}/${i}.txt`;
    await put(root, path);
    await truncate(join(root, path), FILE_LIMIT);
  }
  await assert.rejects(collect(home, baseline), /aggregate limit/);
  await assert.rejects(snapshotUserSkills(home), /aggregate limit/);
}));

test("entry budget counts empty directories across roots, not just files or per-root walks", async () => fixture(async (home, root) => {
  const baseline = await snapshotUserSkills(home);
  for (const name of ["first", "second"]) {
    await mkdir(join(root, name), { recursive: true });
    for (let batch = 0; batch < 100; batch++) {
      await Promise.all(Array.from({ length: 100 }, (_, i) => mkdir(join(root, name, `empty-${batch * 100 + i}`))));
    }
  }
  await assert.rejects(collect(home, baseline), /entry limit/);
  await assert.rejects(snapshotUserSkills(home), /entry limit/);
}));
