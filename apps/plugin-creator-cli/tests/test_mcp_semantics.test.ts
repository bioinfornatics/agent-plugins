import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandPluginPlaceholders, validateMcpSemantics } from "../dist/scripts/mcp_semantics.js";

function fixture(run: (root: string, data: string) => void): void {
  const temporary = mkdtempSync(join(tmpdir(), "mcp-semantics-"));
  const root = join(temporary, "plugin");
  const data = join(temporary, "data");
  mkdirSync(root); mkdirSync(data);
  try { run(root, data); } finally { rmSync(temporary, { recursive: true, force: true }); }
}

const configuration = (mcpServers: Record<string, unknown>) => ({ mcpServers });

test("expansion is single pass and preserves unknown placeholders", () => {
  assert.equal(expandPluginPlaceholders("a:${PLUGIN_ROOT}:${UNKNOWN}", "${PLUGIN_DATA}", "/data"), "a:${PLUGIN_DATA}:${UNKNOWN}");
});

test("validates stdio command and cwd and expands only runtime fields", () => fixture((root, data) => {
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin", "server"), "#!/bin/sh\n");
  chmodSync(join(root, "bin", "server"), 0o755);
  mkdirSync(join(data, "work"));
  const result = validateMcpSemantics(configuration({
    good: { type: "stdio", command: "./bin/server", args: ["${PLUGIN_ROOT}", "${UNKNOWN}"], env: { CACHE: "${PLUGIN_DATA}" }, cwd: "${PLUGIN_DATA}/work" },
    bad: { type: "stdio", command: "node server.js", env: { plugin_root: "bad" }, cwd: "../outside" },
  }), { pluginRoot: root, pluginData: data, windowsSemantics: true });
  assert.equal(result.servers[0].valid, true);
  assert.deepEqual(result.servers[0].expanded?.args, [root, "${UNKNOWN}"]);
  assert.equal(result.servers[0].expanded?.cwd, join(data, "work"));
  assert.deepEqual(result.servers[1].semanticFindings.map(finding => finding.code).sort(),
    ["mcp.stdio.command-not-single-token", "mcp.stdio.cwd-invalid-form", "mcp.stdio.reserved-env"].sort());
}));

test("uses filesystem-resolved containment for command and cwd", { skip: process.platform === "win32" }, () => fixture((root, data) => {
  const outside = join(root, "..", "outside");
  mkdirSync(outside); writeFileSync(join(outside, "server"), "x"); chmodSync(join(outside, "server"), 0o755);
  symlinkSync(outside, join(root, "escape"), "dir");
  const result = validateMcpSemantics(configuration({ local: { type: "stdio", command: "./escape/server", cwd: "./escape" } }), { pluginRoot: root, pluginData: data });
  assert.equal(result.servers[0].valid, false);
  assert.equal(result.servers[0].semanticFindings.filter(finding => finding.code === "mcp.path.not-contained").length, 2);
}));

test("validates remote URL and headers while keeping secret policy separate", () => fixture((root, data) => {
  const result = validateMcpSemantics(configuration({
    ipv4: { type: "streamable-http", url: "http://127.20.1.2/mcp", headers: { "X-Literal": "${PLUGIN_ROOT}" } },
    ipv6: { type: "sse", url: "http://[::1]/mcp" },
    bad: { type: "streamable-http", url: "http://user@example.com/mcp#fragment", headers: { Authorization: "Bearer fixed", authorization: "duplicate", "bad name": "x", Good: "bad\nvalue" } },
  }), { pluginRoot: root, pluginData: data });
  assert.equal(result.servers[0].valid, true); assert.equal(result.servers[1].valid, true);
  assert.deepEqual(new Set(result.servers[2].semanticFindings.map(finding => finding.code)), new Set([
    "mcp.remote.url-userinfo", "mcp.remote.url-fragment", "mcp.remote.http-non-loopback",
    "mcp.remote.header-duplicate", "mcp.remote.header-name-invalid", "mcp.remote.header-value-invalid",
  ]));
  assert.equal(result.servers[2].policyValid, false);
  assert.ok(result.servers[2].strictPolicyFindings.every(finding => finding.category === "strict-policy"));
  assert.equal(result.servers[2].semanticFindings.some(finding => finding.code.includes("secret")), false);
}));

test("server variants are closed and validate typed optional fields", () => fixture((root, data) => {
  const result = validateMcpSemantics(configuration({
    stdio: { type: "stdio", command: "node", args: "bad", env: [], url: "https://wrong.test" },
    remote: { type: "streamable-http", url: "https://example.test", headers: [], command: "node" },
  }), { pluginRoot: root, pluginData: data });
  assert.ok(result.servers[0].semanticFindings.some(f => f.code === "mcp.server.unknown-fields"));
  assert.ok(result.servers[0].semanticFindings.some(f => f.code === "mcp.stdio.args-invalid"));
  assert.ok(result.servers[0].semanticFindings.some(f => f.code === "mcp.stdio.env-invalid"));
  assert.ok(result.servers[1].semanticFindings.some(f => f.code === "mcp.remote.headers-invalid"));
}));
