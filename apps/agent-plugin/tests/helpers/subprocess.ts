import { spawn } from "node:child_process";
import type { SpawnOptionsWithoutStdio } from "node:child_process";

/** Start draining both pipes immediately, including children awaited later in a batch.
 * Resolve on close (not exit) so diagnostics are complete; signals are not exit codes.
 */
export function startNodeProcess(args: string[], options: SpawnOptionsWithoutStdio = {}) {
  const child = spawn(process.execPath, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let failure: Error | undefined;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  child.on("error", (error) => { failure = error; });
  child.stdout.on("error", (error) => { failure ??= error; });
  child.stderr.on("error", (error) => { failure ??= error; });
  const completed = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve, reject) => {
    child.once("close", (exitCode, signal) => {
      if (failure) reject(failure);
      else resolve({ exitCode, signal, stdout, stderr });
    });
  });
  // A parallel child may fail before its turn to be awaited; retain the rejection
  // for that await without producing an unrelated unhandled-rejection failure.
  void completed.catch(() => {});
  return { child, completed };
}
