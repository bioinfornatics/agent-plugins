import { spawn } from "node:child_process";

export type ProcessResult = {
    code: number | null;
    reason: string;
    stdout: string;
    stderr: string;
    channels?: Record<string, unknown>;
    stdoutDecodeInvalid: boolean;
    stderrDecodeInvalid: boolean;
    signal: string | null;
    diagnostic: ProcessDiagnostic | null;
    durationSeconds: number;
    stdoutBytes: number;
    stderrBytes: number;
};
export type DiagnosticStage = "launch" | "discovery" | "task";
export type DiagnosticEvidenceKind = "text-hint" | "process-observation";
export interface ProcessDiagnostic {
    category: "configuration" | "cli" | "launch" | "authentication" | "timeout" | "execution" | "network";
    code: string; source: "stdout" | "stderr" | "process"; parameter?: string;
    evidence_kind?: DiagnosticEvidenceKind;
}
export type DiagnosticRedactor = (text: string) => string;
export interface DiagnosticChannel {
    redacted: boolean; observed_bytes: number; input_limit_bytes: number; projection_limit_bytes: number;
    decode_status: "invalid" | "complete" | "incomplete"; complete: boolean; input_truncated: boolean;
    truncated: boolean; withheld: boolean; withheld_reason: string | null; retained_bytes: number;
    path: null; path_bytes: number; text: string | null; events?: Record<string, number>;
}
/** Text classifications are advisory hints, not proof of causality. Legacy shapes are preserved. */
export function classifyDiagnostic(stdout: string, stderr: string, reason: string, stage?: DiagnosticStage): ProcessDiagnostic | null {
    if (reason === "completed")
        return null;
    // Lifecycle failures outrank partial payload hints.
    if (reason !== "host-exit") return {category:reason === "launch-failed" ? "launch" : reason === "timeout" ? "timeout" : "execution",code:reason,source:"process"};
    for (const [source, text] of [["stdout", stdout], ["stderr", stderr]] as const) {
        // Match only the observed native host prefix; never retain its advice or trailing payload.
        if (text.startsWith("\n  error: No provider configured. Run 'goose configure' first.\n\n"))
            return { category: "configuration", code: "provider-not-configured", source };
        if (/(?:unexpected argument|unrecognized (?:argument|option)|unknown option|invalid value .*--output-format)/i.test(text))
            return { category: "cli", code: "invalid-cli-arguments", source };
        if (/(?:command not found|ENOENT|No such file or directory)/i.test(text))
            return { category: "launch", code: "missing-executable-or-resource", source };
        if (/(?:keyring|secret service).*(?:unavailable|failed|not found|locked)/i.test(text))
            return { category: "authentication", code: "credential-store-unavailable", source };
        const missing = text.match(/Configuration value not found:\s*(AZURE_FOUNDRY_ENDPOINT|AZURE_FOUNDRY_MODEL|GOOSE_PROVIDER|GOOSE_MODEL)\b/);
        if (missing)
            return { category: "configuration", code: "missing-configuration", parameter: missing[1], source };
        if (/(?:unauthorized|authentication failed|invalid api key|\b401\b)/i.test(text))
            return { category: "authentication", code: "authentication-failed", source };
        if (stage === "task" && /(?:\b429\b|too many requests|rate limit)/i.test(text))
            return {category:"network",code:"rate-limited",source,evidence_kind:"text-hint"};
        if (stage === "task" && /(?:ECONNRESET|ETIMEDOUT|EAI_AGAIN|temporarily unavailable|network error)/i.test(text))
            return {category:"network",code:"transient-network-failure",source,evidence_kind:"text-hint"};
    }
    return {category:"execution",code:"unknown-host-failure",source:"process"};
}
/** Declared diagnostic projection cap, independent of the 16MiB aggregate input guard. */
export const DIAGNOSTIC_PROJECTION_BYTES = 64 * 1024;
export function projectDiagnosticChannel(text: string, observedBytes: number, reason: string, redact: DiagnosticRedactor, decodeInvalid: boolean): DiagnosticChannel {
    const complete = reason === "completed" || reason === "host-exit";
    const metadata: DiagnosticChannel = {redacted:false, observed_bytes:observedBytes, input_limit_bytes:16 * 1024 * 1024, projection_limit_bytes:DIAGNOSTIC_PROJECTION_BYTES,
        decode_status:decodeInvalid ? "invalid" : complete ? "complete" : "incomplete",
        complete, input_truncated:!complete && reason !== "launch-failed", truncated:false, withheld:false, withheld_reason:null as string | null, retained_bytes:0, path:null, path_bytes:0, text:null as string | null};
    const withhold = (why:string) => ({...metadata, withheld:observedBytes>0, withheld_reason:observedBytes>0 ? why : null});
    // Never project a partial stream: a size/timeout/decode boundary may split a secret.
    if(!complete || decodeInvalid)return withhold(decodeInvalid ? "invalid-utf8" : reason);
    // Aggregate known-taint redaction precedes all screening and byte truncation.
    const safeText=redact(text);
    metadata.redacted = safeText !== text;
    const lines=safeText.split(/\r?\n/).filter(l=>l.trim());
    if(lines.some(l=>/[\[{]/.test(l.replaceAll("[REDACTED]","redacted")))) {
        // Closed event metadata only; no provider text, tool arguments, reasoning, unknown fields or hashes.
        const allowed=new Set(["message","complete","error","tool_request","tool_response","notification"]);
        const counts:Record<string,number>={};let unknown=false;
        for(const line of lines) {
            try {const event=JSON.parse(line);if(!event || !allowed.has(event.type)){unknown=true;continue;}counts[event.type]=(counts[event.type] ?? 0)+1;}catch {unknown=true;}
        }
        return {...withhold(unknown ? "unsupported-structured-payload" : "provider-event-stream"),events:counts};
    }
    // Unknown credential-like values are not safe merely because they were absent from configuration.
    if(/(?:\b(?:credential|api[-_ ]?key|key|sensitive|private|token|secret|password|authorization|authentication)\b(?!\s*\[REDACTED\]))|\b[A-Za-z0-9_-]{32,}\b|[\x00-\x08\x0b\x0c\x0e-\x1f]/i.test(safeText))return withhold("sensitive-or-unsupported-diagnostic");
    const bytes=Buffer.from(safeText,"utf8");
    let retained=bytes.subarray(0,DIAGNOSTIC_PROJECTION_BYTES);
    // Preserve a complete UTF-8 boundary after byte truncation without replacement/raw bytes.
    while(retained.length) {try {new TextDecoder("utf-8",{fatal:true}).decode(retained);break;}catch {retained=retained.subarray(0,retained.length-1);}}
    return {...metadata,truncated:bytes.length>retained.length,retained_bytes:retained.length,text:retained.toString("utf8")};
}
/** Bounded aggregate decoding and owned process groups; projection occurs only after full redaction. */
export async function runProcess(argv: string[], cwd: string, env: NodeJS.ProcessEnv, stdin: string, timeout: number): Promise<ProcessResult> {
    return new Promise(resolveResult => {
        const started = performance.now();
        let stdoutDecodeInvalid = false, stderrDecodeInvalid = false;
        let stdout = "", stderr = "", size = 0, stdoutBytes = 0, stderrBytes = 0, reason = "completed", settled = false;
        const firstFailure = (next: string) => { if (reason === "completed") reason = next; };
        const decoder = new TextDecoder("utf-8", { fatal: true }), errorDecoder = new TextDecoder("utf-8", { fatal: true });
        const child = spawn(argv[0], argv.slice(1), { cwd, env, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
        let escalation: NodeJS.Timeout | undefined;
        const kill = (signal: NodeJS.Signals) => {
            try {
                if (process.platform !== "win32" && child.pid)
                    process.kill(-child.pid, signal);
                else
                    child.kill(signal);
            }
            catch { /* reaped */ }
        };
        const terminate = () => {
            kill("SIGTERM");
            if (!escalation)
                escalation = setTimeout(() => kill("SIGKILL"), 250);
        };
        const timer = setTimeout(() => { firstFailure("timeout"); terminate(); }, timeout * 1000);
        const finish = (code: number | null, signal: string | null = null) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (escalation)
                clearTimeout(escalation);
            kill("SIGKILL");
            resolveResult({ code, reason, signal, stdoutDecodeInvalid, stderrDecodeInvalid, diagnostic: classifyDiagnostic(stdout, stderr, reason), stdout, stderr, durationSeconds: (performance.now() - started) / 1000, stdoutBytes, stderrBytes });
        };
        child.stdout.on("data", (chunk: Buffer) => {
            stdoutBytes += chunk.length;
            size += chunk.length;
            if (size > 16 * 1024 * 1024) {
                firstFailure("output-limit");
                terminate();
                return;
            }
            if (reason !== "completed")
                return;
            try {
                stdout += decoder.decode(chunk, { stream: true });
            }
            catch {
                stdoutDecodeInvalid = true;
                firstFailure("invalid-utf8");
                terminate();
            }
        });
        child.stderr.on("data", (chunk: Buffer) => {
            stderrBytes += chunk.length;
            size += chunk.length;
            if (size > 16 * 1024 * 1024) {
                firstFailure("output-limit");
                terminate();
                return;
            }
            if (reason !== "completed")
                return;
            try {
                stderr += errorDecoder.decode(chunk, { stream: true });
            }
            catch {
                stderrDecodeInvalid = true;
                firstFailure("invalid-utf8");
                terminate();
            }
        });
        child.stdin.on("error", () => { });
        child.on("error", () => { firstFailure("launch-failed"); terminate(); finish(null); });
        child.on("exit", () => kill("SIGKILL"));
        child.on("close", (code, signal) => {
            if (reason === "completed") {
                try {stdout += decoder.decode();}catch {stdoutDecodeInvalid=true;firstFailure("invalid-utf8");}
                try {stderr += errorDecoder.decode();}catch {stderrDecodeInvalid=true;firstFailure("invalid-utf8");}
            }
            if (code !== 0 && reason === "completed")
                reason = "host-exit";
            finish(code, signal);
        });
        child.stdin.end(stdin);
    });
}
/** Recommendations only: recovery never retries or relaunches a model. */
export type RecoveryAction = "user-prerequisite" | "review-bounded-retry-policy" | "inspect-indeterminate-completion" | "repair-capture-without-relaunch" | "inspect-failure";
export interface FailureRecovery { retryable: false; action: RecoveryAction; }
export function recoveryForFailure(code: string): FailureRecovery {
    if (["provider-not-configured", "missing-configuration", "invalid-cli-arguments", "missing-executable-or-resource", "credential-store-unavailable", "authentication-failed", "uncertain-auth-arguments"].includes(code))
        return {retryable:false,action:"user-prerequisite"};
    if (["rate-limited", "transient-network-failure"].includes(code))
        return {retryable:false,action:"review-bounded-retry-policy"};
    if (code.startsWith("evaluation-config-")) return {retryable:false,action:"user-prerequisite"};
    if (code === "timeout") return {retryable:false,action:"inspect-indeterminate-completion"};
    if (code.startsWith("sensitive-") || code.startsWith("replay-sensitive-") || ["invalid-utf8", "output-limit", "invocation-plan-capture-failed", "invocation-result-capture-failed"].includes(code))
        return {retryable:false,action:"repair-capture-without-relaunch"};
    return {retryable:false,action:"inspect-failure"};
}
