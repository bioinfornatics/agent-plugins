// Contracts for one isolated, non-interactive behavioral evaluation run.
import type { ExecutionEfficiencyTelemetry } from "../execution_efficiency.js";
export type PairedFailureCode =
  | "invalid-plan"
  | "command-not-found"
  | "timeout"
  | "cancelled"
  | "provider-limited"
  | "provider-permanent"
  | "budget-exhausted"
  | "model-unavailable"
  | "model-rejected"
  | "tool-unavailable"
  | "tool-rejected"
  | "invalid-cwd"
  | "capability-mismatch"
  | "host-exit"
  | "invalid-response"
  | "incomplete";

export type SanitizedEvidenceEventType = "message" | "complete" | "progress" | "error" | "invalid-json" | "unknown";

export interface SanitizedEvidenceEvent {
  type: SanitizedEvidenceEventType;
  observed_at_seconds: number;
  tool_name?: string;
  locator?: { kind: "file" | "reference"; value: string | null; redacted: boolean; reason: string | null };
  redactions: string[];
}

export interface PairedExecutionEvidence {
  /** Sanitized JSON projection only; never raw provider stdout or private reasoning. */
  transcript: string;
  events: SanitizedEvidenceEvent[];
  durationSeconds: number;
  hostVersion: string;
  exitReason: string;
  exitCode: number | null;
  command: string[];
  telemetry: ExecutionEfficiencyTelemetry;
}

export interface ProviderErrorMetadata {
  classification: "transient" | "permanent";
  status: number | null;
  code: string | null;
  retryAfterMs: number | null;
  retryOwner: "provider-scheduler";
  resumable?: boolean;
}

export class PairedExecutionError extends Error {
  constructor(
    public readonly code: PairedFailureCode,
    message: string,
    public readonly exitReason: string,
    public readonly exitCode: number | null = null,
    public readonly evidence?: PairedExecutionEvidence,
    public readonly provider?: ProviderErrorMetadata,
  ) {
    super(message);
    this.name = "PairedExecutionError";
  }
}

export interface DeclaredCapabilities {
  filesystem: boolean;
  agent_runner: boolean;
  browser: boolean;
  network: boolean;
  tools: string[];
}

export interface PairedExecutionPlan {
  prompt: string;
  assertions: unknown[];
  cwd: string;
  model: string | null;
  /** Explicit, provenance-bound adapter reasoning configuration. */
  reasoning?: { id: string; level: string; config: Record<string, unknown>; adapterConfig?: Record<string, unknown> };
  tools: string[];
  capabilities?: DeclaredCapabilities;
  maxTurns?: number;
  timeoutSeconds: number;
  configuration?: string;
  skillName?: string;
  signal?: AbortSignal;
  seed?: number;
  pairIndex?: number;
  orderPosition?: number;
  fixtureSha256?: string;
}

export interface PairedExecutionResult extends PairedExecutionEvidence {
  output: string;
  tokens: number | null;
  tokenAvailabilityReason: string | null;
  exitCode: number;
}

export interface PairedRunner {
  readonly retryBehavior?: "none" | "internal";
  executePaired(plan: PairedExecutionPlan): Promise<PairedExecutionResult>;
}
