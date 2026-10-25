import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findRuns, generateHtml, safeJson, boundedFile, isAllowedOrigin, REVIEW_OUTPUT_BUDGET,
} from "../dist/eval-viewer/generate_review.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "agent-review-sec-"));
  const runDir = join(root, "eval-one", "with_agent", "run-1");
  const outputsDir = join(runDir, "outputs");
  mkdirSync(outputsDir, { recursive: true });
  writeFileSync(join(root, "eval-one", "eval_metadata.json"), JSON.stringify({ eval_id: "one", prompt: "p" }));
  return { root, runDir, outputsDir };
}

test("safeJson escapes script-boundary and line-separator payloads for inline embedding", () => {
  const payload = { text: "</script><script>alert(1)</script>\u2028\u2029" };
  const json = safeJson(payload);
  assert.ok(!json.includes("</script"));
  assert.ok(!json.includes("\u2028"));
  assert.ok(!json.includes("\u2029"));
  assert.match(json, /\\u003c\/script/);
});

test("boundedFile refuses to follow a symlink pointing outside the workspace", () => {
  const { root, outputsDir } = fixture();
  try {
    const secretDir = mkdtempSync(join(tmpdir(), "agent-review-secret-"));
    const secret = join(secretDir, "sentinel.txt");
    writeFileSync(secret, "TOP-SECRET-SENTINEL");
    const link = join(outputsDir, "leak.txt");
    symlinkSync(secret, link);
    const file = boundedFile(link, root, { files: 0, bytes: 0 });
    assert.equal(file.type, "unavailable");
    assert.equal(file.unavailable_reason, "not-regular");
    assert.ok(!(file.content ?? "").includes("TOP-SECRET-SENTINEL"));
    rmSync(secretDir, { recursive: true, force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("boundedFile enforces the per-file and total byte budgets instead of loading unbounded content", () => {
  const { root, outputsDir } = fixture();
  try {
    const big = join(outputsDir, "big.txt");
    writeFileSync(big, "X".repeat(REVIEW_OUTPUT_BUDGET.max_file_bytes + 1024));
    const file = boundedFile(big, root, { files: 0, bytes: 0 });
    assert.equal(file.truncated, true);
    assert.ok((file.embedded_bytes ?? 0) <= REVIEW_OUTPUT_BUDGET.max_file_bytes);
    assert.match(file.content ?? "", /Truncated by viewer budget/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("findRuns skips a directory symlink and does not traverse outside the workspace via it", () => {
  const { root, runDir } = fixture();
  try {
    const outsideDir = mkdtempSync(join(tmpdir(), "agent-review-outside-"));
    const outsideRun = join(outsideDir, "eval-outside", "with_agent", "run-1", "outputs");
    mkdirSync(outsideRun, { recursive: true });
    writeFileSync(join(outsideDir, "eval-outside", "eval_metadata.json"), JSON.stringify({ eval_id: "outside" }));
    writeFileSync(join(outsideRun, "sentinel.txt"), "OUTSIDE-SENTINEL");
    const link = join(root, "escape-link");
    symlinkSync(join(outsideDir, "eval-outside"), link);
    const runs = findRuns(root);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].id, relativeRunId(root, runDir));
    rmSync(outsideDir, { recursive: true, force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function relativeRunId(root: string, runDir: string) {
  return runDir.slice(root.length + 1).split(/[\\/]/).join("-");
}

test("generateHtml embeds output content only as an escaped data value, never as raw executable markup", () => {
  const { root, outputsDir } = fixture();
  try {
    writeFileSync(join(outputsDir, "payload.txt"), "</script><img src=x onerror=alert(1)>");
    const runs = findRuns(root);
    const html = generateHtml(runs, "agent");
    assert.ok(!html.includes("<img src=x onerror=alert(1)>"));
    assert.ok(html.includes("\\u003cimg src=x onerror=alert(1)\\u003e") || html.includes("img src=x onerror=alert(1)"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("isAllowedOrigin permits loopback and same-port origins, rejects foreign origins", () => {
  assert.equal(isAllowedOrigin(undefined, 3117), true);
  assert.equal(isAllowedOrigin("http://127.0.0.1:3117", 3117), true);
  assert.equal(isAllowedOrigin("http://localhost:3117", 3117), true);
  assert.equal(isAllowedOrigin("http://evil.example.com", 3117), false);
  assert.equal(isAllowedOrigin("http://127.0.0.1:9999", 3117), false);
  assert.equal(isAllowedOrigin("not a url", 3117), false);
});
