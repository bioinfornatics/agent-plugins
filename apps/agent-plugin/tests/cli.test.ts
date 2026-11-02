import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

async function runCli(...args: string[]) {
  const cli = Bun.spawn([process.execPath, "src/index.ts", ...args], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    cli.exited,
    new Response(cli.stdout).text(),
    new Response(cli.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

test("CLI lists the three registered adapters", async () => {
  expect(await runCli("agents")).toEqual({
    exitCode: 0,
    stdout: "goose\ncodex\nclaude\n",
    stderr: "",
  });
});

test("CLI help exposes commands without contacting an agent", async () => {
  const result = await runCli("--help");
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("agents");
  expect(result.stdout).toContain("run");
  expect(result.stderr).toBe("");
});

test.each(["goose", "codex", "claude"])("CLI refuses unconfigured %s client", async (agent) => {
  expect(await runCli("run", "--agent", agent, "--prompt", "Create a skill")).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: `error: Agent client '${agent}' is not configured\n`,
  });
});

test.each([
  [["run", "--agent", "other", "--prompt", "hello"]],
  [["run", "--agent", "goose", "--prompt", "   "]],
  [["run", "--agent", "goose"]],
  [["unknown"]],
])("CLI rejects invalid arguments: %j", async (args) => {
  const result = await runCli(...args);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toStartWith("error:");
});
