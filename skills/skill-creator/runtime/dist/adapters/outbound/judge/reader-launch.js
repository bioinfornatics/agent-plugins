import { fileURLToPath } from "node:url";
/** URL follows source/dist placement, including the contained Skill runtime. Values are
 * launch arguments only, never generated executable source or a candidate-selected command. */
export function trustedReaderCommand(root, hash) {
    const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
    const entry = fileURLToPath(new URL(`../../../judge-evidence-reader.${extension}`, import.meta.url));
    // Goose v1.57.0 crates/goose/src/utils.rs::split_command_args is not POSIX:
    // backslashes are literal and a single quote opens only at an empty token.
    // Mixed quote characters cannot safely use shell concatenation; refuse before writes.
    // Source inspected 2026-11-07: https://github.com/block/goose/blob/v1.57.0/crates/goose/src/utils.rs
    const quote = (value) => {
        if (!value || value.includes("'") && value.includes('"'))
            throw new Error("Unsupported mixed quotes in judge reader launch path");
        return value.includes("'") ? `"${value}"` : `'${value}'`;
    };
    return `judge_evidence:${[process.execPath, entry, root, hash].map(quote).join(" ")}`;
}
