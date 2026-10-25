import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { validate } from "../dist/scripts/validate_goose_plugin.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "..");
const DIST = join(ROOT, "dist", "scripts");
const PLUGIN_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";

function makePlugin(root: string): string {
  const plugin = join(root, "demo-plugin");
  mkdirSync(join(plugin, "skills", "demo"), { recursive: true });
  writeFileSync(
    join(plugin, "plugin.json"),
    JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "demo-plugin", version: "1.0.0", description: "A test plugin" })
  );
  writeFileSync(
    join(plugin, "skills", "demo", "SKILL.md"),
    "---\nname: demo\ndescription: Use this skill for demo tasks\n---\n\n# Demo\n"
  );
  return plugin;
}

test("valid skills plugin", () => {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-test-"));
  try {
    const { errors } = validate(makePlugin(tmp));
    assert.deepEqual(errors, []);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("placeholder detection distinguishes unfinished content from documentation and detector code", () => {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-test-"));
  try {
    const plugin = makePlugin(tmp);
    writeFileSync(join(plugin, "README.md"), "Search tasks with `rg TODO` and do not use TodoWrite.\n");
    writeFileSync(join(plugin, "detector.ts"), "if (text.includes(\"TODO\")) console.log(\"unresolved TODO placeholder\");\n");
    assert.deepEqual(validate(plugin).warnings, []);

    writeFileSync(join(plugin, "README.md"), "# TODO: finish the release instructions\n");
    assert.ok(validate(plugin).warnings.some((warning) => warning.includes("README.md")));

    writeFileSync(
      join(plugin, "skills", "demo", "SKILL.md"),
      "---\nname: demo\ndescription: Use this skill for demo tasks\n---\n\n- FIXME add verification steps\n",
    );
    assert.ok(validate(plugin).errors.some((error) => error.includes("unresolved placeholder")));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("valid hook and mcp plugin", () => {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-test-"));
  try {
    const plugin = join(tmp, "automation");
    mkdirSync(join(plugin, "hooks"), { recursive: true });
    mkdirSync(join(plugin, "scripts"));
    mkdirSync(join(plugin, "servers"));
    writeFileSync(
      join(plugin, "plugin.json"),
      JSON.stringify({ name: "automation", version: "1.0.0", description: "Automation plugin" })
    );
    writeFileSync(join(plugin, "scripts", "guard.sh"), "#!/bin/sh\nexit 0\n");
    writeFileSync(join(plugin, "servers", "tool"), "#!/bin/sh\n");
    writeFileSync(
      join(plugin, "hooks", "hooks.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: ".*",
              hooks: [
                {
                  type: "command",
                  command: "${PLUGIN_ROOT}/scripts/guard.sh",
                  timeout: 5,
                },
              ],
            },
          ],
        },
      })
    );
    writeFileSync(
      join(plugin, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          tool: {
            command: "${PLUGIN_ROOT}/servers/tool",
            args: ["--stdio"],
            env: { MODE: "test" },
          },
        },
      })
    );
    const { errors } = validate(plugin);
    assert.deepEqual(errors, []);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("rejects bare star and missing file", () => {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-test-"));
  try {
    const plugin = join(tmp, "bad-plugin");
    mkdirSync(join(plugin, "hooks"), { recursive: true });
    writeFileSync(
      join(plugin, "plugin.json"),
      JSON.stringify({ name: "bad-plugin", version: "1.0.0", description: "Bad plugin" })
    );
    writeFileSync(
      join(plugin, "hooks", "hooks.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "*", hooks: [{ command: "${PLUGIN_ROOT}/scripts/missing.sh" }] },
          ],
        },
      })
    );
    const { errors } = validate(plugin);
    assert.ok(errors.some((e) => e.includes("invalid regex")));
    assert.ok(errors.some((e) => e.includes("does not exist")));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("package excludes git metadata", () => {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-test-"));
  try {
    const plugin = makePlugin(tmp);
    mkdirSync(join(plugin, ".git", "objects"), { recursive: true });
    writeFileSync(join(plugin, ".git", "config"), "secret metadata");
    const output = join(tmp, "dist", "plugin.zip");
    execFileSync("node", [join(DIST, "package_goose_plugin.js"), plugin, output], {
      encoding: "utf-8",
    });
    const zip = new AdmZip(output);
    const names = zip.getEntries().map((e) => e.entryName);
    assert.ok(!names.some((n) => n.includes("/.git/")));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("package excludes repository-local hidden metadata", () => {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-test-"));
  try {
    const plugin = makePlugin(tmp);
    for (const directory of [".agents", ".beads", ".local-agent", ".local-tools", "evaluations"]) {
      mkdirSync(join(plugin, directory), { recursive: true });
      writeFileSync(join(plugin, directory, "local.txt"), "development metadata");
    }
    mkdirSync(join(plugin, ".vscode"), { recursive: true });
    writeFileSync(join(plugin, ".vscode", "tasks.json"), JSON.stringify({ version: "2.0.0", tasks: [] }));
    mkdirSync(join(plugin, ".beads"), { recursive: true });
    writeFileSync(join(plugin, ".beads", "local.txt"), "TODO local tracker state");
    writeFileSync(join(plugin, ".local-agent", "settings.json"), "{}");
    assert.deepEqual(validate(plugin).warnings, []);
    const output = join(tmp, "dist", "plugin.zip");
    execFileSync("node", [join(DIST, "package_goose_plugin.js"), plugin, output], { encoding: "utf-8" });
    const names = new AdmZip(output).getEntries().map((entry) => entry.entryName);
    for (const excluded of ["/.agents/", "/.beads/", "/.local-agent/", "/.local-tools/", "/evaluations/"]) {
      assert.ok(!names.some((name) => name.includes(excluded)), excluded);
    }
    assert.ok(names.some((name) => name.includes("/.vscode/tasks.json")));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("package uses the manifest name as the archive root", () => {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-test-"));
  try {
    const checkout = makePlugin(tmp);
    writeFileSync(
      join(checkout, "plugin.json"),
      JSON.stringify({ "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "renamed-plugin", version: "1.0.0", description: "A renamed plugin" })
    );
    const output = join(tmp, "plugin.zip");
    execFileSync("node", [join(DIST, "package_goose_plugin.js"), checkout, output]);
    const names = new AdmZip(output).getEntries().map((entry) => entry.entryName);
    assert.ok(names.length > 0);
    assert.ok(names.every((name) => name.startsWith("renamed-plugin/")));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("package includes vendor dependencies but excludes development node_modules", () => {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-test-"));
  try {
    const plugin = makePlugin(tmp);
    const skill = join(plugin, "skills", "demo");
    const vendorDependency = join(skill, "vendor", "node_modules", "demo-runtime");
    mkdirSync(join(skill, "dist"), { recursive: true });
    mkdirSync(vendorDependency, { recursive: true });
    mkdirSync(join(skill, "node_modules", "typescript"), { recursive: true });
    writeFileSync(join(skill, "package.json"), JSON.stringify({ offlineBundle: true, dependencies: { "demo-runtime": "1.0.0" } }));
    writeFileSync(join(skill, "dist", "tool.js"), "console.log('ok');\n");
    writeFileSync(join(skill, "vendor", "manifest.json"), JSON.stringify({ packages: [{ name: "demo-runtime", version: "1.0.0" }] }));
    writeFileSync(join(vendorDependency, "package.json"), JSON.stringify({ name: "demo-runtime", version: "1.0.0" }));
    writeFileSync(join(skill, "node_modules", "typescript", "package.json"), JSON.stringify({ name: "typescript" }));
    writeFileSync(join(skill, "THIRD_PARTY_NOTICES.md"), "# Notices\n");
    const output = join(tmp, "plugin.zip");
    execFileSync("node", [join(DIST, "package_goose_plugin.js"), plugin, output]);
    const names = new AdmZip(output).getEntries().map((entry) => entry.entryName);
    assert.ok(names.some((name) => name.includes("/vendor/node_modules/demo-runtime/package.json")));
    assert.ok(!names.some((name) => name.includes("/skills/demo/node_modules/typescript")));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("release profile stages only runtime files and preserves executable mode", { skip: process.platform === "win32" }, () => {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-release-"));
  try {
    const plugin = makePlugin(tmp);
    const skill = join(plugin, "skills", "demo");
    for (const directory of ["scripts", "tests", "node_modules/dev", "vendor/node_modules/runtime", "dist", "references", "assets", "schemas"]) {
      mkdirSync(join(skill, directory), { recursive: true });
    }
    mkdirSync(join(plugin, "bin"));
    const executables = ["skill-creator", "agent-creator", "hook-creator", "plugin-creator"];
    for (const executable of executables) {
      writeFileSync(join(plugin, "bin", executable), "#!/bin/sh\nexit 0\n");
      chmodSync(join(plugin, "bin", executable), 0o755);
    }
    writeFileSync(join(skill, "scripts", "runtime.ts"), "export {};\n");
    writeFileSync(join(skill, "scripts", "build.mjs"), "throw new Error('build only');\n");
    writeFileSync(join(skill, "tests", "runtime.test.ts"), "export {};\n");
    writeFileSync(join(skill, "node_modules", "dev", "package.json"), "{}");
    writeFileSync(join(skill, "vendor", "node_modules", "runtime", "package.json"), "{}");
    writeFileSync(join(skill, "tsconfig.json"), "{}");
    writeFileSync(join(skill, "dist", "runtime.js"), "export {};\n");
    writeFileSync(join(skill, "dist", "public.d.ts"), "export {};\n");
    writeFileSync(join(skill, "references", "runtime.txt"), "reference\n");
    writeFileSync(join(skill, "assets", "runtime.json"), "{}");
    writeFileSync(join(skill, "schemas", "runtime.schema.json"), "{}");
    writeFileSync(join(skill, "THIRD_PARTY_NOTICES.md"), "# Notices\n");

    const output = join(tmp, "release.zip");
    execFileSync("node", [join(DIST, "package_goose_plugin.js"), plugin, output, "--profile", "release"]);
    const zip = new AdmZip(output);
    const names = zip.getEntries().map((entry) => entry.entryName);
    const prefix = "demo-plugin/";
    for (const required of [...executables.map((name) => "bin/" + name), "skills/demo/SKILL.md", "skills/demo/dist/runtime.js", "skills/demo/dist/public.d.ts", "skills/demo/references/runtime.txt", "skills/demo/assets/runtime.json", "skills/demo/schemas/runtime.schema.json", "skills/demo/THIRD_PARTY_NOTICES.md"]) {
      assert.ok(names.includes(prefix + required), "missing release file: " + required);
    }
    for (const forbidden of ["skills/demo/scripts/runtime.ts", "skills/demo/scripts/build.mjs", "skills/demo/tests/runtime.test.ts", "skills/demo/node_modules/dev/package.json", "skills/demo/vendor/node_modules/runtime/package.json", "skills/demo/tsconfig.json"]) {
      assert.ok(!names.includes(prefix + forbidden), "forbidden release file: " + forbidden);
    }
    const extracted = join(tmp, "extracted");
    execFileSync("unzip", ["-q", output, "-d", extracted]);
    for (const executable of executables) {
      assert.equal(statSync(join(extracted, prefix, "bin", executable)).mode & 0o111, 0o111, executable);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("release profile rejects unknown profile names", () => {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-release-"));
  try {
    const plugin = makePlugin(tmp), output = join(tmp, "release.zip");
    assert.throws(() => execFileSync("node", [join(DIST, "package_goose_plugin.js"), plugin, output, "--profile", "production"]), /status 1|Command failed/);
    assert.equal(existsSync(output), false);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("package rejects an incomplete declared offline bundle", () => {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-test-"));
  try {
    const plugin = makePlugin(tmp);
    const skill = join(plugin, "skills", "demo");
    writeFileSync(join(skill, "package.json"), JSON.stringify({ offlineBundle: true, dependencies: { "demo-runtime": "1.0.0" } }));
    const output = join(tmp, "plugin.zip");
    assert.throws(() => execFileSync("node", [join(DIST, "package_goose_plugin.js"), plugin, output]), /status 1|Command failed/);
    assert.equal(existsSync(output), false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});


test("MCP operational validation is transport-aware", () => {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-test-"));
  try {
    const plugin = makePlugin(tmp);
    writeFileSync(join(plugin, ".mcp.json"), JSON.stringify({ mcpServers: { remote: { type: "streamable-http", url: "https://example.test/mcp", headers: { Authorization: "token" } } } }));
    assert.deepEqual(validate(plugin).errors, []);
    writeFileSync(join(plugin, ".mcp.json"), JSON.stringify({ mcpServers: { remote: { type: "sse", command: "node" } } }));
    assert.ok(validate(plugin).errors.some((error) => error.includes("url must be non-empty")));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("package rejects symbolic links", () => {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-test-"));
  try {
    const plugin = makePlugin(tmp);
    const target = join(tmp, "outside.txt");
    writeFileSync(target, "outside");
    symlinkSync(target, join(plugin, "escape.txt"));
    const output = join(tmp, "plugin.zip");
    assert.throws(() => execFileSync("node", [join(DIST, "package_goose_plugin.js"), plugin, output]), /status 1|Command failed/);
    assert.equal(existsSync(output), false);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
test("validation never reads external symlink sentinel content", { skip: process.platform === "win32" }, () => {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-test-"));
  try {
    const plugin = makePlugin(tmp);
    const sentinel = join(tmp, "outside-sentinel.md");
    writeFileSync(sentinel, "# TODO: this content must never be scanned\n");
    symlinkSync(sentinel, join(plugin, "README-link.md"));
    const result = validate(plugin);
    assert.ok(result.errors.some(error => error.includes("resolved-outside")));
    assert.ok(!result.warnings.some(warning => warning.includes("placeholder")));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("escaped skills directory is isolated before traversal", { skip: process.platform === "win32" }, () => {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-test-"));
  try {
    const plugin = join(tmp, "demo-plugin");
    const outside = join(tmp, "outside-skills");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "sentinel"), "TODO: never scan");
    mkdirSync(plugin);
    writeFileSync(join(plugin, "plugin.json"), JSON.stringify({ $schema: PLUGIN_SCHEMA, name: "demo-plugin" }));
    symlinkSync(outside, join(plugin, "skills"), "dir");
    const result = validate(plugin);
    assert.ok(result.errors.some(error => error.includes("skills") && error.includes("resolved-outside")));
    assert.ok(!result.warnings.some(warning => warning.includes("placeholder")));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("historical Block hook namespace is migration-only and conflicts with canonical hooks", () => {
  const tmp=mkdtempSync(join(tmpdir(),"plugin-test-"));
  try {
    const plugin=makePlugin(tmp);
    mkdirSync(join(plugin,"extensions","io.github.block.goose"),{recursive:true});
    writeFileSync(join(plugin,"extensions","io.github.block.goose","hooks.json"),JSON.stringify({hooks:{PostToolUse:[{hooks:[{command:"echo ok"}]}]}}));
    const manifest=JSON.parse(readFileSync(join(plugin,"plugin.json"),"utf8"));
    manifest.extensions={"io.github.block.goose":{version:1,hooks:"extensions/io.github.block.goose/hooks.json"}};
    writeFileSync(join(plugin,"plugin.json"),JSON.stringify(manifest));
    let result=validate(plugin);
    assert.deepEqual(result.errors,[]);
    assert.ok(result.warnings.some(w=>w.includes("Historical Goose namespace")));
    mkdirSync(join(plugin,"extensions","io.github.bioinfornatics.agent-plugins.goose"),{recursive:true});
    writeFileSync(join(plugin,"extensions","io.github.bioinfornatics.agent-plugins.goose","hooks.json"),JSON.stringify({hooks:{PostToolUse:[{hooks:[{command:"echo ok"}]}]}}));
    result=validate(plugin);
    assert.ok(result.errors.some(e=>e.includes("Ambiguous Goose hooks")));
  } finally {rmSync(tmp,{recursive:true,force:true});}
});
