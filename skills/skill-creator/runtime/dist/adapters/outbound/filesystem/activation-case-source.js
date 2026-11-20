import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { EvaluationError } from "../../../domain/evaluation.js";
import { readSnapshotFile } from "./evaluation-snapshot.js";
/** Same 4 MiB no-follow regular-file bound as captured suites; the resolved path is read once. */
export class FilesystemActivationCaseSource {
    async read(path) {
        let bytes;
        try {
            bytes = (await readSnapshotFile(await realpath(resolve(path)), { bytes: 0, entries: 0 })).bytes;
        }
        catch (error) {
            if (error instanceof EvaluationError)
                throw error;
            throw new EvaluationError(`${path}: unreadable queries file`);
        }
        let text;
        try {
            text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        }
        catch {
            throw new EvaluationError(`${path}: queries file must be UTF-8 JSON`);
        }
        let document;
        try {
            document = JSON.parse(text);
        }
        catch {
            throw new EvaluationError(`${path}: queries file must be valid JSON`);
        }
        return { document, sha256: createHash("sha256").update(bytes).digest("hex") };
    }
}
