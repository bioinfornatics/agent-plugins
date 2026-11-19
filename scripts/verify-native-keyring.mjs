#!/usr/bin/env node
// ap-44kd: native verification of the contained skill-creator keyring reader on a
// disposable CI machine. Writes a SYNTHETIC Goose secrets entry with keyring-rs (the
// library Goose uses), reads it through the shipped runtime (not app sources), checks
// provider selection, then deletes the entry. Never run on an operator machine: it
// overwrites the "goose"/"secrets" keyring entry. Usage: verify-native-keyring.mjs <writer>
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

if (process.env.CI !== "true") { console.error("Refusing to overwrite the Goose keyring entry outside CI."); process.exit(2); }
const writer = process.argv[2];
if (!writer) { console.error("usage: verify-native-keyring.mjs <goose-keyring-writer>"); process.exit(2); }
const runtime = new URL("../skills/skill-creator/runtime/dist/adapters/outbound/hosts/goose/goose-keyring.js", import.meta.url);
const { SystemGooseKeyring, providerKeyringEnvironment } = await import(runtime.href);

// Non-ASCII content discriminates UTF-8 versus UTF-16 blob handling.
const marker = `native-check-${randomUUID()}-é€`;
const secrets = { AZURE_FOUNDRY_API_KEY: marker, UNRELATED_API_KEY: "unrelated-synthetic-value" };
const env = { ...process.env, GOOSE_KEYRING_TEST_VALUE: JSON.stringify(secrets) };
execFileSync(writer, ["write"], { env, stdio: "inherit" });
let result;
try {
  const read = await new SystemGooseKeyring(process.platform).read(process.env);
  const forwarded = await providerKeyringEnvironment(new SystemGooseKeyring(process.platform), {}, "azure_foundry");
  result = {
    platform: process.platform,
    readable: read !== undefined,
    exactRoundTrip: read?.AZURE_FOUNDRY_API_KEY === marker && read?.UNRELATED_API_KEY === secrets.UNRELATED_API_KEY,
    forwardedNames: Object.keys(forwarded),
    forwardedExact: forwarded.AZURE_FOUNDRY_API_KEY === marker,
  };
} finally {
  execFileSync(writer, ["delete"], { stdio: "inherit" });
}
console.log(JSON.stringify(result));
const passed = result.readable && result.exactRoundTrip && result.forwardedExact && JSON.stringify(result.forwardedNames) === '["AZURE_FOUNDRY_API_KEY"]';
process.exit(passed ? 0 : 1);
