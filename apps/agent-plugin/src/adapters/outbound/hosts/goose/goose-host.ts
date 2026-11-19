import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { MAX_TIMEOUT_SECONDS, type CandidateSandbox, type EvaluationOptions, type EvaluationProfile } from "../../../../domain/evaluation.ts";
import type { CandidateHost } from "../../../../application/ports/candidate-host.ts";
import type { TrialRequest, TrialResult } from "../../../../domain/execution.ts";
import { collectEnvironmentCredentials } from "./credential-values.ts";
import { isolatedEnvironment } from "./goose-environment.ts";
import { enablePlugin, parseInfo, prepareConfiguration, record, type GooseInfo } from "./goose-configuration.ts";
import { configuredGooseModel, observedGooseModel, resolveGooseModel, selectedGooseProvider, type ConfiguredGooseModel, type ObservedGooseModel } from "./goose-model.ts";
import { decodeGooseConversation } from "./goose-conversation.ts";
import { gooseProcess } from "./goose-process.ts";
import { bubblewrapArguments, resolveExecutable, systemEntries, type SystemEntry } from "./goose-sandbox.ts";
import { snapshotUserSkills, collectAuthoredUserSkills } from "./authored-user-skills.ts";
import { namespacePluginSkills } from "./namespace-plugin-skills.ts";
import { contained, restoreSnapshot, FILE_LIMIT, missing, privateDirectory, regularFile, TREE_LIMIT, walk } from "./private-files.ts";

export interface GooseHostOptions {
  executable?: string; env?: NodeJS.ProcessEnv; tempRoot?: string;
  /** Extra inherited variable names for trial processes; never-forward rules still apply. */
  forwardEnvironment?: readonly string[];
  /** Bubblewrap command for `--sandbox bubblewrap` (default `bwrap`, resolved on PATH). */
  bubblewrap?: string;
}
interface SandboxRuntime { bubblewrap: string; goose: string; system: SystemEntry[] }
const SANDBOX_LIMITATION = "Candidate run executed under bubblewrap: only /usr, /etc, /opt, resolver state, the private HOME/XDG root and the workspace are visible; host /home, /tmp and /dev/shm are hidden; network is shared (internet, localhost services and abstract Unix sockets such as X11 remain reachable) and preflight/export run outside the sandbox.";
interface PrivateTrial { root: string; workspace: string; env: NodeJS.ProcessEnv; info: GooseInfo; secrets: Set<string> }
const LIMITATIONS = [
  "Private HOME/XDG isolates host discovery, not operating-system access: network and filesystem remain reachable and are not sandboxed.",
  "Trial processes receive an allowlisted environment: locale/path/proxy/TLS-trust basics, GOOSE_* settings except secret-like, executable and context/path overrides, and the selected provider's variables only; SSH agent, D-Bus session (desktop keyring) and unrelated tokens are withheld.",
  "Only builtin/platform ambient extensions are retained; ambient hooks, context, loaders and prompt/recipe overrides are removed.",
  "Credential redaction covers known environment/configuration values, not unknown keyring or network-discovered credentials.",
];
function safeName(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) || value === "." || value === "..") throw new Error("Unsafe trial/target basename");
  return value;
}
/** Native Goose transport. Importing this class performs no I/O. */
export class GooseHost implements CandidateHost {
  private readonly executable: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly tempRoot: string;
  private readonly forwardEnvironment: readonly string[];
  private discovery?: Promise<GooseInfo>;
  private sandbox?: Promise<SandboxRuntime>;
  private readonly bubblewrap: string;
  /** Bubblewrap relies on Linux namespaces; other platforms advertise no sandbox. */
  readonly sandboxes: readonly CandidateSandbox[] = process.platform === "linux" ? ["bubblewrap"] : [];
  constructor(options: GooseHostOptions = {}) {
    this.bubblewrap = options.bubblewrap ?? "bwrap";
    this.executable = options.executable ?? "goose";
    this.env = { ...(options.env ?? process.env) };
    this.tempRoot = options.tempRoot ?? tmpdir();
    this.forwardEnvironment = [...(options.forwardEnvironment ?? [])];
  }
  async preflight(profile: EvaluationProfile, options?: EvaluationOptions): Promise<void> {
    // Validate the entire frozen treatment before any candidate admission, including the without arm.
    for (const target of profile.components) {
      safeName(target.installationName);
      if (target.kind !== "plugin") continue;
      if (target.files.some((file) => ["mcp.json", ".mcp.json"].includes(file.path.split("/").at(-1) ?? ""))) throw new Error("Plugin MCP mapping is unsupported");
      const manifestFile = target.files.find((file) => file.path === "plugin.json");
      if (!manifestFile) throw new Error("Missing frozen Plugin manifest");
      const manifest: unknown = JSON.parse(Buffer.from(manifestFile.content, "base64").toString("utf8"));
      if (!record(manifest) || manifest.mcpServers !== undefined) throw new Error("Plugin MCP declarations are unsupported");
    }
    await this.discover();
    if (options?.sandbox === "bubblewrap") await this.sandboxRuntime();
  }
  /** Probe once: bubblewrap must start (user namespaces allowed) and run this Goose inside it. */
  private sandboxRuntime(): Promise<SandboxRuntime> {
    if (!this.sandbox) {
      this.sandbox = (async () => {
        const runtime = { bubblewrap: await resolveExecutable(this.bubblewrap, this.env.PATH), goose: await resolveExecutable(this.executable, this.env.PATH), system: await systemEntries() };
        const trial = await this.prepare(await this.discover());
        try {
          const probe = await gooseProcess(runtime.bubblewrap, bubblewrapArguments({ executable: runtime.goose, root: trial.root, workspace: trial.workspace, system: runtime.system }, ["--version"]), trial.env, trial.workspace);
          if (probe.exitCode !== 0 || probe.timeout || probe.overflow || !/\d+\.\d+/.test(probe.stdout.toString("utf8"))) throw new Error("probe");
        } finally { await rm(trial.root, { recursive: true, force: true }); }
        return runtime;
      })().catch((error: unknown) => {
        this.sandbox = undefined;
        // Fixed message: never surface process output or local paths.
        throw new Error("Bubblewrap sandbox unavailable: install bwrap and allow unprivileged user namespaces", { cause: error });
      });
    }
    return this.sandbox;
  }
  async resolveModel(options: EvaluationOptions): Promise<ConfiguredGooseModel> {
    try { return await resolveGooseModel(await this.discover(), this.env, options); }
    catch { throw new Error("Unable to resolve a safe configured Goose provider/model identity."); }
  }
  private discover(): Promise<GooseInfo> {
    if (!this.discovery) {
      this.discovery = this.check().catch((error: unknown) => { this.discovery = undefined; throw error; });
    }
    return this.discovery;
  }
  private async info(env: NodeJS.ProcessEnv, cwd: string): Promise<GooseInfo> {
    const result = await gooseProcess(this.executable, ["info"], env, cwd);
    if (result.exitCode !== 0 || result.timeout || result.overflow) throw new Error("Goose info preflight failed");
    return parseInfo(result.stdout);
  }
  private async check(): Promise<GooseInfo> {
    // Plain info only: --verbose leaks secrets and --check can make a paid request.
    const original = await this.info(this.env, this.tempRoot);
    const trial = await this.prepare(original);
    try {
      const runHelp = await gooseProcess(this.executable, ["run", "--help"], trial.env, trial.workspace);
      const help = runHelp.stdout.toString("utf8") + runHelp.stderr.toString("utf8");
      if (runHelp.exitCode !== 0 || runHelp.timeout || runHelp.overflow || !["--instructions", "--name", "--max-turns", "--quiet", "--output-format", "--model", "stream-json"].every((flag) => help.includes(flag))) throw new Error("Goose run CLI is unsupported");
      const exportHelp = await gooseProcess(this.executable, ["session", "export", "--help"], trial.env, trial.workspace);
      const text = exportHelp.stdout.toString("utf8") + exportHelp.stderr.toString("utf8");
      if (exportHelp.exitCode !== 0 || exportHelp.timeout || exportHelp.overflow || !["--name", "--format", "json"].every((flag) => text.includes(flag))) throw new Error("Goose session export CLI is unsupported");
      return original;
    } finally { await rm(trial.root, { recursive: true, force: true }); }
  }
  /** `provider` selects inherited provider variables; omit it for credential-free CLI probes. */
  private async prepare(original: GooseInfo, provider?: string): Promise<PrivateTrial> {
    const root = await mkdtemp(join(this.tempRoot, "agent-plugin-goose-"));
    try {
      await privateDirectory(root);
      const env = isolatedEnvironment(this.env, root, { provider, forward: this.forwardEnvironment });
      for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR", "APPDATA", "LOCALAPPDATA", "TMPDIR"]) {
        const path = env[key];
        if (path) await privateDirectory(path);
      }
      const workspace = join(root, "workspace");
      await privateDirectory(workspace);
      const info = await this.info(env, workspace);
      const secrets = new Set<string>();
      collectEnvironmentCredentials(this.env, secrets);
      await prepareConfiguration(original, info, root, secrets);
      return { root, workspace, env, info, secrets };
    } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
  }
  async run(request: TrialRequest): Promise<TrialResult> {
    const sessionName = `trial-${safeName(request.id)}`;
    // Defense in depth: execution validates the same limits before campaign begin
    // (domain validateExecutionLimits / MAX_TIMEOUT_SECONDS, setTimeout's signed 32-bit range).
    if (!Number.isSafeInteger(request.options.maxTurns) || request.options.maxTurns < 1 || !Number.isSafeInteger(request.options.timeout) || request.options.timeout < 0 || request.options.timeout > MAX_TIMEOUT_SECONDS) throw new Error("Invalid Goose execution limits");
    const original = await this.discover();
    // The frozen identity decides which provider variables the trial inherits; it is
    // fully validated below. Legacy plans fall back to the operator's active provider.
    const frozenProvider = request.options.candidateModels?.goose?.provider;
    const trial = await this.prepare(original, typeof frozenProvider === "string" ? frozenProvider : await selectedGooseProvider(original, this.env));
    if (request.runtime) trial.workspace = request.runtime.locations.candidate;
    const task = request.runtime?.task ?? request.scenario.prompt;
    try {
      const frozen = request.options.candidateModels?.goose;
      const configured = frozen === undefined ? undefined : configuredGooseModel(frozen, trial.secrets);
      let observed: ObservedGooseModel | null = null;
      if (configured) {
        // Frozen campaign identity overrides operator defaults even on retained resume.
        // Keep --model below for legacy explicit overrides, but never require it here.
        if (request.options.model !== undefined && request.options.model !== configured.model) throw new Error("Frozen Goose model conflicts with explicit override.");
        trial.env.GOOSE_PROVIDER = configured.provider;
        trial.env.GOOSE_MODEL = configured.model;
      }
      if (request.condition === "with") {
        for (const target of request.profile.components) {
          const destination = join(trial.env.HOME ?? "", ".agents", target.kind === "skill" ? "skills" : "plugins", safeName(target.installationName));
          await restoreSnapshot(target.files, destination);
          if (target.kind === "plugin") {
            await namespacePluginSkills(destination, target.installationName, target.files);
            await enablePlugin(trial.info.config, destination);
          }
        }
      }
      // Capture only private installed roots after treatment setup, before candidate
      // execution. New roots are output; existing treatment bytes never are.
      const userSkillsBefore = await snapshotUserSkills(trial.env.HOME ?? "");
      if (request.scenario.fixturesFiles) await restoreSnapshot(request.scenario.fixturesFiles, trial.workspace);
      const args = ["run", "--instructions", "-", "--name", sessionName, "--max-turns", String(request.options.maxTurns), "--quiet", "--output-format", "stream-json"];
      if (request.options.model !== undefined) args.push("--model", request.options.model);
      const startedAt = new Date().toISOString();
      let processResult: Awaited<ReturnType<typeof gooseProcess>>;
      if (request.options.sandbox === "bubblewrap") {
        // Frozen isolation: the probe reruns after process restart, and a failure rejects the trial rather than running unsandboxed.
        const sandbox = await this.sandboxRuntime();
        processResult = await gooseProcess(sandbox.bubblewrap, bubblewrapArguments({ executable: sandbox.goose, root: trial.root, workspace: trial.workspace, system: sandbox.system }, args), trial.env, trial.workspace, task, request.options.timeout * 1000);
      } else processResult = await gooseProcess(this.executable, args, trial.env, trial.workspace, task, request.options.timeout * 1000);
      const finishedAt = new Date().toISOString();
      const artifacts: TrialResult["artifacts"] = [];
      const limitations = request.options.sandbox === "bubblewrap" ? [SANDBOX_LIMITATION, ...LIMITATIONS.slice(1)] : [...LIMITATIONS];
      let artifactSize = 0;
      let omittedEvidence = false;
      const add = (path: string, bytes: Buffer): void => {
        if (bytes.length > 16 * 1024 * 1024 || artifactSize + bytes.length > TREE_LIMIT) { omittedEvidence = true; limitations.push("Artifact size bound reached; some evidence was omitted."); return; }
        let content = bytes;
        const text = bytes.toString("utf8");
        const binary = text.includes("\u0000") || !Buffer.from(text).equals(bytes);
        // Longest first prevents a short credential from hiding a longer overlapping one.
        // Text covers literal/JSON-escaped forms; credential-bearing binaries are omitted, never rewritten.
        const secrets = [...trial.secrets].sort((a, b) => b.length - a.length);
        if (binary) {
          if (secrets.some((secret) => bytes.includes(Buffer.from(secret)))) { omittedEvidence = true; limitations.push("A binary artifact containing a known credential was omitted."); return; }
        } else {
          let redacted = text;
          for (const secret of secrets) {
            redacted = redacted.split(secret).join("[REDACTED]");
            const escaped = JSON.stringify(secret).slice(1, -1);
            if (escaped !== secret) redacted = redacted.split(escaped).join("[REDACTED]");
          }
          content = Buffer.from(redacted);
        }
        // Redaction can enlarge short values: enforce the aggregate bound again on persisted bytes.
        if (artifactSize + content.length > TREE_LIMIT) { omittedEvidence = true; limitations.push("Redacted artifact size bound reached; some evidence was omitted."); return; }
        artifactSize += content.length;
        artifacts.push({ path, content });
      };
      add("goose/stream.jsonl", processResult.stdout);
      add("goose/stderr.log", processResult.stderr);
      if (processResult.overflow) limitations.push("Goose output exceeded 16 MiB; process terminated and output is partial.");
      // Only the named export can establish conversation evidence; never substitute a latest session.
      // Process status remains separate from collection completeness, including omitted workspace/log files.
      let collection: TrialResult["collection"] = "unavailable";
      let exportFailure = "Named session export failed: unable to start export process.";
      try {
        const exported = await gooseProcess(this.executable, ["session", "export", "--name", sessionName, "--format", "json"], trial.env, trial.workspace);
        exportFailure = `Named session export failed: exitCode=${exported.exitCode}, timeout=${exported.timeout}, overflow=${exported.overflow}.`;
        if (exported.exitCode !== 0 || exported.timeout || exported.overflow) throw new Error("Session export failed");
        exportFailure = "Named session export failed: invalid JSON.";
        const data: unknown = JSON.parse(exported.stdout.toString("utf8"));
        exportFailure = "Named session export failed: unsupported conversation evidence.";
        let conversation: ReturnType<typeof decodeGooseConversation>;
        try { conversation = decodeGooseConversation(data, task); }
        catch (error) {
          // Only adapter-owned fixed reasons are safe receipt metadata. Never retain
          // parser/process exception text, exported settings or conversation in diagnostics.
          if (error instanceof Error && ["Unsupported/empty exported conversation", "Session prompt mismatch", "Missing assistant output"].includes(error.message)) exportFailure = `Named session export failed: ${error.message}.`;
          throw error;
        }
        // Export conversation only, never host configuration, secret stores or environment metadata.
        add("goose/conversation.json", Buffer.from(JSON.stringify(conversation)));
        collection = processResult.timeout || processResult.overflow || processResult.exitCode !== 0 ? "partial" : "complete";
        if (configured) {
          try {
            observed = observedGooseModel(data, trial.secrets);
            if (!observed) limitations.push("Named export model identity was unavailable; configured identity is not an observation.");
            else if (observed.provider !== configured.provider || observed.model !== configured.model) {
              collection = "partial";
              limitations.push("Observed Goose provider/model identity mismatches the frozen configuration; quality comparison is unsafe.");
            }
          } catch {
            collection = "partial";
            limitations.push("Named export model identity was malformed or unsafe and omitted; quality comparison is unsafe.");
          }
          limitations.push("Exported model metadata can describe aliases or fallbacks; it does not prove the actual provider backend.");
        }
      } catch { limitations.push(exportFailure, "Named session export was unavailable or unsupported; no latest-session fallback was attempted."); }
      try {
        let workspaceSize = 0;
        // This is output evidence, not treatment installation: evals can contain required
        // task inputs and generated suites. Keep private context/dependencies excluded;
        // the original input snapshot reaches the judge separately from this final state.
        await walk(trial.workspace, async (path, name) => {
          const bytes = await regularFile(path, FILE_LIMIT);
          workspaceSize += bytes.length;
          if (workspaceSize > TREE_LIMIT) throw new Error("Workspace evidence aggregate limit exceeded");
          add(`workspace/${name.split(sep).join("/")}`, bytes);
        }, (name) => [".git", ".agents", "node_modules", "config.yaml", "secrets.yaml", "permission.yaml", "tool_permissions.json"].includes(name) || /^\.env(?:\.|$)/.test(name));
      } catch { limitations.push("Workspace collection was partial: unsupported files or collection bounds encountered."); if (collection === "complete") collection = "partial"; }
      try {
        await collectAuthoredUserSkills(trial.env.HOME ?? "", userSkillsBefore, async (path, name) => {
          add(`user-skills/${name}`, await regularFile(path, FILE_LIMIT));
        });
      } catch {
        limitations.push("User Skill collection was partial: existing Skills changed, unsafe files or collection bounds encountered.");
        if (collection === "complete") collection = "partial";
      }
      if (trial.info.logs && contained(trial.root, trial.info.logs)) {
        try {
          await walk(trial.info.logs, async (path, name) => add(`goose/logs/${name.split(sep).join("/")}`, await regularFile(path)));
        } catch (error) {
          if (!missing(error)) { omittedEvidence = true; limitations.push("Host log collection was partial or unsupported."); }
        }
      }
      if (omittedEvidence && collection === "complete") collection = "partial";
      return {
        status: processResult.timeout ? "timeout" : processResult.exitCode === 0 && !processResult.overflow ? "completed" : "nonzero",
        exitCode: processResult.exitCode, sessionName, collection, startedAt, finishedAt,
        host: { id: "goose", version: trial.info.version }, ...(configured ? { model: { configured, observed } } : {}), artifacts, limitations: [...new Set(limitations)],
      };
    } finally { await rm(trial.root, { recursive: true, force: true }); }
  }
}
