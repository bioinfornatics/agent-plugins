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
