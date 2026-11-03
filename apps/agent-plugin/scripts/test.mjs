import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
async function testFiles(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await testFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".test.ts")) paths.push(path);
  }
  return paths.sort();
}
const files = await testFiles(join(root, "tests"));
if (!files.length) throw new Error("No TypeScript tests found");
// Node 22 does not discover .test.ts by default. Supply the complete inventory,
// clear nested-runner context, and preserve the child's errors, exit code and signal.
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
const child = spawn(process.execPath, ["--test", ...process.argv.slice(2), ...files], { cwd: root, env, stdio: "inherit" });
child.on("error", (error) => { console.error(error); process.exitCode = 1; });
child.on("close", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
