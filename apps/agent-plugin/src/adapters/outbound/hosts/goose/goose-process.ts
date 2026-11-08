import { spawn } from "node:child_process";

export interface ProcessResult { stdout: Buffer; stderr: Buffer; stdoutBytes: number; stderrBytes: number; exitCode: number | null; timeout: boolean; overflow: boolean }
const OUTPUT_LIMIT = 16 * 1024 * 1024;
/** No shell; timeout is milliseconds (0 disables it). stdout/stderr share a 16 MiB capture bound.
 * Byte counts measure observed stream bytes (before capture truncation), not total child output.
 * Deadline/overflow stops the detached POSIX group (child only on Windows), with a 1-second kill grace.
 */
export function gooseProcess(executable: string, args: string[], env: NodeJS.ProcessEnv, cwd: string, input = "", timeout = 10000): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, cwd, shell: false, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0, stdoutBytes = 0, stderrBytes = 0;
    let timedOut = false;
    let overflow = false;
    let stopping = false;
    let hardKill: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const signal = (name: NodeJS.Signals): void => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, name);
        else child.kill(name);
      } catch { /* The group may already have exited. */ }
    };
    const stop = (): void => {
      if (stopping) return;
      stopping = true;
      signal("SIGTERM");
      hardKill = setTimeout(() => {
        signal("SIGKILL");
        // Descendants retaining inherited pipes must not hold the caller indefinitely.
        child.stdout.destroy();
        child.stderr.destroy();
        child.stdin.destroy();
      }, 1000);
    };
    const capture = (chunks: Buffer[], chunk: Buffer): void => {
      const remaining = Math.max(0, OUTPUT_LIMIT - size);
      if (remaining) chunks.push(chunk.subarray(0, remaining));
      size += chunk.length;
      if (size > OUTPUT_LIMIT) { overflow = true; stop(); }
    };
    child.stdout.on("data", (chunk: Buffer) => { stdoutBytes = Math.min(Number.MAX_SAFE_INTEGER, stdoutBytes + chunk.length); capture(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderrBytes = Math.min(Number.MAX_SAFE_INTEGER, stderrBytes + chunk.length); capture(stderr, chunk); });
    child.stdin.on("error", () => { /* EPIPE after early process exit is expected. */ });
    child.on("error", () => {
      if (deadline) clearTimeout(deadline);
      if (hardKill) clearTimeout(hardKill);
      reject(new Error("Unable to start Goose executable"));
    });
    child.on("close", (exitCode) => {
      if (stopping) signal("SIGKILL");
      if (deadline) clearTimeout(deadline);
      if (hardKill) clearTimeout(hardKill);
      resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), stdoutBytes, stderrBytes, exitCode, timeout: timedOut, overflow });
    });
    if (timeout > 0) deadline = setTimeout(() => { timedOut = true; stop(); }, timeout);
    child.stdin.end(input);
  });
}
