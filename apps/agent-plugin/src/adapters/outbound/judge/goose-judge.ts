import { trustedReaderCommand } from "./reader-launch.ts";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { JudgeInstructionWriter } from "../../../application/ports/judge-instructions.ts";
import type { Judge, JudgeRequest, JudgeResult } from "../../../application/ports/judge.ts";
import { validateJudgment } from "../../../domain/judgment.ts";
import { isolatedEnvironment, parseInfo, prepareConfiguration, record, secretStrings, type GooseInfo } from "../hosts/goose/goose-configuration.ts";
import { decodeGooseConversation } from "../hosts/goose/goose-conversation.ts";
import { gooseProcess, type ProcessResult } from "../hosts/goose/goose-process.ts";
import { privateDirectory } from "../hosts/goose/private-files.ts";
import { judgmentPacket } from "./judgment-packet.ts";

export interface GooseJudgeOptions { executable?: string; env?: NodeJS.ProcessEnv; tempRoot?: string; instructionWriter?: JudgeInstructionWriter }
function successful(result: ProcessResult, operation: string): void {
  // Never include native stdout/stderr: they can contain credentials before discovery.
  if (result.timeout) throw new Error(`${operation} timed out`);
  if (result.overflow) throw new Error(`${operation} output overflow`);
  if (result.exitCode !== 0) throw new Error(`${operation} failed`);
}
/** JSON strings can contain serialized JSON (including tool errors). Decode tokens before
 * redacting and re-encode them, rather than guessing one layer of backslash escaping.
 * Bounds cover adversarial nesting/work; overflow omits the entire diagnostic, fail closed. */
function redact(text: string, secrets: Set<string>): string {
  let work = 0, tokens = 0;
  const ordered = [...secrets].filter(Boolean).sort((a, b) => b.length - a.length);
  function visit(value: string, depth: number): string {
    work += Buffer.byteLength(value);
    if (depth > 16 || work > 64 * 1024 * 1024) throw new Error("Sanitization limit");
    // Decoded credentials may themselves contain quotes/backslashes as plain text,
    // not JSON. Remove known raw values before treating their contents as tokens.
    for (const secret of ordered) value = value.split(secret).join("[REDACTED]");
    // Linear token scan: a regex over multi-MiB JSON strings can exhaust V8's stack.
    let nested = "", start = 0;
    for (let i = 0; i < value.length; i++) {
      if (value[i] !== '"') continue;
      const begin = i++;
      let encoded = false;
      for (; i < value.length; i++) {
        if (value[i] === "\\") { encoded = true; i++; continue; }
        if (value[i] === '"') break;
      }
      if (i >= value.length) {
        // Encoded credentials can follow a plain-text/event prefix. If decoding
        // is impossible, never retain the token merely because the prefix is not JSON.
        if (encoded || /^\s*[[{]/.test(value)) throw new Error("Incomplete diagnostic string");
        break;
      }
      if (++tokens > 200000) throw new Error("Sanitization limit");
      const token = value.slice(begin, i + 1);
      let decoded: unknown;
      try { decoded = JSON.parse(token); } catch {
        if (encoded || /^\s*[[{]/.test(value)) throw new Error("Invalid diagnostic string");
        continue;
      }
      const safe = visit(String(decoded), depth + 1);
      nested += value.slice(start, begin) + (safe === decoded ? token : JSON.stringify(safe));
      start = i + 1;
    }
    nested += value.slice(start);
    let safe = nested;
    for (const secret of ordered) {
      safe = safe.split(secret).join("[REDACTED]");
      safe = safe.split(JSON.stringify(secret).slice(1, -1)).join("[REDACTED]");
    }
    return safe;
  }
  try { return visit(text, 0); } catch { return "[OMITTED: diagnostic sanitization limit]"; }
}
/** Only terminal assistant text is a response. Text accompanying a tool request is not final.
 * Named export attribution is required; earlier JSON, tools, fences and latest sessions never qualify.
 */
function terminalResponse(data: unknown, prompt: string): string {
  const { messages } = decodeGooseConversation(data, prompt);
  const last = messages.at(-1);
  if (!record(last) || last.role !== "assistant") throw new Error("Missing terminal assistant response");
  if (Object.keys(last).some(key => /tool[_-]?(?:calls?|requests?)/i.test(key) && last[key] !== undefined)) throw new Error("Terminal response contains tool calls");
  if (typeof last.content === "string" && last.content.trim()) return last.content;
  if (!Array.isArray(last.content) || !last.content.length || !last.content.every(part => record(part) && part.type === "text" && typeof part.text === "string")) throw new Error("Terminal response must contain only text");
  const text = last.content.map(part => part.text).join("\n");
  if (!text.trim()) throw new Error("Empty terminal response");
  return text;
}
/** Local/mock-ready Goose judge transport; importing performs no I/O.
 * HOME/XDG is discovery isolation, not a sandbox; unknown keyring/network secrets are not covered.
 */
export class GooseJudge implements Judge {
  private readonly executable: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly tempRoot: string;
  private readonly instructionWriter: JudgeInstructionWriter | undefined;
  constructor(options: GooseJudgeOptions = {}) {
    this.instructionWriter = options.instructionWriter;
    this.executable = options.executable ?? "goose";
    this.env = { ...(options.env ?? process.env) };
    this.tempRoot = options.tempRoot ?? tmpdir();
  }
  private async info(env: NodeJS.ProcessEnv, cwd: string): Promise<GooseInfo> {
    const result = await gooseProcess(this.executable, ["info"], env, cwd, "", 10000);
    successful(result, "Goose info");
    return parseInfo(result.stdout);
  }
  async judge(request: JudgeRequest): Promise<JudgeResult> {
    const model = request.options?.model;
    const maxTurns = request.options?.maxTurns ?? 20, timeout = request.options?.timeout ?? 600;
    const provenance: JudgeResult["provenance"] = { packetVersion: 2, host: { id: "goose" }, model: { ...(model === undefined ? {} : { requested: model }), source: model === undefined ? "configuration-default" : "override", effective: "unknown" }, limits: { maxTurns, timeout, preflightTimeout: 10, exportTimeout: 10, outputBytes: 16 * 1024 * 1024 } };
    const secrets = new Set<string>();
    secretStrings(this.env, secrets);
    for (const [key, value] of Object.entries(this.env)) if (value && key !== "GOOSE_DISABLE_KEYRING" && /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|PROXY/i.test(key)) secrets.add(value);
    let root: string | undefined;
    let result: JudgeResult;
    try {
      // Reject overrides/limits and malformed input before any host process, including info/help.
      if (model !== undefined && (typeof model !== "string" || !model.trim())) throw new Error("Blank judge model override");
      if (!Number.isSafeInteger(maxTurns) || maxTurns < 1 || !Number.isSafeInteger(timeout) || timeout < 0 || timeout > 2147483) throw new Error("Invalid judge execution limits");
      const packet = judgmentPacket(request);
      const location = request.instructionLocation === undefined ? undefined : structuredClone(request.instructionLocation);
      if (!location || !isAbsolute(location.path) || resolve(location.path) !== location.path || !this.instructionWriter) throw new Error("Persistent judge instruction destination and writer required");
      if ((redact(packet.instructions, secrets) !== packet.instructions || redact(packet.bundle.manifest, secrets) !== packet.bundle.manifest || packet.bundle.files.some(file => redact(file.text, secrets) !== file.text)) || redact(JSON.stringify(location), secrets) !== JSON.stringify(location) || (model !== undefined && redact(model, secrets) !== model)) throw new Error("Judge packet contains known credentials");
      const original = await this.info(this.env, this.tempRoot);
      root = await mkdtemp(join(this.tempRoot, "agent-plugin-judge-"));
      await privateDirectory(root);
      const env = isolatedEnvironment(this.env, root);
      for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR", "APPDATA", "LOCALAPPDATA", "TMPDIR"]) {
        if (env[key]) await privateDirectory(env[key]);
      }
      const workspace = join(root, "workspace"); await privateDirectory(workspace);
      const info = await this.info(env, workspace);
      await prepareConfiguration(original, info, root, secrets);
      if ((redact(packet.instructions, secrets) !== packet.instructions || redact(packet.bundle.manifest, secrets) !== packet.bundle.manifest || packet.bundle.files.some(file => redact(file.text, secrets) !== file.text)) || redact(JSON.stringify(location), secrets) !== JSON.stringify(location) || (model !== undefined && redact(model, secrets) !== model)) throw new Error("Judge request contains known credentials");
      for (const [args, required] of [
        [["run", "--help"], ["--instructions", "--name", "--max-turns", "--quiet", "--output-format", "--model", "--with-extension", "--no-profile", "stream-json"]],
        [["session", "export", "--help"], ["--name", "--format", "json"]],
      ] as const) {
        const help = await gooseProcess(this.executable, [...args], env, workspace, "", 10000);
        successful(help, "Goose CLI preflight");
        const text = help.stdout.toString("utf8") + help.stderr.toString("utf8");
        if (!required.every(flag => text.includes(flag))) throw new Error("Unsupported Goose judge CLI");
      }
      provenance.host.version = info.version;
      const sessionName = `judge-${randomUUID()}`;
      provenance.sessionName = sessionName;
      // Validate parser representability before allocating any persistent instruction/evidence files.
      const readerCommand = trustedReaderCommand(join(dirname(location.path), "evidence"), createHash("sha256").update(packet.bundle.manifest).digest("hex"));
      const artifact = await this.instructionWriter.write(location, packet.instructions, packet.bundle);
      const hash = createHash("sha256").update(packet.instructions).digest("hex");
      if (artifact.path !== location.path || artifact.gradeId !== location.gradeId || artifact.campaignId !== location.campaignId || artifact.attemptId !== location.attemptId || artifact.sha256 !== hash) throw new Error("Judge instruction writer returned mismatched attribution");
      provenance.evidenceManifestSha256 = createHash("sha256").update(packet.bundle.manifest).digest("hex");
      provenance.instructionsSha256 = hash;
      provenance.instructionArtifact = artifact;
      const args = ["run", "--no-profile", "--with-extension", readerCommand, "--instructions", artifact.path, "--name", sessionName, "--max-turns", String(maxTurns), "--quiet", "--output-format", "stream-json"];
      if (model !== undefined) args.push("--model", model);
      const run = await gooseProcess(this.executable, args, env, workspace, "", timeout * 1000);
      // Retain private diagnostics independently of temporary HOME, even for failed runs.
      await writeFile(join(dirname(artifact.path), "host-run.stdout"), redact(run.stdout.toString("utf8"), secrets), { flag: "wx", mode: 0o600 });
      await writeFile(join(dirname(artifact.path), "host-run.stderr"), redact(run.stderr.toString("utf8"), secrets), { flag: "wx", mode: 0o600 });
      successful(run, "Goose judge execution");
      const exported = await gooseProcess(this.executable, ["session", "export", "--name", sessionName, "--format", "json"], env, workspace, "", 10000);
      await writeFile(join(dirname(artifact.path), "host-export.json"), redact(exported.stdout.toString("utf8"), secrets), { flag: "wx", mode: 0o600 });
      await writeFile(join(dirname(artifact.path), "host-export.stderr"), redact(exported.stderr.toString("utf8"), secrets), { flag: "wx", mode: 0o600 });
      successful(exported, "Goose named export");
      // Attribution AND evidence/domain validation use original bytes, never sanitized evidence.
      const text = terminalResponse(JSON.parse(exported.stdout.toString("utf8")), packet.instructions);
      const originalOutcome = packet.decode(JSON.parse(text));
      const outcome = JSON.parse(redact(JSON.stringify(originalOutcome), secrets)) as typeof originalOutcome;
      // Mapping restores original frozen IDs/text/paths. Never return credential-bearing source metadata.
      if (redact(JSON.stringify(outcome), secrets) !== JSON.stringify(outcome)) throw new Error("Judge outcome contains known credentials");
      result = { outcome, provenance };
    } catch (error) {
      // Parsing errors may echo raw model text. Only controlled errors from this adapter are safe;
      // generic technical failure is preferable to a native/parser credential leak.
      const message = error instanceof SyntaxError ? "Invalid Goose judge JSON" : error instanceof Error ? error.message : "Goose judge transport failed";
      result = { outcome: { status: "technical-error", message: redact(message, secrets) || "Goose judge transport failed" }, provenance };
    } finally {
      if (root) {
        try { await rm(root, { recursive: true, force: true }); }
        catch { result = { outcome: { status: "technical-error", message: "Goose judge cleanup failed" }, provenance }; }
      }
    }
    const sanitized = redact(JSON.stringify(result), secrets);
    const safe = sanitized.startsWith("[OMITTED:")
      ? { outcome: { status: "technical-error" as const, message: "Judge result sanitization limit exceeded" }, provenance: { packetVersion: 2 as const, host: { id: "goose" as const }, model: { source: "configuration-default" as const, effective: "unknown" as const }, limits: { maxTurns: 20, timeout: 600, preflightTimeout: 10, exportTimeout: 10, outputBytes: 16 * 1024 * 1024 } } }
      : JSON.parse(sanitized) as JudgeResult;
    // Technical outcome shape stays canonical; provenance is deliberately outside the blinded packet.
    if (safe.outcome.status === "technical-error") safe.outcome = validateJudgment([], [], safe.outcome);
    return safe;
  }
}
