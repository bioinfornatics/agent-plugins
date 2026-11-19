import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { test } from "node:test";
import { parseInfo, secretStrings } from "../../src/adapters/outbound/hosts/goose/goose-configuration.ts";
import { isolatedEnvironment } from "../../src/adapters/outbound/hosts/goose/goose-environment.ts";
import { collectEnvironmentCredentials } from "../../src/adapters/outbound/hosts/goose/credential-values.ts";
import { contained, privateDirectory } from "../../src/adapters/outbound/hosts/goose/private-files.ts";

const privateKeys = ["HOME", "USERPROFILE", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR", "APPDATA", "LOCALAPPDATA", "TMPDIR", "TMP", "TEMP"];

test("shared candidate/judge environment removes path-root overrides and retains private platform paths", () => {
  const root = join(tmpdir(), "private-native-paths");
  const original = { GOOSE_PATH_ROOT: "/operator/root", goose_path_root: "/operator/other", HOME: "/operator/home", XDG_CONFIG_HOME: "/operator/config", APPDATA: "/operator/appdata", GOOSE_MOIM_MESSAGE_FILE: "/operator/context", OPENAI_API_KEY: "fixture-credential" };
  const env = isolatedEnvironment(original, root, { provider: "openai" });
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

// Candidate/judge processes run untrusted treatment code: unrelated operator credentials,
// the SSH agent and the D-Bus session must not reach them, while the selected provider's
// key, locale/PATH basics and GOOSE_* settings must. Wrong result: inherited operator env.
test("private Goose environment is an allowlist scoped to the selected provider", () => {
  const original = {
    PATH: "/usr/bin", LANG: "fr_FR.UTF-8", LC_ALL: "C.UTF-8", TZ: "Europe/Paris", https_proxy: "http://proxy:3128",
    GOOSE_PROVIDER: "anthropic", GOOSE_MODEL: "m", GOOSE_DISABLE_KEYRING: "1",
    ANTHROPIC_API_KEY: "anthropic-provider-key", ANTHROPIC_HOST: "https://api.example",
    OPENAI_API_KEY: "other-provider-key", UNRELATED_SERVICE_TOKEN: "unrelated-token-value",
    SSH_AUTH_SOCK: "/run/user/1000/ssh", DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus", GPG_AGENT_INFO: "/run/gpg:1:1",
    NPM_TOKEN: "npm-token-value", npm_config__auth: "npm-auth-value", GH_TOKEN: "gh-token-value", GITHUB_TOKEN: "github-token-value",
    AWS_SECRET_ACCESS_KEY: "aws-secret-value", FIXTURE_CONTROL: "kept-by-forward",
  };
  const env = isolatedEnvironment(original, join(tmpdir(), "allowlist"), { provider: "anthropic", forward: ["FIXTURE_CONTROL", "SSH_AUTH_SOCK", "GH_TOKEN"] });
  for (const key of ["PATH", "LANG", "LC_ALL", "TZ", "https_proxy", "GOOSE_PROVIDER", "GOOSE_MODEL", "GOOSE_DISABLE_KEYRING", "ANTHROPIC_API_KEY", "ANTHROPIC_HOST", "FIXTURE_CONTROL"]) {
    assert.equal(env[key], original[key as keyof typeof original], `${key} must be forwarded`);
  }
  for (const key of ["OPENAI_API_KEY", "UNRELATED_SERVICE_TOKEN", "SSH_AUTH_SOCK", "DBUS_SESSION_BUS_ADDRESS", "GPG_AGENT_INFO", "NPM_TOKEN", "npm_config__auth", "GH_TOKEN", "GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY"]) {
    assert.equal(env[key], undefined, `${key} must not be forwarded`);
  }
  // Without a resolved provider, no provider credentials are inherited at all.
  const probe = isolatedEnvironment(original, join(tmpdir(), "allowlist"));
  assert.equal(probe.ANTHROPIC_API_KEY, undefined);
  assert.equal(isolatedEnvironment(original, join(tmpdir(), "allowlist"), { provider: "aws_bedrock" }).AWS_SECRET_ACCESS_KEY, "aws-secret-value");
});

// Registered values are rewritten inside hashed evidence and make the judge refuse packets.
// Wrong result: flags/numbers/socket paths/hosts registered as credentials (original
// FEATURE_TOKEN_CACHE=1 bug), or real secrets missed because of their value shape.
test("environment credential detection classifies by name: ignores flags, locations and hosts, keeps real secrets", () => {
  const discord = "https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOp0123456789_qRsTuVwXyZ";
  const cases: [string, string, string[]][] = [
    // Original false-positive class: never registered.
    ["FEATURE_TOKEN_CACHE", "1", []], ["AUTH_ENABLED", "true", []], ["TOKEN_CACHE_DISABLED", "false", []],
    ["NO_PROXY", "localhost,127.0.0.1,.internal.example", []], ["SSH_AUTH_SOCK", "/run/user/1000/keyring/ssh", []],
    ["XAUTHORITY", "/run/user/1000/xauth_abc", []], ["GOOSE_DISABLE_KEYRING", "yes-please-disable", []],
    ["PROXY_PORT", "8080", []], ["OAUTH_SERVER", "localhost", []], ["AUTH_HOST", "auth.internal.example", []],
    ["TOKEN_EXPIRY_MS", "86400000", []], ["SECRET_TTL", "3600", []], ["DB_PASSWORD_SHORT", "abc12", []],
    ["CREDENTIALS_FILE_PATH", "/home/user/credentials.json", []], ["AWS_SHARED_CREDENTIALS_FILE", "/home/user/.aws/credentials", []],
    ["GOOGLE_APPLICATION_CREDENTIALS", "/home/user/gcp.json", []], ["GPG_AGENT_INFO", "/run/gpg:1:1", []],
    ["HTTPS_PROXY", "http://proxy.internal.example:3128", []], ["AUTH_URL", "https://login.example/oauth", []],
    ["OPENAI_API_KEY_DIR", "/opt/keys", []], ["TOKEN_ENDPOINT", "https://login.example/oauth2/v2.0/token", []],
    // Real secrets: always registered, whatever their value shape.
    ["AWS_SECRET_ACCESS_KEY", "/wJalrXUtnFEMI/K7MDENG/bPxRfiCY", ["/wJalrXUtnFEMI/K7MDENG/bPxRfiCY"]],
    ["DISCORD_WEBHOOK_TOKEN", discord, [discord, "AbCdEfGhIjKlMnOp0123456789_qRsTuVwXyZ"]],
    ["DB_PASSWORD", "12345678901", ["12345678901"]], ["API_KEY", "abc.def.ghijklmnop", ["abc.def.ghijklmnop"]],
    ["SMTP_PASSWORD", "hunt3r", ["hunt3r"]], ["APP_SECRET", "s3cr3t7", ["s3cr3t7"]], ["GPG_PASSPHRASE", "123456", ["123456"]],
    ["OPENAI_API_KEY", "sk-live-0123456789abcdef", ["sk-live-0123456789abcdef"]], ["SERVICE_PASSWORD", "correct horse battery", ["correct horse battery"]],
    ["SESSION_TOKEN_JWT", "eyJhbGciOi.eyJzdWIiOiIx.SflKxwRJSMeKKF2QT4", ["eyJhbGciOi.eyJzdWIiOiIx.SflKxwRJSMeKKF2QT4"]],
    ["SIGNING_KEY_URL", "https://hooks.example/notify?sig=abc", ["https://hooks.example/notify?sig=abc"]],
    ["HTTP_PROXY", "http://alice:proxy%40pass-word@proxy.example:8080", ["alice:proxy%40pass-word", "proxy%40pass-word", "proxy@pass-word", "alice:proxy@pass-word"]],
    ["OAUTH_ENDPOINT", "https://bob:hostpass99@auth.example/v1/AbCdEfGhIjKlMnOp0123?x=1", ["hostpass99", "bob:hostpass99"]],
  ];
  for (const [name, value, expected] of cases) {
    const secrets = new Set<string>();
    collectEnvironmentCredentials({ [name]: value }, secrets);
    assert.deepEqual([...secrets].sort(), [...expected].sort(), `${name}=${value}`);
  }
});

// secrets.yaml values are secrets by definition. Wrong result: short human passwords or
// leading-slash keys missed, or booleans/short trivial strings rewritten in evidence.
test("stored secret registration keeps realistic secrets of at least six characters", () => {
  const secrets = new Set<string>();
  secretStrings({ A: "hunt3r", B: "/wJalrXUtnFEMI/K7MDENG", C: "123456", D: "true", E: "abc12", F: "localhost", nested: { G: ["abc.def.ghijklmnop"] } }, secrets, true);
  assert.deepEqual([...secrets].sort(), ["/wJalrXUtnFEMI/K7MDENG", "123456", "abc.def.ghijklmnop", "hunt3r"].sort());
  const config = new Set<string>();
  secretStrings({ GOOSE_PROVIDER: "openai", token_cache: "enabled", api_key: "k3y-value", nested: { password: "pa55wd" } }, config);
  assert.deepEqual([...config].sort(), ["k3y-value", "pa55wd"]);
});

// GOOSE_* is forwarded wholesale except secret-like and executable overrides. Wrong result:
// untrusted trial code reads GOOSE_SERVER__SECRET_KEY, or the operator environment selects
// binaries (GOOSE_TEMPORAL_BIN) run inside trials; GOOSE_DISABLE_KEYRING must stay.
test("private Goose environment drops secret-like and executable GOOSE_* overrides and keeps TLS trust", () => {
  const original = {
    GOOSE_PROVIDER: "openai", GOOSE_MODEL: "m", GOOSE_DISABLE_KEYRING: "1", GOOSE_MAX_TURNS: "5",
    GOOSE_SERVER__SECRET_KEY: "server-secret", GOOSE_API_TOKEN: "t", GOOSE_PROVIDER__API_KEY: "k", GOOSE_DB_PASSWORD: "p", GOOSE_CREDENTIALS: "c",
    GOOSE_TEMPORAL_BIN: "/tmp/evil", GOOSE_EDITOR_COMMAND: "evil", GOOSE_SHELL_CMD: "evil", GOOSE_RUNTIME_EXECUTABLE: "evil",
    REQUESTS_CA_BUNDLE: "/etc/ssl/corp.pem", NODE_EXTRA_CA_CERTS: "/etc/ssl/corp.pem", CURL_CA_BUNDLE: "/etc/ssl/corp.pem",
  };
  const env = isolatedEnvironment(original, join(tmpdir(), "goose-filter"), { provider: "openai" });
  for (const key of ["GOOSE_PROVIDER", "GOOSE_MODEL", "GOOSE_DISABLE_KEYRING", "GOOSE_MAX_TURNS", "REQUESTS_CA_BUNDLE", "NODE_EXTRA_CA_CERTS", "CURL_CA_BUNDLE"]) {
    assert.equal(env[key], original[key as keyof typeof original], `${key} must be forwarded`);
  }
  for (const key of ["GOOSE_SERVER__SECRET_KEY", "GOOSE_API_TOKEN", "GOOSE_PROVIDER__API_KEY", "GOOSE_DB_PASSWORD", "GOOSE_CREDENTIALS",
    "GOOSE_TEMPORAL_BIN", "GOOSE_EDITOR_COMMAND", "GOOSE_SHELL_CMD", "GOOSE_RUNTIME_EXECUTABLE"]) {
    assert.equal(env[key], undefined, `${key} must not be forwarded`);
  }
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
