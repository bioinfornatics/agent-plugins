import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { namespacePluginSkills, namespaceSkillContent } from "../../src/adapters/outbound/hosts/goose/namespace-plugin-skills.ts";
import { restoreSnapshot } from "../../src/adapters/outbound/hosts/goose/private-files.ts";

// Detect losing metadata/body, choosing the folder instead of the declared name, or double prefixes.
for (const [label, raw, expected] of [
  ["declared name", "---\nname: declared\ndescription: Keep me\nmetadata:\n  tier: 2\n---\nBody --- unchanged\n", "bundle:declared"],
  ["anchored name", "---\nname: &original child\ndescription: *original\n---\nBody\n", "bundle:child"],
  ["missing name", "---\ndescription: Keep me\n---\nBody\n", "bundle:folder"],
  ["empty metadata", "---\n\n---\nBody\n", "bundle:folder"],
  ["no metadata", "Body without frontmatter\n", "bundle:folder"],
  ["CRLF", "---\r\nname: declared\r\ndescription: Keep me\r\n---\r\nBody\r\n", "bundle:declared"],
  ["existing prefix", "---\nname: bundle:declared\ndescription: Keep me\n---\nBody\n", "bundle:declared"],
] as const) test(`namespace preserves content for ${label}`, () => {
  const changed = namespaceSkillContent(raw, "bundle", "folder");
  const match = /^\s*---\n([\s\S]*?)\n---([\s\S]*)$/.exec(changed);
  assert.ok(match);
  const metadata = parse(match[1] ?? "");
  assert.strictEqual(metadata.name, expected);
  if (raw.includes("Keep me")) assert.strictEqual(metadata.description, "Keep me");
  if (label === "anchored name") assert.strictEqual(metadata.description, "child");
  if (label === "declared name") assert.deepStrictEqual(metadata.metadata, { tier: 2 });
  const body = raw.startsWith("---") ? raw.slice(raw.indexOf("---", 3) + 3) : `\n${raw}`;
  assert.strictEqual(match[2], body);
  assert.strictEqual(namespaceSkillContent(changed, "bundle", "folder"), changed);
  if (label === "existing prefix") assert.strictEqual(changed, raw);
});

for (const raw of ["---\nname: [broken\n---\nBody", "---\nname: 123\n---\nBody", "---\nname: one\nname: two\n---\nBody", "---\nname: missing-end"]) test(`invalid frontmatter refuses: ${raw}`, () => {
  assert.throws(() => namespaceSkillContent(raw, "bundle", "folder"), /Invalid Plugin Skill/);
});

test("only immediate Plugin Skills are rewritten, including children without evals; frozen bytes stay intact", async () => {
  const root = await mkdtemp(join(tmpdir(), "plugin-namespace-"));
  const content = "---\nname: child\ndescription: preserved\n---\nBody\n";
  const paths = ["skills/child/SKILL.md", "skills/no-suite/SKILL.md", "skills/child/resources/SKILL.md", "SKILL.md", "resources/marker.txt"];
  const files = paths.map(path => ({ path, content: Buffer.from(content).toString("base64"), executable: false }));
  const frozen = JSON.stringify(files);
  try {
    await restoreSnapshot(files, root);
    await namespacePluginSkills(root, "bundle", files);
    for (const path of paths) {
      const actual = await readFile(join(root, path), "utf8");
      assert.strictEqual(actual, path === paths[0] || path === paths[1] ? content.replace("name: child", "name: bundle:child") : content);
    }
    assert.strictEqual(JSON.stringify(files), frozen);
  } finally { await rm(root, { recursive: true, force: true }); }
});
