import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeMacosPassword, keyringCommand, parseGooseSecrets, providerKeyringEnvironment, registerKeyringCredentials, SystemGooseKeyring, type GooseKeyring } from "../../src/adapters/outbound/hosts/goose/goose-keyring.ts";

const stub = (secrets: Record<string, string> | undefined): GooseKeyring & { reads: number } => {
  const keyring = { reads: 0, read: async () => { keyring.reads += 1; return secrets; } };
  return keyring;
};

test("each OS uses its native store for the Goose secrets entry (service goose, user secrets)", () => {
  assert.deepEqual(keyringCommand("linux"), { executable: "secret-tool", args: ["lookup", "service", "goose", "username", "secrets"], timeoutMs: 10_000 });
  // macOS waits for the Keychain consent dialog that Goose-created items require (ap-44kd).
  assert.deepEqual(keyringCommand("darwin"), { executable: "/usr/bin/security", args: ["find-generic-password", "-s", "goose", "-a", "secrets", "-w"], timeoutMs: 60_000 });
  const windows = keyringCommand("win32");
  assert.equal(windows?.executable, "powershell.exe");
  assert.equal(windows?.timeoutMs, 10_000);
  const script = Buffer.from(windows?.args.at(-1) ?? "", "base64").toString("utf16le");
  // keyring-rs Windows target is "<user>.<service>"; the blob is UTF-16.
  assert.ok(script.includes("Read('secrets.goose')") && script.includes("CredReadW") && script.includes("PtrToStringUni"));
  assert.equal(keyringCommand("aix"), undefined);
});

test("only string values with environment-safe names are parsed; malformed entries yield nothing", () => {
  assert.deepEqual(parseGooseSecrets('{"AZURE_FOUNDRY_API_KEY":"k","N":7,"EMPTY":"","bad-name":"x"}\n'), { AZURE_FOUNDRY_API_KEY: "k" });
  assert.equal(parseGooseSecrets("not json"), undefined);
  assert.equal(parseGooseSecrets("[1]"), undefined);
});

test("only the selected provider's absent variables are forwarded", async () => {
  const keyring = stub({ AZURE_FOUNDRY_API_KEY: "foundry", AZURE_FOUNDRY_ENDPOINT: "https://endpoint", QDRANT_API_KEY: "qdrant", OPENAI_API_KEY: "openai", GOOSE_SERVER__SECRET_KEY: "server" });
  assert.deepEqual(await providerKeyringEnvironment(keyring, {}, "azure_foundry"), { AZURE_FOUNDRY_API_KEY: "foundry", AZURE_FOUNDRY_ENDPOINT: "https://endpoint" });
  // An exported variable wins, as in Goose's own env-before-keyring lookup.
  assert.deepEqual(await providerKeyringEnvironment(keyring, { AZURE_FOUNDRY_API_KEY: "exported" }, "azure_foundry"), { AZURE_FOUNDRY_ENDPOINT: "https://endpoint" });
  assert.deepEqual(await providerKeyringEnvironment(keyring, {}, undefined), {});
  assert.deepEqual(await providerKeyringEnvironment(undefined, {}, "azure_foundry"), {});
  const reads = keyring.reads;
  assert.deepEqual(await providerKeyringEnvironment(keyring, { GOOSE_DISABLE_KEYRING: "true" }, "azure_foundry"), {});
  assert.equal(keyring.reads, reads, "GOOSE_DISABLE_KEYRING must prevent any keyring access");
  assert.deepEqual(await providerKeyringEnvironment(keyring, { GOOSE_DISABLE_KEYRING: "false" }, "openai"), { OPENAI_API_KEY: "openai" });
  assert.deepEqual(await providerKeyringEnvironment(stub(undefined), {}, "azure_foundry"), {});
});

test("the system reader runs the native tool once with the operator environment and tolerates failure", { skip: process.platform !== "linux" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "goose-keyring-"));
  try {
    const log = join(root, "calls");
    await writeFile(join(root, "secret-tool"), `#!/bin/sh\necho "$*|$SESSION_MARKER" >> "${log}"\nprintf '%s\\n' '{"OPENAI_API_KEY":"from-keyring"}'\n`);
    await chmod(join(root, "secret-tool"), 0o700);
    const keyring = new SystemGooseKeyring("linux");
    const env = { PATH: root, SESSION_MARKER: "operator-session" };
    const [first, second] = await Promise.all([keyring.read(env), keyring.read(env)]);
    assert.deepEqual(first, { OPENAI_API_KEY: "from-keyring" });
    assert.equal(second, first);
    assert.deepEqual((await readFile(log, "utf8")).trim().split("\n"), ["lookup service goose username secrets|operator-session"]);
    assert.equal(await new SystemGooseKeyring("linux").read({ PATH: join(root, "missing") }), undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("forwarded keyring values use the stored-secret rule, whatever their name", () => {
  // The environment rule would ignore a 7-character value under a non-credential name.
  const secrets = new Set<string>();
  registerKeyringCredentials({ AZURE_FOUNDRY_REGION_CODE: "s3cr3t7", AZURE_FOUNDRY_FLAG: "true", AZURE_FOUNDRY_SHORT: "abc" }, secrets);
  assert.deepEqual([...secrets], ["s3cr3t7"]);
});

test("macOS hexadecimal password output is decoded, plain JSON is kept", () => {
  const json = '{"AZURE_FOUNDRY_API_KEY":"clé-€"}';
  assert.deepEqual(parseGooseSecrets(decodeMacosPassword(`${Buffer.from(json, "utf8").toString("hex")}\n`)), { AZURE_FOUNDRY_API_KEY: "clé-€" });
  assert.equal(decodeMacosPassword(`${json}\n`), `${json}\n`);
});
