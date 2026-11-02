import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

async function run(...args: string[]) {
  const child = Bun.spawn([process.execPath, ...args], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

test("scaffold entrypoint provides help without executing a campaign", async () => {
  const result = await run("src/index.ts", "--help");
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Usage: agent-plugin");
  expect(result.stderr).toBe("");
});

test("unknown options fail once rather than being silently ignored", async () => {
  expect(await run("src/index.ts", "--unknown")).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: "error: unknown option '--unknown'\n",
  });
});

test("importing main does not parse the caller arguments or write output", async () => {
  expect(await run("--eval", "await import('./src/main.ts')", "--", "--unknown")).toEqual({
    exitCode: 0, stdout: "", stderr: "",
  });
});
