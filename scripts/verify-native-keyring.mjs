#!/usr/bin/env node
// ap-44kd: native verification of the contained skill-creator keyring reader on a
// disposable CI machine. Writes SYNTHETIC Goose secrets entries, reads them through the
// shipped runtime (not app sources), checks provider selection, then deletes them.
// Never run on an operator machine: it overwrites the "goose"/"secrets" keyring entry.
// Usage: verify-native-keyring.mjs <keyring-rs writer>
//
// Expected per platform (encoded below, so a behavior change fails loudly):
// - win32: the keyring-rs entry (what Goose writes) is read exactly and forwarded.
// - darwin: the keyring-rs entry trusts only its creating app, so /usr/bin/security
//   blocks on a user consent dialog and the non-interactive read must not succeed;
//   an entry readable by any app (`security add-generic-password -A`) proves the
//   command and parsing.
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

if (process.env.CI !== "true") { console.error("Refusing to overwrite the Goose keyring entry outside CI."); process.exit(2); }
const writer = process.argv[2];
if (!writer) { console.error("usage: verify-native-keyring.mjs <goose-keyring-writer>"); process.exit(2); }
const runtime = new URL("../skills/skill-creator/runtime/dist/adapters/outbound/hosts/goose/goose-keyring.js", import.meta.url);
const { SystemGooseKeyring, providerKeyringEnvironment, keyringCommand } = await import(runtime.href);
// Production passes the full operator environment (PATH, SystemRoot...) minus exported
// provider variables; an empty object would break PowerShell startup on Windows.
const operator = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^AZURE_FOUNDRY_/i.test(key)));

/** Writes with `store`, reads through the shipped reader, always deletes with `remove`. */
async function check(name, store, remove) {
  // Non-ASCII content discriminates UTF-8 versus UTF-16 blob handling.
  const marker = `native-check-${randomUUID()}-é€`;
  const secrets = { AZURE_FOUNDRY_API_KEY: marker, UNRELATED_API_KEY: "unrelated-synthetic-value" };
  store(JSON.stringify(secrets));
  try {
    const started = Date.now();
    const read = await new SystemGooseKeyring(process.platform).read(operator);
    const forwarded = await providerKeyringEnvironment(new SystemGooseKeyring(process.platform), operator, "azure_foundry");
    const result = {
      case: name, readable: read !== undefined, elapsedMs: Date.now() - started,
      exactRoundTrip: read?.AZURE_FOUNDRY_API_KEY === marker && read?.UNRELATED_API_KEY === secrets.UNRELATED_API_KEY,
      forwardedNames: Object.keys(forwarded), forwardedExact: forwarded.AZURE_FOUNDRY_API_KEY === marker,
    };
    if (!result.readable) {
      // Synthetic data only: expose the native tool's status to explain the failure.
      const command = keyringCommand(process.platform);
      const probe = spawnSync(command.executable, command.args, { encoding: "utf8", timeout: 15000 });
      result.diagnostic = { status: probe.status, signal: probe.signal, error: probe.error?.message, stderr: probe.stderr?.slice(0, 2000) };
    }
    return result;
  } finally { remove(); }
}
const exact = r => r.readable && r.exactRoundTrip && r.forwardedExact && JSON.stringify(r.forwardedNames) === '["AZURE_FOUNDRY_API_KEY"]';
const keyringRs = value => execFileSync(writer, ["write"], { env: { ...process.env, GOOSE_KEYRING_TEST_VALUE: value }, stdio: "inherit" });
const keyringRsDelete = () => execFileSync(writer, ["delete"], { stdio: "inherit" });

const results = [await check("keyring-rs", keyringRs, keyringRsDelete)];
let passed;
if (process.platform === "darwin") {
  results.push(await check("security-any-app", value => execFileSync("/usr/bin/security", ["add-generic-password", "-U", "-A", "-s", "goose", "-a", "secrets", "-w", value]),
    () => execFileSync("/usr/bin/security", ["delete-generic-password", "-s", "goose", "-a", "secrets"], { stdio: "ignore" })));
  passed = !results[0].readable && exact(results[1]);
} else passed = exact(results[0]);
console.log(JSON.stringify({ platform: process.platform, passed, results }));
process.exit(passed ? 0 : 1);
