// Runner contracts for non-interactive skill evaluation.
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

export class RunnerError extends Error {}

export type StreamProcess = ChildProcessByStdio<null, Readable, null>;

export interface Runner {
  runText(prompt: string, model: string | null, timeout?: number, cwd?: string): Promise<string>;
  startStream(query: string, model: string | null, cwd: string): StreamProcess;
  eventLoadedSkill(event: Record<string, unknown>, skillName: string): boolean | null;
}
