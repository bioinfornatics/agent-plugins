import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { sourceHash } from "../dist/scripts/package_manifest.js";
import { componentHash, verifyPlugin } from "../dist/scripts/verify_plugin_gates.js";
const DIST = join(import.meta.dirname, "..", "dist", "scripts");
function fixture() { const tmp = mkdtempSync(join(tmpdir(), "plugin-gates-")), plugin = join(tmp, "demo-plugin"), skill = join(plugin, "skills", "demo"); mkdirSync(skill, { recursive: true }); writeFileSync(join(plugin, "plugin.json"), JSON.stringify({ "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "demo-plugin", version: "1.0.0", description: "Demo plugin" })); writeFileSync(join(skill, "SKILL.md"), "---\nname: demo\ndescription: Demo work\n---\n\n# Demo\n"); return { tmp, plugin, skill }; }
function receiptFor(tmp: string, skill: string) { const path = join(tmp, "receipt.json"); writeFileSync(path, JSON.stringify({ schema_version: "1.0", artifact: "skill", name: "demo", status: "pass", source_sha256: componentHash(skill) })); return path; }
test("plugin rejects stale component receipts", () => { const { tmp, plugin, skill } = fixture(); try {
    const path = join(tmp, "receipt.json");
    writeFileSync(path, JSON.stringify({ schema_version: "1.0", artifact: "skill", name: "demo", status: "pass", source_sha256: "stale" }));
    const result = verifyPlugin({ pluginPath: plugin, profile: "static", componentReceipts: [path] });
    assert.equal(result.gates.components.status, "blocked");
    assert.equal(result.status, "blocked");
    assert.notEqual(componentHash(skill), "stale");
}
finally {
    rmSync(tmp, { recursive: true, force: true });
} });
test("gate options reject invalid enum and non-finite values", () => { const { tmp, plugin } = fixture(); try {
    assert.throws(() => verifyPlugin({ pluginPath: plugin, profile: "typo" }), /profile/);
    assert.throws(() => verifyPlugin({ pluginPath: plugin, profile: "static", testsStatus: "maybe" }), /tests-status/);
    assert.throws(() => verifyPlugin({ pluginPath: plugin, profile: "static", humanReview: "maybe" }), /human-review/);
    assert.throws(() => verifyPlugin({ pluginPath: plugin, profile: "static", minPassRate: NaN }), /finite/);
    assert.throws(() => verifyPlugin({ pluginPath: plugin, profile: "static", minPassRate: 2 }), /between 0 and 1/);
}
finally {
    rmSync(tmp, { recursive: true, force: true });
} });
test("evaluation blocks missing, stale, and invalid benchmark provenance", () => { const { tmp, plugin, skill } = fixture(); try {
    const receipt = receiptFor(tmp, skill), workspace = join(tmp, "evaluation");
    mkdirSync(workspace);
    writeFileSync(join(workspace, "review.html"), "ok");
    let result = verifyPlugin({ pluginPath: plugin, profile: "evaluation", componentReceipts: [receipt], integration: workspace, testsStatus: "pass", humanReview: "pass" });
    assert.equal(result.gates.integration.status, "blocked");
    const summary = { with_skill: { pass_rate: { mean: 0.9 } }, without_skill: { pass_rate: { mean: 0.5 } } };
    writeFileSync(join(workspace, "benchmark.json"), JSON.stringify({ metadata: { evaluated_source_sha256: "stale" }, run_summary: summary }));
    result = verifyPlugin({ pluginPath: plugin, profile: "evaluation", componentReceipts: [receipt], integration: workspace, testsStatus: "pass", humanReview: "pass" });
    assert.match(result.gates.integration.reason ?? "", /stale/);
    writeFileSync(join(workspace, "benchmark.json"), JSON.stringify({ metadata: { evaluated_source_sha256: sourceHash(plugin) }, run_summary: { ...summary, with_skill: { pass_rate: { mean: Infinity } } } }));
    result = verifyPlugin({ pluginPath: plugin, profile: "evaluation", componentReceipts: [receipt], integration: workspace, testsStatus: "pass", humanReview: "pass" });
    assert.match(result.gates.integration.reason ?? "", /finite/);
}
finally {
    rmSync(tmp, { recursive: true, force: true });
} });
test("distribution gate compares canonical file hashes and rejects unsafe entries", () => { const { tmp, plugin, skill } = fixture(); try {
    const receipt = receiptFor(tmp, skill), workspace = join(tmp, "evaluation"), archive = join(tmp, "plugin.zip");
    mkdirSync(workspace);
    writeFileSync(join(workspace, "review.html"), "ok");
    execFileSync(process.execPath, [join(DIST, "package_goose_plugin.js"), plugin, archive]);
    writeFileSync(join(workspace, "benchmark.json"), JSON.stringify({ metadata: { evaluated_source_sha256: sourceHash(plugin) }, run_summary: { with_skill: { pass_rate: { mean: 1 } }, without_skill: { pass_rate: { mean: 0.5 } } } }));
    let result = verifyPlugin({ pluginPath: plugin, profile: "release", componentReceipts: [receipt], integration: workspace, archive, testsStatus: "pass", humanReview: "pass" });
    assert.equal(result.status, "pass");
    const zip = new AdmZip(archive);
    zip.updateFile("demo-plugin/plugin.json", Buffer.from("{}"));
    zip.writeZip(archive);
    result = verifyPlugin({ pluginPath: plugin, profile: "release", componentReceipts: [receipt], integration: workspace, archive, testsStatus: "pass", humanReview: "pass" });
    assert.equal(result.gates.distribution.status, "fail");
    const unsafe = new AdmZip();
    unsafe.addFile("C:/escape", Buffer.from("bad"));
    unsafe.writeZip(archive);
    result = verifyPlugin({ pluginPath: plugin, profile: "release", componentReceipts: [receipt], integration: workspace, archive, testsStatus: "pass", humanReview: "pass" });
    assert.equal(result.gates.distribution.status, "fail");
    assert.match(result.gates.distribution.evidence[0], /unsafe/);
}
finally {
    rmSync(tmp, { recursive: true, force: true });
} });
