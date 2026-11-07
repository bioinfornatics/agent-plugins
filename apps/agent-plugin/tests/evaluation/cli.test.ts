import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "../../src/main.ts";

test("evaluation exposes combinable targets and native limit options", async () => {
  let out = "", err = "";
  const code = await main(["evaluation", "--help"], {
    writeOut: (s) => { out += s; }, writeErr: (s) => { err += s; },
  });
  assert.strictEqual(code, 0);
  assert.strictEqual(err, "");
  for (const option of ["--skills", "--plugin", "--model", "--repetitions", "--max-turns"]) assert.ok((out).includes(option));
  assert.ok(!(out).includes("--budget"));
});

test("evaluation requires a target instead of reporting empty success", async () => {
  let out = "", err = "";
  const code = await main(["evaluation"], {
    writeOut: (s) => { out += s; }, writeErr: (s) => { err += s; },
  });
  assert.strictEqual(code, 1);
  assert.strictEqual(out, "");
  assert.ok((err).includes("--skills or --plugin"));
});

// Dispatch must not override the Judge adapter defaults with candidate limits.
test("grading and regrading dispatch bounded Judge defaults and explicit overrides", async () => {
  const { createCli } = await import("../../src/adapters/inbound/cli/create-cli.ts");
  for (const name of ["grading", "regrading"]) {
    for (const [flags, expected] of [
      [[], { maxTurns: 20, timeout: 600 }],
      [["--max-turns", "7", "--timeout", "13"], { maxTurns: 7, timeout: 13 }],
      [["--timeout", "0"], { maxTurns: 20, timeout: 0 }],
    ] as const) {
      let received: unknown;
      const cli = createCli({ writeOut: () => {}, writeErr: () => {} }, async () => {}, undefined,
        async input => { received = input; });
      await cli.parseAsync([name, "campaign", "--attempt", "attempt", ...flags], { from: "user" });
      assert.deepEqual(received, { campaignId: "campaign", attemptId: "attempt", registry: undefined,
        agent: "goose", model: undefined, ...expected, json: false });
    }
  }
  let candidate: { maxTurns: number; timeout: number } | undefined;
  const cli = createCli({ writeOut: () => {}, writeErr: () => {} }, async input => { candidate = input; });
  await cli.parseAsync(["evaluation", "--skills", "skill", "--dry-run"], { from: "user" });
  assert.equal(candidate?.maxTurns, 50);
  assert.equal(candidate?.timeout, 0);
});
