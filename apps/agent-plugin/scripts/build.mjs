import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

async function compileJavaScript(stage) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [
    join(root, "node_modules/typescript/bin/tsc"),
    "--project", join(root, "tsconfig.build.json"), "--outDir", stage,
  ], { cwd: root, env, stdio: "inherit" });
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (signal) reject(new Error(`TypeScript compiler terminated by ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

async function buildJavaScript() {
  // Stage on the same filesystem. Failed compilation must not retire usable dist;
  // the backup also allows rollback if promotion fails (not crash-atomic exchange).
  const workspace = await mkdtemp(join(root, ".build-"));
  const stage = join(workspace, "dist");
  const backup = join(workspace, "previous-dist");
  const destination = join(root, "dist");
  let backedUp = false;
  try {
    const code = await compileJavaScript(stage);
    if (code !== 0) return code;
    // Make copied output explicitly ESM without relying on the app's package scope.
    await writeFile(join(stage, "package.json"), '{"type":"module"}\n');
    if (existsSync(destination)) {
      await rename(destination, backup);
      backedUp = true;
    }
    try {
      await rename(stage, destination);
    } catch (error) {
      if (backedUp) {
        await rename(backup, destination);
        backedUp = false;
      }
      throw error;
    }
    backedUp = false;
    return 0;
  } finally {
    // Preserve the backup for manual recovery if rollback itself fails.
    if (!backedUp) await rm(workspace, { recursive: true, force: true });
  }
}

try {
  process.exitCode = await buildJavaScript();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
