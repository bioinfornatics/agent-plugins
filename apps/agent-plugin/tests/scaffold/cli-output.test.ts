import { expect, test } from "bun:test";
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
  expect(out).toEqual(["result\n"]);
  expect(err).toEqual(["failure\n"]);
});

test("Commander routes help and parse errors through the named implementation", async () => {
  let out = "";
  let err = "";
  const output = new StreamCliOutput(
    { write: (text) => { out += text; } },
    { write: (text) => { err += text; } },
  );
  const handleEvaluation = async () => { throw new Error("Help and parse errors must not dispatch evaluation"); };
  await expect(createCli(output, handleEvaluation).parseAsync(["--help"], { from: "user" }))
    .rejects.toMatchObject({ code: "commander.helpDisplayed", exitCode: 0 });
  expect(out).toContain("Usage: agent-plugin");
  expect(err).toBe("");
  out = "";
  await expect(createCli(output, handleEvaluation).parseAsync(["--unknown"], { from: "user" }))
    .rejects.toMatchObject({ code: "commander.unknownOption", exitCode: 1 });
  expect(out).toBe("");
  expect(err).toBe("error: unknown option '--unknown'\n");
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
  expect(calls).toEqual([{
    input: { skills: ["sample"], plugins: [], profileName: undefined, agents: ["goose"], model: undefined,
      repetitions: 3, maxTurns: 50, timeout: 0, parallelism: 3, output: undefined, registry: undefined },
    dryRun: true,
  }]);
});
