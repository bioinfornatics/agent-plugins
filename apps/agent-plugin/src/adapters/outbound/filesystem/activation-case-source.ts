import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type { ActivationCaseSource } from "../../../application/ports/activation-case-source.ts";
import { EvaluationError } from "../../../domain/evaluation.ts";
import { readSnapshotFile } from "./evaluation-snapshot.ts";

/** Same 4 MiB no-follow regular-file bound as captured suites; the resolved path is read once. */
export class FilesystemActivationCaseSource implements ActivationCaseSource {
  async read(path: string): Promise<{ document: unknown; sha256: string }> {
    let bytes: Buffer;
    try { bytes = (await readSnapshotFile(await realpath(resolve(path)), { bytes: 0, entries: 0 })).bytes; }
    catch (error) {
      if (error instanceof EvaluationError) throw error;
      throw new EvaluationError(`${path}: unreadable queries file`);
    }
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new EvaluationError(`${path}: queries file must be UTF-8 JSON`); }
    let document: unknown;
    try { document = JSON.parse(text); }
    catch { throw new EvaluationError(`${path}: queries file must be valid JSON`); }
    return { document, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
}
