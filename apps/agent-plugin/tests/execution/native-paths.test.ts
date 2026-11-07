import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { test } from "node:test";
import { isolatedEnvironment, parseInfo } from "../../src/adapters/outbound/hosts/goose/goose-configuration.ts";
import { contained, privateDirectory } from "../../src/adapters/outbound/hosts/goose/private-files.ts";

const privateKeys = ["HOME", "USERPROFILE", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR", "APPDATA", "LOCALAPPDATA", "TMPDIR", "TMP", "TEMP"];

test("shared candidate/judge environment removes path-root overrides and retains private platform paths", () => {
  const root = join(tmpdir(), "private-native-paths");
  const original = { GOOSE_PATH_ROOT: "/operator/root", goose_path_root: "/operator/other", HOME: "/operator/home", XDG_CONFIG_HOME: "/operator/config", APPDATA: "/operator/appdata", GOOSE_MOIM_MESSAGE_FILE: "/operator/context", OPENAI_API_KEY: "fixture-credential" };
  const env = isolatedEnvironment(original, root);
  assert.equal(Object.keys(env).some(key => /path_root/i.test(key)), false);
  assert.equal(env.GOOSE_MOIM_MESSAGE_FILE, undefined);
  assert.equal(env.OPENAI_API_KEY, "fixture-credential");
  for (const key of privateKeys) assert.ok(env[key] && contained(root, env[key]), `${key} must remain private`);
  assert.equal(env.HOME, join(root, "home"));
  assert.equal(env.XDG_CONFIG_HOME, join(root, "home", ".config"));
  assert.equal(env.XDG_DATA_HOME, join(root, "home", ".local", "share"));
  assert.equal(env.XDG_STATE_HOME, join(root, "home", ".local", "state"));
  assert.equal(original.GOOSE_PATH_ROOT, "/operator/root", "do not mutate the caller environment");
});

async function installedGoose(): Promise<string | undefined> {
  const explicit = process.env.AGENT_PLUGIN_NATIVE_GOOSE;
  if (explicit) {
    assert.ok(isAbsolute(explicit), "AGENT_PLUGIN_NATIVE_GOOSE must be an absolute executable path");
    await access(explicit, constants.X_OK);
    return explicit;
  }
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(isAbsolute)) {
    const executable = join(directory, "goose");
    try { await access(executable, constants.X_OK); return executable; } catch { /* Optional host absent from this PATH entry. */ }
  }
  return undefined;
}

test("installed Goose info uses Linux native HOME/XDG paths in an empty private environment", { skip: process.platform !== "linux" }, async t => {
  const executable = await installedGoose();
  if (!executable) { t.skip("Installed Goose unavailable; set AGENT_PLUGIN_NATIVE_GOOSE to an absolute binary path"); return; }
  const root = await mkdtemp(join(tmpdir(), "goose-native-paths-"));
  try {
    // Equivalent to env -i: no operator config, credentials or provider environment is inherited.
    const env = isolatedEnvironment({ GOOSE_DISABLE_KEYRING: "true" }, root);
    for (const key of privateKeys) if (env[key]) await privateDirectory(env[key]);
    const bytes = execFileSync(executable, ["info"], { env, cwd: root, timeout: 10000, maxBuffer: 1024 * 1024 });
    const info = parseInfo(bytes);
    t.diagnostic(`Installed Goose ${info.version}; isolated info only, no model execution`);
    assert.ok(info.paths.every(path => contained(root, path)), "every dynamically reported path must be private");
    assert.equal(info.config, join(env.XDG_CONFIG_HOME ?? "", "goose", "config.yaml"));
    assert.equal(info.logs, join(env.XDG_STATE_HOME ?? "", "goose", "logs"));
    assert.ok(info.paths.some(path => contained(join(env.XDG_DATA_HOME ?? "", "goose", "sessions"), path)), "sessions must use native data storage");
  } finally { await rm(root, { recursive: true, force: true }); }
});
