import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { EvidenceReader, inspectReaderRoot, serveEvidenceReader } from "./adapters/outbound/judge/evidence-reader.ts";

/** Trusted app entrypoint compiled by the same source build; never candidate code. */
export async function runEvidenceReader(args: string[]) {
  if (args.length !== 2 || !args[0] || !/^[a-f0-9]{64}$/.test(args[1] ?? "")) throw new Error("Invalid reader binding");
  const root = args[0], hash = args[1] ?? "";
  await inspectReaderRoot(root);
  const trace = await open(join(dirname(root), "reader-trace.jsonl"), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    const reader = new EvidenceReader(root, hash, async event => { await trace.write(`${event}\n`); });
    await serveEvidenceReader(reader, process.stdin, process.stdout);
  } finally { await trace.close(); }
}
if (import.meta.main) {
  try { await runEvidenceReader(process.argv.slice(2)); }
  catch { process.stderr.write("Judge evidence reader failed\n"); process.exitCode = 1; }
}
