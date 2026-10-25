import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../skills/plugin-creator/references");
const draft = join(root, "agent-plugins-1.1.0");
const published = join(root, "agent-plugins-1.0.0");
const expected = {
  "spec.md": { sha256: "735df8c8fe4f77510bd33410d6901d5325e6ed38aa7dc2ba385a0f174cc6b074", blob: "a3c710349565b8e58f32df2a154b7a5c65b32d02" },
  "plugin.schema.json": { sha256: "fdc7bb3962c48c9d2d561641d2bc96225c94ca69c4087010241b9423a290370f", blob: "499cb1d6cf6d2b8fbe5e4964a7d4e438cb7041ce" },
  "mcp.schema.json": { sha256: "f227ec2c0e40cd23051bd7a6ba1f64789eff7773d4e481d80002ab9fd3c45137", blob: "b9367db0fa3b58dc0005acc9723bb797a466081c" },
} as const;

function digest(algorithm: "sha1" | "sha256", content: Buffer): string {
  return createHash(algorithm).update(content).digest("hex");
}
function blobId(content: Buffer): string {
  return digest("sha1", Buffer.concat([Buffer.from("blob " + content.length + "\0"), content]));
}

test("Agent Plugins 1.1.0 working-draft snapshot matches recorded upstream bytes", () => {
  const provenance = readFileSync(join(draft, "README.md"), "utf8");
  for (const [name, identity] of Object.entries(expected)) {
    const content = readFileSync(join(draft, name));
    assert.equal(digest("sha256", content), identity.sha256, name + " SHA-256 drifted");
    assert.equal(blobId(content), identity.blob, name + " upstream Git blob drifted");
    assert.match(provenance, new RegExp(identity.sha256));
    assert.match(provenance, new RegExp(identity.blob));
  }
  const specification = readFileSync(join(draft, "spec.md"), "utf8");
  assert.match(specification, /^\*\*Spec Version: 1\.1\.0\*\*$/m);
  assert.match(specification, /^\*\*Status: Working Draft\*\*$/m);
  assert.match(provenance, /ff8ab5e392cc87bd88d87c060815a87490e51003/);
  assert.match(provenance, /Retrieval date: 2026-08-23/);
  assert.match(provenance, /Comparison with published 1\.0\.0/);
});

test("1.1.0 draft schemas change identifiers but not validation rules", () => {
  for (const name of ["plugin.schema.json", "mcp.schema.json"] as const) {
    const schema = JSON.parse(readFileSync(join(draft, name), "utf8"));
    assert.equal(schema.$id, "https://agent-plugins.org/schemas/1.1.0/" + name);
    assert.equal(schema.properties.$schema.const, schema.$id);
    const normalized = readFileSync(join(draft, name), "utf8").replaceAll("1.1.0", "1.0.0");
    assert.equal(normalized, readFileSync(join(published, name), "utf8"), name);
  }
});
