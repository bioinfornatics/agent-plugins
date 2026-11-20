import { randomUUID } from "node:crypto";
import { lstat, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ActivationResultWriter } from "../../../application/ports/activation-result-writer.ts";
import type { ActivationRunResult } from "../../../domain/activation-trial.ts";

export const ACTIVATION_RESULT_FILE = "activation-result.json";

/** `activation-result.json` is derived (re-computable from the registry and archives), so a
 * resumed campaign replaces it: a private 0600 sibling is created exclusively, then renamed.
 * rename(2) replaces a planted symlink itself, never its target; evidence files are untouched. */
export class FilesystemActivationResultWriter implements ActivationResultWriter {
  async write(campaignDirectory: string, result: ActivationRunResult): Promise<string> {
    const info = await lstat(campaignDirectory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe campaign directory");
    const destination = join(campaignDirectory, ACTIVATION_RESULT_FILE);
    const staged = join(campaignDirectory, `.${ACTIVATION_RESULT_FILE}.${randomUUID()}.tmp`);
    try {
      await writeFile(staged, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      await rename(staged, destination);
    } catch (error) { await rm(staged, { force: true }); throw error; }
    return destination;
  }
}
