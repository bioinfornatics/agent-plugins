import type { CliOutput } from "./cli-output.ts";

/** An already-open text destination, such as process.stdout or process.stderr. */
export interface TextWriter {
  write(text: string): unknown;
}

/** Adapts two text streams to Commander callbacks; does not own or close them. */
export class StreamCliOutput implements CliOutput {
  constructor(
    private readonly stdout: TextWriter,
    private readonly stderr: TextWriter,
  ) {}

  // Arrow fields retain this when Commander calls them as detached callbacks.
  readonly writeOut = (text: string): void => {
    this.stdout.write(text);
  };

  readonly writeErr = (text: string): void => {
    this.stderr.write(text);
  };
}
