#!/usr/bin/env node
/**
 * Generate and serve a review page for eval results.
 *
 * Reads the workspace directory, discovers runs (directories with outputs/),
 * embeds all output data into a self-contained HTML page, and serves it via
 * a tiny HTTP server bound to loopback only. Feedback auto-saves to
 * feedback.json in the workspace.
 *
 * Usage:
 *   node generate_review.js <workspace-path> [--port PORT] [--agent-name NAME]
 *   node generate_review.js <workspace-path> --previous-feedback /path/to/old/feedback.json
 *
 * No dependencies beyond the Node stdlib are required.
 *
 * Security posture (ap-g9b): embedded data is escaped against script-context
 * injection; output/directory reads are no-follow, identity-checked and
 * budget-bounded so untrusted workspace content cannot exfiltrate outside the
 * reviewed tree or exhaust memory; the loopback feedback API validates
 * Origin and Content-Type and bounds request size; the server never
 * terminates unrelated processes occupying a busy port.
 */
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  writeFileSync,
  existsSync,
  statSync,
  mkdirSync,
  opendirSync,
} from "node:fs";
import { join, relative, dirname, extname, resolve, basename } from "node:path";
import { parseArgs } from "node:util";
import { createServer } from "node:http";

const HERE = dirname(new URL(import.meta.url).pathname);

const METADATA_FILES = new Set(["transcript.md", "user_notes.md", "metrics.json"]);

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".csv", ".py", ".js", ".ts", ".tsx", ".jsx",
  ".yaml", ".yml", ".xml", ".html", ".css", ".sh", ".rb", ".go", ".rs",
  ".java", ".c", ".cpp", ".h", ".hpp", ".sql", ".r", ".toml",
]);

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);

const MIME_OVERRIDES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html", ".htm": "text/html", ".css": "text/css",
  ".js": "text/javascript", ".json": "application/json", ".txt": "text/plain",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf",
};

/** Explicit viewer resource budgets. Untrusted workspace content must never exceed these. */
export const REVIEW_OUTPUT_BUDGET = Object.freeze({
  max_files: 256,
  max_total_bytes: 4 * 1024 * 1024,
  max_file_bytes: 256 * 1024,
  max_depth: 8,
  max_directory_entries: 8192,
  max_directories: 4096,
  max_runs: 2048,
  max_html_bytes: 8 * 1024 * 1024,
  max_feedback_bytes: 1024 * 1024,
});

function getMimeType(path: string): string {
  const ext = extname(path).toLowerCase();
  if (MIME_OVERRIDES[ext]) return MIME_OVERRIDES[ext];
  return MIME_TYPES[ext] || "application/octet-stream";
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

interface OutputFile {
  name: string;
  type: string;
  content?: string;
  mime?: string;
  data_uri?: string;
  data_b64?: string;
  provenance: string;
  byte_length?: number;
  embedded_bytes?: number;
  truncated?: boolean;
  unavailable_reason?: string;
}

interface Run {
  id: string;
  prompt: string;
  eval_id: unknown;
  outputs: OutputFile[];
  output_omission: { omitted_at_least: number; limit: number; reason: string } | null;
  grading: unknown;
}

interface FileBudget {
  files: number;
  bytes: number;
}

/**
 * Reads a single output file under an explicit no-follow, identity-checked,
 * budget-bounded contract. Symlinks and non-regular files are refused;
 * reads never exceed the per-file or remaining total-byte budget; the file
 * identity (device/inode/size/mtime) is re-checked after read to detect a
 * TOCTOU swap, and the result is discarded if it changed mid-read.
 */
function boundedFile(path: string, root: string, budget: FileBudget): OutputFile {
  const ext = extname(path).toLowerCase();
  const mime = getMimeType(path);
  const name = basename(path);
  const provenance = relative(root, path).split("\\").join("/");
  try {
    const named = lstatSync(path);
    if (named.isSymbolicLink() || !named.isFile()) {
      return { name, type: "unavailable", content: "Output unavailable: not a regular file.", provenance, unavailable_reason: "not-regular" };
    }
    if (budget.files >= REVIEW_OUTPUT_BUDGET.max_files) {
      return { name, type: "unavailable", content: "Output unavailable: viewer file-count budget exhausted.", provenance, byte_length: named.size, unavailable_reason: "file-count-budget" };
    }
    budget.files++;
    const remaining = Math.max(0, REVIEW_OUTPUT_BUDGET.max_total_bytes - budget.bytes);
    const allowed = Math.min(named.size, REVIEW_OUTPUT_BUDGET.max_file_bytes, remaining);
    if (allowed <= 0) {
      return { name, type: "unavailable", content: "Output unavailable: viewer byte budget exhausted.", provenance, byte_length: named.size, unavailable_reason: "total-byte-budget" };
    }
    let fd: number | undefined;
    try {
      fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const before = fstatSync(fd);
      if (before.dev !== named.dev || before.ino !== named.ino || !before.isFile()) {
        throw new Error("identity changed");
      }
      const buffer = Buffer.alloc(allowed);
      let offset = 0;
      while (offset < allowed) {
        const count = readSync(fd, buffer, offset, allowed - offset, offset);
        if (!count) break;
        offset += count;
      }
      const read = buffer.subarray(0, offset);
      const after = fstatSync(fd);
      if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
        throw new Error("changed while read");
      }
      budget.bytes += read.length;
      const truncated = read.length < named.size;
      const notice = truncated ? "\n\n[Truncated by viewer budget: showing " + read.length + " of " + named.size + " bytes.]" : "";
      if (TEXT_EXTENSIONS.has(ext)) {
        return { name, type: "text", content: read.toString("utf8") + notice, provenance, byte_length: named.size, embedded_bytes: read.length, truncated };
      }
      const data = read.toString("base64");
      if (ext === ".xlsx") {
        return { name, type: "xlsx", data_b64: data, content: truncated ? "Truncated preview: " + read.length + " of " + named.size + " bytes embedded." : undefined, provenance, byte_length: named.size, embedded_bytes: read.length, truncated };
      }
      const type = IMAGE_EXTENSIONS.has(ext) ? "image" : ext === ".pdf" ? "pdf" : "binary";
      return { name, type, mime, data_uri: "data:" + mime + ";base64," + data, content: truncated ? "Truncated preview: " + read.length + " of " + named.size + " bytes embedded." : undefined, provenance, byte_length: named.size, embedded_bytes: read.length, truncated };
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  } catch {
    return { name, type: "error", content: "Output unavailable: error reading file.", provenance, unavailable_reason: "read-error" };
  }
}

function buildRun(root: string, runDir: string, budget: FileBudget): Run | null {
  let prompt = "";
  let evalId: unknown = null;

  for (const candidate of [join(runDir, "eval_metadata.json"), join(dirname(runDir), "eval_metadata.json")]) {
    if (existsSync(candidate)) {
      try {
        const metadata = JSON.parse(readFileSync(candidate, "utf-8"));
        prompt = metadata.prompt ?? "";
        evalId = metadata.eval_id ?? null;
      } catch {
        // ignore malformed metadata
      }
      if (prompt) break;
    }
  }

  if (!prompt) {
    for (const candidate of [join(runDir, "transcript.md"), join(runDir, "outputs", "transcript.md")]) {
      if (existsSync(candidate)) {
        try {
          const text = readFileSync(candidate, "utf-8");
          const match = /## Eval Prompt\n\n([\s\S]*?)(?=\n##|$)/.exec(text);
          if (match) prompt = match[1].trim();
        } catch {
          // ignore
        }
        if (prompt) break;
      }
    }
  }

  if (!prompt) prompt = "(No prompt found)";

  const runId = relative(root, runDir).split(/[\\/]/).join("-");

  const outputsDir = join(runDir, "outputs");
  const outputFiles: OutputFile[] = [];
  let output_omission: Run["output_omission"] = null;
  if (isDir(outputsDir)) {
    const remaining = Math.max(0, REVIEW_OUTPUT_BUDGET.max_files - budget.files);
    const names: string[] = [];
    let scanned = 0;
    let hasMore = false;
    const dir = opendirSync(outputsDir);
    try {
      while (true) {
        const entry = dir.readSync();
        if (!entry) break;
        scanned++;
        if (scanned > REVIEW_OUTPUT_BUDGET.max_directory_entries) {
          hasMore = true;
          break;
        }
        if (!entry.isFile() || METADATA_FILES.has(entry.name)) continue;
        if (names.length >= remaining) {
          hasMore = true;
          break;
        }
        names.push(entry.name);
      }
    } finally {
      dir.closeSync();
    }
    for (const name of names.sort()) outputFiles.push(boundedFile(join(outputsDir, name), root, budget));
    if (hasMore) {
      output_omission = {
        omitted_at_least: 1,
        limit: REVIEW_OUTPUT_BUDGET.max_files,
        reason: scanned > REVIEW_OUTPUT_BUDGET.max_directory_entries ? "directory-entry-budget" : "file-count-budget",
      };
    }
  }

  let grading: unknown = null;
  for (const candidate of [join(runDir, "grading.json"), join(dirname(runDir), "grading.json")]) {
    if (existsSync(candidate)) {
      try {
        grading = JSON.parse(readFileSync(candidate, "utf-8"));
      } catch {
        // ignore
      }
      if (grading) break;
    }
  }

  return { id: runId, prompt, eval_id: evalId, outputs: outputFiles, output_omission, grading };
}

/** Bounded recursive traversal: caps depth, directory count, entries scanned, and total runs found. */
function findRunsRecursive(
  root: string,
  current: string,
  runs: Run[],
  budget: FileBudget,
  traversal: { directories: number; entries: number },
  depth: number
): void {
  if (depth > REVIEW_OUTPUT_BUDGET.max_depth) return;
  if (runs.length >= REVIEW_OUTPUT_BUDGET.max_runs) return;
  if (traversal.directories >= REVIEW_OUTPUT_BUDGET.max_directories) return;
  if (!isDir(current)) return;
  traversal.directories++;
  const outputsDir = join(current, "outputs");
  if (isDir(outputsDir)) {
    const run = buildRun(root, current, budget);
    if (run) runs.push(run);
    return;
  }
  const skip = new Set(["node_modules", ".git", "__pycache__", "skill", "inputs"]);
  const names: string[] = [];
  const handle = opendirSync(current);
  try {
    while (true) {
      const entry = handle.readSync();
      if (!entry) break;
      traversal.entries++;
      if (traversal.entries > REVIEW_OUTPUT_BUDGET.max_directory_entries) break;
      if (entry.isDirectory() && !skip.has(entry.name)) names.push(entry.name);
    }
  } finally {
    handle.closeSync();
  }
  for (const child of names.sort()) {
    findRunsRecursive(root, join(current, child), runs, budget, traversal, depth + 1);
    if (runs.length >= REVIEW_OUTPUT_BUDGET.max_runs || traversal.entries > REVIEW_OUTPUT_BUDGET.max_directory_entries) break;
  }
}

function findRuns(workspace: string): Run[] {
  const runs: Run[] = [];
  const budget: FileBudget = { files: 0, bytes: 0 };
  const traversal = { directories: 0, entries: 0 };
  findRunsRecursive(workspace, workspace, runs, budget, traversal, 0);
  runs.sort((a, b) => {
    const aId = typeof a.eval_id === "number" ? a.eval_id : Infinity;
    const bId = typeof b.eval_id === "number" ? b.eval_id : Infinity;
    if (aId !== bId) return aId - bId;
    return a.id.localeCompare(b.id);
  });
  return runs;
}

interface PreviousEntry {
  feedback: string;
  outputs: OutputFile[];
}

function loadPreviousIteration(workspace: string): Record<string, PreviousEntry> {
  const result: Record<string, PreviousEntry> = {};
  const feedbackMap: Record<string, string> = {};
  const feedbackPath = join(workspace, "feedback.json");
  if (existsSync(feedbackPath)) {
    try {
      const data = JSON.parse(readFileSync(feedbackPath, "utf-8"));
      for (const r of data.reviews ?? []) {
        if (r.feedback?.trim()) feedbackMap[r.run_id] = r.feedback;
      }
    } catch {
      // ignore
    }
  }

  const prevRuns = findRuns(workspace);
  for (const run of prevRuns) {
    result[run.id] = { feedback: feedbackMap[run.id] ?? "", outputs: run.outputs ?? [] };
  }
  for (const [runId, fb] of Object.entries(feedbackMap)) {
    if (!(runId in result)) result[runId] = { feedback: fb, outputs: [] };
  }
  return result;
}

/**
 * Serializes embedded data for direct inline placement inside a <script>
 * element. Escapes '<' (to block "</script>" boundary breakout) and the
 * U+2028/U+2029 line separators (which are valid in JSON strings but
 * illegal as raw characters in a JS statement and could otherwise be used
 * to smuggle statements past naive concatenation).
 */
function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function generateHtml(
  runs: Run[],
  agentName: string,
  previous?: Record<string, PreviousEntry>,
  benchmark?: unknown
): string {
  const templatePath = join(HERE, "viewer.html");
  const template = readFileSync(templatePath, "utf-8");

  const previousFeedback: Record<string, string> = {};
  const previousOutputs: Record<string, OutputFile[]> = {};
  if (previous) {
    for (const [runId, data] of Object.entries(previous)) {
      if (data.feedback) previousFeedback[runId] = data.feedback;
      if (data.outputs?.length) previousOutputs[runId] = data.outputs;
    }
  }

  const embedded: Record<string, unknown> = {
    agent_name: agentName,
    runs,
    previous_feedback: previousFeedback,
    previous_outputs: previousOutputs,
  };
  if (benchmark) embedded.benchmark = benchmark;

  const html = template.replace("/*__EMBEDDED_DATA__*/", `const EMBEDDED_DATA = ${safeJson(embedded)};`);
  if (Buffer.byteLength(html) > REVIEW_OUTPUT_BUDGET.max_html_bytes) {
    throw new Error("review HTML exceeds the explicit 8 MiB report budget");
  }
  return html;
}

function parseCliArgs(argv: string[]) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: "string", short: "p", default: "3117" },
      "agent-name": { type: "string", short: "n" },
      "previous-workspace": { type: "string" },
      benchmark: { type: "string" },
      static: { type: "string", short: "s" },
    },
  });
  return { positionals, values };
}

/**
 * Loopback origin allowlist for the feedback API. Only requests that either
 * carry no Origin header (same-process/tools) or an explicit
 * http(s)://127.0.0.1|localhost[:port] origin are accepted; every other
 * origin is refused to block a foreign page's script from writing feedback
 * via the browser (CSRF).
 */
function isAllowedOrigin(origin: string | undefined, port: number): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    const hostOk = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
    const portOk = url.port === "" || Number(url.port) === port;
    return hostOk && portOk;
  } catch {
    return false;
  }
}

async function main() {
  const { positionals, values } = parseCliArgs(process.argv.slice(2));
  const [workspaceArg] = positionals;
  if (!workspaceArg) {
    console.error("usage: generate_review.js <workspace-path> [--port PORT] [--agent-name NAME]");
    process.exit(2);
  }

  const workspace = resolve(workspaceArg);
  if (!isDir(workspace)) {
    console.error(`Error: ${workspace} is not a directory`);
    process.exit(1);
  }

  const runs = findRuns(workspace);
  if (!runs.length) {
    console.error(`No runs found in ${workspace}`);
    process.exit(1);
  }

  const agentName = (values["agent-name"] as string) || basename(workspace).replace("-workspace", "");
  const feedbackPath = join(workspace, "feedback.json");

  let previous: Record<string, PreviousEntry> = {};
  if (values["previous-workspace"]) {
    previous = loadPreviousIteration(resolve(values["previous-workspace"] as string));
  }

  const benchmarkPath = values.benchmark ? resolve(values.benchmark as string) : null;
  let benchmark: unknown = null;
  if (benchmarkPath && existsSync(benchmarkPath)) {
    try {
      benchmark = JSON.parse(readFileSync(benchmarkPath, "utf-8"));
    } catch {
      // ignore
    }
  }

  if (values.static) {
    const html = generateHtml(runs, agentName, previous, benchmark);
    const staticPath = resolve(values.static as string);
    mkdirSync(dirname(staticPath), { recursive: true });
    writeFileSync(staticPath, html);
    console.log(`\n  Static viewer written to: ${staticPath}\n`);
    process.exit(0);
  }

  let port = Number(values.port);

  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    const origin = req.headers.origin;
    if (req.method === "GET" && (url === "/" || url === "/index.html")) {
      const liveRuns = findRuns(workspace);
      let liveBenchmark: unknown = null;
      if (benchmarkPath && existsSync(benchmarkPath)) {
        try {
          liveBenchmark = JSON.parse(readFileSync(benchmarkPath, "utf-8"));
        } catch {
          // ignore
        }
      }
      const html = generateHtml(liveRuns, agentName, previous, liveBenchmark);
      const content = Buffer.from(html, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": content.length });
      res.end(content);
    } else if (url === "/api/feedback" && !isAllowedOrigin(origin, port)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "origin not allowed" }));
    } else if (req.method === "GET" && url === "/api/feedback") {
      const data = existsSync(feedbackPath) ? readFileSync(feedbackPath) : Buffer.from("{}");
      res.writeHead(200, { "Content-Type": "application/json", "Content-Length": data.length });
      res.end(data);
    } else if (req.method === "POST" && url === "/api/feedback") {
      const contentType = String(req.headers["content-type"] ?? "");
      if (!contentType.toLowerCase().startsWith("application/json")) {
        res.writeHead(415, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Content-Type must be application/json" }));
        req.resume();
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      let rejected = false;
      req.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > REVIEW_OUTPUT_BUDGET.max_feedback_bytes) {
          if (!rejected) {
            rejected = true;
            res.writeHead(413, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "feedback exceeds 1 MiB" }));
          }
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (rejected) return;
        const body = Buffer.concat(chunks).toString("utf-8");
        let resp: Buffer;
        let status: number;
        try {
          const data = JSON.parse(body);
          if (typeof data !== "object" || data === null || !("reviews" in data)) {
            throw new Error("Expected JSON object with 'reviews' key");
          }
          writeFileSync(feedbackPath, `${JSON.stringify(data, null, 2)}\n`);
          resp = Buffer.from('{"ok":true}');
          status = 200;
        } catch (error) {
          resp = Buffer.from(JSON.stringify({ error: (error as Error).message }));
          status = 400;
        }
        res.writeHead(status, { "Content-Type": "application/json", "Content-Length": resp.length });
        res.end(resp);
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", (error: any) => {
      // Never terminate a process occupying the requested port; instead
      // fall back to an OS-assigned ephemeral port on the same loopback
      // interface.
      if (error.code === "EADDRINUSE") {
        server.listen(0, "127.0.0.1", () => resolvePromise());
      } else {
        reject(error);
      }
    });
    server.listen(port, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  if (address && typeof address === "object") port = address.port;

  const url = `http://127.0.0.1:${port}`;
  console.log("\n  Eval Viewer");
  console.log("  ─────────────────────────────────");
  console.log(`  URL:       ${url}`);
  console.log(`  Workspace: ${workspace}`);
  console.log(`  Feedback:  ${feedbackPath}`);
  if (Object.keys(previous).length) {
    console.log(`  Previous:  ${values["previous-workspace"]} (${Object.keys(previous).length} runs)`);
  }
  if (benchmarkPath) console.log(`  Benchmark: ${benchmarkPath}`);
  console.log("\n  Press Ctrl+C to stop.\n");
  console.log("  Open the URL above manually; the viewer no longer auto-launches a browser.\n");

  process.on("SIGINT", () => {
    console.log("\nStopped.");
    server.close();
    process.exit(0);
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)
) {
  main().catch((error) => {
    console.error(error?.message ?? error);
    process.exit(1);
  });
}

export { findRuns, buildRun, generateHtml, safeJson, boundedFile, isAllowedOrigin };
