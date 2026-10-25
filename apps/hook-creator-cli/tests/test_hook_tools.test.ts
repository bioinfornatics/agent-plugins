import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateHooks } from "../dist/hook_format.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "..");
const DIST = join(ROOT, "dist");

function makePlugin(root: string): string {
  const plugin = join(root, "demo-plugin");
  mkdirSync(plugin);
  writeFileSync(
    join(plugin, "plugin.json"),
    JSON.stringify({ name: "demo-plugin", version: "1.0.0", description: "Demo" })
  );
  return plugin;
}

test("scaffold and validate", () => {
  const tmp = mkdtempSync(join(tmpdir(), "hook-test-"));
  try {
    const plugin = makePlugin(tmp);
    execFileSync(
      "node",
      [
        join(DIST, "init_hook.js"),
        plugin,
        "PostToolUse",
        "record-tool",
        "--matcher",
        "developer__shell",
      ],
      { encoding: "utf-8" }
    );
    const result = validateHooks(plugin);
    assert.deepEqual(result.errors, []);
    const mode = statSync(join(plugin, "scripts", "record-tool.sh")).mode;
    assert.ok(mode & 0o111);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("rejects unknown event and bare star", () => {
  const tmp = mkdtempSync(join(tmpdir(), "hook-test-"));
  try {
    const plugin = makePlugin(tmp);
    mkdirSync(join(plugin, "hooks"));
    writeFileSync(
      join(plugin, "hooks", "hooks.json"),
      JSON.stringify({
        hooks: {
          SubagentStart: [{ matcher: "*", hooks: [{ command: "echo hi" }] }],
        },
      })
    );
    const errors = validateHooks(plugin).errors;
    assert.ok(errors.some((e) => e.includes("Unsupported hook event")));
    assert.ok(errors.some((e) => e.includes("invalid") && e.includes("regex")));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("rejects missing plugin-relative script", () => {
  const tmp = mkdtempSync(join(tmpdir(), "hook-test-"));
  try {
    const plugin = makePlugin(tmp);
    mkdirSync(join(plugin, "hooks"));
    writeFileSync(
      join(plugin, "hooks", "hooks.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              hooks: [
                {
                  type: "command",
                  command: "${PLUGIN_ROOT}/scripts/missing.sh",
                  timeout: 5,
                },
              ],
            },
          ],
        },
      })
    );
    const errors = validateHooks(plugin).errors;
    assert.ok(errors.some((e) => e.includes("does not exist")));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("scaffold writes the namespaced Goose extension envelope", () => {
  const tmp = mkdtempSync(join(tmpdir(), "hook-test-"));
  try {
    const plugin = makePlugin(tmp);
    execFileSync("node", [join(DIST, "init_hook.js"), plugin, "PostToolUse", "record-tool"]);
    const manifest = JSON.parse(readFileSync(join(plugin, "plugin.json"), "utf8"));
    assert.deepEqual(manifest.extensions["io.github.bioinfornatics.agent-plugins.goose"], {
      version: 1,
      hooks: "extensions/io.github.bioinfornatics.agent-plugins.goose/hooks.json",
    });
    assert.equal(existsSync(join(plugin, "extensions", "io.github.bioinfornatics.agent-plugins.goose", "hooks.json")), true);
    assert.equal(existsSync(join(plugin, "hooks", "hooks.json")), false);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("legacy hooks warn and mixed canonical and legacy forms fail closed", () => {
  const tmp = mkdtempSync(join(tmpdir(), "hook-test-"));
  try {
    const plugin = makePlugin(tmp);
    mkdirSync(join(plugin, "hooks"));
    writeFileSync(join(plugin, "hooks", "hooks.json"), JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ command: "echo ok" }] }] } }));
    assert.ok(validateHooks(plugin).warnings.some(w => w.includes("Legacy Goose hooks")));
    mkdirSync(join(plugin, "extensions", "io.github.bioinfornatics.agent-plugins.goose"), { recursive: true });
    writeFileSync(join(plugin, "extensions", "io.github.bioinfornatics.agent-plugins.goose", "hooks.json"), JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ command: "echo ok" }] }] } }));
    assert.ok(validateHooks(plugin).errors.some(e => e.includes("Ambiguous Goose hooks")));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("validator rejects hook and referenced-script symlinks", { skip: process.platform === "win32" }, () => {
  const tmp=mkdtempSync(join(tmpdir(),"hook-test-")); try { const plugin=makePlugin(tmp),outside=join(tmp,"outside.json");mkdirSync(join(plugin,"extensions","io.github.bioinfornatics.agent-plugins.goose"),{recursive:true});writeFileSync(outside,JSON.stringify({hooks:{PostToolUse:[{hooks:[{command:"echo ok"}]}]}}));symlinkSync(outside,join(plugin,"extensions","io.github.bioinfornatics.agent-plugins.goose","hooks.json"));const manifest=JSON.parse(readFileSync(join(plugin,"plugin.json"),"utf8"));manifest.extensions={"io.github.bioinfornatics.agent-plugins.goose":{version:1,hooks:"extensions/io.github.bioinfornatics.agent-plugins.goose/hooks.json"}};writeFileSync(join(plugin,"plugin.json"),JSON.stringify(manifest));assert.ok(validateHooks(plugin).errors.some(e=>e.includes("symlink"))); } finally {rmSync(tmp,{recursive:true,force:true})}
});

test("init rejects a non-array existing event before changing the manifest",()=>{const tmp=mkdtempSync(join(tmpdir(),"hook-test-"));try{const plugin=makePlugin(tmp);mkdirSync(join(plugin,"extensions","io.github.bioinfornatics.agent-plugins.goose"),{recursive:true});writeFileSync(join(plugin,"extensions","io.github.bioinfornatics.agent-plugins.goose","hooks.json"),JSON.stringify({hooks:{PostToolUse:{bad:true}}}));const manifest=JSON.parse(readFileSync(join(plugin,"plugin.json"),"utf8"));manifest.extensions={"io.github.bioinfornatics.agent-plugins.goose":{version:1,hooks:"extensions/io.github.bioinfornatics.agent-plugins.goose/hooks.json"}};writeFileSync(join(plugin,"plugin.json"),JSON.stringify(manifest));const before=readFileSync(join(plugin,"plugin.json"),"utf8");assert.throws(()=>execFileSync("node",[join(DIST,"init_hook.js"),plugin,"PostToolUse","record-tool"]));assert.equal(readFileSync(join(plugin,"plugin.json"),"utf8"),before);assert.equal(existsSync(join(plugin,"scripts","record-tool.sh")),false)}finally{rmSync(tmp,{recursive:true,force:true})}});

test("historical Block namespace is migration-only and conflicts with canonical output", () => {
  const tmp=mkdtempSync(join(tmpdir(),"hook-test-"));
  try {
    const plugin=makePlugin(tmp);
    mkdirSync(join(plugin,"extensions","io.github.block.goose"),{recursive:true});
    writeFileSync(join(plugin,"extensions","io.github.block.goose","hooks.json"),JSON.stringify({hooks:{PostToolUse:[{hooks:[{command:"echo ok"}]}]}}));
    const manifest=JSON.parse(readFileSync(join(plugin,"plugin.json"),"utf8"));
    manifest.extensions={"io.github.block.goose":{version:1,hooks:"extensions/io.github.block.goose/hooks.json"}};
    writeFileSync(join(plugin,"plugin.json"),JSON.stringify(manifest));
    let result=validateHooks(plugin);
    assert.deepEqual(result.errors,[]);
    assert.ok(result.warnings.some(w=>w.includes("Historical Goose namespace")));
    mkdirSync(join(plugin,"extensions","io.github.bioinfornatics.agent-plugins.goose"),{recursive:true});
    writeFileSync(join(plugin,"extensions","io.github.bioinfornatics.agent-plugins.goose","hooks.json"),JSON.stringify({hooks:{PostToolUse:[{hooks:[{command:"echo ok"}]}]}}));
    result=validateHooks(plugin);
    assert.ok(result.errors.some(e=>e.includes("Ambiguous Goose hooks")));
  } finally {rmSync(tmp,{recursive:true,force:true});}
});
