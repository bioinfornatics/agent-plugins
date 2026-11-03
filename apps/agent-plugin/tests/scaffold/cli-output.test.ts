import { test } from "node:test";
import assert from "node:assert/strict";
import { StreamCliOutput } from "../../src/adapters/inbound/cli/stream-cli-output.ts";
import { createCli } from "../../src/adapters/inbound/cli/create-cli.ts";

test("detached callbacks preserve destinations and exact text", () => {
  const out: string[] = [];
  const err: string[] = [];
  const output = new StreamCliOutput(
    { write: (text) => { out.push(text); } },
    { write: (text) => { err.push(text); } },
  );
  const { writeOut, writeErr } = output;
  writeOut("result\n");
  writeErr("failure\n");
  assert.deepStrictEqual(out, ["result\n"]);
  assert.deepStrictEqual(err, ["failure\n"]);
});

test("Commander routes help and parse errors through the named implementation", async () => {
  let out = "";
  let err = "";
  const output = new StreamCliOutput(
    { write: (text) => { out += text; } },
    { write: (text) => { err += text; } },
  );
  const handleEvaluation = async () => { throw new Error("Help and parse errors must not dispatch evaluation"); };
  await assert.rejects(createCli(output, handleEvaluation).parseAsync(["--help"], { from: "user" }), { code: "commander.helpDisplayed", exitCode: 0 });
  assert.ok((out).includes("Usage: agent-plugin"));
  assert.strictEqual(err, "");
  out = "";
  await assert.rejects(createCli(output, handleEvaluation).parseAsync(["--unknown"], { from: "user" }), { code: "commander.unknownOption", exitCode: 1 });
  assert.strictEqual(out, "");
  assert.strictEqual(err, "error: unknown option '--unknown'\n");
});

// Compile-time regression: CLI construction requires explicit command wiring.
function _verifyRequiredHandler(output: Parameters<typeof createCli>[0]) {
  // @ts-expect-error Missing the required evaluation handler.
  createCli(output);
}

test("evaluation dispatches parsed input to the required handler", async () => {
  const calls: unknown[] = [];
  const cli = createCli(
    { writeOut: () => { throw new Error("Unexpected output"); }, writeErr: () => { throw new Error("Unexpected diagnostic"); } },
    async (input, dryRun) => { calls.push({ input, dryRun }); },
  );
  await cli.parseAsync(["evaluation", "--skills", "sample", "--dry-run"], { from: "user" });
  assert.deepStrictEqual(calls, [{
    input: { skills: ["sample"], plugins: [], profileName: undefined, agents: ["goose"], model: undefined,
      repetitions: 3, maxTurns: 50, timeout: 0, parallelism: 3, output: undefined, registry: undefined },
    dryRun: true,
  }]);
});
