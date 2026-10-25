import type {
  HostAdapterErrorData,
  HostCapabilityDegradation,
  HostCapabilityReport,
  HostNegotiationRequest,
  HostNegotiationResult,
  IsolationLevel,
} from "./host-adapter-types.js";

/** A host-neutral unit of work that must be classified before it can be launched. */
export interface HostPreflightJobInput {
  jobId: string;
  negotiation: HostNegotiationRequest;
  /** Requirements whose absence would violate the job's safety boundary. They are always negotiated as required. */
  safety?: { isolation?: IsolationLevel; tools?: string[] };
  viewer?: "none" | "static" | "live";
  metrics?: { tokens?: boolean; cost?: boolean };
}

export interface HostPreflightInput {
  report: HostCapabilityReport;
  jobs: HostPreflightJobInput[];
  /** Desired number of simultaneously launched jobs. Defaults to one. */
  requestedConcurrency?: number;
  /** Additive scheduler declaration kept outside the versioned, closed host capability report. */
  concurrency?: HostConcurrencyCapability;
}

export type HostPreflightJobStatus = "runnable" | "downgraded" | "blocked";
export type HostPreflightConsequenceCode =
  | "OPTIONAL_CAPABILITY_UNAVAILABLE"
  | "STATIC_VIEWER_FALLBACK"
  | "SEQUENTIAL_EXECUTION_FALLBACK"
  | "CONCURRENCY_LIMITED"
  | "TOKEN_METRICS_UNAVAILABLE"
  | "COST_METRICS_UNAVAILABLE";

export interface HostPreflightConsequence { code: HostPreflightConsequenceCode; message: string; capability?: string; }
export interface HostPreflightMetric { value: null; available: boolean; reason: string | null; }
export interface HostPreflightJobResult {
  jobId: string;
  status: HostPreflightJobStatus;
  launchAllowed: boolean;
  negotiation: HostNegotiationResult;
  viewer: { requested: "none" | "static" | "live"; resolved: "none" | "static" | "live"; reason: string | null };
  metrics: { tokens: HostPreflightMetric; cost: HostPreflightMetric };
  consequences: HostPreflightConsequence[];
  errors: HostAdapterErrorData[];
}

export interface HostPreflightDiagnostic {
  code: "PREFLIGHT_INPUT_INVALID";
  path: string;
  message: string;
}

export interface HostPreflightResult {
  invalidInput: false;
  diagnostics: [];
  status: HostPreflightJobStatus;
  launchAllowed: boolean;
  report: HostCapabilityReport;
  requestedConcurrency: number;
  effectiveConcurrency: number;
  executionMode: "sequential" | "concurrent";
  jobs: HostPreflightJobResult[];
}

/** Fail-closed result returned for any incomplete or malformed runtime input. */
export interface HostPreflightInvalidResult {
  invalidInput: true;
  diagnostics: HostPreflightDiagnostic[];
  status: "blocked";
  launchAllowed: false;
  requestedConcurrency: null;
  effectiveConcurrency: 0;
  executionMode: "sequential";
  jobs: [];
}
export type HostPreflightOutcome = HostPreflightResult | HostPreflightInvalidResult;

/** Optional additive capability used by preflight; its absence means sequential execution only. */
export interface HostConcurrencyCapability { supported: boolean; maxParallelJobs?: number; }
export type { HostCapabilityDegradation };
