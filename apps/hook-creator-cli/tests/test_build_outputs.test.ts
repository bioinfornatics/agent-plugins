import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const unix = process.platform !== "win32";

for (const name of ["cli.js", "init_hook.js", "validate_hook.js"]) {
  test(`compiled ${name} preserves its platform entry-point contract`, () => {
    const entry = join(root, "dist", name);
    assert.match(readFileSync(entry, "utf8").split("\n", 1)[0], /^#!\/usr\/bin\/env node$/);

    if (unix) {
      assert.ok(statSync(entry).mode & 0o111, `${name} must retain an executable bit`);
    }

    if (name === "cli.js") {
      const command = unix ? entry : process.execPath;
      const args = unix ? ["--help"] : [entry, "--help"];
      execFileSync(command, args, { cwd: root, stdio: "pipe" });
    }
  });
}
