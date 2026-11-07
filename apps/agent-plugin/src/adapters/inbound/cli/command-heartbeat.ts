import type { CliOutput } from "./cli-output.ts";

export const HEARTBEAT_INTERVAL_MS = 10_000;
type HeartbeatOperation = "evaluation" | "resume" | "grading" | "regrading";

/** Presentation only: active means the command is pending, not model progress or quality.
 * Plain stderr lines work identically in terminals and redirected logs. Never include
 * selectors, prompts, host diagnostics or other potentially private command inputs.
 */
export async function executeWithHeartbeat<T>(output: CliOutput, operation: HeartbeatOperation, quiet: boolean, execute: () => Promise<T>): Promise<T> {
  if (quiet) return await execute();
  const started = performance.now();
  const timer = setInterval(() => {
    try {
      const elapsed = Math.floor((performance.now() - started) / 1000);
      output.writeErr(`[agent-plugin] ${operation}: active; elapsed ${elapsed}s\n`);
    } catch {
      // A diagnostic sink failure must not throw asynchronously into execution.
      // Final result/error writes retain their ordinary failure semantics.
      clearInterval(timer);
    }
  }, HEARTBEAT_INTERVAL_MS);
  // Observation must neither keep a finished/interrupted process alive nor own streams.
  timer.unref();
  try { return await execute(); }
  finally { clearInterval(timer); }
}
