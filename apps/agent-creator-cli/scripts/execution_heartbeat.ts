/** Privacy-safe progress heartbeats for long-running agent executions. */

import type { ExecutionEtaEstimate } from "./execution_eta.js";
import { redactValue } from "./privacy_policy.js";

export const EXECUTION_HEARTBEAT_SCHEMA = "agent-creator.execution-heartbeat/v1" as const;
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

export type ExecutionStatus = "pending" | "running" | "completed" | "failed" | "retry";

export interface ExecutorTaskSnapshot {
  status: ExecutionStatus | "queued" | "in_progress" | "succeeded" | "error" | "retrying";
  worker?: string;
  model?: string;
  [key: string]: unknown;
}

export interface ExecutorSnapshot {
  tasks?: ExecutorTaskSnapshot[];
  counts?: Partial<Record<ExecutionStatus, number>>;
  workers?: string[] | number;
  models?: string[];
  startedAt?: number | string | Date;
  updatedAt?: number | string | Date;
  checkpoint?: unknown;
  budget?: { consumed?: number; used?: number; limit?: number; unit?: string; [key: string]: unknown };
  budgets?: Record<string, { consumed?: number; used?: number; limit?: number }>;
  terminal?: boolean;
  status?: string;
  /** Optional cautious estimate generated from completed-job history. */
  eta?: ExecutionEtaEstimate;
  [key: string]: unknown;
}

export interface ExecutionHeartbeatEvent {
  type: "execution.heartbeat";
  schema_version: typeof EXECUTION_HEARTBEAT_SCHEMA;
  timestamp: string;
  data: {
    counts: Record<ExecutionStatus, number>;
    workers: { active: number; ids: string[] };
    models: string[];
    elapsed_ms: number;
    checkpoint: unknown;
    budget: Record<string, { consumed: number; limit?: number; remaining?: number; fraction?: number }>;
    stale: boolean;
    stale_for_ms: number;
    terminal: boolean;
    eta?: ExecutionEtaEstimate;
  };
}

export interface HeartbeatClock {
  now(): number;
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface ExecutionHeartbeatOptions {
  intervalMs?: number;
  staleAfterMs?: number;
  clock?: HeartbeatClock;
}

const TERMINAL = new Set(["completed", "failed", "cancelled", "canceled", "terminated"]);

const systemClock: HeartbeatClock = {
  now: () => Date.now(),
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>),
};

function millis(value: number | string | Date | undefined): number | undefined {
  if (value === undefined) return undefined;
  const result = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(result) ? result : undefined;
}

function nonnegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function statusOf(value: string): ExecutionStatus | undefined {
  if (value === "queued") return "pending";
  if (value === "in_progress") return "running";
  if (value === "succeeded") return "completed";
  if (value === "error") return "failed";
  if (value === "retrying") return "retry";
  return (["pending", "running", "completed", "failed", "retry"] as string[]).includes(value) ? value as ExecutionStatus : undefined;
}

/** Uses the central policy redactor before arbitrary checkpoint values cross an event boundary. */
export function redactHeartbeatValue(value: unknown, _seen = new WeakSet<object>(), topLevel = true): unknown {
  return redactValue(value, { topLevel });
}

/** Converts one executor snapshot into the stable, event-compatible heartbeat envelope. */
export function buildExecutionHeartbeat(snapshot: ExecutorSnapshot, now = Date.now(), staleAfterMs = DEFAULT_HEARTBEAT_INTERVAL_MS * 2): ExecutionHeartbeatEvent {
  const counts: Record<ExecutionStatus, number> = { completed: 0, running: 0, pending: 0, failed: 0, retry: 0 };
  const tasks = snapshot.tasks ?? [];
  for (const task of tasks) {
    const status = statusOf(task.status);
    if (status) counts[status]++;
  }
  for (const key of Object.keys(counts) as ExecutionStatus[]) {
    if (snapshot.counts?.[key] !== undefined) counts[key] = nonnegative(snapshot.counts[key]);
  }
  const workerIds = new Set<string>();
  const modelIds = new Set<string>(snapshot.models ?? []);
  for (const task of tasks) {
    if (task.worker && statusOf(task.status) === "running") workerIds.add(task.worker);
    if (task.model) modelIds.add(task.model);
  }
  // Active workers are derived from running tasks. `workers` may describe the
  // configured pool and must never be reported as current activity.
  const terminal = snapshot.terminal === true || TERMINAL.has(String(snapshot.status ?? "").toLowerCase());
  const activeWorkers = terminal ? 0 : workerIds.size;
  const startedAt = millis(snapshot.startedAt) ?? now;
  const updatedAt = millis(snapshot.updatedAt);
  const staleFor = updatedAt === undefined ? Math.max(0, now - startedAt) : Math.max(0, now - updatedAt);
  const budgetInputs: Record<string, { consumed?: number; used?: number; limit?: number }> = { ...(snapshot.budgets ?? {}) };
  if (snapshot.budget) budgetInputs[snapshot.budget.unit || "units"] = snapshot.budget;
  const budget: Record<string, { consumed: number; limit?: number; remaining?: number; fraction?: number }> = {};
  for (const [unit, value] of Object.entries(budgetInputs)) {
    const consumed = nonnegative(value.consumed ?? value.used);
    const limit = typeof value.limit === "number" && Number.isFinite(value.limit) && value.limit >= 0 ? value.limit : undefined;
    budget[unit] = { consumed, ...(limit === undefined ? {} : { limit, remaining: Math.max(0, limit - consumed), fraction: limit === 0 ? 0 : consumed / limit }) };
  }
  return {
    type: "execution.heartbeat",
    schema_version: EXECUTION_HEARTBEAT_SCHEMA,
    timestamp: new Date(now).toISOString(),
    data: {
      counts,
      workers: { active: activeWorkers, ids: terminal ? [] : [...workerIds].sort() },
      models: [...modelIds].sort(),
      elapsed_ms: Math.max(0, now - startedAt),
      checkpoint: redactHeartbeatValue(snapshot.checkpoint ?? null),
      budget,
      stale: staleFor > staleAfterMs,
      stale_for_ms: staleFor,
      terminal,
      ...(snapshot.eta ? { eta: redactHeartbeatValue(snapshot.eta, new WeakSet<object>(), false) as ExecutionEtaEstimate } : {}),
    },
  };
}

/** Polls executor snapshots and emits heartbeats until stopped or a terminal snapshot is seen. */
export class ExecutionHeartbeatScheduler {
  private handle: unknown;
  private stopped = false;
  readonly intervalMs: number;
  readonly staleAfterMs: number;
  private readonly clock: HeartbeatClock;

  constructor(private readonly snapshot: () => ExecutorSnapshot, private readonly emit: (event: ExecutionHeartbeatEvent) => void, options: ExecutionHeartbeatOptions = {}) {
    this.intervalMs = options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    if (!Number.isFinite(this.intervalMs) || this.intervalMs <= 0) throw new Error("heartbeat intervalMs must be positive");
    this.staleAfterMs = options.staleAfterMs ?? this.intervalMs * 2;
    if (!Number.isFinite(this.staleAfterMs) || this.staleAfterMs < 0) throw new Error("heartbeat staleAfterMs must be non-negative");
    this.clock = options.clock ?? systemClock;
  }

  start(): this {
    if (this.stopped || this.handle !== undefined) return this;
    this.handle = this.clock.setInterval(() => this.tick(), this.intervalMs);
    return this;
  }

  tick(): ExecutionHeartbeatEvent | undefined {
    if (this.stopped) return undefined;
    const snapshot = this.snapshot();
    if (snapshot.terminal === true || TERMINAL.has(String(snapshot.status ?? "").toLowerCase())) {
      this.stop();
      return undefined;
    }
    const event = buildExecutionHeartbeat(snapshot, this.clock.now(), this.staleAfterMs);
    this.emit(event);
    return event;
  }

  stop(): void {
    if (this.handle !== undefined) this.clock.clearInterval(this.handle);
    this.handle = undefined;
    this.stopped = true;
  }

  get isStopped(): boolean { return this.stopped; }
}

export function createExecutionHeartbeat(snapshot: () => ExecutorSnapshot, emit: (event: ExecutionHeartbeatEvent) => void, options: ExecutionHeartbeatOptions = {}): ExecutionHeartbeatScheduler {
  return new ExecutionHeartbeatScheduler(snapshot, emit, options).start();
}
