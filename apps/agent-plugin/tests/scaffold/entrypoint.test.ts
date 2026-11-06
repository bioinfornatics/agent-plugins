import { startNodeProcess } from "../helpers/subprocess.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

async function run(...args: string[]) {
  const { completed } = startNodeProcess(args, {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
  });
  const { exitCode, signal, stdout, stderr } = await completed;
  assert.strictEqual(signal, null, stderr);
  return { exitCode, stdout, stderr };
}

test("scaffold entrypoint provides help without executing a campaign", async () => {
  const result = await run("src/index.ts", "--help");
  assert.strictEqual(result.exitCode, 0);
  assert.ok((result.stdout).includes("Usage: agent-plugin"));
  assert.strictEqual(result.stderr, "");
});

test("unknown options fail once rather than being silently ignored", async () => {
  assert.deepStrictEqual(await run("src/index.ts", "--unknown"), {
    exitCode: 1,
    stdout: "",
    stderr: "error: unknown option '--unknown'\n",
  });
});

test("importing main does not parse the caller arguments or write output", async () => {
  assert.deepStrictEqual(await run("--eval", "await import('./src/main.ts')", "--", "--unknown"), {
    exitCode: 0, stdout: "", stderr: "",
  });
});

test("grading and judgment consultation commands expose help without host or SQLite startup", async () => {
  for (const command of ["grading", "regrading", "judgments"]) {
    const result = await run("src/index.ts", command, "--help");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /campaign-id/);
    assert.match(result.stdout, /--registry/);
    assert.equal(result.stderr, "");
  }
});
