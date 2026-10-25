import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run([path.join(root, "scripts", "build.mjs")]);

const tests = readdirSync(path.join(root, "tests"))
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => path.join(root, "tests", name));

if (tests.length === 0) {
  throw new Error(`No test files found in ${path.join(root, "tests")}`);
}

run(["--test", ...tests]);
