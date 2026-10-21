import { tmpdir } from "node:os";
import { materializeFixtures } from "../../../skills/plugin-creator/assets/materialize-fixtures.mjs";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPortablePlugin } from "../dist/scripts/portable_loader.js";
import { validateMcpServerSemantics } from "../dist/scripts/mcp_semantics.js";
import { authoritativeMcpEnvironment } from "../dist/scripts/plugin_data_lifecycle.js";
import { mcpRuntimeFailureOutcome, mcpServerCapabilityOutcome, validateMcpCapabilities } from "../dist/scripts/mcp_runtime.js";
import { validate } from "../dist/scripts/validate_goose_plugin.js";
import { verifyPlugin } from "../dist/scripts/verify_plugin_gates.js";

const ROOT = materializeFixtures(resolve(dirname(fileURLToPath(import.meta.url)), "../../../skills/plugin-creator/assets/conformance-fixtures"), join(mkdtempSync(join(tmpdir(), "conformance-fixtures-")), "corpus"));
after(() => rmSync(dirname(ROOT), { recursive: true, force: true }));
const matrix = JSON.parse(readFileSync(join(ROOT, "cases.json"), "utf8"));
const REQUIRED_SECTIONS = ["4.1","5.1","5.2","6.1","6.2","7.1","7.2.1","7.2.2","8","8.1","9.1","9.2","11.2","11.3"];

function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const child = join(path, entry.name);
    assert.equal(entry.isSymbolicLink(), false, `fixture symlink: ${child}`);
    return entry.isDirectory() ? files(child) : [child];
  });
}
function component(result: any, key: string): any {
  const [componentType, componentId] = key.split(":");
  return result.components.find((item: any) => item.componentType === componentType && item.componentId === componentId);
}
function mcp(root: string): Record<string, any> {
  return JSON.parse(readFileSync(join(root, "mcp.json"), "utf8")).mcpServers;
}
function releaseOutcome(root: string, strict: any): "fail" | "blocked" | "pass" {
  const hardFailure = strict.diagnostics.some((d: any) => d.severity === "error") ||
    strict.components.some((c: any) => ["skipped", "skipped-invalid", "runtime-failed"].includes(c.status));
  if (hardFailure || validate(root).errors.length) return "fail";
  return verifyPlugin({ pluginPath: root, profile: "release" }).status;
}

test("conformance fixtures are a closed, small, immutable corpus", () => {
  assert.equal(matrix.schemaVersion, 1);
  const fixtureNames = readdirSync(ROOT, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name).sort();
  assert.deepEqual(fixtureNames, matrix.cases.map((x: any) => x.fixture).sort());
  const allFiles = files(ROOT).sort();
  for (const path of allFiles) assert.ok(statSync(path).size <= 4096, `${relative(ROOT, path)} exceeds 4 KiB`);
  const digest = createHash("sha256").update(allFiles.map(path => `${relative(ROOT, path).replaceAll("\\", "/")}\0${createHash("sha256").update(readFileSync(path)).digest("hex")}`).join("\n")).digest("hex");
  assert.equal(digest, "65b7c3c272839048e82c8539cdc005f0241d40388faa86765ddd43ccfc2b195a");
  const covered = new Set(matrix.cases.flatMap((x: any) => x.sections));
  assert.deepEqual([...covered].sort(), REQUIRED_SECTIONS.sort());
});

test("matrix expectations are exercised without hidden criteria", () => {
  // The declared MCP cwd is a runtime directory, not immutable corpus content.
  mkdirSync(join(ROOT, "env-expansion", "work"), { recursive: true });
  for (const item of matrix.cases) {
    const root = join(ROOT, item.fixture), capabilities = { transports: item.capabilities } as any;
    const portable = loadPortablePlugin(root, "portable-load", capabilities);
    const strict = loadPortablePlugin(root, "strict-authoring", capabilities);
    assert.equal(portable.status, item.expected.portableLoad, `${item.id}: portable`);
    assert.equal(strict.status, item.expected.strictAuthoring, `${item.id}: strict`);
    if (item.diagnostics) assert.deepEqual(portable.diagnostics.map((x: any) => x.code), item.diagnostics, `${item.id}: diagnostics`);
    for (const key of item.accepted ?? []) assert.equal(component(portable, key)?.status, "accepted", `${item.id}: ${key}`);
    for (const key of item.absent ?? []) assert.equal(component(portable, key), undefined, `${item.id}: ${key} absent`);
    for (const [key, status] of Object.entries(item.componentStatus ?? {})) assert.equal(component(portable, key)?.status, status, `${item.id}: ${key}`);
    for (const [key, status] of Object.entries(item.strictComponentStatus ?? {})) assert.equal(component(strict, key)?.status, status, `${item.id}: strict ${key}`);
    const goose = item.expected.gooseExtension === "not-applicable" ? "not-applicable" : validate(root).errors.length ? "rejected" : "accepted";
    assert.equal(goose, item.expected.gooseExtension, `${item.id}: Goose extension`);
    assert.equal(releaseOutcome(root, strict), item.expected.release, `${item.id}: release`);
  }
});

test("fixture-backed expansion, HTTP, runtime, and capability details are exact", () => {
  const envRoot = join(ROOT, "env-expansion"), envCase = matrix.cases.find((x: any) => x.id === "env-expansion");
  const expanded = validateMcpServerSemantics("expanded", mcp(envRoot).expanded, { pluginRoot: envRoot, pluginData: envRoot });
  assert.equal(expanded.expanded?.args?.[0], envCase.expansion.arg0.replace("<PLUGIN_ROOT>", envRoot));
  assert.equal(expanded.expanded?.args?.[1], "${UNKNOWN}");
  assert.equal(expanded.expanded?.env?.CACHE, envCase.expansion.cache.replace("<PLUGIN_DATA>", envRoot));
  assert.equal(expanded.expanded?.cwd, envCase.expansion.cwd.replace("<PLUGIN_ROOT>", envRoot));
  const processEnv = authoritativeMcpEnvironment({ PLUGIN_ROOT: "inherited", KEEP: "yes" }, { PLUGIN_DATA: "configured", CACHE: "x" }, envRoot, join(envRoot, "data"));
  assert.equal(processEnv.PLUGIN_ROOT, envRoot); assert.equal(processEnv.PLUGIN_DATA, join(envRoot, "data")); assert.equal(processEnv.KEEP, "yes"); assert.equal(processEnv.CACHE, "x");

  const httpRoot = join(ROOT, "http-security"), servers = mcp(httpRoot);
  const codes = (id: string) => validateMcpServerSemantics(id, servers[id], { pluginRoot: httpRoot, pluginData: httpRoot }).semanticFindings.map(x => x.code);
  assert.deepEqual(codes("secure"), []); assert.deepEqual(codes("loopback"), []);
  assert.ok(codes("plaintext").includes("mcp.remote.http-non-loopback")); assert.ok(codes("userinfo").includes("mcp.remote.url-userinfo"));
  assert.ok(codes("fragment").includes("mcp.remote.url-fragment")); assert.ok(codes("duplicate").includes("mcp.remote.header-duplicate"));

  const runtimeCase = matrix.cases.find((x: any) => x.id === "runtime-failures");
  assert.equal(mcpRuntimeFailureOutcome(runtimeCase.runtime.server, runtimeCase.runtime.stage).status, runtimeCase.runtime.status);
  assert.equal(mcpServerCapabilityOutcome(runtimeCase.runtime.unaffected, "stdio", { transports: ["stdio"], redirectOriginProtection: true }).status, "accepted");
  const unsupported = matrix.cases.find((x: any) => x.id === "unsupported-capabilities");
  assert.equal(validateMcpCapabilities(unsupported.clientCapabilities)[0].code, unsupported.clientCapabilities.diagnostic);
  assert.equal(mcpServerCapabilityOutcome("remote", "streamable-http", { transports: ["streamable-http"], redirectOriginProtection: false }).status, "skipped-unsupported");
});
