import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRIVACY_POLICY_SCHEMA, REDACTED, PrivacyDiagnostic, deleteProtectedArtifact,
  parseRetentionPolicy, protectedArtifactStatus, putProtectedArtifact,
  readProtectedArtifact, redactString, redactValue,
} from "../dist/scripts/privacy_policy.js";

const NOW = "2026-09-18T06:00:00.000Z";

test("versioned policy validates independent transcript retention and expiry", () => {
  assert.deepEqual(parseRetentionPolicy({ schema_version: PRIVACY_POLICY_SCHEMA, transcript_retention: "delete-after-aggregate", protected_artifact_ttl_seconds: 60 }), {
    transcriptRetention: "delete-after-aggregate", protectedArtifactTtlSeconds: 60,
  });
  for (const hostile of [null, [], { transcript_retention: "forever" }, { protected_artifact_ttl_seconds: -1 }, { protected_artifact_ttl_seconds: Infinity }]) {
    assert.throws(() => parseRetentionPolicy(hostile), PrivacyDiagnostic);
  }
});

test("central redaction removes common secrets and private paths while retaining secret names", () => {
  const source = [
    "password=hunter2", "Authorization: Bearer abcdefghijklmnop", "AKI\u0041ABCDEFGHIJKLMNOP",
    "gh\u0070_abcdefghijklmnopqrstuvwxyz123456", "sk\u002dlive-abcdefghijklmnop", "/home/alice/private/repo/file.txt",
    "C:\\Users\\Alice\\private folder\\file.txt", "file:///Users/alice/Library/Application Support/private.json",
    "xox\u0062-123456789012-abcdefghijklmnop", "npm\u005fabcdefghijklmnopqrstuvwxyz123456",
    "AIz\u0061abcdefghijklmnopqrstuvwxyz1234567890", "eyJabcde.eyJfghij.abcdefghijkl",
    "AccountKey=azure-super-secret", "postgres://alice:database-password@example.test/db",
  ].join(" | ");
  const redacted = redactString(source);
  for (const secret of ["hunter2", "abcdefghijklmnop", "AKI\u0041ABCDEFGHIJKLMNOP", "gh\u0070_abcdefghijklmnopqrstuvwxyz123456", "/home/alice", "C:\\Users\\Alice", "Application Support/private.json", "xox\u0062-123456789012", "npm\u005fabcdefghijklmnopqrstuvwxyz", "AIz\u0061abcdefghijklmnopqrstuvwxyz", "database-password", "azure-super-secret"]) assert.equal(redacted.includes(secret), false, secret);
  assert.match(redacted, /password=\[REDACTED\]/);
  assert.equal(redactString(`open "/home/alice/private folder/report.txt" now`), `open "[PRIVATE_PATH]" now`);
  assert.deepEqual(redactValue({ secret_names: ["DEPLOY_TOKEN"], token: "value", note: source }, { topLevel: false }), {
    note: redacted, secret_names: ["DEPLOY_TOKEN"], token: REDACTED,
  });
});

test("redaction is total for cycles, getters, proxies, and extreme values", () => {
  const cycle: any = { safe: "ok" }; cycle.self = cycle;
  Object.defineProperty(cycle, "password", { enumerable: true, get() { throw new Error("must not execute"); } });
  assert.doesNotThrow(() => redactValue(cycle, { topLevel: false }));
  assert.equal((redactValue(cycle, { topLevel: false }) as any).password, REDACTED);
  assert.equal((redactValue(cycle, { topLevel: false }) as any).self, REDACTED);
  const hostile = new Proxy({}, { ownKeys() { throw new Error("hostile"); } });
  assert.equal(redactValue(hostile), REDACTED);
  assert.equal(redactString({ toString() { throw new Error("hostile"); } }), REDACTED);
});

test("protected refs are content-addressed, expire, delete to append-only tombstones, and make claims unavailable", () => {
  const workspace = mkdtempSync(join(tmpdir(), "agent-privacy-"));
  try {
    const ref = putProtectedArtifact(workspace, "proprietary transcript", { now: NOW, ttlSeconds: 60, secretNames: ["CI_TOKEN"] });
    assert.match(ref.digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(ref).includes("proprietary transcript"), false);
    assert.equal(readProtectedArtifact(workspace, ref, "2026-09-18T06:00:30Z").toString(), "proprietary transcript");
    assert.deepEqual(protectedArtifactStatus(workspace, ref, "2026-09-18T06:01:00Z"), { available: false, reason: "expired" });
    const result = deleteProtectedArtifact(workspace, ref, "user requested deletion token=do-not-log", { now: "2026-09-18T06:00:40Z", affectedClaimIds: ["claim-1"] });
    assert.equal(result.claim_status, "unavailable");
    assert.deepEqual(protectedArtifactStatus(workspace, ref, "2026-09-18T06:00:41Z"), { available: false, reason: "deleted" });
    assert.throws(() => readProtectedArtifact(workspace, ref, "2026-09-18T06:00:41Z"), /CLAIM_UNAVAILABLE/);
    const logPath = join(workspace, ".agent-creator-protected", "tombstone-ledger.jsonl");
    const log = readFileSync(logPath, "utf8");
    assert.match(log, /"status":"unavailable"/); assert.equal(log.includes("do-not-log"), false);
    deleteProtectedArtifact(workspace, ref, "repeat deletion", { now: "2026-09-18T06:00:42Z" });
    assert.equal(readFileSync(logPath, "utf8").trim().split("\n").length, 2);
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test("protected refs ignore forged retention fields and require an exact trusted reference", () => {
  const workspace = mkdtempSync(join(tmpdir(), "agent-privacy-tamper-"));
  try {
    const ref = putProtectedArtifact(workspace, "protected", { now: NOW, ttlSeconds: 60, secretNames: ["CI_TOKEN"] });
    const forgeries = [
      { ...ref, expires_at: "2099-01-01T00:00:00.000Z" },
      { ...ref, created_at: "2020-01-01T00:00:00.000Z" },
      { ...ref, byte_length: 1 },
      { ...ref, classification: "metadata" },
      { ...ref, secret_names: ["OTHER_TOKEN"] },
      { ...ref, extra: true },
    ];
    for (const forged of forgeries) {
      assert.deepEqual(protectedArtifactStatus(workspace, forged, "2026-09-18T06:00:30Z"), { available: false, reason: "invalid" });
      assert.throws(() => readProtectedArtifact(workspace, forged, "2026-09-18T06:00:30Z"), /CLAIM_UNAVAILABLE/);
      assert.throws(() => deleteProtectedArtifact(workspace, forged, "tampered"), /INVALID_REF/);
    }
    for (const name of ["TOKEN.VALUE", "TOKEN-NAME", "TOKEN VALUE", "token=value", "", "9TOKEN"]) assert.throws(() => putProtectedArtifact(workspace, name, { secretNames: [name] }), /INVALID_SECRET_NAME/);
    assert.deepEqual(redactValue({ secret_names: ["SAFE_NAME", "bad-name", "token=value"] }, { topLevel: false }), { secret_names: ["SAFE_NAME", REDACTED, REDACTED] });
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test("raw JSON strings and broad custom credential assignments are redacted without leaking the response", () => {
  const raw = JSON.stringify({ safe: "ok", nested: { BUILD_CREDENTIAL: "custom-value", yaml: "DEPLOY_CREDENTIAL: yaml-value" }, response: JSON.stringify({ OTHER_CREDENTIAL: "nested-value" }) });
  const redacted = redactString(raw);
  for (const value of ["custom-value", "yaml-value", "nested-value"]) assert.equal(redacted.includes(value), false);
  assert.equal(JSON.parse(redacted).safe, "ok");
  assert.equal(redactString("MY_CUSTOM_CREDENTIAL=plain-value").includes("plain-value"), false);
});

test("metadata and tombstone ledgers reject content mutation and durable-head-detected truncation", () => {
  const scenarios = ["metadata-file", "metadata-ledger", "metadata-truncate", "tombstone-ledger", "tombstone-truncate"] as const;
  for (const scenario of scenarios) {
    const workspace = mkdtempSync(join(tmpdir(), `agent-integrity-${scenario}-`));
    try {
      const ref = putProtectedArtifact(workspace, "protected evidence", { now: NOW, ttlSeconds: 600 });
      const root = join(workspace, ".agent-creator-protected");
      if (scenario === "metadata-file") {
        const path = join(root, "metadata", ref.digest.slice(7) + ".json");
        const metadata = JSON.parse(readFileSync(path, "utf8")); metadata.expires_at = "2099-01-01T00:00:00.000Z"; writeFileSync(path, JSON.stringify(metadata) + "\n");
      } else if (scenario === "metadata-ledger") {
        const path = join(root, "metadata-ledger.jsonl");
        const line = JSON.parse(readFileSync(path, "utf8")); line.payload.metadata_hash = "sha256:" + "f".repeat(64); writeFileSync(path, JSON.stringify(line) + "\n");
      } else if (scenario === "metadata-truncate") {
        truncateSync(join(root, "metadata-ledger.jsonl"), 0);
      } else {
        deleteProtectedArtifact(workspace, ref, "retention", { now: "2026-09-18T06:00:01Z", affectedClaimIds: ["claim-x"] });
        const path = join(root, "tombstone-ledger.jsonl");
        if (scenario === "tombstone-ledger") {
          const line = JSON.parse(readFileSync(path, "utf8")); line.payload.reason = "forged"; writeFileSync(path, JSON.stringify(line) + "\n");
        } else truncateSync(path, 0);
      }
      assert.deepEqual(protectedArtifactStatus(workspace, ref, "2026-09-18T06:00:02Z"), { available: false, reason: "invalid" });
      assert.throws(() => readProtectedArtifact(workspace, ref, "2026-09-18T06:00:02Z"), /CLAIM_UNAVAILABLE/);
    } finally { rmSync(workspace, { recursive: true, force: true }); }
  }
});

test("protected store rejects symlink traversal and malformed refs without throwing from status", () => {
  const workspace = mkdtempSync(join(tmpdir(), "agent-privacy-link-")), outside = mkdtempSync(join(tmpdir(), "agent-privacy-out-"));
  try {
    mkdirSync(join(workspace, ".agent-creator-protected"));
    symlinkSync(outside, join(workspace, ".agent-creator-protected", "objects"));
    assert.throws(() => putProtectedArtifact(workspace, "secret", { now: NOW }), /SYMLINK/);
    for (const hostile of [null, {}, { digest: "../../etc/passwd" }, { digest: "sha256:" + "a".repeat(64), expires_at: { toString() { throw new Error(); } } }]) assert.equal(protectedArtifactStatus(workspace, hostile).available, false);
  } finally { rmSync(workspace, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test("runner can discard transcripts while preserving aggregate evidence", () => {
  const tmp = mkdtempSync(join(tmpdir(), "agent-retention-e2e-"));
  try {
    const agent = join(tmp, "reviewer.md"), evalSet = join(tmp, "evals.json"), workspace = join(tmp, "workspace"), fake = join(tmp, "fake.mjs");
    writeFileSync(agent, "---\nname: reviewer\ndescription: Reviews safely\n---\n\nReview.\n");
    writeFileSync(evalSet, JSON.stringify({ evals: [{ id: "one", subject: "test", language: "en", prompt: "Review.", target: { kind: "task" }, preconditions: [], files: [], assertions: [] }] }));
    writeFileSync(fake, "#!/usr/bin/env node\nconsole.log(JSON.stringify({messages:[{role:'assistant',content:[{type:'text',text:'aggregate result'}]}],metadata:{total_tokens:3,total_turns:1}}))\n");
    const runner = fileURLToPath(new URL("../dist/scripts/run_agent_eval.js", import.meta.url));
    execFileSync(process.execPath, [runner, "--agent", agent, "--eval-set", evalSet, "--workspace", workspace, "--goose-cli", `${process.execPath} ${fake}`, "--transcript-retention", "delete-after-aggregate", "--no-heartbeat"], { stdio: "pipe" });
    for (const variant of ["with_agent", "without_agent_instructions"]) {
      assert.equal(readFileSync(join(workspace, "eval-one", variant, "outputs", "response.md"), "utf8"), "aggregate result\n");
      assert.throws(() => readFileSync(join(workspace, "eval-one", variant, "transcript.json")));
    }
    assert.equal(JSON.parse(readFileSync(join(workspace, "run_summary.json"), "utf8")).runs.length, 2);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("runner failure does not reflect raw credential-bearing stderr", () => {
  const tmp = mkdtempSync(join(tmpdir(), "agent-privacy-failure-"));
  try {
    const agent = join(tmp, "reviewer.md"), evalSet = join(tmp, "evals.json"), workspace = join(tmp, "workspace"), fake = join(tmp, "fake.mjs");
    writeFileSync(agent, "---\nname: reviewer\ndescription: Reviews safely\n---\n\nReview.\n");
    writeFileSync(evalSet, JSON.stringify({ evals: [{ id: "one", subject: "test", language: "en", prompt: "Review.", target: { kind: "task" }, preconditions: [], files: [], assertions: [] }] }));
    writeFileSync(fake, "#!/usr/bin/env node\nconsole.error('MY_CUSTOM_CREDENTIAL=must-not-leak'); process.exit(1)\n");
    const runner = fileURLToPath(new URL("../dist/scripts/run_agent_eval.js", import.meta.url));
    const result = spawnSync(process.execPath, [runner, "--agent", agent, "--eval-set", evalSet, "--workspace", workspace, "--goose-cli", `${process.execPath} ${fake}`, "--no-heartbeat"], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.equal(`${result.stdout}${result.stderr}`.includes("must-not-leak"), false);
    assert.match(result.stderr, /raw runner diagnostics withheld/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("evaluation E2E redacts every persisted artifact including metadata response transcript grading summary and heartbeat", () => {
  const tmp = mkdtempSync(join(tmpdir(), "agent-privacy-boundaries-"));
  try {
    const agent = join(tmp, "reviewer.md"), evalSet = join(tmp, "evals.json"), workspace = join(tmp, "workspace"), fake = join(tmp, "fake.mjs");
    const secrets = [
      "xox\u0062-123456789012-abcdefghijklmnop", "npm\u005fabcdefghijklmnopqrstuvwxyz123456",
      "AIz\u0061abcdefghijklmnopqrstuvwxyz1234567890", "eyJabcde.eyJfghij.abcdefghijkl",
      "azure-super-secret", "database-password", "private folder/report.txt",
    ];
    writeFileSync(agent, "---\nname: reviewer\ndescription: Reviews safely\n---\n\nReview.\n");
    writeFileSync(evalSet, JSON.stringify({ evals: [{ id: "private", name: "AccountKey=azure-super-secret", subject: "npm\u005fabcdefghijklmnopqrstuvwxyz123456", language: "en", prompt: "Read '/home/alice/private folder/report.txt' with xox\u0062-123456789012-abcdefghijklmnop", target: { kind: "task", url: "postgres://alice:database-password@example.test/db" }, preconditions: ["AIz\u0061abcdefghijklmnopqrstuvwxyz1234567890"], files: [], assertions: [{ id: "safe", version: 1, classification: "deterministic", criterion: "contains safe-result", checker: { kind: "contains", value: "safe-result" } }] }] }));
    writeFileSync(fake, "#!/usr/bin/env node\nawait new Promise(r=>setTimeout(r,80)); console.log(JSON.stringify({messages:[{role:'assistant',content:[{type:'text',text:'safe-result token=eyJabcde.eyJfghij.abcdefghijkl at C:\\\\Users\\Alice\\private folder\\report.txt'}]}],metadata:{total_tokens:3,total_turns:1,connectionstring:'AccountKey=azure-super-secret'}}))\n");
    const runner = fileURLToPath(new URL("../dist/scripts/run_agent_eval.js", import.meta.url));
    const grader = fileURLToPath(new URL("../dist/scripts/grade_agent_eval.js", import.meta.url));
    execFileSync(process.execPath, [runner, "--agent", agent, "--eval-set", evalSet, "--workspace", workspace, "--goose-cli", `${process.execPath} ${fake}`, "--heartbeat-interval", "0.02", "--workers", "1"], { stdio: "pipe" });
    execFileSync(process.execPath, [grader, workspace], { stdio: "pipe" });
    const artifacts: string[] = [];
    const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name); statSync(path).isDirectory() ? walk(path) : artifacts.push(path); } };
    walk(workspace);
    assert.ok(artifacts.some(path => path.endsWith("eval_metadata.json")));
    assert.ok(artifacts.some(path => path.endsWith("response.md")));
    assert.ok(artifacts.some(path => path.endsWith("transcript.json")));
    assert.ok(artifacts.some(path => path.endsWith("grading.json")));
    assert.ok(artifacts.some(path => path.endsWith("run_summary.json")));
    assert.ok(artifacts.some(path => path.endsWith("execution_heartbeats.jsonl")));
    for (const path of artifacts) {
      const text = readFileSync(path, "utf8");
      for (const secret of secrets) assert.equal(text.includes(secret), false, `${secret} leaked in ${path}`);
      assert.equal(/(?:\/home\/|\/Users\/|[A-Za-z]:\\Users\\)/.test(text), false, `private path leaked in ${path}`);
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
