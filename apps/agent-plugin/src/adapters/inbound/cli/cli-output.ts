/** CLI output contract. Concrete stream adapter: {@link StreamCliOutput} in stream-cli-output.ts. */
export interface CliOutput {
  writeOut(text: string): void;
  writeErr(text: string): void;
}
