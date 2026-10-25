/** Runs a bundled command entrypoint without spawning the executable as a JavaScript runtime. */
export interface EmbeddedResult { status: number; stdout: string; stderr: string }
class EmbeddedExit { constructor(readonly status: number) {} }

export async function runEmbedded(main: () => unknown | Promise<unknown>, argv: string[]): Promise<EmbeddedResult> {
  const originalArgv = process.argv;
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalError = console.error;
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  let stdout = "", stderr = "", status = 0;
  const append = (target: "stdout" | "stderr", values: unknown[]) => {
    const text = values.map(value => typeof value === "string" ? value : String(value)).join(" ") + "\n";
    if (target === "stdout") stdout += text; else stderr += text;
  };
  try {
    process.argv = [originalArgv[0] ?? "creator", "embedded-command", ...argv];
    (process as unknown as { exit: (code?: number) => never }).exit = ((code = 0) => { throw new EmbeddedExit(code); });
    console.log = (...values: unknown[]) => append("stdout", values);
    console.error = (...values: unknown[]) => append("stderr", values);
    process.stdout.write = ((chunk: unknown) => { stdout += String(chunk); return true; }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown) => { stderr += String(chunk); return true; }) as typeof process.stderr.write;
    const result = await main();
    if (typeof result === "number") status = result;
  } catch (error) {
    if (error instanceof EmbeddedExit) status = error.status;
    else throw error;
  } finally {
    process.argv = originalArgv;
    process.exit = originalExit;
    console.log = originalLog;
    console.error = originalError;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
  return { status, stdout, stderr };
}
